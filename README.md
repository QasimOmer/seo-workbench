# SEO Workbench

A local tool that runs the seo-canon audit playbook end to end: crawl a site, get
findings in the canon's own format ordered by the priority ladder, then generate
the artefacts that fix them — titles, schema, redirect maps, robots.txt, briefs,
Azure DevOps tickets.

Works on any website — WordPress, Shopify, Next.js, Webflow, a hand-written
static site. It detects the stack and adapts the advice, but every finding is
stack-independent: a missing H1 is a missing H1 anywhere.

Runs on your machine. No account, no SaaS seat, no per-crawl billing, and no API
keys required.

---

## Monitoring

Add a site, pick a schedule, and it re-crawls and reports **only what changed**.
Alerts fire on regressions at Critical/High, never on known state — a monitor
that reports problems you've already accepted gets muted, and a muted monitor
is worse than none. It also catches structural shifts the finding list would
miss: crawlable pages collapsing, `noindex` counts rising, errors appearing.

Schedules run in-process, so they only fire while the server is up. Leave it
running or install it as a service.

## Intent match — stage 3

The stage that used to read **unchecked**, because it genuinely cannot be
inferred from a page in isolation. On the Pages panel, give it the query a page
targets and it opens a live Google SERP in your Chrome, classifies the top ten
by page type, and compares that against what your page is.

A service page targeting a query whose SERP is entirely guides will not rank
however well it is optimised. That verdict is the point — it's why the stage
sits above titles and headings in the ladder.

It also reads SERP features and changes the advice accordingly: a local pack
means proximity and Google Business Profile matter more than page content; a
featured snippet means answer the question in the first two sentences.

**This is the most fragile feature in the tool.** Google works against
automated reading, so expect CAPTCHAs and occasional parser breaks. It fails
loudly with an explanation and never substitutes a guess. Batch mode is paced
several seconds apart and capped at six queries — keep it to the queries that
matter rather than running a keyword list through it.

## Search Console without OAuth

Two routes, and the quick one needs no setup at all:

1. **CSV import.** In Search Console open **Performance**, set your date range,
   **Export → Download CSV**, unzip, and drop the files into the Search Console
   panel. That's Google's own data — identical to what the API returns for the
   same window — with no Cloud project, no consent screen, no client secret.
   Handles the ZIP's separate files, localised column headers, thousands
   separators and decimal-comma CTRs. You get striking distance, CTR gaps,
   cannibalisation and the clicks timeline immediately.
2. **OAuth**, if you want live refresh and URL Inspection. Setup in
   `.env.example`.

## Rendered crawling

Tick **Render JavaScript** on the crawl form and it drives your installed Chrome
via `playwright-core` — no browser download. Two gaps close at once:

- **Client-rendered sites.** Without it, a React or Vue app is an empty
  `<div id="root">` and the audit can only say "no content in the HTML source".
  True, but it can't audit the page users actually get. **Check render gap**
  compares source against rendered and tells you whether rendering is needed
  before you commit to the slower crawl.
- **Performance with no quota.** Vitals are measured in-page with
  PerformanceObserver — LCP, CLS, FCP, TTFB, long tasks. No key, no daily limit,
  which was the practical problem with PageSpeed. Lab numbers from one load on
  your machine: a debugging trail, not a substitute for CrUX field data.

If no Chrome is drivable the checkbox disables itself and says why.

## Sign-in

Off by default — nothing changes until you turn it on in **Setup & keys**. Once
on, it's real: scrypt hashing (N=2^15, ~90ms per attempt), server-side sessions,
HttpOnly SameSite=Strict cookies, timing-safe comparison, no user enumeration,
and lockout after eight failures keyed on username *and* IP together.

**The boundary, stated plainly.** A session cookie over plain HTTP can be read
by anyone on the network path. On loopback that path is your own machine, so
login there protects against someone else using your computer — not against
network attackers. The moment this is reachable from other machines it needs
HTTPS, and the tool detects that case and says so in red rather than letting you
assume you're covered.

