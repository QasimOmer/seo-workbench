// Google Search Console. Free, and the difference between observed and inferred.
// Without it you are guessing at indexation; with it you are reading it.

import { google } from 'googleapis';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ROOT, DATA_DIR, IS_SERVERLESS } from './paths.js';
const TOKENS_FILE = (process.env.VERCEL || IS_SERVERLESS) ? join(DATA_DIR, '.tokens.json') : join(ROOT, '.tokens.json');
const ROOT_TOKENS_FILE = join(ROOT, '.tokens.json');

const SCOPES = [
  'https://www.googleapis.com/auth/webmasters.readonly',
  'https://www.googleapis.com/auth/webmasters',
];

let tokens = null;
try {
  const raw = await readFile(TOKENS_FILE, 'utf8');
  tokens = JSON.parse(raw);
} catch {
  try {
    const raw = await readFile(join(DATA_DIR, '.tokens.json'), 'utf8');
    tokens = JSON.parse(raw);
  } catch {
    tokens = null;
  }
}

async function saveTokens(t) {
  tokens = t;
  try {
    if (t) {
      const { mkdir } = await import('node:fs/promises');
      await mkdir(dirname(TOKENS_FILE), { recursive: true });
      await writeFile(TOKENS_FILE, JSON.stringify(t, null, 2), { mode: 0o600 });
    } else {
      await rm(TOKENS_FILE, { force: true });
    }
  } catch (e) {
    if (e.code === 'EROFS' || /read-only/i.test(e?.message || '')) {
      try {
        const fallback = join(DATA_DIR, '.tokens.json');
        const { mkdir } = await import('node:fs/promises');
        await mkdir(dirname(fallback), { recursive: true });
        if (t) await writeFile(fallback, JSON.stringify(t, null, 2), { mode: 0o600 });
        else await rm(fallback, { force: true });
      } catch {}
    }
    console.error('Failed to update Search Console tokens:', e.message);
  }
}

export function isConfigured() {
  const clientId = process.env.GSC_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GSC_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET;
  return !!(clientId && clientSecret);
}

export function makeClient(customRedirectUri) {
  const clientId = process.env.GSC_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GSC_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = customRedirectUri || process.env.GSC_REDIRECT_URI || process.env.GOOGLE_REDIRECT_URI || `http://localhost:${process.env.PORT || 4321}/api/gsc/callback`;
  if (!clientId || !clientSecret) return null;
  const client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    redirectUri
  );
  if (tokens) client.setCredentials(tokens);
  client.on('tokens', (newTokens) => {
    tokens = { ...(tokens || {}), ...newTokens };
    saveTokens(tokens);
  });
  return client;
}

export function authUrl(customRedirectUri) {
  const clientId = process.env.GSC_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
  const redirectUri = customRedirectUri || process.env.GSC_REDIRECT_URI || process.env.GOOGLE_REDIRECT_URI || `http://localhost:${process.env.PORT || 4321}/api/gsc/callback`;
  if (!clientId) return null;
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.searchParams.set('access_type', 'offline');
  u.searchParams.set('prompt', 'consent');
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('scope', SCOPES.join(' '));
  return u.toString();
}

export async function exchangeCode(code, customRedirectUri) {
  const clientId = process.env.GSC_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GSC_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = customRedirectUri || process.env.GSC_REDIRECT_URI || process.env.GOOGLE_REDIRECT_URI || `http://localhost:${process.env.PORT || 4321}/api/gsc/callback`;
  if (!clientId || !clientSecret) throw new Error('Search Console client is not configured.');

  let t = null;
  let firstErr = null;

  // Attempt 1: Direct fetch with Connection: close to bypass keep-alive Premature close issues
  try {
    const params = new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    });
    const resp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Connection': 'close',
      },
      body: params.toString(),
    });
    const data = await resp.json().catch(() => null);
    if (!resp.ok || !data || data.error) {
      throw new Error(data?.error_description || data?.error || `HTTP ${resp.status}`);
    }
    t = data;
  } catch (fetchErr) {
    firstErr = fetchErr;
    try {
      const c = makeClient(redirectUri);
      if (c) {
        const res = await c.getToken(code);
        t = res?.tokens;
      }
    } catch (gErr) {
      throw new Error(`Token exchange failed: ${fetchErr.message}. Fallback error: ${gErr.message}`);
    }
  }

  if (!t) throw new Error(`Token exchange failed: ${firstErr?.message || 'No tokens received'}`);
  await saveTokens(t);
  return true;
}

