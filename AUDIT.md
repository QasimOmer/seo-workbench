# Codebase audit

Self-audit of SEO Workbench, September 2026. Every figure below was measured,
not estimated — the commands are given so you can re-run them.

I wrote all of this code, so treat this as a defect list rather than a review. I
have tried to be as unsparing as the tool is about a client's site, and to order
findings the same way: by what gates what, not by how many there are.

**Scale:** 16,005 lines. 24 source files, 34 modules, 23 UI panels, 6 direct
dependencies, 223 passing tests.

---

## Summary

| | Count |
|---|---|
| Critical — will bite | 1 |
| High — real defects | 5 |
| Medium — debt with a cost | 6 |
| Low — tidiness | 4 |

The single worst thing in the codebase is `public/suite.js`. It is 2,326 lines
assembled by eleven successive appends, and it contains a monkey-patch chain
that is genuinely fragile. Everything else is ordinary debt.

---

## Fixed since this audit was written

**C1 (double handler) and H1 (the `showPanel` chain) are both resolved.**

- The dead `renderHealth` and its two bindings are gone. `/api/diagnostics`
  now fires **once** per visit, verified by counting requests in a real browser
  — it was firing twice and consuming your keyless PageSpeed quota at double
  rate.
- The eleven-deep monkey-patch chain is replaced by a hook registry:
  `onPanel(name, fn)`, with nav items bound exactly once at boot via `bindNav()`
  as the final line of the file. Thirteen hooks migrated. All 22 panels verified
  routing, every nav item confirmed bound once.

Everything below still stands.

## Critical (resolved — kept for the record)

### C1 — Two live handlers for the same panel, one of them dead code

`public/suite.js` defines **both** `renderHealth()` (line 786) and
`renderHealth2()` (line 2068). Both are bound to the `health` panel through
different links in the `showPanel` chain:

```
line  857:  if (name === 'health' && !$('#healthOut').innerHTML) renderHealth(true);
line 2105:  if (name === 'health') renderHealth2();
```

Both run on every visit to System check. The first writes the old flat layout
into `#healthOut`, the second immediately overwrites it with the layered one.
The visible result is correct, which is why I did not notice — the old one is
invisible because it loses a race it happens to always lose.

**Why it is Critical rather than cosmetic:** it fires a second full
`/api/diagnostics` request, and diagnostics makes real outbound calls to
PageSpeed, Pollinations and an image host. Every visit to that panel burns
**two** PageSpeed requests against a keyless quota of about 25 per day. That
is a user-visible bug — the panel that exists to tell you whether your quota
works is quietly consuming it twice as fast.

**Fix:** delete `renderHealth` and its listener at 814, and the branch at 857.

*Measured:* `grep -c "function renderHealth\b\|function renderHealth2" public/suite.js` → 2

---

## High

### H1 — The `showPanel` monkey-patch chain

`suite.js` reassigns `showPanel` **eleven times**, each wrapping the previous:

```js
const _sp11 = showPanel;
showPanel = function (name, opts) { _sp11(name, opts); if (name === 'logs') renderLogs(); };
```

And after each one, **all navigation items are cloned and re-bound**:

```js
$$('.navitem').forEach((b) => { const c = b.cloneNode(true); b.replaceWith(c); ... });
```

Ten clone-and-replace passes over ~23 nav buttons. Consequences:

- Every panel visit walks an eleven-deep call chain.
- `paintNavIcons()` has to be called again after each rebind, and is — three
  times, in three different places.
- Any listener attached to a nav item by earlier code is silently destroyed by a
  later clone. This is why C1's dead handler survives: it is registered on the
  chain, not on the element.
- Adding a twelfth feature means a twelfth link, and the failure mode is silent.

This is the direct result of my building the file by appending a section per
turn instead of restructuring. It works, and it is the thing most likely to
break the next time something is added.

**Fix:** one registry.

```js
const PANEL_HOOKS = {};
const onPanel = (name, fn) => { (PANEL_HOOKS[name] ||= []).push(fn); };
function showPanel(name) { /* … */ (PANEL_HOOKS[name] || []).forEach((f) => f()); }
```

Each feature calls `onPanel('logs', renderLogs)` once. Nav items get bound
exactly once, at boot.

*Measured:* `grep -c "showPanel = function" public/suite.js` → 11;
`grep -c "b.replaceWith(c)" public/suite.js` → 10

