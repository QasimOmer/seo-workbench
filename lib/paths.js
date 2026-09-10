/* Storage and filesystem paths.
   Centralizes directory resolution across the app. On Vercel or AWS Lambda,
   the project root filesystem is strictly read-only; only `/tmp` is writable.
   This module ensures all data read/write operations seamlessly use `/tmp/data`
   in serverless environments, with transparent fallback to repository seed data
   in `ROOT/data` when initialized. */

import { join, dirname, basename, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, accessSync, constants as fsConstants } from 'node:fs';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const SEED_DIR = join(ROOT, 'data');

export function isServerlessEnvironment() {
  if (process.env.DATA_DIR && process.env.DATA_DIR.startsWith('/tmp')) return true;
  if (process.env.VERCEL || process.env.VERCEL_ENV || process.env.NOW_REGION) return true;
  if (process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.LAMBDA_TASK_ROOT) return true;
  if (process.env.NETLIFY || process.env.DENO_DEPLOYMENT_ID) return true;
  if (ROOT.startsWith('/var/task') || ROOT.startsWith('/opt')) return true;
  try {
    if (typeof process.cwd === 'function' && process.cwd().startsWith('/var/task')) return true;
  } catch {}
  return false;
}

export const IS_SERVERLESS = isServerlessEnvironment();

function resolveDataDir() {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  if (IS_SERVERLESS) return join('/tmp', 'data');
  const defaultDir = join(ROOT, 'data');
  try {
    if (existsSync(defaultDir)) {
      accessSync(defaultDir, fsConstants.W_OK);
      return defaultDir;
    }
  } catch {
    return join('/tmp', 'data');
  }
  return defaultDir;
}

export const DATA_DIR = resolveDataDir();

/**
 * Safely read a JSON file from DATA_DIR or absolute path. If missing (e.g. fresh lambda container),
 * attempts to read from /tmp/data and then from SEED_DIR before returning fallback.
 */
export async function readJson(filenameOrPath, fallback = null) {
  const filename = isAbsolute(filenameOrPath) ? basename(filenameOrPath) : filenameOrPath;
  const primary = isAbsolute(filenameOrPath) ? filenameOrPath : join(DATA_DIR, filename);
  try {
    const raw = await readFile(primary, 'utf8');
    return JSON.parse(raw);
  } catch {
    try {
      const tmpTarget = join('/tmp', 'data', filename);
      const raw = await readFile(tmpTarget, 'utf8');
      return JSON.parse(raw);
    } catch {}
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
 * Safely write a JSON file to DATA_DIR or absolute path, ensuring the directory exists.
 * If the target directory is read-only (EROFS), seamlessly falls back to /tmp/data.
 */
export async function writeJson(filenameOrPath, data, options = {}) {
  const filename = isAbsolute(filenameOrPath) ? basename(filenameOrPath) : filenameOrPath;
  const target = isAbsolute(filenameOrPath) ? filenameOrPath : join(DATA_DIR, filename);
  try {
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, JSON.stringify(data, null, 2), { mode: 0o600, ...options });
  } catch (err) {
    if (err.code === 'EROFS' || err.message?.includes('read-only')) {
      const fallbackDir = join('/tmp', 'data');
      await mkdir(fallbackDir, { recursive: true });
      const fallbackTarget = join(fallbackDir, filename);
      await writeFile(fallbackTarget, JSON.stringify(data, null, 2), { mode: 0o600, ...options });
    } else {
      throw err;
    }
  }
}

