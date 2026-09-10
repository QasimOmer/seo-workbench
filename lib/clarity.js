/* Microsoft Clarity — Data Export API.
   Complements the SEO side: Clarity records what people actually did on the
   page, so a rage-click cluster or a dead click explains a poor conversion
   rate that rankings and Core Web Vitals cannot.

   Two hard constraints from the API, both of which shape this module:
     - 10 requests per project per DAY. So every response is cached and the
       remaining budget is tracked and shown, because burning the tenth call on
       a duplicate query costs you the rest of the day.
     - 3 days of history maximum. There are no trends here, only a recent
       snapshot. Anything claiming a Clarity trend line would be inventing it. */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
const FILE = join(DATA, 'clarity-cache.json');
const ENDPOINT = 'https://www.clarity.ms/export-data/api/v1/project-live-insights';
const DAILY_CAP = 10;

export const DIMENSIONS = ['Browser', 'Device', 'Country/Region', 'OS', 'Source', 'Medium', 'Campaign', 'Channel', 'URL'];

/* The metrics worth acting on, and what each one means for the page. Clarity
   returns many; these are the ones that change a decision. */
export const SIGNALS = {
  'Rage Click Count': {
    label: 'Rage clicks',
    means: 'Repeated fast clicks in one spot. Almost always something that looks clickable and is not, or is clickable and does nothing.',
    act: 'Watch a recording of the page, then either make the element work or stop it looking interactive.',
    severity: 'High',
  },
  'Dead Click Count': {
    label: 'Dead clicks',
    means: 'A click that produced no reaction at all. Often a styled div that was never wired up, or an image people expect to enlarge.',
    act: 'Find what they are clicking. If it should do something, wire it. If not, remove the affordance.',
    severity: 'High',
  },
  'Script Error Count': {
    label: 'Script errors',
    means: 'JavaScript failing in real browsers. This is also an SEO problem if the failing script renders content.',
    act: 'Reproduce it, then check whether anything Google needs to see depends on that script.',
    severity: 'High',
  },
  'Quickback Click': {
    label: 'Quickbacks',
    means: 'People clicked through and came straight back. The destination did not match what the link promised.',
    act: 'This is an intent mismatch you can measure. Compare the link text against what the landing page actually delivers.',
    severity: 'Medium',
  },
  'Excessive Scroll': {
    label: 'Excessive scrolling',
    means: 'People scrolling far more than the content warrants — usually hunting for something that should have been higher.',
    act: 'Move the thing they are looking for up. Check the page against the answer-first test.',
    severity: 'Medium',
  },
  'Error Click Count': {
    label: 'Error clicks',
    means: 'Clicks that triggered an error.',
    act: 'Treat as a bug, not a UX nuance.',
    severity: 'High',
  },
};

const read = async () => { try { return JSON.parse(await readFile(FILE, 'utf8')); } catch { return { calls: [], cache: {} }; } };
const write = async (v) => { await mkdir(DATA, { recursive: true }); await writeFile(FILE, JSON.stringify(v, null, 2)); };

const today = () => new Date().toISOString().slice(0, 10);

/** How many of the ten calls remain today. Shown before you spend one. */
export async function budget() {
  const d = await read();
  const used = d.calls.filter((c) => c.startsWith(today())).length;
  return { used, cap: DAILY_CAP, remaining: Math.max(0, DAILY_CAP - used), resetsAt: 'midnight UTC' };
}

export const configured = () => !!process.env.CLARITY_API_TOKEN;

/**
 * One call, cached by its exact parameters. A repeat query inside the cache
 * window costs nothing, which matters when you only get ten a day.
 */
