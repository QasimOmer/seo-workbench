/* AI visibility (GEO / AEO).
   Runs a set of buyer prompts through every reachable model and measures
   whether the brand is NAMED, whether its domain is CITED, and how the share
   of voice divides between you and named competitors.

   Two distinctions the category gets right and which are worth keeping:

     - Named vs cited. A model mentioning "Acme" is not the same as it linking
       acme.com as a source. The second sends traffic; the first only shapes
       perception. Tools that merge them overstate the result.
     - Runs, not days. There is no ranking to poll — each run is a fresh
       sample from a stochastic system. Two runs on the same day can differ,
       so the unit of time is the run and the UI says so.

   Honest limits, stated in the payload as well as here: this measures the
   models THIS tool can reach, which is not the same set a consumer uses. A
   local Llama's opinion of your brand is close to worthless as a proxy for
   ChatGPT. Sample sizes are small, so a single run is an anecdote. */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate, survey } from './llm.js';

import { DATA_DIR } from './paths.js';
const DATA = DATA_DIR;
const file = (id) => join(DATA, `aivis-${id || 'unassigned'}.json`);

const read = async (id) => { try { return JSON.parse(await readFile(file(id), 'utf8')); } catch { return { prompts: [], runs: [] }; } };
const write = async (id, v) => { await mkdir(DATA, { recursive: true }); await writeFile(file(id), JSON.stringify(v, null, 2)); };

export const load = (id) => read(id);

export async function savePrompts(id, prompts) {
  const d = await read(id);
  d.prompts = (prompts || []).map((p) => String(p).trim()).filter(Boolean).slice(0, 40);
  await write(id, d);
  return d.prompts;
}

/* ── detection ────────────────────────────────────────────────────────────── */

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Word-boundary match, so "Stride" does not fire on "strident". */
const named = (text, brand) => {
  if (!brand) return false;
  return new RegExp(`(^|[^a-z0-9])${esc(brand)}([^a-z0-9]|$)`, 'i').test(text);
};

/** A citation is the domain appearing, which is a different and stronger
    signal than the brand name being said. */
const cited = (text, domain) => {
  if (!domain) return false;
  const bare = String(domain).replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
  return new RegExp(`(^|[^a-z0-9.-])${esc(bare)}([^a-z0-9-]|$)`, 'i').test(text);
};

/* Deliberately crude, and labelled as such in the output. A real sentiment
   model would be better; a lexicon at least cannot hallucinate a verdict. */
const POS = /\b(best|excellent|great|recommend(ed|s)?|top|leading|popular|reliable|trusted|favourite|favorite|strong|quality|renowned|standout)\b/gi;
const NEG = /\b(worst|poor|avoid|unreliable|expensive|limited|lacking|criticis(ed|m)|complaint|outdated|weak|disappointing)\b/gi;

function sentimentAround(text, brand) {
  if (!brand) return null;
  // Only judge the sentence the brand appears in — a positive paragraph about a
  // competitor is not positive about you.
  const sentences = String(text).split(/(?<=[.!?])\s+/).filter((s) => named(s, brand));
  if (!sentences.length) return null;
  const window = sentences.join(' ');
  const pos = (window.match(POS) || []).length;
  const neg = (window.match(NEG) || []).length;
  const score = pos + neg ? (pos - neg) / (pos + neg) : 0;
  return {
    label: score > 0.2 ? 'Positive' : score < -0.2 ? 'Negative' : 'Neutral',
    score: +(((score + 1) / 2) * 10).toFixed(1),
    basis: `${pos} positive and ${neg} negative terms in the ${sentences.length} sentence(s) naming the brand`,
  };
}

/** Everyone the model named, so share of voice has a denominator that reflects
    the actual answer rather than only the competitors you thought to list. */
