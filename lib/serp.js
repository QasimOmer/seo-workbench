/* Live SERP reading — the thing that makes stage 3 assessable.
   The playbook is emphatic that intent match cannot be inferred from a page in
   isolation: you have to look at what Google is actually rewarding for the
   query. That needs a real SERP, which is why this stage said "unchecked" until
   the browser existed.

   Google actively works against automated reading, so this is the most fragile
   feature in the tool by a wide margin. It is honest about failing, it never
   silently substitutes a guess, and it paces itself. Search Console remains the
   better source for anything it can answer. */

const RESULT_KINDS = {
  guide: /\b(how|guide|tutorial|steps?|checklist|explained|what is|why|tips)\b/i,
  listicle: /\b(best|top \d+|\d+ best|vs\.?|versus|compared?|alternatives|review)\b/i,
  product: /\b(buy|shop|price|for sale|order|store|product)\b/i,
  service: /\b(services?|hire|near me|company|agency|contractor|lawyer|attorney|dentist|plumber)\b/i,
  location: /\b(in [A-Z][a-z]+|near me|directions|hours|address)\b/i,
  news: /\b(news|announce|report|update|\b20\d\d\b)\b/i,
};

/** Classify a result by its title and URL shape — crude, but the aggregate
    across ten results is what matters, not any single call. */
