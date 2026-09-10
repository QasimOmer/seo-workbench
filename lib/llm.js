/* Text providers.
   Ordered by what actually serves you best, not by brand:

     1. Local models (Ollama, LM Studio). No key, no quota, no rate limit,
        nothing leaves the machine. If one is running it wins outright — for
        a tool that sends client page content to a model, "nothing leaves the
        machine" is worth more than a few points of quality.
     2. Keyed providers you happen to have. Better output when present.
     3. Keyless hosted (Pollinations). Works with zero setup, rate-limited.

   Every provider exposes the same three things: detect, models, chat. Adding
   one is a single entry, and the chain handles failure by moving on. */

const T = (ms) => AbortSignal.timeout(ms);
const UA = 'SEOWorkbench/2.0';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/openai';

/* ── OpenAI-compatible chat, which nearly everything speaks now ──────────── */
async function oaiChat({ base, key, model, system, prompt, maxTokens, timeout = 120000, extraHeaders = {} }) {
  const r = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
      'User-Agent': UA,
      ...extraHeaders,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
      max_tokens: maxTokens,
      temperature: 0.4,
    }),
    signal: T(timeout),
  });
  const text = await r.text();
  if (!r.ok) {
    /* Pull the human-readable message out of whatever envelope arrived. A
       truncated JSON blob is the least useful thing to show someone. */
    let detail = '';
    try {
      const j = JSON.parse(text);
      detail = j?.error?.message || j?.message || j?.error?.status || '';
      if (!detail && Array.isArray(j) && j[0]?.error?.message) detail = j[0].error.message;
    } catch { /* not JSON */ }
    if (!detail) detail = text.replace(/\s+/g, ' ').slice(0, 300);
    throw new Error(`HTTP ${r.status} — ${detail}`);
  }
  let j;
  try { j = JSON.parse(text); } catch { throw new Error('response was not JSON'); }
  const out = j.choices?.[0]?.message?.content;
  if (!out || !out.trim()) throw new Error('empty completion');
  return out.trim();
}

/* Local model names ranked by suitability for structured instruction-following.
   Small models produce unusable JSON, which breaks half the features. */
const LOCAL_PREFERENCE = [
  /qwen2\.5.*(14|32|72)b/i, /qwen3/i, /llama3\.[23].*(8|70)b/i, /mistral-nemo/i,
  /gemma[23].*(9|12|27)b/i, /phi[34]/i, /qwen2\.5/i, /llama3/i, /mistral/i, /gemma/i,
];
/* Pick the newest capable model from whatever the API reports. Hardcoding a
   name means the provider breaks the moment Google ships a generation — which
   is exactly what happened with gemini-2.0-flash. */
export function newestByVersion(names, { prefer = [], avoid = [] } = {}) {
  const score = (n) => {
    const v = parseFloat((n.match(/(\d+\.\d+)/) || n.match(/(\d+)/) || [0, 0])[1]) || 0;
    let bonus = 0;
    prefer.forEach((re, i) => { if (re.test(n)) bonus += (prefer.length - i) * 10; });
    avoid.forEach((re) => { if (re.test(n)) bonus -= 40; });
    /* A stable model beats a preview one generation newer: this tool depends on
       parseable JSON, and preview endpoints change behaviour and get shut down.
       Sized to lose one generation but not several. */
    if (/preview|exp(erimental)?|-\d{4}$/i.test(n)) bonus -= 25;
    return v * 100 + bonus;
  };
  return [...names].sort((a, b) => score(b) - score(a))[0];
}

function bestLocal(names) {
  for (const re of LOCAL_PREFERENCE) {
    const hit = names.find((n) => re.test(n));
    if (hit) return hit;
  }
  return names[0];
}

