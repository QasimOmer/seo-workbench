/* Local content generation — templates, not prose.
   An honest structural brief beats hallucinated copy: it tells you what the
   page must cover and what to decide, without inventing facts about a business
   it knows nothing about. When AI is reachable it writes better sentences; this
   guarantees you always get the shape. */

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const titleCase = (s) => clean(s).replace(/\b([a-z])/g, (m) => m.toUpperCase());

/** Question words in the topic tell you which format the SERP will reward. */
export function classifyIntent(topic) {
  const t = String(topic).toLowerCase();
  if (/^(how|what|why|when|when to|can i|do i|does|is it)\b/.test(t) || /\bguide|tutorial|explained|meaning\b/.test(t)) return 'informational';
  if (/\bbest|top|review|compare|vs\.?|versus|alternative\b/.test(t)) return 'commercial';
  if (/\bbuy|price|cost|cheap|deal|order|hire|near me|book\b/.test(t)) return 'transactional';
  if (/\blogin|contact|hours|address\b/.test(t)) return 'navigational';
  return 'informational';
}

const SHAPES = {
  informational: {
    format: 'A guide or explainer. Answer in the first two sentences, then earn the scroll.',
    sections: ['The short answer', 'Why it works that way', 'How to do it, step by step', 'What people get wrong', 'When to get help', 'Common questions'],
  },
  commercial: {
    format: 'A comparison. The SERP for this almost always rewards a list or table, not a sales page.',
    sections: ['What we recommend and why', 'How we judged them', 'The options compared', 'Who each one suits', 'What to avoid', 'Common questions'],
  },
  transactional: {
    format: 'A conversion page. Price, availability and next step above the fold.',
    sections: ['What you get', 'What it costs', 'How it works', 'Why us rather than the alternative', 'Common questions', 'Next step'],
  },
  navigational: {
    format: 'A utility page. Get the person to the thing in one click.',
    sections: ['The thing they came for', 'Other ways to reach us', 'What to expect'],
  },
};

export function localBrief(kind, topic, brand, extra = {}) {
  const intent = extra.intent || classifyIntent(topic);
  const shape = SHAPES[intent] || SHAPES.informational;
  const t = clean(topic);
  const B = brand?.name || 'the business';

  if (kind === 'email') {
    return `# Email brief — ${t}

**Subject line, pick one and test:**
- ${titleCase(t)}
- What to know about ${t.toLowerCase()}
- ${t}: the short version

**Preview text:** one sentence that does not repeat the subject.

**Body, 120–180 words:**
1. Open with the reader's situation, not your news.
2. One idea only. Cut the second idea into a second email.
3. The single action you want, as a link, ${brand?.cta ? `worded "${brand.cta}"` : 'worded as the outcome rather than "click here"'}.

**Before sending:** does the first line survive being read alone in a notification?`;
  }

  if (kind === 'ad') {
    return `# Ad brief — ${t}

Intent read: **${intent}**. ${shape.format}

**Headlines, 30 characters each — write 3 and count the characters:**
- Lead with the outcome
- Lead with the differentiator${brand?.differentiators ? ` (${brand.differentiators.slice(0, 60)})` : ''}
- Lead with the objection you overcome

**Descriptions, 90 characters each — write 2:**
- What happens when they click
- ${brand?.cta || 'The specific next step'}

**Do not** promise anything the landing page does not deliver. Mismatch is the most common cause of a high spend and no conversions.`;
  }

  return `# Brief — ${t}

**Search intent:** ${intent}
**Format the SERP rewards:** ${shape.format}

**Before you write:** search "${t}" and look at the top five results. If they are all a format you are not planning to make, change your plan rather than theirs. This is the one step nothing can do for you.

**Working title:** ${titleCase(t)} — keep the subject first, brand last, under about 580px.

**H1:** ${titleCase(t)}

**Sections:**
${shape.sections.map((sc, i) => `${i + 1}. **${sc}**\n   What must this section answer? Write the question, then answer it.`).join('\n')}

**Answer-first test:** can a reader get the core answer from the first two sentences without scrolling? If not, rewrite the opening.

**Internal links:** link out to your closest related page, and add a link back to this one from any page already discussing ${t.toLowerCase()}. That reciprocal pair is worth more than either link alone.

**E-E-A-T:** name the author and their relevant experience. ${brand?.compliance ? `Compliance constraints on file: ${brand.compliance}` : 'If this topic touches health, money or safety, an unnamed author is a real ranking liability.'}

**Schema:** ${intent === 'informational' ? 'Article + BreadcrumbList. FAQPage only if the questions are visible on the page.' : 'Product or Service + BreadcrumbList.'}

**Do not measure this by:** word count, keyword density, or a content score. Measure it by whether it answers the query better than what currently ranks.

${brand?.voice ? `**Voice on file:** ${brand.voice}` : '**Voice:** not recorded. Fill in Brand context and this brief gets specific to you.'}
${brand?.avoid ? `**Never write:** ${brand.avoid}` : ''}`;
}

/* ── social starters ─────────────────────────────────────────────────────── */

const PLATFORM_SHAPE = {
  instagram_post: { hook: 'A single claim, big type.', cap: 'Two short paragraphs, then the action.' },
  instagram_story: { hook: 'Four words maximum.', cap: 'No caption — the image carries it.' },
  facebook: { hook: 'A question the reader has asked themselves.', cap: 'Three sentences, plain.' },
  linkedin: { hook: 'The counterintuitive part.', cap: 'A short observation, one takeaway, no hashtag soup.' },
  x: { hook: 'The whole point in one line.', cap: 'Under 280 characters including the link.' },
  pinterest: { hook: 'What the reader will be able to do.', cap: 'Describe the outcome, keyword-rich but readable.' },
  youtube_thumb: { hook: 'Three words, readable at 120px wide.', cap: 'No caption.' },
};

const STYLE_CYCLE = ['mesh', 'strata', 'arcs', 'dunes', 'grid', 'facets'];

/** Structured starters with the platform constraints already applied. Honest
    placeholders where a claim would have to be invented. */
export function localSocial(topic, platforms, brand) {
  const t = clean(topic);
  const intent = classifyIntent(t);
  const short = t.length > 46 ? `${t.slice(0, 44).trim()}…` : t;

  const posts = platforms.map((p, i) => {
    const shape = PLATFORM_SHAPE[p] || PLATFORM_SHAPE.instagram_post;
    const headline = p === 'instagram_story' || p === 'youtube_thumb'
      ? titleCase(t.split(/\s+/).slice(0, 4).join(' '))
      : titleCase(short);
    return {
      platform: p,
      headline,
      subhead: p === 'youtube_thumb' ? '' : (brand?.oneLiner || '').slice(0, 60) || 'Add a one-line reason to care',
      caption: [
        `${shape.hook}`,
        '',
        `Draft: ${t}${brand?.name ? ` — from ${brand.name}` : ''}.`,
        `Write ${shape.cap.toLowerCase()}`,
        brand?.cta ? `\nCall to action: ${brand.cta}` : '',
      ].filter(Boolean).join('\n'),
      hashtags: (brand?.services || []).slice(0, 3).map((s) => `#${clean(s).replace(/[^a-z0-9]+/gi, '')}`).filter((h) => h.length > 2),
      imagePrompt: `abstract ${STYLE_CYCLE[i % STYLE_CYCLE.length]} background in the brand colour, no text`,
      style: STYLE_CYCLE[i % STYLE_CYCLE.length],
      altText: `${headline}${brand?.name ? ` — ${brand.name}` : ''}`,
    };
  });

  return { posts, intent };
}
