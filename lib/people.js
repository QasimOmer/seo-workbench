/* People and assignment.
   Deliberately NOT authentication. This tool runs on localhost with no TLS,
   and a login screen there protects nothing — anyone with the machine has
   data/*.json regardless. Shipping auth I cannot security-test would be worse
   than shipping none, because it would imply a guarantee that isn't there.

   What an agency actually needs from "user management" is assignment: who owns
   a finding, who is doing which week of the plan, and who to chase. That is a
   data model, not a security boundary, and it is what this is. */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ROOT, DATA_DIR } from './paths.js';
const DATA = DATA_DIR;
const FILE = join(DATA, 'people.json');
const ROOT_FILE = join(ROOT, 'data', 'people.json');

const read = async () => {
  try { return JSON.parse(await readFile(FILE, 'utf8')); }
  catch {
    if (DATA !== join(ROOT, 'data')) {
      try { return JSON.parse(await readFile(ROOT_FILE, 'utf8')); } catch {}
    }
    return { people: [], assignments: {} };
  }
};
const write = async (v) => { await mkdir(DATA, { recursive: true }); await writeFile(FILE, JSON.stringify(v, null, 2)); };

/* Roles map to the owner field the audit already emits, so an assignment can
   be suggested rather than always typed. */
export const ROLES = [
  { id: 'dev', label: 'Developer', handles: 'Template, server and code changes' },
  { id: 'content', label: 'Content', handles: 'Copy, briefs and on-page work' },
  { id: 'SEO', label: 'SEO', handles: 'Diagnosis, mapping and measurement' },
  { id: 'design', label: 'Design', handles: 'Layout, imagery and CLS-affecting work' },
  { id: 'client', label: 'Client', handles: 'Approvals and anything needing their access' },
];

/* Stable colour per person from a hash, so an avatar keeps its colour without
   anyone choosing one. */
const HUES = [210, 155, 20, 280, 340, 45, 190, 110];
const hue = (s) => HUES[[...String(s)].reduce((a, c) => a + c.charCodeAt(0), 0) % HUES.length];

const initials = (name) => String(name).trim().split(/\s+/).slice(0, 2)
  .map((w) => w[0]).join('').toUpperCase() || '?';

export async function list() {
  const d = await read();
  return {
    people: d.people.map((p) => ({ ...p, initials: initials(p.name), hue: hue(p.id) })),
    assignments: d.assignments,
    roles: ROLES,
  };
}

export async function save(person) {
  const d = await read();
  const id = person.id || `p${Date.now().toString(36)}`;
  const rec = {
    id,
    name: String(person.name || '').trim(),
    role: ROLES.some((r) => r.id === person.role) ? person.role : 'dev',
    email: String(person.email || '').trim(),
    capacity: Number(person.capacity) || 10,   // effort points per week
  };
  if (!rec.name) throw new Error('A person needs a name.');
  const i = d.people.findIndex((p) => p.id === id);
  if (i >= 0) d.people[i] = rec; else d.people.push(rec);
  await write(d);
  return { ...rec, initials: initials(rec.name), hue: hue(rec.id) };
}

export async function remove(id) {
  const d = await read();
  d.people = d.people.filter((p) => p.id !== id);
  // An assignment to someone who left is worse than none — clear them.
  for (const [k, v] of Object.entries(d.assignments)) if (v === id) delete d.assignments[k];
  await write(d);
  return list();
}

export async function assign(findingId, personId) {
  const d = await read();
  if (personId) d.assignments[findingId] = personId; else delete d.assignments[findingId];
  await write(d);
  return { findingId, personId: personId || null };
}

/** Who each finding is on, plus the load that implies per person. */
export async function workload(findings = []) {
  const d = await read();
  const EFFORT = { S: 1, M: 3, L: 8 };
  const byPerson = {};
  let unassigned = 0;

  for (const f of findings) {
    const pid = d.assignments[f.id || f.title];
    const pts = EFFORT[f.effort] || 3;
    if (!pid) { unassigned += pts; continue; }
    (byPerson[pid] ||= { points: 0, items: 0 });
    byPerson[pid].points += pts;
    byPerson[pid].items++;
  }

  return {
    people: d.people.map((p) => {
      const load = byPerson[p.id] || { points: 0, items: 0 };
      const weeks = p.capacity ? +(load.points / p.capacity).toFixed(1) : null;
      return {
        ...p, initials: initials(p.name), hue: hue(p.id), ...load, weeks,
        /* Three weeks is the threshold because beyond that the work stops
           being a sprint and starts being a backlog nobody revisits. */
        note: weeks == null ? 'No capacity set.'
          : weeks > 3 ? `${weeks} weeks of work at their stated capacity — that is a queue, not a sprint. Reassign or cut scope.`
          : weeks > 0 ? `About ${weeks} week${weeks === 1 ? '' : 's'} of work at their stated capacity.`
          : 'Nothing assigned.',
      };
    }),
    unassignedPoints: unassigned,
    note: unassigned
      ? `${unassigned} effort points are on nobody. Work with no owner does not ship — that is the single most common reason an audit produces no change.`
      : 'Everything has an owner.',
  };
}

/** Suggest an assignee from the finding's own owner field. */
export async function suggest(finding) {
  const d = await read();
  const match = d.people.find((p) => p.role === finding.owner);
  return match ? match.id : null;
}