### H2 — `lib/providers.js` is half-dead and duplicates `lib/llm.js`

When I built the provider registry I moved text generation to `llm.js` but left
`providers.js` in place with its own copy. Both export `parseLooseJson`, and
`providers.js` still ships:

- `anthropicText`, `pollinationsChat`, `pollinationsPrompt`
- `TEXT_CHAIN`
- `generateText` — **exported and never imported anywhere**

So there are two implementations of the same fallback logic, and 438 lines
containing roughly 150 that nothing calls. Worse, they can drift: a fix to the
JSON parser in one file leaves the other wrong.

**Fix:** delete the text-generation half of `providers.js`, leaving it as
images + SERP + diagnostics. Import `parseLooseJson` from `llm.js`. Rename it to
something honest, since "providers" now means two different things.

*Measured:* `grep -n "export function parseLooseJson" lib/*.js` → two files

### H3 — `runAudit` is a 755-line function

`lib/audit.js:runAudit` is one function containing the entire core rule set.
Every check shares one scope, so any variable is reachable from any check and
the ordering of the file is load-bearing. That is exactly how the ordering bug
happened: I appended `push(...extraChecks())` after the sort and silently broke
the ladder guarantee, which is the tool's central promise.

The test suite caught it. The next one might not be so lucky.

**Fix:** the same shape `audit-extra.js` already uses — one exported function
per stage, each taking `(pages, ctx)` and returning findings. `runAudit`
becomes a list of calls plus the sort, and the sort provably runs last because
there is nothing after it.

*Measured:* AWK scan of function extents in `lib/audit.js`

### H4 — Read-modify-write on JSON files with no locking

Ten modules follow this pattern:

```js
const d = await read();     // parse the whole file
d.something.push(x);
await write(d);             // serialise the whole file
```

Two overlapping requests both read, both mutate their own copy, and the second
write silently discards the first. Realistic triggers: a scheduled monitor
firing while you click *Run now*; two browser tabs; a crawl finishing while you
add a person.

The worst instance is `lib/auth.js`, which does this for **sessions**. A login
concurrent with a logout can resurrect a revoked session or drop a valid one.

**Fix:** a single-writer queue per file — trivial in-process, since this is one
Node process:

```js
const queues = new Map();
const withFile = (path, fn) => {
  const prev = queues.get(path) || Promise.resolve();
  const next = prev.then(() => fn()).finally(() => { if (queues.get(path) === next) queues.delete(path); });
  queues.set(path, next);
  return next;
};
```

*Measured:* `grep -l "await readFile" lib/*.js` → 10 modules

### H5 — Auth re-reads and re-parses its file on every gated request

The `/api` gate calls `auth.status()`, which reads `data/auth.json` **and** the
`.env` file for provenance; then `auth.resolve()` reads `auth.json` again. So
every single API call costs two-plus JSON parses of the auth file plus a `.env`
read, and session lookup is a linear scan.

Fine at ten sessions. It is per-request work that grows with session count and
it is on the hot path for everything.

**Fix:** load once into memory at boot, keep it there, write through on change.
The file is the durable record, not the working set. Also stop calling the
provenance check from the gate — it belongs only in the Setup panel.

*Measured:* `grep -n "await read()" lib/auth.js`

---

## Medium

### M1 — Eight exported functions nothing calls

```
ai.aiKeyed                 render.htmlToPdf          gsc.setTokens
ai.usedProvider            render._renderGap         gsc.getTokens
providers.generateText     social.generateBackground
```

`render.htmlToPdf` is the sad one — I wrote PDF export and never wired it to a
button, so the "no client-ready reports" gap I have twice told you about is
half-built and sitting unused.

*Measured:* cross-reference of every `export` against all call sites

### M2 — Server state is one mutable module-level object

```js
const state = { crawl: null, audit: null, progress: null, propertyId: null, clusters: [] };
```

Referenced 107 times. It assumes one user doing one thing at a time. There is no
crawl lock, so two simultaneous crawls interleave writes to `state.crawl` and
the audit ends up describing a mixture of two sites.

This was a sound assumption for a localhost single-user tool. It stopped being
sound the moment I added login and multi-user accounts, and I did not revisit it
then — that is the actual defect.