export function isConnected() { return !!tokens; }
export async function disconnect() { await saveTokens(null); }
export async function setTokens(t) { await saveTokens(t); }
export function getTokens() { return tokens; }

function api() {
  const c = makeClient();
  if (!c || !tokens) throw new Error('Not connected to Search Console. Open the Search Console tab and connect.');
  return google.searchconsole({ version: 'v1', auth: c });
}

export async function listSites() {
  const r = await api().sites.list();
  return (r.data.siteEntry || []).map((s) => ({ siteUrl: s.siteUrl, permission: s.permissionLevel }));
}

export async function query(siteUrl, opts = {}) {
  const {
    startDate, endDate,
    dimensions = ['query'],
    rowLimit = 5000,
    startRow = 0,
    type = 'web',
    dimensionFilterGroups,
    dataState = 'final',
  } = opts;
  const r = await api().searchanalytics.query({
    siteUrl,
    requestBody: { startDate, endDate, dimensions, rowLimit, startRow, type, dimensionFilterGroups, dataState },
  });
  return (r.data.rows || []).map((row) => {
    const o = { clicks: row.clicks, impressions: row.impressions, ctr: row.ctr, position: row.position };
    dimensions.forEach((d, i) => { o[d] = row.keys[i]; });
    return o;
  });
}

/** Daily totals for the trend charts. dataState 'final' avoids the partial
    last two days reading as a cliff. */
export async function queryByDate(siteUrl, { days = 90 } = {}) {
  const { startDate, endDate } = dateRange(days, 3);
  return query(siteUrl, { startDate, endDate, dimensions: ['date'], rowLimit: 1000 });
}

/** Pull everything, paging past the 25k row cap. */
export async function queryAll(siteUrl, opts = {}, maxRows = 25000) {
  const out = [];
  for (let start = 0; start < maxRows; start += 5000) {
    const rows = await query(siteUrl, { ...opts, startRow: start, rowLimit: 5000 });
    out.push(...rows);
    if (rows.length < 5000) break;
  }
  return out;
}

/* ─────────────────────────── analyses ─────────────────────────── */

/**
 * Cannibalisation: one query, several pages, alternating.
 * This is the provable version of the finding — asserted from a crawl it is
 * only a guess; from the GSC export it is observed.
 */
export async function findCannibalisation(siteUrl, { startDate, endDate, minImpressions = 50 } = {}) {
  const rows = await queryAll(siteUrl, { startDate, endDate, dimensions: ['query', 'page'] });
  const byQuery = new Map();
  for (const r of rows) {
    const arr = byQuery.get(r.query) || [];
    arr.push(r);
    byQuery.set(r.query, arr);
  }
  const out = [];
  for (const [q, pages] of byQuery) {
    const total = pages.reduce((n, p) => n + p.impressions, 0);
    if (total < minImpressions || pages.length < 2) continue;
    const sorted = pages.sort((a, b) => b.impressions - a.impressions);
    const top = sorted[0];
    const second = sorted[1];
    // real competition, not a long tail of stray impressions
    const contested = second.impressions / top.impressions > 0.2;
    if (!contested) continue;
    out.push({
      query: q,
      totalImpressions: total,
      totalClicks: pages.reduce((n, p) => n + p.clicks, 0),
      bestPosition: Math.min(...pages.map((p) => p.position)),
      pages: sorted.slice(0, 5).map((p) => ({
        page: p.page, clicks: p.clicks, impressions: p.impressions,
        position: Math.round(p.position * 10) / 10,
        share: Math.round((p.impressions / total) * 100),
      })),
      severity: sorted.length > 2 || second.impressions / top.impressions > 0.6 ? 'High' : 'Medium',
    });
  }
  return out.sort((a, b) => b.totalImpressions - a.totalImpressions).slice(0, 100);
}

