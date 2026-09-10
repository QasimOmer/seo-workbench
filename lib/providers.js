/* Free, keyless providers.
   Design rule: the tool must do something useful with an empty .env. Every
   provider here works with no signup. They are also, without exception, less
   reliable than paid equivalents — anonymous tiers are rate-limited and can
   change without notice. So each capability is a CHAIN: try the free options in
   order, and only report failure when all of them are gone. If the user later
   adds a key, that provider joins the front of the chain automatically. */

const UA = 'Mozilla/5.0 (compatible; SEOWorkbench/2.0; +local audit tool)';
const timeout = (ms) => AbortSignal.timeout(ms);

/* ══════════════════════════ text generation ══════════════════════════ */

/** Anthropic, only if a key happens to exist. Front of the chain when present. */
async function anthropicText(system, prompt, maxTokens) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('skip');
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
      max_tokens: maxTokens, system, messages: [{ role: 'user', content: prompt }],
    }),
    signal: timeout(90000),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(j?.error?.message || `Anthropic ${r.status}`);
  return (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim();
}

/** Pollinations, OpenAI-compatible shape. No key. Anonymous tier is rate
    limited, so this is first among the free options but not the only one. */
async function pollinationsChat(system, prompt, maxTokens, model = 'openai') {
  const r = await fetch('https://text.pollinations.ai/openai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
      max_tokens: maxTokens,
    }),
    signal: timeout(90000),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Pollinations chat ${r.status}: ${text.slice(0, 140)}`);
  try {
    const j = JSON.parse(text);
    const out = j.choices?.[0]?.message?.content;
    if (!out) throw new Error('empty');
    return out.trim();
  } catch {
    // Some responses come back as bare text rather than a JSON envelope.
    if (text.trim().length > 20) return text.trim();
    throw new Error('Pollinations chat returned nothing usable');
  }
}

/** The older GET endpoint. Cruder, but it survives when the POST route is busy. */
async function pollinationsPrompt(system, prompt) {
  const full = `${system}\n\n${prompt}`;
  const r = await fetch(`https://text.pollinations.ai/${encodeURIComponent(full.slice(0, 6000))}`, {
    headers: { 'User-Agent': UA }, signal: timeout(90000),
  });
  const text = await r.text();
  if (!r.ok || text.trim().length < 20) throw new Error(`Pollinations prompt ${r.status}`);
  return text.trim();
}

const TEXT_CHAIN = [
  { id: 'anthropic', label: 'Anthropic (your key)', keyless: false, fn: (s, p, m) => anthropicText(s, p, m) },
  { id: 'pollinations-openai', label: 'Pollinations, GPT-class', keyless: true, fn: (s, p, m) => pollinationsChat(s, p, m, 'openai') },
  { id: 'pollinations-mistral', label: 'Pollinations, Mistral', keyless: true, fn: (s, p, m) => pollinationsChat(s, p, m, 'mistral') },
  { id: 'pollinations-get', label: 'Pollinations, plain prompt', keyless: true, fn: (s, p) => pollinationsPrompt(s, p) },
];

export async function generateText(system, prompt, { maxTokens = 2000, json = false } = {}) {
  const tried = [];
  for (const p of TEXT_CHAIN) {
    try {
      const out = await p.fn(system, prompt, maxTokens);
      if (!out) throw new Error('empty response');
      if (!json) return { text: out, provider: p.id, tried };
      return { data: parseLooseJson(out), provider: p.id, tried };
    } catch (e) {
      if (e.message !== 'skip') tried.push(`${p.id}: ${e.message.slice(0, 90)}`);
    }
  }
  throw new Error(`Every free text provider failed. These are anonymous tiers, so this is usually a rate limit that clears in a few minutes. Tried — ${tried.join(' | ')}`);
}

/** Free models wrap JSON in prose and fences far more often than paid ones, so
    the parser has to be forgiving or half the features break on formatting. */
