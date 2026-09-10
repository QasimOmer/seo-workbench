import * as cheerio from 'cheerio';
import crypto from 'node:crypto';

const BOILER = 'nav,header,footer,script,style,noscript,svg,form,aside,[role="navigation"],[role="banner"],[role="contentinfo"]';

export function normaliseUrl(raw, base) {
  try {
    const u = new URL(raw, base);
    u.hash = '';
    // strip common tracking params — they create phantom duplicates in a crawl
    const drop = ['utm_source','utm_medium','utm_campaign','utm_term','utm_content','gclid','fbclid','msclkid','mc_cid','mc_eid','_ga'];
    drop.forEach((p) => u.searchParams.delete(p));
    const qs = u.searchParams.toString();
    u.search = qs ? `?${qs}` : '';
    if (u.pathname !== '/' && u.pathname.endsWith('/index.html')) {
      u.pathname = u.pathname.replace(/index\.html$/, '');
    }
    return u.toString();
  } catch {
    return null;
  }
}

export function sameSite(a, b, { includeSubdomains = false } = {}) {
  try {
    const ua = new URL(a), ub = new URL(b);
    if (ua.hostname === ub.hostname) return true;
    if (!includeSubdomains) return false;
    const root = (h) => h.split('.').slice(-2).join('.');
    return root(ua.hostname) === root(ub.hostname);
  } catch { return false; }
}

const ABOVE_FOLD_GUESS = 3; // first N images treated as likely above the fold