There is no password reset. If you lose the owner password, delete
`data/auth.json` and set it up again. That's a deliberate trade for a tool with
no email delivery — a reset mechanism without email is a back door.

## Behaviour — Microsoft Clarity

Rage clicks, dead clicks, script errors, quickbacks, excessive scrolling and
scroll depth from real sessions. This is the data the SEO side cannot see: a
rage-click cluster explains a conversion problem that rankings and Core Web
Vitals never will, and a script error is an SEO problem too if the failing
script renders content.

Token from **clarity.microsoft.com → your project → Settings → Data Export →
Generate new API token**.

Two constraints from Clarity's API shape the panel: **ten calls per project per
day**, and **three days of history maximum**. So responses are cached for six
hours, the remaining budget is shown before you spend a call, and nothing here
claims to be a trend — it is a recent snapshot, and the panel says so.

## When something says it isn't working

**System check** now probes in layer order — can this machine reach the internet
at all, then does googleapis answer, then each API individually — with short
timeouts, because a probe taking 70 seconds is a failure for diagnostic purposes
even if it would eventually answer. Each check reports the service's own error
verbatim, and there's a copyable plain-text report at the bottom.

The point of the layering: if the network is down, one line says so instead of
ten unrelated-looking failures. And Chrome UX Report is called out as a
*separate* API from PageSpeed, which is the most common half-configured state.

## When a key "doesn't work"

Two things about `.env` that are invisible until they bite:

- It's read **only when the server starts**. Editing the file while it's running
  changes nothing until you restart.
- A variable already set in your **shell** takes precedence over the file, and
  dotenv will not replace it. If you once ran `$env:GOOGLE_API_KEY="..."` in a
  PowerShell window, every server started from that window ignores `.env`.

The second one produces the worst dead end: a correct new key sitting in the
file while the process quietly uses the old one. **Setup & keys** now shows the
last four characters of the key actually in use, flags it in red when the file
disagrees, and has a **Test the key in use** button that asks Google about that
specific value and reports the answer verbatim.

If it says the key ends in something you don't recognise, that's the whole
diagnosis.

## QA

```bash
npm test
```

239 checks: unit tests over every module with real logic, then a live HTTP pass
across the whole API against two local fixture sites — one deliberately broken,
one deliberately well built. It boots the server itself, needs no network beyond
localhost, and asserts the things that actually went wrong in this project:
that findings order by ladder then severity, that a clean site produces almost
nothing, that a capped crawl refuses to claim orphans, that no fix proposes a
hostname or a site-wide string as a page's subject, that the generated CSP is
emitted once, and that every advertised schema type builds.

Run it after any change. Every bug in this project was found by running it, not
by reading it.

## Setup

```bash
npm install
npm start        # → http://localhost:4321
```

That's it. Node 18.17+, no API keys, no accounts, no config file.

**Nothing here needs the internet except the site you're crawling.**

- Crawling and all 40+ audit rules run locally.
- **Fixes are computed from your crawl**, not written by a model — 20 of 22
  findings on the test site produce concrete corrections: rewritten titles,
  canonical tags, corrected robots.txt, HTTPS rewrite rules, collapsed redirect
  chains, internal-link plans, JSON-LD. Offline, instantly, every time.
- Social artwork is generated on your machine — six procedural styles from your
  brand colour, composed with real typography at exact platform sizes.
- Content briefs are templated locally from the topic's search intent.

**Text models, in this order:** any local model first (Ollama or LM Studio —
no key, no quota, and nothing you audit leaves your machine), then whichever
keyed provider you have (Claude, Gemini, Groq, OpenRouter, Cloudflare), then
Pollinations, which needs no key at all. If one fails mid-request the next takes
over and the UI tells you which model answered — worth knowing, since a draft
from a local 7B deserves more scrutiny than one from Claude.