/** Striking distance: positions 5–20 with real impressions. The cheapest wins on the site. */
export async function strikingDistance(siteUrl, { startDate, endDate, min = 5, max = 20, minImpressions = 30 } = {}) {
  const rows = await queryAll(siteUrl, { startDate, endDate, dimensions: ['query', 'page'] });
  return rows
    .filter((r) => r.position >= min && r.position <= max && r.impressions >= minImpressions)
    .map((r) => ({
      query: r.query, page: r.page,
      clicks: r.clicks, impressions: r.impressions,
      position: Math.round(r.position * 10) / 10,
      ctr: Math.round(r.ctr * 1000) / 10,
      // impressions × the CTR you'd expect at position 3, minus what you get now
      opportunity: Math.round(r.impressions * (0.10 - r.ctr)),
    }))
    .filter((r) => r.opportunity > 0)
    .sort((a, b) => b.opportunity - a.opportunity)
    .slice(0, 200);
}

/** Queries where CTR is far below what the position should earn — a title/meta problem, not a ranking one. */
export async function ctrGaps(siteUrl, { startDate, endDate, minImpressions = 100 } = {}) {
  const CURVE = { 1: 0.28, 2: 0.15, 3: 0.11, 4: 0.08, 5: 0.06, 6: 0.05, 7: 0.04, 8: 0.03, 9: 0.03, 10: 0.025 };
  const rows = await queryAll(siteUrl, { startDate, endDate, dimensions: ['query', 'page'] });
  return rows
    .filter((r) => r.impressions >= minImpressions && r.position <= 10.5)
    .map((r) => {
      const expected = CURVE[Math.round(r.position)] ?? 0.02;
      return {
        query: r.query, page: r.page, position: Math.round(r.position * 10) / 10,
        impressions: r.impressions, clicks: r.clicks,
        actualCtr: Math.round(r.ctr * 1000) / 10,
        expectedCtr: Math.round(expected * 1000) / 10,
        gap: Math.round((expected - r.ctr) * 1000) / 10,
        missedClicks: Math.round(r.impressions * (expected - r.ctr)),
      };
    })
    .filter((r) => r.gap > 1.5)
    .sort((a, b) => b.missedClicks - a.missedClicks)
    .slice(0, 100);
}

/**
 * Traffic drop triage, in the playbook's order. Stops at the first explanation
 * the data supports rather than jumping to "algorithm update".
 */
