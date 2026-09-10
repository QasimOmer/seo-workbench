/* Time series for the dashboard.
   Three genuinely different sources, kept apart because they mean different things:
     - CrUX History  : real Chrome users, weekly, 6 months. The performance signal.
     - GSC           : Google's own record of your clicks, impressions, position.
     - PSI run log   : our own Lighthouse runs. Lab data. A debugging trail only. */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { runPsi } from './psi.js';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
const CRUX_HISTORY = 'https://chromeuxreport.googleapis.com/v1/records:queryHistoryRecord';

const METRICS = ['largest_contentful_paint', 'interaction_to_next_paint', 'cumulative_layout_shift', 'experimental_time_to_first_byte'];
export const METRIC_LABEL = {
  largest_contentful_paint: 'LCP',
  interaction_to_next_paint: 'INP',
  cumulative_layout_shift: 'CLS',
  experimental_time_to_first_byte: 'TTFB',
};
const THRESHOLD = {
  largest_contentful_paint: [2500, 4000],
  interaction_to_next_paint: [200, 500],
  cumulative_layout_shift: [0.1, 0.25],
  experimental_time_to_first_byte: [800, 1800],
};

/** Six months of weekly field data. Each point is the tail of a 28-day rolling
    window, so consecutive points overlap heavily — a fix takes 2–3 weeks to
    show. The UI says this; without it people read noise as regression. */