The privacy point is the real reason local comes first: drafting a fix sends
page content to the model. For client work, keeping that on your own machine
matters more than a few points of output quality. `ollama pull qwen2.5:14b` and
you are done.

AI is an optional upgrade, not the engine. Every AI button falls back to the
local path automatically and tells you it did. **System check** in the sidebar
tests what's reachable from your machine.

Two optional keys buy real upgrades:

| Without config | You still get |
| --- | --- |
| `GOOGLE_API_KEY` | Six months of weekly performance trends instead of today's snapshot, and no PageSpeed rate limit |
| Search Console OAuth | Real Google positions, clicks and impressions — replaces the DuckDuckGo visibility estimate |
| Any model key | Better writing than the keyless option. See Setup → Text models |
| `ANTHROPIC_API_KEY` | Better writing. Joins the front of the provider chain; the free models still work without it |
| Cloudflare Workers AI | Steadier image generation than the keyless provider |

All crawling, all checks and all scoring are deterministic. Nothing that
produces a finding depends on an LLM.

### Search Console access

The Search Console tab needs an OAuth client. Fifteen minutes, once:

1. [console.cloud.google.com](https://console.cloud.google.com) → create or pick a project
2. **APIs & Services → Library** → enable **Google Search Console API**
3. **OAuth consent screen** → External → add your own Google account under **Test users**. Leave it in Testing mode; personal use doesn't need Google's verification.
4. **Credentials → Create credentials → OAuth client ID → Web application**
5. Authorised redirect URI, exactly: `http://localhost:4321/api/gsc/callback`
6. Put the client ID and secret in `.env`
7. Restart, open the Search Console tab, click **Connect**

The Google account you authorise needs read access to the property. Tokens land
in `.tokens.json`, which is gitignored — treat it as a credential.

---

## Getting around

The left rail is the priority ladder — the eight stages the canon says to diagnose
in order, each showing how many findings sit at that stage. Click a rung to see
just those findings. Stages a crawl can't assess (intent, off-page, and
performance until you run a test) show as **unchecked** rather than clear,
because a stage nobody looked at is not a stage that passed.

Sites you crawl are remembered. The switcher at the top moves between them and
restores that site's last crawl, so you can look at findings for one client
without re-crawling another. Removing a property deletes its cached crawl too.

## The sections

**Brand context** — fill this in first. Every AI draft in the tool reads from it:
services, locations, audience, voice, true differentiators, words to never use,
compliance rules. Leave it empty and the model invents a voice, which is why
most AI copy reads the way it does. Once you've crawled, "Read it from the site"
proposes most of the fields from your own pages so you edit rather than type.

**Trends on the overview** — three sources, kept apart because they mean
different things. CrUX history is real Chrome users, weekly, six months, with
pass/fail bands drawn behind the line. Search Console is Google's own record of
your clicks, impressions and position, with a plain-language read of the shape —
the clicks-down-impressions-flat case gets named for what it is. Your own
Lighthouse runs are logged separately and labelled lab data, because that's all
they are.

**Plan** — your findings sequenced into dated weeks at whatever effort capacity
you set. The order is the ladder; effort only breaks ties inside a stage. Tick
items off and it persists.

**Social posts** — copy per platform at the right dimensions, plus artwork. The
background is AI-generated; the type is composed as SVG in real fonts. That's
deliberate: image models can't spell, so anything with a headline baked into the
generation comes back garbled. This way the text is sharp and you can edit the
words without paying for another image.

**Security headers** — HSTS, CSP, framing, MIME-sniffing, referrer and
permissions policy, cookie flags, and version disclosure, graded A–F on a
weighted score rather than a count, because "7 of 9 present" tells you nothing
about whether the two missing ones matter. Generates one merged Apache or nginx
block covering every gap. Kept out of the SEO ladder deliberately: only HSTS and
a badly scoped CSP touch search directly, but a compromised site loses rankings
in a way on-page work cannot recover. All computed from headers the crawl
already collected — no extra requests.

