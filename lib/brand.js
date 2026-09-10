/* Brand and project context.
   Every AI-generated artefact in this tool — a title, a fix, a caption, a post —
   is only as good as what it knows about the client. This is that memory: one
   record per property, written once, read by everything. Without it the model
   invents a voice, and invented voices are why AI copy reads like AI copy. */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
const file = (id) => join(DATA, `brand-${id}.json`);

export const BLANK = {
  name: '', oneLiner: '', services: [], locations: [], audience: '',
  voice: '', avoid: '', differentiators: '', competitors: [],
  primaryColor: '#17564A', secondaryColor: '#EDEFE8',
  cta: '', phone: '', bookingUrl: '',
  compliance: '', notes: '',
};

export async function getBrand(id) {
  try { return { ...BLANK, ...JSON.parse(await readFile(file(id), 'utf8')) }; }
  catch { return { ...BLANK }; }
}

export async function saveBrand(id, patch) {
  const current = await getBrand(id);
  const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
  await mkdir(DATA, { recursive: true });
  await writeFile(file(id), JSON.stringify(next, null, 2));
  return next;
}

/** How complete is the context? Thin context produces generic output, so the UI
    says so rather than letting you wonder why the copy is bland. */
export function brandCompleteness(b) {
  const weighted = [
    ['name', 3], ['oneLiner', 3], ['services', 3], ['audience', 3], ['voice', 3],
    ['locations', 2], ['differentiators', 2], ['cta', 2], ['avoid', 1],
    ['competitors', 1], ['compliance', 1],
  ];
  let have = 0, total = 0;
  const missing = [];
  for (const [k, w] of weighted) {
    total += w;
    const v = b[k];
    const filled = Array.isArray(v) ? v.length > 0 : String(v || '').trim().length > 0;
    if (filled) have += w; else missing.push(k);
  }
  return { pct: Math.round((have / total) * 100), missing };
}

/** The block prepended to every generation prompt. Kept terse on purpose: a
    model given three paragraphs of brand waffle writes three paragraphs back. */
export function brandPrompt(b) {
  if (!b?.name) return 'No brand context has been recorded. Write plainly and make no claims about the business you cannot support.';
  const L = [];
  L.push(`Business: ${b.name}${b.oneLiner ? ` — ${b.oneLiner}` : ''}`);
  if (b.services?.length) L.push(`Services: ${b.services.join('; ')}`);
  if (b.locations?.length) L.push(`Serves: ${b.locations.join('; ')}`);
  if (b.audience) L.push(`Audience: ${b.audience}`);
  if (b.voice) L.push(`Voice: ${b.voice}`);
  if (b.differentiators) L.push(`True differentiators (only claim these): ${b.differentiators}`);
  if (b.cta) L.push(`Preferred call to action: ${b.cta}`);
  if (b.avoid) L.push(`Never write: ${b.avoid}`);
  if (b.compliance) L.push(`Compliance constraints, non-negotiable: ${b.compliance}`);
  L.push('Do not invent facts, statistics, awards, case results or credentials. If a claim needs a source you do not have, leave it out.');
  return L.join('\n');
}
