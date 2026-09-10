/* Authentication & Role-Based Access Control (RBAC).
   Enterprise security: scrypt password hashing, timing-safe validation,
   HMAC-signed session cookies, IP+username lockout protection, granular
   permission matrix, and serverless-safe data persistence for Vercel. */

import { randomBytes, scrypt as _scrypt, timingSafeEqual, createHmac } from 'node:crypto';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { ROOT, DATA_DIR, readJson, writeJson } from './paths.js';

const scrypt = promisify(_scrypt);
const FILE_NAME = 'auth.json';

/* scrypt parameters. N=2^15 with r=8 costs ~100ms per hash. */
const N = 32768, r = 8, p = 1, KEYLEN = 64, SALTLEN = 16;
const MAXMEM = 128 * N * r * 2;
const SESSION_DAYS = 14;
const MAX_ATTEMPTS = 8;
const LOCK_MINUTES = 15;

/* ── Roles & Permissions ─────────────────────────────────────────────────── */

export const ROLES = {
  owner: {
    id: 'owner',
    label: 'Owner',
    description: 'Full administrative control over organization, team members, security, API keys, and all SEO tools.',
    permissions: ['*'],
  },
  admin: {
    id: 'admin',
    label: 'Admin',
    description: 'Can manage team members, configure integrations and API keys, execute and delete audits, and generate content.',
    permissions: [
      'team:read',
      'team:manage',
      'settings:read',
      'settings:write',
      'audit:run',
      'audit:read',
      'content:generate',
      'content:read',
      'gsc:manage',
      'properties:manage',
    ],
  },
  editor: {
    id: 'editor',
    label: 'Editor',
    description: 'Can run crawls, generate AI content and social posts, edit SEO tags, create campaigns, and export reports.',
    permissions: [
      'team:read',
      'settings:read',
      'audit:run',
      'audit:read',
      'content:generate',
      'content:read',
    ],
  },
  viewer: {
    id: 'viewer',
    label: 'Viewer',
    description: 'Read-only access to audit scorecards, crawl diagnostics, Google Search Console, keyword maps, and reports.',
    permissions: [
      'team:read',
      'audit:read',
      'content:read',
    ],
  },
};

export const ALL_PERMISSIONS = [
  { id: 'team:read', label: 'View Team', description: 'See team members and their roles' },
  { id: 'team:manage', label: 'Manage Team', description: 'Invite, update roles, and remove team members' },
  { id: 'settings:read', label: 'View Settings', description: 'Inspect API keys status and integrations' },
  { id: 'settings:write', label: 'Modify Settings', description: 'Save API keys, secrets, and system configuration' },
  { id: 'audit:run', label: 'Run Audits', description: 'Trigger site crawls, page checks, and competitor scans' },
  { id: 'audit:read', label: 'View Audits', description: 'Access audit results, crawl data, and speed metrics' },
  { id: 'content:generate', label: 'Generate Content', description: 'Run AI content writing, social artwork, and automated fixes' },
  { id: 'content:read', label: 'View Content', description: 'Read generated briefs, keyword maps, and social copy' },
  { id: 'gsc:manage', label: 'Manage Search Console', description: 'Connect or disconnect Google Search Console OAuth' },
  { id: 'properties:manage', label: 'Manage Properties', description: 'Delete domains, reset audits, or create planned properties' },
];

export function getRolePermissions(role) {
  const r = ROLES[role] || ROLES.viewer;
  if (r.permissions.includes('*')) {
    return ALL_PERMISSIONS.map((p) => p.id);
  }
  return [...r.permissions];
}

export function hasPermission(user, permission) {
  if (!user || !user.role) return false;
  if (user.role === 'owner') return true;
  const perms = getRolePermissions(user.role);
  return perms.includes('*') || perms.includes(permission);
}

const read = async () => {
  const fallback = { enabled: false, users: [], sessions: [], attempts: {}, secret: null };
  const d = await readJson(FILE_NAME, fallback);
  d.users ||= [];
  d.sessions ||= [];
  d.attempts ||= {};
  return d;
};