**Summarise text** (in Build) — extractive, so every sentence is taken verbatim
from the source and nothing can be invented. Produces a summary plus a
ready-to-use meta description. Reads less smoothly than a rewrite; safe to put
in front of a client without fact-checking.

**Campaigns** — name a goal in numbers, record the baseline before you start,
then movement is measurable instead of arguable.

**Overview** — leads with which stage the site breaks at, then the three things to
do first, then the dashboard.

**Dashboard** — nine charts computed from the crawl, so they populate the moment
it finishes: click depth, response codes, title width in real pixels, content
depth, internal links per page, server response percentiles, indexability,
findings by diagnostic stage (stacked by severity), and structured-data
coverage. Each one carries the sentence you'd say looking at it, because a
histogram nobody can read is decoration. The field-data charts below it need
Google's free key; these never do.

**Crawl settings** — BFS from a seed URL, so click depth is measured rather than
guessed. Googlebot-smartphone UA, robots.txt honoured (with proper longest-match
Allow/Disallow precedence), redirect chains captured hop by hop, sitemap and
sitemap-index recursion, inbound link graph built as it goes. Concurrency and
delay are configurable — mind them on client production sites.

**Fix this / Improve with AI** — every finding has a "Fix this" button that
computes the correction from crawl data with no network. "Improve with AI" asks
a model for better prose and quietly falls back to the offline fix if the free
providers are busy. Anything the tool genuinely can't decide for you — which of
two near-duplicates to keep, who the author is — says so instead of inventing
an answer.

**The eight rungs** — 55+ rules across playbook phases 1–6, each rendered in the canon's
shape: Where / What / Why it matters / Fix / Owner / Effort. Ordered by the
priority ladder, not by how many pages a thing affects, so an eligibility problem
on one page outranks a title-length nit on two hundred. Every finding is graded
`observed` or `inferred` so you know what you can say to a client.

Fifteen of these catch things that are either **silent** — invisible in the page
source, so nobody finds them by looking — or **systemic**, meaning a
template-level mistake repeated sitewide:

- `X-Robots-Tag: noindex` in a response header. Invisible in the HTML, which is
  where everyone looks first. This used to be reported as "not checked".
- A canonical in the `Link` header disagreeing with the one in the HTML.
- Canonical chains — A canonicalises to B which canonicalises to C.
- Paginated pages canonicalising back to page one, which stops Google crawling
  page three and everything only linked from it.
- hreflang validated properly at last: missing self-references, non-reciprocal
  return tags, and invalid codes (`en-UK` is not a thing — the country code is
  `GB`).
- Meta-refresh redirects, parameter and facet crawl traps, sitemaps listing
  noindexed or canonicalised URLs, internal links pointing at pages that cannot
  be indexed, excessive link counts, render-blocking resource counts, and
  `@font-face` without `font-display`.

Plus the checks that were already here: the `noindex` + `Disallow` trap,
canonicals pointing at 404s or redirects, near-duplicate pages at 85% shingle
overlap, orphans (in the sitemap, not in the link graph), soft 404s, redirect
chains, index bloat, and YMYL pages with no named author.

**Speed** — CrUX field data and Lighthouse lab data rendered as separate things
and labelled as such, because one is what Google uses and the other is a
debugging aid. Failing lab audits are listed as leads, not as findings.

**Search Console** — period-on-period and year-on-year, cannibalisation from the
query×page export (the provable kind, not the guessed kind), striking-distance
queries, CTR gaps against a position curve, the 7-step traffic-drop triage in the
playbook's order, and batched URL Inspection — which is how you read Google's
*chosen* canonical instead of assuming yours won.