export const PROVIDERS = [
  {
    id: 'ollama',
    label: 'Ollama (on this machine)',
    kind: 'local',
    why: 'No key, no quota, no rate limit, and no page content leaves your machine. The best option if you have it.',
    setup: 'ollama.com → install → then: ollama pull qwen2.5:14b',
    async detect() {
      const base = process.env.OLLAMA_URL || 'http://localhost:11434';
      const r = await fetch(`${base}/api/tags`, { signal: T(2500) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      const models = (j.models || []).map((m) => m.name).filter(Boolean);
      if (!models.length) throw new Error('Ollama is running but has no models. Pull one: ollama pull qwen2.5:14b');
      return { models, model: bestLocal(models), base };
    },
    chat: (o) => oaiChat({ ...o, base: `${o.base}/v1` }),
  },
  {
    id: 'lmstudio',
    label: 'LM Studio (on this machine)',
    kind: 'local',
    why: 'Same benefits as Ollama. Start its local server from the Developer tab.',
    setup: 'lmstudio.ai → load a model → Developer → Start Server',
    async detect() {
      const base = process.env.LMSTUDIO_URL || 'http://localhost:1234/v1';
      const r = await fetch(`${base}/models`, { signal: T(2500) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      const models = (j.data || []).map((m) => m.id).filter(Boolean);
      if (!models.length) throw new Error('LM Studio server is up but no model is loaded.');
      return { models, model: bestLocal(models), base };
    },
    chat: (o) => oaiChat(o),
  },
  {
    id: 'anthropic',
    label: 'Claude',
    kind: 'keyed',
    env: 'ANTHROPIC_API_KEY',
    why: 'Best instruction-following of the options here. Paid.',
    setup: 'console.anthropic.com → API keys',
    async detect() {
      if (!process.env.ANTHROPIC_API_KEY) throw new Error('no key');
      return { models: [process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6'], model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6' };
    },
    async chat({ model, system, prompt, maxTokens }) {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: prompt }] }),
        signal: T(120000),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error(j?.error?.message || `HTTP ${r.status}`);
      const out = (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim();
      if (!out) throw new Error('empty completion');
      return out;
    },
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    kind: 'keyed',
    env: 'GEMINI_API_KEY',
    why: 'Generous free tier. Note this is a separate key from the PageSpeed one — it comes from AI Studio, not Cloud Console.',
    setup: 'aistudio.google.com/apikey',
    async detect() {
      const key = process.env.GEMINI_API_KEY;
      if (!key) throw new Error('no key');
      if (process.env.GEMINI_MODEL) {
        return { models: [process.env.GEMINI_MODEL], model: process.env.GEMINI_MODEL, base: GEMINI_BASE };
      }
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}&pageSize=200`, { signal: T(12000) });
      const text = await r.text();
      let j = null;
      try { j = JSON.parse(text); } catch { /* not JSON */ }
      if (!r.ok) throw new Error(j?.error?.message || `HTTP ${r.status}: ${text.slice(0, 160)}`);

      const models = (j.models || [])
        .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
        .map((m) => String(m.name).replace(/^models\//, ''))
        // text generation only — embeddings, speech and image models 400 here
        .filter((n) => !/embedding|aqa|imagen|transcribe|tts|veo|robotics|live|native-audio/i.test(n));
      if (!models.length) throw new Error('The key works but reports no text-generation models. Check the key is from AI Studio and not restricted.');

      return {
        models,
        // flash is the free-tier workhorse; lite only if nothing better exists
        model: newestByVersion(models, { prefer: [/flash/i, /pro/i], avoid: [/lite/i, /thinking/i] }),
        base: GEMINI_BASE,
      };
    },
    chat: (o) => oaiChat({ ...o, key: process.env.GEMINI_API_KEY }),
  },
  {
    id: 'groq',
    label: 'Groq',
    kind: 'keyed',
    env: 'GROQ_API_KEY',
    why: 'Free tier, and far faster than anything else here — useful when generating a batch of fixes.',
    setup: 'console.groq.com/keys',
    async detect() {
      if (!process.env.GROQ_API_KEY) throw new Error('no key');
      const r = await fetch('https://api.groq.com/openai/v1/models', {
        headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` }, signal: T(8000),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      const models = (j.data || []).map((x) => x.id).filter((id) => !/whisper|guard|tts/i.test(id));
      return { models, model: process.env.GROQ_MODEL || bestLocal(models), base: 'https://api.groq.com/openai/v1' };
    },
    chat: (o) => oaiChat({ ...o, key: process.env.GROQ_API_KEY }),
  },
  {
    id: 'openrouter',
    label: 'OpenRouter (free models)',
    kind: 'keyed',
    env: 'OPENROUTER_API_KEY',
    why: 'Routes to many models, several of which are free. Rate-limited on the free ones.',
    setup: 'openrouter.ai/keys',
    async detect() {
      if (!process.env.OPENROUTER_API_KEY) throw new Error('no key');
      const m = process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct:free';
      return { models: [m], model: m, base: 'https://openrouter.ai/api/v1' };
    },
    chat: (o) => oaiChat({ ...o, key: process.env.OPENROUTER_API_KEY, extraHeaders: { 'HTTP-Referer': 'http://localhost:4321', 'X-Title': 'SEO Workbench' } }),
  },
  {
    id: 'cloudflare',
    label: 'Cloudflare Workers AI',
    kind: 'keyed',
    env: 'CF_API_TOKEN',
    why: 'Free daily allowance. Already used for image generation if you have it set up.',
    setup: 'dash.cloudflare.com → Workers & Pages → AI',
    async detect() {
      if (!(process.env.CF_ACCOUNT_ID && process.env.CF_API_TOKEN)) throw new Error('no key');
      const m = process.env.CF_MODEL || '@cf/meta/llama-3.1-8b-instruct';
      return { models: [m], model: m, base: `https://api.cloudflare.com/client/v4/accounts/${process.env.CF_ACCOUNT_ID}/ai/v1` };
    },
    chat: (o) => oaiChat({ ...o, key: process.env.CF_API_TOKEN }),
  },
  {
    id: 'pollinations',
    label: 'Pollinations (no key)',
    kind: 'keyless',
    why: 'Works with zero setup, which is why it is the floor. Anonymous tier is rate-limited with no uptime guarantee.',
    setup: 'Nothing to do.',
    async detect() { return { models: ['openai', 'mistral'], model: 'openai', base: 'https://text.pollinations.ai' }; },
    async chat(o) {
      try { return await oaiChat({ ...o, base: 'https://text.pollinations.ai' }); }
      catch {
        // The older GET route survives when the POST one is busy.
        const r = await fetch(`https://text.pollinations.ai/${encodeURIComponent(`${o.system}\n\n${o.prompt}`.slice(0, 6000))}`,
          { headers: { 'User-Agent': UA }, signal: T(120000) });
        const t = await r.text();
        if (!r.ok || t.trim().length < 20) throw new Error(`HTTP ${r.status}`);
        return t.trim();
      }
    },
  },
];

