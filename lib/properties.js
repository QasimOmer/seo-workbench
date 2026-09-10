/* Property registry.
   A portal that forgets which sites you work on is just a form. This keeps a
   small registry on disk plus the last crawl per property, so switching back to
   a site restores its findings instead of making you re-crawl to look at them. */

import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ROOT, DATA_DIR, readJson, writeJson } from './paths.js';
const DATA = DATA_DIR;
const INDEX = join(DATA, 'properties.json');

const slug = (s) => s.toLowerCase().replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

export async function listProperties() {
  const idx = await readJson(INDEX, { properties: [], activeId: null });
  idx.properties.sort((a, b) => (b.lastCrawledAt || '').localeCompare(a.lastCrawledAt || ''));
  return idx;
}

/** Idempotent: crawling a site registers it, crawling it again just updates it. */
export async function upsertProperty(origin, patch = {}) {
  const idx = await readJson(INDEX, { properties: [], activeId: null });
  const id = slug(origin);
  const existing = idx.properties.find((p) => p.id === id);
  const rec = existing || {
    id, origin, label: origin.replace(/^https?:\/\//, ''),
    // 'planning' means the site does not exist yet, which changes which half of
    // the tool applies. Crawling one flips it to 'live'.
    stage: 'live',
    addedAt: new Date().toISOString(),
  };
  Object.assign(rec, patch);
  if (patch.lastCrawledAt) rec.stage = 'live';   // it exists, so it is no longer planning
  if (!existing) idx.properties.push(rec);
  idx.activeId = id;
  await writeJson(INDEX, idx);
  return rec;
}

/** A property can be registered before a site exists — that is the whole point
    of planning mode, and it has no origin to crawl. */
export async function addPlanned({ label, origin }) {
  const idx = await readJson(INDEX, { properties: [], activeId: null });
  const id = slug(origin || label);
  if (idx.properties.some((p) => p.id === id)) throw new Error('That project is already in the portal.');
  const rec = {
    id, origin: origin || '', label: label || origin,
    stage: 'planning', addedAt: new Date().toISOString(),
    lastCrawledAt: null, pages: 0, counts: null,
  };
  idx.properties.push(rec);
  idx.activeId = id;
  await writeJson(INDEX, idx);
  return rec;
}

export async function setStage(id, stage) {
  const idx = await readJson(INDEX, { properties: [], activeId: null });
  const p = idx.properties.find((x) => x.id === id);
  if (!p) throw new Error('No such property.');
  p.stage = stage;
  await writeJson(INDEX, idx);
  return p;
}

export async function setActive(id) {
  const idx = await readJson(INDEX, { properties: [], activeId: null });
  if (!idx.properties.some((p) => p.id === id)) return null;
  idx.activeId = id;
  await writeJson(INDEX, idx);
  return idx.properties.find((p) => p.id === id);
}

export async function removeProperty(id) {
  const idx = await readJson(INDEX, { properties: [], activeId: null });
  idx.properties = idx.properties.filter((p) => p.id !== id);
  if (idx.activeId === id) idx.activeId = idx.properties[0]?.id || null;
  await writeJson(INDEX, idx);
  try { await unlink(join(DATA, `prop-${id}.json`)); } catch { /* nothing cached */ }
  return idx;
}

/* ── cached crawl per property ─────────────────────────────────────────────── */

export const cacheCrawl = (id, payload) => writeJson(join(DATA, `prop-${id}.json`), payload);
export const loadCrawl = (id) => readJson(join(DATA, `prop-${id}.json`), null);
export { slug as propertyId };
