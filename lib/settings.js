/* Runtime settings, so nobody has to edit a dotfile.
   Keys arrive through the UI, get validated against the real API before being
   accepted, and are written to .env so they survive a restart. Values are never
   sent back to the browser — only whether one is present and its last four
   characters, which is enough to tell "is this the key I think it is" without
   putting the secret back on the wire.

   This is a localhost tool, so the threat model is modest. It is still worth not
   echoing secrets: browser history, screenshots and screen shares all leak. */

import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENV = join(ROOT, '.env');

export const FIELDS = {
  GOOGLE_API_KEY: {
    label: 'Google API key',
    unlocks: 'Six months of Core Web Vitals history, and removes the PageSpeed daily limit you have been hitting.',
    how: 'console.cloud.google.com → APIs & Services → Library → enable "PageSpeed Insights API" and "Chrome UX Report API" → Credentials → Create credentials → API key.',
    optional: true,
  },
  GSC_CLIENT_ID: {
    label: 'Search Console OAuth client ID',
    unlocks: 'Live Search Console refresh and URL Inspection. Not needed if you import CSV exports instead.',
    how: 'Same console → OAuth consent screen (External, add yourself as a test user) → Credentials → OAuth client ID → Web application → redirect URI exactly http://localhost:4321/api/gsc/callback',
    optional: true,
  },
  GSC_CLIENT_SECRET: { label: 'Search Console OAuth client secret', unlocks: 'Pairs with the client ID above.', how: 'Shown next to the client ID when you create it.', optional: true, secret: true },
  ANTHROPIC_API_KEY: { label: 'Anthropic API key', unlocks: 'Better writing on fixes, briefs and captions. Free models still work without it.', how: 'console.anthropic.com → Settings → API keys → Create key.', optional: true, secret: true },
  GEMINI_API_KEY: { label: 'Google Gemini API key', unlocks: 'A generous free-tier model for drafting. Separate from the PageSpeed key — this one comes from AI Studio.', how: 'aistudio.google.com/apikey → Create API key. This is AI Studio, not Cloud Console — the PageSpeed key will not work here.', optional: true, secret: true },
  GROQ_API_KEY: { label: 'Groq API key', unlocks: 'Free tier, and much faster than the others — noticeable when drafting a batch of fixes.', how: 'console.groq.com → sign in → API Keys → Create API Key.', optional: true, secret: true },
  OPENROUTER_API_KEY: { label: 'OpenRouter API key', unlocks: 'Access to several free models through one endpoint.', how: 'openrouter.ai → sign in → Keys → Create key. Then pick a model ending in :free.', optional: true, secret: true },
  CLARITY_API_TOKEN: { label: 'Microsoft Clarity API token', unlocks: 'Rage clicks, dead clicks, script errors and scroll depth from real sessions — the behaviour data SEO tools cannot see.', how: 'clarity.microsoft.com → your project → Settings → Data Export → Generate new API token. Ten calls per project per day, so responses are cached.', optional: true, secret: true },
  CF_ACCOUNT_ID: { label: 'Cloudflare account ID', unlocks: 'Steadier AI image generation than the keyless provider.', how: 'dash.cloudflare.com → Workers & Pages. The ID is in the URL.', optional: true },
  CF_API_TOKEN: { label: 'Cloudflare API token', unlocks: 'Pairs with the account ID above.', how: 'Same dashboard → API tokens → create with Workers AI read.', optional: true, secret: true },
};

const mask = (v) => {
  if (!v) return null;
  const s = String(v);
  return s.length <= 8 ? '••••' : `••••${s.slice(-4)}`;
};

/* Where a value actually came from. This matters more than it sounds: dotenv
   does NOT override a variable already present in the shell, and it reads .env
   only at boot. So a key can sit correctly in the file while the process uses a
   different one, with nothing on screen to say so. That produces exactly the
   "I added a new key and it still says expired" dead end. */
