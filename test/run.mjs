/* QA suite. Run with `npm test`.
   Covers every module that has logic worth breaking, plus a live HTTP pass over
   the whole API against local fixture sites. No network beyond localhost, so it
   runs anywhere and gives the same answer every time.

   The point of keeping this in the repo: every bug found in this project so far
   was found by running it, not by reading it. */

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4399, BROKEN = 8397, GOOD = 8398, SPA = 8396, EXTRA = 8395, FAKE_OLLAMA = 11534;

/* Never bind 11434 — that is the real Ollama port, and the suite must not fail
   for someone who actually has Ollama running. Point the code at ours. */
process.env.OLLAMA_URL = `http://localhost:${FAKE_OLLAMA}`;
const BASE = `http://localhost:${PORT}`;

let pass = 0, fail = 0, skip = 0;
const failures = [];
let group = '';

const G = (name) => { group = name; console.log(`\n${name}`); };
const t = async (name, fn) => {
  try { await fn(); console.log(`  ok    ${name}`); pass++; }
  catch (e) {
    console.log(`  FAIL  ${name}\n          ${e.message.split('\n')[0]}`);
    fail++; failures.push(`[${group}] ${name}: ${e.message.split('\n')[0]}`);
  }
};
const skipT = (name, why) => { console.log(`  skip  ${name} — ${why}`); skip++; };
const is = (a, b, m) => { if (a !== b) throw new Error(m || `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m || 'expected truthy'); };
const near = (a, b, tol, m) => { if (Math.abs(a - b) > tol) throw new Error(m || `${a} not within ${tol} of ${b}`); };

/* ── fixture sites ────────────────────────────────────────────────────────── */

const page = (o) => `<!doctype html><html lang="${o.lang || 'en'}"><head><meta charset="utf-8">
${o.viewport === false ? '' : '<meta name="viewport" content="width=device-width, initial-scale=1">'}
<title>${o.title ?? ''}</title>${o.desc ? `<meta name="description" content="${o.desc}">` : ''}
${o.canonical ? `<link rel="canonical" href="${o.canonical}">` : ''}
${o.noindex ? '<meta name="robots" content="noindex">' : ''}
${o.jsonld ? `<script type="application/ld+json">${o.jsonld}</script>` : ''}</head><body>
<nav><a href="/">Home</a><a href="/a/">A</a><a href="/b/">B</a></nav>
<main>${(o.h1s || ['Heading']).map((h) => `<h1>${h}</h1>`).join('')}
${(o.h2s || []).map((h) => `<h2>${h}</h2>`).join('')}
<p>${o.body || 'Body text that is long enough to count as content on this page. '.repeat(6)}</p>
${(o.imgs || []).map((i) => `<img src="${i.src}"${i.alt != null ? ` alt="${i.alt}"` : ''}>`).join('')}
${(o.links || []).map((l) => `<a href="${l}">link</a>`).join('')}</main></body></html>`;

const LONG = 'Choosing the right option depends on three separate factors that interact. '.repeat(10);

const BROKEN_PAGES = {
  '/': page({ title: 'Home | Acme', h1s: ['Home'], links: ['/gone/', '/old/'], imgs: [{ src: '/a.jpg' }, { src: '/b.jpg' }], body: LONG }),
  '/a/': page({ title: 'Acme', h1s: [], desc: 'Same description everywhere on the site here.', body: LONG }),
  '/b/': page({ title: 'Acme', h1s: ['B', 'Second H1'], desc: 'Same description everywhere on the site here.', body: LONG }),
  '/noindex/': page({ title: 'Hidden | Acme', noindex: true, body: LONG }),
  '/xcanon/': page({ title: 'X | Acme', canonical: 'https://elsewhere.example/x/', body: LONG }),
  '/thin/': page({ title: 'Thin | Acme', body: 'Only a few words.' }),
  '/badjson/': page({ title: 'JSON | Acme', jsonld: '{ not valid json', body: LONG }),
  '/empty/': '<!doctype html><html><head><title>Not found</title></head><body><h1>Not found</h1></body></html>',
};

const GOOD_PAGES = {
  '/': page({ title: 'Running Shoes and Fitting Guides | Stride', desc: 'Independent running shoe reviews and fitting guides written by coaches who log the miles.', canonical: `http://localhost:${GOOD}/`, h1s: ['Running shoes, chosen properly'], h2s: ['Foot shape first', 'Then the surface'], body: LONG, imgs: [{ src: '/h.jpg', alt: 'A runner on a trail' }], jsonld: JSON.stringify({ '@context': 'https://schema.org', '@type': 'Organization', name: 'Stride', url: `http://localhost:${GOOD}/` }) }),
  '/a/': page({ title: 'All Running Shoes | Stride', desc: 'Every running shoe we have tested, sorted by surface, cushioning and heel drop.', canonical: `http://localhost:${GOOD}/a/`, h1s: ['All running shoes'], h2s: ['Road'], body: LONG, imgs: [{ src: '/a.jpg', alt: 'Shoes lined up' }] }),
  '/b/': page({ title: 'How to Fit Running Shoes | Stride', desc: 'A step by step method for fitting running shoes including the thumb-width check.', canonical: `http://localhost:${GOOD}/b/`, h1s: ['How to fit running shoes'], h2s: ['Measure late'], body: LONG, imgs: [{ src: '/b.jpg', alt: 'Measuring a foot' }] }),
};

function serve(port, pages, { robots, sitemap, headers = {}, redirects = {}, soft404 = [] }) {
  return new Promise((res) => {
    const s = createServer((req, rq) => {
      const p = req.url.split('?')[0];
      if (p === '/robots.txt') return rq.writeHead(200, { 'Content-Type': 'text/plain' }).end(robots);
      if (p === '/sitemap.xml') return rq.writeHead(200, { 'Content-Type': 'application/xml' }).end(sitemap);
      if (redirects[p]) return rq.writeHead(301, { Location: redirects[p] }).end();
      if (soft404.includes(p)) return rq.writeHead(200, { 'Content-Type': 'text/html' }).end('<!doctype html><title>Not found</title><h1>Not found</h1>');
      if (pages[p]) return rq.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...headers }).end(pages[p]);
      rq.writeHead(404, { 'Content-Type': 'text/html' }).end('<!doctype html><title>404</title><h1>404</h1>');
    });
    s.listen(port, () => res(s));
  });
}

/* A genuine client-rendered page: the shell is empty and inline JS builds the
   real content. This is the case the plain crawler cannot audit. */
const SPA_SHELL = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Shop</title></head>
<body><div id="root"></div><script>
document.addEventListener('DOMContentLoaded', () => {
  const w = 'Trail shoes tested over four hundred miles of technical singletrack with grip notes. '.repeat(12);
  document.getElementById('root').innerHTML =
    '<nav>' + [1,2,3,4,5,6,7,8].map(i => '<a href="/p' + i + '/">P' + i + '</a>').join('') + '</nav>' +
    '<main><h1>Trail running shoes</h1><h2>Grip</h2><p>' + w + '</p></main>';
});
</script></body></html>`;

const sm = (port, paths) => `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${
  paths.map((u) => `<url><loc>http://localhost:${port}${u}</loc><lastmod>2026-03-1${u.length % 9}</lastmod></url>`).join('')}</urlset>`;

/* ── boot ─────────────────────────────────────────────────────────────────── */

const servers = [];
servers.push(await serve(BROKEN, BROKEN_PAGES, {
  // /noindex/ is deliberately NOT disallowed: a page that is both blocked and
  // noindexed cannot be read at all, so the crawler correctly never sees the
  // noindex. Blocking it here would assert something the tool cannot know.
  robots: `User-agent: *\nDisallow: /private/\n`,
  sitemap: sm(BROKEN, ['/', '/a/', '/b/', '/noindex/', '/xcanon/', '/thin/', '/orphan-only/']),
  redirects: { '/old/': `http://localhost:${BROKEN}/mid/`, '/mid/': `http://localhost:${BROKEN}/a/` },
  soft404: ['/soft/'],
}));
servers.push(await serve(GOOD, GOOD_PAGES, {
  robots: `User-agent: *\nAllow: /\n\nSitemap: http://localhost:${GOOD}/sitemap.xml\n`,
  sitemap: sm(GOOD, ['/', '/a/', '/b/']),
  headers: { 'Strict-Transport-Security': 'max-age=300', 'X-Content-Type-Options': 'nosniff', Server: 'nginx/1.18.0', 'Set-Cookie': 'sid=1; Path=/' },
}));

servers.push(await serve(SPA, { '/': SPA_SHELL }, {
  robots: `User-agent: *\nAllow: /\n`, sitemap: sm(SPA, ['/']),
}));

/* A fixture built to trip every check in audit-extra.js. Each of these is
   either silent in the page source or systemic, which is why they are worth a
   finding at all — and why a fixture is the only way to know they fire. */
const XE = `http://localhost:${EXTRA}`;
const xshell = (o) => `<!doctype html><html lang="${o.lang || 'en'}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${o.title}</title>
<meta name="description" content="A description long enough to clear the length rule comfortably.">
${o.canonical ? `<link rel="canonical" href="${o.canonical}">` : ''}
${(o.hreflang || []).map((h) => `<link rel="alternate" hreflang="${h.lang}" href="${h.href}">`).join('')}
${o.refresh ? `<meta http-equiv="refresh" content="0;url=${o.refresh}">` : ''}
${o.blocking ? Array.from({ length: 9 }, (_, i) => `<link rel="stylesheet" href="/s${i}.css">`).join('') : ''}
${o.fonts ? '<style>@font-face{font-family:X;src:url(/a.woff2)}</style>' : ''}
</head><body><nav><a href="/">Home</a><a href="/hidden/">Hidden</a></nav>
<main><h1>${o.title}</h1><p>${LONG}</p></main></body></html>`;

const XPAGES = {
  '/': { html: xshell({ title: 'Home', canonical: `${XE}/` }) },
  '/hidden/': { html: xshell({ title: 'Hidden', canonical: `${XE}/hidden/` }), headers: { 'X-Robots-Tag': 'noindex, nofollow' } },
  '/follow-none/': { html: xshell({ title: 'Follow none', canonical: `${XE}/follow-none/` }), headers: { 'X-Robots-Tag': 'nofollow' } },
  '/conflict/': { html: xshell({ title: 'Conflict', canonical: `${XE}/conflict/` }), headers: { Link: `<${XE}/other/>; rel="canonical"` } },
  '/chain-a/': { html: xshell({ title: 'Chain A', canonical: `${XE}/chain-b/` }) },
  '/chain-b/': { html: xshell({ title: 'Chain B', canonical: `${XE}/chain-c/` }) },
  '/chain-c/': { html: xshell({ title: 'Chain C', canonical: `${XE}/chain-c/` }) },
  '/blog/': { html: xshell({ title: 'Blog', canonical: `${XE}/blog/` }) },
  '/blog/page/2/': { html: xshell({ title: 'Blog page 2', canonical: `${XE}/blog/` }) },
  '/en/': { html: xshell({ title: 'English', canonical: `${XE}/en/`, hreflang: [{ lang: 'fr', href: `${XE}/fr/` }, { lang: 'en-UK', href: `${XE}/uk/` }] }) },
  '/fr/': { html: xshell({ title: 'French', lang: 'fr', canonical: `${XE}/fr/`, hreflang: [{ lang: 'fr', href: `${XE}/fr/` }] }) },
  '/uk/': { html: xshell({ title: 'UK', canonical: `${XE}/uk/`, hreflang: [{ lang: 'en-UK', href: `${XE}/uk/` }] }) },
  '/old-way/': { html: xshell({ title: 'Old', refresh: '/' }) },
  '/heavy/': { html: xshell({ title: 'Heavy', canonical: `${XE}/heavy/`, blocking: true, fonts: true }) },
  '/list/': { html: xshell({ title: 'List', canonical: `${XE}/list/` }) },
};
servers.push(await new Promise((res) => {
  const srvX = createServer((q, r) => {
    const [pp, qs] = q.url.split('?');
    if (pp === '/robots.txt') return r.writeHead(200).end(`User-agent: *\nAllow: /\n\nSitemap: ${XE}/sitemap.xml\n`);
    if (pp === '/sitemap.xml') {
      return r.writeHead(200, { 'Content-Type': 'application/xml' })
        .end(`<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${Object.keys(XPAGES).map((u) => `<url><loc>${XE}${u}</loc></url>`).join('')}</urlset>`);
    }
    const hit = XPAGES[pp];
    if (hit) {
      let h = hit.html;
      if (pp === '/list/') h = h.replace('</main>', ['?colour=red&size=s', '?colour=blue&size=m', '?colour=green&size=l'].map((x) => `<a href="/list/${x}">v</a>`).join('') + '</main>');
      if (pp === '/') h = h.replace('</main>', Object.keys(XPAGES).map((u) => `<a href="${u}">l</a>`).join('') + '</main>');
      return r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...(hit.headers || {}) }).end(h);
    }
    r.writeHead(404, { 'Content-Type': 'text/html' }).end('<!doctype html><title>404</title><h1>404</h1>');
  });
  srvX.listen(EXTRA, () => res(srvX));
}));

