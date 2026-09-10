/* Competitor comparison by crawling them.
   The one piece of competitive intelligence that needs no proprietary index:
   their HTML is public, so crawl it and measure. This will never tell you their
   traffic or their backlinks — those need clickstream panels and a web-scale
   link graph. It tells you how they have built the site, which is the part you
   can actually copy or beat.

   Deliberately narrow: only dimensions that are measurable from a crawl and
   that a person could act on. "They have more pages" is not a finding. "Every
   one of their service pages carries FAQPage schema and none of yours do" is. */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
const file = (id) => join(DATA, `competitors-${id || 'unassigned'}.json`);

/* Only the profile is stored, never their pages. The comparison needs
   aggregates, and keeping someone else's content on disk serves no purpose. */
export async function list(propertyId) {
  try { return JSON.parse(await readFile(file(propertyId), 'utf8')); } catch { return []; }
}

export async function upsert(propertyId, prof) {
  const all = (await list(propertyId)).filter((c) => c.host !== prof.host);
  all.push({ ...prof, crawledAt: new Date().toISOString() });
  await mkdir(DATA, { recursive: true });
  await writeFile(file(propertyId), JSON.stringify(all, null, 2));
  return all;
}

export async function remove(propertyId, host2) {
  const all = (await list(propertyId)).filter((c) => c.host !== host2);
  await mkdir(DATA, { recursive: true });
  await writeFile(file(propertyId), JSON.stringify(all, null, 2));
  return all;
}

const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);
const med = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const host = (u) => { try { return new URL(u).host.replace(/^www\./, ''); } catch { return u; } };

/** The measurable shape of a site, reduced to what is comparable. */
export function profile(crawl) {
  const pages = (crawl.pages || []).filter((p) => p.status === 200 && /html/i.test(p.contentType || ''));
  const words = pages.map((p) => p.wordCount || 0);
  const depths = pages.map((p) => p.depth ?? 0);
  const schemaTypes = {};
  for (const p of pages) for (const t of p.schemaTypes || []) schemaTypes[t] = (schemaTypes[t] || 0) + 1;

  const titles = pages.map((p) => String(p.title || '')).filter(Boolean);
  const sep = { '|': 0, '-': 0, '–': 0, ':': 0, none: 0 };
  for (const t of titles) {
    const m = /\s([|\-–:])\s/.exec(t);
    if (m) sep[m[1]]++; else sep.none++;
  }

  /* Which URL segments they use as their top-level structure. This is the most
     directly copyable thing in a competitor crawl. */
  const sections = {};
  for (const p of pages) {
    try {
      const seg = new URL(p.url).pathname.split('/').filter(Boolean)[0];
      if (seg) sections[seg] = (sections[seg] || 0) + 1;
    } catch { /* skip */ }
  }

  return {
    origin: crawl.origin,
    host: host(crawl.origin),
    pages: pages.length,
    truncated: !!crawl.truncated,
    words: { median: med(words), thin: words.filter((w) => w < 300).length },
    depth: { median: med(depths), max: Math.max(...depths, 0), deep: depths.filter((d) => d > 3).length },
    internalLinks: { median: med(pages.map((p) => (p.links || []).length)) },
    inbound: { median: med(pages.map((p) => p.inboundCount || 0)), orphaned: pages.filter((p) => !p.inboundCount).length },
    schema: { pagesWithAny: pages.filter((p) => (p.schemaTypes || []).length).length, types: schemaTypes },
    titles: { separators: sep, medianPixels: med(pages.map((p) => p.titlePixels || 0).filter(Boolean)) },
    hasBreadcrumbs: pages.filter((p) => p.hasBreadcrumbMarkup).length,
    hasAuthor: pages.filter((p) => p.hasAuthorMarkup).length,
    sections: Object.entries(sections).sort((a, b) => b[1] - a[1]).slice(0, 12),
    platform: [...new Set(pages.flatMap((p) => p.platform || []))],
    responseMs: med(pages.map((p) => p.responseMs).filter(Boolean)),
    https: String(crawl.origin).startsWith('https://'),
  };
}

/**
 * Compares you against one or more competitor profiles. Returns gaps phrased as
 * decisions rather than differences — a number that is merely different is not
 * worth reading.
 */