function detectBrands(text, known = []) {
  const found = new Map();
  for (const b of known) if (named(text, b)) found.set(b, (found.get(b) || 0) + 1);
  // Capitalised multi-word runs are a reasonable proxy for brand names in prose.
  for (const m of String(text).matchAll(/\b([A-Z][a-zA-Z0-9&'’]+(?: [A-Z][a-zA-Z0-9&'’]+){0,2})\b/g)) {
    const cand = m[1].trim();
    if (cand.length < 3 || cand.split(' ').length > 3) continue;
    if (/^(The|A|An|And|But|For|If|In|On|At|To|Of|It|This|That|These|Those|You|Your|We|Our|I|As|Is|Are|Was|Were|Be|Best|Top|Here|There|When|While|With|However|Also|Some|Many|Most|Other|Both|Each)\b/.test(cand)) continue;
    if ([...found.keys()].some((k) => named(cand, k))) continue;
    found.set(cand, (found.get(cand) || 0) + 1);
  }
  /* Merge fragments into the longest name that contains them. Without this,
     "Cedar & Cup" is also counted as "Cedar" and as "Cup" — one competitor
     appearing three times, which inflates their share of voice and understates
     yours. The dedup above only caught the reverse direction. */
  const names = [...found.keys()];
  const merged = new Map();
  for (const [cand, n] of found) {
    // If a longer detected name contains this one, this is a fragment of it.
    // DISCARD it rather than folding its count in — "Cedar & Cup" appearing
    // once must count once, not three times for Cedar, Cup and the whole.
    const isFragment = names.some((other) => other !== cand
      && other.length > cand.length
      && named(other, cand));
    if (isFragment) continue;
    merged.set(cand, (merged.get(cand) || 0) + n);
  }
  return [...merged.entries()]
    .map(([brand, mentions]) => ({ brand, mentions }))
    .sort((a, b) => b.mentions - a.mentions);
}

/* ── a run ────────────────────────────────────────────────────────────────── */

const SYSTEM = 'Answer as you would for a member of the public asking this. Recommend specific named businesses or products where that is what the question calls for. Be concise — under 180 words.';

/**
 * One run: every prompt against every reachable provider. Sequential and paced,
 * because a local model is the slowest link and hammering a free tier is how
 * you lose access to it.
 */
export async function runOnce(id, { brand, domain, competitors = [], prompts = [], providers = null, onProgress } = {}) {
  if (!brand) throw new Error('A brand name is required — that is what is being looked for in the answers.');
  if (!prompts.length) throw new Error('Add at least one prompt. These should be the questions a customer would actually type, not keywords.');

  const s = await survey();
  const usable = s.providers.filter((p) => p.available && (!providers || providers.includes(p.id)));
  if (!usable.length) throw new Error('No model is reachable. Setup → Text models shows what each one needs.');

  const results = [];
  let done = 0;
  const total = prompts.length * usable.length;

  for (const prompt of prompts) {
    for (const prov of usable) {
      onProgress?.({ done, total, prompt, provider: prov.id });
      try {
        const r = await generate(SYSTEM, prompt, { maxTokens: 420, provider: prov.id });
        const text = r.text || '';
        const brands = detectBrands(text, [brand, ...competitors]);
        results.push({
          prompt, provider: r.provider, model: r.model,
          named: named(text, brand),
          cited: cited(text, domain),
          position: brands.findIndex((b) => named(b.brand, brand)) + 1 || null,
          sentiment: sentimentAround(text, brand),
          brands,
          answer: text.slice(0, 1600),
        });
      } catch (e) {
        results.push({ prompt, provider: prov.id, error: String(e.message).slice(0, 200) });
      }
      done++;
      // Paced: a free tier that rate-limits you is worse than a slow run.
      await new Promise((r) => setTimeout(r, 700));
    }
  }

  const run = { at: new Date().toISOString(), brand, domain, competitors, results, ...score(results, brand, competitors) };
  const d = await read(id);
  d.runs = [...(d.runs || []), run].slice(-30);
  d.prompts = prompts;
  await write(id, d);
  return run;
}

/* ── scoring ──────────────────────────────────────────────────────────────── */

/**
 * The visibility score. Weighted so a citation counts for more than a mention,
 * because a citation is a link and a mention is not — and so being named first
 * counts for more than being named last.
 */
