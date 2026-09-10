// The execution half. Everything here produces something you can ship:
// markup, redirect rules, link plans, briefs, tickets.

import { pixelWidth, normaliseUrl } from './parse.js';

/* ─────────────────────────── titles and meta descriptions ─────────────────── */

const TITLE_MAX_PX = 580;
const META_MAX_PX = 920;

/**
 * Rule-based drafts. Deliberately formulaic — a good title is front-loaded and
 * matches the H1, and a formula gets that right at scale. Edit the money pages
 * by hand; this covers the tail.
 */
export function draftTitles(pages, { brand = '', separator = '|', targets = {} } = {}) {
  return pages.map((p) => {
    const target = targets[p.url];
    const core = (target || p.h1s?.[0] || p.title?.split(/[|–—-]/)[0] || slugToWords(p.url)).trim();
    // don't append the brand when the core already carries it — "Firm | Firm" is a tell
    const alreadyBranded = brand && norm(core).includes(norm(brand));
    const withBrand = brand && !alreadyBranded ? `${core} ${separator} ${brand}` : core;
    const trimmed = fitToPixels(withBrand, TITLE_MAX_PX, brand && !alreadyBranded ? ` ${separator} ${brand}` : '');
    return {
      url: p.url,
      current: p.title || '',
      currentPx: pixelWidth(p.title || ''),
      suggested: trimmed,
      suggestedPx: pixelWidth(trimmed),
      h1: p.h1s?.[0] || null,
      matchesH1: !!p.h1s?.[0] && norm(trimmed).includes(norm(p.h1s[0]).split(' ')[0]),
      changed: (p.title || '').trim() !== trimmed,
      reason: !p.title ? 'No title present.'
        : pixelWidth(p.title) > TITLE_MAX_PX ? 'Current title truncates in the SERP.'
        : !p.h1s?.length ? 'No H1 to align against — verify the target term manually.'
        : 'Aligned to the H1 and front-loaded.',
    };
  });
}

export function draftMetas(pages, { brand = '', cta = 'Free consultation.' } = {}) {
  return pages.map((p) => {
    const first = firstSentences(p.bodyText || '', 2);
    const base = first || `${p.h1s?.[0] || slugToWords(p.url)} — what to expect, how it works, and what it costs.`;
    const draft = fitToPixels(`${base} ${cta}`.replace(/\s+/g, ' ').trim(), META_MAX_PX);
    return {
      url: p.url,
      current: p.metaDescription || '',
      suggested: draft,
      suggestedPx: pixelWidth(draft),
      changed: (p.metaDescription || '').trim() !== draft,
      note: 'Meta descriptions are not a ranking factor. This is a click-through lever — the draft is a starting point, and the specific promise on the page will always beat a formula.',
    };
  });
}

/** Optional: hand the drafting to Claude when an API key is present. */
export async function draftWithClaude(pages, instruction, apiKey) {
  if (!apiKey) throw new Error('No ANTHROPIC_API_KEY set. Rule-based drafts are available without one.');
  const payload = pages.slice(0, 25).map((p) => ({
    url: p.url, h1: p.h1s?.[0] || null, title: p.title || null,
    excerpt: (p.bodyText || '').slice(0, 600),
  }));
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: 'You write SEO title tags and meta descriptions. Titles: front-load the distinguishing term, match the page H1, under 60 characters. Meta descriptions: a specific promise plus an action, under 155 characters, never boilerplate. Respond with JSON only — an array of {url, title, metaDescription}. No preamble, no markdown fences.',
      messages: [{ role: 'user', content: `${instruction || 'Draft a title and meta description for each page.'}\n\n${JSON.stringify(payload, null, 1)}` }],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `Anthropic API ${res.status}`);
  const text = (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  return JSON.parse(text.replace(/```json|```/g, '').trim());
}

/* ─────────────────────────────── structured data ──────────────────────────── */

