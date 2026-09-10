/* Scheduled monitoring.
   This is what turns a one-off audit into something that catches a deploy
   breaking canonicals at 2am. node-cron (ISC) handles the schedule; the value
   is in the diff and in deciding what counts as worth telling someone about.

   Deliberate choice: alerts fire on REGRESSIONS, not on state. A site with 40
   known Medium findings should be silent until something changes. A monitor
   that pages you about a problem you already accepted gets muted, and a muted
   monitor is worse than none. */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
const cfgFile = join(DATA, 'monitors.json');
const logFile = (id) => join(DATA, `monitor-log-${id}.json`);

const read = async (p, fb) => { try { return JSON.parse(await readFile(p, 'utf8')); } catch { return fb; } };
const write = async (p, v) => { await mkdir(DATA, { recursive: true }); await writeFile(p, JSON.stringify(v, null, 2)); };

export const listMonitors = () => read(cfgFile, []);

const SEV_RANK = { Critical: 0, High: 1, Medium: 2, Low: 3 };

export async function saveMonitor(m) {
  const all = await listMonitors();
  const rec = {
    id: m.id || `m${Date.now().toString(36)}`,
    url: m.url,
    label: m.label || m.url,
    cron: m.cron || '0 3 * * 1',        // Mondays 03:00 — before anyone looks
    maxPages: Number(m.maxPages) || 500,
    render: !!m.render,
    alertOn: m.alertOn || ['Critical', 'High'],
    enabled: m.enabled !== false,
    createdAt: m.createdAt || new Date().toISOString(),
    lastRunAt: m.lastRunAt || null,
    lastStatus: m.lastStatus || null,
  };
  const i = all.findIndex((x) => x.id === rec.id);
  if (i >= 0) all[i] = { ...all[i], ...rec }; else all.push(rec);
  await write(cfgFile, all);
  return rec;
}

export async function deleteMonitor(id) {
  await write(cfgFile, (await listMonitors()).filter((m) => m.id !== id));
  return listMonitors();
}

/**
 * Compares two audit runs. Returns only what CHANGED, classified by whether a
 * human should be told. `appeared` at or above the alert threshold is the whole
 * point; `resolved` is included because knowing a fix worked matters too.
 */
export function diffRuns(prev, next, alertOn = ['Critical', 'High']) {
  const key = (f) => f.id || f.title;
  const before = new Map((prev?.findings || []).map((f) => [key(f), f]));
  const after = new Map((next?.findings || []).map((f) => [key(f), f]));

  const appeared = [], resolved = [], worsened = [], grew = [];

  for (const [k, f] of after) {
    if (!before.has(k)) { appeared.push(f); continue; }
    const b = before.get(k);
    if (SEV_RANK[f.severity] < SEV_RANK[b.severity]) worsened.push({ ...f, from: b.severity });
    // A finding covering 3x the URLs is materially different even at the same severity.
    const bn = (b.urls || []).length, an = (f.urls || []).length;
    if (bn > 0 && an >= bn * 2) grew.push({ ...f, fromCount: bn, toCount: an });
  }
  for (const [k, f] of before) if (!after.has(k)) resolved.push(f);

  const alertable = [
    ...appeared.filter((f) => alertOn.includes(f.severity)),
    ...worsened.filter((f) => alertOn.includes(f.severity)),
  ];

  // Traffic-shaped signals the finding list alone would miss.
  const pageDelta = (next?.stats?.crawled || 0) - (prev?.stats?.crawled || 0);
  const structural = [];
  if (prev?.stats && next?.stats) {
    const p = prev.stats, n = next.stats;
    if (p.crawled > 10 && n.crawled < p.crawled * 0.8) {
      structural.push(`Crawlable pages fell from ${p.crawled} to ${n.crawled}. A drop this size usually means a nav change, a robots.txt edit, or pages returning errors — check before anything else.`);
    }
    if ((n.noindex || 0) > (p.noindex || 0)) {
      structural.push(`Pages carrying noindex rose from ${p.noindex || 0} to ${n.noindex}. This is the single most common way a deploy silently removes pages from Google.`);
    }
    if ((n.errors || 0) > (p.errors || 0)) {
      structural.push(`URLs returning 4xx or 5xx rose from ${p.errors || 0} to ${n.errors}.`);
    }
    if (p.indexable > 5 && n.indexable < p.indexable * 0.9) {
      structural.push(`Indexable pages fell from ${p.indexable} to ${n.indexable}.`);
    }
  }

  return {
    appeared, resolved, worsened, grew, structural,
    alertable: [...alertable],
    pageDelta,
    quiet: alertable.length === 0 && structural.length === 0,
    summary: alertable.length || structural.length
      ? `${alertable.length} new or worsened finding${alertable.length === 1 ? '' : 's'} at ${alertOn.join('/')}${structural.length ? `, plus ${structural.length} structural change${structural.length === 1 ? '' : 's'}` : ''}.`
      : `Nothing worth reporting. ${appeared.length} minor finding${appeared.length === 1 ? '' : 's'} appeared, ${resolved.length} resolved.`,
  };
}

export async function appendRun(id, entry) {
  const log = await read(logFile(id), []);
  log.push({ at: new Date().toISOString(), ...entry });
  await write(logFile(id), log.slice(-60));
  return log.length;
}

export const runLog = (id) => read(logFile(id), []);

/* ── the scheduler ────────────────────────────────────────────────────────── */

const tasks = new Map();

/**
 * Starts every enabled monitor. `runner` is injected rather than imported so
 * this module stays testable without booting a crawler.
 */
export async function startAll(runner, { cron } = {}) {
  if (!cron) return { started: 0, reason: 'node-cron not available' };
  stopAll();
  const monitors = (await listMonitors()).filter((m) => m.enabled);
  for (const m of monitors) {
    if (!cron.validate(m.cron)) continue;
    tasks.set(m.id, cron.schedule(m.cron, () => { runner(m).catch(() => {}); }));
  }
  return { started: tasks.size, monitors: monitors.map((m) => ({ id: m.id, label: m.label, cron: m.cron })) };
}

export function stopAll() {
  for (const t of tasks.values()) { try { t.stop(); } catch { /* already stopped */ } }
  tasks.clear();
}

export const activeCount = () => tasks.size;

/** Human-readable cron, because "0 3 * * 1" tells most people nothing. */
export function describeCron(expr) {
  const presets = {
    '0 3 * * *': 'Every day at 03:00',
    '0 3 * * 1': 'Every Monday at 03:00',
    '0 3 1 * *': 'The 1st of each month at 03:00',
    '0 */6 * * *': 'Every 6 hours',
    '0 3 * * 1,4': 'Mondays and Thursdays at 03:00',
  };
  return presets[expr] || expr;
}

export const CRON_PRESETS = [
  { expr: '0 3 * * 1', label: 'Weekly — Monday 03:00' },
  { expr: '0 3 * * 1,4', label: 'Twice weekly — Mon & Thu 03:00' },
  { expr: '0 3 * * *', label: 'Daily — 03:00' },
  { expr: '0 */6 * * *', label: 'Every 6 hours' },
  { expr: '0 3 1 * *', label: 'Monthly — 1st at 03:00' },
];
