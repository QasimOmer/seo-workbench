/* Storage and filesystem paths.
   Centralizes directory resolution across the app. On Vercel or AWS Lambda,
   the project root filesystem is strictly read-only; only `/tmp` is writable.
   This module ensures all data read/write operations seamlessly use `/tmp/data`
   in serverless environments, with transparent fallback to repository seed data
   in `ROOT/data` when initialized. */

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = process.env.DATA_DIR || (process.env.VERCEL ? join('/tmp', 'data') : join(ROOT, 'data'));
export const SEED_DIR = join(ROOT, 'data');

/**
 * Safely read a JSON file from DATA_DIR. If missing in DATA_DIR (e.g. fresh lambda container),
 * attempts to read from SEED_DIR before returning fallback.
 */
export async function readJson(filename, fallback = null) {
  const primary = join(DATA_DIR, filename);
  try {
    const raw = await readFile(primary, 'utf8');
    return JSON.parse(raw);
  } catch {
    if (DATA_DIR !== SEED_DIR) {
      try {
        const seed = join(SEED_DIR, filename);
        const raw = await readFile(seed, 'utf8');
        return JSON.parse(raw);
      } catch {}
    }
    return fallback;
  }
}

/**
 * Safely write a JSON file to DATA_DIR, ensuring the directory exists.
 */
export async function writeJson(filename, data, options = {}) {
  await mkdir(DATA_DIR, { recursive: true });
  const target = join(DATA_DIR, filename);
  await writeFile(target, JSON.stringify(data, null, 2), { mode: 0o600, ...options });
}