async function provenance() {
  let fileVals = {};
  try {
    const text = await readFile(ENV, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (m) fileVals[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  } catch { fileVals = {}; }

  const out = {};
  for (const k of Object.keys(FIELDS)) {
    let live = process.env[k] || '';
    let inFile = fileVals[k] || '';
    if (k === 'GSC_CLIENT_ID' && !live && process.env.GOOGLE_CLIENT_ID) live = process.env.GOOGLE_CLIENT_ID;
    if (k === 'GSC_CLIENT_ID' && !inFile && fileVals.GOOGLE_CLIENT_ID) inFile = fileVals.GOOGLE_CLIENT_ID;
    if (k === 'GSC_CLIENT_SECRET' && !live && process.env.GOOGLE_CLIENT_SECRET) live = process.env.GOOGLE_CLIENT_SECRET;
    if (k === 'GSC_CLIENT_SECRET' && !inFile && fileVals.GOOGLE_CLIENT_SECRET) inFile = fileVals.GOOGLE_CLIENT_SECRET;
    out[k] = {
      inFile: !!inFile,
      fileHint: mask(inFile),
      matches: !inFile || !live ? null : inFile === live,
      shadowed: !!(inFile && live && inFile !== live),
    };
  }
  return { fields: out, envExists: Object.keys(fileVals).length > 0 };
}

export { provenance };

/** Never returns a value — only presence and a tail, so secrets stay server-side. */
export async function status() {
  const prov = await provenance();
  return Object.fromEntries(Object.entries(FIELDS).map(([k, meta]) => {
    const p = prov.fields[k];
    const liveVal = process.env[k] || (k === 'GSC_CLIENT_ID' ? process.env.GOOGLE_CLIENT_ID : (k === 'GSC_CLIENT_SECRET' ? process.env.GOOGLE_CLIENT_SECRET : ''));
    return [k, {
      ...meta,
      set: !!liveVal,
      hint: mask(liveVal),
      inFile: p.inFile,
      fileHint: p.fileHint,
      /* The case that silently wastes an afternoon. */
      shadowed: p.shadowed,
      warning: p.shadowed
        ? `The .env file holds a different value (${p.fileHint}) from the one this server is using (${mask(liveVal)}). A variable set in your shell takes precedence over .env and is not replaced by it. Close the terminal, open a new one, and start the server again — or unset it with: Remove-Item Env:\\${k}`
        : p.inFile && !liveVal
          ? 'Present in .env but not loaded. The file is only read when the server starts — restart it.'
          : null,
    }];
  }));
}

/* ── validation before acceptance ─────────────────────────────────────────── */

/* A key that is saved but wrong is worse than no key: every feature that uses
   it fails with a confusing error later. So each is tested at the point of
   entry and rejected with the API's own message. */
const VALIDATORS = {
  async GOOGLE_API_KEY(key) {
    const u = new URL('https://www.googleapis.com/pagespeedonline/v5/runPagespeed');
    u.searchParams.set('url', 'https://example.com');
    u.searchParams.set('key', key);
    const r = await fetch(u, { signal: AbortSignal.timeout(70000) });
    const raw = await r.text();
    let j = null;
    try { j = JSON.parse(raw); } catch { /* not JSON */ }
    if (r.ok && j) return { ok: true, detail: 'PageSpeed accepted the key.' };
    if (!j) {
      // A proxy, VPN or network filter intercepted the request — nothing to do
      // with the key, and saving it would hide the real problem.
      return { ok: false, detail: `Google did not return JSON (HTTP ${r.status}). Something on the network intercepted the request — a proxy, VPN or filter. The key was not saved because it could not be checked.` };
    }
    const m = j?.error?.message || `HTTP ${r.status}`;
    if (/API key not valid|API_KEY_INVALID/i.test(m)) return { ok: false, detail: 'Google says that key is not valid. Check for a stray space when copying.' };
    if (/has not been used|is disabled|SERVICE_DISABLED/i.test(m)) return { ok: false, detail: 'The key is real but the PageSpeed Insights API is not enabled on its project. Enable it in the Library, wait a minute, then retry.' };
    return { ok: false, detail: m };
  },
  async ANTHROPIC_API_KEY(key) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 4, messages: [{ role: 'user', content: 'hi' }] }),
      signal: AbortSignal.timeout(30000),
    });
    if (r.ok) return { ok: true, detail: 'Anthropic accepted the key.' };
    const j = await r.json().catch(() => null);
    return { ok: false, detail: j?.error?.message || `HTTP ${r.status}` };
  },
  async GSC_CLIENT_ID(id) {
    if (!id.endsWith('.apps.googleusercontent.com')) {
      return { ok: false, detail: 'Google OAuth client IDs typically end with .apps.googleusercontent.com. Make sure you copied the Client ID from Google Cloud Console.' };
    }
    return { ok: true, detail: 'OAuth client ID format valid.' };
  },
};

