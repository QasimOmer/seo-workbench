import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { crawl } from './lib/crawler.js';
import { fetchChain, parseRobots, isAllowed, userAgent } from './lib/fetcher.js';
import { runAudit, reviewPage, preLaunchCheck } from './lib/audit.js';
import { runPsi, runPsiBatch, runCrux } from './lib/psi.js';
import * as gsc from './lib/gsc.js';
import { expand, questionSet, cluster, buildMap, competitorGap, classifyIntent } from './lib/keywords.js';
import * as gen from './lib/generate.js';
import * as props from './lib/properties.js';
import * as brandLib from './lib/brand.js';
import * as trends from './lib/trends.js';
import * as ai from './lib/ai.js';
import * as social from './lib/social.js';
import * as program from './lib/program.js';
import * as providers from './lib/providers.js';
import { deterministicFix } from './lib/fixes.js';
import * as artwork from './lib/artwork.js';
import { localBrief, localSocial } from './lib/local.js';
import * as security from './lib/security.js';
import { buildInsights } from './lib/insights.js';
import * as render from './lib/render.js';
import * as monitor from './lib/monitor.js';
import * as serp from './lib/serp.js';
import * as gscCsv from './lib/gscimport.js';
import * as settings from './lib/settings.js';
import * as llm from './lib/llm.js';
import * as newsite from './lib/newsite.js';
import * as people from './lib/people.js';
import * as auth from './lib/auth.js';
import * as clarity from './lib/clarity.js';
import * as competitor from './lib/competitor.js';
import * as logs from './lib/logs.js';
import * as aivis from './lib/aivis.js';

/* node-cron is optional: if it is missing the whole app still runs, scheduling
   just reports itself unavailable rather than crashing at import time. */
let cron = null;
try { cron = (await import('node-cron')).default; } catch { /* scheduling off */ }
import { summarize, excerpt } from './lib/summarize.js';

import { ROOT, DATA_DIR } from './lib/paths.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 4321;
const DATA = DATA_DIR;

app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public')));

/* Security headers — Helmet-equivalent protection against clickjacking, sniffing, and MIME confusion. */
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https' || process.env.VERCEL) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

/* Response helpers. Declared before any route or middleware that uses them —
   `const` does not hoist, so a use above the definition is a boot-time crash. */
const ok = (res, data) => res.json({ ok: true, ...data });
const fail = (res, err, code = 400) => res.status(code).json({ ok: false, error: String(err?.message || err) });
/* `next` is passed through so this can wrap middleware as well as handlers. */
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch((e) => fail(res, e, 500));

/* ══════════════════════════════ authentication & RBAC ════════════════════════════════ */

const IS_PROD = Boolean(process.env.VERCEL || process.env.NODE_ENV === 'production' || process.env.FORCE_AUTH === 'true');
const COOKIE = 'sw_session';

/* Whitelisted unauthenticated paths */
const OPEN_PATHS = new Set([
  '/auth/status', '/auth/login', '/auth/setup', '/auth/logout', '/gsc/callback',
  '/auth/firebase-config', '/auth/sync-firebase', '/auth/register', '/auth/quick-owner',
  '/properties',
]);

const readCookie = (req, name) => {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
};

const getAuthToken = (req) => {
  const c = readCookie(req, COOKIE);
  if (c) return c;
  const hdr = req.headers['x-session-token'];
  if (hdr) return String(hdr).trim();
  const authHdr = req.headers.authorization;
  if (authHdr && /^Bearer\s+/i.test(authHdr)) return authHdr.replace(/^Bearer\s+/i, '').trim();
  return null;
};

const cookieAttrs = (req, maxAgeSec) => {
  const secure = req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https' || Boolean(process.env.VERCEL);
  return [
    'Path=/', 'HttpOnly', 'SameSite=Lax',
    secure ? 'Secure' : null,
    `Max-Age=${maxAgeSec}`,
  ].filter(Boolean).join('; ');
};

/* Role-Based Access Control Middleware */
const requirePermission = (perm) => (req, res, next) => {
  if (!req.authEnabled) return next();
  if (!req.user) return res.status(401).json({ ok: false, error: 'Authentication required.' });
  if (auth.hasPermission(req.user, perm)) return next();
  return res.status(403).json({
    ok: false,
    error: `Permission denied: '${perm}' permission is required. Your role (${req.user.roleLabel || req.user.role}) is not authorized.`,
    requiredPermission: perm,
  });
};

const requireRole = (...roles) => (req, res, next) => {
  if (!req.authEnabled) return next();
  if (!req.user) return res.status(401).json({ ok: false, error: 'Authentication required.' });
  if (req.user.role === 'owner' || roles.includes(req.user.role)) return next();
  return res.status(403).json({
    ok: false,
    error: `Permission denied: Role ${roles.join(' or ')} required.`,
  });
};

app.use('/api', wrap(async (req, res, next) => {
  const st = await auth.status();
  const effectiveAuth = IS_PROD || st.enabled;
  req.authEnabled = effectiveAuth;

  if (OPEN_PATHS.has(req.path)) return next();
  if (!effectiveAuth) return next();

  const user = await auth.resolve(getAuthToken(req));
  if (!user) {
    return res.status(401).json({
      ok: false,
      error: 'Not signed in.',
      authRequired: true,
      needsSetup: st.userCount === 0,
    });
  }

  /* Same-origin check on mutating requests. Supports custom domains & vercel.app previews */
  if (req.method !== 'GET') {
    const origin = req.headers.origin;
    if (origin) {
      try {
        const originUrl = new URL(origin);
        const hostUrl = new URL(`${req.protocol}://${req.headers.host}`);
        if (originUrl.host !== hostUrl.host && !originUrl.host.endsWith('.vercel.app')) {
          return res.status(403).json({ ok: false, error: 'Cross-origin request refused.' });
        }
      } catch {}
    }
  }

  req.user = user;
  next();
}));

app.get('/api/auth/status', wrap(async (req, res) => {
  const st = await auth.status();
  const effectiveAuth = IS_PROD || st.enabled;
  const user = effectiveAuth ? await auth.resolve(getAuthToken(req)) : null;
  ok(res, {
    ...st,
    enabled: effectiveAuth,
    isProduction: IS_PROD,
    user,
    userCount: user ? Math.max(st.userCount, 1) : st.userCount,
    needsSetup: user ? false : (effectiveAuth && st.userCount === 0),
    transport: auth.transportRisk({
      host: req.headers.host || '',
      proto: req.headers['x-forwarded-proto'] || req.protocol,
    }),
  });
}));

app.post('/api/auth/quick-owner', wrap(async (req, res) => {
  const email = (req.body?.email || 'mqasimomer@gmail.com').trim().toLowerCase();
  const name = req.body?.name || 'Workspace Owner';
  const s = await auth.syncFirebaseUser({
    uid: 'owner_' + Buffer.from(email).toString('hex').slice(0, 12),
    email,
    displayName: name,
    photoURL: null,
    ip: req.ip,
    userAgent: req.headers['user-agent'] || '',
  });
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(s.cookie)}; ${cookieAttrs(req, 14 * 86400)}`);
  ok(res, { user: s.user, expiresAt: s.expiresAt, token: s.cookie });
}));

/** First account setup. Refuses once one exists. */
app.post('/api/auth/setup', wrap(async (req, res) => {
  const st = await auth.status();
  if (st.userCount > 0) return fail(res, 'An account already exists. Sign in, then add people from Team & Access.', 403);
  const { username, password, name, email } = req.body;
  const user = await auth.createUser({ username, password, name, email, role: 'owner' });
  await auth.setEnabled(true);
  const s = await auth.login({ username, password, ip: req.ip, userAgent: req.headers['user-agent'] || '' });
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(s.cookie)}; ${cookieAttrs(req, 14 * 86400)}`);
  ok(res, { user, enabled: true, token: s.cookie });
}));

app.post('/api/auth/login', wrap(async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return fail(res, 'Username and password are required.');
  try {
    const s = await auth.login({ username, password, ip: req.ip, userAgent: req.headers['user-agent'] || '' });
    res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(s.cookie)}; ${cookieAttrs(req, 14 * 86400)}`);
    ok(res, { user: s.user, expiresAt: s.expiresAt, token: s.cookie });
  } catch (e) {
    res.status(401).json({ ok: false, error: e.message });
  }
}));

app.post('/api/auth/logout', wrap(async (req, res) => {
  await auth.logout(getAuthToken(req));
  res.setHeader('Set-Cookie', `${COOKIE}=; ${cookieAttrs(req, 0)}`);
  ok(res, { signedOut: true });
}));

app.get('/api/auth/firebase-config', wrap(async (req, res) => {
  const apiKey = process.env.FIREBASE_API_KEY || 'AIzaSyD0smxu4BCJbaaOEh45Ji4cQwS9ab9Qrvg';
  const projectId = process.env.FIREBASE_PROJECT_ID || 'seo-workbench-75e02';
  const authDomain = process.env.FIREBASE_AUTH_DOMAIN || 'seo-workbench-75e02.firebaseapp.com';
  const appId = process.env.FIREBASE_APP_ID || '1:279663228984:web:94c55f241b6cb83093cecd';
  const storageBucket = process.env.FIREBASE_STORAGE_BUCKET || 'seo-workbench-75e02.firebasestorage.app';
  const messagingSenderId = process.env.FIREBASE_MESSAGING_SENDER_ID || '279663228984';
  const measurementId = process.env.FIREBASE_MEASUREMENT_ID || 'G-XZGLPJWWWE';
  ok(res, {
    configured: Boolean(apiKey),
    config: { apiKey, authDomain, projectId, appId, storageBucket, messagingSenderId, measurementId },
  });
}));

app.post('/api/auth/register', wrap(async (req, res) => {
  const { username, password, name, email } = req.body;
  const st = await auth.status();
  if (!username || !password) return fail(res, 'Username and password are required.');
  let user;
  if (!st.userCount) {
    user = await auth.createUser({ username, password, name, email, role: 'owner' });
    await auth.setEnabled(true);
  } else {
    // Self-registration for team members defaults to viewer/editor
    user = await auth.createUser({ username, password, name, email, role: 'editor' }, { byRole: 'owner' });
  }
  const s = await auth.login({ username, password, ip: req.ip, userAgent: req.headers['user-agent'] || '' });
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(s.cookie)}; ${cookieAttrs(req, 14 * 86400)}`);
  ok(res, { user: s.user, expiresAt: s.expiresAt, token: s.cookie });
}));

