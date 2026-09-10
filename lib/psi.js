// PageSpeed Insights v5 and the CrUX API. Both free.
// PSI works without a key at a low quota; a key raises it to 25k/day.
// The distinction that matters: CrUX is field data and is the signal.
// Lighthouse is a lab simulation and is a debugging tool. Kept separate on purpose.

const PSI_ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
const CRUX_ENDPOINT = 'https://chromeuxreport.googleapis.com/v1/records:queryRecord';

const THRESHOLDS = {
  LARGEST_CONTENTFUL_PAINT_MS: { good: 2500, poor: 4000, label: 'LCP', unit: 'ms' },
  INTERACTION_TO_NEXT_PAINT: { good: 200, poor: 500, label: 'INP', unit: 'ms' },
  CUMULATIVE_LAYOUT_SHIFT_SCORE: { good: 0.1, poor: 0.25, label: 'CLS', unit: '' },
  FIRST_CONTENTFUL_PAINT_MS: { good: 1800, poor: 3000, label: 'FCP', unit: 'ms' },
  EXPERIMENTAL_TIME_TO_FIRST_BYTE: { good: 800, poor: 1800, label: 'TTFB', unit: 'ms' },
};

export async function runPsi(url, { strategy = 'mobile', key = null } = {}) {
  const params = new URLSearchParams({ url, strategy });
  ['performance', 'accessibility', 'seo', 'best-practices'].forEach((c) => params.append('category', c));
  if (key) params.set('key', key);

  const res = await fetch(`${PSI_ENDPOINT}?${params}`, { headers: { Accept: 'application/json' } });
  const raw = await res.text();
  let json;
  try { json = JSON.parse(raw); }
  catch {
    // Proxies, captive portals and gateway errors return HTML, not JSON.
    return { ok: false, error: `PageSpeed returned a non-JSON response (HTTP ${res.status}). That usually means a proxy or network filter intercepted the request rather than a fault at Google's end.`, raw: raw.slice(0, 160) };
  }

  if (!res.ok) {
    return { ok: false, url, strategy, error: json?.error?.message || `HTTP ${res.status}`, quota: res.status === 429 };
  }

  const lr = json.lighthouseResult || {};
  const audits = lr.audits || {};

  return {
    ok: true,
    url: json.id || url,
    strategy,
    fetchedAt: json.analysisUTCTimestamp,
    // ── field data: this is the signal
    field: shapeCrux(json.loadingExperience, 'page'),
    origin: shapeCrux(json.originLoadingExperience, 'origin'),
    // ── lab data: debugging only
    lab: {
      performanceScore: Math.round((lr.categories?.performance?.score ?? 0) * 100),
      seoScore: Math.round((lr.categories?.seo?.score ?? 0) * 100),
      accessibilityScore: Math.round((lr.categories?.accessibility?.score ?? 0) * 100),
      bestPracticesScore: Math.round((lr.categories?.['best-practices']?.score ?? 0) * 100),
      lcp: audits['largest-contentful-paint']?.displayValue || null,
      cls: audits['cumulative-layout-shift']?.displayValue || null,
      tbt: audits['total-blocking-time']?.displayValue || null,
      fcp: audits['first-contentful-paint']?.displayValue || null,
      si: audits['speed-index']?.displayValue || null,
      lcpElement: audits['largest-contentful-paint-element']?.details?.items?.[0]?.items?.[0]?.node?.snippet || null,
    },
    // top opportunities, sorted by modelled saving
    opportunities: Object.values(audits)
      .filter((a) => a.details?.type === 'opportunity' && (a.details.overallSavingsMs || 0) > 100)
      .map((a) => ({ id: a.id, title: a.title, savingsMs: Math.round(a.details.overallSavingsMs), description: strip(a.description) }))
      .sort((a, b) => b.savingsMs - a.savingsMs)
      .slice(0, 8),
    diagnostics: ['uses-responsive-images', 'modern-image-formats', 'unused-css-rules', 'unused-javascript',
      'render-blocking-resources', 'server-response-time', 'uses-text-compression', 'font-display',
      'third-party-summary', 'largest-contentful-paint-element', 'layout-shift-elements']
      .map((id) => audits[id])
      .filter((a) => a && a.score !== null && a.score < 0.9)
      .map((a) => ({ id: a.id, title: a.title, displayValue: a.displayValue || null })),
    failedSeoAudits: Object.values(audits)
      .filter((a) => a.score !== null && a.score < 1 && (lr.categories?.seo?.auditRefs || []).some((r) => r.id === a.id))
      .map((a) => ({ id: a.id, title: a.title })),
  };
}

function shapeCrux(exp, scope) {
  if (!exp || !exp.metrics) return { available: false, scope, note: 'No CrUX field data — the URL or origin has insufficient real-user traffic. Lab data is all you have here; treat it as a debugging pointer, not a signal.' };
  const metrics = {};
  for (const [k, v] of Object.entries(exp.metrics)) {
    const t = THRESHOLDS[k];
    metrics[t?.label || k] = {
      p75: v.percentile,
      category: v.category,
      unit: t?.unit ?? '',
      good: t ? v.percentile <= t.good : null,
      distribution: (v.distributions || []).map((d) => ({ min: d.min, max: d.max, proportion: Math.round(d.proportion * 1000) / 10 })),
    };
  }
  return { available: true, scope, overall: exp.overall_category, metrics };
}

/** Query CrUX directly — needed for form-factor splits PSI does not return. */
export async function runCrux(target, { key, formFactor = 'PHONE', isOrigin = false } = {}) {
  if (!key) return { ok: false, error: 'CrUX API requires a Google API key. Add GOOGLE_API_KEY to .env.' };
  const body = isOrigin ? { origin: target, formFactor } : { url: target, formFactor };
  const res = await fetch(`${CRUX_ENDPOINT}?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) return { ok: false, error: json?.error?.message || `HTTP ${res.status}` };
  const metrics = {};
  for (const [k, v] of Object.entries(json.record?.metrics || {})) {
    metrics[k] = { p75: v.percentiles?.p75, histogram: v.histogram };
  }
  return { ok: true, key: json.record?.key, formFactor, collectionPeriod: json.record?.collectionPeriod, metrics };
}

/** Batch with a small concurrency so the quota lasts. */
export async function runPsiBatch(urls, opts = {}, onProgress = () => {}) {
  const { concurrency = 2 } = opts;
  const results = [];
  const queue = [...urls];
  const worker = async () => {
    while (queue.length) {
      const u = queue.shift();
      const r = await runPsi(u, opts);
      results.push(r);
      onProgress({ done: results.length, total: urls.length, url: u });
      await new Promise((res) => setTimeout(res, 400));
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

const strip = (s) => String(s || '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\s+/g, ' ').trim();
