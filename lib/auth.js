/* Authentication.
   Off by default so nothing changes until you turn it on. Once enabled it is
   real: scrypt password hashing, server-side sessions, timing-safe comparison,
   lockout, and no user enumeration.

   The honest boundary, stated in the UI as well as here: a session cookie over
   plain HTTP can be read by anyone on the network path. On localhost that path
   is your own machine, which is fine. The moment this is served to other
   people it needs TLS, and the tool warns when it detects that situation
   rather than letting you assume you are covered. */

import { randomBytes, scrypt as _scrypt, timingSafeEqual, createHmac } from 'node:crypto';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const scrypt = promisify(_scrypt);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = process.env.DATA_DIR || (process.env.VERCEL ? join('/tmp', 'data') : join(ROOT, 'data'));
const FILE = join(DATA, 'auth.json');
const ROOT_FILE = join(ROOT, 'data', 'auth.json');

/* scrypt parameters. N=2^15 with r=8 costs roughly 100ms per hash here, which
   is slow enough to make offline cracking expensive and fast enough that login
   does not feel broken. */
const N = 32768, r = 8, p = 1, KEYLEN = 64, SALTLEN = 16;
/* scrypt needs 128·N·r bytes; Node's maxmem must exceed that, not equal it.
   Setting it to the exact requirement fails with "memory limit exceeded". */
const MAXMEM = 128 * N * r * 2;
const SESSION_DAYS = 14;
const MAX_ATTEMPTS = 8;
const LOCK_MINUTES = 15;

const read = async () => {
  try { return JSON.parse(await readFile(FILE, 'utf8')); }
  catch {
    if (FILE !== ROOT_FILE) {
      try { return JSON.parse(await readFile(ROOT_FILE, 'utf8')); } catch {}
    }
    return { enabled: false, users: [], sessions: [], attempts: {}, secret: null };
  }
};
const write = async (v) => {
  await mkdir(DATA, { recursive: true });
  await writeFile(FILE, JSON.stringify(v, null, 2), { mode: 0o600 });
};

/* ── hashing ──────────────────────────────────────────────────────────────── */

export async function hashPassword(password) {
  const salt = randomBytes(SALTLEN);
  const key = await scrypt(password, salt, KEYLEN, { N, r, p, maxmem: MAXMEM });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  if (!stored || !stored.startsWith('scrypt$')) return false;
  const [, n, rr, pp, salt, key] = stored.split('$');
  const expected = Buffer.from(key, 'base64');
  const actual = await scrypt(password, Buffer.from(salt, 'base64'), expected.length,
    { N: Number(n), r: Number(rr), p: Number(pp), maxmem: 128 * Number(n) * Number(rr) * 2 });
  // Constant-time: a length-dependent early return leaks information.
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

/* A dummy hash of the right shape, so a login attempt for a user that does not
   exist takes the same time as one for a user that does. Without this, response
   timing tells an attacker which usernames are real. */
let DUMMY = null;
async function burnTime(password) {
  if (!DUMMY) DUMMY = await hashPassword(randomBytes(24).toString('hex'));
  await verifyPassword(password, DUMMY);
}

/* ── policy ───────────────────────────────────────────────────────────────── */

/** Length beats character classes. Composition rules push people toward
    P@ssw0rd1, which is worse than a long ordinary phrase. */
export function checkPasswordStrength(pw) {
  const s = String(pw || '');
  if (s.length < 12) return { ok: false, reason: 'Use at least 12 characters. Length matters far more than punctuation — a memorable phrase of four words beats a short scrambled password.' };
  if (/^(password|letmein|qwerty|admin|welcome|seoworkbench)/i.test(s)) return { ok: false, reason: 'That starts with one of the most-guessed passwords in existence.' };
  if (/^(.)\1+$/.test(s)) return { ok: false, reason: 'That is a single repeated character.' };
  return { ok: true };
}

/* ── users ────────────────────────────────────────────────────────────────── */

const publicUser = (u) => ({ id: u.id, username: u.username, name: u.name, role: u.role, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt || null });

export async function status() {
  const d = await read();
  return {
    enabled: d.enabled,
    userCount: d.users.length,
    needsSetup: d.enabled && !d.users.length,
    users: d.users.map(publicUser),
  };
}

/** The first user becomes owner. After that, only an owner can add people. */
export async function createUser({ username, password, name, role = 'member' }, { byRole = null } = {}) {
  const d = await read();
  if (d.users.length && byRole !== 'owner') {
    throw new Error('Only an owner can add users.');
  }
  const uname = String(username || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,32}$/.test(uname)) throw new Error('Username must be 3–32 characters, letters, numbers, dot, dash or underscore.');
  if (d.users.some((u) => u.username === uname)) throw new Error('That username is taken.');
  const strength = checkPasswordStrength(password);
  if (!strength.ok) throw new Error(strength.reason);

  const user = {
    id: `u${randomBytes(6).toString('hex')}`,
    username: uname,
    name: String(name || uname).trim(),
    role: d.users.length ? (role === 'owner' ? 'owner' : 'member') : 'owner',
    hash: await hashPassword(password),
    createdAt: new Date().toISOString(),
  };
  d.users.push(user);
  if (!d.secret) d.secret = randomBytes(32).toString('base64');
  await write(d);
  return publicUser(user);
}