const write = async (v) => {
  await writeJson(FILE_NAME, v);
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
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

let DUMMY = null;
async function burnTime(password) {
  if (!DUMMY) DUMMY = await hashPassword(randomBytes(24).toString('hex'));
  await verifyPassword(password, DUMMY);
}

/* ── policy ───────────────────────────────────────────────────────────────── */

export function checkPasswordStrength(pw) {
  const s = String(pw || '');
  if (s.length < 12) return { ok: false, reason: 'Use at least 12 characters. Length matters far more than punctuation — a memorable phrase of four words beats a short scrambled password.' };
  if (/^(password|letmein|qwerty|admin|welcome|seoworkbench)/i.test(s)) return { ok: false, reason: 'That starts with one of the most-guessed passwords in existence.' };
  if (/^(.)\1+$/.test(s)) return { ok: false, reason: 'That is a single repeated character.' };
  return { ok: true };
}

/* ── users ────────────────────────────────────────────────────────────────── */

export const publicUser = (u) => {
  const normalizedRole = (ROLES[u.role] ? u.role : (u.role === 'member' ? 'editor' : 'viewer'));
  return {
    id: u.id,
    username: u.username,
    name: u.name,
    email: u.email || null,
    role: normalizedRole,
    roleLabel: ROLES[normalizedRole]?.label || 'Viewer',
    permissions: getRolePermissions(normalizedRole),
    provider: u.provider || 'local',
    photoURL: u.photoURL || null,
    createdAt: u.createdAt,
    lastLoginAt: u.lastLoginAt || null,
  };
};

export async function status() {
  const d = await read();
  return {
    enabled: d.enabled,
    userCount: d.users.length,
    needsSetup: d.enabled && !d.users.length,
    users: d.users.map(publicUser),
    roles: ROLES,
    permissions: ALL_PERMISSIONS,
  };
}

/** The first user becomes owner. After that, owner or admin can add team members. */
export async function createUser({ username, password, name, role = 'editor', email = null }, { byRole = null, byUser = null } = {}) {
  const d = await read();
  const callerRole = byRole || byUser?.role;
  if (d.users.length && callerRole !== 'owner' && callerRole !== 'admin') {
    throw new Error('Only an owner or admin can add users.');
  }

  const uname = String(username || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,32}$/.test(uname)) throw new Error('Username must be 3–32 characters, letters, numbers, dot, dash or underscore.');
  if (d.users.some((u) => u.username === uname)) throw new Error('That username is taken.');
  if (email && d.users.some((u) => u.email && u.email.toLowerCase() === String(email).trim().toLowerCase())) {
    throw new Error('An account with that email already exists.');
  }

  const strength = checkPasswordStrength(password);
  if (!strength.ok) throw new Error(strength.reason);

  let assignedRole = 'editor';
  if (!d.users.length) {
    assignedRole = 'owner';
  } else if (callerRole === 'owner') {
    assignedRole = ROLES[role] ? role : 'editor';
  } else if (callerRole === 'admin') {
    if (role === 'owner' || role === 'admin') {
      throw new Error('Admins can only create Editor or Viewer accounts. Only an Owner can create Admins.');
    }
    assignedRole = (role === 'viewer' ? 'viewer' : 'editor');
  }

  const user = {
    id: `u${randomBytes(6).toString('hex')}`,
    username: uname,
    name: String(name || uname).trim(),
    email: email ? String(email).trim().toLowerCase() : null,
    role: assignedRole,
    hash: await hashPassword(password),
    provider: 'local',
    createdAt: new Date().toISOString(),
  };
  d.users.push(user);
  if (!d.secret) d.secret = process.env.SESSION_SECRET || randomBytes(32).toString('base64');
  await write(d);
  return publicUser(user);
}