/** Writes .env in place, preserving comments and any keys we do not manage. */
async function persist(updates) {
  let text = '';
  try { text = await readFile(ENV, 'utf8'); } catch { /* first save */ }
  const lines = text ? text.split(/\r?\n/) : [];

  for (const [k, v] of Object.entries(updates)) {
    const i = lines.findIndex((l) => new RegExp(`^\\s*${k}\\s*=`).test(l));
    const line = `${k}=${v}`;
    if (i >= 0) lines[i] = line; else lines.push(line);
  }
  const out = lines.join('\n').replace(/\n{3,}/g, '\n\n');
  await writeFile(ENV, out.endsWith('\n') ? out : `${out}\n`, { mode: 0o600 });
}

/**
 * Validates, applies to the running process, and writes to .env. Applying to
 * process.env means features light up immediately with no restart.
 */
export async function save(values) {
  const results = {};
  const accepted = {};

  for (const [k, raw] of Object.entries(values)) {
    if (!(k in FIELDS)) { results[k] = { ok: false, detail: 'Not a setting this tool uses.' }; continue; }
    const v = String(raw ?? '').trim();

    if (!v) {                                    // empty means "remove"
      delete process.env[k];
      accepted[k] = '';
      results[k] = { ok: true, detail: 'Cleared.' };
      continue;
    }
    if (/\s/.test(v)) { results[k] = { ok: false, detail: 'That contains whitespace — a copy-paste artefact. Re-copy it.' }; continue; }

    const check = VALIDATORS[k];
    if (check) {
      try {
        const r = await check(v);
        results[k] = r;
        if (!r.ok) continue;
      } catch (e) {
        results[k] = { ok: false, detail: `Could not reach the API to verify it: ${String(e.message).split('\n')[0]}. Not saved — a key that cannot be checked is one you will debug later.` };
        continue;
      }
    } else {
      results[k] = { ok: true, detail: 'Saved. This one has no validation endpoint, so it is checked the first time a feature uses it.' };
    }
    process.env[k] = v;
    if (k === 'GSC_CLIENT_ID') process.env.GOOGLE_CLIENT_ID = v;
    if (k === 'GSC_CLIENT_SECRET') process.env.GOOGLE_CLIENT_SECRET = v;
    accepted[k] = v;
  }

  if (Object.keys(accepted).length) await persist(accepted);
  return { results, status: await status(), saved: Object.keys(accepted) };
}

/** Tests the key the process is CURRENTLY holding, and names it. */
export async function verifyLive(name) {
  if (!(name in FIELDS)) throw new Error('Not a setting this tool uses.');
  const live = process.env[name];
  const prov = (await provenance()).fields[name];
  if (!live) {
    return {
      key: name, set: false,
      verdict: prov.inFile
        ? `Present in .env (${prov.fileHint}) but not loaded into the running server. Restart it.`
        : 'Not set anywhere.',
    };
  }
  const check = VALIDATORS[name];
  if (!check) return { key: name, set: true, hint: mask(live), verdict: 'No validation endpoint for this one — it is checked the first time a feature uses it.' };

  try {
    const r = await check(live);
    return {
      key: name, set: true, hint: mask(live), ok: r.ok,
      verdict: r.ok
        ? `Working. The server is using the key ending ${mask(live).slice(-4)}.`
        : `Google rejected the key ending ${mask(live).slice(-4)}: ${r.detail}`,
      shadowWarning: prov.shadowed
        ? `This is NOT the value in your .env file, which ends ${String(prov.fileHint).slice(-4)}. A shell variable is overriding the file — that is why a new key in .env appears to have no effect.`
        : null,
    };
  } catch (e) {
    return { key: name, set: true, hint: mask(live), ok: false, verdict: `Could not check it: ${e.message}` };
  }
}

export const envPath = () => ENV;