export async function trafficTriage(siteUrl, { dropStart, dropEnd, baseStart, baseEnd } = {}) {
  const [now, before, yoyNow, yoyBefore] = await Promise.all([
    query(siteUrl, { startDate: dropStart, endDate: dropEnd, dimensions: ['date'], rowLimit: 500 }),
    query(siteUrl, { startDate: baseStart, endDate: baseEnd, dimensions: ['date'], rowLimit: 500 }),
    query(siteUrl, { startDate: shiftYear(dropStart), endDate: shiftYear(dropEnd), dimensions: ['date'], rowLimit: 500 }),
    query(siteUrl, { startDate: shiftYear(baseStart), endDate: shiftYear(baseEnd), dimensions: ['date'], rowLimit: 500 }),
  ]);

  const sum = (rows, k) => rows.reduce((n, r) => n + (r[k] || 0), 0);
  const avg = (rows, k) => (rows.length ? sum(rows, k) / rows.length : 0);

  const clicksNow = sum(now, 'clicks'), clicksBefore = sum(before, 'clicks');
  const imprNow = sum(now, 'impressions'), imprBefore = sum(before, 'impressions');
  const posNow = avg(now, 'position'), posBefore = avg(before, 'position');

  const clickChange = pct(clicksNow, clicksBefore);
  const imprChange = pct(imprNow, imprBefore);
  const yoyChange = pct(sum(yoyNow, 'clicks'), sum(yoyBefore, 'clicks'));

  const steps = [];
  const S = (n, name, verdict, detail) => steps.push({ n, name, verdict, detail });

  S(1, 'Tracking break', 'manual',
    'Rule this out first — it is free. Confirm the GA4 tag and GSC property were untouched across the period. If clicks fell in GSC too, tracking is not the cause: GSC does not depend on your tag.');

  S(2, 'Seasonality', Math.abs(yoyChange - clickChange) < 10 ? 'likely' : 'unlikely',
    `Same period last year changed ${fmt(yoyChange)}% against its own baseline; this year ${fmt(clickChange)}%. ${Math.abs(yoyChange - clickChange) < 10 ? 'The two move together, which is what seasonality looks like.' : 'The patterns diverge, so seasonality does not explain this on its own.'}`);

  S(3, 'SERP layout change', imprChange > -8 && clickChange < -15 ? 'likely' : 'unlikely',
    `Impressions ${fmt(imprChange)}%, clicks ${fmt(clickChange)}%. ${imprChange > -8 && clickChange < -15 ? 'Impressions roughly flat with clicks down is the signature of something appearing above you — an AI Overview, a new ad block, or an expanded pack.' : 'Impressions moved with clicks, so the change is in visibility rather than in click share.'}`);

  S(4, 'Core update', 'check',
    `Average position moved from ${posBefore.toFixed(1)} to ${posNow.toFixed(1)}. Check the drop dates against Google's published update list. Gradual over several days fits an update; overnight rarely does. Daily clicks: ${now.slice(0, 14).map((r) => r.clicks).join(', ')}`);

  S(5, 'Manual action', 'manual',
    'Search Console tells you outright — Security & Manual Actions. The API does not expose it, so check the interface.');

  S(6, 'Technical regression', 'check',
    'Crawl now and diff against a saved snapshot in the Compare tab. Look for a deploy, plugin update, hosting change, expired certificate, or robots.txt edit near the drop date.');

  S(7, 'Competitor movement', 'check',
    'The least satisfying answer and often the right one. Check whether your positions fell while impressions held — that means the SERP has more competition for the same queries.');

  return {
    summary: {
      clicksNow, clicksBefore, clickChange,
      imprNow, imprBefore, imprChange,
      posNow: Math.round(posNow * 10) / 10, posBefore: Math.round(posBefore * 10) / 10,
      yoyChange,
    },
    series: { now, before },
    steps,
  };
}

/** Which pages lost the most between two periods — where to look first. */
export async function pageDeltas(siteUrl, { aStart, aEnd, bStart, bEnd, dimension = 'page' } = {}) {
  const [a, b] = await Promise.all([
    queryAll(siteUrl, { startDate: aStart, endDate: aEnd, dimensions: [dimension] }),
    queryAll(siteUrl, { startDate: bStart, endDate: bEnd, dimensions: [dimension] }),
  ]);
  const map = new Map();
  for (const r of a) map.set(r[dimension], { key: r[dimension], before: r, after: null });
  for (const r of b) {
    const e = map.get(r[dimension]) || { key: r[dimension], before: null, after: null };
    e.after = r;
    map.set(r[dimension], e);
  }
  return [...map.values()].map((e) => ({
    key: e.key,
    clicksBefore: e.before?.clicks || 0,
    clicksAfter: e.after?.clicks || 0,
    delta: (e.after?.clicks || 0) - (e.before?.clicks || 0),
    imprBefore: e.before?.impressions || 0,
    imprAfter: e.after?.impressions || 0,
    posBefore: e.before ? Math.round(e.before.position * 10) / 10 : null,
    posAfter: e.after ? Math.round(e.after.position * 10) / 10 : null,
  })).sort((x, y) => x.delta - y.delta);
}