export async function updateUserRole(userId, newRole, { byUser }) {
  if (!ROLES[newRole]) throw new Error(`Invalid role: ${newRole}`);
  const d = await read();
  const target = d.users.find((u) => u.id === userId);
  if (!target) throw new Error('User not found.');

  if (target.id === byUser.id && target.role === 'owner' && newRole !== 'owner') {
    throw new Error('You cannot demote yourself from Owner while signed in. Appoint another Owner first.');
  }

  if (byUser.role !== 'owner') {
    if (byUser.role === 'admin') {
      if (target.role === 'owner' || target.role === 'admin' || newRole === 'owner' || newRole === 'admin') {
        throw new Error('Admins can only adjust roles between Editor and Viewer.');
      }
    } else {
      throw new Error('Only owners and admins can update user roles.');
    }
  }

  // Prevent leaving organization without any owner
  if (target.role === 'owner' && newRole !== 'owner') {
    const ownerCount = d.users.filter((u) => u.role === 'owner').length;
    if (ownerCount <= 1) {
      throw new Error('Cannot demote the only owner. Promote another member to owner first.');
    }
  }

  target.role = newRole;
  await write(d);
  return publicUser(target);
}

export async function setEnabled(enabled) {
  const d = await read();
  if (enabled && !d.users.length) {
    throw new Error('Create the first account before turning login on, or you will lock yourself out.');
  }
  d.enabled = !!enabled;
  if (!d.secret) d.secret = process.env.SESSION_SECRET || randomBytes(32).toString('base64');
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
  d.sessions = d.sessions.filter((s) => s.userId !== userId);
  await write(d);
  return { ok: true, note: 'Password changed, and all existing sessions for this account were signed out.' };
}

export async function deleteUser(userId, { byRole, byId }) {
  const d = await read();
  if (byRole !== 'owner' && byRole !== 'admin') throw new Error('Only an owner or admin can remove users.');
  if (userId === byId) throw new Error('You cannot remove your own account while signed in as it.');
  const target = d.users.find((u) => u.id === userId);
  if (!target) throw new Error('No such user.');
  if (target.role === 'owner' && d.users.filter((u) => u.role === 'owner').length === 1) {
    throw new Error('That is the only owner. Promote someone else first, or you will have no way back in.');
  }
  if (byRole === 'admin' && (target.role === 'owner' || target.role === 'admin')) {
    throw new Error('Admins cannot remove Owners or other Admins.');
  }
  d.users = d.users.filter((u) => u.id !== userId);
  d.sessions = d.sessions.filter((s) => s.userId !== userId);
  await write(d);
  return { ok: true };
}

export async function listTeam() {
  const d = await read();
  const sessionCounts = {};
  for (const s of d.sessions) {
    if (s.expiresAt > Date.now()) {
      sessionCounts[s.userId] = (sessionCounts[s.userId] || 0) + 1;
    }
  }
  return {
    users: d.users.map((u) => ({
      ...publicUser(u),
      activeSessions: sessionCounts[u.id] || 0,
    })),
    roles: ROLES,
    permissions: ALL_PERMISSIONS,
  };
}

/* ── lockout ──────────────────────────────────────────────────────────────── */

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

const getSecret = (d) => process.env.SESSION_SECRET || d.secret || 'fallback-secret-key-32-chars-at-least';
const sign = (secret, token) => createHmac('sha256', secret).update(token).digest('base64url');

export async function login({ username, password, ip = 'local', userAgent = '' }) {
  const d = await read();
  const uname = String(username || '').trim().toLowerCase();
  const k = key(uname, ip);

  const lock = lockState(d, k);
  if (lock.locked) {
    throw new Error(`Too many failed attempts. Try again in ${lock.minutes} minute${lock.minutes === 1 ? '' : 's'}.`);
  }

  const user = d.users.find((u) => u.username === uname || (u.email && u.email.toLowerCase() === uname));
  const good = user ? await verifyPassword(password, user.hash) : (await burnTime(password), false);

  if (!good) {
    const a = (d.attempts[k] ||= { count: 0 });
    a.count++;
    a.lastAt = Date.now();
    if (a.count >= MAX_ATTEMPTS) { a.lockedUntil = Date.now() + LOCK_MINUTES * 60000; a.count = 0; }
    await write(d);
    throw new Error('Username or password is wrong.');
  }

  delete d.attempts[k];
  const token = randomBytes(32).toString('base64url');
  const session = {
    token,
    userId: user.id,
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_DAYS * 86400000,
    userAgent: String(userAgent).slice(0, 160),
    ip,
  };
  d.sessions = d.sessions.filter((s) => s.expiresAt > Date.now());
  d.sessions.push(session);
  user.lastLoginAt = new Date().toISOString();
  if (!d.secret) d.secret = process.env.SESSION_SECRET || randomBytes(32).toString('base64');
  await write(d);

  const secret = getSecret(d);
  return { cookie: `${token}.${sign(secret, token)}`, user: publicUser(user), expiresAt: session.expiresAt };
}