**Build** — title and meta drafts fitted to pixel width rather than character
count; eight JSON-LD builders that validate required properties before you ship
them; an internal-link opportunity finder that reads your own crawl for unlinked
mentions; a redirect map generator (`.htaccess` / nginx / Redirection CSV) with
live one-hop testing; robots.txt and sitemap generators; content briefs.

**Ship** — pre-launch checklist, crawl-to-crawl snapshot diffing, and exports:
findings as Markdown, crawl as CSV, and an Azure DevOps work-item CSV with
testable acceptance criteria per finding, ready to import.

---

## AI visibility (GEO / AEO)

Runs your prompts through every reachable model and measures whether you are
**named**, whether your domain is **cited**, and how share of voice divides
between you and everyone else the model mentions.

Two distinctions the category gets right and this keeps:

- **Named is not cited.** A model saying "Acme" is not the same as it linking
  acme.com as a source. The second sends traffic; the first only shapes
  perception. The score weights a citation at 40 points and a mention at 60
  weighted by position, so they never collapse into one number.
- **Runs, not days.** There is no ranking to poll — each run samples a
  stochastic system, and two runs on one day will differ. The unit of time is
  the run and the UI says so.

Share of voice counts every brand the model named, not just competitors you
listed, because omitting the ones you forgot flatters you. Click any prompt row
to read the actual answers — a score with no text behind it isn't actionable.

**What it can't tell you:** this measures the models *this tool* can reach,
which is not the set your customers use. A local Llama's opinion of your brand
is a weak proxy for ChatGPT's. Sentiment is lexicon-based, not a model. A single
run is an anecdote. All of that is stated in the panel, not just here.

## Server logs

The only dataset here that beats a paid subscription, because it's your
server's own record rather than a model of it. A crawl proves a page is
reachable; only the log proves Google bothered to fetch it.

Detects combined (Apache/nginx), IIS W3C and JSON lines from a CDN
automatically, and tolerates malformed rows rather than rejecting a file for
twelve bad lines in two million.

What it tells you that nothing else can:

- **Crawl budget waste** as a share, not a vague warning — how much went on
  4xx, on redirects, and on parameter URLs. This is where the parameter problem
  becomes a number you can take to a client.
- **Pages Googlebot never requested**, cross-referenced against your crawl and
  sorted by inbound internal links, because that's almost always the cause. A
  crawl cannot tell you this at all.
- **URLs Googlebot requests that your crawl never found** — genuine orphans with
  external links, or URLs it remembers from before a migration.
- **Spoofed Googlebot.** A user agent is trivially forged and scrapers routinely
  impersonate Googlebot. Hits from outside Google's published ranges are flagged
  first, because every other conclusion is wrong if the log is full of fakes.
  The check is an IP-prefix approximation and says so — the definitive method is
  a reverse then forward DNS lookup, and the fix text gives you the commands.

Nothing leaves your machine: the file is parsed in-process and never stored.

## Competitors

Crawl a competitor and compare how the two sites are built. Their HTML is
public, so this needs no subscription and no API — which makes it the one piece
of competitive intelligence you can get without paying for an index.

It compares schema coverage and the specific types they use, click depth,
top-level sections, content depth, internal linking density, author and
breadcrumb markup, and server response. Gaps are phrased as decisions rather
than differences, ordered by severity, and it also reports **where you are
ahead** so you know what not to spend effort on.

The section comparison is the closest a crawl gets to a content gap: a
top-level section carrying several pages is a topic they decided to invest in.
Verify against the live SERP before copying — their having it doesn't prove it
works.

Only the aggregate profile is stored, never their pages.

## Can this replace Ahrefs or Semrush?

No, and it's worth being clear why, because it isn't a feature gap.

Those are data businesses, not software. Four things they sell cannot be
reproduced locally at any level of effort:

- a **backlink index**, which needs continuous web-scale crawling
- **keyword volume and difficulty**, which come from clickstream panels
- **historical SERP data**, which means scraping millions of SERPs daily for years
- **competitor traffic estimates**, from those same panels

