/* Campaigns and the SEO programme.
   The programme turns a findings list into a dated sequence. Its whole value is
   refusing to reorder itself around what is easy: the ladder decides what comes
   first, and effort only breaks ties within a stage. */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DATA_DIR, readJson, writeJson } from './paths.js';
const DATA = DATA_DIR;
const campFile = (id) => `campaigns-${id}.json`;
const progFile = (id) => `program-${id}.json`;

const read = (p, fb) => readJson(p, fb);
const write = (p, v) => writeJson(p, v);

/* ── campaigns ────────────────────────────────────────────────────────────── */

export const listCampaigns = (id) => read(campFile(id), []);

export async function saveCampaign(id, c) {
  const all = await listCampaigns(id);
  const i = all.findIndex((x) => x.id === c.id);
  const rec = {
    id: c.id || `c${Date.now().toString(36)}`,
    name: c.name || 'Untitled campaign',
    goal: c.goal || '', channel: c.channel || 'organic',
    status: c.status || 'planned',
    startDate: c.startDate || '', endDate: c.endDate || '',
    targetUrls: c.targetUrls || [], keywords: c.keywords || [],
    baseline: c.baseline || null, assets: c.assets || [],
    notes: c.notes || '',
    updatedAt: new Date().toISOString(),
  };
  if (i >= 0) all[i] = { ...all[i], ...rec }; else all.push(rec);
  await write(campFile(id), all);
  return rec;
}

export async function deleteCampaign(id, cid) {
  const all = (await listCampaigns(id)).filter((c) => c.id !== cid);
  await write(campFile(id), all);
  return all;
}

/** A campaign without a baseline can't be evaluated later, only argued about.
    So we snapshot the numbers at the moment it starts. */
export async function baselineCampaign(id, cid, metrics) {
  const all = await listCampaigns(id);
  const c = all.find((x) => x.id === cid);
  if (!c) throw new Error('No such campaign.');
  c.baseline = { at: new Date().toISOString(), ...metrics };
  c.status = 'running';
  await write(campFile(id), all);
  return c;
}

/* ── the programme ────────────────────────────────────────────────────────── */

const LADDER = ['eligibility', 'indexation', 'intent', 'onpage', 'linking', 'schema', 'performance', 'offpage'];
const SEV = { Critical: 0, High: 1, Medium: 2, Low: 3 };
const EFFORT = { S: 1, M: 3, L: 8 };

const STAGE_GOAL = {
  eligibility: 'Everything Google should see is fetchable, renderable and returning 200.',
  indexation: 'One canonical URL per piece of content, and Google agrees with your choice.',
  intent: 'Every money page matches the format the SERP actually rewards.',
  onpage: 'Titles, headings and opening copy answer the query the page targets.',
  linking: 'No money page is more than three clicks deep or short of internal links.',
  schema: 'Valid structured data on the page types that can earn rich results.',
  performance: 'Core Web Vitals pass at the 75th percentile on mobile.',
  offpage: 'Citations consistent, profile complete, and a real reason to be linked to.',
};

/** Weeks are capacity-based rather than fixed-length: a stage takes as long as
    its work takes. Effort points are the only thing that sets the pace. */
export function buildProgram(findings, { pointsPerWeek = 10, startDate } = {}) {
  const ordered = [...findings].sort((a, b) => {
    const la = LADDER.indexOf(a.phase), lb = LADDER.indexOf(b.phase);
    if (la !== lb) return (la < 0 ? 99 : la) - (lb < 0 ? 99 : lb);
    if (SEV[a.severity] !== SEV[b.severity]) return SEV[a.severity] - SEV[b.severity];
    return (EFFORT[a.effort] || 3) - (EFFORT[b.effort] || 3);
  });

  const start = startDate ? new Date(startDate) : new Date();
  const weeks = [];
  let cur = { n: 1, points: 0, items: [] };

  for (const f of ordered) {
    const pts = EFFORT[f.effort] || 3;
    if (cur.points + pts > pointsPerWeek && cur.items.length) {
      weeks.push(cur);
      cur = { n: cur.n + 1, points: 0, items: [] };
    }
    cur.items.push({ id: f.id, title: f.title, phase: f.phase, severity: f.severity, effort: f.effort, owner: f.owner, points: pts });
    cur.points += pts;
  }
  if (cur.items.length) weeks.push(cur);

  weeks.forEach((wk) => {
    const d = new Date(start); d.setDate(d.getDate() + (wk.n - 1) * 7);
    wk.startDate = d.toISOString().slice(0, 10);
    wk.stages = [...new Set(wk.items.map((i) => i.phase))];
    wk.focus = wk.stages.map((s) => STAGE_GOAL[s]).filter(Boolean)[0] || '';
    wk.owners = [...new Set(wk.items.map((i) => i.owner).filter(Boolean))];
  });

  const stages = LADDER.map((s) => {
    const items = ordered.filter((f) => f.phase === s);
    const first = weeks.find((wk) => wk.items.some((i) => i.phase === s));
    const last = [...weeks].reverse().find((wk) => wk.items.some((i) => i.phase === s));
    return {
      phase: s, goal: STAGE_GOAL[s], count: items.length,
      points: items.reduce((t, f) => t + (EFFORT[f.effort] || 3), 0),
      firstWeek: first?.n || null, lastWeek: last?.n || null,
      blocking: items.some((f) => f.severity === 'Critical' || f.severity === 'High'),
    };
  });

  return {
    weeks, stages,
    totalPoints: ordered.reduce((t, f) => t + (EFFORT[f.effort] || 3), 0),
    totalItems: ordered.length,
    pointsPerWeek,
    horizonWeeks: weeks.length,
    note: 'Effort points: S=1, M=3, L=8. Weeks fill to capacity, so a heavy stage spans several. The order is the priority ladder — effort only breaks ties inside a stage, never across them.',
  };
}

export const getProgress = (id) => read(progFile(id), { done: [] });

export async function toggleProgress(id, findingId) {
  const p = await getProgress(id);
  const i = p.done.indexOf(findingId);
  if (i >= 0) p.done.splice(i, 1); else p.done.push(findingId);
  await write(progFile(id), p);
  return p;
}