export async function cruxHistory(target, { formFactor = 'PHONE', key } = {}) {
  if (!key) return currentFieldOnly(target, formFactor);
  const isOrigin = !/\/[^/]/.test(target.replace(/^https?:\/\//, '').replace(/\/$/, ''));
  const body = { formFactor, metrics: METRICS, ...(isOrigin ? { origin: target } : { url: target }) };

  const res = await fetch(`${CRUX_HISTORY}?key=${encodeURIComponent(key)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const m = json?.error?.message || `HTTP ${res.status}`;
    if (/not found|chrome ux report data/i.test(m)) {
      throw new Error(`CrUX has no history for ${target}. It only covers sites with enough Chrome traffic — new or low-traffic sites are absent, and that is not a fault you can fix. Origin-level needs less traffic than page-level, so try the bare domain.`);
    }
    throw new Error(m);
  }

  const rec = json.record || {};
  const periods = (rec.collectionPeriods || []).map((p) => `${p.lastDate.year}-${String(p.lastDate.month).padStart(2, '0')}-${String(p.lastDate.day).padStart(2, '0')}`);
  const series = [];
  for (const m of METRICS) {
    const node = rec.metrics?.[m];
    if (!node) continue;
    const p75s = (node.percentilesTimeseries?.p75s || []).map((v) => (v == null ? null : Number(v)));
    if (!p75s.some((v) => v != null)) continue;
    const good = node.histogramTimeseries?.[0]?.densities || [];
    const [t1, t2] = THRESHOLD[m];
    const latest = [...p75s].reverse().find((v) => v != null) ?? null;
    const first = p75s.find((v) => v != null) ?? null;
    series.push({
      metric: m, label: METRIC_LABEL[m], p75s,
      goodShare: good.map((d) => (d == null ? null : Math.round(d * 100))),
      thresholds: [t1, t2],
      latest, first,
      change: latest != null && first != null ? Math.round(((latest - first) / first) * 100) : null,
      rating: latest == null ? 'none' : latest <= t1 ? 'GOOD' : latest <= t2 ? 'NEEDS_IMPROVEMENT' : 'POOR',
      unit: m === 'cumulative_layout_shift' ? '' : 'ms',
    });
  }
  if (!series.length) throw new Error(`CrUX returned a record for ${target} but no metric history, which usually means traffic is right at the reporting threshold.`);
  return { target, formFactor, periods, series, source: 'CrUX History API (real Chrome users, 28-day rolling window)' };
}

/** No key, no history — but PageSpeed carries CrUX's CURRENT field data and
    works keyless, so we can still show where the site stands today. One point
    instead of twenty-five: honest about being a snapshot, not a trend. */
async function currentFieldOnly(target, formFactor) {
  const r = await runPsi(target, { strategy: formFactor === 'PHONE' ? 'mobile' : 'desktop', key: null });
  if (!r?.ok) {
    throw new Error(`No performance data available. PageSpeed said: ${r?.error || 'no response'}. Keyless PageSpeed allows roughly 25 requests a day, so this is often just the daily cap.`);
  }
  // PSI keys field metrics by short label, and falls back to origin-level when
  // the specific URL has too little traffic.
  const f = (r.field?.available ? r.field : r.origin?.available ? r.origin : null)?.metrics || {};
  const series = [];
  const map = [
    ['largest_contentful_paint', 'LCP'],
    ['interaction_to_next_paint', 'INP'],
    ['cumulative_layout_shift', 'CLS'],
    ['experimental_time_to_first_byte', 'TTFB'],
  ];
  for (const [metric, k] of map) {
    const v = f[k]?.p75;
    if (v == null) continue;
    const [t1, t2] = THRESHOLD[metric];
    series.push({
      metric, label: METRIC_LABEL[metric], p75s: [v], goodShare: [],
      thresholds: [t1, t2], latest: v, first: v, change: null,
      rating: v <= t1 ? 'GOOD' : v <= t2 ? 'NEEDS_IMPROVEMENT' : 'POOR',
      unit: metric === 'cumulative_layout_shift' ? '' : 'ms',
    });
  }
  if (!series.length) {
    throw new Error(`No field data for ${target}. CrUX only covers sites with enough Chrome traffic, so new or low-traffic sites have none — that is not a fault you can fix. Try the bare domain, which needs less traffic than a single page.`);
  }
  return {
    target, formFactor, periods: ['now'], series,
    snapshot: true,
    source: 'Current field data via PageSpeed Insights, no key needed',
    note: 'This is today\'s reading, not a trend. Six months of weekly history needs a free Google API key — add GOOGLE_API_KEY to .env and these become real trend lines.',
  };
}

/* ── our own PSI runs: a lab trail, never the headline ─────────────────────── */

const psiFile = (id) => join(DATA, `psi-log-${id}.json`);

export async function logPsi(id, entry) {
  let log = [];
  try { log = JSON.parse(await readFile(psiFile(id), 'utf8')); } catch { /* first run */ }
  log.push({ at: new Date().toISOString(), ...entry });
  log = log.slice(-400);
  await mkdir(DATA, { recursive: true });
  await writeFile(psiFile(id), JSON.stringify(log));
  return log.length;
}

export async function psiLog(id) {
  try { return JSON.parse(await readFile(psiFile(id), 'utf8')); } catch { return []; }
}

/** Grouped by URL so you can see whether a specific page moved after a deploy. */
export async function psiSeries(id) {
  const log = await psiLog(id);
  const byUrl = {};
  for (const e of log) (byUrl[e.url] ||= []).push(e);
  return Object.entries(byUrl)
    .map(([url, runs]) => ({
      url, runs: runs.length,
      points: runs.map((r) => ({ at: r.at, performance: r.performance, lcp: r.lcp, cls: r.cls, tbt: r.tbt })),
    }))
    .sort((a, b) => b.runs - a.runs);
}

/* ── GSC time series ──────────────────────────────────────────────────────── */

/** Daily clicks / impressions / CTR / position, plus a plain-language read of
    the shape. The impressions-flat-clicks-down case is the one that matters:
    it means you are still being shown and no longer being chosen. */
export function shapeGscSeries(rows) {
  const points = (rows || []).map((r) => ({
    date: r.date,
    clicks: r.clicks, impressions: r.impressions,
    ctr: (r.ctr || 0) * 100, position: r.position,
  })).filter((p) => p.date).sort((a, b) => a.date.localeCompare(b.date));

  if (points.length < 14) return { points, read: null };

  const half = Math.floor(points.length / 2);
  const sum = (arr, k) => arr.reduce((t, p) => t + (p[k] || 0), 0);
  const avg = (arr, k) => (arr.length ? sum(arr, k) / arr.length : 0);
  const a = points.slice(0, half), b = points.slice(half);
  const pct = (x, y) => (x ? Math.round(((y - x) / x) * 100) : 0);

  const clicks = pct(sum(a, 'clicks'), sum(b, 'clicks'));
  const impr = pct(sum(a, 'impressions'), sum(b, 'impressions'));
  const pos = +(avg(b, 'position') - avg(a, 'position')).toFixed(1);

  let read;
  if (clicks <= -15 && Math.abs(impr) < 10) {
    read = { kind: 'ctr', text: `Clicks are down ${Math.abs(clicks)}% while impressions held steady. You are still being shown and no longer being chosen — this is a titles, snippets and SERP-feature problem, not a ranking collapse.` };
  } else if (clicks <= -15 && impr <= -15 && pos > 1) {
    read = { kind: 'ranking', text: `Impressions down ${Math.abs(impr)}% and average position ${pos} worse. This looks like lost rankings rather than lost clicks — check for a technical regression or a competitor gain before assuming an algorithm update.` };
  } else if (clicks <= -15 && impr <= -15 && Math.abs(pos) <= 1) {
    read = { kind: 'demand', text: `Clicks and impressions both fell ${Math.abs(clicks)}% / ${Math.abs(impr)}% while position barely moved. Falling demand or seasonality is the first thing to rule out — compare against the same weeks last year before treating it as a problem.` };
  } else if (clicks >= 15) {
    read = { kind: 'up', text: `Clicks up ${clicks}% with position ${pos <= 0 ? `improving by ${Math.abs(pos)}` : `broadly flat`}. Worth recording what shipped in this window.` };
  } else {
    read = { kind: 'flat', text: 'No decisive movement across the window. Treat week-to-week wobble as noise unless it persists for three weeks.' };
  }

  return {
    points,
    totals: { clicks: sum(points, 'clicks'), impressions: sum(points, 'impressions'), position: +avg(points, 'position').toFixed(1) },
    delta: { clicks, impressions: impr, position: pos },
    read,
  };
}