export async function fetchInsights({ numOfDays = 3, dimensions = [], force = false } = {}) {
  const token = process.env.CLARITY_API_TOKEN;
  if (!token) {
    throw new Error('No Clarity token. Clarity → Settings → Data Export → Generate new API token, then paste it into Setup & keys.');
  }
  const days = [1, 2, 3].includes(Number(numOfDays)) ? Number(numOfDays) : 3;
  const dims = dimensions.filter((x) => DIMENSIONS.includes(x)).slice(0, 3);
  const cacheKey = `${days}|${dims.join(',')}`;

  const d = await read();
  const hit = d.cache[cacheKey];
  // Six hours: long enough to stop casual repeats burning the budget, short
  // enough that a day's data is not stale by the time you look.
  if (hit && !force && Date.now() - hit.at < 6 * 3600e3) {
    return { ...hit.payload, cached: true, cachedAt: new Date(hit.at).toISOString(), budget: await budget() };
  }

  const b = await budget();
  if (b.remaining <= 0) {
    if (hit) return { ...hit.payload, cached: true, stale: true, cachedAt: new Date(hit.at).toISOString(), budget: b,
      note: 'Daily API limit reached, so this is the last cached response. Clarity allows ten calls per project per day and it resets at midnight UTC.' };
    throw new Error('Clarity allows ten API calls per project per day and today\'s are used up. It resets at midnight UTC. Nothing is cached for these parameters yet.');
  }

  const u = new URL(ENDPOINT);
  u.searchParams.set('numOfDays', String(days));
  dims.forEach((dim, i) => u.searchParams.set(`dimension${i + 1}`, dim));

  const res = await fetch(u, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(30000),
  });
  const text = await res.text();

  d.calls.push(new Date().toISOString());
  d.calls = d.calls.filter((c) => c.startsWith(today()) || c > new Date(Date.now() - 172800e3).toISOString());
  await write(d);

  if (!res.ok) {
    let detail = text.slice(0, 240);
    try { detail = JSON.parse(text)?.message || JSON.parse(text)?.error || detail; } catch { /* raw */ }
    if (res.status === 401 || res.status === 403) {
      throw new Error(`Clarity rejected the token (HTTP ${res.status}). Tokens are per-project — check you generated it on the project you mean, and that it has not been regenerated since. ${detail}`);
    }
    if (res.status === 429) throw new Error('Clarity rate limit hit. Ten calls per project per day, resetting at midnight UTC.');
    throw new Error(`Clarity returned HTTP ${res.status}: ${detail}`);
  }

  let json;
  try { json = JSON.parse(text); } catch { throw new Error('Clarity did not return JSON. Something on the network path intercepted the request.'); }

  const payload = shape(json, { days, dims });
  d.cache[cacheKey] = { at: Date.now(), payload };
  await write(d);
  return { ...payload, cached: false, budget: await budget() };
}

/* ── shaping ──────────────────────────────────────────────────────────────── */

const numOf = (v) => { const n = Number(String(v ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : 0; };

/**
 * Clarity returns an array of { metricName, information: [...] } where the rows
 * carry whichever dimensions were requested. Flattened into something the UI
 * can render, with the friction signals separated from the traffic ones because
 * they are the ones that produce actions.
 */
function shape(raw, { days, dims }) {
  const metrics = Array.isArray(raw) ? raw : [];
  const byName = {};
  for (const m of metrics) if (m?.metricName) byName[m.metricName] = m.information || [];

  const traffic = byName.Traffic || [];
  const sessions = traffic.reduce((t, r) => t + numOf(r.totalSessionCount), 0);
  const bots = traffic.reduce((t, r) => t + numOf(r.totalBotSessionCount), 0);

  const friction = [];
  for (const [name, meta] of Object.entries(SIGNALS)) {
    const rows = byName[name] || [];
    if (!rows.length) continue;
    const total = rows.reduce((t, r) => t + numOf(r[name] ?? r.count ?? Object.values(r).find((v) => !Number.isNaN(Number(v)))), 0);
    if (!total) continue;
    friction.push({
      metric: name, ...meta, total,
      per1k: sessions ? +((total / sessions) * 1000).toFixed(1) : null,
      breakdown: rows.slice(0, 8),
    });
  }
  friction.sort((a, b) => b.total - a.total);

  const pages = (byName['Popular Pages'] || []).slice(0, 15);
  const scroll = byName['Scroll Depth'] || [];
  const engagement = byName['Engagement Time'] || [];

  return {
    days, dimensions: dims,
    sessions, bots,
    botShare: sessions + bots ? Math.round((bots / (sessions + bots)) * 100) : null,
    friction, pages, scroll, engagement,
    metricsSeen: Object.keys(byName),
    read: friction.length
      ? `${friction[0].label} is the biggest friction signal (${friction[0].total} in ${days} day${days === 1 ? '' : 's'}). ${friction[0].act}`
      : sessions
        ? 'No friction signals in this window. Traffic is being recorded but nobody is rage-clicking or hitting dead ends.'
        : 'No sessions recorded in this window. Either the tag is not firing or the site has no traffic yet.',
    caveat: `Clarity only exposes the last ${days} day${days === 1 ? '' : 's'} through this API, so this is a snapshot rather than a trend. For longer history use the Clarity dashboard directly.`,
  };
}

export { shape as _shape };