**Fix:** at minimum a crawl mutex returning 409 while one is running. Properly,
key `state` by property id.

### M3 — Log analysis buffers the whole file in a JSON body

The log endpoint receives the file as a JSON string, bounded by
`express.json({ limit: '20mb' })`. A month of logs from a busy site is
comfortably 500MB. It will be rejected, not streamed, and the error will look
like a bug rather than a limit.

**Fix:** accept a multipart upload and stream line-by-line, or accept a path on
disk since the server is local anyway. The parser is already line-oriented, so
only the transport needs changing.

### M4 — 43 catch blocks that discard the error

16 are bare `catch {}`, 27 are `catch { /* comment */ }`. The commented ones are
mostly deliberate and fine. The bare ones hide real failures — a memory write
that fails, a probe that throws for an unexpected reason.

**Fix:** every catch either handles, reports, or carries a comment saying why
silence is correct. No bare ones.

### M5 — `CLIP` grows without bound

`public/app.js:1045` — clipboard payloads accumulate in an array, one entry per
`copyBar()` call, never released. Re-render the findings ledger fifty times and
fifty copies of every ticket are retained. Not a leak that will hurt in a
session; it is unbounded, which is the objection.

**Fix:** cap it, or key by content hash and reuse.

### M6 — Seven moderate npm advisories, all transitive

`qs` (two DoS advisories) and `uuid` (buffer bounds), reached through `express`
and `googleapis`. Not directly exploitable here: the app is localhost-bound and
`qs` is only reached through Express's query parsing.

**Fix:** `npm audit fix` and re-run the suite. Do not use `--force`, which will
try to bump Express across a major version.

*Measured:* `npm audit` → 7 moderate, 0 high, 0 critical

---

## Low

### L1 — `suite.js` at 2,326 lines is the largest file in the project
Assembled by eleven appends. It should be four or five modules —
charts, brand/settings, planning, social, ops. Nothing is wrong with the code;
it is unnavigable.

### L2 — `style.css` is one 640-line file
Tokens, shell, components, panels and responsive rules in one place. It has
already produced one whole-app regression (the lost `box-sizing` reset), which
the stylesheet invariant tests now guard against. Splitting it would reduce the
blast radius of the next edit.

### L3 — Three inline `onclick=` handlers remain in `suite.js`
Everything else uses delegated listeners. These three are inconsistent and
cannot be removed by the cloning in H1, so they are the only listeners that
survive it — which is accidental, not designed.

### L4 — Thin ARIA coverage
`aria-label` ×2, `aria-expanded` ×2, `aria-pressed` ×1 across the markup, with
more added dynamically. Focus management is not handled when panels swap, and
the command palette does not trap focus. Keyboard operation works; screen-reader
operation is untested and probably poor.

---

## What is genuinely sound

Stating this because a defect list is not a fair picture on its own.

- **The test suite earns its keep.** 223 checks, 42 groups, and it has caught
  real bugs repeatedly — the ladder ordering break, the auth lockout, the
  stale-sleep flakiness, the port collision with a real Ollama. Several tests
  assert *why* a behaviour exists, not just that it happens, which is what makes
  them useful a month later.
- **Every module owns its own persistence** and follows the same shape. Adding
  a feature has an obvious template.
- **Dependencies are lean** — 6 direct, and 3 of them optional. `playwright-core`
  drives the user's installed Chrome rather than downloading a browser.
- **Failure messages are actionable.** There is a test asserting error strings
  exceed a length floor, which sounds silly and prevented a lot of `HTTP 400`.
- **Honesty is enforced in code, not convention.** Findings are graded
  observed/inferred, unchecked stages render as unchecked rather than clear, and
  a truncated crawl refuses to report orphan counts. The scraped-SERP path
  carries its own caveat in the payload so a caller cannot present it as Google
  data by accident.

---

## Order I would fix these in

1. **C1** — five minutes, and it is doubling your PageSpeed consumption today.
2. **H4** and **H5** — auth correctness and per-request cost. Same file.
3. **H1** — before any twelfth feature, because it is the thing that will break.
4. **H2** and **M1** — delete the dead code. Pure subtraction, no risk.
5. **H3** — split `runAudit`. The largest change, and the tests make it safe.
6. **M2**, **M3**, then the rest.

The first four are subtraction and correctness, not features. That is usually
the right order after a project has grown this fast.