const SCHEMA_BUILDERS = {
  /* Product and Offer are the types most non-service sites actually need, and
     the ones Google is strictest about — price and availability must match
     what the page shows, or the rich result gets pulled. */
  Product: (d) => ({
    '@context': 'https://schema.org', '@type': 'Product',
    name: d.name, description: d.description || undefined,
    image: splitList(d.image).length ? splitList(d.image) : undefined,
    sku: d.sku || undefined, mpn: d.mpn || undefined,
    brand: d.brand ? { '@type': 'Brand', name: d.brand } : undefined,
    offers: d.price ? {
      '@type': 'Offer',
      price: String(d.price).replace(/[^0-9.]/g, ''),
      priceCurrency: d.currency || 'USD',
      availability: `https://schema.org/${d.availability || 'InStock'}`,
      url: d.url || undefined,
      priceValidUntil: d.priceValidUntil || undefined,
    } : undefined,
    aggregateRating: d.ratingValue && d.reviewCount ? {
      '@type': 'AggregateRating', ratingValue: String(d.ratingValue), reviewCount: String(d.reviewCount),
    } : undefined,
  }),
  Event: (d) => ({
    '@context': 'https://schema.org', '@type': 'Event',
    name: d.name, startDate: d.startDate, endDate: d.endDate || undefined,
    eventAttendanceMode: `https://schema.org/${d.attendanceMode || 'OfflineEventAttendanceMode'}`,
    eventStatus: `https://schema.org/${d.status || 'EventScheduled'}`,
    location: d.online
      ? { '@type': 'VirtualLocation', url: d.url }
      : { '@type': 'Place', name: d.locationName, address: addr(d) },
    description: d.description || undefined,
    image: splitList(d.image).length ? splitList(d.image) : undefined,
    organizer: d.organizer ? { '@type': 'Organization', name: d.organizer, url: d.organizerUrl || undefined } : undefined,
    offers: d.price ? {
      '@type': 'Offer', price: String(d.price).replace(/[^0-9.]/g, ''),
      priceCurrency: d.currency || 'USD', url: d.ticketUrl || d.url || undefined,
      availability: `https://schema.org/${d.availability || 'InStock'}`,
    } : undefined,
  }),
  Recipe: (d) => ({
    '@context': 'https://schema.org', '@type': 'Recipe',
    name: d.name, description: d.description || undefined,
    image: splitList(d.image).length ? splitList(d.image) : undefined,
    author: d.author ? { '@type': 'Person', name: d.author } : undefined,
    prepTime: d.prepTime || undefined, cookTime: d.cookTime || undefined, totalTime: d.totalTime || undefined,
    recipeYield: d.recipeYield || undefined,
    recipeIngredient: splitList(d.recipeIngredient),
    recipeInstructions: splitList(d.recipeInstructions).map((t) => ({ '@type': 'HowToStep', text: t })),
    nutrition: d.calories ? { '@type': 'NutritionInformation', calories: d.calories } : undefined,
  }),
  SoftwareApplication: (d) => ({
    '@context': 'https://schema.org', '@type': 'SoftwareApplication',
    name: d.name, applicationCategory: d.applicationCategory || undefined,
    operatingSystem: d.operatingSystem || undefined,
    description: d.description || undefined,
    offers: { '@type': 'Offer', price: String(d.price || 0).replace(/[^0-9.]/g, ''), priceCurrency: d.currency || 'USD' },
  }),
  LegalService: (d) => ({
    '@context': 'https://schema.org', '@type': ['LegalService', 'LocalBusiness'],
    '@id': `${d.url}#organization`,
    name: d.name, url: d.url, telephone: d.phone, email: d.email || undefined,
    image: d.image || undefined, logo: d.logo || undefined,
    description: d.description || undefined,
    priceRange: d.priceRange || undefined,
    address: addr(d),
    geo: d.lat && d.lng ? { '@type': 'GeoCoordinates', latitude: d.lat, longitude: d.lng } : undefined,
    areaServed: splitList(d.areaServed).map((n) => ({ '@type': 'City', name: n })),
    openingHoursSpecification: hours(d.hours),
    sameAs: splitList(d.sameAs),
    hasOfferCatalog: d.services ? {
      '@type': 'OfferCatalog', name: 'Practice areas',
      itemListElement: splitList(d.services).map((s) => ({ '@type': 'Offer', itemOffered: { '@type': 'Service', name: s } })),
    } : undefined,
  }),
  LocalBusiness: (d) => ({
    '@context': 'https://schema.org', '@type': d.businessType || 'LocalBusiness',
    '@id': `${d.url}#organization`,
    name: d.name, url: d.url, telephone: d.phone, image: d.image || undefined,
    description: d.description || undefined, priceRange: d.priceRange || undefined,
    address: addr(d), openingHoursSpecification: hours(d.hours), sameAs: splitList(d.sameAs),
  }),
  Organization: (d) => ({
    '@context': 'https://schema.org', '@type': 'Organization',
    '@id': `${d.url}#organization`,
    name: d.name, url: d.url, logo: d.logo || undefined,
    description: d.description || undefined,
    contactPoint: d.phone ? { '@type': 'ContactPoint', telephone: d.phone, contactType: 'customer service' } : undefined,
    sameAs: splitList(d.sameAs),
  }),
  FAQPage: (d) => ({
    '@context': 'https://schema.org', '@type': 'FAQPage',
    mainEntity: (d.faqs || []).filter((f) => f.q && f.a).map((f) => ({
      '@type': 'Question', name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  }),
  Article: (d) => ({
    '@context': 'https://schema.org', '@type': d.articleType || 'Article',
    headline: d.headline, description: d.description || undefined,
    image: d.image || undefined,
    datePublished: d.datePublished || undefined, dateModified: d.dateModified || d.datePublished || undefined,
    author: d.authorName ? { '@type': 'Person', name: d.authorName, url: d.authorUrl || undefined, jobTitle: d.authorTitle || undefined } : undefined,
    publisher: d.name ? { '@type': 'Organization', name: d.name, logo: d.logo ? { '@type': 'ImageObject', url: d.logo } : undefined } : undefined,
    mainEntityOfPage: { '@type': 'WebPage', '@id': d.url },
  }),
  Person: (d) => ({
    '@context': 'https://schema.org', '@type': 'Person',
    name: d.authorName, url: d.authorUrl || d.url, jobTitle: d.authorTitle || undefined,
    image: d.image || undefined, description: d.description || undefined,
    worksFor: d.name ? { '@type': 'Organization', name: d.name } : undefined,
    alumniOf: splitList(d.alumniOf).map((n) => ({ '@type': 'EducationalOrganization', name: n })),
    knowsAbout: splitList(d.knowsAbout),
    sameAs: splitList(d.sameAs),
  }),
  BreadcrumbList: (d) => ({
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: (d.crumbs || []).map((c, i) => ({
      '@type': 'ListItem', position: i + 1, name: c.name, item: c.url,
    })),
  }),
  Service: (d) => ({
    '@context': 'https://schema.org', '@type': 'Service',
    name: d.serviceName || d.headline, description: d.description || undefined,
    serviceType: d.serviceType || undefined,
    provider: { '@type': 'Organization', name: d.name, url: d.url },
    areaServed: splitList(d.areaServed).map((n) => ({ '@type': 'City', name: n })),
  }),
};

export function buildSchema(type, data) {
  const builder = SCHEMA_BUILDERS[type];
  if (!builder) throw new Error(`Unknown schema type: ${type}`);
  const obj = prune(builder(data));
  return { type, json: obj, script: `<script type="application/ld+json">\n${JSON.stringify(obj, null, 2)}\n</script>`, warnings: validateSchema(type, obj) };
}

export function schemaTypes() { return Object.keys(SCHEMA_BUILDERS); }

const REQUIRED = {
  Product: ['name'],
  Event: ['name', 'startDate', 'location'],
  Recipe: ['name', 'recipeIngredient', 'recipeInstructions'],
  SoftwareApplication: ['name', 'offers'],
  LegalService: ['name', 'address', 'telephone'],
  LocalBusiness: ['name', 'address', 'telephone'],
  Organization: ['name', 'url'],
  FAQPage: ['mainEntity'],
  Article: ['headline', 'author'],
  Person: ['name'],
  BreadcrumbList: ['itemListElement'],
  Service: ['name', 'provider'],
};

/** Structural validation only — the real test is the Rich Results Test plus the GSC enhancement report. */
export function validateSchema(type, obj) {
  const w = [];
  for (const key of REQUIRED[type] || []) {
    const v = obj[key];
    if (v === undefined || v === null || (Array.isArray(v) && !v.length)) {
      w.push({ level: 'error', message: `Missing "${key}" — required for a ${type} rich result.` });
    }
  }
  if (type === 'FAQPage' && (obj.mainEntity || []).length < 2) {
    w.push({ level: 'warning', message: 'FAQPage needs at least two questions to be worth marking up, and every question and answer must be visible on the page.' });
  }
  if (type === 'Article' && !obj.dateModified) {
    w.push({ level: 'warning', message: 'No dateModified. Add it and keep it honest — a date that always says today teaches Google to ignore it.' });
  }
  if (type === 'Product' && !obj.offers) {
    w.push({ level: 'warning', message: 'No offers block. Product markup without a price rarely earns a rich result — and if you add one, it must match the price shown on the page or Google drops the enhancement.' });
  }
  if (type === 'Product' && obj.aggregateRating && !obj.review) {
    w.push({ level: 'warning', message: 'aggregateRating with no review data. Only mark up ratings that are visible on the page and genuinely collected — invented ratings are a manual-action risk.' });
  }
  if (type === 'Event' && obj.location?.['@type'] === 'Place' && !obj.location.address?.streetAddress) {
    w.push({ level: 'error', message: 'A physical Event needs a full postal address in location.address, not just a venue name.' });
  }
  if (['LegalService', 'LocalBusiness'].includes(type) && !obj.openingHoursSpecification?.length) {
    w.push({ level: 'warning', message: 'No opening hours. Not required, but it must match Google Business Profile exactly where both exist.' });
  }
  w.push({ level: 'note', message: 'Structured data must describe content visible on the page. Marking up an FAQ that users cannot see is a policy violation and gets the rich result withdrawn.' });
  return w;
}

/* ─────────────────────────── internal link opportunities ───────────────────── */

/**
 * Phase 3 in executable form: find pages that already discuss a target's topic
 * and do not link to it. The only ranking lever that needs nobody's permission.
 */
export function linkOpportunities(pages, { targetUrl, terms = [], maxPerTarget = 15 } = {}) {
  const target = pages.find((p) => p.url === targetUrl);
  if (!target) throw new Error(`${targetUrl} is not in the crawl.`);

  const phrases = (terms.length ? terms : deriveTerms(target)).map((t) => t.toLowerCase()).filter((t) => t.length > 4);
  const already = new Set((target.inboundLinks || []).map((l) => l.from));

  const out = [];
  for (const p of pages) {
    if (p.url === targetUrl || already.has(p.url) || p.status !== 200 || p.noindex) continue;
    const body = (p.bodyText || '').toLowerCase();
    const hits = phrases.filter((t) => body.includes(t));
    if (!hits.length) continue;
    const sentence = findSentence(p.bodyText || '', hits[0]);
    out.push({
      from: p.url, fromTitle: p.title,
      to: targetUrl, toTitle: target.title,
      matchedTerms: hits.slice(0, 4),
      suggestedAnchor: hits.sort((a, b) => b.length - a.length)[0],
      context: sentence,
      score: hits.length + (p.inboundCount > 3 ? 1 : 0),
    });
  }
  return {
    target: { url: targetUrl, title: target.title, currentInbound: target.inboundCount || 0, bodyInbound: target.inboundBodyCount || 0 },
    terms: phrases,
    opportunities: out.sort((a, b) => b.score - a.score).slice(0, maxPerTarget),
  };
}

/** Every page's link position at once, so you can see where the internal graph is thin. */
export function linkGraphReport(pages) {
  return pages
    .filter((p) => p.status === 200 && !p.noindex && /text\/html/i.test(p.contentType || ''))
    .map((p) => ({
      url: p.url, title: p.title, depth: p.depth,
      inbound: p.inboundCount || 0, inboundBody: p.inboundBodyCount || 0,
      outbound: (p.links || []).filter((l) => l.resolved).length,
      anchors: [...new Set((p.inboundLinks || []).map((l) => l.anchor).filter(Boolean))].slice(0, 6),
      words: p.wordCount,
    }))
    .sort((a, b) => a.inboundBody - b.inboundBody || b.depth - a.depth);
}

/* ─────────────────────────────── redirect mapping ─────────────────────────── */

/**
 * Migration redirect map. The playbook is blunt about why this matters:
 * migrations are the single most common cause of catastrophic traffic loss.
 */
export function buildRedirectMap(oldUrls, newPages, { origin = '' } = {}) {
  const candidates = newPages
    .filter((p) => p.status === 200 && !p.noindex)
    .map((p) => ({ url: p.url, tokens: pathTokens(p.url), title: (p.title || '').toLowerCase(), h1: (p.h1s?.[0] || '').toLowerCase() }));

  return oldUrls.map((raw) => {
    const oldUrl = raw.trim();
    if (!oldUrl) return null;
    const oldTokens = pathTokens(oldUrl);
    const scored = candidates
      .map((c) => {
        const slug = jac(oldTokens, c.tokens);
        const title = oldTokens.length ? oldTokens.filter((t) => c.title.includes(t) || c.h1.includes(t)).length / oldTokens.length : 0;
        return { url: c.url, score: slug * 0.7 + title * 0.3 };
      })
      .sort((a, b) => b.score - a.score);

    const best = scored[0];
    const confidence = !best || best.score < 0.25 ? 'none' : best.score > 0.7 ? 'high' : best.score > 0.45 ? 'medium' : 'low';
    return {
      from: oldUrl,
      to: confidence === 'none' ? '' : best.url,
      score: best ? Math.round(best.score * 100) : 0,
      confidence,
      alternatives: scored.slice(1, 4).filter((s) => s.score > 0.3).map((s) => ({ url: s.url, score: Math.round(s.score * 100) })),
      action: confidence === 'none'
        ? 'No match found. Choose the closest equivalent manually — do not default to the homepage, which produces a soft 404.'
        : confidence === 'high' ? 'Ship as-is.' : 'Review before shipping.',
    };
  }).filter(Boolean);
}

export function redirectsToFormat(map, format, { origin = '' } = {}) {
  const rows = map.filter((r) => r.to);
  const path = (u) => { try { return new URL(u, origin || 'https://x.test').pathname; } catch { return u; } };

  switch (format) {
    case 'htaccess':
      return ['# Generated by SEO Workbench — verify each line before deploying.',
        '# One hop, 301, no chains. Place above any existing rewrite block.',
        '<IfModule mod_rewrite.c>', 'RewriteEngine On',
        ...rows.map((r) => `RewriteRule ^${path(r.from).replace(/^\//, '').replace(/\/$/, '')}/?$ ${r.to} [R=301,L]`),
        '</IfModule>'].join('\n');
    case 'nginx':
      return ['# Generated by SEO Workbench — verify each line before deploying.',
        ...rows.map((r) => `rewrite ^${path(r.from)}/?$ ${r.to} permanent;`)].join('\n');
    case 'redirection-csv':
      return ['source,target,type,code', ...rows.map((r) => `"${path(r.from)}","${r.to}",url,301`)].join('\n');
    case 'json':
      return JSON.stringify(rows.map((r) => ({ source: path(r.from), target: r.to, code: 301 })), null, 2);
    case 'csv':
    default:
      return ['old_url,new_url,confidence,score,action',
        ...map.map((r) => `"${r.from}","${r.to}",${r.confidence},${r.score},"${r.action}"`)].join('\n');
  }
}

/** Test a redirect map against the live site — one hop, 200, no chains. */
export async function testRedirects(pairs, fetchChain) {
  const out = [];
  for (const p of pairs) {
    const res = await fetchChain(p.from, { ua: 'googlebot' });
    const expected = p.to ? normaliseUrl(p.to, p.from) : null;
    out.push({
      from: p.from,
      expected: p.to || null,
      landed: res.url,
      status: res.status,
      hops: res.chain.length,
      chain: res.chain.map((c) => `${c.status} → ${c.to}`),
      ok: res.status === 200 && res.chain.length === 1 && (!expected || res.url === expected),
      issue: res.status !== 200 ? `Lands on HTTP ${res.status}`
        : res.chain.length === 0 ? 'No redirect fired — the old URL still resolves directly'
        : res.chain.length > 1 ? `${res.chain.length} hops — collapse to one`
        : expected && res.url !== expected ? `Lands on ${res.url}, not the mapped target`
        : null,
    });
    await new Promise((r) => setTimeout(r, 100));
  }
  return out;
}

/* ────────────────────────── robots.txt and sitemap ────────────────────────── */

export function generateRobots({ origin, sitemapUrl, blockStaging = false, platform = 'generic', extraDisallow = [] }) {
  const lines = ['User-agent: *'];
  if (blockStaging) {
    lines.push('Disallow: /');
    lines.push('', '# Staging only. This must NOT reach production.',
      '# Note: blocking a URL here means Google never reads a noindex on it.',
      '# To deindex pages, allow the crawl and use noindex instead.');
  } else {
    if (platform === 'wordpress') {
      lines.push('Disallow: /wp-admin/', 'Allow: /wp-admin/admin-ajax.php');
      lines.push('', '# wp-content and wp-includes stay crawlable so Google can render the page.');
    }
    extraDisallow.filter(Boolean).forEach((d) => lines.push(`Disallow: ${d}`));
    lines.push('', `Sitemap: ${sitemapUrl || `${origin}/sitemap.xml`}`);
  }
  return lines.join('\n');
}

export function generateSitemap(pages, { includeLastmod = true } = {}) {
  const eligible = pages.filter((p) => p.status === 200 && !p.noindex && p.robotsAllowed !== false &&
    (!p.canonical || p.canonical === p.url) && /text\/html/i.test(p.contentType || ''));
  const body = eligible.map((p) => [
    '  <url>',
    `    <loc>${esc(p.url)}</loc>`,
    includeLastmod && p.headers?.['last-modified'] ? `    <lastmod>${new Date(p.headers['last-modified']).toISOString().slice(0, 10)}</lastmod>` : null,
    '  </url>',
  ].filter(Boolean).join('\n')).join('\n');
  return {
    xml: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>`,
    count: eligible.length,
    excluded: pages.length - eligible.length,
    note: 'Only canonical, indexable, 200-returning URLs are included. Omitting lastmod is better than inventing one.',
  };
}

/* ──────────────────────────────── content brief ───────────────────────────── */

export function contentBrief({ cluster, questions = [], competitorHeadings = [], intent, targetUrl, businessGoal }) {
  return {
    cluster,
    targetUrl: targetUrl || '(new page)',
    intent: intent || 'unclear',
    businessGoal: businessGoal || null,
    serpCheck: 'Before writing: read the current SERP for this query. Note the content type, format, and angle of the top ten. If they are guides and you are planning a service page, change the plan — no amount of on-page work overcomes an intent mismatch.',
    title: `${titleCase(cluster)} — [specific promise]`,
    h1: titleCase(cluster),
    sections: [
      { h2: `What ${cluster} means`, note: 'Answer-first: open with a direct two-to-three sentence answer, then expand. This one piece of work serves skimmers, featured snippets, and AI extraction.' },
      ...questions.slice(0, 6).map((q) => ({ h2: titleCase(q), note: 'Lead with the direct answer in the first two sentences.' })),
      ...competitorHeadings.slice(0, 4).map((h) => ({ h2: h, note: 'Covered by competitors — include only if genuinely relevant.' })),
      { h2: 'Next step', note: 'One clear action. Match it to the intent: transactional queries get a contact path, informational queries get the next article.' },
    ],
    internalLinks: 'Link to the pillar page for this cluster and to two or three sibling pages, with anchors describing the destination.',
    eeat: 'YMYL topic: name the author, state their credentials, link to a bio page, and cite the statutes or sources the claims rest on. Unattributed content on legal or medical topics is demoted hard.',
    schema: intent === 'informational' ? 'Article + BreadcrumbList. Add FAQPage only if the questions are visible on the page.' : 'Product or Service + BreadcrumbList, plus the sitewide Organization node.',
    doNotMeasure: 'Word count and keyword density are not targets. Cover the subtopics the query implies and stop.',
  };
}

/* ───────────────────────────── tickets and exports ────────────────────────── */

/** Azure DevOps work-item CSV — the format that imports without cleanup. */
export function findingsToAzureCsv(findings, { areaPath = '', iteration = '', tag = 'SEO' } = {}) {
  const head = ['Work Item Type', 'Title', 'Description', 'Priority', 'Tags', 'Area Path', 'Iteration Path', 'Assigned To'];
  const pri = { Critical: 1, High: 2, Medium: 3, Low: 4 };
  const rows = findings.map((f) => {
    const desc = [
      `<b>Where:</b><br/>${escHtml(f.where)}`,
      `<b>What:</b><br/>${escHtml(f.what)}`,
      `<b>Why it matters:</b><br/>${escHtml(f.why)}`,
      `<b>Fix:</b><br/>${escHtml(f.fix)}`,
      `<b>Acceptance criteria:</b><br/>${escHtml(acceptance(f))}`,
      f.urls?.length ? `<b>Affected URLs (${f.urls.length}):</b><br/>${f.urls.slice(0, 25).map(escHtml).join('<br/>')}` : '',
    ].filter(Boolean).join('<br/><br/>');
    return [
      'Task', `[SEO/${f.severity}] ${f.title}`, desc, pri[f.severity] || 3,
      `${tag};${f.owner};${f.phase}`, areaPath, iteration, '',
    ];
  });
  return [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\n');
}

function acceptance(f) {
  const base = {
    'noindex-present': 'No noindex directive in the HTML or the X-Robots-Tag header on any listed URL; URL Inspection reports the page as indexable.',
    'robots-disallow-all': 'robots.txt returns 200 with no `Disallow: /` for any user-agent group; the GSC robots.txt report shows the updated file.',
    'broken-links': 'Every listed URL returns 200 or 301-in-one-hop to a 200; no internal link points at a 4xx.',
    'redirect-chains': 'Every listed URL reaches its destination in exactly one hop.',
    'canonical-missing': 'Every indexable page emits exactly one self-referencing absolute rel=canonical.',
    'title-duplicate': 'No two indexable URLs share a title tag.',
    'h1-missing': 'Every listed URL renders exactly one h1 element.',
    'lazy-above-fold': 'The LCP image on each listed template has loading="eager" and fetchpriority="high"; PSI reports no lazy-loaded LCP.',
    'img-dimensions': 'Every img element has width and height attributes or a CSS aspect-ratio; CLS in the lab run is under 0.1.',
  }[f.id];
  return base || `The condition described under "What" is no longer true on any listed URL, verified by re-running the crawl in SEO Workbench.`;
}

export function findingsToCsv(findings) {
  const head = ['Severity', 'Phase', 'Owner', 'Effort', 'Title', 'Where', 'What', 'Why', 'Fix', 'Affected URLs'];
  const rows = findings.map((f) => [f.severity, f.phase, f.owner, f.effort, f.title, f.where, f.what, f.why, f.fix, (f.urls || []).join(' | ')]);
  return [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\n');
}

export function crawlToCsv(pages) {
  const head = ['URL', 'Status', 'Hops', 'Depth', 'Indexable', 'Title', 'Title px', 'Meta description', 'H1', 'H1 count',
    'Words', 'Canonical', 'Self-canonical', 'Inbound links', 'Inbound body links', 'Schema types', 'Images missing alt', 'Response ms'];
  const rows = pages.map((p) => [
    p.url, p.status, p.hops ?? 0, p.depth ?? '', p.status === 200 && !p.noindex && p.robotsAllowed !== false ? 'yes' : 'no',
    p.title || '', p.title ? pixelWidth(p.title) : '', p.metaDescription || '', p.h1s?.[0] || '', p.h1s?.length ?? 0,
    p.wordCount ?? '', p.canonical || '', p.selfCanonical ? 'yes' : 'no', p.inboundCount ?? '', p.inboundBodyCount ?? '',
    (p.schemaTypes || []).join(' '), (p.images || []).filter((i) => !i.hasAltAttr || !String(i.alt).trim()).length, p.responseMs ?? '',
  ]);
  return [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\n');
}

/* ─────────────────────────────────── helpers ──────────────────────────────── */

function fitToPixels(str, maxPx, suffix = '') {
  if (pixelWidth(str) <= maxPx) return str;
  const suffixPx = pixelWidth(suffix);
  let core = suffix ? str.slice(0, str.length - suffix.length) : str;
  while (pixelWidth(core) + suffixPx > maxPx && core.length > 10) core = core.slice(0, -1);
  return `${core.replace(/[\s|–—-]+$/, '')}${suffix}`;
}
function firstSentences(text, n) {
  const s = String(text).replace(/\s+/g, ' ').match(/[^.!?]+[.!?]+/g) || [];
  return s.slice(0, n).join(' ').trim().slice(0, 200);
}
function slugToWords(url) {
  try {
    const seg = new URL(url).pathname.split('/').filter(Boolean).pop() || 'Home';
    return titleCase(seg.replace(/[-_]+/g, ' ').replace(/\.\w+$/, ''));
  } catch { return 'Page'; }
}
function pathTokens(u) {
  try {
    const p = new URL(u, 'https://x.test').pathname;
    return p.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2 && !['www', 'com', 'html', 'php', 'index', 'page'].includes(t));
  } catch { return []; }
}
function jac(a, b) {
  if (!a.length || !b.length) return 0;
  const sa = new Set(a), sb = new Set(b);
  let i = 0;
  for (const x of sa) if (sb.has(x)) i++;
  return i / (sa.size + sb.size - i);
}
function deriveTerms(page) {
  const src = `${page.title || ''} ${(page.h1s || []).join(' ')}`.toLowerCase();
  const words = src.replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 3);
  const out = new Set();
  for (let i = 0; i < words.length - 1; i++) out.add(`${words[i]} ${words[i + 1]}`);
  words.filter((w) => w.length > 6).forEach((w) => out.add(w));
  return [...out];
}
function findSentence(text, term) {
  const s = String(text).replace(/\s+/g, ' ').match(/[^.!?]+[.!?]+/g) || [];
  const hit = s.find((x) => x.toLowerCase().includes(term));
  return hit ? hit.trim().slice(0, 220) : null;
}
function addr(d) {
  if (!d.street && !d.city) return undefined;
  return { '@type': 'PostalAddress', streetAddress: d.street, addressLocality: d.city, addressRegion: d.region, postalCode: d.postalCode, addressCountry: d.country || 'US' };
}
function hours(str) {
  if (!str) return undefined;
  return String(str).split('\n').map((line) => {
    const m = line.match(/^\s*([A-Za-z,\s]+?)\s+(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/);
    if (!m) return null;
    return { '@type': 'OpeningHoursSpecification', dayOfWeek: m[1].split(/[,\s]+/).filter(Boolean), opens: m[2], closes: m[3] };
  }).filter(Boolean);
}
const splitList = (s) => (Array.isArray(s) ? s : String(s || '').split(/[,\n]/)).map((x) => String(x).trim()).filter(Boolean);
function prune(o) {
  if (Array.isArray(o)) { const a = o.map(prune).filter((x) => x !== undefined && x !== null && x !== ''); return a.length ? a : undefined; }
  if (o && typeof o === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(o)) { const p = prune(v); if (p !== undefined && p !== null && p !== '') out[k] = p; }
    return Object.keys(out).length ? out : undefined;
  }
  return o;
}
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const titleCase = (s) => String(s).replace(/\b\w/g, (c) => c.toUpperCase());
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br/>');
const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