export function parseLooseJson(text) {
  let t = String(text).trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  try { return JSON.parse(t); } catch { /* keep going */ }
  const first = Math.min(...['{', '['].map((c) => { const i = t.indexOf(c); return i < 0 ? Infinity : i; }));
  if (first === Infinity) throw new Error('The model returned prose instead of JSON.');
  const open = t[first], close = open === '{' ? '}' : ']';
  let depth = 0, inStr = false, escaped = false;
  for (let i = first; i < t.length; i++) {
    const ch = t[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === open) depth++;
    else if (ch === close && --depth === 0) {
      const slice = t.slice(first, i + 1);
      try { return JSON.parse(slice); }
      catch { return JSON.parse(slice.replace(/,\s*([}\]])/g, '$1')); }
    }
  }
  throw new Error('The model returned truncated JSON.');
}

/* ══════════════════════════ image generation ══════════════════════════ */

function pollinationsImage(prompt, w, h, seed) {
  const p = encodeURIComponent(`${prompt}. No text, no words, no letters, no watermark, no logo.`);
  return `https://image.pollinations.ai/prompt/${p}?width=${w}&height=${h}&model=flux&nologo=true&seed=${seed ?? Math.floor(Math.random() * 1e6)}`;
}

async function cloudflareImage(prompt) {
  const acct = process.env.CF_ACCOUNT_ID, token = process.env.CF_API_TOKEN;
  if (!acct || !token) throw new Error('skip');
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${acct}/ai/run/@cf/black-forest-labs/flux-1-schnell`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: `${prompt}. No text or lettering.`, steps: 4 }),
    signal: timeout(60000),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || j?.success === false) throw new Error(j?.errors?.[0]?.message || `Cloudflare ${r.status}`);
  if (!j?.result?.image) throw new Error('no image data');
  return `data:image/jpeg;base64,${j.result.image}`;
}

/** Returns a URL the browser fetches directly, which keeps large image bytes
    out of this process entirely. Cloudflare returns a data URI instead. */
export async function generateImage(prompt, w, h, seed) {
  try {
    return { src: await cloudflareImage(prompt), provider: 'cloudflare', direct: false };
  } catch (e) {
    if (e.message !== 'skip') {
      return { src: pollinationsImage(prompt, w, h, seed), provider: 'pollinations', direct: true, note: `Cloudflare failed (${e.message.slice(0, 60)}), used the keyless provider instead.` };
    }
  }
  return { src: pollinationsImage(prompt, w, h, seed), provider: 'pollinations', direct: true };
}

/* ══════════════════════════ position checking ══════════════════════════ */

/* There is no free API that returns Google positions. Search Console gives you
   real positions for queries you already appear on and is always the better
   source. This is the fallback for everything else: a DuckDuckGo result scrape.
   It is a DIFFERENT search engine, so it is a directional proxy for visibility,
   never a Google rank. Everything that surfaces it says so. */

function parseDdg(html, domain) {
  const results = [];
  const re = /<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(html)) && results.length < 30) {
    let href = m[1];
    const redir = href.match(/uddg=([^&]+)/);
    if (redir) href = decodeURIComponent(redir[1]);
    if (!/^https?:/.test(href)) continue;
    const title = m[2].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim();
    results.push({ position: results.length + 1, url: href, title });
  }
  const host = String(domain).replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
  const hit = results.find((r) => r.url.replace(/^https?:\/\//, '').replace(/^www\./, '').startsWith(host));
  return {
    found: !!hit,
    position: hit?.position ?? null,
    url: hit?.url ?? null,
    top: results.slice(0, 10),
    engine: 'DuckDuckGo',
    caveat: 'DuckDuckGo, not Google. Useful as a directional signal for whether you are visible at all; not a Google position. Connect Search Console for real Google positions on queries you already rank for.',
  };
}

/* Google has no free API and actively blocks scrapers. Implemented because it
   is the engine that matters, but it will fail more often than it works — the
   UI says so, and DuckDuckGo stays the default. */
function parseGoogle(html, domain) {
  const results = [];
  const re = /<a[^>]+href="\/url\?q=([^&"]+)[^"]*"[^>]*>|<a[^>]+href="(https?:\/\/[^"]+)"[^>]*><(?:h3|br)/g;
  let m;
  const seen = new Set();
  while ((m = re.exec(html)) && results.length < 30) {
    let href = m[1] ? decodeURIComponent(m[1]) : m[2];
    if (!href || !/^https?:/.test(href)) continue;
    if (/google\.|gstatic|googleusercontent|\/search\?/.test(href)) continue;
    const norm = href.split('#')[0];
    if (seen.has(norm)) continue;
    seen.add(norm);
    results.push({ position: results.length + 1, url: norm, title: '' });
  }
  return finishPosition(results, domain, 'Google', 'Scraped from Google\'s HTML, which Google works to prevent. Expect this to fail or return nothing much of the time — Search Console is the only reliable source of Google positions.');
}

function finishPosition(results, domain, engine, caveat) {
  const host = String(domain).replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
  const hit = results.find((r) => r.url.replace(/^https?:\/\//, '').replace(/^www\./, '').startsWith(host));
  return {
    found: !!hit, position: hit?.position ?? null, url: hit?.url ?? null,
    top: results.slice(0, 10), engine, caveat,
  };
}

const ENGINES = {
  duckduckgo: {
    label: 'DuckDuckGo',
    url: (q) => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`,
    parse: parseDdg,
  },
  google: {
    label: 'Google (scraped, unreliable)',
    url: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}&num=30`,
    parse: parseGoogle,
  },
};

export const engineList = () => Object.entries(ENGINES).map(([key, e]) => ({ key, label: e.label }));

export async function checkPositionOn(query, domain, engine = 'duckduckgo') {
  const e = ENGINES[engine] || ENGINES.duckduckgo;
  const r = await fetch(e.url(query), {
    headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
    signal: timeout(20000),
  });
  if (!r.ok) throw new Error(`${e.label} returned ${r.status}. Scraped endpoints break without notice — this is the fragile part of the free stack.`);
  const out = e.parse(await r.text(), domain);
  if (!out.top.length) throw new Error(`${e.label} returned no parseable results — the markup has probably changed, or the request was throttled.`);
  return { query, domain, ...out };
}

export async function checkPosition(query, domain) {
  const r = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
    signal: timeout(20000),
  });
  if (!r.ok) throw new Error(`DuckDuckGo returned ${r.status}. Scraped endpoints break without notice — this is the fragile part of the free stack.`);
  const html = await r.text();
  const out = parseDdg(html, domain);
  if (!out.top.length) throw new Error('Could not parse any results. DuckDuckGo has probably changed its markup, or the request was throttled.');
  return { query, domain, ...out };
}

export { parseDdg as _parseDdg, parseGoogle as _parseGoogle };

/* ══════════════════════════ diagnostics ══════════════════════════ */

/** Pings every provider and reports what actually works, from wherever the tool
    is running. Networks differ, anonymous tiers throttle by IP, and hosts get
    blocked — so the only trustworthy answer comes from the user's own machine. */
/**
 * Diagnostics, rebuilt to be self-explaining.
 *
 * The old version ran every probe with long timeouts and returned one blob, so
 * a single slow call made the whole board look dead and told you nothing about
 * which layer failed. This version:
 *   - checks the layers in order (DNS, then TLS, then each API), so a failure
 *     names the layer rather than the feature
 *   - uses short timeouts, because a probe that takes 70 seconds is a failure
 *     for diagnostic purposes even if it eventually succeeds
 *   - reports the HTTP status and the service's own message verbatim
 *   - produces a copyable plain-text report, since the useful thing to do with
 *     a broken board is send it to someone
 */
export async function runDiagnostics({ deep = false } = {}) {
  const checks = [];
  const t = async (name, layer, detail, fn, ms = 12000) => {
    const t0 = Date.now();
    try {
      const info = await Promise.race([
        fn(),
        new Promise((_, rej) => setTimeout(() => rej(new Error(`No response within ${ms / 1000}s. Treating that as a failure — a probe this slow is unusable even if it would eventually answer.`)), ms)),
      ]);
      checks.push({ name, layer, detail, ok: true, ms: Date.now() - t0, info });
    } catch (e) {
      checks.push({ name, layer, detail, ok: false, ms: Date.now() - t0, error: String(e.message).slice(0, 320) });
    }
  };

  /* Layer 1: can this machine reach the internet at all? Everything below is
     meaningless if this fails, and this is the fastest thing to check. */
  await t('Internet', 'network', 'Plain outbound HTTPS from this machine', async () => {
    const r = await fetch('https://example.com', { headers: { 'User-Agent': UA }, signal: timeout(8000) });
    if (!r.ok) throw new Error(`example.com returned HTTP ${r.status}. Something is intercepting outbound requests — a proxy, VPN or corporate filter.`);
    return 'Outbound HTTPS works.';
  }, 10000);

  await t('Google reachable', 'network', 'Whether googleapis.com resolves and answers', async () => {
    const r = await fetch('https://www.googleapis.com/discovery/v1/apis?name=pagespeedonline', { signal: timeout(8000) });
    if (!r.ok) throw new Error(`googleapis.com returned HTTP ${r.status}.`);
    return 'googleapis.com answers.';
  }, 10000);

  /* Layer 2: each API, reported with its own error text. */
  const key = process.env.GOOGLE_API_KEY;

  await t('PageSpeed Insights', 'google', key ? 'With your API key' : 'Keyless — about 25 requests a day', async () => {
    const u = new URL('https://www.googleapis.com/pagespeedonline/v5/runPagespeed');
    u.searchParams.set('url', 'https://example.com');
    u.searchParams.set('strategy', 'mobile');
    u.searchParams.set('category', 'seo');   // one category is far faster than all five
    if (key) u.searchParams.set('key', key);
    const r = await fetch(u, { signal: timeout(45000) });
    const raw = await r.text();
    let j = null;
    try { j = JSON.parse(raw); } catch { /* not JSON */ }
    if (!r.ok) {
      const m = j?.error?.message || `HTTP ${r.status}`;
      if (/API key not valid|API_KEY_INVALID/i.test(m)) throw new Error(`The key is rejected: ${m}`);
      if (/expired/i.test(m)) throw new Error(`${m} — this is what Google says when a key has been deleted or regenerated. The key this server is holding may not be the one you just created; check the last four characters in Setup & keys.`);
      if (/has not been used|SERVICE_DISABLED|is disabled/i.test(m)) throw new Error(`${m} — enable "PageSpeed Insights API" in the Library for that project.`);
      if (r.status === 429) throw new Error('Quota exhausted for today. Keyless is about 25 a day; a key lifts it.');
      throw new Error(m);
    }
    if (!j) throw new Error(`HTTP ${r.status} but the body was not JSON — a proxy or filter intercepted it.`);
    return key ? 'Working, with your key.' : 'Working keyless. Add a key to remove the daily cap.';
  }, 50000);

  await t('Chrome UX Report', 'google', 'Needed for six-month performance trends', async () => {
    if (!key) throw new Error('No GOOGLE_API_KEY. This is the one feature with no keyless path — the charts fall back to a current snapshot from PageSpeed, which does work without a key.');
    const r = await fetch(`https://chromeuxreport.googleapis.com/v1/records:queryHistoryRecord?key=${encodeURIComponent(key)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ origin: 'https://web.dev', formFactor: 'PHONE', metrics: ['largest_contentful_paint'] }),
      signal: timeout(20000),
    });
    const raw = await r.text();
    let j = null;
    try { j = JSON.parse(raw); } catch { /* not JSON */ }
    if (!r.ok) {
      const m = j?.error?.message || `HTTP ${r.status}`;
      if (/SERVICE_DISABLED|has not been used/i.test(m)) throw new Error(`${m} — this is a SEPARATE API from PageSpeed. Enable "Chrome UX Report API" on the same project.`);
      if (/API key not valid/i.test(m)) throw new Error(`The key is rejected: ${m}`);
      throw new Error(m);
    }
    return 'Working. Six-month trend charts are available.';
  }, 25000);

  await t('Search Console', 'google', 'OAuth, for real clicks and positions', async () => {
    const hasClient = (process.env.GSC_CLIENT_ID || process.env.GOOGLE_CLIENT_ID) &&
                      (process.env.GSC_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET);
    if (!hasClient) {
      throw new Error('No OAuth client configured. You do not need it — Search Console → Export → CSV gives the same data with no setup, and the importer reads it.');
    }
    return 'OAuth client configured. Connect a property in the Search Console panel to finish.';
  }, 5000);

  /* Layer 3: the free stack. */
  await t('Text generation', 'ai', 'Powers fixes, briefs and captions', async () => {
    // The provider registry moved to llm.js; import it here rather than
    // holding a stale reference.
    const { survey } = await import('./llm.js');
    const s = await survey({ force: true });
    const up = s.providers.filter((p) => p.available);
    if (!up.length) throw new Error(`No provider reachable. ${s.providers.map((p) => `${p.id}: ${p.reason}`).join(' | ').slice(0, 220)}`);
    return `${up.length} reachable — using ${up[0].id} (${up[0].model}).`;
  }, 20000);

  await t('Image generation', 'ai', 'Social post backgrounds', async () => {
    const { src, provider } = await generateImage('a calm abstract gradient', 256, 256, 1);
    if (provider === 'local') return 'Local procedural artwork — always available, no network needed.';
    const r = await fetch(src, { signal: timeout(25000) });
    if (!r.ok) throw new Error(`Image host returned HTTP ${r.status}.`);
    const buf = await r.arrayBuffer();
    if (buf.byteLength < 2000) throw new Error('Returned a file too small to be an image.');
    return `${Math.round(buf.byteLength / 1024)}KB from ${provider}.`;
  }, 30000);

  await t('Keyword suggestions', 'free', 'Google Autocomplete, no key', async () => {
    const r = await fetch('https://suggestqueries.google.com/complete/search?client=chrome&q=seo', { signal: timeout(10000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}. This is an undocumented endpoint and is blocked on some networks.`);
    return `${(JSON.parse(await r.text())[1] || []).length} suggestions.`;
  }, 12000);

  await t('Rendered crawling', 'local', 'Your own Chrome, for JS sites and quota-free vitals', async () => {
    const { probe } = await import('./render.js');
    const info = await probe({ force: true });
    if (!info.available) throw new Error(info.reason);
    return `${info.channel} ${String(info.version).split('.')[0]}.`;
  }, 20000);

  await t('Microsoft Clarity', 'clarity', 'Rage clicks, dead clicks, script errors', async () => {
    const { configured, budget } = await import('./clarity.js');
    if (!configured()) throw new Error('No CLARITY_API_TOKEN. Clarity → Settings → Data Export → Generate new API token.');
    const b = await budget();
    return `Token present. ${b.remaining} of ${b.cap} calls left today.`;
  }, 8000);

  if (deep) {
    await t('Position check', 'free', 'DuckDuckGo scrape — directional only', async () => {
      const out = await checkPosition('example domain', 'example.com');
      return `${out.top.length} results parsed.`;
    }, 20000);
  }

  const byLayer = {};
  for (const c of checks) (byLayer[c.layer] ||= []).push(c);

  const net = checks.filter((c) => c.layer === 'network');
  const netDown = net.length && net.every((c) => !c.ok);
  const core = checks.filter((c) => ['Internet', 'Text generation', 'Rendered crawling'].includes(c.name));

  /* A plain-text report, because the useful thing to do with a broken board is
     paste it to someone who can read it. */
  const report = [
    `SEO Workbench diagnostics — ${new Date().toISOString()}`,
    `node ${process.version} on ${process.platform}`,
    `GOOGLE_API_KEY: ${process.env.GOOGLE_API_KEY ? `set, ending ${process.env.GOOGLE_API_KEY.slice(-4)}` : 'not set'}`,
    `GSC OAuth: ${(process.env.GSC_CLIENT_ID || process.env.GOOGLE_CLIENT_ID) ? 'configured' : 'not configured'}`,
    `CLARITY_API_TOKEN: ${process.env.CLARITY_API_TOKEN ? 'set' : 'not set'}`,
    '',
    ...checks.map((c) => `[${c.ok ? ' OK ' : 'FAIL'}] ${c.name} (${c.layer}, ${c.ms}ms)` + '\n         ' + (c.ok ? c.info : c.error)),
  ].join('\n');

  return {
    checks, byLayer,
    healthy: core.every((c) => c.ok),
    summary: `${checks.filter((c) => c.ok).length} of ${checks.length} working`,
    verdict: netDown
      ? 'This machine cannot reach the internet at all. Every other failure below is a consequence of that, not a separate problem — check a proxy, VPN or firewall before anything else.'
      : core.every((c) => c.ok)
        ? 'Core services are up. Crawling, auditing and the offline fixes all work; anything red below is an optional extra.'
        : 'Something core is down. Work through the failures in layer order — network first, then the APIs.',
    report,
  };
}