/**
 * Synchronize Firebase user authentication into local RBAC database.
 * If this is the very first user, they become Owner; otherwise default to Editor.
 * Generates an authorized session cookie for seamless multi-user production.
 */
export async function syncFirebaseUser({ uid, email, displayName, photoURL, ip = 'remote', userAgent = '' }) {
  if (!uid) throw new Error('Firebase UID is required.');
  const d = await read();

  const normalizedEmail = email ? String(email).trim().toLowerCase() : null;
  let user = d.users.find((u) => u.id === uid || (normalizedEmail && u.email && u.email.toLowerCase() === normalizedEmail));

  if (user) {
    user.id = uid; // Ensure ID is consistent
    if (displayName) user.name = displayName;
    if (photoURL) user.photoURL = photoURL;
    if (normalizedEmail) user.email = normalizedEmail;
    user.provider = 'firebase';
    user.lastLoginAt = new Date().toISOString();
  } else {
    const uname = (normalizedEmail ? normalizedEmail.split('@')[0] : displayName || uid)
      .toLowerCase().replace(/[^a-z0-9._-]/g, '_').slice(0, 32);

    // If first user, make Owner; otherwise Editor
    const assignedRole = d.users.length === 0 ? 'owner' : 'editor';

    user = {
      id: uid,
      username: uname,
      name: displayName || uname,
      email: normalizedEmail,
      photoURL: photoURL || null,
      role: assignedRole,
      provider: 'firebase',
      createdAt: new Date().toISOString(),
      lastLoginAt: new Date().toISOString(),
    };
    d.users.push(user);
    d.enabled = true; // Turn sign-in on if first user
  }

  const token = randomBytes(32).toString('base64url');
  const session = {
    token,
    userId: user.id,
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_DAYS * 86400000,
    userAgent: String(userAgent).slice(0, 160),
    ip,
  };
  d.sessions = d.sessions.filter((s) => s.expiresAt > Date.now());
  d.sessions.push(session);
  if (!d.secret) d.secret = process.env.SESSION_SECRET || randomBytes(32).toString('base64');
  await write(d);

  const secret = getSecret(d);
  return {
    cookie: `${token}.${sign(secret, token)}`,
    user: publicUser(user),
    expiresAt: session.expiresAt,
  };
}

export async function resolve(cookieValue) {
  if (!cookieValue) return null;
  const d = await read();
  const secret = getSecret(d);
  const [token, mac] = String(cookieValue).split('.');
  if (!token || !mac) return null;

  const expected = sign(secret, token);
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

export async function revokeAll(userId) {
  const d = await read();
  const before = d.sessions.length;
  d.sessions = d.sessions.filter((s) => s.userId !== userId);
  await write(d);
  return { endedSessions: before - d.sessions.length };
}

/* ── transport warning ────────────────────────────────────────────────────── */

export function transportRisk({ host = '', proto = 'http', bindAddress = '' } = {}) {
  const loopback = /^(localhost|127\.0\.0\.1|\[::1\]|::1)(:\d+)?$/i.test(host);
  if (proto === 'https' || process.env.VERCEL) {
    return { level: 'ok', message: 'Served over HTTPS (Production TLS). Session cookies are encrypted in transit.' };
  }
  if (loopback) {
    return {
      level: 'ok',
      message: 'Served over HTTP on loopback only. Session cookies are local to this machine.',
    };
  }
  return {
    level: 'danger',
    message: 'Reachable from other machines over plain unencrypted HTTP. Session cookies and credentials would travel in the clear. Put this behind HTTPS before relying on authentication.',
  };
}
