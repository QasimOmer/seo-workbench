/* Crawl-derived distributions for the dashboard.
   Everything here comes from the crawl itself, so the charts are populated the
   moment a crawl finishes — no key, no quota, no external service. That is the
   point: a dashboard whose graphs are empty until you configure something is
   not a dashboard.

   Each series carries a `read`: the sentence a person would say looking at it.
   A histogram nobody can interpret is decoration. */

import { pixelWidth } from './parse.js';

const pct = (n, total) => (total ? Math.round((n / total) * 100) : 0);

/** Buckets with explicit edges, so the axis means the same thing every run. */
function bucket(values, edges, labelFor) {
  const counts = new Array(edges.length + 1).fill(0);
  for (const v of values) {
    let i = edges.findIndex((e) => v <= e);
    if (i === -1) i = edges.length;
    counts[i]++;
  }
  return { labels: labelFor(edges), counts };
}

export function buildInsights(crawl, audit) {
  const pages = crawl.pages || [];
  const html = pages.filter((p) => /html/i.test(p.contentType || ''));
  const ok = html.filter((p) => p.status === 200);
  const total = ok.length;
  if (!total) return null;

  const out = { pages: pages.length, analysed: total, charts: [] };
  const add = (c) => { if (c) out.charts.push(c); };

  /* ── click depth: the architecture chart ─────────────────────────────────── */
  const depths = ok.map((p) => p.depth ?? 0);
  const maxDepth = Math.max(...depths, 0);
  const depthCounts = Array.from({ length: maxDepth + 1 }, (_, d) => depths.filter((x) => x === d).length);
  const deep = depths.filter((d) => d > 3).length;
  add({
    id: 'depth', kind: 'bar', title: 'Click depth from the homepage',
    labels: depthCounts.map((_, d) => (d === 0 ? 'Home' : `${d}`)),
    series: [{ name: 'Pages', values: depthCounts }],
    axis: 'Clicks from the start URL',
    read: deep
      ? `${deep} page${deep > 1 ? 's' : ''} (${pct(deep, total)}%) sit more than three clicks deep. Depth is a proxy for how much internal signal reaches a page — anything commercially important down there needs a shorter path, usually a link from a hub page rather than a nav change.`
      : `Nothing is deeper than three clicks. Architecture is not your problem; spend the effort elsewhere.`,
  });

  /* ── status codes: the eligibility chart ─────────────────────────────────── */
  const byStatus = {};
  for (const p of pages) {
    const k = p.status ? `${String(p.status)[0]}xx` : 'failed';
    byStatus[k] = (byStatus[k] || 0) + 1;
  }
  const statusKeys = Object.keys(byStatus).sort();
  const bad = (byStatus['4xx'] || 0) + (byStatus['5xx'] || 0) + (byStatus.failed || 0);
  add({
    id: 'status', kind: 'bar', title: 'Response codes',
    labels: statusKeys, series: [{ name: 'URLs', values: statusKeys.map((k) => byStatus[k]) }],
    read: bad
      ? `${bad} URL${bad > 1 ? 's' : ''} did not return 200. Every one is a link you are paying for and getting nothing from — fix the links at source rather than redirecting them.`
      : `Every URL crawled returned 200. Nothing to chase here.`,
  });

  /* ── title width: pixels, not characters ────────────────────────────────── */
  const titled = ok.filter((p) => p.title);
  if (titled.length) {
    // Measured, not a character multiplier — the whole point of the chart.
    const widths = titled.map((p) => pixelWidth(p.title, 20));
    const b = bucket(widths, [200, 300, 400, 500, 580], (e) => ['<200', '200–300', '300–400', '400–500', '500–580', '>580']);
    const over = widths.filter((w) => w > 580).length;
    const under = widths.filter((w) => w < 285).length;
    add({
      id: 'titlewidth', kind: 'bar', title: 'Title width in pixels',
      labels: b.labels, series: [{ name: 'Pages', values: b.counts }],
      axis: 'Rendered pixels — Google truncates near 580',
      read: over || under
        ? `${over} title${over === 1 ? '' : 's'} will truncate and ${under} waste space by being very short. Google truncates on width, not character count, which is why two 58-character titles can behave differently.`
        : `Every title fits the visible width. Character counts would have told you less.`,
    });
  }

  /* ── word count: content depth, not a quota ─────────────────────────────── */
  const words = ok.map((p) => p.wordCount || 0);
  const wb = bucket(words, [100, 300, 600, 1200, 2500], () => ['<100', '100–300', '300–600', '600–1200', '1200–2500', '2500+']);
  const thin = words.filter((w) => w < 300).length;
  add({
    id: 'words', kind: 'bar', title: 'Words of body content',
    labels: wb.labels, series: [{ name: 'Pages', values: wb.counts }],
    read: `${thin} page${thin === 1 ? '' : 's'} carry under 300 words. There is no minimum word count and never has been — the question is whether each page answers its query, so treat this as a list to review, not a target to hit.`,
  });

  /* ── internal inbound links: the authority distribution ─────────────────── */
  const inbound = ok.map((p) => p.inboundCount || 0);
  const ib = bucket(inbound, [0, 1, 3, 10, 30], () => ['0', '1', '2–3', '4–10', '11–30', '30+']);
  const zero = inbound.filter((n) => n === 0).length;
  add({
    id: 'inbound', kind: 'bar', title: 'Internal links pointing at each page',
    labels: ib.labels, series: [{ name: 'Pages', values: ib.counts }],
    read: zero
      ? `${zero} page${zero === 1 ? '' : 's'} have no internal links at all${crawl.truncated ? ' among the pages crawled — the crawl was capped, so treat this as a floor rather than a count' : ''}. Internal linking is the only ranking lever that needs nobody\'s permission.`
      : `Every page has at least one internal link. The shape matters more than the total: a long tail on the left is where your unloved pages are.`,
  });

  /* ── response time: real server behaviour, no API needed ────────────────── */
  const times = pages.map((p) => p.responseMs).filter((n) => n > 0).sort((a, b) => a - b);
  if (times.length > 4) {
    const p50 = times[Math.floor(times.length * 0.5)];
    const p75 = times[Math.floor(times.length * 0.75)];
    const p95 = times[Math.floor(times.length * 0.95)];
    const tb = bucket(times, [200, 500, 1000, 2000, 4000], () => ['<200ms', '200–500', '500ms–1s', '1–2s', '2–4s', '>4s']);
    add({
      id: 'ttfb', kind: 'bar', title: 'Server response time',
      labels: tb.labels, series: [{ name: 'URLs', values: tb.counts }],
      axis: `median ${p50}ms · 75th ${p75}ms · 95th ${p95}ms`,
      read: p75 > 800
        ? `The 75th percentile is ${p75}ms, which is slow enough to hurt LCP before a single image loads. This is server or hosting work, not front-end work — caching, database queries, or plugin overhead.`
        : `The 75th percentile is ${p75}ms, which leaves LCP a workable budget. Any speed problem here is front-end, not server.`,
    });
  }

  /* ── indexability: the honest three-way split ───────────────────────────── */
  const noindex = html.filter((p) => p.noindex).length;
  const blocked = html.filter((p) => p.robotsAllowed === false).length;
  const indexable = html.length - noindex - blocked;
  add({
    id: 'indexability', kind: 'bar', title: 'Indexability',
    labels: ['Indexable', 'noindex', 'Blocked by robots'],
    series: [{ name: 'Pages', values: [indexable, noindex, blocked] }],
    read: noindex || blocked
      ? `${noindex + blocked} page${noindex + blocked === 1 ? '' : 's'} cannot be indexed. That is correct for utility pages and a disaster for anything else, so check the list before assuming it is deliberate.`
      : `Every HTML page crawled is eligible for indexing.`,
  });

  /* ── findings by ladder stage: where the work actually is ───────────────── */
  if (audit?.findings?.length) {
    const LADDER = ['eligibility', 'indexation', 'intent', 'onpage', 'linking', 'schema', 'performance', 'offpage'];
    const sev = ['Critical', 'High', 'Medium', 'Low'];
    const series = sev.map((s) => ({
      name: s,
      values: LADDER.map((ph) => audit.findings.filter((f) => f.phase === ph && f.severity === s).length),
    })).filter((x) => x.values.some((v) => v > 0));
    const firstBroken = LADDER.findIndex((ph) => audit.findings.some((f) => f.phase === ph && (f.severity === 'Critical' || f.severity === 'High')));
    add({
      id: 'byphase', kind: 'stack', title: 'Findings by diagnostic stage',
      labels: LADDER.map((p, i) => `${i + 1}`), series,
      axis: LADDER.map((p, i) => `${i + 1} ${p}`).join(' · '),
      read: firstBroken >= 0
        ? `The earliest stage with serious findings is ${firstBroken + 1} (${LADDER[firstBroken]}). Bars to the right of it are real but blocked — work left to right, not tallest first.`
        : `No serious findings at any stage. What remains is refinement.`,
    });
  }

  /* ── schema coverage ─────────────────────────────────────────────────────── */
  const withSchema = ok.filter((p) => (p.schemaTypes || []).length).length;
  const typeCount = {};
  for (const p of ok) for (const t of p.schemaTypes || []) typeCount[t] = (typeCount[t] || 0) + 1;
  const types = Object.entries(typeCount).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (types.length) {
    add({
      id: 'schema', kind: 'bar', title: 'Structured data in use',
      labels: types.map(([t]) => t), series: [{ name: 'Pages', values: types.map(([, n]) => n) }],
      read: `${withSchema} of ${total} pages carry structured data (${pct(withSchema, total)}%). Coverage is not the goal — the right type on the pages that can earn a rich result is. Everything marked up must be visible on the page.`,
    });
  }

  return out;
}