/** URL Inspection — the only way to read what Google actually decided about a URL. */
export async function inspect(siteUrl, inspectionUrl) {
  const r = await api().urlInspection.index.inspect({
    requestBody: { siteUrl, inspectionUrl, languageCode: 'en-US' },
  });
  const res = r.data.inspectionResult || {};
  const idx = res.indexStatusResult || {};
  return {
    url: inspectionUrl,
    verdict: idx.verdict,
    coverageState: idx.coverageState,
    robotsTxtState: idx.robotsTxtState,
    indexingState: idx.indexingState,
    pageFetchState: idx.pageFetchState,
    googleCanonical: idx.googleCanonical,
    userCanonical: idx.userCanonical,
    canonicalMatch: idx.googleCanonical && idx.userCanonical ? idx.googleCanonical === idx.userCanonical : null,
    lastCrawlTime: idx.lastCrawlTime,
    crawledAs: idx.crawledAs,
    sitemaps: idx.sitemap || [],
    referringUrls: idx.referringUrls || [],
    mobileUsability: res.mobileUsabilityResult?.verdict,
    mobileIssues: (res.mobileUsabilityResult?.issues || []).map((i) => i.message),
    richResults: (res.richResultsResult?.detectedItems || []).map((d) => ({
      type: d.richResultType,
      items: (d.items || []).map((i) => ({ name: i.name, issues: (i.issues || []).map((x) => `${x.severity}: ${x.issueMessage}`) })),
    })),
    inspectionLink: res.inspectionResultLink,
  };
}

export async function listSitemaps(siteUrl) {
  const r = await api().sitemaps.list({ siteUrl });
  return (r.data.sitemap || []).map((s) => ({
    path: s.path, lastSubmitted: s.lastSubmitted, lastDownloaded: s.lastDownloaded,
    isPending: s.isPending, errors: s.errors, warnings: s.warnings,
    submitted: s.contents?.[0]?.submitted, indexed: s.contents?.[0]?.indexed,
  }));
}

export async function submitSitemap(siteUrl, feedpath) {
  await api().sitemaps.submit({ siteUrl, feedpath });
  return { ok: true };
}

/**
 * Demand research from your own data: cluster queries by the page GSC says
 * they land on. This is a proxy for SERP-similarity clustering, not the real
 * thing — Google's own page choice, not a read of the live SERP. Labelled
 * inferred everywhere it surfaces.
 */
export async function clusterByLandingPage(siteUrl, { startDate, endDate, minImpressions = 10 } = {}) {
  const rows = await queryAll(siteUrl, { startDate, endDate, dimensions: ['page', 'query'] });
  const byPage = new Map();
  for (const r of rows) {
    if (r.impressions < minImpressions) continue;
    const e = byPage.get(r.page) || { page: r.page, queries: [], clicks: 0, impressions: 0 };
    e.queries.push({ query: r.query, clicks: r.clicks, impressions: r.impressions, position: Math.round(r.position * 10) / 10 });
    e.clicks += r.clicks;
    e.impressions += r.impressions;
    byPage.set(r.page, e);
  }
  return [...byPage.values()]
    .map((e) => ({
      ...e,
      queries: e.queries.sort((a, b) => b.impressions - a.impressions).slice(0, 40),
      primaryQuery: e.queries.sort((a, b) => b.impressions - a.impressions)[0]?.query,
      queryCount: e.queries.length,
    }))
    .sort((a, b) => b.impressions - a.impressions);
}

const pct = (a, b) => (b ? Math.round(((a - b) / b) * 1000) / 10 : 0);
const fmt = (n) => (n > 0 ? `+${n}` : String(n));
function shiftYear(d) {
  const dt = new Date(d);
  dt.setFullYear(dt.getFullYear() - 1);
  return dt.toISOString().slice(0, 10);
}
export function dateRange(daysAgoStart, daysAgoEnd = 3) {
  const d = (n) => { const x = new Date(); x.setDate(x.getDate() - n); return x.toISOString().slice(0, 10); };
  return { startDate: d(daysAgoStart), endDate: d(daysAgoEnd) };
}