export function parsePage(html, finalUrl, headers = {}) {
  const $ = cheerio.load(html);
  const out = {};

  out.title = ($('head title').first().text() || '').trim();
  out.titleCount = $('head title').length;
  out.metaDescription = ($('meta[name="description"]').attr('content') || '').trim();
  out.metaDescriptionCount = $('meta[name="description"]').length;
  out.lang = $('html').attr('lang') || null;
  out.viewport = $('meta[name="viewport"]').attr('content') || null;
  out.charset = $('meta[charset]').attr('charset') || null;

  // ---- robots directives, both meta and header
  const metaRobots = [];
  $('meta[name]').each((_, el) => {
    const name = ($(el).attr('name') || '').toLowerCase();
    if (name === 'robots' || name === 'googlebot') {
      metaRobots.push({ name, content: ($(el).attr('content') || '').toLowerCase().trim() });
    }
  });
  out.metaRobots = metaRobots;
  const xRobots = headers['x-robots-tag'] || '';
  out.xRobotsTag = xRobots || null;
  const allDirectives = [...metaRobots.map((m) => m.content), String(xRobots).toLowerCase()].join(',');
  out.noindex = /\bnoindex\b/.test(allDirectives);
  out.nofollowPage = /\bnofollow\b/.test(allDirectives);
  out.noarchive = /\bnoarchive\b/.test(allDirectives);

  // ---- canonical
  const canonicals = [];
  $('link[rel="canonical"]').each((_, el) => {
    const href = $(el).attr('href');
    if (href) canonicals.push(normaliseUrl(href, finalUrl));
  });
  if (headers.link && /rel=["']?canonical/i.test(headers.link)) {
    const m = headers.link.match(/<([^>]+)>\s*;\s*rel=["']?canonical/i);
    if (m) canonicals.push(normaliseUrl(m[1], finalUrl));
  }
  out.canonicals = canonicals.filter(Boolean);
  out.canonical = out.canonicals[0] || null;
  out.selfCanonical = out.canonical ? out.canonical === normaliseUrl(finalUrl, finalUrl) : false;

  // ---- headings
  out.headings = [];
  $('h1,h2,h3,h4,h5,h6').each((_, el) => {
    const level = Number(el.tagName.slice(1));
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    out.headings.push({ level, text });
  });
  out.h1s = out.headings.filter((h) => h.level === 1).map((h) => h.text);

  // heading nesting: flag any jump of more than one level going down
  out.headingSkips = [];
  let prev = null;
  for (const h of out.headings) {
    if (prev !== null && h.level > prev + 1) {
      out.headingSkips.push({ from: prev, to: h.level, text: h.text.slice(0, 80) });
    }
    prev = h.level;
  }

  // ---- links
  const links = [];
  $('a').each((_, el) => {
    const $el = $(el);
    const href = $el.attr('href');
    const rel = ($el.attr('rel') || '').toLowerCase();
    const anchor = ($el.text() || '').replace(/\s+/g, ' ').trim() ||
      ($el.find('img').attr('alt') || '').trim() ||
      ($el.attr('aria-label') || '').trim();
    if (!href) {
      links.push({ href: null, resolved: null, anchor, rel, noHref: true });
      return;
    }
    if (/^(mailto:|tel:|javascript:|#)/i.test(href)) {
      links.push({ href, resolved: null, anchor, rel, special: true });
      return;
    }
    links.push({
      href,
      resolved: normaliseUrl(href, finalUrl),
      anchor,
      rel,
      nofollow: /\bnofollow\b/.test(rel),
      inNav: $el.closest('nav,header,[role="navigation"]').length > 0,
      inFooter: $el.closest('footer,[role="contentinfo"]').length > 0,
    });
  });
  out.links = links;

  // ---- images
  out.images = [];
  $('img').each((i, el) => {
    const $el = $(el);
    const src = $el.attr('src') || $el.attr('data-src') || $el.attr('data-lazy-src') || '';
    out.images.push({
      src: src ? normaliseUrl(src, finalUrl) : null,
      rawSrc: src,
      alt: $el.attr('alt') ?? null,
      hasAltAttr: $el.attr('alt') !== undefined,
      width: $el.attr('width') || null,
      height: $el.attr('height') || null,
      loading: ($el.attr('loading') || '').toLowerCase() || null,
      index: i,
      likelyAboveFold: i < ABOVE_FOLD_GUESS,
      decorative: ($el.attr('role') || '') === 'presentation' || $el.attr('aria-hidden') === 'true',
    });
  });

  // ---- structured data
  out.jsonld = [];
  out.jsonldErrors = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const txt = $(el).contents().text();
    try {
      const parsed = JSON.parse(txt);
      (Array.isArray(parsed) ? parsed : [parsed]).forEach((o) => out.jsonld.push(o));
    } catch (e) {
      out.jsonldErrors.push(String(e.message).slice(0, 160));
    }
  });
  out.schemaTypes = [];
  const walkTypes = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walkTypes);
    if (node['@type']) {
      const t = node['@type'];
      (Array.isArray(t) ? t : [t]).forEach((x) => out.schemaTypes.push(String(x)));
    }
    if (node['@graph']) walkTypes(node['@graph']);
    Object.values(node).forEach((v) => { if (v && typeof v === 'object') walkTypes(v); });
  };
  out.jsonld.forEach(walkTypes);
  out.schemaTypes = [...new Set(out.schemaTypes)];
  out.microdataTypes = [...new Set($('[itemtype]').map((_, el) => String($(el).attr('itemtype')).split('/').pop()).get())];

  // ---- hreflang / pagination
  out.hreflang = $('link[rel="alternate"][hreflang]').map((_, el) => ({
    lang: $(el).attr('hreflang'), href: normaliseUrl($(el).attr('href'), finalUrl),
  })).get();
  out.prev = $('link[rel="prev"]').attr('href') || null;
  out.next = $('link[rel="next"]').attr('href') || null;

  // ---- open graph / social
  out.og = {
    title: $('meta[property="og:title"]').attr('content') || null,
    description: $('meta[property="og:description"]').attr('content') || null,
    image: $('meta[property="og:image"]').attr('content') || null,
    type: $('meta[property="og:type"]').attr('content') || null,
  };

  // ---- body content
  const $clone = cheerio.load(html);
  $clone(BOILER).remove();
  const mainEl = $clone('main,[role="main"],article,.entry-content,.site-main').first();
  const bodyText = (mainEl.length ? mainEl.text() : $clone('body').text())
    .replace(/\s+/g, ' ').trim();
  out.bodyText = bodyText;
  out.wordCount = bodyText ? bodyText.split(/\s+/).length : 0;
  out.contentHash = crypto.createHash('sha1')
    .update(bodyText.toLowerCase().replace(/[^a-z0-9 ]/g, '').slice(0, 20000))
    .digest('hex');

  // shingle fingerprint for near-duplicate detection
  out.shingles = shingleSet(bodyText);

  // ---- render dependency signals
  const rawTextLen = cheerio.load(html)('body').text().replace(/\s+/g, ' ').trim().length;
  out.rawBodyTextLength = rawTextLen;
  out.scriptCount = $('script').length;
  out.inlineScriptBytes = $('script:not([src])').toArray()
    .reduce((n, el) => n + ($(el).contents().text() || '').length, 0);
  out.hasNoscriptContent = $('noscript').text().trim().length > 200;
  out.rootDivEmpty = /<div[^>]+id=["'](root|app|__next)["'][^>]*>\s*<\/div>/i.test(html);

  // ---- mixed content
  out.insecureRefs = [];
  if (finalUrl.startsWith('https://')) {
    const re = /(?:src|href)\s*=\s*["'](http:\/\/[^"']+)["']/gi;
    let m;
    while ((m = re.exec(html)) && out.insecureRefs.length < 25) out.insecureRefs.push(m[1]);
  }

  // ---- breadcrumbs
  out.hasBreadcrumbMarkup = out.schemaTypes.includes('BreadcrumbList');
  out.hasBreadcrumbEl = $('[class*="breadcrumb" i],[id*="breadcrumb" i],nav[aria-label*="readcrumb" i]').length > 0;

  // ---- contact signals (NAP consistency, local SEO)
  out.phones = [...new Set((bodyText.match(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g) || [])
    .map((p) => p.replace(/\D/g, '').replace(/^1/, '')))].filter((p) => p.length === 10);
  out.hasAuthorMarkup = out.schemaTypes.includes('Person') ||
    $('[rel="author"],[class*="author" i],[itemprop="author"]').length > 0;

  // ---- platform fingerprint
  /* Extra signals for the checks in audit-extra.js. Captured here because the
     crawl is the only place they are available — re-fetching to get them later
     would double the crawl. */

  // A meta refresh is a redirect Google treats as a weak signal at best, and it
  // is invisible in the status code.
  const mr = /<meta[^>]+http-equiv\s*=\s*["']?refresh["']?[^>]*>/i.exec(html);
  out.metaRefresh = mr ? (/content\s*=\s*["']?\s*(\d+)\s*;\s*url\s*=\s*([^"'>]+)/i.exec(mr[0]) || [])
    .slice(1).filter(Boolean) : null;
  if (out.metaRefresh && out.metaRefresh.length === 2) {
    out.metaRefresh = { delay: Number(out.metaRefresh[0]), target: out.metaRefresh[1].trim() };
  } else if (mr) { out.metaRefresh = { delay: null, target: null }; } else { out.metaRefresh = null; }

  // A canonical in the Link header competes with the one in the HTML.
  const linkHdr = headers?.link || headers?.Link || '';
  const hdrCanon = /<([^>]+)>\s*;\s*rel\s*=\s*["']?canonical/i.exec(String(linkHdr));
  out.headerCanonical = hdrCanon ? hdrCanon[1].trim() : null;

  // Font loading and third-party weight, both cheap to read and both real
  // performance findings that PageSpeed reports without saying which file.
  out.fontFaces = (html.match(/@font-face/gi) || []).length;
  out.fontDisplay = (html.match(/font-display\s*:/gi) || []).length;
  out.preconnects = [...html.matchAll(/<link[^>]+rel=["']?(?:preconnect|dns-prefetch)["']?[^>]*href=["']([^"']+)/gi)].map((m2) => m2[1]);
  out.renderBlocking = (html.match(/<link[^>]+rel=["']?stylesheet["']?(?![^>]*media=["']?print)/gi) || []).length
    + (html.match(/<script(?![^>]*\b(?:async|defer|type=["']?module)\b)[^>]+src=/gi) || []).length;

  out.platform = detectPlatform(html, headers);

  return out;
}

function shingleSet(text, n = 5, cap = 400) {
  const words = text.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  const set = new Set();
  for (let i = 0; i + n <= words.length && set.size < cap * 4; i += 2) {
    set.add(words.slice(i, i + n).join(' '));
  }
  const arr = [...set];
  // deterministic sample so comparisons stay cheap on large pages
  return arr.filter((_, i) => i % Math.max(1, Math.ceil(arr.length / cap)) === 0);
}

export function jaccard(a = [], b = []) {
  if (!a.length || !b.length) return 0;
  const sa = new Set(a), sb = new Set(b);
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  return inter / (sa.size + sb.size - inter);
}

/* Detection changes the ADVICE, never the finding. A missing H1 is a missing H1
   on any stack; knowing the stack only tells us where to go and fix it. */
function detectPlatform(html, headers) {
  const hints = [];
  const hdr = JSON.stringify(headers || {});
  const has = (re) => re.test(html);

  // CMS and site builders
  if (has(/wp-content|wp-includes|wp-json/i)) hints.push('WordPress');
  if (has(/cdn\.shopify\.com|Shopify\.theme|shopify-features/i)) hints.push('Shopify');
  if (has(/wixstatic|wix-code|static\.parastorage/i)) hints.push('Wix');
  if (has(/squarespace\.com|sqsp\.net|static1\.squarespace/i)) hints.push('Squarespace');
  if (has(/webflow\.(com|io)|data-wf-page/i)) hints.push('Webflow');
  if (has(/drupal-settings-json|Drupal\.settings|\/sites\/default\/files/i)) hints.push('Drupal');
  if (has(/\/media\/jui\/|joomla-script|Joomla!/i)) hints.push('Joomla');
  if (has(/\/ghost\/api\/|ghost-sdk|content_api_key/i)) hints.push('Ghost');
  if (has(/cdn\d*\.bigcommerce/i)) hints.push('BigCommerce');
  if (has(/mage-init|Magento_|static\/version\d/i)) hints.push('Magento');
  if (has(/woocommerce/i)) hints.push('WooCommerce');
  if (has(/hs-scripts|hubspot/i)) hints.push('HubSpot');
  if (has(/shopware/i)) hints.push('Shopware');
  if (has(/prestashop/i)) hints.push('PrestaShop');

  // Frameworks — these matter because they hint at client-side rendering
  if (has(/__NEXT_DATA__|_next\/static/)) hints.push('Next.js');
  if (has(/__NUXT__|_nuxt\//)) hints.push('Nuxt');
  if (has(/ng-version=/i)) hints.push('Angular');
  if (has(/gatsby-|___gatsby/i)) hints.push('Gatsby');
  if (has(/data-svelte|__sveltekit/i)) hints.push('SvelteKit');
  if (has(/astro-island|data-astro/i)) hints.push('Astro');
  if (has(/data-reactroot|react-dom|_reactListening/i)) hints.push('React');
  if (has(/data-v-app|__vue__/i)) hints.push('Vue');

  // Theme and plugin layers, WordPress-specific but only reported if present
  if (has(/elementor/i)) hints.push('Elementor');
  if (has(/\/themes\/genesis|genesis_|StudioPress/i)) hints.push('Genesis');
  if (has(/wpbakery|js_composer|\bvc_row\b/i)) hints.push('WPBakery');
  // "divi" as a bare substring matches "individual", "division", "dividing".
  if (has(/et_pb_|et_divi|\/themes\/[Dd]ivi|divi-builder/)) hints.push('Divi');
  if (has(/yoast|yoast-schema-graph/i)) hints.push('Yoast SEO');
  if (has(/rank-math|rankmath/i)) hints.push('Rank Math');

  // Infrastructure
  if (has(/nitropack|nitro-/i) || headers?.['x-nitro-cache']) hints.push('NitroPack');
  if (/wpengine/i.test(hdr)) hints.push('WP Engine');
  if (/cf-ray/i.test(Object.keys(headers || {}).join(','))) hints.push('Cloudflare');
  if (/x-vercel-id/i.test(hdr)) hints.push('Vercel');
  if (/x-nf-request-id/i.test(hdr)) hints.push('Netlify');
  if (/x-served-by.*fastly|fastly/i.test(hdr)) hints.push('Fastly');
  if (/x-amz-cf-id/i.test(hdr)) hints.push('CloudFront');

  return [...new Set(hints)];
}

/** Rough pixel width of a string in the SERP font — better than counting characters. */
const WIDTHS = { narrow: 'ijlt.,;:!|\'"()[]{}/\\ ', wide: 'mwMW@%', upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' };
export function pixelWidth(str = '', size = 20) {
  let px = 0;
  for (const ch of str) {
    if (WIDTHS.narrow.includes(ch)) px += size * 0.28;
    else if (WIDTHS.wide.includes(ch)) px += size * 0.85;
    else if (WIDTHS.upper.includes(ch)) px += size * 0.62;
    else if (/\d/.test(ch)) px += size * 0.55;
    else px += size * 0.5;
  }
  return Math.round(px);
}