export async function setEnabled(enabled) {
  const d = await read();
  if (enabled && !d.users.length) {
    throw new Error('Create the first account before turning login on, or you will lock yourself out.');
  }
  d.enabled = !!enabled;
  if (!d.secret) d.secret = randomBytes(32).toString('base64');
  await write(d);
  return { enabled: d.enabled };
}

export async function changePassword(userId, { current, next }) {
  const d = await read();
  const u = d.users.find((x) => x.id === userId);
  if (!u) throw new Error('No such user.');
  if (!(await verifyPassword(current, u.hash))) throw new Error('Current password is wrong.');
  const strength = checkPasswordStrength(next);
  if (!strength.ok) throw new Error(strength.reason);
  u.hash = await hashPassword(next);
  // Changing a password invalidates other sessions — that is the point of it.
  d.sessions = d.sessions.filter((s) => s.userId !== userId);
  await write(d);
  return { ok: true, note: 'Password changed, and every existing session for this account was signed out.' };
}

export async function deleteUser(userId, { byRole, byId }) {
  const d = await read();
  if (byRole !== 'owner') throw new Error('Only an owner can remove users.');
  if (userId === byId) throw new Error('You cannot remove your own account while signed in as it.');
  const target = d.users.find((u) => u.id === userId);
  if (!target) throw new Error('No such user.');
  if (target.role === 'owner' && d.users.filter((u) => u.role === 'owner').length === 1) {
    throw new Error('That is the only owner. Promote someone else first, or you will have no way back in.');
  }
  d.users = d.users.filter((u) => u.id !== userId);
  d.sessions = d.sessions.filter((s) => s.userId !== userId);
  await write(d);
  return { ok: true };
}

/* ── lockout ──────────────────────────────────────────────────────────────── */

/* Keyed on username and IP together: locking by username alone lets anyone
   lock a colleague out, and by IP alone lets a botnet walk around it. */
const key = (username, ip) => `${username}|${ip}`;

function lockState(d, k) {
  const a = d.attempts[k];
  if (!a) return { locked: false, remaining: MAX_ATTEMPTS };
  if (a.lockedUntil && Date.now() < a.lockedUntil) {
    return { locked: true, minutes: Math.ceil((a.lockedUntil - Date.now()) / 60000) };
  }
  return { locked: false, remaining: Math.max(0, MAX_ATTEMPTS - (a.count || 0)) };
}

/* ── sessions ─────────────────────────────────────────────────────────────── */

/* The token is random and stored server-side; the cookie carries token plus an
   HMAC so a forged cookie is rejected before any lookup happens. */
const sign = (secret, token) => createHmac('sha256', secret).update(token).digest('base64url');