That's most of what the subscription buys. What this tool competes with is
Screaming Frog and Sitebulb — technical audit tools — and against those it does
two things they don't attempt: it orders findings by what gates what, and it
computes the correction instead of describing it.

The sensible arrangement is one paid seat somewhere for the index data, and this
for everything else.

## What it can't do, and why

Three gaps worth naming rather than papering over:

**No search volume, and no live SERP.** There is no free source for either. The
playbook is emphatic that clustering should be done by SERP overlap — if two
queries return the same URLs, they're one page. Nothing free returns those URLs.
The tool offers two labelled proxies instead: autocomplete co-occurrence (weak),
and grouping by the landing page Search Console already reports (strong, because
it's Google's own choice of page). Both are marked as proxies in the UI. Don't
promote them to fact in a client deck.

**Google positions.** Search Console is the only reliable source, and it only
covers queries you already appear on. The Visibility panel offers DuckDuckGo
(works, different index) and Google (scraped, and Google actively prevents this
— expect it to fail often). Both are labelled. Neither is a substitute for
Search Console.

**No rank tracking for keywords you don't already rank for.** Search Console
gives you real average position for queries you appear on, and that's the honest
source — it's Google's own data. But there's no free API that returns "where do I
rank for X" on demand, so the tool doesn't pretend to. Anything labelled position
here comes from your own Search Console.

**Image generation is the weakest free link.** Pollinations needs no key and
works immediately, but it's rate-limited with no uptime guarantee. Cloudflare
Workers AI has a real free daily allowance and is far steadier, but wants an
account ID and token. Neither can render text — hence the SVG composition.

**AI drafts, it never decides.** Findings come from the deterministic rule set.
The AI only writes the fix, and every draft says so. Read it before it ships.

**No backlink index.** Ahrefs and Semrush are the product here and they don't
give it away. The off-page section is a worksheet, not a number.

**Keyword expansion uses an unofficial endpoint.** Google's autocomplete isn't a
documented API. It works, it's what every free tool uses, and it can break or be
blocked without notice. The tool tells you when that happens instead of
returning a silent zero.

---

## Layout

```
server.js          API + static host
lib/
  properties.js    the property registry and per-site crawl cache
  brand.js         brand context — read by every AI call
  trends.js        CrUX history, GSC time series, PSI run log
  ai.js            fixes, content, social copy, brand inference
  social.js        image providers + SVG post composition
  program.js       campaigns and the sequenced plan
  security.js      security-header grading and config generation
  insights.js      dashboard chart data, computed from the crawl
  llm.js           text-provider registry — local first, then keyed, then keyless
  render.js        rendered crawling and quota-free vitals via your own Chrome
  monitor.js       scheduled re-crawls, regression diffing, alert rules
  summarize.js     extractive summarizer, no model
  crawler.js       BFS queue, concurrency, politeness
  fetcher.js       HTTP, redirect chains, robots.txt
  parse.js         cheerio extraction → page model
  audit.js         the core rule set — the substance of the tool
  aivis.js         AI visibility: named vs cited, share of voice, per-prompt trends
  logs.js          server log parsing and crawl-budget analysis
  competitor.js    crawl a competitor and compare how the sites are built
  audit-extra.js   silent and systemic checks: headers, hreflang, pagination, facets
  psi.js           PageSpeed Insights + CrUX
  gsc.js           OAuth, Search Analytics, URL Inspection
  keywords.js      autocomplete expansion + clustering
  generate.js      titles, schema, redirects, robots, sitemaps, briefs
test/
  run.mjs          the QA suite — npm test
public/
  app.js           shell, crawl, findings, pages, build, ship
  suite.js         charts, brand, plan, social, campaigns
  style.css        one stylesheet, design tokens at the top
data/              properties, cached crawls, snapshots (gitignored)
```

`lib/audit.js` is where the opinions live. If you disagree with a threshold,
it's one file and the rules are plain functions.