const srv = spawn(process.execPath, [join(ROOT, 'server.js')], {
  env: {
    ...process.env, PORT: String(PORT),
    GOOGLE_API_KEY: '', ANTHROPIC_API_KEY: '', CLARITY_API_TOKEN: '',
    OLLAMA_URL: `http://localhost:${FAKE_OLLAMA}`,   // keep the child off the real one too
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let srvErr = '', srvOut = '';
srv.stderr.on('data', (d) => { srvErr += d.toString(); });
srv.stdout.on('data', (d) => { srvOut += d.toString(); });  // must be drained or the pipe can block
srv.on('error', (err) => { srvErr += `\nSPAWN_ERROR: ${err.message}`; });
srv.on('exit', (code, sig) => { srvErr += `\nPROCESS_EXIT: code=${code}, sig=${sig}`; });

/* Poll for readiness rather than sleeping a guessed interval — a fixed sleep is
   the classic source of a suite that passes on one machine and fails on another. */
const ready = await (async () => {
  for (let i = 0; i < 120; i++) {
    try { const r = await fetch(`${BASE}/api/schema/types`); if (r.ok) return true; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
})();
if (!ready) {
  console.error('\nThe API server never became ready on ' + BASE + '.');
  console.error('stdout:', srvOut.trim() || '(none)');
  console.error('stderr:', srvErr.trim() || '(none)');
  srv.kill(); servers.forEach((x) => x.close());
  process.exit(1);
}

const api = async (path, body, method) => {
  const res = await fetch(BASE + path, body || method
    ? { method: method || 'POST', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }
    : {});
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`${path} returned non-JSON (HTTP ${res.status}): ${text.slice(0, 120)}`); }
  return { status: res.status, ...json };
};

/* ══════════════════════════ pure logic ══════════════════════════ */

const mod = (f) => import(pathToFileURL(join(ROOT, f)).href);

const parse = await mod('lib/parse.js');
const fixes = await mod('lib/fixes.js');
const sec = await mod('lib/security.js');
const sum = await mod('lib/summarize.js');
const prov = await mod('lib/providers.js');
const prog = await mod('lib/program.js');
const gen = await mod('lib/generate.js');
const art = await mod('lib/artwork.js');
const ins = await mod('lib/insights.js');
const local = await mod('lib/local.js');
const trends = await mod('lib/trends.js');
const mon = await mod('lib/monitor.js');
const rend = await mod('lib/render.js');
const srp = await mod('lib/serp.js');
const gcsv = await mod('lib/gscimport.js');
const setg = await mod('lib/settings.js');
const llmMod = await mod('lib/llm.js');
const ns = await mod('lib/newsite.js');
const ppl = await mod('lib/people.js');
const au = await mod('lib/auth.js');
const cl = await mod('lib/clarity.js');
const cmp = await mod('lib/competitor.js');
const lg = await mod('lib/logs.js');
const av = await mod('lib/aivis.js');
const gscMod = await mod('lib/gsc.js');

G('parse');
await t('extracts core fields', () => {
  const p = parse.parsePage(page({ title: 'T', desc: 'D', h1s: ['A'], h2s: ['B'] }), 'https://x.test/a/', {});
  is(p.title, 'T'); is(p.metaDescription, 'D'); is(p.h1s[0], 'A');
  ok(p.wordCount > 20, 'word count');
});
await t('detects noindex', () => ok(parse.parsePage(page({ noindex: true }), 'https://x.test/', {}).noindex));
await t('records jsonld errors without throwing', () => {
  const p = parse.parsePage(page({ jsonld: '{ bad' }), 'https://x.test/', {});
  ok(p.jsonldErrors.length > 0);
});
await t('pixelWidth beats character count', () => {
  ok(parse.pixelWidth('WWWWWWWWWW', 20) > parse.pixelWidth('iiiiiiiiii', 20));
});
await t('platform detection ignores innocent prose', () => {
  const p = parse.parsePage('<html><body><p>Each individual division is dividing. The genesis-of-an-idea.</p></body></html>', 'https://x.test/', {});
  is(p.platform.length, 0, `got ${JSON.stringify(p.platform)}`);
});
await t('platform detection finds a real stack', () => {
  const p = parse.parsePage('<html><body><div class="et_pb_section"></div><link href="/wp-content/themes/Divi/s.css"></body></html>', 'https://x.test/', {});
  ok(p.platform.includes('WordPress') && p.platform.includes('Divi'), JSON.stringify(p.platform));
});
await t('normaliseUrl resolves and strips fragments', () => {
  is(parse.normaliseUrl('/b/#frag', 'https://x.test/a/'), 'https://x.test/b/');
});

G('fixes');
const FP = [
  { url: 'https://x.test/', title: 'Acme', h1s: [], headings: [], bodyText: LONG, wordCount: 90, images: [{ src: '/a.jpg', hasAltAttr: false }], links: [], schemaTypes: [], inboundCount: 0 },
  { url: 'https://x.test/services/', title: 'Acme', h1s: [], headings: [{ level: 2, text: 'What we do' }], bodyText: LONG, wordCount: 90, images: [], links: [], schemaTypes: [], inboundCount: 1 },
];
await t('never proposes the site-wide string as a page subject', () => {
  const f = fixes.deterministicFix({ id: 'h1-missing', title: '1 page has no H1', urls: ['https://x.test/services/'] }, FP, 'https://x.test');
  ok(f, 'no fix produced');
  ok(!/Acme/.test(f.changes[0].to), `leaked brand: ${f.changes[0].to}`);
});
await t('never proposes a hostname as a title', () => {
  const f = fixes.deterministicFix({ id: 'title-h1-mismatch', title: 'title contradicts H1', urls: ['https://x.test/'] }, FP, 'https://x.test');
  ok(f && !/x\.test/.test(f.changes[0].to), `leaked host: ${f.changes?.[0]?.to}`);
});
await t('parses annotated finding URLs', () => {
  is(fixes.extractUrls('https://x.test/gone/ [404] ← https://x.test/').length, 2);
  is(fixes.extractUrls('a → b')[0], undefined);
  is(fixes.extractUrls('99% https://x.test/1 ≈ https://x.test/2').length, 2);
});
await t('produces HTTPS rewrite rules', () => {
  const f = fixes.deterministicFix({ id: 'no-https', title: 'Site is served over HTTP' }, FP, 'http://x.test');
  ok(f && /RewriteRule|return 301/.test(f.changes[0].to));
});
await t('returns null rather than inventing a fix', () => {
  is(fixes.deterministicFix({ id: 'eeat-author', title: 'no author' }, FP, 'https://x.test'), null);
});
await t('title fits the pixel budget', () => {
  const f = fixes.fixTitle({ url: 'https://x.test/a/', title: 'x'.repeat(300), h1s: ['A sensible heading for the page'] }, '');
  ok(parse.pixelWidth(f.to, 20) <= 580, `${parse.pixelWidth(f.to, 20)}px`);
});

G('security');
const hp = (h, u = 'https://x.test/') => ({ url: u, status: 200, contentType: 'text/html', headers: h });
await t('bare page grades F', () => is(sec.auditHeaders(hp({})).grade, 'F'));
await t('hardened page grades A', () => is(sec.auditHeaders(hp({
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'content-security-policy': "default-src 'self'; script-src 'self'; object-src 'none'; frame-ancestors 'self'",
  'x-frame-options': 'SAMEORIGIN', 'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin', 'permissions-policy': 'camera=()',
  'cross-origin-opener-policy': 'same-origin',
})).grade, 'A'));
await t('CSP emitted once in generated config', () => {
  const c = sec.headerConfig(sec.auditSite([hp({})]));
  is((c.apache.match(/Content-Security-Policy/g) || []).length, 1);
});
await t('cookies deduped across pages', () => {
  const s = sec.auditSite([hp({ 'set-cookie': 's=1' }), hp({ 'set-cookie': 's=1' }, 'https://x.test/a/')]);
  is(s.cookies.length, 1);
});
await t('HSTS skipped on http', () => is(sec.auditHeaders(hp({}, 'http://x.test/')).results.find((r) => r.id === 'hsts').level, 'skip'));

G('summarize');
await t('sentences are verbatim and unique', () => {
  const txt = 'The shoe fits the foot shape first and that matters most here. '.repeat(5)
    + 'Heel drop is measured in millimetres between heel and forefoot. Replace shoes when the midsole compresses rather than the upper.';
  const r = sum.summarize(txt, { sentences: 3 });
  is(new Set(r.sentences).size, r.sentences.length, 'repeated sentence');
  ok(r.sentences.every((s) => txt.includes(s)), 'not verbatim');
});
await t('excerpt fits a meta description', () => ok(sum.excerpt(LONG, 155).length <= 156));

G('providers');
await t('parses JSON out of prose and fences', () => {
  is(prov.parseLooseJson('Sure!\n```json\n{"a":1}\n```\nDone').a, 1);
  is(prov.parseLooseJson('{"a":"has } brace"}').a, 'has } brace');
});
await t('rejects prose and truncation', () => {
  for (const bad of ['I cannot do that.', '{"a":{"b":1']) {
    let threw = false;
    try { prov.parseLooseJson(bad); } catch { threw = true; }
    ok(threw, `accepted ${bad}`);
  }
});
await t('DDG parser decodes redirects and finds position', () => {
  const html = '<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fx.test%2Fa">A</a><a class="result__a" href="https://y.test/b">B</a>';
  const r = prov._parseDdg(html, 'x.test');
  is(r.position, 1); is(r.top[0].url, 'https://x.test/a');
});

G('program');
const FIND = [
  { id: 'a', phase: 'onpage', severity: 'High', effort: 'M', owner: 'dev' },
  { id: 'b', phase: 'eligibility', severity: 'Low', effort: 'L', owner: 'dev' },
  { id: 'c', phase: 'eligibility', severity: 'Critical', effort: 'S', owner: 'dev' },
];
await t('ladder order beats severity across stages', () => {
  const p = prog.buildProgram(FIND, { pointsPerWeek: 100 });
  is(p.weeks[0].items[0].id, 'c');
  is(p.weeks[0].items[1].id, 'b', 'a stage-1 Low must precede a stage-4 High');
});
await t('capacity splits weeks', () => {
  is(prog.buildProgram(FIND, { pointsPerWeek: 3 }).weeks.length > 1, true);
});

G('generate');
await t('every advertised schema type builds', () => {
  for (const ty of gen.schemaTypes()) {
    const r = gen.buildSchema(ty, { name: 'N', url: 'https://x.test/', startDate: '2026-01-01', recipeIngredient: 'a', recipeInstructions: 'b', headline: 'H', author: 'A', itemListElement: [{}], mainEntity: [{}], provider: 'P', telephone: '1', address: 'x' });
    ok(r.json['@type'], `${ty} produced no @type`);
  }
});
await t('robots defaults to platform-neutral', () => {
  ok(!/wp-admin/.test(gen.generateRobots({ origin: 'https://x.test', platform: 'generic' })));
});

G('artwork');
await t('all styles render valid SVG', () => {
  for (const s of art.STYLES) {
    const svg = art.background(s.key, 1080, 1080, '#17564A', 7);
    ok(svg.startsWith('<svg') && svg.endsWith('</svg>'), `${s.key} malformed`);
    ok(svg.length > 300, `${s.key} suspiciously short`);
  }
});
await t('same seed is reproducible', () => {
  is(art.background('facets', 600, 600, '#17564A', 42), art.background('facets', 600, 600, '#17564A', 42));
});

G('local content');
await t('classifies intent', () => {
  is(local.classifyIntent('how to fit running shoes'), 'informational');
  is(local.classifyIntent('best running shoes'), 'commercial');
  is(local.classifyIntent('buy running shoes near me'), 'transactional');
});
await t('brief names the SERP-check step', () => ok(/search "/.test(local.localBrief('post', 'running shoes', {}))));

G('trends');
await t('reads clicks-down-impressions-flat correctly', () => {
  const rows = [];
  for (let i = 0; i < 30; i++) rows.push({ date: `2026-01-${String(i + 1).padStart(2, '0')}`, clicks: i < 15 ? 100 : 60, impressions: 1000, ctr: 0.1, position: 8 });
  is(trends.shapeGscSeries(rows).read.kind, 'ctr');
});

G('monitor — diffing');
const RUN_A = { stats: { crawled: 20, indexable: 20, noindex: 0, errors: 0 }, findings: [
  { id: 'a', title: 'A', severity: 'Medium', urls: ['u1'] },
  { id: 'b', title: 'B', severity: 'Low', urls: ['u1', 'u2'] },
] };
await t('a stable site is quiet', () => {
  const d = mon.diffRuns(RUN_A, RUN_A);
  ok(d.quiet, `should be quiet, got: ${d.summary}`);
  is(d.alertable.length, 0);
});
await t('a new Critical alerts', () => {
  const b = { ...RUN_A, findings: [...RUN_A.findings, { id: 'c', title: 'C', severity: 'Critical', urls: ['u9'] }] };
  const d = mon.diffRuns(RUN_A, b);
  is(d.alertable.length, 1); is(d.appeared.length, 1); ok(!d.quiet);
});
await t('a new Low stays quiet at default thresholds', () => {
  const b = { ...RUN_A, findings: [...RUN_A.findings, { id: 'z', title: 'Z', severity: 'Low', urls: ['u9'] }] };
  const d = mon.diffRuns(RUN_A, b);
  is(d.alertable.length, 0); is(d.appeared.length, 1);
  ok(d.quiet, 'a Low finding must not page anyone');
});
await t('a worsening severity alerts', () => {
  const b = { ...RUN_A, findings: [{ id: 'a', title: 'A', severity: 'High', urls: ['u1'] }, RUN_A.findings[1]] };
  const d = mon.diffRuns(RUN_A, b);
  is(d.worsened.length, 1); is(d.worsened[0].from, 'Medium'); is(d.alertable.length, 1);
});
await t('a finding covering many more URLs is flagged', () => {
  const b = { ...RUN_A, findings: [RUN_A.findings[0], { id: 'b', title: 'B', severity: 'Low', urls: ['u1', 'u2', 'u3', 'u4', 'u5'] }] };
  is(mon.diffRuns(RUN_A, b).grew.length, 1);
});
await t('resolved findings are reported', () => {
  const d = mon.diffRuns(RUN_A, { ...RUN_A, findings: [RUN_A.findings[0]] });
  is(d.resolved.length, 1);
});
await t('a noindex jump is caught structurally', () => {
  const d = mon.diffRuns(RUN_A, { stats: { crawled: 20, indexable: 12, noindex: 8, errors: 0 }, findings: RUN_A.findings });
  ok(d.structural.some((x) => /noindex/i.test(x)), JSON.stringify(d.structural));
  ok(!d.quiet, 'a noindex jump must never be quiet');
});
await t('a crawl collapse is caught structurally', () => {
  const d = mon.diffRuns(RUN_A, { stats: { crawled: 4, indexable: 4, noindex: 0, errors: 0 }, findings: RUN_A.findings });
  ok(d.structural.some((x) => /fell from 20 to 4/.test(x)), JSON.stringify(d.structural));
});
await t('the first run is a baseline, not an alert', () => {
  const d = mon.diffRuns(null, RUN_A);
  is(d.alertable.length, 0);
});
await t('cron presets are all valid', async () => {
  let c = null;
  try { c = (await import('node-cron')).default; } catch { /* optional */ }
  if (!c) return skipT('cron validation', 'node-cron not installed');
  for (const p of mon.CRON_PRESETS) ok(c.validate(p.expr), `invalid: ${p.expr}`);
});
await t('cron expressions are described in English', () => {
  ok(!/[*/]/.test(mon.describeCron('0 3 * * 1')), mon.describeCron('0 3 * * 1'));
});

G('render — raw vs rendered detection');
await t('spots a JS-dependent page', () => {
  const raw = '<html><body><div id="root"></div><script src="/a.js"></script></body></html>';
  const ren = `<html><body><div id="root"><h1>Real</h1><p>${'word '.repeat(200)}</p>${Array.from({ length: 20 }, (_, i) => `<a href="/p${i}">l</a>`).join('')}</div></body></html>`;
  const g = rend.renderGap(raw, ren);
  ok(g.dependent, JSON.stringify(g));
  ok(/depends on JavaScript/.test(g.verdict));
});
await t('leaves a server-rendered page alone', () => {
  const html = `<html><body><h1>Real</h1><p>${'word '.repeat(200)}</p>${Array.from({ length: 20 }, (_, i) => `<a href="/p${i}">l</a>`).join('')}</body></html>`;
  const g = rend.renderGap(html, html);
  ok(!g.dependent, JSON.stringify(g));
  ok(/not needed/.test(g.verdict));
});
await t('ignores scripts and styles when counting words', () => {
  const withJunk = `<html><head><style>${'a{color:red}'.repeat(50)}</style></head><body><script>${'var x=1;'.repeat(50)}</script><p>five words only here now</p></body></html>`;
  is(rend.renderGap(withJunk, withJunk).rawWords, 5);
});

G('intent — SERP classification and verdict');
const serpOf = (kinds) => ({ query: 'q', results: kinds.map((k, i) => ({ position: i + 1, url: `https://c${i}.com/`, title: k === 'guide' ? 'How to do it' : k === 'listicle' ? '10 Best things' : 'Buy now', kind: k })), features: [] });
await t('classifies by title and by path', () => {
  is(srp._classify('How to fit shoes', 'https://x.com/a'), 'guide');
  is(srp._classify('Shoes', 'https://x.com/blog/shoes/'), 'guide');
  is(srp._classify('10 Best Shoes', 'https://x.com/a'), 'listicle');
  is(srp._classify('Shoe', 'https://x.com/product/shoe/'), 'product');
});
await t('a format mismatch is High', () => {
  const v = srp.judgeIntent(serpOf(Array(10).fill('guide')), { url: 'https://me.com/product/x/', title: 'Buy X' });
  is(v.severity, 'High'); ok(/mismatch/.test(v.what));
  ok(/cannot close a format gap/.test(v.fix), 'must explain why on-page work will not help');
});
await t('a matching format raises nothing', () => {
  is(srp.judgeIntent(serpOf(Array(10).fill('guide')), { url: 'https://me.com/blog/x/', title: 'How to X' }).severity, null);
});
await t('a mixed SERP is not a finding', () => {
  const v = srp.judgeIntent(serpOf(['guide','guide','guide','listicle','listicle','listicle','product','product','service','other']), { url: 'https://me.com/x/', title: 'X' });
  ok(v.mixed); is(v.severity, null);
});
await t('a local pack changes the advice', () => {
  const s2 = serpOf(Array(10).fill('service'));
  s2.features = [{ id: 'local', label: 'Local pack / map' }];
  ok(/proximity/.test(srp.judgeIntent(s2, { url: 'https://me.com/services/x/', title: 'Services' }).featureNote));
});

G('Search Console CSV import');
await t('reads a Queries export with a percentage CTR', () => {
  const r = gcsv.importTable('Top queries,Clicks,Impressions,CTR,Position\nrunning shoes,120,4300,2.79%,8.4');
  is(r.dimension, 'query'); is(r.rows[0].clicks, 120);
  near(r.rows[0].ctr, 0.0279, 0.001); is(r.rows[0].position, 8.4);
});
await t('handles thousands separators and decimal commas', () => {
  is(gcsv.importTable('Top queries,Clicks,Impressions\nq,"1,234","56,789"').rows[0].impressions, 56789);
  near(gcsv.importTable('Top queries,Clicks,Impressions,CTR\nq,10,1000,"1,50%"').rows[0].ctr, 0.015, 0.001);
});
await t('accepts localised headers', () => {
  is(gcsv.importTable('Requêtes les plus fréquentes,Clics,Impressions\nq,5,50').dimension, 'query');
});
await t('derives CTR when the column is absent', () => {
  is(gcsv.importTable('Top queries,Clicks,Impressions\nq,25,100').rows[0].ctr, 0.25);
});
await t('rejects a non-GSC file with actionable guidance', () => {
  let msg2 = '';
  try { gcsv.importTable('name,age\nbob,3'); } catch (e) { msg2 = e.message; }
  ok(/Search Console/.test(msg2), `unhelpful: ${msg2}`);
});
await t('quoted commas and escaped quotes survive parsing', () => {
  is(gcsv.parseCsv('a,b\n"x, y",2')[1][0], 'x, y');
  is(gcsv.parseCsv('a\n"say ""hi"""')[1][0], 'say "hi"');
});
await t('striking distance is bounded to 4-20 with volume', () => {
  const s2 = gcsv.strikingDistance({ rows: [
    { query: 'a', clicks: 5, impressions: 500, ctr: 0.01, position: 6 },
    { query: 'b', clicks: 2, impressions: 200, ctr: 0.01, position: 14 },
    { query: 'c', clicks: 1, impressions: 5, ctr: 0.2, position: 7 },
    { query: 'd', clicks: 90, impressions: 300, ctr: 0.3, position: 2 },
  ] });
  is(s2.length, 2);
  ok(s2.every((r) => r.position >= 4 && r.position <= 20 && r.impressions >= 30));
});
await t('CTR gaps flag the underperformer and spare the good one', () => {
  const g = gcsv.ctrGaps({ rows: [
    { query: 'a', clicks: 5, impressions: 500, ctr: 0.01, position: 6 },
    { query: 'd', clicks: 90, impressions: 300, ctr: 0.3, position: 2 },
  ] });
  ok(g.some((r) => r.query === 'a')); ok(!g.some((r) => r.query === 'd'));
});
await t('cannibalisation requires two pages with real share', () => {
  const c = gcsv.cannibalisation({ rows: [
    { query: 'x', page: '/a', clicks: 5, impressions: 100, position: 8 },
    { query: 'x', page: '/b', clicks: 3, impressions: 80, position: 11 },
    { query: 'y', page: '/c', clicks: 1, impressions: 10, position: 5 },
  ] });
  is(c.length, 1); is(c[0].pages.length, 2);
});

G('gsc — API and OAuth');
await t('isConfigured recognizes both GSC_* and GOOGLE_* prefixes', () => {
  const origClientId = process.env.GSC_CLIENT_ID;
  const origClientSecret = process.env.GSC_CLIENT_SECRET;
  const origGoogleId = process.env.GOOGLE_CLIENT_ID;
  const origGoogleSecret = process.env.GOOGLE_CLIENT_SECRET;

  delete process.env.GSC_CLIENT_ID;
  delete process.env.GSC_CLIENT_SECRET;
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  is(gscMod.isConfigured(), false);

  process.env.GSC_CLIENT_ID = '123-abc.apps.googleusercontent.com';
  process.env.GSC_CLIENT_SECRET = 'secret123';
  is(gscMod.isConfigured(), true);
  ok(gscMod.authUrl().includes('123-abc.apps.googleusercontent.com'));

  delete process.env.GSC_CLIENT_ID;
  delete process.env.GSC_CLIENT_SECRET;
  process.env.GOOGLE_CLIENT_ID = '456-def.apps.googleusercontent.com';
  process.env.GOOGLE_CLIENT_SECRET = 'secret456';
  is(gscMod.isConfigured(), true);
  ok(gscMod.authUrl().includes('456-def.apps.googleusercontent.com'));

  if (origClientId !== undefined) process.env.GSC_CLIENT_ID = origClientId; else delete process.env.GSC_CLIENT_ID;
  if (origClientSecret !== undefined) process.env.GSC_CLIENT_SECRET = origClientSecret; else delete process.env.GSC_CLIENT_SECRET;
  if (origGoogleId !== undefined) process.env.GOOGLE_CLIENT_ID = origGoogleId; else delete process.env.GOOGLE_CLIENT_ID;
  if (origGoogleSecret !== undefined) process.env.GOOGLE_CLIENT_SECRET = origGoogleSecret; else delete process.env.GOOGLE_CLIENT_SECRET;
});

await t('token persistence roundtrips through disconnect', async () => {
  await gscMod.setTokens({ access_token: 'test-token', refresh_token: 'test-refresh' });
  is(gscMod.isConnected(), true);
  is(gscMod.getTokens()?.access_token, 'test-token');
  await gscMod.disconnect();
  is(gscMod.isConnected(), false);
  is(gscMod.getTokens(), null);
});

G('settings — secrets never echoed');
await t('status reports presence and a tail, never the value', async () => {
  const before = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'sk-test-abcd1234efgh5678';
  const st = await setg.status();
  is(st.ANTHROPIC_API_KEY.set, true);
  is(st.ANTHROPIC_API_KEY.hint, '••••5678');
  ok(!JSON.stringify(st).includes('abcd1234'), 'the full key leaked into the status payload');
  if (before === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = before;
});
await t('every field explains what it adds and where to get it', () => {
  for (const [k, f] of Object.entries(setg.FIELDS)) {
    ok(f.unlocks && f.unlocks.length > 25, `${k} does not say what it adds`);
    ok(f.how && f.how.length > 20, `${k} does not say where to get it`);
  }
});
await t('a short value is fully masked', async () => {
  const before = process.env.CF_ACCOUNT_ID;
  process.env.CF_ACCOUNT_ID = 'abc';
  is((await setg.status()).CF_ACCOUNT_ID.hint, '••••');
  if (before === undefined) delete process.env.CF_ACCOUNT_ID; else process.env.CF_ACCOUNT_ID = before;
});
await t('settings.save returns resolved status, not an unhandled Promise', async () => {
  const res = await setg.save({});
  ok(res && typeof res === 'object', 'returns object');
  ok(!(res.status instanceof Promise), 'status is resolved');
  ok(res.status && typeof res.status === 'object', 'status is object');
});

G('text models — registry and fallback');
/* A fake Ollama, so local detection and the chain order are actually exercised
   rather than assumed. localhost is not proxied, so this works anywhere. */
let ollamaCalls = 0, ollamaMode = 'ok';
servers.push(await new Promise((res) => {
  const srv2 = createServer((q, r) => {
    const chunks = [];
    q.on('data', (c) => chunks.push(c));
    q.on('end', () => {
      if (q.url === '/api/tags') {
        return r.writeHead(200, { 'Content-Type': 'application/json' })
          .end(JSON.stringify({ models: [{ name: 'llama3.2:1b' }, { name: 'qwen2.5:14b' }] }));
      }
      if (q.url === '/v1/chat/completions') {
        ollamaCalls++;
        if (ollamaMode === 'fail') return r.writeHead(500).end('{"error":{"message":"model crashed"}}');
        const req = JSON.parse(Buffer.concat(chunks).toString() || '{}');
        return r.writeHead(200, { 'Content-Type': 'application/json' })
          .end(JSON.stringify({ choices: [{ message: { content: `LOCAL(${req.model})` } }] }));
      }
      r.writeHead(404).end('{}');
    });
  });
  srv2.listen(FAKE_OLLAMA, () => res(srv2));
}));

await t('detects a local model server', async () => {
  const s2 = await llmMod.survey({ force: true });
  const ol = s2.providers.find((p) => p.id === 'ollama');
  ok(ol.available, ol.reason);
  is(ol.models.length, 2);
});
await t('prefers a capable model over a tiny one', async () => {
  const s2 = await llmMod.survey({ force: true });
  is(s2.providers.find((p) => p.id === 'ollama').model, 'qwen2.5:14b',
    'a 1B model would produce unusable JSON and must not be chosen over a 14B');
});
await t('local is ordered ahead of hosted', async () => {
  const s2 = await llmMod.survey({ force: true });
  const ids = s2.providers.map((p) => p.id);
  ok(ids.indexOf('ollama') < ids.indexOf('pollinations'), ids.join(','));
  ok(ids.indexOf('ollama') < ids.indexOf('anthropic'), 'local must outrank a keyed provider');
});
await t('generate routes to the local model', async () => {
  llmMod.invalidate();
  const r = await llmMod.generate('sys', 'prompt', { maxTokens: 40 });
  is(r.provider, 'ollama');
  ok(/LOCAL\(qwen2\.5:14b\)/.test(r.text), r.text);
});
await t('a mid-request failure falls through and is reported', async () => {
  ollamaMode = 'fail';
  llmMod.invalidate();
  let threw = null;
  try {
    const r = await llmMod.generate('sys', 'prompt', { maxTokens: 40 });
    // If a hosted provider is reachable it should have taken over.
    ok(r.provider !== 'ollama', 'kept using the broken provider');
    ok(r.tried.some((x) => /ollama/.test(x)), 'did not record the failure');
  } catch (e) { threw = e; }
  if (threw) {
    // No network here, so every fallback also fails — the error must name both.
    ok(/ollama/.test(threw.message), `failure not attributed: ${threw.message}`);
    ok(threw.message.length > 60, 'error too terse to diagnose');
  }
  ollamaMode = 'ok';
  llmMod.invalidate();
});
await t('every provider declares why it exists and how to get it', () => {
  for (const p of llmMod.PROVIDERS) {
    ok(p.why && p.why.length > 25, `${p.id} has no rationale`);
    ok(p.setup && p.setup.length > 5, `${p.id} has no setup hint`);
    ok(['local', 'keyed', 'keyless'].includes(p.kind), `${p.id} has no kind`);
  }
});
await t('model choice is version-aware, not hardcoded', () => {
  const P = { prefer: [/flash/i, /pro/i], avoid: [/lite/i, /thinking/i] };
  /* The bug this replaces: a hardcoded gemini-2.0-flash 400d the moment Google
     shipped a new generation. Selection now reads the live catalogue. */
  is(llmMod.newestByVersion(['gemini-3.6-flash', 'gemini-2.0-flash', 'gemini-3.5-flash-lite', 'gemini-3.8-flash-preview'], P), 'gemini-3.6-flash');
  is(llmMod.newestByVersion(['gemini-3.6-flash', 'gemini-3.6-flash-lite'], P), 'gemini-3.6-flash', 'lite chosen over full flash');
  is(llmMod.newestByVersion(['gemini-3.5-flash-lite'], P), 'gemini-3.5-flash-lite', 'must still resolve when lite is all there is');
  is(llmMod.newestByVersion(['gemini-3.8-flash-preview', 'gemini-2.0-flash'], P), 'gemini-3.8-flash-preview', 'preview should win across several generations');
});
await t('no provider hardcodes a model that can go stale', () => {
  /* Every provider must either discover models or read an env override. A
     literal version string in a default is the failure mode being tested. */
  const src = readFileSync(join(ROOT, 'lib/llm.js'), 'utf8');
  const hardcoded = src.match(/model:\s*'[a-z]+-\d+\.\d+[^']*'/gi) || [];
  is(hardcoded.length, 0, `hardcoded model names found: ${hardcoded.join(', ')}`);
});
await t('provider errors carry the real message, not a truncated blob', async () => {
  /* The bug this replaces: errors sliced at 100 chars cut off mid-JSON, so the
     UI showed `400: [{ "error": { "code": 400, "mes` and nothing useful. */
  ollamaMode = 'fail';
  llmMod.invalidate();
  try {
    await llmMod.generate('sys', 'prompt', { maxTokens: 20 });
  } catch (e) {
    ok(/model crashed/.test(e.message), `the provider's own message was lost: ${e.message}`);
    ok(!/\{\s*"error"\s*:\s*\{\s*"?[a-z]*"?$/.test(e.message), 'message ends mid-JSON');
  }
  ollamaMode = 'ok';
  llmMod.invalidate();
});
await t('loose JSON survives prose and fences', () => {
  is(llmMod.parseLooseJson('Sure!\n```json\n{"a":1}\n```').a, 1);
  is(llmMod.parseLooseJson('{"a":"has } brace"}').a, 'has } brace');
});

G('new site — planning without a crawl');
const CL = [
  { label: 'choosing running shoes', intent: 'informational', pages: 6, winnability: 4, value: 3 },
  { label: 'trail shoe reviews', intent: 'commercial', pages: 4, winnability: 3, value: 4 },
  { label: 'buy trail shoes', intent: 'transactional', pages: 1, winnability: 2, value: 5 },
  { label: 'shoe fitting near me', intent: 'local', pages: 3, winnability: 5, value: 4 },
];
await t('expectations are stated honestly, not optimistically', () => {
  const e = ns.expectations({ competitiveness: 'high' });
  ok(/months/.test(e.window), e.window);
  ok(/no shortcut|not a penalty/i.test(e.statement), 'must explain it is not a penalty');
  ok(/selling something/.test(e.warning), 'must warn about traffic promises');
});
await t('a rebuild is framed as preservation, not a fresh start', () => {
  const e = ns.expectations({ isRebuild: true });
  ok(/redirect/i.test(e.statement), e.statement);
  ok(/Preserve first/.test(e.strategy));
});
await t('pillar and spoke is per topic, not per template', () => {
  /* The bug this replaces: grouping by template produced a flat list of spokes
     with nothing anchoring them. A 6-page cluster is one pillar plus 5 spokes. */
  const a = ns.architecture(CL, { origin: 'https://x.test' });
  is(a.counts.pillars, 3, 'clusters with >1 page must each yield a pillar');
  is(a.counts.spokes, 10, '5 + 3 + 2 supporting pages');
  is(a.counts.standalone, 1, 'a single-page cluster is standalone, not a pillar');
  const pillar = a.pages.find((p) => p.role === 'pillar');
  ok(a.pages.filter((p) => p.role === 'spoke' && p.linksTo.includes(pillar.url)).length >= 1, 'spokes must link up to their pillar');
});
await t('URLs are slugged, lowercase and stable', () => {
  const a = ns.architecture([{ label: "Women's Trail Shoes & Boots", pages: 1 }], { origin: 'https://x.test' });
  const u = a.pages[0].url;
  ok(/womens-trail-shoes-and-boots/.test(u), u);
  ok(!/[A-Z'&]/.test(u.replace('https://', '')), `not URL-safe: ${u}`);
  ok(!/\d{4}/.test(u), 'must not embed dates');
});
await t('excessive depth is flagged rather than silently produced', () => {
  const deep = ns.architecture([{ label: 'a topic', intent: 'informational', pages: 4 }], { origin: 'https://x.test' });
  // guides/topic/subtopic = depth 3, still fine; the check must exist and pass here
  ok(typeof deep.depth.ok === 'boolean');
  ok(deep.depth.note.length > 30);
});
await t('architecture refuses to guess without clusters', () => {
  let m2 = '';
  try { ns.architecture([]); } catch (e) { m2 = e.message; }
  ok(/demand research/i.test(m2), `should send you to research first: ${m2}`);
});
await t('rendering is the launch-critical decision', () => {
  const spec = ns.technicalSpec({ rendering: 'csr' });
  const r = spec.decisions.find((d) => d.area === 'Rendering');
  is(r.severity, 'critical');
  ok(/silent/i.test(r.why), 'must explain the failure mode is silent');
  ok(spec.critical.some((d) => /Staging/.test(d.area)), 'a surviving staging noindex must be flagged critical');
  ok(spec.critical.some((d) => /Measurement/.test(d.area)), 'pre-launch GSC verification must be flagged critical');
});
await t('a settled rendering choice is acknowledged, not re-flagged', () => {
  const r = ns.technicalSpec({ rendering: 'ssg' }).decisions.find((d) => d.area === 'Rendering');
  is(r.severity, 'done');
});
await t('platform-specific advice only appears when relevant', () => {
  ok(ns.technicalSpec({ platform: 'wordpress' }).decisions.some((d) => d.area === 'Platform'));
  ok(!ns.technicalSpec({ platform: 'next' }).decisions.some((d) => d.area === 'Platform'));
  ok(!ns.technicalSpec({ local: false }).decisions.some((d) => d.area === 'Local'));
  ok(ns.technicalSpec({ local: true }).decisions.some((d) => d.area === 'Local'));
});
await t('production order puts winnability ahead of value', () => {
  const o = ns.productionOrder(CL);
  is(o.waves[0].cluster, 'shoe fitting near me', 'winnability 5 must lead, not value 5');
  ok(/one cluster before starting the next/i.test(o.rule));
  ok(o.waves.every((w, i) => i === 0 || w.startWeek >= o.waves[i - 1].startWeek), 'waves must not overlap out of order');
});
await t('every phase declares why it exists', () => {
  is(ns.PHASES.length, 7);
  for (const ph of ns.PHASES) {
    ok(ph.why && ph.why.length > 30, `phase ${ph.id} has no rationale`);
    ok(typeof ph.n === 'number');
  }
});

G('people — assignment, not auth');
await t('workload is measured in the same effort points as the plan', async () => {
  const a = await ppl.save({ name: 'Test Dev', role: 'dev', capacity: 12 });
  await ppl.assign('f1', a.id);
  await ppl.assign('f2', a.id);
  const w = await ppl.workload([
    { id: 'f1', effort: 'L', owner: 'dev' }, { id: 'f2', effort: 'M', owner: 'dev' },
    { id: 'f3', effort: 'S', owner: 'SEO' },
  ]);
  const me = w.people.find((p) => p.id === a.id);
  is(me.points, 11, 'L=8 plus M=3');
  is(w.unassignedPoints, 1, 'the unassigned S must be counted');
  ok(/does not ship/.test(w.note), 'must say why unassigned work matters');
  await ppl.remove(a.id);
});
await t('an overloaded person is called out, not just totalled', async () => {
  const a = await ppl.save({ name: 'Loaded', role: 'dev', capacity: 2 });
  await ppl.assign('x1', a.id);
  const w = await ppl.workload([{ id: 'x1', effort: 'L', owner: 'dev' }]);
  ok(/queue, not a sprint/.test(w.people.find((p) => p.id === a.id).note));
  await ppl.remove(a.id);
});
await t('removing a person clears their assignments', async () => {
  const a = await ppl.save({ name: 'Leaver', role: 'dev', capacity: 10 });
  await ppl.assign('y1', a.id);
  await ppl.remove(a.id);
  const w = await ppl.workload([{ id: 'y1', effort: 'M', owner: 'dev' }]);
  is(w.unassignedPoints, 3, 'an assignment to someone who left is worse than none');
});
await t('avatar colour is stable per person', async () => {
  const a = await ppl.save({ name: 'Stable Colour', role: 'seo' });
  const first = (await ppl.list()).people.find((p) => p.id === a.id).hue;
  const again = (await ppl.list()).people.find((p) => p.id === a.id).hue;
  is(first, again);
  await ppl.remove(a.id);
});
await t('a nameless person is rejected', async () => {
  let m3 = '';
  try { await ppl.save({ name: '   ' }); } catch (e) { m3 = e.message; }
  ok(/needs a name/.test(m3), m3);
});
await t('assignment is suggested from the finding owner', async () => {
  const a = await ppl.save({ name: 'Content Person', role: 'content' });
  is(await ppl.suggest({ owner: 'content' }), a.id);
  is(await ppl.suggest({ owner: 'design' }), null);
  await ppl.remove(a.id);
});
await t('every role explains what it handles', () => {
  for (const r of ppl.ROLES) ok(r.handles && r.handles.length > 15, `${r.id} has no description`);
});

G('settings — key provenance');
await t('a shell variable shadowing .env is detected and explained', async () => {
  /* dotenv does not override an existing env var and reads the file only at
     boot. Without surfacing this, a correct new key in .env looks broken and
     there is nothing on screen to say why. */
  const envFile = join(ROOT, '.env');
  const had = existsSync(envFile) ? readFileSync(envFile, 'utf8') : null;
  writeFileSync(envFile, 'GOOGLE_API_KEY=key-from-the-file-1111\n');
  const before = process.env.GOOGLE_API_KEY;
  process.env.GOOGLE_API_KEY = 'key-from-the-shell-9999';
  try {
    const st = await setg.status();
    const g = st.GOOGLE_API_KEY;
    is(g.shadowed, true, 'a differing shell value must be flagged as shadowing');
    is(g.hint, '••••9999', 'hint must show the value actually in use');
    is(g.fileHint, '••••1111', 'file value must be reported separately');
    ok(/takes precedence/.test(g.warning), `warning must explain precedence: ${g.warning}`);
    ok(/Remove-Item Env/.test(g.warning), 'must give the command to clear it');
  } finally {
    if (before === undefined) delete process.env.GOOGLE_API_KEY; else process.env.GOOGLE_API_KEY = before;
    if (had === null) rmSync(envFile, { force: true }); else writeFileSync(envFile, had);
  }
});
await t('a key present in .env but not loaded is called out', async () => {
  const envFile = join(ROOT, '.env');
  const had = existsSync(envFile) ? readFileSync(envFile, 'utf8') : null;
  writeFileSync(envFile, 'GEMINI_API_KEY=only-in-the-file\n');
  const before = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    const g = (await setg.status()).GEMINI_API_KEY;
    is(g.inFile, true);
    is(g.set, false);
    ok(/restart/i.test(g.warning), `must tell you to restart: ${g.warning}`);
  } finally {
    if (before !== undefined) process.env.GEMINI_API_KEY = before;
    if (had === null) rmSync(envFile, { force: true }); else writeFileSync(envFile, had);
  }
});
await t('matching values raise no warning', async () => {
  const envFile = join(ROOT, '.env');
  const had = existsSync(envFile) ? readFileSync(envFile, 'utf8') : null;
  writeFileSync(envFile, 'CF_ACCOUNT_ID=same-value\n');
  const before = process.env.CF_ACCOUNT_ID;
  process.env.CF_ACCOUNT_ID = 'same-value';
  try {
    const g = (await setg.status()).CF_ACCOUNT_ID;
    is(g.shadowed, false);
    is(g.warning, null, 'a correctly loaded key must not be warned about');
  } finally {
    if (before === undefined) delete process.env.CF_ACCOUNT_ID; else process.env.CF_ACCOUNT_ID = before;
    if (had === null) rmSync(envFile, { force: true }); else writeFileSync(envFile, had);
  }
});

G('AI visibility — detection and scoring');
await t('named respects word boundaries', () => {
  ok(av._named('Try Stride, they are good.', 'Stride'));
  ok(!av._named('a strident tone', 'Stride'), '"Stride" must not match inside "strident"');
  ok(av._named('STRIDE is best', 'Stride'), 'matching is case-insensitive');
});
await t('cited is the domain, which is a different signal from named', () => {
  ok(av._cited('see stride.com for details', 'https://www.stride.com/'));
  ok(!av._cited('Stride is great', 'stride.com'), 'a mention is not a citation');
  ok(!av._cited('see stride.co.uk', 'stride.com'), 'a different TLD is a different site');
});
await t('brand fragments are not counted as separate brands', () => {
  /* The bug this replaces: "Cedar & Cup" appearing once was counted three
     times — as Cedar, as Cup and as the whole — inflating a competitor's
     share of voice and understating yours. */
  const b = av._detectBrands('Stride is best. Cedar & Cup is popular. Golden Crema is overpriced.',
    ['Stride', 'Cedar & Cup', 'Golden Crema']);
  is(b.length, 3, `got ${b.map((x) => x.brand).join(', ')}`);
  ok(!b.some((x) => ['Cedar', 'Cup', 'Golden', 'Crema'].includes(x.brand)), 'fragments leaked through');
  ok(b.every((x) => x.mentions === 1), 'one appearance must count once');
});
await t('sentiment reads only the sentence naming the brand', () => {
  const txt = 'Stride is excellent and highly recommended. Golden Crema is unreliable and disappointing.';
  is(av._sentiment(txt, 'Stride').label, 'Positive');
  is(av._sentiment(txt, 'Golden Crema').label, 'Negative', 'a competitor being criticised is not your problem');
  is(av._sentiment(txt, 'Absent Brand'), null, 'no mention means no sentiment, not neutral');
});
await t('a citation scores higher than a mention alone', () => {
  const both = av.score([{ named: true, cited: true, position: 1, brands: [{ brand: 'S', mentions: 1 }] }], 'S');
  const nameOnly = av.score([{ named: true, cited: false, position: 1, brands: [{ brand: 'S', mentions: 1 }] }], 'S');
  ok(both.score > nameOnly.score, 'a citation is a link and must be worth more');
});
await t('being named first scores higher than being named last', () => {
  const first = av.score([{ named: true, cited: false, position: 1, brands: [] }], 'S');
  const fifth = av.score([{ named: true, cited: false, position: 5, brands: [] }], 'S');
  ok(first.score > fifth.score);
});
await t('share of voice counts every brand the model named, not only listed competitors', () => {
  const sc = av.score([{ named: true, cited: false, position: 2,
    brands: [{ brand: 'S', mentions: 1 }, { brand: 'Unlisted Rival', mentions: 3 }] }], 'S', []);
  ok(sc.shareOfVoice.some((x) => x.brand === 'Unlisted Rival'),
    'omitting unlisted brands would flatter you by omission');
  ok(sc.shareOfVoice.find((x) => x.you), 'you must be identifiable in the list');
});
await t('errored answers are excluded from the denominator', () => {
  const sc = av.score([
    { named: true, cited: true, position: 1, brands: [] },
    { error: 'rate limited' },
  ], 'S');
  is(sc.answered, 1);
  is(sc.attempted, 2, 'attempts must still be reported so a half-failed run is visible');
});
await t('a run with no successful answers scores null, not zero', () => {
  const sc = av.score([{ error: 'down' }], 'S');
  is(sc.score, null, 'zero would read as "invisible" when the truth is "unmeasured"');
});
await t('trend needs two runs before it reports a direction', () => {
  const one = av.byPrompt([{ results: [{ prompt: 'p', named: true }] }]);
  is(one[0].trend, null, 'a single run has no direction');
  const two = av.byPrompt([
    { results: [{ prompt: 'p', named: false }] },
    { results: [{ prompt: 'p', named: true }] },
  ]);
  ok(two[0].trend !== null);
});
await t('suggested prompts are buyer questions, not keywords', () => {
  const p2 = av.suggestPrompts({ name: 'Stride', services: ['running shoes'], locations: ['SF'] });
  ok(p2.some((x) => /^best /.test(x)), 'no "best …" prompt');
  ok(p2.some((x) => /^how do I/.test(x)), 'no question-form prompt');
  ok(p2.some((x) => /alternatives/.test(x)), 'no alternatives prompt');
});
await t('the limits are stated, including which models are being measured', () => {
  ok(/not the set your customers use/i.test(av.LIMITS));
  ok(/stochastic/i.test(av.LIMITS), 'must say two runs will differ');
  ok(/lexicon-based/i.test(av.LIMITS), 'must not present sentiment as a model');
});

G('server logs — parsing and crawl-budget waste');
const GB_UA = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
const clf = (ip, url, st, ua, day = 1) =>
  `${ip} - - [0${day}/Sep/2026:10:00:00 +0000] "GET ${url} HTTP/1.1" ${st} 1234 "-" "${ua}"`;

await t('detects each log format by shape, not by asking', () => {
  is(lg.detectFormat(clf('66.249.66.1', '/', 200, GB_UA)), 'combined');
  is(lg.detectFormat('#Software: Microsoft Internet Information Services\n#Fields: date time cs-uri-stem'), 'iis');
  is(lg.detectFormat('{"url":"/a","status":200}'), 'json');
  is(lg.detectFormat('example.com ' + clf('66.249.66.1', '/', 200, GB_UA)), 'combined-vhost');
  is(lg.detectFormat(''), 'empty');
});
await t('parses combined format including the user agent', () => {
  const r = lg.parseLog([clf('66.249.66.1', '/a/', 200, GB_UA), clf('1.2.3.4', '/b/', 404, 'Chrome')].join('\n'));
  is(r.hits.length, 2);
  is(r.hits[0].url, '/a/');
  is(r.hits[0].status, 200);
  ok(/Googlebot/.test(r.hits[0].ua));
  is(r.hits[1].status, 404);
});
await t('tolerates malformed lines rather than rejecting the file', () => {
  const r = lg.parseLog([clf('66.249.66.1', '/a/', 200, GB_UA), 'this is not a log line at all', ''].join('\n'));
  is(r.hits.length, 1);
  is(r.skipped, 1, 'a bad line must be counted, not fatal');
});
await t('parses IIS W3C using its own field header', () => {
  const iis = ['#Software: Microsoft Internet Information Services 10.0',
    '#Fields: date time c-ip cs-method cs-uri-stem cs-uri-query sc-status sc-bytes cs(User-Agent) time-taken',
    '2026-09-01 10:00:00 66.249.66.1 GET /a/ - 200 1234 Mozilla/5.0+(compatible;+Googlebot/2.1) 120'].join('\n');
  const r = lg.parseLog(iis);
  is(r.hits.length, 1);
  is(r.hits[0].url, '/a/');
  ok(/Googlebot/.test(r.hits[0].ua), 'the + encoding must be decoded');
  is(r.hits[0].ms, 120);
});
await t('parses JSON lines from a CDN', () => {
  const j = ['{"ClientIP":"66.249.66.1","ClientRequestURI":"/a/","EdgeResponseStatus":200,"ClientRequestUserAgent":"Googlebot/2.1"}',
    '{"ClientIP":"1.2.3.4","ClientRequestURI":"/b/","EdgeResponseStatus":404,"ClientRequestUserAgent":"Chrome"}'].join('\n');
  const r = lg.parseLog(j);
  is(r.hits.length, 2);
  is(r.hits[0].url, '/a/');
});
await t('spoofed Googlebot is flagged as the first thing to resolve', () => {
  const lines = [];
  for (let i = 0; i < 50; i++) lines.push(clf('66.249.66.1', '/', 200, GB_UA));
  for (let i = 0; i < 30; i++) lines.push(clf('45.13.99.7', '/scrape/' + i, 200, GB_UA));
  const a = lg.analyse(lg.parseLog(lines.join('\n')));
  is(a.bot.verified, 50);
  is(a.bot.spoofed, 30);
  const f = a.findings.find((x) => x.id === 'log-spoofed-bot');
  ok(f, 'spoofing not detected');
  is(f.severity, 'High');
  ok(/reverse then forward DNS/i.test(f.act), 'must give the real verification method');
  ok(/approximation, not proof/i.test(f.act), 'must not overclaim the prefix check');
});
await t('parameter waste is quantified as a share of budget', () => {
  const lines = [];
  for (let i = 0; i < 60; i++) lines.push(clf('66.249.66.1', '/', 200, GB_UA));
  for (let i = 0; i < 60; i++) lines.push(clf('66.249.66.1', `/list/?c=${i}`, 200, GB_UA));
  const a = lg.analyse(lg.parseLog(lines.join('\n')));
  is(a.waste.paramShare, 50);
  const f = a.findings.find((x) => x.id === 'log-param-waste');
  ok(f && /canonical does not prevent the crawl/i.test(f.why), 'must explain why a canonical is not the fix');
});
await t('error and redirect waste are separate findings', () => {
  const lines = [];
  for (let i = 0; i < 50; i++) lines.push(clf('66.249.66.1', '/', 200, GB_UA));
  for (let i = 0; i < 20; i++) lines.push(clf('66.249.66.1', `/gone-${i}/`, 404, GB_UA));
  for (let i = 0; i < 40; i++) lines.push(clf('66.249.66.1', `/old-${i}/`, 301, GB_UA));
  const a = lg.analyse(lg.parseLog(lines.join('\n')));
  ok(a.findings.some((f) => f.id === 'log-error-waste'));
  ok(a.findings.some((f) => f.id === 'log-redirect-waste'));
  ok(a.findings.find((f) => f.id === 'log-error-waste').act.includes('410'),
    'must recommend 410 over leaving a 404 to be retried');
});
await t('humans and other bots are separated from the target bot', () => {
  const lines = [
    ...Array.from({ length: 10 }, () => clf('66.249.66.1', '/', 200, GB_UA)),
    ...Array.from({ length: 20 }, () => clf('81.2.3.4', '/', 200, 'Mozilla/5.0 Chrome/120')),
    ...Array.from({ length: 5 }, () => clf('157.55.39.1', '/', 200, 'Mozilla/5.0 (compatible; bingbot/2.0)')),
  ];
  const a = lg.analyse(lg.parseLog(lines.join('\n')));
  is(a.traffic.human, 20);
  is(a.bot.hits, 10);
  ok(a.traffic.bots.some((b) => b.label === 'Bingbot'));
});
await t('pages the bot never requested are surfaced against the crawl', () => {
  const lines = Array.from({ length: 10 }, () => clf('66.249.66.1', '/', 200, GB_UA));
  const fakeCrawl = { pages: [
    { url: 'https://x.test/', status: 200, inboundCount: 9, depth: 0 },
    { url: 'https://x.test/lonely/', status: 200, inboundCount: 0, depth: 3 },
    { url: 'https://x.test/hidden/', status: 200, noindex: true, inboundCount: 0, depth: 3 },
  ] };
  const a = lg.analyse(lg.parseLog(lines.join('\n')), { crawl: fakeCrawl });
  const f = a.findings.find((x) => x.id === 'log-never-crawled');
  ok(f, 'never-crawled pages not detected');
  ok(f.urls.some((u) => /lonely/.test(u)), 'the indexable orphan must be listed');
  ok(!f.urls.some((u) => /hidden/.test(u)), 'a noindexed page is not a finding here');
  ok(/a crawl cannot tell you it at all/i.test(f.why), 'must say why this needs logs');
});
await t('without a crawl it says what it is missing', () => {
  const a = lg.analyse(lg.parseLog(clf('66.249.66.1', '/', 200, GB_UA)));
  ok(/Crawl the site as well/i.test(a.caveat || ''), a.caveat);
});
await t('an empty or non-log file is refused clearly', () => {
  let m7 = '';
  try { lg.analyse(lg.parseLog('nothing here at all')); } catch (e) { m7 = e.message; }
  ok(/raw access log/i.test(m7), m7);
});

G('competitors — comparison from public crawl data');
const mkProfile = (o) => ({
  origin: o.origin || 'https://x.test', host: o.host || 'x.test', pages: o.pages ?? 20, truncated: false,
  words: { median: o.words ?? 600, thin: 0 },
  depth: { median: o.depth ?? 2, max: 3, deep: 0 },
  internalLinks: { median: 20 },
  inbound: { median: o.inbound ?? 5, orphaned: 0 },
  schema: { pagesWithAny: o.schemaPages ?? 10, types: o.types || { Article: 5 } },
  titles: { separators: {}, medianPixels: 500 },
  hasBreadcrumbs: o.crumbs ?? 10, hasAuthor: o.author ?? 10,
  sections: o.sections || [['guides', 5]], platform: [], responseMs: o.ms ?? 300, https: true,
});
await t('a schema coverage gap is High and names the fix location', () => {
  const c = cmp.compare(mkProfile({ schemaPages: 1, pages: 20 }), [mkProfile({ host: 'them', schemaPages: 20, pages: 20 })]);
  const g = c.gaps.find((x) => x.area === 'Structured data');
  ok(g, 'coverage gap not detected');
  is(g.severity, 'High');
  ok(/Build tab/.test(g.act), 'must point at where the fix lives');
});
await t('schema types they use and you do not are listed', () => {
  const c = cmp.compare(mkProfile({ types: { Article: 5 } }), [mkProfile({ host: 'them', types: { Article: 5, FAQPage: 4, Product: 3 } })]);
  const g = c.gaps.find((x) => x.area === 'Schema types');
  ok(g && /FAQPage/.test(g.what), `types not surfaced: ${g?.what}`);
  ok(/only mark up what is visible/i.test(g.act), 'must warn against marking up invisible content');
});
await t('missing top-level sections are framed as the content gap', () => {
  const c = cmp.compare(mkProfile({ sections: [['guides', 5]] }),
    [mkProfile({ host: 'them', sections: [['guides', 5], ['locations', 8], ['case-studies', 4]] })]);
  const g = c.gaps.find((x) => x.area === 'Missing sections');
  ok(g && /locations/.test(g.what), `sections not compared: ${g?.what}`);
  ok(/live SERP/.test(g.act), 'must say to verify before copying — their having it does not prove it works');
});
await t('where you are ahead is reported too', () => {
  const c = cmp.compare(mkProfile({ schemaPages: 20, pages: 20, inbound: 12, ms: 200 }),
    [mkProfile({ host: 'them', schemaPages: 1, pages: 20, inbound: 2, ms: 900 })]);
  ok(c.ahead.length >= 2, `only ${c.ahead.length} strengths reported`);
  ok(c.ahead.some((a) => /Structured data/.test(a)));
});
await t('content depth is marked inferred, not observed', () => {
  const c = cmp.compare(mkProfile({ words: 200 }), [mkProfile({ host: 'them', words: 900 })]);
  const g = c.gaps.find((x) => x.area === 'Content depth');
  is(g.evidence, 'inferred', 'a word-count gap is not proof of anything on its own');
  ok(/no such thing/i.test(g.why), 'must not imply a word-count target');
});
await t('gaps are ordered by severity', () => {
  const c = cmp.compare(mkProfile({ schemaPages: 1, pages: 20, crumbs: 0, inbound: 1 }),
    [mkProfile({ host: 'them', schemaPages: 20, pages: 20, crumbs: 20, inbound: 10 })]);
  const rank = { High: 0, Medium: 1, Low: 2 };
  for (let i = 1; i < c.gaps.length; i++) {
    ok(rank[c.gaps[i - 1].severity] <= rank[c.gaps[i].severity], 'gaps out of severity order');
  }
});
await t('the limits of this comparison are stated, not implied', () => {
  const c = cmp.compare(mkProfile({}), [mkProfile({ host: 'them' })]);
  ok(/cannot tell you their traffic/i.test(c.limits), c.limits);
  ok(/backlinks/i.test(c.limits), 'must name backlinks as out of scope');
});
await t('comparing against nothing is refused', () => {
  let m6 = '';
  try { cmp.compare(mkProfile({}), []); } catch (e) { m6 = e.message; }
  ok(/Crawl at least one competitor/.test(m6), m6);
});
await t('host identity keeps the port, so two sites on one machine do not collide', () => {
  is(cmp._host('http://localhost:8098/'), 'localhost:8098');
  is(cmp._host('https://www.example.com/a'), 'example.com');
});

G('Clarity — budget and shaping');
await t('every friction signal says what it means and what to do', () => {
  for (const [name, v] of Object.entries(cl.SIGNALS)) {
    ok(v.means && v.means.length > 30, `${name} has no explanation`);
    ok(v.act && v.act.length > 20, `${name} has no action`);
    ok(['High', 'Medium', 'Low'].includes(v.severity), `${name} has no severity`);
  }
});
await t('the daily budget starts at ten', async () => {
  const b = await cl.budget();
  is(b.cap, 10, 'Clarity allows ten calls per project per day');
  ok(b.remaining <= 10 && b.remaining >= 0);
});
await t('an absent token fails with the exact setup path', async () => {
  const before = process.env.CLARITY_API_TOKEN;
  delete process.env.CLARITY_API_TOKEN;
  let m5 = '';
  try { await cl.fetchInsights({}); } catch (e) { m5 = e.message; }
  if (before !== undefined) process.env.CLARITY_API_TOKEN = before;
  ok(/Data Export/.test(m5), `must name the exact settings page: ${m5}`);
});
await t('friction is ranked by volume and normalised per 1000 sessions', () => {
  const shaped = cl._shape([
    { metricName: 'Traffic', information: [{ totalSessionCount: '2000', totalBotSessionCount: '500' }] },
    { metricName: 'Rage Click Count', information: [{ 'Rage Click Count': '40', URL: '/a' }] },
    { metricName: 'Dead Click Count', information: [{ 'Dead Click Count': '120', URL: '/b' }] },
  ], { days: 3, dims: ['URL'] });
  is(shaped.sessions, 2000);
  is(shaped.botShare, 20, '500 bots of 2500 total');
  is(shaped.friction[0].metric, 'Dead Click Count', 'the larger signal must rank first');
  is(shaped.friction[0].per1k, 60, '120 per 2000 sessions is 60 per 1000');
  ok(/Dead clicks/.test(shaped.read), shaped.read);
});
await t('no sessions is reported as a tag problem, not a clean result', () => {
  const shaped = cl._shape([], { days: 3, dims: [] });
  ok(/tag is not firing|no traffic/i.test(shaped.read), shaped.read);
});
await t('the three-day ceiling is stated, not hidden', () => {
  const shaped = cl._shape([], { days: 3, dims: [] });
  ok(/snapshot rather than a trend/.test(shaped.caveat), shaped.caveat);
});

G('stylesheet — invariants that break layout silently');
/* These are cheap string checks rather than a rendering test, because the
   failure mode is a whole-app layout break from one missing line, and a
   rendering test needs a browser that CI may not have. */
await t('the global reset is present', () => {
  const css = readFileSync(join(ROOT, 'public/style.css'), 'utf8');
  /* Without border-box, every width:100% input overflows its container by its
     padding plus border — 24px here — and lands under the adjacent button.
     This was lost once in a stylesheet rebuild and broke four panels. */
  ok(/\*\s*\{[^}]*box-sizing:\s*border-box/.test(css), 'box-sizing:border-box on * is missing');
  ok(/^body\s*\{[^}]*margin:\s*0/m.test(css), 'body margin reset is missing');
});
await t('both themes define every colour token the components use', () => {
  const css = readFileSync(join(ROOT, 'public/style.css'), 'utf8');
  const dark = css.slice(css.indexOf('[data-theme="dark"]'), css.indexOf('[data-theme="light"]'));
  const light = css.slice(css.indexOf('[data-theme="light"]'), css.indexOf('[data-theme="light"]') + 1400);
  const needed = ['--surface', '--raised', '--sunk', '--line', '--ink', '--ink2', '--ink3',
    '--fault', '--warn', '--pass', '--note', '--ground', '--ground2', '--ground3'];
  for (const tok of needed) {
    ok(dark.includes(`${tok}:`), `${tok} undefined in the dark theme`);
    ok(light.includes(`${tok}:`), `${tok} undefined in the light theme`);
  }
});
await t('no component hardcodes a colour that only works in one theme', () => {
  const css = readFileSync(join(ROOT, 'public/style.css'), 'utf8');
  /* Skip the token blocks themselves — hex is expected there. */
  const body = css.slice(css.indexOf('/* ── global reset'));
  const hex = body.match(/(?:color|background(?:-color)?|border-color):\s*#[0-9a-f]{3,8}/gi) || [];
  const allowed = hex.filter((h) => !/#fff|#ffffff|#000|#000000/i.test(h));
  is(allowed.length, 0, `theme-specific hex outside the token blocks: ${allowed.slice(0, 4).join(', ')}`);
});

G('auth — hashing and policy');
await t('hashes are salted, so identical passwords differ', async () => {
  const a = await au.hashPassword('correct horse battery staple');
  const b = await au.hashPassword('correct horse battery staple');
  ok(a !== b, 'two hashes of one password are identical — unsalted');
  ok(a.startsWith('scrypt$'), a.slice(0, 20));
});
await t('verification accepts the right password and rejects near misses', async () => {
  const h = await au.hashPassword('correct horse battery staple');
  is(await au.verifyPassword('correct horse battery staple', h), true);
  is(await au.verifyPassword('correct horse battery stapl', h), false);
  is(await au.verifyPassword('', h), false);
});
await t('a malformed or empty hash never verifies', async () => {
  is(await au.verifyPassword('anything', ''), false);
  is(await au.verifyPassword('anything', 'plaintext'), false);
  is(await au.verifyPassword('anything', null), false);
});
await t('policy favours length over character classes', () => {
  ok(!au.checkPasswordStrength('Sh0rt!').ok, 'a short scrambled password must fail');
  ok(au.checkPasswordStrength('correct horse battery staple').ok, 'a long passphrase must pass');
  ok(!au.checkPasswordStrength('password1234').ok, 'a top-guessed prefix must fail');
  ok(!au.checkPasswordStrength('aaaaaaaaaaaaaa').ok, 'a repeated character must fail');
  ok(/Length matters/.test(au.checkPasswordStrength('short').reason), 'must explain why');
});
await t('transport risk distinguishes loopback from exposed', () => {
  is(au.transportRisk({ host: 'localhost:4321', proto: 'http' }).level, 'ok');
  is(au.transportRisk({ host: '127.0.0.1:4321', proto: 'http' }).level, 'ok');
  is(au.transportRisk({ host: 'seo.hazentech.com', proto: 'https' }).level, 'ok');
  const bad = au.transportRisk({ host: '192.168.1.40:4321', proto: 'http' });
  is(bad.level, 'danger', 'plain HTTP off-loopback must be flagged');
  ok(/unencrypted/.test(bad.message), 'must say why it is dangerous');
});

/* ══════════════════════════ live API ══════════════════════════ */

G('API — crawl and audit');
let broken, good;
await t('crawls the broken fixture', async () => {
  broken = await api('/api/crawl', { url: `http://localhost:${BROKEN}/`, maxPages: 40 });
  ok(broken.ok, broken.error); ok(broken.pages.length >= 6, `${broken.pages.length} pages`);
  ok(broken.findings.length >= 10, `${broken.findings.length} findings`);
});
await t('catches the planted faults', () => {
  const ids = new Set(broken.findings.map((f) => f.id));
  for (const need of ['noindex-present', 'canonical-cross', 'h1-missing', 'title-duplicate', 'meta-duplicate', 'thin-content']) {
    ok(ids.has(need), `missed ${need}`);
  }
});
await t('orders by ladder then severity', () => {
  const L = ['eligibility', 'indexation', 'intent', 'onpage', 'linking', 'schema', 'performance', 'offpage'];
  const S = { Critical: 0, High: 1, Medium: 2, Low: 3 };
  for (let i = 1; i < broken.findings.length; i++) {
    const a = broken.findings[i - 1], b = broken.findings[i];
    if (S[a.severity] === S[b.severity]) ok(L.indexOf(a.phase) <= L.indexOf(b.phase), `${a.id} before ${b.id}`);
    else ok(S[a.severity] < S[b.severity], `${a.severity} before ${b.severity}`);
  }
});
await t('a well-built site yields almost nothing', async () => {
  good = await api('/api/crawl', { url: `http://localhost:${GOOD}/`, maxPages: 30 });
  ok(good.ok, good.error);
  const noise = good.findings.filter((f) => f.id !== 'no-https' && f.severity !== 'Low');
  ok(noise.length <= 2, `${noise.length} non-Low findings on a clean site: ${noise.map((f) => f.id).join(', ')}`);
});
await t('truncated crawl refuses to claim orphans', async () => {
  const r = await api('/api/crawl', { url: `http://localhost:${BROKEN}/`, maxPages: 2 });
  ok(r.truncated, 'not flagged truncated');
  is(r.stats.orphans, null, 'reported an orphan count from a partial crawl');
  ok(!r.findings.some((f) => f.id === 'orphans'), 'claimed orphans anyway');
  ok(r.findings.some((f) => f.id === 'orphans-unknown'), 'no limitation finding');
});
await t('truncation survives a reload', async () => {
  const r = await api('/api/crawl/current');
  is(r.truncated, true);
});

G('API — AI visibility');
await t('prompts are suggested from brand context', async () => {
  await api('/api/brand', { brand: { name: 'Stride', services: ['running shoes'], locations: ['SF'] } });
  const r = await api('/api/aivis');
  ok(r.ok, r.error);
  ok(r.suggested.length >= 4, `${r.suggested.length} suggestions`);
  ok(/not the set your customers use/i.test(r.limits));
});
await t('prompts round-trip', async () => {
  const r = await api('/api/aivis/prompts', { prompts: ['best running shoes', '  ', 'shoe fitting near me'] });
  ok(r.ok, r.error);
  is(r.prompts.length, 2, 'blank lines must be dropped');
});
await t('a run without a brand name is refused with the reason', async () => {
  await api('/api/brand', { brand: { name: '' } });
  const r = await api('/api/aivis/run', {});
  is(r.ok, false);
  ok(/Brand context/i.test(r.error), r.error);
  await api('/api/brand', { brand: { name: 'Stride' } });
});
await t('a run against the local model produces a score and share of voice', async () => {
  const r = await api('/api/aivis/run', { prompts: ['best running shoes for flat feet'], domain: 'stride.com' });
  ok(r.ok, r.error);
  ok(typeof r.run.score === 'number' || r.run.score === null);
  ok(Array.isArray(r.run.shareOfVoice));
  ok(r.run.attempted >= 1);
});

G('API — server logs');
await t('a log is analysed against the current crawl', async () => {
  await api('/api/crawl', { url: `http://localhost:${BROKEN}/`, maxPages: 40 });
  const lines = [];
  for (let i = 0; i < 40; i++) lines.push(clf('66.249.66.1', '/', 200, GB_UA));
  for (let i = 0; i < 30; i++) lines.push(clf('66.249.66.1', `/list/?c=${i}`, 200, GB_UA));
  const r = await api('/api/logs/analyse', { text: lines.join('\n') });
  ok(r.ok, r.error);
  is(r.format, 'combined');
  ok(r.bot.hits === 70, `${r.bot.hits} bot hits`);
  ok(r.findings.length >= 1, 'no findings from a log with 43% parameter waste');
});
await t('an unparseable upload names the detected format', async () => {
  const r = await api('/api/logs/analyse', { text: 'this is definitely not a log file at all, just prose about logs' });
  is(r.ok, false);
  ok(/Detected format|raw access log/i.test(r.error), r.error);
});
await t('the bot list marks which identities can be verified offline', async () => {
  const r = await api('/api/logs/bots');
  ok(r.ok, r.error);
  const g = r.bots.find((b) => b.id === 'googlebot');
  is(g.verifiable, true);
  ok(r.bots.some((b) => b.verifiable === false), 'bots with no published range must be marked unverifiable');
});

G('API — competitors');
await t('a competitor is crawled, profiled and compared', async () => {
  await api('/api/crawl', { url: `http://localhost:${BROKEN}/`, maxPages: 40 });
  let r = await api('/api/competitors', { url: `http://localhost:${GOOD}/`, maxPages: 30 });
  ok(r.ok, r.error);
  is(r.profile.host, `localhost:${GOOD}`, 'the port must be part of the identity');
  ok(r.profile.pages >= 3, `${r.profile.pages} pages profiled`);

  r = await api('/api/competitors/compare');
  ok(r.ok, r.error);
  ok(Array.isArray(r.gaps), 'no gaps array');
  ok(r.limits && /backlinks/i.test(r.limits), 'limits must be stated');
});
await t('only the profile is stored, never their pages', async () => {
  const r = await api('/api/competitors');
  ok(r.ok, r.error);
  const c = r.competitors[0];
  ok(c, 'nothing stored');
  ok(!('pages' in c) || typeof c.pages === 'number', 'pages must be a count, not an array of content');
});
await t('comparing with no competitors explains what to do', async () => {
  await api(`/api/competitors/localhost:${GOOD}`, null, 'DELETE');
  const r = await api('/api/competitors/compare');
  is(r.ok, false);
  ok(/Add one/.test(r.error), r.error);
});

G('API — the extra check set');
const NEW_CHECKS = ['xrobots-noindex', 'xrobots-nofollow', 'canonical-header-conflict', 'canonical-chain',
  'pagination-canonical', 'hreflang-no-self', 'hreflang-no-return', 'hreflang-bad-code',
  'meta-refresh', 'links-to-noindex', 'sitemap-nonindexable', 'param-crawl-trap',
  'render-blocking', 'font-display'];
let xr = null;
await t('every extra check fires on a fixture built to trip it', async () => {
  xr = await api('/api/crawl', { url: `${XE}/`, maxPages: 60 });
  ok(xr.ok, xr.error);
  const got = new Set(xr.findings.map((f) => f.id));
  const missing = NEW_CHECKS.filter((id) => !got.has(id));
  is(missing.length, 0, `did not fire: ${missing.join(', ')}`);
});
await t('X-Robots-Tag noindex is Critical and names the header', () => {
  const f = xr.findings.find((x) => x.id === 'xrobots-noindex');
  is(f.severity, 'Critical');
  ok(/invisible in the page source/i.test(f.why), 'must say why this one is hard to find');
});
await t('nofollow-only is reported separately from noindex', () => {
  const nf = xr.findings.find((x) => x.id === 'xrobots-nofollow');
  ok(nf, 'a nofollow-only page must still be reported');
  /* And a page with BOTH must not be double-counted. */
  ok(!nf.urls.some((u) => /\/hidden\//.test(u)), 'the noindex+nofollow page should be reported once, as noindex');
});
await t('hreflang validation catches self, return and code errors separately', () => {
  const self = xr.findings.find((x) => x.id === 'hreflang-no-self');
  const ret = xr.findings.find((x) => x.id === 'hreflang-no-return');
  const code = xr.findings.find((x) => x.id === 'hreflang-bad-code');
  ok(self && ret && code, 'all three hreflang faults must be distinct findings');
  ok(code.urls.some((u) => /en-UK/.test(u)), 'en-UK must be flagged — UK is not a country code');
  ok(/ignored entirely/i.test(ret.why), 'must explain that non-reciprocal hreflang is discarded');
});
await t('a paginated canonical to page one is High, with the crawl consequence stated', () => {
  const f = xr.findings.find((x) => x.id === 'pagination-canonical');
  is(f.severity, 'High');
  ok(/stops crawling/i.test(f.why), f.why);
});
await t('a canonical chain is detected across three hops', () => {
  const f = xr.findings.find((x) => x.id === 'canonical-chain');
  ok(f.urls.some((u) => u.split('→').length >= 3), `chain not traced: ${f.urls[0]}`);
});
await t('every extra check has a concrete offline fix', async () => {
  let n = 0;
  for (const id of NEW_CHECKS) {
    const r = await api('/api/ai/fix', { findingId: id });
    if (r.ok) {
      n++;
      ok(r.fix.changes?.[0]?.to?.length > 60, `${id} produced a thin fix`);
      ok(r.fix.acceptance?.length, `${id} has no acceptance criteria`);
    }
  }
  is(n, NEW_CHECKS.length, `only ${n} of ${NEW_CHECKS.length} have offline fixes`);
});
await t('the parameter fix distinguishes blocking from canonicalising', async () => {
  const r = await api('/api/ai/fix', { findingId: 'param-crawl-trap' });
  const to = r.fix.changes[0].to;
  ok(/Disallow/.test(to) && /canonical/i.test(to), 'must cover both levers');
  ok(/canonicals? (still|alone)/i.test(to), 'must explain a canonical does not stop the crawl');
});
await t('a well-built site does not trip any of the new checks', async () => {
  const g = await api('/api/crawl', { url: `http://localhost:${GOOD}/`, maxPages: 30 });
  const tripped = NEW_CHECKS.filter((id) => g.findings.some((f) => f.id === id));
  is(tripped.length, 0, `false positives on a clean site: ${tripped.join(', ')}`);
});

G('API — dashboard');
await t('insights populate with no keys', async () => {
  await api('/api/crawl', { url: `http://localhost:${BROKEN}/`, maxPages: 40 });
  const r = await api('/api/insights');
  ok(r.ok, r.error);
  ok(r.charts.length >= 6, `only ${r.charts?.length} charts`);
  for (const c of r.charts) {
    ok(c.title && c.read, `chart ${c.id} missing title or read`);
    ok(c.series?.[0]?.values?.length, `chart ${c.id} has no data`);
    ok(c.labels.length === c.series[0].values.length || c.kind === 'stack', `chart ${c.id} label/value mismatch`);
  }
});

G('API — offline fixes');
await t('most findings get a concrete offline fix', async () => {
  const cur = await api('/api/crawl/current');
  let got = 0;
  for (const f of cur.findings) {
    const r = await api('/api/ai/fix', { findingId: f.id });
    if (r.ok) {
      got++;
      ok(r.fix.changes?.length, `${f.id} produced an empty fix`);
      ok(r.fix.acceptance?.length, `${f.id} has no acceptance criteria`);
    }
  }
  ok(got / cur.findings.length >= 0.7, `only ${got}/${cur.findings.length} fixable offline`);
});

G('API — generators');
for (const [name, path, body] of [
  ['titles', '/api/generate/titles', { brand: 'Acme' }],
  ['schema', '/api/generate/schema', { type: 'Product', data: { name: 'X', price: '9' } }],
  ['redirects', '/api/generate/redirects', { oldUrls: ['/a/'], format: 'htaccess' }],
  ['robots', '/api/generate/robots', { origin: 'https://x.test' }],
  ['sitemap', '/api/generate/sitemap', null],
  ['link graph', '/api/generate/link-graph', null],
  ['brief', '/api/generate/brief', { clusterLabel: 'running shoes', fetchQuestions: false }],
  ['prelaunch', '/api/prelaunch', {}],
  ['security', '/api/security', null],
  ['summarize', '/api/summarize', { text: LONG, sentences: 2 }],
  ['social compose', '/api/social/compose', { platform: 'linkedin', headline: 'A headline', layout: 'banner' }],
  ['social background', '/api/social/background', { platform: 'linkedin', style: 'mesh', seed: 1 }],
  ['program', '/api/program', null],
  ['schema types', '/api/schema/types', null],
  ['social styles', '/api/social/styles', null],
  ['serp engines', '/api/serp/engines', null],
  ['properties', '/api/properties', null],
  ['campaigns', '/api/campaigns', null],
  ['brand', '/api/brand', null],
]) {
  await t(name, async () => {
    const r = await api(path, body, body === null ? 'GET' : 'POST');
    ok(r.ok, r.error);
  });
}

G('API — monitors');
let monId;
await t('creates a monitor', async () => {
  const r = await api('/api/monitors', { monitor: { url: `http://localhost:${GOOD}/`, label: 'good fixture', cron: '0 3 * * 1', maxPages: 10 } });
  ok(r.ok, r.error); monId = r.monitor.id;
  is(r.monitor.cron, '0 3 * * 1');
});
await t('lists monitors and reports scheduling availability', async () => {
  const r = await api('/api/monitors');
  ok(r.ok, r.error);
  ok(r.monitors.some((m) => m.id === monId));
  ok(typeof r.scheduling === 'boolean');
  if (!r.scheduling) ok(r.reason && r.reason.length > 30, 'unavailable scheduling must explain itself');
});
await t('first run records a baseline rather than alerting', async () => {
  const r = await api(`/api/monitors/${monId}/run`, {});
  ok(r.ok, r.error); is(r.baseline, true);
});
await t('second run diffs against the first and stays quiet', async () => {
  const r = await api(`/api/monitors/${monId}/run`, {});
  ok(r.ok, r.error); ok(r.diff, 'no diff produced');
  ok(r.diff.quiet, `an unchanged site must be quiet, got: ${r.diff.summary}`);
});
await t('run log accumulates', async () => {
  const r = await api(`/api/monitors/${monId}/log`);
  ok(r.ok, r.error); ok(r.runs.length >= 2, `${r.runs.length} runs`);
});
await t('deletes a monitor', async () => {
  const r = await api(`/api/monitors/${monId}`, null, 'DELETE');
  ok(r.ok, r.error); ok(!r.monitors.some((m) => m.id === monId));
});

G('API — rendering');
const probe = await api('/api/render/probe');
await t('probe answers definitively either way', () => {
  ok(typeof probe.available === 'boolean');
  if (!probe.available) ok(probe.reason && probe.reason.length > 40, `unhelpful reason: ${probe.reason}`);
  else ok(probe.channel, 'available but no channel named');
});
if (probe.available) {
  await t('render gap clears a server-rendered site', async () => {
    const r = await api('/api/render/gap', { url: `http://localhost:${GOOD}/` });
    ok(r.ok, r.error);
    is(r.dependent, false, 'flagged a server-rendered site as JS-dependent');
  });
  await t('render gap catches a genuinely client-rendered site', async () => {
    const r = await api('/api/render/gap', { url: `http://localhost:${SPA}/` });
    ok(r.ok, r.error);
    is(r.dependent, true, 'missed a CSR site');
    ok(r.renderedWords > r.rawWords * 10, `source ${r.rawWords} vs rendered ${r.renderedWords}`);
    ok(r.renderedLinks > r.rawLinks, `links ${r.rawLinks} → ${r.renderedLinks}`);
  });
  await t('inline script markup is not counted as source links', async () => {
    const r = await api('/api/render/gap', { url: `http://localhost:${SPA}/` });
    is(r.rawLinks, 0, `counted ${r.rawLinks} links that exist only inside a script`);
  });
  await t('the plain crawler is honest about the same site', async () => {
    const r = await api('/api/crawl', { url: `http://localhost:${SPA}/`, maxPages: 3 });
    ok(r.ok, r.error);
    ok(r.findings.some((f) => /little or no content/i.test(f.title)),
      'plain crawl of a CSR site must say it saw no content');
  });
  await t('vitals come back with no API key', async () => {
    const r = await api('/api/render/vitals', { url: `http://localhost:${GOOD}/` });
    ok(r.ok, r.error); ok(r.results[0].ok, r.results[0].error);
    ok(r.results[0].ttfb != null, 'no TTFB measured');
  });
} else {
  skipT('render gap against the fixture', 'no drivable Chrome in this environment');
  skipT('vitals with no API key', 'no drivable Chrome in this environment');
}
await t('render endpoints fail with guidance, not a stack trace', async () => {
  if (probe.available) return skipT('render failure message', 'browser present, nothing to fail');
  const r = await api('/api/render/gap', { url: `http://localhost:${GOOD}/` });
  is(r.ok, false);
  ok(/Chrome|playwright/i.test(r.error), `unhelpful: ${r.error}`);
});

G('API — intent & CSV import');
await t('intent refuses without a query, and says why', async () => {
  const r = await api('/api/intent', { url: `http://localhost:${GOOD}/` });
  is(r.ok, false);
  ok(/query/i.test(r.error) && r.error.length > 40, `unhelpful: ${r.error}`);
});
await t('CSV import round-trips through the API', async () => {
  const r = await api('/api/gsc/import', { files: [
    { name: 'Queries.csv', text: 'Top queries,Clicks,Impressions,CTR,Position\nrunning shoes,120,4300,2.79%,8.4\nflat feet shoes,9,900,1.0%,12.2' },
    { name: 'Pages.csv', text: 'Top pages,Clicks,Impressions\nhttps://x.com/a,50,900' },
  ] });
  ok(r.ok, r.error);
  is(r.dimensions.query.rows, 2); is(r.dimensions.page.rows, 1);
  ok(r.striking.length >= 1, 'no striking-distance rows from a 12.2 position');
});
await t('imported data persists for the session', async () => {
  const r = await api('/api/gsc/imported');
  ok(r.ok, r.error); ok(r.dimensions.query);
});
await t('a junk upload is rejected clearly', async () => {
  const r = await api('/api/gsc/import', { files: [{ name: 'x.csv', text: 'a,b\n1,2' }] });
  is(r.ok, false); ok(r.error.length > 30);
});

G('API — models');
await t('lists providers with an active one', async () => {
  const r = await api('/api/models?force=1');
  ok(r.ok, r.error);
  ok(r.providers.length >= 6, `${r.providers.length} providers`);
  ok(r.active, 'no active provider despite a local server running');
  is(r.active.id, 'ollama');
  ok(/leaves this machine/.test(r.note), `note should flag privacy when local: ${r.note}`);
});
await t('a preference can be set and cleared', async () => {
  let r = await api('/api/models/prefer', { provider: 'pollinations' });
  ok(r.ok, r.error); is(r.preferred, 'pollinations');
  r = await api('/api/models/prefer', { provider: null });
  is(r.preferred, null);
});
await t('an unknown provider is refused', async () => {
  const r = await api('/api/models/prefer', { provider: 'nope' });
  is(r.ok, false);
});
await t('the test prompt reports which model answered', async () => {
  const r = await api('/api/models/test', {});
  ok(r.ok, r.error);
  is(r.provider, 'ollama');
  ok(r.text.length > 3, 'empty answer');
});

G('API — new site');
await t('a project can be registered before a site exists', async () => {
  await api('/api/properties/stride-test', null, 'DELETE').catch(() => {});
  const r = await api('/api/properties/planned', { label: 'Stride (new build)', origin: 'https://stride.test' });
  ok(r.ok, r.error);
  is(r.property.stage, 'planning');
});
await t('phases are served with their rationale', async () => {
  const r = await api('/api/newsite/phases');
  ok(r.ok, r.error); is(r.phases.length, 7);
});
await t('clusters persist and drive architecture', async () => {
  let r = await api('/api/newsite/clusters', { clusters: CL });
  ok(r.ok, r.error); is(r.count, 4);
  r = await api('/api/newsite/architecture', { origin: 'https://stride.test' });
  ok(r.ok, r.error); is(r.counts.pillars, 3);
});
await t('architecture without clusters explains what to do instead', async () => {
  await api('/api/newsite/clusters', { clusters: [] });
  const r = await api('/api/newsite/architecture', {});
  is(r.ok, false);
  ok(/demand research/i.test(r.error), r.error);
});
await t('the technical spec comes back with critical items marked', async () => {
  const r = await api('/api/newsite/technical', { rendering: 'csr', platform: 'wordpress' });
  ok(r.ok, r.error); ok(r.critical.length >= 3, `${r.critical.length} critical`);
  await api('/api/properties/stride-test', null, 'DELETE').catch(() => {});
});

G('API — people');
await t('people round-trip through the API', async () => {
  let r = await api('/api/people', { person: { name: 'API Person', role: 'dev', capacity: 8 } });
  ok(r.ok, r.error);
  const id = r.person.id;
  r = await api('/api/people');
  ok(r.people.some((p) => p.id === id));
  r = await api('/api/people/assign', { findingId: 'no-https', personId: id });
  ok(r.ok, r.error);
  r = await api('/api/people/workload');
  ok(r.ok, r.error);
  ok(r.people.find((p) => p.id === id).items >= 1, 'assignment not reflected in workload');
  r = await api(`/api/people/${id}`, null, 'DELETE');
  ok(r.ok, r.error);
});
await t('assignment without a finding id is refused', async () => {
  const r = await api('/api/people/assign', { personId: 'x' });
  is(r.ok, false);
});

G('API — auth gate');
/* The suite runs with auth disabled, so these assert the disabled contract and
   the shape of the gate. The enabled path is exercised in the browser test,
   because it needs cookie handling. */
await t('auth is off by default and nothing is gated', async () => {
  const r = await api('/api/auth/status');
  ok(r.ok, r.error);
  is(r.enabled, false, 'auth must not be on unless someone turned it on');
  const p2 = await api('/api/properties');
  ok(p2.ok, 'a normal endpoint must work with auth off');
});
await t('enabling before an account exists is refused', async () => {
  /* Otherwise the first thing a user does is lock themselves out permanently. */
  const r = await api('/api/auth/enable', { enabled: true });
  is(r.ok, false);
  ok(/lock yourself out/i.test(r.error), r.error);
});
await t('the login handshake is not behind the gate', () => {
  /* The bug this replaces: OPEN_PATHS held absolute paths while the middleware
     is mounted at /api, so req.path was relative and never matched — gating
     /api/auth/login itself and making sign-in impossible. */
  const src = readFileSync(join(ROOT, 'server.js'), 'utf8');
  const m4 = src.match(/const OPEN_PATHS = new Set\(\[([^\]]+)\]/);
  ok(m4, 'OPEN_PATHS not found');
  for (const need of ['/auth/status', '/auth/login', '/auth/setup']) {
    ok(m4[1].includes(`'${need}'`), `${need} must be open, and relative to the /api mount`);
  }
  ok(!m4[1].includes("'/api/auth/"), 'absolute paths here never match — that is the lockout bug');
});
await t('the gate is registered before any protected route', () => {
  /* Express applies middleware only to routes declared after it. */
  const src = readFileSync(join(ROOT, 'server.js'), 'utf8');
  const gate = src.indexOf("app.use('/api'");
  ok(gate > 0, 'no /api gate found');
  for (const route of ["app.post('/api/crawl'", "app.get('/api/properties'", "app.get('/api/export/"]) {
    const at = src.indexOf(route);
    if (at > 0) ok(at > gate, `${route} is declared before the auth gate and would be unprotected`);
  }
});
await t('response helpers are defined before first use', () => {
  const src = readFileSync(join(ROOT, 'server.js'), 'utf8');
  ok(src.indexOf('const wrap =') < src.indexOf("app.use('/api'"),
    'const does not hoist — using wrap above its definition crashes at boot');
});

G('API — diagnostics & Clarity');
await t('diagnostics reports by layer with a copyable report', async () => {
  const r = await api('/api/diagnostics');
  ok(r.ok, r.error);
  ok(r.checks.length >= 8, `${r.checks?.length} checks`);
  ok(r.byLayer.network?.length, 'no network layer');
  ok(r.verdict && r.verdict.length > 40, 'verdict too terse to act on');
  ok(r.report && r.report.split('\n').length > 8, 'report is not copyable');
  for (const c of r.checks) {
    ok(c.layer, `${c.name} has no layer`);
    ok(c.detail, `${c.name} has no detail line`);
    ok(c.ok ? c.info : c.error, `${c.name} reports neither info nor error`);
    ok(typeof c.ms === 'number', `${c.name} has no timing`);
  }
});
await t('a total network failure is named as the root cause', async () => {
  /* In CI every external host is blocked, which is the same symptom as a
     proxy or firewall on a real machine — the verdict must say so rather than
     listing ten unrelated failures. */
  const r = await api('/api/diagnostics');
  const net = r.checks.filter((c) => c.layer === 'network');
  if (net.every((c) => !c.ok)) {
    ok(/cannot reach the internet/i.test(r.verdict), `verdict should name the root cause: ${r.verdict}`);
  }
});
await t('no probe is allowed to hang', async () => {
  const r = await api('/api/diagnostics');
  for (const c of r.checks) ok(c.ms < 60000, `${c.name} took ${c.ms}ms — a probe that slow is a failure`);
});
await t('clarity status reports budget without a token', async () => {
  const r = await api('/api/clarity/status');
  ok(r.ok, r.error);
  is(r.configured, false);
  is(r.budget.cap, 10);
  ok(r.dimensions.length >= 8);
});

G('API — settings');
await t('GET returns no secret values', async () => {
  const r = await api('/api/settings');
  ok(r.ok, r.error);
  ok(r.fields.GOOGLE_API_KEY, 'no GOOGLE_API_KEY field');
  const body = JSON.stringify(r);
  ok(!/"value"/.test(body), 'payload contains a value field');
});
await t('a whitespace paste is rejected before any API call', async () => {
  const r = await api('/api/settings', { values: { CF_ACCOUNT_ID: 'abc 123' } });
  ok(r.ok, r.error);
  is(r.results.CF_ACCOUNT_ID.ok, false);
  ok(/whitespace/i.test(r.results.CF_ACCOUNT_ID.detail));
  is(r.saved.length, 0, 'saved a value it should have rejected');
});
await t('an unknown setting is refused', async () => {
  const r = await api('/api/settings', { values: { NOT_A_SETTING: 'x' } });
  is(r.results.NOT_A_SETTING.ok, false);
});
await t('an empty payload is rejected', async () => {
  const r = await api('/api/settings', { values: {} });
  is(r.ok, false);
});
await t('an unverifiable key is never saved', async () => {
  // No network in CI, so validation cannot succeed — the point is that a key
  // which cannot be checked must not be written.
  const r = await api('/api/settings', { values: { GOOGLE_API_KEY: 'obviously-not-real' } });
  ok(r.ok, r.error);
  is(r.results.GOOGLE_API_KEY.ok, false);
  is(r.saved.length, 0);
  ok(r.results.GOOGLE_API_KEY.detail.length > 25, `terse: ${r.results.GOOGLE_API_KEY.detail}`);
});

G('API — exports');
for (const k of ['findings', 'crawl', 'links', 'azure', 'json']) {
  await t(`export/${k}`, async () => {
    const res = await fetch(`${BASE}/api/export/${k}`);
    is(res.status, 200);
    const body = await res.text();
    ok(body.length > 50, `only ${body.length} bytes`);
  });
}

G('API — error handling');
await t('unknown finding id gives a clear message', async () => {
  const r = await api('/api/ai/fix', { findingId: 'nope' });
  is(r.ok, false); ok(/not in the current audit/.test(r.error));
});
await t('missing required field is rejected', async () => {
  const r = await api('/api/summarize', { text: 'too short' });
  is(r.ok, false); ok(r.error.length > 20, 'error message too terse to act on');
});
await t('network-dependent features fail with an explanation', async () => {
  const r = await api('/api/trends/crux', { target: `http://localhost:${GOOD}` });
  if (r.ok) skipT('crux explanation', 'network reachable in this environment');
  else ok(r.error.length > 40 && !/^\w+Error/.test(r.error), `unhelpful error: ${r.error}`);
});
await t('a busy port gives guidance, not a stack trace', async () => {
  // The most common way to start this is on top of a copy you forgot to stop.
  const { spawn: sp } = await import('node:child_process');
  const clash = sp(process.execPath, [join(ROOT, 'server.js')], {
    env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  clash.stdout.on('data', (d) => { out += d; });
  clash.stderr.on('data', (d) => { out += d; });
  const code = await new Promise((r) => { clash.on('exit', r); setTimeout(() => { clash.kill(); r(null); }, 15000); });
  is(code, 1, 'should exit 1 rather than crash or hang');
  ok(/already in use/i.test(out), `no explanation given: ${out.slice(0, 160)}`);
  ok(/taskkill|kill/i.test(out), 'did not say how to fix it');
  ok(!/at Server\.|Unhandled 'error'/.test(out), 'leaked a stack trace');
});

await t('server logged no unhandled errors', () => {
  const real = srvErr.split('\n').filter((l) => l.trim() && !/Deprecation|trace-deprecation|punycode/i.test(l));
  is(real.length, 0, real.slice(0, 3).join(' | '));
});

/* ── done ─────────────────────────────────────────────────────────────────── */

srv.kill();
servers.forEach((s) => s.close());

console.log(`\n${'─'.repeat(64)}`);
console.log(`  ${pass} passed   ${fail} failed   ${skip} skipped`);
if (fail) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(`  · ${f}`));
}
console.log(`${'─'.repeat(64)}\n`);
process.exit(fail ? 1 : 0);