export function score(results, brand, competitors = []) {
  const ok = results.filter((r) => !r.error);
  if (!ok.length) return { score: null, namedRate: 0, citedRate: 0, shareOfVoice: [], answered: 0, attempted: results.length };

  const namedCount = ok.filter((r) => r.named).length;
  const citedCount = ok.filter((r) => r.cited).length;

  const positional = ok.reduce((t, r) => {
    if (!r.named) return t;
    // First mention is worth full weight, decaying to a floor.
    const pos = r.position || 3;
    return t + Math.max(0.4, 1 - (pos - 1) * 0.2);
  }, 0);

  const visibility = Math.round(
    ((positional / ok.length) * 60) + ((citedCount / ok.length) * 40),
  );

  /* Share of voice: your mentions over all brand mentions in the same answers.
     The denominator is everyone the model named, not just competitors you
     listed — otherwise you flatter yourself by omission. */
  const tally = new Map();
  for (const r of ok) for (const b of r.brands || []) tally.set(b.brand, (tally.get(b.brand) || 0) + b.mentions);
  const totalMentions = [...tally.values()].reduce((a, b) => a + b, 0) || 1;
  const shareOfVoice = [...tally.entries()]
    .map(([b, n]) => ({ brand: b, mentions: n, share: Math.round((n / totalMentions) * 100), you: named(b, brand) }))
    .sort((a, b) => b.mentions - a.mentions)
    .slice(0, 10);

  const sentiments = ok.map((r) => r.sentiment).filter(Boolean);
  const avgSent = sentiments.length
    ? +(sentiments.reduce((t, s) => t + s.score, 0) / sentiments.length).toFixed(1)
    : null;

  return {
    score: visibility,
    namedRate: Math.round((namedCount / ok.length) * 100),
    citedRate: Math.round((citedCount / ok.length) * 100),
    shareOfVoice,
    sentiment: avgSent,
    answered: ok.length,
    attempted: results.length,
    providers: [...new Set(ok.map((r) => r.provider))],
    scoring: 'Out of 100: 60 for being named, weighted by how early in the answer, and 40 for the domain being cited. A citation is worth more than a mention because a citation is a link.',
  };
}

/** Per prompt, across runs. The row-level view in a visibility dashboard. */
export function byPrompt(runs = []) {
  const map = new Map();
  for (const [i, run] of runs.entries()) {
    for (const r of run.results || []) {
      if (r.error) continue;
      const e = map.get(r.prompt) || { prompt: r.prompt, runs: [], named: 0, cited: 0, total: 0, sentiments: [] };
      e.total++;
      if (r.named) e.named++;
      if (r.cited) e.cited++;
      if (r.sentiment) e.sentiments.push(r.sentiment.score);
      e.runs[i] = (e.runs[i] || 0) + (r.named ? 1 : 0);
      map.set(r.prompt, e);
    }
  }
  return [...map.values()].map((e) => {
    const visibility = Math.round((e.named / e.total) * 100);
    // Trend needs at least two runs; a single run has no direction.
    const series = e.runs.map((v) => v || 0);
    const trend = series.length >= 2
      ? Math.round(((series[series.length - 1] - series[0]) / Math.max(1, series[0] || 1)) * 100)
      : null;
    return {
      prompt: e.prompt, visibility,
      citedRate: Math.round((e.cited / e.total) * 100),
      sentiment: e.sentiments.length ? +(e.sentiments.reduce((a, b) => a + b, 0) / e.sentiments.length).toFixed(1) : null,
      trend, samples: e.total,
    };
  }).sort((a, b) => b.visibility - a.visibility);
}

/** Suggested prompts from the brand record — buyer questions, not keywords. */
export function suggestPrompts(brand = {}) {
  const svc = (brand.services || []).slice(0, 4);
  const loc = (brand.locations || [])[0];
  const out = [];
  for (const s of svc) {
    out.push(`best ${String(s).toLowerCase()}${loc ? ` in ${loc}` : ''}`);
    out.push(`how do I choose a ${String(s).toLowerCase().replace(/s$/, '')}`);
  }
  if (brand.name) out.push(`is ${brand.name} any good`, `${brand.name} alternatives`);
  if (loc) out.push(`who should I use for ${svc[0] ? String(svc[0]).toLowerCase() : 'this'} in ${loc}`);
  return [...new Set(out)].slice(0, 12);
}

export const LIMITS = 'This measures the models this tool can reach, which is not the set your customers use — a local Llama\'s view of your brand is a weak proxy for ChatGPT\'s. Answers are stochastic, so two runs on the same day will differ and a single run is an anecdote rather than a measurement. Sentiment is lexicon-based, not a model, so treat it as a hint. Trends need three or more runs before they mean anything.';

export { named as _named, cited as _cited, detectBrands as _detectBrands, sentimentAround as _sentiment };