/* Local first, then whatever keys exist, then keyless. */
const KIND_ORDER = { local: 0, keyed: 1, keyless: 2 };
const ordered = () => [...PROVIDERS].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);

let cache = null;

/** Probes every provider. Cached, because detection makes network calls. */
export async function survey({ force = false } = {}) {
  if (cache && !force) return cache;
  const out = [];
  for (const p of ordered()) {
    try {
      const info = await p.detect();
      out.push({ id: p.id, label: p.label, kind: p.kind, why: p.why, setup: p.setup, env: p.env, available: true, ...info });
    } catch (e) {
      out.push({
        id: p.id, label: p.label, kind: p.kind, why: p.why, setup: p.setup, env: p.env,
        available: false,
        reason: e.message === 'no key' ? `Needs ${p.env} in Setup & keys.` : e.message,
      });
    }
  }
  cache = { providers: out, preferred: process.env.LLM_PROVIDER || null, checkedAt: new Date().toISOString() };
  return cache;
}

export const invalidate = () => { cache = null; };

/**
 * Runs the chain. An explicit preference goes first; otherwise local, keyed,
 * keyless. Reports every failure so a total outage is diagnosable.
 */
export async function generate(system, prompt, { maxTokens = 2000, json = false, provider } = {}) {
  const s = await survey();
  const want = provider || s.preferred;
  const list = s.providers.filter((x) => x.available);
  if (want) {
    const i = list.findIndex((x) => x.id === want);
    if (i > 0) list.unshift(list.splice(i, 1)[0]);
  }
  if (!list.length) {
    throw new Error('No text provider is reachable. Every option is listed under Models in Setup & keys with what each needs — the quickest fix with no signup is to install Ollama and run: ollama pull qwen2.5:14b');
  }

  const tried = [];
  for (const entry of list) {
    const impl = PROVIDERS.find((p) => p.id === entry.id);
    try {
      const text = await impl.chat({
        base: entry.base, model: entry.model, system, prompt, maxTokens,
      });
      return json
        ? { data: parseLooseJson(text), provider: entry.id, model: entry.model, tried }
        : { text, provider: entry.id, model: entry.model, tried };
    } catch (e) {
      tried.push(`${entry.id} (${entry.model}): ${String(e.message).slice(0, 260)}`);
      invalidate();   // a failure may mean it went away; re-probe next time
    }
  }
  throw new Error(`Every available text provider failed. Tried — ${tried.join(' | ')}`);
}

/** Free models wrap JSON in prose and fences constantly, so the parser has to
    be forgiving or half the features break on formatting alone. */
export function parseLooseJson(text) {
  let t = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try { return JSON.parse(t); } catch { /* keep going */ }
  const first = Math.min(...['{', '['].map((c) => { const i = t.indexOf(c); return i < 0 ? Infinity : i; }));
  if (first === Infinity) throw new Error('The model returned prose instead of JSON.');
  const open = t[first], close = open === '{' ? '}' : ']';
  let depth = 0, inStr = false, esc = false;
  for (let i = first; i < t.length; i++) {
    const ch = t[i];
    if (esc) { esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === open) depth++;
    else if (ch === close && --depth === 0) {
      const slice = t.slice(first, i + 1);
      try { return JSON.parse(slice); }
      catch { return JSON.parse(slice.replace(/,\s*([}\]])/g, '$1')); }
    }
  }
  throw new Error('The model returned truncated JSON.');
}