export async function login({ username, password, ip = 'local', userAgent = '' }) {
  const d = await read();
  const uname = String(username || '').trim().toLowerCase();
  const k = key(uname, ip);

  const lock = lockState(d, k);
  if (lock.locked) {
    throw new Error(`Too many failed attempts. Try again in ${lock.minutes} minute${lock.minutes === 1 ? '' : 's'}.`);
  }

  const user = d.users.find((u) => u.username === uname);
  const good = user ? await verifyPassword(password, user.hash) : (await burnTime(password), false);

  if (!good) {
    const a = (d.attempts[k] ||= { count: 0 });
    a.count++;
    a.lastAt = Date.now();
    if (a.count >= MAX_ATTEMPTS) { a.lockedUntil = Date.now() + LOCK_MINUTES * 60000; a.count = 0; }
    await write(d);
    // One message for both cases: a different error for "no such user" would
    // hand over a list of valid usernames.
    throw new Error('Username or password is wrong.');
  }

  delete d.attempts[k];
  const token = randomBytes(32).toString('base64url');
  const session = {
    token, userId: user.id,
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_DAYS * 86400000,
    userAgent: String(userAgent).slice(0, 160),
    ip,
  };
  d.sessions = d.sessions.filter((s) => s.expiresAt > Date.now());
  d.sessions.push(session);
  user.lastLoginAt = new Date().toISOString();
  await write(d);

  return { cookie: `${token}.${sign(d.secret, token)}`, user: publicUser(user), expiresAt: session.expiresAt };
}

export async function resolve(cookieValue) {
  if (!cookieValue) return null;
  const d = await read();
  if (!d.secret) return null;
  const [token, mac] = String(cookieValue).split('.');
  if (!token || !mac) return null;

  const expected = sign(d.secret, token);
  const a = Buffer.from(mac), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  const s = d.sessions.find((x) => x.token === token);
  if (!s || s.expiresAt < Date.now()) return null;
  const u = d.users.find((x) => x.id === s.userId);
  return u ? publicUser(u) : null;
}

export async function logout(cookieValue) {
  const d = await read();
  const token = String(cookieValue || '').split('.')[0];
  const before = d.sessions.length;
  d.sessions = d.sessions.filter((s) => s.token !== token);
  await write(d);
  return { endedSessions: before - d.sessions.length };
}

export async function sessionsFor(userId) {
  const d = await read();
  return d.sessions.filter((s) => s.userId === userId && s.expiresAt > Date.now())
    .map((s) => ({ createdAt: new Date(s.createdAt).toISOString(), expiresAt: new Date(s.expiresAt).toISOString(), userAgent: s.userAgent, ip: s.ip }));
}

/** Signs out everywhere. Useful after a laptop goes missing. */
export async function revokeAll(userId) {
  const d = await read();
  const before = d.sessions.length;
  d.sessions = d.sessions.filter((s) => s.userId !== userId);
  await write(d);
  return { endedSessions: before - d.sessions.length };
}

/* ── transport warning ────────────────────────────────────────────────────── */

/**
 * The distinction that actually matters. A session cookie over plain HTTP is
 * readable by anyone on the network path; on loopback that path is your own
 * machine. This is what turns "login" from theatre into protection, so it is
 * surfaced rather than buried.
 */
export function transportRisk({ host = '', proto = 'http', bindAddress = '' } = {}) {
  const loopback = /^(localhost|127\.0\.0\.1|\[::1\]|::1)(:\d+)?$/i.test(host);
  if (proto === 'https') {
    return { level: 'ok', message: 'Served over HTTPS. Session cookies are encrypted in transit.' };
  }
  if (loopback) {
    return {
      level: 'ok',
      message: 'Served over HTTP on loopback only. The network path is this machine, so there is nothing to intercept. Login here protects against someone else using this computer, not against network attackers.',
    };
  }
  return {
    level: 'danger',
    message: 'Reachable from other machines over plain HTTP. Session cookies and passwords travel unencrypted and can be read by anyone on the network path. Put this behind HTTPS — a reverse proxy with a certificate — before relying on login for anything real.',
  };
}