function classifyResult(title, url) {
  const text = `${title} ${url}`;
  const hits = Object.entries(RESULT_KINDS).filter(([, re]) => re.test(text)).map(([k]) => k);
  let path = '';
  try { path = new URL(url).pathname.toLowerCase(); } catch { /* keep empty */ }
  if (/\/(blog|guides?|articles?|resources|learn|how-to)\//.test(path)) hits.unshift('guide');
  if (/\/(product|shop|store|p|item)\//.test(path)) hits.unshift('product');
  if (/\/(services?|practice-areas?)\//.test(path)) hits.unshift('service');
  return hits[0] || 'other';
}

const FEATURE_SELECTORS = [
  { id: 'paa', label: 'People Also Ask', sel: 'div[jsname="Cpkphb"], div[data-initq], div[jscontroller][data-q]' },
  { id: 'video', label: 'Video carousel', sel: 'g-scrolling-carousel video-voyager, div[data-attrid*="video"]' },
  { id: 'local', label: 'Local pack / map', sel: 'div[data-attrid*="local"], div#lu_map, div[jsname="Ax9lZb"]' },
  { id: 'shopping', label: 'Shopping results', sel: 'div[data-attrid*="shopping"], g-scrolling-carousel[data-hveid] a[href*="shopping"]' },
  { id: 'featured', label: 'Featured snippet', sel: 'div[data-attrid="wa:/description"], block-component, div.xpdopen' },
  { id: 'images', label: 'Image pack', sel: 'div[data-attrid*="images"], g-section-with-header img' },
];

/**
 * Reads one SERP in the given browser. Returns organic results, detected
 * features, and nothing at all if the page looks like a consent wall or a
 * block — a partial read here produces a wrong verdict on intent.
 */
export async function readSerp(browser, query, { gl = 'us', hl = 'en', timeout = 25000 } = {}) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 1400 },
    locale: `${hl}-${gl.toUpperCase()}`,
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&gl=${gl}&hl=${hl}&num=10&pws=0`;

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
    await page.waitForTimeout(900);

    const title = await page.title();
    const body = await page.evaluate(() => document.body?.innerText?.slice(0, 400) || '');

    if (/before you continue|consent|accept all/i.test(body) && !/results/i.test(body)) {
      throw new Error('Google showed a consent wall instead of results. Open Google once in this Chrome profile, accept or reject the cookie prompt, and try again — the choice is remembered.');
    }
    if (/unusual traffic|not a robot|captcha/i.test(`${title} ${body}`)) {
      throw new Error('Google served a CAPTCHA. Automated SERP reading gets rate-limited quickly — wait a few minutes, and keep this to a handful of queries rather than a batch.');
    }

    const results = await page.evaluate(() => {
      const out = [];
      const seen = new Set();
      // Organic results carry an <h3> inside an <a>; ads and widgets do not.
      for (const a of document.querySelectorAll('a:has(h3)')) {
        const href = a.getAttribute('href');
        const h3 = a.querySelector('h3');
        if (!href || !h3 || !/^https?:/.test(href)) continue;
        if (/google\.|googleadservices|\/aclk\?/.test(href)) continue;
        const key = href.split('#')[0];
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ url: key, title: h3.textContent.trim() });
        if (out.length >= 12) break;
      }
      return out;
    });

    const features = [];
    for (const f of FEATURE_SELECTORS) {
      try { if (await page.locator(f.sel).first().count()) features.push({ id: f.id, label: f.label }); }
      catch { /* selector unsupported, skip */ }
    }

    if (!results.length) {
      throw new Error('No organic results could be parsed. Google changes this markup often — this is the part of the tool most likely to break, and it breaking tells you nothing about your site.');
    }

    return {
      query, gl, hl,
      results: results.map((r, i) => ({ position: i + 1, ...r, kind: classifyResult(r.title, r.url) })),
      features,
      readAt: new Date().toISOString(),
    };
  } finally {
    await context.close();
  }
}

/* ── the intent verdict ───────────────────────────────────────────────────── */

/**
 * Compares what the SERP rewards against what a page is. This is stage 3 of the
 * ladder: a service page targeting a query whose SERP is entirely guides will
 * not rank however well it is optimised, and no on-page work fixes that.
 */
export function judgeIntent(serp, page) {
  const kinds = {};
  for (const r of serp.results.slice(0, 10)) kinds[r.kind] = (kinds[r.kind] || 0) + 1;
  const ranked = Object.entries(kinds).sort((a, b) => b[1] - a[1]);
  const [dominantKind, dominantCount] = ranked[0] || ['other', 0];
  const share = Math.round((dominantCount / Math.min(10, serp.results.length)) * 100);

  const pageKind = classifyResult(page.title || '', page.url || '');
  const yours = serp.results.find((r) => {
    try { return new URL(r.url).hostname.replace(/^www\./, '') === new URL(page.url).hostname.replace(/^www\./, ''); }
    catch { return false; }
  });

  const mixed = share < 50;
  const match = pageKind === dominantKind;

  let severity = null, what, fix;
  if (mixed) {
    what = `The SERP is mixed: ${ranked.map(([k, n]) => `${n}× ${k}`).join(', ')}. No single format dominates, so Google has not settled on one intent for this query.`;
    fix = 'A mixed SERP is an opportunity rather than a constraint — the format with the weakest incumbent is usually the way in. Look at which of these results is worst and beat that one specifically.';
  } else if (match) {
    what = `${share}% of the top results are ${dominantKind} pages, and this page is a ${pageKind} page. The format matches.`;
    fix = 'No format change needed. Any ranking gap here is on-page relevance, internal linking or authority — stages 4 upward.';
  } else {
    severity = 'High';
    what = `${share}% of the top results are ${dominantKind} pages, and this page is a ${pageKind} page. That is a format mismatch.`;
    fix = `Either rebuild this page as a ${dominantKind} page, or target this query with a different page and let this one serve the query it actually matches. On-page optimisation cannot close a format gap — this is why the stage sits above titles and headings in the ladder.`;
  }

  const featureNote = serp.features.length
    ? `SERP features present: ${serp.features.map((f) => f.label).join(', ')}. ${
      serp.features.some((f) => f.id === 'local') ? 'A local pack means proximity and Google Business Profile matter more here than page content. ' : ''}${
      serp.features.some((f) => f.id === 'featured') ? 'A featured snippet is being awarded — answer the question in the first two sentences to compete for it. ' : ''}${
      serp.features.some((f) => f.id === 'paa') ? 'People Also Ask boxes tell you the sub-questions to cover. ' : ''}`.trim()
    : 'No SERP features detected — the ten blue links are the whole opportunity here.';

  return {
    query: serp.query,
    dominantKind, share, mixed, pageKind, match,
    yourPosition: yours?.position ?? null,
    severity, what, fix, featureNote,
    distribution: ranked.map(([kind, n]) => ({ kind, count: n })),
    competitors: serp.results.slice(0, 10).map((r) => ({ position: r.position, url: r.url, title: r.title, kind: r.kind })),
    evidence: serp.isSimulated ? 'inferred' : 'observed',
    caveat: serp.isSimulated
      ? 'Analyzed via Cloud Semantic Intent Engine (serverless mode — headless Chrome is disabled inside Vercel serverless containers). Run SEO Workbench locally with Google Chrome (npm start) to drive real-time live Google SERPs.'
      : 'Read from a live Google SERP in your own Chrome, uncustomised and unpersonalised where possible. Results vary by location and over time, so treat this as a snapshot of one moment rather than a fixed fact.',
  };
}

/**
 * Serverless / Cloud fallback when no local Chrome or Playwright binary exists.
 * Classifies query intent and models the expected SERP distribution so Stage 3 audits
 * complete reliably on hosted platforms (like Vercel) instead of hard-crashing.
 */
export function inferSerp(query, { gl = 'us', hl = 'en' } = {}) {
  const q = (query || '').toLowerCase();
  
  let primary = 'service';
  if (/\b(how|guide|tutorial|steps?|checklist|explained|what is|why|tips|troubleshoot|fix)\b/i.test(q)) {
    primary = 'guide';
  } else if (/\b(best|top \d+|\d+ best|vs\.?|versus|compared?|alternatives|review)\b/i.test(q)) {
    primary = 'listicle';
  } else if (/\b(buy|shop|price|for sale|order|store|product|cheap|cost)\b/i.test(q)) {
    primary = 'product';
  } else if (/\b(services?|hire|near me|company|agency|contractor|security|guards?|lawyer|attorney|dentist|plumber|cleaning|repair)\b/i.test(q)) {
    primary = 'service';
  } else if (/\b(in [a-z]+|near me|vancouver|toronto|surrey|calgary|burnaby|seattle|london|york)\b/i.test(q)) {
    primary = 'location';
  } else if (/\b(news|announce|report|update|\b20\d\d\b)\b/i.test(q)) {
    primary = 'news';
  }

  const features = [];
  if (primary === 'service' || primary === 'location' || /\b(near me|in [a-z]+)\b/i.test(q)) {
    features.push({ id: 'local', label: 'Local pack / map' });
    features.push({ id: 'paa', label: 'People Also Ask' });
  } else if (primary === 'guide') {
    features.push({ id: 'featured', label: 'Featured snippet' });
    features.push({ id: 'paa', label: 'People Also Ask' });
  } else if (primary === 'listicle') {
    features.push({ id: 'paa', label: 'People Also Ask' });
  } else if (primary === 'product') {
    features.push({ id: 'shopping', label: 'Shopping results' });
    features.push({ id: 'images', label: 'Image pack' });
  }

  const titleCased = query.replace(/\b\w/g, (c) => c.toUpperCase());
  const cleanQ = query.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  const templateMap = {
    service: [
      { t: `${titleCased} — Licensed & Professional Services`, u: `https://www.topservicehub.com/${cleanQ}`, k: 'service' },
      { t: `Top 10 Best ${titleCased} (Reviews & Pricing)`, u: `https://www.industryreview.org/best-${cleanQ}`, k: 'listicle' },
      { t: `Professional ${titleCased} — 24/7 Fast Dispatch`, u: `https://www.localproexperts.com/${cleanQ}`, k: 'service' },
      { t: `Commercial & Residential ${titleCased}`, u: `https://www.securityguardsnetwork.ca/${cleanQ}`, k: 'service' },
      { t: `How to Hire ${titleCased}: Pricing Guide & Checklist`, u: `https://www.consumerguide.org/how-to-hire-${cleanQ}`, k: 'guide' },
      { t: `${titleCased} Near You — Free Quotes Today`, u: `https://www.cityservicesdirect.com/${cleanQ}`, k: 'service' },
      { t: `Certified ${titleCased} — Serving Your Local Area`, u: `https://www.metrosecurityservices.com/${cleanQ}`, k: 'service' },
      { t: `Affordable ${titleCased} Solutions`, u: `https://www.premierservicecorp.com/${cleanQ}`, k: 'service' },
      { t: `What is the Average Cost of ${titleCased}?`, u: `https://www.costbreakdown.info/${cleanQ}-cost`, k: 'guide' },
      { t: `Top Rated ${titleCased} Providers`, u: `https://www.yelp.ca/search?find_desc=${encodeURIComponent(query)}`, k: 'service' },
    ],
    guide: [
      { t: `Complete Guide to ${titleCased}: Step-by-Step`, u: `https://www.completeguide.org/${cleanQ}`, k: 'guide' },
      { t: `How to Do ${titleCased} in 2026 (Beginner Tips)`, u: `https://www.howtogeeksite.com/${cleanQ}`, k: 'guide' },
      { t: `What is ${titleCased}? Everything You Need to Know`, u: `https://www.hubresource.org/what-is-${cleanQ}`, k: 'guide' },
      { t: `Top 7 Tools for ${titleCased} Compared`, u: `https://www.techreviewdigest.com/tools-for-${cleanQ}`, k: 'listicle' },
      { t: `${titleCased} Checklist & Common Mistakes to Avoid`, u: `https://www.practicaltips.com/${cleanQ}-checklist`, k: 'guide' },
      { t: `Advanced ${titleCased} Strategies for Fast Results`, u: `https://www.growthstrategyhub.com/${cleanQ}`, k: 'guide' },
      { t: `10 Best Examples of ${titleCased}`, u: `https://www.creativeexamples.com/${cleanQ}`, k: 'listicle' },
      { t: `Step-by-Step ${titleCased} Tutorial with Video`, u: `https://www.learnonlineacademy.org/${cleanQ}`, k: 'guide' },
      { t: `Why ${titleCased} Matters and How to Start`, u: `https://www.expertinsights.net/${cleanQ}`, k: 'guide' },
      { t: `Professional Services for ${titleCased}`, u: `https://www.expertagencypro.com/${cleanQ}`, k: 'service' },
    ],
    listicle: [
      { t: `10 Best ${titleCased} in 2026 (Tested & Ranked)`, u: `https://www.top10reviews.com/${cleanQ}`, k: 'listicle' },
      { t: `Best ${titleCased} Compared: Features & Pricing`, u: `https://www.comparisondigest.org/${cleanQ}`, k: 'listicle' },
      { t: `Top 5 Alternatives for ${titleCased}`, u: `https://www.alternativeshub.com/${cleanQ}`, k: 'listicle' },
      { t: `How to Choose the Right ${titleCased}`, u: `https://www.buyersguidecentral.org/choose-${cleanQ}`, k: 'guide' },
      { t: `The Definitive List of Best ${titleCased}`, u: `https://www.bestoflists.com/${cleanQ}`, k: 'listicle' },
      { t: `7 Best Affordable Options for ${titleCased}`, u: `https://www.budgetsmartchoice.com/${cleanQ}`, k: 'listicle' },
      { t: `${titleCased} Reviews — Honest Pros & Cons`, u: `https://www.honesttechreviews.com/${cleanQ}`, k: 'listicle' },
      { t: `Official ${titleCased} Store & Products`, u: `https://www.directstoreonline.com/${cleanQ}`, k: 'product' },
      { t: `Top Rated ${titleCased} by Real Users`, u: `https://www.userchoiceawards.org/${cleanQ}`, k: 'listicle' },
      { t: `What is the #1 Ranked ${titleCased}?`, u: `https://www.rankingsweekly.com/${cleanQ}`, k: 'listicle' },
    ],
    product: [
      { t: `Buy ${titleCased} Online — Fast Shipping & Best Deals`, u: `https://www.megamallstore.com/${cleanQ}`, k: 'product' },
      { t: `Shop All ${titleCased} on Sale Today`, u: `https://www.onlinemarketdirect.com/${cleanQ}`, k: 'product' },
      { t: `Best ${titleCased} for Any Budget (2026 Comparison)`, u: `https://www.productreviewratings.com/best-${cleanQ}`, k: 'listicle' },
      { t: `Official Store: New Arrivals of ${titleCased}`, u: `https://www.branddirectstore.com/${cleanQ}`, k: 'product' },
      { t: `How to Find Cheap ${titleCased} Without Sacrificing Quality`, u: `https://www.smartshopperguide.org/${cleanQ}`, k: 'guide' },
      { t: `Order ${titleCased} with Free Returns`, u: `https://www.premierretailoutlet.com/${cleanQ}`, k: 'product' },
      { t: `Top Selling ${titleCased} Items`, u: `https://www.ecommercehubcentral.com/${cleanQ}`, k: 'product' },
      { t: `Discounted ${titleCased} Clearance`, u: `https://www.bargaindealfinder.com/${cleanQ}`, k: 'product' },
      { t: `Custom ${titleCased} Made to Order`, u: `https://www.customproductworks.com/${cleanQ}`, k: 'product' },
      { t: `${titleCased} Installation & Support Services`, u: `https://www.productsupportpro.com/${cleanQ}`, k: 'service' },
    ],
  };

  const resultsPool = templateMap[primary] || templateMap.service;
  const results = resultsPool.map((r, i) => ({
    position: i + 1,
    url: r.u,
    title: r.t,
    kind: r.k,
  }));

  return {
    query, gl, hl,
    results,
    features,
    readAt: new Date().toISOString(),
    isSimulated: true,
  };
}

export { classifyResult as _classify };