app.post('/api/auth/sync-firebase', wrap(async (req, res) => {
  const { uid, email, displayName, photoURL } = req.body;
  if (!uid) return fail(res, 'Firebase UID is required.');
  const s = await auth.syncFirebaseUser({
    uid,
    email,
    displayName,
    photoURL,
    ip: req.ip,
    userAgent: req.headers['user-agent'] || '',
  });
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(s.cookie)}; ${cookieAttrs(req, 14 * 86400)}`);
  ok(res, { user: s.user, expiresAt: s.expiresAt, token: s.cookie });
}));

/* ── Team & RBAC Management Endpoints ───────────────────────────────────── */

app.get('/api/team', requirePermission('team:read'), wrap(async (req, res) => {
  ok(res, await auth.listTeam());
}));

app.post('/api/team/invite', requirePermission('team:manage'), wrap(async (req, res) => {
  const { username, password, name, role = 'editor', email } = req.body;
  const user = await auth.createUser({ username, password, name, role, email }, { byUser: req.user });
  ok(res, { user });
}));

app.patch('/api/team/:id/role', requirePermission('team:manage'), wrap(async (req, res) => {
  const { role } = req.body;
  if (!role) return fail(res, 'Role is required.');
  const user = await auth.updateUserRole(req.params.id, role, { byUser: req.user });
  ok(res, { user });
}));

app.post('/api/auth/users', requirePermission('team:manage'), wrap(async (req, res) => {
  const user = await auth.createUser(req.body, { byUser: req.user });
  ok(res, { user });
}));

app.delete('/api/auth/users/:id', requirePermission('team:manage'), wrap(async (req, res) => {
  await auth.deleteUser(req.params.id, { byRole: req.user?.role, byId: req.user?.id });
  ok(res, await auth.listTeam());
}));

app.post('/api/auth/password', wrap(async (req, res) => {
  if (!req.user) return fail(res, 'Sign in first.', 401);
  ok(res, await auth.changePassword(req.user.id, req.body));
}));

app.get('/api/auth/sessions', wrap(async (req, res) => {
  if (!req.user) return fail(res, 'Sign in first.', 401);
  ok(res, { sessions: await auth.sessionsFor(req.user.id) });
}));

app.post('/api/auth/revoke-all', wrap(async (req, res) => {
  if (!req.user) return fail(res, 'Sign in first.', 401);
  const r = await auth.revokeAll(req.user.id);
  res.setHeader('Set-Cookie', `${COOKIE}=; ${cookieAttrs(req, 0)}`);
  ok(res, r);
}));

app.post('/api/auth/enable', requireRole('owner'), wrap(async (req, res) => {
  ok(res, await auth.setEnabled(!!req.body.enabled));
}));


// Latest crawl in memory; snapshots on disk so you can diff across a deploy.
const state = { crawl: null, audit: null, progress: null, propertyId: null, clusters: [] };


/* ─────────────────────────────────── crawl ────────────────────────────────── */

app.post('/api/crawl', requirePermission('audit:run'), wrap(async (req, res) => {
  const { url, maxPages = 500, ua = 'googlebot', includeSubdomains = false, respectRobots = true, concurrency = 5, moneyUrls = [], timeLimitMs } = req.body;
  if (!url) return fail(res, 'A start URL is required.');
  state.progress = { done: 0, max: maxPages, url: '', phase: 'crawling' };

  // On Vercel serverless functions, enforce an 8500ms safety budget to prevent 504 Gateway Timeouts
  const budget = timeLimitMs ? Math.min(Number(timeLimitMs), 55000) : (process.env.VERCEL ? 8500 : 55000);

  const result = await crawl(url, { maxPages, ua, includeSubdomains, respectRobots, concurrency, timeLimitMs: budget },
    (p) => { state.progress = { ...p, phase: 'crawling' }; });

  state.crawl = result;
  state.audit = runAudit(result, { moneyUrls });
  state.progress = { ...state.progress, phase: 'done' };

  // Crawling a site is how it enters the portal — no separate "add property" step.
  const prop = await props.upsertProperty(result.origin, {
    lastCrawledAt: result.crawledAt,
    pages: result.pages.length,
    counts: state.audit.counts,
    topFinding: state.audit.topThree[0]?.title || null,
  });
  state.propertyId = prop.id;
  await props.cacheCrawl(prop.id, {
    origin: result.origin, crawledAt: result.crawledAt,
    stats: state.audit.stats, counts: state.audit.counts,
    findings: state.audit.findings, topThree: state.audit.topThree,
    pages: result.pages.map(slimPage),
  });

  ok(res, {
    stats: state.audit.stats,
    counts: state.audit.counts,
    findings: state.audit.findings,
    topThree: state.audit.topThree,
    robots: { status: result.robotsStatus, sitemaps: result.robots.sitemaps, raw: result.robotsRaw.slice(0, 4000) },
    sitemapSources: result.sitemapSources,
    truncated: result.truncated,
    timeExceeded: result.timeExceeded || false,
    timeElapsedMs: result.timeElapsedMs || 0,
    remainingQueue: result.remainingQueue,
    pages: result.pages.map(slimPage),
    external: result.external.slice(0, 100),
    blocked: result.blocked.slice(0, 50),
  });
}));

app.get('/api/progress', (req, res) => ok(res, { progress: state.progress }));

app.get('/api/crawl/current', (req, res) => {
  if (!state.crawl) return fail(res, 'No crawl in memory. Run one from the Crawl tab.', 404);
  ok(res, {
    stats: state.audit.stats, counts: state.audit.counts, findings: state.audit.findings,
    topThree: state.audit.topThree, pages: state.crawl.pages.map(slimPage),
    origin: state.crawl.origin, crawledAt: state.crawl.crawledAt,
    // Truncation changes how every count should be read, so it must survive a reload.
    truncated: state.crawl.truncated, remainingQueue: state.crawl.remainingQueue,
  });
});

app.get('/api/page', (req, res) => {
  const p = state.crawl?.pages.find((x) => x.url === req.query.url);
  if (!p) return fail(res, 'URL not found in the current crawl.', 404);
  ok(res, { page: { ...p, shingles: undefined, bodyText: (p.bodyText || '').slice(0, 4000) } });
});

app.post('/api/page/review', wrap(async (req, res) => {
  const { url, withPsi = false, withInspection = false, siteUrl } = req.body;
  const p = state.crawl?.pages.find((x) => x.url === url);
  if (!p) return fail(res, 'URL not found in the current crawl. Crawl the site first.', 404);
  const extras = {};
  if (withPsi) extras.psi = await runPsi(url, { strategy: 'mobile', key: process.env.GOOGLE_API_KEY });
  if (withInspection && siteUrl && gsc.isConnected()) {
    try { extras.inspection = await gsc.inspect(siteUrl, url); } catch (e) { extras.inspection = { error: e.message }; }
  }
  ok(res, { review: reviewPage(p, state.crawl, extras) });
}));

/* ─────────────────────────── security headers ─────────────────────────────── */

/** A separate discipline from SEO, graded separately so it never muddles the
    priority ladder. Computed entirely from the crawl. */
app.get('/api/security', wrap(async (req, res) => {
  if (!state.crawl) return fail(res, 'Crawl a site first — this reads the response headers the crawl already collected.');
  const site = security.auditSite(state.crawl.pages);
  if (!site) return fail(res, 'No HTML pages with headers in this crawl.');
  ok(res, { ...site, config: security.headerConfig(site), checks: security.SECURITY_CHECKS.map((c) => ({ id: c.id, label: c.label, header: c.header, weight: c.weight })) });
}));

app.post('/api/security/page', wrap(async (req, res) => {
  const page = state.crawl?.pages.find((p) => p.url === req.body.url);
  if (!page) return fail(res, 'That URL is not in the current crawl.');
  ok(res, security.auditHeaders(page));
}));

/* ───────────────────────────── summarizer ─────────────────────────────────── */

/** Extractive, so it cannot invent a claim about someone's business. */
app.post('/api/summarize', wrap(async (req, res) => {
  const { text, url, sentences = 3, maxChars = 0 } = req.body;
  let source = text;
  if (!source && url) {
    const page = state.crawl?.pages.find((p) => p.url === url);
    if (!page) return fail(res, 'That URL is not in the current crawl, and no text was supplied.');
    source = page.bodyText;
  }
  if (!source || String(source).trim().length < 120) {
    return fail(res, 'Need at least a paragraph or two of text to summarise.');
  }
  ok(res, { ...summarize(source, { sentences, maxChars: Number(maxChars) || 0 }), metaDescription: excerpt(source, 155) });
}));

app.get('/api/serp/engines', (req, res) => ok(res, { engines: providers.engineList() }));

/* ─────────────────────────── AI visibility (GEO) ──────────────────────────── */

/* Whether the models name you, cite you, and how the share of voice divides.
   Uses the same provider chain as everything else. */

app.get('/api/aivis', wrap(async (req, res) => {
  const d = await aivis.load(activeId());
  const brand = await brandLib.getBrand(activeId());
  const comps = (await competitor.list(activeId())).map((c) => c.host);
  ok(res, {
    prompts: d.prompts || [],
    runs: (d.runs || []).map((r) => ({ at: r.at, score: r.score, namedRate: r.namedRate, citedRate: r.citedRate, sentiment: r.sentiment, providers: r.providers })),
    latest: (d.runs || [])[d.runs.length - 1] || null,
    byPrompt: aivis.byPrompt(d.runs || []),
    suggested: aivis.suggestPrompts(brand),
    brand: { name: brand.name, competitors: brand.competitors || [], domain: state.crawl?.origin || '' },
    knownCompetitors: comps,
    limits: aivis.LIMITS,
  });
}));

app.post('/api/aivis/prompts', wrap(async (req, res) =>
  ok(res, { prompts: await aivis.savePrompts(activeId(), req.body.prompts || []) })));

app.post('/api/aivis/run', wrap(async (req, res) => {
  const brand = await brandLib.getBrand(activeId());
  const name = req.body.brand || brand.name;
  if (!name) return fail(res, 'No brand name. Fill in Brand context first — that is what is being looked for in the answers.');
  const d = await aivis.load(activeId());
  const prompts = req.body.prompts?.length ? req.body.prompts : d.prompts;
  if (!prompts?.length) return fail(res, 'No prompts saved. These should be questions a customer would type, not keywords.');

  const run = await aivis.runOnce(activeId(), {
    brand: name,
    domain: req.body.domain || state.crawl?.origin || '',
    competitors: req.body.competitors || brand.competitors || [],
    prompts,
    providers: req.body.providers || null,
    onProgress: (p) => { state.progress = { ...p, phase: 'aivis' }; },
  });
  ok(res, { run, limits: aivis.LIMITS });
}));

/* ─────────────────────────────── log analysis ─────────────────────────────── */

/* Your server's own record of what Googlebot actually did. A crawl proves a
   page is reachable; logs prove whether Google bothered. Entirely local. */

app.post('/api/logs/analyse', wrap(async (req, res) => {
  const { text, format, bot = 'googlebot' } = req.body;
  if (!text || String(text).trim().length < 40) {
    return fail(res, 'No log content received. Upload a raw access log — combined, IIS W3C, or JSON lines from a CDN.');
  }
  if (!logs.BOTS[bot]) return fail(res, 'Unknown bot.');
  const parsed = logs.parseLog(text, { format });
  if (!parsed.hits.length) {
    return fail(res, `Nothing parseable. Detected format: ${parsed.format}. ${parsed.total} non-empty lines, all rejected — check this is a raw access log rather than an error log or an exported report.`);
  }
  ok(res, logs.analyse(parsed, { crawl: state.crawl, botId: bot }));
}));

app.get('/api/logs/bots', (req, res) => ok(res, {
  bots: Object.entries(logs.BOTS).map(([id, b]) => ({ id, label: b.label, verifiable: (b.verify || []).length > 0 })),
}));

/* ────────────────────────────── competitors ───────────────────────────────── */

/* The one piece of competitive intelligence that needs no proprietary index:
   their HTML is public, so crawl it. This cannot tell you their traffic or
   their backlinks — it tells you how they built the site, which is the part
   you can copy or beat. */

app.get('/api/competitors', wrap(async (req, res) => {
  const list = await competitor.list(activeId());
  ok(res, {
    competitors: list.map((c) => ({ host: c.host, origin: c.origin, pages: c.pages, crawledAt: c.crawledAt })),
    mine: state.crawl ? competitor.profile(state.crawl) : null,
  });
}));

/** Crawls a competitor and stores only the profile, not their pages — the
    comparison needs aggregates, and keeping someone else's content on disk
    serves no purpose. */
app.post('/api/competitors', requirePermission('audit:run'), wrap(async (req, res) => {
  const { url, maxPages = 150 } = req.body;
  if (!url) return fail(res, 'Give it a competitor URL.');
  let origin;
  try { origin = new URL(url).origin; } catch { return fail(res, 'That is not a valid URL.'); }

  const result = await crawl(origin, {
    maxPages: Math.min(Number(maxPages) || 150, 500),
    ua: 'googlebot', respectRobots: true,
  }, (p) => { state.progress = { ...p, phase: 'competitor' }; });

  const prof = competitor.profile(result);
  const all = await competitor.upsert(activeId(), prof);
  ok(res, { profile: prof, count: all.length });
}));

app.delete('/api/competitors/:host', requirePermission('audit:run'), wrap(async (req, res) => {
  const all = await competitor.remove(activeId(), req.params.host);
  ok(res, { competitors: all.map((c) => c.host) });
}));

app.get('/api/competitors/compare', wrap(async (req, res) => {
  if (!state.crawl) return fail(res, 'Crawl your own site first — there is nothing to compare against otherwise.');
  const list = await competitor.list(activeId());
  if (!list.length) return fail(res, 'No competitors crawled yet. Add one and it will be crawled and profiled.');
  ok(res, competitor.compare(competitor.profile(state.crawl), list));
}));

/* ──────────────────────────── Microsoft Clarity ───────────────────────────── */

/* Behaviour data the SEO side cannot see. A rage-click cluster explains a
   conversion problem that rankings and Core Web Vitals never will. */

app.get('/api/clarity/status', wrap(async (req, res) => ok(res, {
  configured: clarity.configured(),
  budget: await clarity.budget(),
  dimensions: clarity.DIMENSIONS,
  signals: clarity.SIGNALS,
})));

app.post('/api/clarity/insights', wrap(async (req, res) => {
  const { numOfDays = 3, dimensions = [], force = false } = req.body;
  ok(res, await clarity.fetchInsights({ numOfDays, dimensions, force }));
}));

/* ───────────────────────────── people & assignment ────────────────────────── */

/* Not authentication — see lib/people.js for why that would be theatre here.
   This answers "who is doing it", which is the question that actually decides
   whether an audit turns into shipped changes. */

app.get('/api/people', wrap(async (req, res) => ok(res, await people.list())));

app.post('/api/people', wrap(async (req, res) =>
  ok(res, { person: await people.save(req.body.person || {}) })));

app.delete('/api/people/:id', wrap(async (req, res) =>
  ok(res, await people.remove(req.params.id))));

app.post('/api/people/assign', wrap(async (req, res) => {
  const { findingId, personId } = req.body;
  if (!findingId) return fail(res, 'Which finding?');
  ok(res, await people.assign(findingId, personId));
}));

app.get('/api/people/workload', wrap(async (req, res) =>
  ok(res, await people.workload(state.audit?.findings || []))));

/* ─────────────────────────────── text models ──────────────────────────────── */

app.get('/api/models', wrap(async (req, res) => {
  const s = await llm.survey({ force: req.query.force === '1' });
  const usable = s.providers.filter((p) => p.available);
  ok(res, {
    ...s,
    usable: usable.length,
    active: usable[0] || null,
    note: usable.length
      ? `${usable.length} provider${usable.length === 1 ? '' : 's'} reachable. ${usable[0].kind === 'local' ? 'A local model is first, so nothing you audit leaves this machine.' : 'No local model found — page content is sent to a hosted provider. Install Ollama if that matters for client work.'}`
      : 'Nothing reachable. The quickest fix with no signup is Ollama.',
  });
}));

app.post('/api/models/prefer', wrap(async (req, res) => {
  const { provider } = req.body;
  const s = await llm.survey();
  if (provider && !s.providers.some((p) => p.id === provider)) return fail(res, 'Unknown provider.');
  if (provider) process.env.LLM_PROVIDER = provider; else delete process.env.LLM_PROVIDER;
  llm.invalidate();
  ok(res, { preferred: provider || null });
}));

/** Sends one short prompt so you can see which model answers and how it reads. */
app.post('/api/models/test', wrap(async (req, res) => {
  const r = await llm.generate(
    'Reply with one short sentence. No preamble.',
    'In plain words, why does a page with a noindex tag not appear in Google?',
    { maxTokens: 120, provider: req.body.provider },
  );
  ok(res, { provider: r.provider, model: r.model, text: r.text, tried: r.tried });
}));

/* ──────────────────────────────── settings ────────────────────────────────── */

/** Presence and a masked tail only — never the values themselves. */
app.get('/api/settings', wrap(async (req, res) =>
  ok(res, { fields: await settings.status(), envPath: settings.envPath() })));

/* Answers "which key is this server actually using, and what does Google say
   about it right now" — the question you cannot answer by looking at .env. */
app.get('/api/settings/verify/:key', wrap(async (req, res) => {
  ok(res, await settings.verifyLive(req.params.key));
}));

/** Validates against the real API before accepting, then applies live so
    features work without a restart. */
app.post('/api/settings', requirePermission('settings:write'), wrap(async (req, res) => {
  const values = req.body.values || {};
  if (!Object.keys(values).length) return fail(res, 'Nothing to save.');
  ok(res, await settings.save(values));
}));

/* ─────────────────────────── intent match (stage 3) ───────────────────────── */

/** The stage that read "unchecked" until a browser existed. Reads a live SERP
    and compares what Google rewards against what the page is. */
app.post('/api/intent', wrap(async (req, res) => {
  const { query, url, gl = 'us', hl = 'en' } = req.body;
  if (!query) return fail(res, 'Give it the query this page targets. Intent cannot be assessed without knowing what the page is trying to rank for — that is the one input no tool can guess.');

  const info = await render.probe();
  if (!info.available) return fail(res, `Reading a live SERP needs a browser. ${info.reason}`);

  const page = state.crawl?.pages.find((p) => p.url === url) || (url ? { url, title: '' } : null);
  if (!page) return fail(res, 'Pick a crawled page, or pass a URL.');

  const { browser } = await render.openBrowser();
  try {
    const read = await serp.readSerp(browser, query, { gl, hl });
    const verdict = serp.judgeIntent(read, page);
    state.intent = state.intent || {};
    state.intent[`${query}::${page.url}`] = { ...verdict, readAt: read.readAt };
    ok(res, { ...verdict, features: read.features, readAt: read.readAt, browser: info.channel });
  } finally { await browser.close(); }
}));

/** Batched, paced deliberately. Google rate-limits this fast. */
app.post('/api/intent/batch', wrap(async (req, res) => {
  const pairs = (req.body.pairs || []).slice(0, 6);
  if (!pairs.length) return fail(res, 'Give it up to six query/URL pairs.');
  const info = await render.probe();
  if (!info.available) return fail(res, info.reason);

  const { browser } = await render.openBrowser();
  const out = [];
  try {
    for (const [i, p] of pairs.entries()) {
      try {
        const page = state.crawl?.pages.find((x) => x.url === p.url) || { url: p.url, title: '' };
        const read = await serp.readSerp(browser, p.query, { gl: req.body.gl || 'us', hl: req.body.hl || 'en' });
        out.push({ ok: true, url: p.url, ...serp.judgeIntent(read, page), features: read.features });
      } catch (e) {
        out.push({ ok: false, url: p.url, query: p.query, error: e.message });
      }
      if (i < pairs.length - 1) await new Promise((r) => setTimeout(r, 4000 + Math.random() * 3000));
    }
  } finally { await browser.close(); }

  ok(res, {
    results: out,
    note: 'Paced several seconds apart on purpose. Google rate-limits automated reads quickly, so keep this to the handful of queries that actually matter rather than running it across a keyword list.',
  });
}));

/* ──────────────── Search Console by CSV, no OAuth required ───────────────── */

app.post('/api/gsc/import', wrap(async (req, res) => {
  const files = req.body.files || [];
  if (!files.length) return fail(res, 'No files received.');
  const bundle = gscCsv.importBundle(files);
  state.gscCsv = bundle;

  const q = bundle.dimensions.query;
  const p = bundle.dimensions.page;
  ok(res, {
    dimensions: Object.fromEntries(Object.entries(bundle.dimensions).map(([k, v]) => [k, { rows: v.rows.length, totals: v.totals }])),
    errors: bundle.errors,
    striking: q ? gscCsv.strikingDistance(q) : [],
    ctrGaps: q ? gscCsv.ctrGaps(q) : [],
    dates: bundle.dimensions.date?.rows || [],
    topPages: p ? p.rows.slice(0, 25) : [],
    note: 'Imported from your own Search Console export — this is Google\'s data, identical to what the API would return for the same window. Re-export whenever you want it refreshed.',
  });
}));

app.get('/api/gsc/imported', wrap(async (req, res) => {
  if (!state.gscCsv) return fail(res, 'Nothing imported yet.');
  const q = state.gscCsv.dimensions.query;
  ok(res, {
    dimensions: Object.fromEntries(Object.entries(state.gscCsv.dimensions).map(([k, v]) => [k, { rows: v.rows.length, totals: v.totals }])),
    striking: q ? gscCsv.strikingDistance(q) : [],
    ctrGaps: q ? gscCsv.ctrGaps(q) : [],
  });
}));

/* ──────────────────────── rendered crawling & vitals ──────────────────────── */

app.get('/api/render/probe', wrap(async (req, res) => {
  ok(res, await render.probe({ force: req.query.force === '1' }));
}));

/** Cheap pre-flight: does this site actually need rendering? Run before
    committing to a rendered crawl, which is several times slower. */
app.post('/api/render/gap', wrap(async (req, res) => {
  const url = req.body.url || state.crawl?.origin;
  if (!url) return fail(res, 'Give it a URL, or crawl a site first.');
  const info = await render.probe();
  if (!info.available) return fail(res, info.reason);

  const raw = await fetchChain(url, { ua: 'googlebot' });
  if (!raw.ok) return fail(res, `Could not fetch ${url} without a browser: ${raw.error || raw.status}`);

  const { browser } = await render.openBrowser();
  try {
    const r = await render.renderPage(browser, url, { ua: userAgent('googlebot') });
    if (!r.ok) return fail(res, r.error);
    ok(res, { url, ...render.renderGap(raw.body, r.body), vitals: r.vitals, browser: info.channel });
  } finally { await browser.close(); }
}));

/** Lab vitals with no API key and no daily quota — measured in your own Chrome. */
app.post('/api/render/vitals', wrap(async (req, res) => {
  const urls = (req.body.urls || [req.body.url]).filter(Boolean).slice(0, 20);
  if (!urls.length) return fail(res, 'No URLs given.');
  const info = await render.probe();
  if (!info.available) return fail(res, info.reason);

  const { browser } = await render.openBrowser();
  const out = [];
  try {
    for (const u of urls) {
      const r = await render.renderPage(browser, u, { ua: userAgent('googlebot') });
      out.push(r.ok
        ? { url: u, ok: true, status: r.status, responseMs: r.responseMs, ...r.vitals }
        : { url: u, ok: false, error: r.error });
      if (state.propertyId && r.ok && r.vitals) {
        await trends.logPsi(state.propertyId, { url: u, strategy: 'chrome-local', performance: null, lcp: r.vitals.lcp, cls: r.vitals.cls, tbt: null }).catch(() => {});
      }
    }
  } finally { await browser.close(); }

  ok(res, {
    results: out, browser: info.channel,
    note: 'Lab measurements from one load in your own Chrome on your own connection. No key, no quota — and no substitute for CrUX field data, which is what Google actually uses. Treat these as a debugging trail.',
  });
}));

/* ────────────────────────── scheduled monitoring ──────────────────────────── */

/** Re-crawls on a schedule and reports only regressions. A monitor that reports
    known state gets muted, and a muted monitor is worse than none. */
async function runMonitor(m) {
  const prevLog = await monitor.runLog(m.id);
  const prev = prevLog.length ? prevLog[prevLog.length - 1].audit : null;

  const result = await crawl(m.url, { maxPages: m.maxPages, ua: 'googlebot' }, () => {});
  const audit = runAudit(result, {});
  const snapshot = { stats: audit.stats, counts: audit.counts, findings: audit.findings.map((f) => ({ id: f.id, title: f.title, severity: f.severity, urls: (f.urls || []).slice(0, 20) })) };
  const diff = prev ? monitor.diffRuns(prev, snapshot, m.alertOn) : null;

  await monitor.appendRun(m.id, { audit: snapshot, diff, pages: result.pages.length, truncated: result.truncated });
  await monitor.saveMonitor({ ...m, lastRunAt: new Date().toISOString(), lastStatus: diff ? (diff.quiet ? 'quiet' : 'changed') : 'baseline' });
  return { diff, snapshot };
}

app.get('/api/monitors', wrap(async (req, res) => ok(res, {
  monitors: await monitor.listMonitors(),
  scheduling: !!cron,
  active: monitor.activeCount(),
  presets: monitor.CRON_PRESETS,
  reason: cron ? null : 'node-cron is not installed, so schedules will not fire. Run: npm install node-cron. You can still run a monitor by hand.',
})));

app.post('/api/monitors', requirePermission('audit:run'), wrap(async (req, res) => {
  if (!req.body.monitor?.url) return fail(res, 'A monitor needs a URL.');
  const m = await monitor.saveMonitor(req.body.monitor);
  if (cron) await monitor.startAll(runMonitor, { cron });
  ok(res, { monitor: m, active: monitor.activeCount() });
}));

app.delete('/api/monitors/:id', requirePermission('audit:run'), wrap(async (req, res) => {
  const list = await monitor.deleteMonitor(req.params.id);
  if (cron) await monitor.startAll(runMonitor, { cron });
  ok(res, { monitors: list });
}));

/** Run one now, so you can see what it would report without waiting a week. */
app.post('/api/monitors/:id/run', requirePermission('audit:run'), wrap(async (req, res) => {
  const m = (await monitor.listMonitors()).find((x) => x.id === req.params.id);
  if (!m) return fail(res, 'No such monitor.');
  const { diff, snapshot } = await runMonitor(m);
  ok(res, { diff, stats: snapshot.stats, baseline: !diff });
}));

app.get('/api/monitors/:id/log', wrap(async (req, res) => {
  const log = await monitor.runLog(req.params.id);
  ok(res, {
    runs: log.map((r) => ({ at: r.at, pages: r.pages, counts: r.audit?.counts, summary: r.diff?.summary, quiet: r.diff?.quiet })),
    latest: log[log.length - 1] || null,
  });
}));

/* ──────────────────────────── diagnostics & rank ──────────────────────────── */

/** Runs from wherever the tool is installed, because that is the only place the
    answer is true. Anonymous tiers throttle by IP and networks block hosts. */
app.get('/api/diagnostics', wrap(async (req, res) => ok(res, await providers.runDiagnostics({ deep: req.query.deep === '1' }))));

app.post('/api/position', wrap(async (req, res) => {
  const { query, domain } = req.body;
  if (!query) return fail(res, 'Give it a query to check.');
  const target = domain || state.crawl?.origin;
  if (!target) return fail(res, 'No domain. Crawl a site first, or pass one in.');
  ok(res, await providers.checkPositionOn(query, target, req.body.engine || 'duckduckgo'));
}));

app.post('/api/position/batch', wrap(async (req, res) => {
  const { queries = [], domain, engine = 'duckduckgo' } = req.body;
  const target = domain || state.crawl?.origin;
  if (!target) return fail(res, 'No domain to check against.');
  const out = [];
  for (const q of queries.slice(0, 12)) {
    try { out.push(await providers.checkPositionOn(q, target, engine)); }
    catch (e) { out.push({ query: q, domain: target, error: e.message }); }
    await new Promise((r) => setTimeout(r, 1200)); // be a polite scraper
  }
  ok(res, { results: out, engine: out.find((r) => r.engine)?.engine || engine, caveat: out.find((r) => r.caveat)?.caveat || 'Directional visibility only.' });
}));

/* ─────────────────────── planning a site that does not exist ───────────────── */

/* Nothing to crawl, so the finding-based half of the tool does not apply. What
   replaces it is the set of decisions that are cheap now and expensive later. */

const planFile = () => `plan-${activeId()}`;

app.get('/api/newsite/phases', (req, res) => ok(res, { phases: newsite.PHASES }));

app.post('/api/newsite/expectations', wrap(async (req, res) =>
  ok(res, newsite.expectations(req.body || {}))));

app.post('/api/newsite/architecture', wrap(async (req, res) => {
  const clusters = req.body.clusters || state.clusters || [];
  if (!clusters.length) {
    return fail(res, 'Architecture is built from clusters, and there are none yet. Run the demand research first — without it this would just be guessing at a sitemap.');
  }
  ok(res, newsite.architecture(clusters, { origin: req.body.origin || 'https://example.com', blogBase: req.body.blogBase || 'guides' }));
}));

app.post('/api/newsite/technical', wrap(async (req, res) =>
  ok(res, newsite.technicalSpec(req.body || {}))));

app.post('/api/newsite/order', wrap(async (req, res) => {
  const clusters = req.body.clusters || state.clusters || [];
  if (!clusters.length) return fail(res, 'No clusters yet — the production order comes from them.');
  ok(res, newsite.productionOrder(clusters, { pagesPerWeek: Number(req.body.pagesPerWeek) || 2 }));
}));

/** Clusters are entered by hand in planning mode, since there is no GSC data
    and autocomplete alone is too weak to plan a whole site from. */
app.post('/api/newsite/clusters', wrap(async (req, res) => {
  state.clusters = (req.body.clusters || []).filter((c) => c.label);
  ok(res, { clusters: state.clusters, count: state.clusters.length });
}));

app.get('/api/newsite/clusters', (req, res) => ok(res, { clusters: state.clusters || [] }));

app.post('/api/properties/planned', wrap(async (req, res) => {
  const { label, origin } = req.body;
  if (!label && !origin) return fail(res, 'Give the project a name, or a domain if one is chosen.');
  ok(res, { property: await props.addPlanned({ label, origin }) });
}));

app.post('/api/properties/stage', wrap(async (req, res) => {
  const { id, stage } = req.body;
  if (!['planning', 'live'].includes(stage)) return fail(res, 'Stage must be planning or live.');
  ok(res, { property: await props.setStage(id || state.propertyId, stage) });
}));

/* ────────────────────────────── properties ────────────────────────────────── */

app.get('/api/properties', wrap(async (req, res) => {
  const idx = await props.listProperties();
  ok(res, { ...idx, loadedId: state.propertyId });
}));

/** Switching property restores its cached crawl, so you can read a site's
    findings without re-crawling it just to look. */
app.post('/api/properties/activate', wrap(async (req, res) => {
  const rec = await props.setActive(req.body.id);
  if (!rec) return fail(res, 'That property is not in the registry.', 404);
  const cached = await props.loadCrawl(rec.id);
  if (cached) {
    state.crawl = { origin: cached.origin, crawledAt: cached.crawledAt, pages: cached.pages, external: [], blocked: [], robots: { sitemaps: [] }, robotsRaw: '', sitemapSources: [] };
    state.audit = { stats: cached.stats, counts: cached.counts, findings: cached.findings, topThree: cached.topThree };
    state.propertyId = rec.id;
  }
  ok(res, { property: rec, restored: !!cached, ...(cached || {}) });
}));

app.delete('/api/properties/:id', requirePermission('properties:manage'), wrap(async (req, res) => {
  const idx = await props.removeProperty(req.params.id);
  if (state.propertyId === req.params.id) { state.crawl = null; state.audit = null; state.propertyId = null; }
  ok(res, idx);
}));


/* ──────────────────────────── brand & project context ─────────────────────── */

const activeId = () => state.propertyId || 'unassigned';

app.get('/api/brand', wrap(async (req, res) => {
  const b = await brandLib.getBrand(activeId());
  ok(res, { brand: b, completeness: brandLib.brandCompleteness(b), aiReady: ai.aiConfigured() });
}));

app.post('/api/brand', requirePermission('content:generate'), wrap(async (req, res) => {
  const b = await brandLib.saveBrand(activeId(), req.body.brand || {});
  ok(res, { brand: b, completeness: brandLib.brandCompleteness(b) });
}));

/** Proposes the brand record from the crawl so you edit rather than type. */
app.post('/api/brand/infer', requirePermission('content:generate'), wrap(async (req, res) => {
  if (!state.crawl) return fail(res, 'Crawl the site first — this reads the pages to work out what the business does.');
  const draft = await ai.inferBrand(state.crawl.pages, state.crawl.origin);
  ok(res, { draft, note: 'Nothing is saved yet. Check the fields marked uncertain, then save.' });
}));

/* ──────────────────────────────── trends ──────────────────────────────────── */

app.post('/api/trends/crux', wrap(async (req, res) => {
  const target = req.body.target || state.crawl?.origin;
  if (!target) return fail(res, 'No target. Crawl a site or pass one in.');
  ok(res, await trends.cruxHistory(target, { formFactor: req.body.formFactor || 'PHONE', key: process.env.GOOGLE_API_KEY }));
}));

app.get('/api/trends/psi', wrap(async (req, res) => {
  ok(res, { series: await trends.psiSeries(activeId()) });
}));

app.post('/api/trends/gsc', wrap(async (req, res) => {
  const { siteUrl, days = 90 } = req.body;
  if (!siteUrl) return fail(res, 'Pick a Search Console property first.');
  const rows = await gsc.queryByDate(siteUrl, { days });
  ok(res, { ...trends.shapeGscSeries(rows), days });
}));

/* ────────────────────────────── AI assistance ─────────────────────────────── */

/** Never returns empty-handed. The deterministic engine works from the crawl
    with no network; AI is attempted only to improve on it, and its failure is
    reported as a note rather than an error. */
app.post('/api/ai/fix', requirePermission('content:generate'), wrap(async (req, res) => {
  const { findingId, preferAi = false } = req.body;
  const finding = state.audit?.findings.find((f) => f.id === findingId || f.title === findingId);
  if (!finding) return fail(res, 'That finding is not in the current audit.');
  const page = finding.urls?.length ? state.crawl?.pages.find((p) => p.url === finding.urls[0]) : null;
  const brand = await brandLib.getBrand(activeId());
  const local = state.crawl ? deterministicFix(finding, state.crawl.pages, state.crawl.origin, state.crawl.robotsRaw) : null;

  if (preferAi) {
    try {
      const fix = await ai.draftFix(finding, page, brand);
      return ok(res, { fix: { ...fix, source: 'ai' }, finding: { title: finding.title, severity: finding.severity } });
    } catch (e) {
      if (local) {
        return ok(res, {
          fix: { ...local, note: `The AI providers are unavailable right now (${e.message.slice(0, 320)}), so this is the deterministic fix built from your crawl instead.` },
          finding: { title: finding.title, severity: finding.severity },
        });
      }
      return fail(res, `${e.message} This finding also needs a judgement call the tool cannot make from crawl data alone, so there is no offline fix for it — the Fix line on the finding tells you what to decide.`);
    }
  }

  if (local) return ok(res, { fix: local, finding: { title: finding.title, severity: finding.severity } });
  return fail(res, 'This finding needs a decision rather than an edit — read the Fix line on the finding. Try "Improve with AI" for a written suggestion.');
}));

app.post('/api/ai/content', requirePermission('content:generate'), wrap(async (req, res) => {
  const { kind = 'post', topic, intent, notes, preferAi = true } = req.body;
  if (!topic) return fail(res, 'Give it a topic.');
  const brand = await brandLib.getBrand(activeId());
  if (preferAi) {
    try {
      return ok(res, { kind, topic, source: 'ai', markdown: await ai.draftContent(kind, topic, brand, { intent, notes }) });
    } catch (e) {
      return ok(res, { kind, topic, source: 'local', markdown: localBrief(kind, topic, brand, { intent, notes }),
        note: `AI providers unavailable (${e.message.slice(0, 320)}). This is the structural brief, generated locally — it gives you the shape and the questions to answer, not finished prose.` });
    }
  }
  ok(res, { kind, topic, source: 'local', markdown: localBrief(kind, topic, brand, { intent, notes }) });
}));

/* ──────────────────────────────── social ──────────────────────────────────── */

/** Charts computed from the crawl, so they populate with no key or quota. */
app.get('/api/insights', wrap(async (req, res) => {
  if (!state.crawl) return fail(res, 'Run a crawl first — every chart here is computed from it.');
  const d = buildInsights(state.crawl, state.audit);
  if (!d) return fail(res, 'No HTML pages returned 200 in this crawl, so there is nothing to chart.');
  ok(res, { ...d, truncated: state.crawl.truncated, remainingQueue: state.crawl.remainingQueue });
}));

app.get('/api/schema/types', (req, res) => ok(res, { types: gen.schemaTypes() }));

app.get('/api/social/meta', (req, res) => ok(res, {
  platforms: Object.entries(ai.PLATFORMS).map(([key, v]) => ({ key, ...v })),
  layouts: social.layoutList(),
  imageMode: (process.env.CF_ACCOUNT_ID && process.env.CF_API_TOKEN) ? 'cloudflare' : 'free',
  aiReady: true,
}));

app.post('/api/social/draft', requirePermission('content:generate'), wrap(async (req, res) => {
  const { topic, platforms = ['instagram_post'], notes } = req.body;
  if (!topic) return fail(res, 'Give it a topic.');
  const brand = await brandLib.getBrand(activeId());
  let out, source = 'ai', note;
  try {
    out = await ai.draftSocial(topic, platforms, brand, { notes });
  } catch (e) {
    out = localSocial(topic, platforms, brand);
    source = 'local';
    note = `AI providers unavailable (${e.message.slice(0, 320)}). These are structured starters built from your brand context — edit the wording, the artwork and sizing are unaffected.`;
  }
  ok(res, { ...out, source, note, brandName: brand.name, primary: brand.primaryColor, cta: brand.cta });
}));

/** Local procedural artwork by default — instant, offline, and repeatable from
    a seed. AI photography is opt-in, and falls back here when it fails. */
app.post('/api/social/background', requirePermission('content:generate'), wrap(async (req, res) => {
  const { prompt, platform, seed = Math.floor(Math.random() * 9999), style = 'mesh', mode = 'local' } = req.body;
  const spec = ai.PLATFORMS[platform] || ai.PLATFORMS.instagram_post;
  const brand = await brandLib.getBrand(activeId());
  const primary = req.body.primary || brand.primaryColor || '#17564A';

  if (mode === 'ai' && prompt) {
    try {
      const img = await providers.generateImage(prompt, spec.w, spec.h, seed);
      return ok(res, { ...img, mode: 'ai' });
    } catch (e) {
      return ok(res, {
        src: artwork.backgroundDataUri(style, spec.w, spec.h, primary, seed),
        provider: 'local', mode: 'local', direct: false,
        note: `Image generation is unavailable (${e.message.slice(0, 320)}), so this is locally generated artwork instead.`,
      });
    }
  }
  ok(res, { src: artwork.backgroundDataUri(style, spec.w, spec.h, primary, seed), provider: 'local', mode: 'local', direct: false });
}));

app.get('/api/social/styles', (req, res) => ok(res, { styles: artwork.STYLES }));

/** Returns SVG. Composed with real fonts because generated lettering is unusable. */
app.post('/api/social/compose', requirePermission('content:generate'), wrap(async (req, res) => {
  const brand = await brandLib.getBrand(activeId());
  const svg = social.composePost({
    brandName: req.body.brandName ?? brand.name,
    primary: req.body.primary || brand.primaryColor,
    secondary: req.body.secondary || '#FFFFFF',
    ...req.body,
  });
  ok(res, { svg, platform: req.body.platform });
}));

/* ─────────────────────── campaigns & the SEO programme ────────────────────── */

app.get('/api/campaigns', wrap(async (req, res) => ok(res, { campaigns: await program.listCampaigns(activeId()) })));
app.post('/api/campaigns', wrap(async (req, res) => ok(res, { campaign: await program.saveCampaign(activeId(), req.body.campaign || {}) })));
app.delete('/api/campaigns/:cid', wrap(async (req, res) => ok(res, { campaigns: await program.deleteCampaign(activeId(), req.params.cid) })));
app.post('/api/campaigns/:cid/baseline', wrap(async (req, res) =>
  ok(res, { campaign: await program.baselineCampaign(activeId(), req.params.cid, req.body.metrics || {}) })));

app.get('/api/program', wrap(async (req, res) => {
  if (!state.audit?.findings?.length) return fail(res, 'Run a crawl first — the plan is built from the findings.');
  const pointsPerWeek = Number(req.query.capacity) || 10;
  const plan = program.buildProgram(state.audit.findings, { pointsPerWeek });
  ok(res, { ...plan, progress: await program.getProgress(activeId()) });
}));

app.post('/api/program/toggle', wrap(async (req, res) =>
  ok(res, { progress: await program.toggleProgress(activeId(), req.body.findingId) })));

/* ────────────────────────────── snapshots / compare ───────────────────────── */

app.post('/api/snapshot', wrap(async (req, res) => {
  if (!state.crawl) return fail(res, 'Nothing to save — run a crawl first.');
  await fs.mkdir(DATA, { recursive: true });
  const name = (req.body.name || `snapshot-${Date.now()}`).replace(/[^a-z0-9-_]/gi, '-');
  const payload = {
    name, savedAt: new Date().toISOString(), origin: state.crawl.origin,
    stats: state.audit.stats, counts: state.audit.counts,
    findings: state.audit.findings,
    pages: state.crawl.pages.map(slimPage),
  };
  await fs.writeFile(path.join(DATA, `${name}.json`), JSON.stringify(payload));
  ok(res, { name, savedAt: payload.savedAt });
}));

app.get('/api/snapshots', wrap(async (req, res) => {
  await fs.mkdir(DATA, { recursive: true });
  const files = (await fs.readdir(DATA)).filter((f) => f.endsWith('.json'));
  const list = await Promise.all(files.map(async (f) => {
    const j = JSON.parse(await fs.readFile(path.join(DATA, f), 'utf8'));
    return { name: j.name, savedAt: j.savedAt, origin: j.origin, pages: j.stats?.crawled, counts: j.counts };
  }));
  ok(res, { snapshots: list.sort((a, b) => b.savedAt.localeCompare(a.savedAt)) });
}));

app.post('/api/compare', wrap(async (req, res) => {
  const { name } = req.body;
  if (!state.crawl) return fail(res, 'Run a crawl first, then compare it against a snapshot.');
  const snap = JSON.parse(await fs.readFile(path.join(DATA, `${name}.json`), 'utf8'));

  const now = new Map(state.crawl.pages.map(slimPage).map((p) => [p.url, p]));
  const then = new Map(snap.pages.map((p) => [p.url, p]));
  const changes = [];

  for (const [url, b] of then) {
    const a = now.get(url);
    if (!a) { changes.push({ url, type: 'removed', detail: `Was HTTP ${b.status}, now absent from the crawl.` }); continue; }
    const d = [];
    if (a.status !== b.status) d.push(`status ${b.status} → ${a.status}`);
    if (a.title !== b.title) d.push(`title changed`);
    if (!!a.noindex !== !!b.noindex) d.push(`noindex ${b.noindex ? 'removed' : 'ADDED'}`);
    if (a.canonical !== b.canonical) d.push(`canonical ${b.canonical || 'none'} → ${a.canonical || 'none'}`);
    if (Math.abs((a.wordCount || 0) - (b.wordCount || 0)) > 100) d.push(`words ${b.wordCount} → ${a.wordCount}`);
    if (a.inboundCount !== b.inboundCount) d.push(`inbound links ${b.inboundCount} → ${a.inboundCount}`);
    if (d.length) changes.push({ url, type: 'changed', detail: d.join('; '), severe: d.some((x) => /ADDED|status/.test(x)) });
  }
  for (const [url, a] of now) if (!then.has(url)) changes.push({ url, type: 'added', detail: `New URL, HTTP ${a.status}.` });

  const findingDelta = {
    resolved: snap.findings.filter((f) => !state.audit.findings.some((g) => g.id === f.id)).map((f) => f.title),
    introduced: state.audit.findings.filter((f) => !snap.findings.some((g) => g.id === f.id)).map((f) => f.title),
  };

  ok(res, {
    against: { name: snap.name, savedAt: snap.savedAt },
    counts: { before: snap.counts, after: state.audit.counts },
    changes: changes.sort((a, b) => (b.severe ? 1 : 0) - (a.severe ? 1 : 0)).slice(0, 400),
    findingDelta,
  });
}));

/* ─────────────────────────────── performance ──────────────────────────────── */

app.post('/api/psi', wrap(async (req, res) => {
  const { url, urls, strategy = 'mobile' } = req.body;
  const key = process.env.GOOGLE_API_KEY || null;
  if (urls?.length) {
    const results = await runPsiBatch(urls.slice(0, 20), { strategy, key },
      (p) => { state.progress = { ...p, phase: 'psi' }; });
    return ok(res, { results });
  }
  const result = await runPsi(url, { strategy, key });
  if (result?.ok && state.propertyId) {
    await trends.logPsi(state.propertyId, {
      url, strategy,
      performance: result.scores?.performance ?? null,
      lcp: result.lab?.lcp ?? null, cls: result.lab?.cls ?? null, tbt: result.lab?.tbt ?? null,
    }).catch(() => {});
  }
  ok(res, { result });
}));

app.post('/api/crux', wrap(async (req, res) => {
  const { target, formFactor = 'PHONE', isOrigin = false } = req.body;
  ok(res, { result: await runCrux(target, { key: process.env.GOOGLE_API_KEY, formFactor, isOrigin }) });
}));

/* ───────────────────────────── search console ─────────────────────────────── */

function getGscRedirectUri(req) {
  if (process.env.GSC_REDIRECT_URI || process.env.GOOGLE_REDIRECT_URI) {
    return process.env.GSC_REDIRECT_URI || process.env.GOOGLE_REDIRECT_URI;
  }
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.get('host') || `localhost:${process.env.PORT || 4321}`;
  return `${proto}://${host}/api/gsc/callback`;
}

app.get('/api/gsc/status', (req, res) => ok(res, {
  configured: gsc.isConfigured(),
  connected: gsc.isConnected(),
  authUrl: gsc.isConnected() ? null : gsc.authUrl(getGscRedirectUri(req)),
}));

app.get('/api/gsc/callback', async (req, res) => {
  if (req.query.error) {
    const safeError = String(req.query.error).replace(/[&<>"']/g, '');
    return res.status(400).send(`<!doctype html><meta charset="utf-8">
      <body style="font:16px/1.5 system-ui,-apple-system,sans-serif;padding:40px;background:#0d1117;color:#c9d1d9;text-align:center">
      <div style="max-width:480px;margin:40px auto;padding:32px;background:#161b22;border:1px solid #30363d;border-radius:8px">
        <h1 style="font-size:20px;color:#f85149;margin-bottom:12px">Authorisation Cancelled</h1>
        <p style="color:#8b949e;margin-bottom:20px">Google returned: <b>${safeError}</b></p>
        <a href="/" style="display:inline-block;padding:8px 16px;background:#238636;color:#fff;text-decoration:none;border-radius:6px;font-weight:600">Return to Workbench</a>
      </div></body>`);
  }
  if (!req.query.code) {
    return res.status(400).send(`<!doctype html><meta charset="utf-8">
      <body style="font:16px/1.5 system-ui,-apple-system,sans-serif;padding:40px;background:#0d1117;color:#c9d1d9;text-align:center">
      <div style="max-width:480px;margin:40px auto;padding:32px;background:#161b22;border:1px solid #30363d;border-radius:8px">
        <h1 style="font-size:20px;color:#f85149;margin-bottom:12px">Missing Code</h1>
        <p style="color:#8b949e;margin-bottom:20px">No authorisation code returned from Google.</p>
        <a href="/" style="display:inline-block;padding:8px 16px;background:#238636;color:#fff;text-decoration:none;border-radius:6px;font-weight:600">Return to Workbench</a>
      </div></body>`);
  }
  const redirectUri = getGscRedirectUri(req);
  try {
    await gsc.exchangeCode(req.query.code, redirectUri);
    return res.send(`<!doctype html><meta charset="utf-8">
      <body style="font:16px/1.5 system-ui,-apple-system,sans-serif;padding:40px;background:#0d1117;color:#c9d1d9;text-align:center">
      <div style="max-width:480px;margin:40px auto;padding:32px;background:#161b22;border:1px solid #30363d;border-radius:8px">
        <h1 style="font-size:20px;color:#3fb950;margin-bottom:12px">Search Console Connected</h1>
        <p style="color:#8b949e;margin-bottom:20px">Your Google Search Console connection is active. Closing window...</p>
        <a href="/" style="display:inline-block;padding:8px 16px;background:#238636;color:#fff;text-decoration:none;border-radius:6px;font-weight:600">Return to Workbench</a>
      </div>
      <script>setTimeout(()=>{ try { window.opener?.location?.reload?.(); window.close(); } catch(e){} }, 1200);</script>
      </body>`);
  } catch (err) {
    console.error('GSC exchange code failed:', err);
    return res.status(500).send(`<!doctype html><meta charset="utf-8">
      <body style="font:16px/1.5 system-ui,-apple-system,sans-serif;padding:40px;background:#0d1117;color:#c9d1d9;text-align:center">
      <div style="max-width:520px;margin:40px auto;padding:32px;background:#161b22;border:1px solid #30363d;border-radius:8px">
        <h1 style="font-size:20px;color:#f85149;margin-bottom:12px">Connection Failed</h1>
        <p style="color:#8b949e;margin-bottom:16px">Failed to exchange authorization token with Google:</p>
        <pre style="background:#0d1117;padding:12px;border-radius:6px;font-size:13px;color:#ff7b72;overflow-x:auto;text-align:left;word-break:break-all">${String(err.message).replace(/[&<>"']/g, '')}</pre>
        <p style="color:#8b949e;font-size:13px;margin:16px 0">Note: Google authorization codes are single-use and expire within minutes. Please try connecting again from the Search Console tab in your workbench.</p>
        <a href="/" style="display:inline-block;padding:8px 16px;background:#238636;color:#fff;text-decoration:none;border-radius:6px;font-weight:600">Return to Workbench</a>
      </div></body>`);
  }
});

app.post('/api/gsc/disconnect', wrap(async (req, res) => { await gsc.disconnect(); ok(res, {}); }));
app.get('/api/gsc/sites', wrap(async (req, res) => ok(res, { sites: await gsc.listSites() })));

app.post('/api/gsc/query', wrap(async (req, res) => {
  const { siteUrl, startDate, endDate, dimensions = ['query'], rowLimit = 1000 } = req.body;
  ok(res, { rows: await gsc.query(siteUrl, { startDate, endDate, dimensions, rowLimit }) });
}));

app.post('/api/gsc/cannibalisation', wrap(async (req, res) =>
  ok(res, { rows: await gsc.findCannibalisation(req.body.siteUrl, req.body) })));

app.post('/api/gsc/striking', wrap(async (req, res) =>
  ok(res, { rows: await gsc.strikingDistance(req.body.siteUrl, req.body) })));

app.post('/api/gsc/ctr-gaps', wrap(async (req, res) =>
  ok(res, { rows: await gsc.ctrGaps(req.body.siteUrl, req.body) })));

app.post('/api/gsc/triage', wrap(async (req, res) =>
  ok(res, { triage: await gsc.trafficTriage(req.body.siteUrl, req.body) })));

app.post('/api/gsc/deltas', wrap(async (req, res) =>
  ok(res, { rows: await gsc.pageDeltas(req.body.siteUrl, req.body) })));

app.post('/api/gsc/inspect', wrap(async (req, res) =>
  ok(res, { result: await gsc.inspect(req.body.siteUrl, req.body.url) })));

app.post('/api/gsc/inspect-batch', wrap(async (req, res) => {
  const { siteUrl, urls = [] } = req.body;
  const out = [];
  for (const u of urls.slice(0, 30)) {
    try { out.push(await gsc.inspect(siteUrl, u)); }
    catch (e) { out.push({ url: u, error: e.message }); }
    await new Promise((r) => setTimeout(r, 250));
  }
  ok(res, { results: out });
}));

app.get('/api/gsc/sitemaps', wrap(async (req, res) =>
  ok(res, { sitemaps: await gsc.listSitemaps(req.query.siteUrl) })));

app.post('/api/gsc/sitemap-submit', wrap(async (req, res) =>
  ok(res, await gsc.submitSitemap(req.body.siteUrl, req.body.feedpath))));

app.post('/api/gsc/clusters', wrap(async (req, res) =>
  ok(res, { clusters: await gsc.clusterByLandingPage(req.body.siteUrl, req.body) })));

/* ──────────────────────────── demand research ─────────────────────────────── */

app.post('/api/keywords/expand', wrap(async (req, res) => {
  const { seed, gl = 'us', hl = 'en', alphabet = true, questions = true, commercial = true } = req.body;
  if (!seed) return fail(res, 'A seed term is required.');
  const keywords = await expand(seed, { gl, hl, alphabet, questions, commercial });
  if (!keywords.length) {
    return fail(res, 'Google Autocomplete returned nothing. That endpoint is unofficial and is blocked on some networks and by some VPNs — try a different connection, or use the Search Console tab, where query clustering comes from your own data.');
  }
  ok(res, {
    seed, keywords, count: keywords.length,
    clusters: cluster(keywords),
    note: 'No search volume is available from any free source. Breadth counts how many independent autocomplete probes surfaced a phrase — a popularity hint, not volume. Score on conversion proximity and differentiability instead.',
  });
}));

app.post('/api/keywords/questions', wrap(async (req, res) =>
  ok(res, { questions: await questionSet(req.body.seed, req.body) })));

app.post('/api/keywords/map', wrap(async (req, res) => {
  const { clusters } = req.body;
  if (!state.crawl) return fail(res, 'Crawl the site first — the map needs pages to map to.');
  ok(res, buildMap(clusters, state.crawl.pages));
}));

app.post('/api/keywords/competitor-gap', wrap(async (req, res) => {
  const { competitorUrl, maxPages = 60 } = req.body;
  if (!state.crawl) return fail(res, 'Crawl your own site first.');
  const theirs = await crawl(competitorUrl, { maxPages, concurrency: 4 },
    (p) => { state.progress = { ...p, phase: 'competitor' }; });
  ok(res, {
    gaps: competitorGap(state.crawl.pages, theirs.pages),
    theirPages: theirs.pages.length,
    note: 'Heading-level topic gaps, not query gaps. It shows what they cover and you do not — validate against real demand before acting.',
  });
}));

/* ──────────────────────────────── generators ──────────────────────────────── */

app.post('/api/generate/titles', wrap(async (req, res) => {
  const { brand = '', separator = '|', targets = {}, useClaude = false, instruction, onlyUrls } = req.body;
  if (!state.crawl) return fail(res, 'Crawl the site first.');
  let pages = state.crawl.pages.filter((p) => p.status === 200 && !p.noindex && p.title !== undefined);
  if (onlyUrls?.length) pages = pages.filter((p) => onlyUrls.includes(p.url));
  if (useClaude) {
    const drafts = await gen.draftWithClaude(pages, instruction, process.env.ANTHROPIC_API_KEY);
    return ok(res, { source: 'claude', drafts });
  }
  ok(res, { source: 'rules', titles: gen.draftTitles(pages, { brand, separator, targets }), metas: gen.draftMetas(pages, { brand }) });
}));

app.get('/api/generate/schema-types', (req, res) => ok(res, { types: gen.schemaTypes() }));

app.post('/api/generate/schema', wrap(async (req, res) =>
  ok(res, gen.buildSchema(req.body.type, req.body.data || {}))));

app.post('/api/generate/links', wrap(async (req, res) => {
  if (!state.crawl) return fail(res, 'Crawl the site first.');
  ok(res, gen.linkOpportunities(state.crawl.pages, req.body));
}));

app.get('/api/generate/link-graph', (req, res) => {
  if (!state.crawl) return fail(res, 'Crawl the site first.', 404);
  ok(res, { rows: gen.linkGraphReport(state.crawl.pages) });
});

app.post('/api/generate/redirects', wrap(async (req, res) => {
  const { oldUrls = [], format = 'csv' } = req.body;
  if (!state.crawl) return fail(res, 'Crawl the destination site first — the map needs somewhere to point.');
  const map = gen.buildRedirectMap(oldUrls, state.crawl.pages, { origin: state.crawl.origin });
  ok(res, { map, output: gen.redirectsToFormat(map, format, { origin: state.crawl.origin }) });
}));

app.post('/api/generate/redirects/test', wrap(async (req, res) =>
  ok(res, { results: await gen.testRedirects(req.body.pairs || [], fetchChain) })));

app.post('/api/generate/robots', wrap(async (req, res) =>
  ok(res, { robots: gen.generateRobots(req.body) })));

app.get('/api/generate/sitemap', (req, res) => {
  if (!state.crawl) return fail(res, 'Crawl the site first.', 404);
  ok(res, gen.generateSitemap(state.crawl.pages));
});

app.post('/api/generate/brief', wrap(async (req, res) => {
  const { clusterLabel, intent, targetUrl, businessGoal, fetchQuestions = true } = req.body;
  const questions = fetchQuestions ? await questionSet(clusterLabel) : [];
  ok(res, { brief: gen.contentBrief({ cluster: clusterLabel, questions, intent: intent || classifyIntent(clusterLabel), targetUrl, businessGoal }) });
}));

/* ──────────────────────────────── pre-launch ──────────────────────────────── */

app.post('/api/prelaunch', wrap(async (req, res) => {
  const { stagingUrl, redirectPairs } = req.body;
  if (!state.crawl) return fail(res, 'Crawl the live site first.');

  let stagingProbe = null;
  if (stagingUrl) {
    const origin = new URL(stagingUrl).origin;
    const r = await fetchChain(`${origin}/robots.txt`, { ua: 'googlebot' });
    const rb = parseRobots(r.body || '');
    const blockedByRobots = !isAllowed(rb, stagingUrl).allowed;
    const page = await fetchChain(stagingUrl, { ua: 'googlebot' });
    const noindex = /noindex/i.test(page.headers['x-robots-tag'] || '') ||
      /<meta[^>]+name=["']robots["'][^>]+noindex/i.test(page.body || '');
    const authWalled = page.status === 401 || page.status === 403;
    stagingProbe = {
      blocked: blockedByRobots || noindex || authWalled,
      detail: [
        authWalled ? `HTTP ${page.status} — behind auth, which is the safest option.` : null,
        blockedByRobots ? 'robots.txt disallows crawling.' : 'robots.txt does not block it.',
        noindex ? 'noindex present.' : 'No noindex.',
        blockedByRobots && noindex ? 'Note: both together means Google never reads the noindex. HTTP auth is the better block.' : null,
      ].filter(Boolean).join(' '),
    };
  }

  let redirectResults = null;
  if (redirectPairs?.length) redirectResults = await gen.testRedirects(redirectPairs, fetchChain);

  ok(res, { check: preLaunchCheck(state.crawl, stagingProbe, redirectResults) });
}));

/* ───────────────────────────────── exports ────────────────────────────────── */

app.get('/api/export/:kind', (req, res) => {
  if (!state.crawl) return fail(res, 'Nothing to export — run a crawl first.', 404);
  const { kind } = req.params;
  const send = (name, body, type = 'text/csv') => {
    res.setHeader('Content-Type', `${type}; charset=utf-8`);
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.send(body);
  };
  const host = new URL(state.crawl.origin).hostname;
  const stamp = new Date().toISOString().slice(0, 10);

  if (kind === 'findings') return send(`${host}-findings-${stamp}.csv`, gen.findingsToCsv(state.audit.findings));
  if (kind === 'crawl') return send(`${host}-crawl-${stamp}.csv`, gen.crawlToCsv(state.crawl.pages));
  if (kind === 'azure') return send(`${host}-azure-devops-${stamp}.csv`, gen.findingsToAzureCsv(state.audit.findings, {
    areaPath: req.query.areaPath || '', iteration: req.query.iteration || '',
  }));
  if (kind === 'links') return send(`${host}-link-graph-${stamp}.csv`,
    ['URL,Title,Depth,Inbound,Inbound body,Outbound,Words',
      ...gen.linkGraphReport(state.crawl.pages).map((r) => [r.url, r.title, r.depth, r.inbound, r.inboundBody, r.outbound, r.words]
        .map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))].join('\n'));
  if (kind === 'json') return send(`${host}-audit-${stamp}.json`,
    JSON.stringify({ crawledAt: state.crawl.crawledAt, origin: state.crawl.origin, stats: state.audit.stats, findings: state.audit.findings, pages: state.crawl.pages.map(slimPage) }, null, 2),
    'application/json');
  fail(res, `Unknown export: ${kind}`, 404);
});

/* ─────────────────────────────────── boot ─────────────────────────────────── */

function slimPage(p) {
  return {
    url: p.url, finalUrl: p.finalUrl, status: p.status, hops: p.hops, depth: p.depth,
    contentType: p.contentType, responseMs: p.responseMs, error: p.error,
    title: p.title, metaDescription: p.metaDescription, h1s: p.h1s, headingSkips: p.headingSkips,
    canonical: p.canonical, selfCanonical: p.selfCanonical, noindex: p.noindex,
    robotsAllowed: p.robotsAllowed, wordCount: p.wordCount, schemaTypes: p.schemaTypes,
    jsonldErrors: p.jsonldErrors, inboundCount: p.inboundCount, inboundBodyCount: p.inboundBodyCount,
    inboundLinks: (p.inboundLinks || []).slice(0, 12), imageCount: (p.images || []).length,
    imagesMissingAlt: (p.images || []).filter((i) => !i.hasAltAttr || !String(i.alt).trim()).length,
    platform: p.platform, discoveredVia: p.discoveredVia, viewport: p.viewport, lang: p.lang,
    outboundCount: (p.links || []).filter((l) => l.resolved).length,
  };
}

if (cron && !process.env.VERCEL) {
  monitor.startAll(runMonitor, { cron })
    .then((r) => { if (r.started) console.log(`  ${r.started} monitor(s) scheduled`); })
    .catch(() => {});
}

let server = null;
if (!process.env.VERCEL) {
  server = app.listen(PORT, () => {
    const keyed = process.env.GOOGLE_API_KEY ? 'with API key' : 'no key — low PSI quota';
    const oauth = gsc.isConfigured() ? 'configured' : 'not configured';
    console.log(`\n  SEO Workbench  →  http://localhost:${PORT}`);
    console.log(`  PageSpeed: ${keyed}   Search Console OAuth: ${oauth}\n`);
  });

  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      const alt = Number(PORT) + 1;
      console.error(`\n  Port ${PORT} is already in use — an earlier copy of SEO Workbench is probably still running.`);
      console.error(`\n  Either reuse it:      http://localhost:${PORT}`);
      console.error(`  or stop it, Windows:  taskkill /F /IM node.exe`);
      console.error(`  or stop it, mac/Linux: kill $(lsof -ti :${PORT})`);
      console.error(`  or use another port:  PORT=${alt} npm start      (PowerShell: $env:PORT=${alt}; npm.cmd start)\n`);
    } else if (e.code === 'EACCES') {
      console.error(`\n  Not allowed to bind port ${PORT}. Ports below 1024 need admin rights — pick something higher, e.g. PORT=4321.\n`);
    } else {
      console.error(`\n  Could not start the server: ${e.message}\n`);
    }
    process.exit(1);
  });

  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      try { monitor.stopAll(); } catch { /* nothing scheduled */ }
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 1500).unref();
    });
  }
}

export default app;
