/* The AI layer. One rule throughout: the model drafts, it never decides.
   Findings come from the deterministic rule set; this only writes the fix. */

import { brandPrompt } from './brand.js';
import { generate } from './llm.js';

/* Always available: the provider chain includes keyless options, so nothing
   here depends on the user having signed up for anything. */
export const aiConfigured = () => true;
export const aiKeyed = () => !!process.env.ANTHROPIC_API_KEY;

async function ask(system, user, { maxTokens = 2000, json = false } = {}) {
  const out = await generate(system, user, { maxTokens, json });
  lastProvider = { provider: out.provider, model: out.model };
  return json ? out.data : out.text;
}

/* Which model actually answered — surfaced in the UI so you know whether a
   draft came from a local 7B or from Claude. It changes how much you trust it. */
let lastProvider = null;
export const usedProvider = () => lastProvider;

const SYSTEM = `You are drafting SEO deliverables for a working agency. Rules you never break:
- Never invent facts, statistics, credentials, awards, case results, prices or dates. If a claim needs a source you were not given, omit it.
- Write plainly. No marketing throat-clearing, no "in today's fast-paced world", no "unlock" or "elevate" or "delve".
- Match the recorded brand voice. If none is recorded, write neutrally.
- Respect stated compliance constraints absolutely. Legal and medical clients have rules that outrank copywriting.
- Return exactly the format asked for and nothing else. No preamble, no explanation, no code fences around JSON.
- This output is consumed by a program. Extra prose breaks it.`;

/* ── fix a specific finding ───────────────────────────────────────────────── */

export async function draftFix(finding, page, brand) {
  const ctx = [
    brandPrompt(brand), '',
    `FINDING (${finding.severity}, stage: ${finding.phase})`,
    `Title: ${finding.title}`,
    `What: ${finding.what}`,
    `Why it matters: ${finding.why}`,
    `Recommended fix: ${finding.fix}`,
    finding.urls?.length ? `Affected URLs (first 10):\n${finding.urls.slice(0, 10).join('\n')}` : '',
    '',
    page ? `THE PAGE
URL: ${page.url}
Current title: ${page.title || '(none)'}
Current meta description: ${page.metaDescription || '(none)'}
H1: ${page.h1?.join(' | ') || '(none)'}
H2s: ${(page.h2 || []).slice(0, 8).join(' | ') || '(none)'}
Word count: ${page.words ?? 'unknown'}
First 600 characters of body text:
${(page.text || '').slice(0, 600)}` : '',
  ].filter(Boolean).join('\n');

  return ask(SYSTEM, `${ctx}

Produce the actual change, ready to paste. Return JSON only:
{
  "summary": "one sentence on what you changed and why",
  "changes": [{"what":"e.g. Title tag","from":"current value or null","to":"new value"}],
  "code": "any markup, JSON-LD or config to paste, or empty string",
  "acceptance": ["testable criteria a reviewer can check"],
  "cannotDo": "anything the fix needs that you were not given — say so plainly, or empty string"
}`, { json: true, maxTokens: 2500 });
}

/* ── campaign-level content ───────────────────────────────────────────────── */

export async function draftContent(kind, topic, brand, extra = {}) {
  const shapes = {
    page: 'A landing page: H1, intro that answers the question in the first two sentences, 5-7 H2 sections with 2-3 sentences of guidance each on what to cover, an FAQ of 4 real questions, and the CTA.',
    post: 'A blog post outline: working title, angle, H2 sections with what each must cover, the internal links it should earn, and what would make it worth reading over what already ranks.',
    email: 'A short email: subject line, preview text, 120-180 words of body, one call to action.',
    ad: 'Three ad variants: 30-character headlines (3 each) and 90-character descriptions (2 each).',
  };
  return ask(SYSTEM, `${brandPrompt(brand)}

TOPIC: ${topic}
${extra.intent ? `SEARCH INTENT: ${extra.intent}` : ''}
${extra.notes ? `NOTES: ${extra.notes}` : ''}

Write: ${shapes[kind] || shapes.post}
Return plain markdown. No preamble.`, { maxTokens: 2200 });
}

/* ── social captions, per platform ────────────────────────────────────────── */

export const PLATFORMS = {
  instagram_post:  { label: 'Instagram post',    w: 1080, h: 1080, chars: 2200, hashtags: 8 },
  instagram_story: { label: 'Instagram story',   w: 1080, h: 1920, chars: 0,    hashtags: 3 },
  facebook:        { label: 'Facebook',          w: 1200, h: 630,  chars: 500,  hashtags: 2 },
  linkedin:        { label: 'LinkedIn',          w: 1200, h: 627,  chars: 1300, hashtags: 3 },
  x:               { label: 'X',                 w: 1600, h: 900,  chars: 280,  hashtags: 2 },
  pinterest:       { label: 'Pinterest',         w: 1000, h: 1500, chars: 500,  hashtags: 4 },
  youtube_thumb:   { label: 'YouTube thumbnail', w: 1280, h: 720,  chars: 0,    hashtags: 0 },
};

export async function draftSocial(topic, platforms, brand, extra = {}) {
  const specs = platforms.map((p) => {
    const s = PLATFORMS[p];
    return `- ${p} (${s.label}, ${s.w}x${s.h}): caption up to ${s.chars || 0} characters${s.hashtags ? `, ${s.hashtags} hashtags` : ', no hashtags'}`;
  }).join('\n');

  return ask(SYSTEM, `${brandPrompt(brand)}

TOPIC: ${topic}
${extra.notes ? `NOTES: ${extra.notes}` : ''}

Write one post per platform. Platforms:
${specs}

For each, also write the words that go ON the image. The headline must fit in
about 7 words and be readable at thumbnail size; the subhead is optional and
should be under 12 words. Write an image prompt describing a PHOTOGRAPHIC OR
ABSTRACT BACKGROUND ONLY — no text, no words, no letters, no logos in the image,
because the text is composed separately in real type.

Return JSON only:
{"posts":[{"platform":"key","caption":"","hashtags":[],"headline":"","subhead":"","imagePrompt":"","altText":""}]}`, { json: true, maxTokens: 3000 });
}

/* ── brand context from the site itself ───────────────────────────────────── */

/** Reads the crawl and proposes the brand record, so you edit rather than type. */
export async function inferBrand(pages, origin) {
  const sample = pages.slice(0, 14).map((p) =>
    `${p.url}\n  title: ${p.title || '-'}\n  h1: ${p.h1?.[0] || '-'}\n  ${(p.text || '').slice(0, 260).replace(/\s+/g, ' ')}`
  ).join('\n\n');

  return ask(SYSTEM, `Below are pages crawled from ${origin}. Infer the business context.
Only record what the pages actually support. Leave a field empty rather than guessing.

${sample}

Return JSON only:
{"name":"","oneLiner":"","services":[],"locations":[],"audience":"","voice":"describe the tone the site already uses","differentiators":"only what the site itself claims","cta":"","compliance":"any regulated-industry constraints implied by the sector","uncertain":["fields you guessed at and a human should check"]}`,
  { json: true, maxTokens: 1800 });
}