export function compare(mine, theirs = []) {
  if (!theirs.length) throw new Error('Nothing to compare against. Crawl at least one competitor first.');
  const gaps = [];
  const G = (o) => gaps.push({ severity: 'Medium', ...o });

  const avg = (fn) => theirs.reduce((t, x) => t + (fn(x) || 0), 0) / theirs.length;
  const anyOf = (fn) => theirs.filter(fn);

  /* ── schema coverage: the most commonly one-sided difference ──────────── */
  const myCov = pct(mine.schema.pagesWithAny, mine.pages);
  const theirCov = Math.round(avg((x) => pct(x.schema.pagesWithAny, x.pages)));
  if (theirCov - myCov >= 25) {
    G({
      severity: 'High', area: 'Structured data',
      what: `${theirCov}% of their pages carry structured data against ${myCov}% of yours.`,
      why: 'Schema is the one on-page factor with a visible, attributable payoff — rich results change how the listing looks and therefore its click-through rate. A gap this size on the same query set means their listings look better than yours before anyone reads a word.',
      act: 'Add the types they use at template level rather than per page. Build tab → Structured data generates them with required-property validation.',
      evidence: 'observed',
    });
  }

  /* Types they use and you do not — more actionable than a coverage number. */
  const mineTypes = new Set(Object.keys(mine.schema.types));
  const theirTypes = {};
  for (const t of theirs) for (const [k, v] of Object.entries(t.schema.types)) theirTypes[k] = (theirTypes[k] || 0) + v;
  const missingTypes = Object.entries(theirTypes)
    .filter(([k, v]) => !mineTypes.has(k) && v >= 2)
    .sort((a, b) => b[1] - a[1]);
  if (missingTypes.length) {
    G({
      severity: 'Medium', area: 'Schema types',
      what: `They use types you do not: ${missingTypes.slice(0, 6).map(([k, v]) => `${k} (${v} pages)`).join(', ')}.`,
      why: 'A type appearing on several of their pages is a deliberate template decision, not an accident. It is also a strong hint about which rich results this query set actually supports.',
      act: 'Check each against Google\'s supported types before copying — some earn a rich result and some do nothing. Only mark up what is visible on the page.',
      evidence: 'observed',
    });
  }

  /* ── architecture ──────────────────────────────────────────────────────── */
  const theirDepth = avg((x) => x.depth.median);
  if (mine.depth.median - theirDepth >= 1) {
    G({
      severity: 'Medium', area: 'Click depth',
      what: `Your median page sits ${mine.depth.median} clicks from the homepage; theirs is ${theirDepth.toFixed(1)}.`,
      why: 'Depth is a proxy for how much internal signal reaches a page. A flatter competitor is passing more authority to more of their pages from the same homepage strength.',
      act: 'Look at their top-level sections below and how they group pages. Flattening usually means adding hub pages, not removing structure.',
      evidence: 'observed',
    });
  }

  const theirSections = {};
  for (const t of theirs) for (const [seg, n] of t.sections) theirSections[seg] = (theirSections[seg] || 0) + n;
  const mySegs = new Set(mine.sections.map(([s]) => s));
  const missingSections = Object.entries(theirSections)
    .filter(([s, n]) => !mySegs.has(s) && n >= 3)
    .sort((a, b) => b[1] - a[1]);
  if (missingSections.length) {
    G({
      severity: 'High', area: 'Missing sections',
      what: `They have top-level sections you do not: ${missingSections.slice(0, 6).map(([s, n]) => `/${s}/ (${n} pages)`).join(', ')}.`,
      why: 'A section carrying several pages is a topic they have decided to invest in. This is the closest a crawl gets to a content-gap analysis without a keyword index — and unlike a keyword tool, it tells you what they actually built rather than what they might rank for.',
      act: 'For each one, read a couple of their pages and decide whether that topic belongs on your site. Then check the live SERP for its main query before committing — their having it does not prove it works.',
      evidence: 'observed',
    });
  }

  /* ── content depth ─────────────────────────────────────────────────────── */
  const theirWords = avg((x) => x.words.median);
  if (theirWords - mine.words.median >= 250) {
    G({
      severity: 'Medium', area: 'Content depth',
      what: `Their median page runs ${Math.round(theirWords)} words against your ${mine.words.median}.`,
      why: 'Not a word-count target — there is no such thing. But a consistent gap this size usually means they are answering sub-questions you are not, and that is visible in the SERP as a fuller result with more sub-headings.',
      act: 'Compare two of their pages against your equivalent on the same query. The question is which sub-topics they cover, not how long the page is.',
      evidence: 'inferred',
    });
  }

  /* ── trust signals ─────────────────────────────────────────────────────── */
  const theirAuthor = Math.round(avg((x) => pct(x.hasAuthor, x.pages)));
  const myAuthor = pct(mine.hasAuthor, mine.pages);
  if (theirAuthor - myAuthor >= 30) {
    G({
      severity: 'Medium', area: 'Authorship',
      what: `${theirAuthor}% of their pages have author markup against ${myAuthor}% of yours.`,
      why: 'On anything touching health, money, law or safety, an unnamed author is a genuine liability. If they are naming authors on this query set and you are not, they are the more obviously accountable source.',
      act: 'Name real people with relevant credentials, and give each one a bio page. Do not invent a byline — a fake author is worse than none.',
      evidence: 'observed',
    });
  }

  const theirCrumbs = Math.round(avg((x) => pct(x.hasBreadcrumbs, x.pages)));
  const myCrumbs = pct(mine.hasBreadcrumbs, mine.pages);
  if (theirCrumbs - myCrumbs >= 40) {
    G({
      severity: 'Low', area: 'Breadcrumbs',
      what: `${theirCrumbs}% of their pages have breadcrumb markup against ${myCrumbs}% of yours.`,
      why: 'Breadcrumbs replace the raw URL in the search result with a readable path. Small effect on clicks, near-zero cost, and it is a template change made once.',
      act: 'Add BreadcrumbList to the templates. Build tab generates it from your URL structure.',
      evidence: 'observed',
    });
  }

  /* ── internal linking ──────────────────────────────────────────────────── */
  const theirInbound = avg((x) => x.inbound.median);
  if (theirInbound - mine.inbound.median >= 3) {
    G({
      severity: 'Medium', area: 'Internal linking',
      what: `Their median page has ${theirInbound.toFixed(1)} internal links pointing at it; yours has ${mine.inbound.median}.`,
      why: 'Internal linking is the only ranking lever that needs nobody\'s permission — no outreach, no budget, no approval from anyone outside the team. A gap here is the cheapest one on this list to close.',
      act: 'Build tab → Internal links finds pages that already mention a topic without linking to it.',
      evidence: 'observed',
    });
  }

  /* ── speed ─────────────────────────────────────────────────────────────── */
  const theirMs = avg((x) => x.responseMs);
  if (mine.responseMs - theirMs >= 400 && mine.responseMs > 600) {
    G({
      severity: 'Medium', area: 'Server response',
      what: `Your median response is ${mine.responseMs}ms against their ${Math.round(theirMs)}ms.`,
      why: 'This is time spent before a single byte of your page can render, so it caps how good LCP can ever be. It is hosting and backend work, not front-end.',
      act: 'Caching, database queries, or the host. Front-end optimisation cannot recover time already spent waiting for the server.',
      evidence: 'observed',
    });
  }

  /* Things where you are ahead. Worth stating: it stops the report reading as
     a list of everything wrong, and tells you what not to spend time on. */
  const ahead = [];
  if (myCov - theirCov >= 20) ahead.push(`Structured data coverage: ${myCov}% against their ${theirCov}%.`);
  if (theirDepth - mine.depth.median >= 1) ahead.push(`Flatter architecture: median depth ${mine.depth.median} against theirs ${theirDepth.toFixed(1)}.`);
  if (mine.inbound.median - theirInbound >= 3) ahead.push(`Denser internal linking: ${mine.inbound.median} inbound links per page against theirs ${theirInbound.toFixed(1)}.`);
  if (theirMs - mine.responseMs >= 300) ahead.push(`Faster server: ${mine.responseMs}ms against their ${Math.round(theirMs)}ms.`);
  if (mine.words.median - theirWords >= 250) ahead.push(`Longer pages: median ${mine.words.median} words against theirs ${Math.round(theirWords)}.`);

  const SEV = { High: 0, Medium: 1, Low: 2 };
  gaps.sort((a, b) => SEV[a.severity] - SEV[b.severity]);

  return {
    mine, theirs, gaps, ahead,
    truncatedWarning: [mine, ...theirs].some((x) => x.truncated)
      ? 'At least one crawl hit its page cap, so the medians are drawn from a partial site. Raise the cap for a fair comparison — a truncated crawl skews toward shallow pages.'
      : null,
    limits: 'This compares how the sites are BUILT. It cannot tell you their traffic, their backlinks or their rankings — those need a clickstream panel and a web-scale link graph, which is what an Ahrefs or Semrush subscription actually buys. What it does give you is the part you can copy or beat without paying anyone.',
  };
}

export { host as _host };
