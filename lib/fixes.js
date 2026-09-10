/* Deterministic fixes — no API, no key, no network.
   Every rule that produced a finding knows enough to produce the correction.
   Rewriting a title to fit 580px, writing a meta description from the page's
   own opening, building the JSON-LD, planning the internal links: none of that
   needs a language model. It needs the page, which we already crawled.

   The AI path still exists and is better at prose. This is the floor, and the
   floor is what makes the tool usable when a free tier is throttled. */

import { pixelWidth } from './parse.js';

const TITLE_MAX = 580, TITLE_MIN = 285, DESC_MAX = 155;

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const sentences = (t) => clean(t).split(/(?<=[.!?])\s+/).filter((s) => s.length > 25);

/** Trim to a pixel budget on a word boundary — the SERP truncates on width, not
    character count, so "58 characters" is the wrong unit and always has been. */
function fitPixels(text, max) {
  let out = clean(text);
  if (pixelWidth(out) <= max) return out;
  const words = out.split(' ');
  while (words.length > 1 && pixelWidth(words.join(' ')) > max) words.pop();
  return words.join(' ');
}

const titleCase = (s) => s.replace(/\b([a-z])(\w*)/g, (m, a, b) =>
  ['a', 'an', 'the', 'and', 'or', 'for', 'to', 'of', 'in', 'on', 'with', 'at', 'by'].includes(m)
    ? m : a.toUpperCase() + b);

/** Strings used as a title or H1 on more than one page — non-distinctive by
    definition, whatever they happen to say. */
function commonStrings(pages) {
  const seen = {};
  for (const p of pages) {
    for (const v of [String(p.title || '').split(/\s[|\-–—·]\s/)[0], p.h1s?.[0]]) {
      const n = clean(v).toLowerCase();
      if (n.length > 2) seen[n] = (seen[n] || 0) + 1;
    }
  }
  return new Set(Object.entries(seen).filter(([, n]) => n > 1).map(([k]) => k));
}

/** Brand name from the shared tail of every title, which is where sites put it. */
function inferBrand(pages) {
  const titles = pages.map((p) => clean(p.title)).filter(Boolean);
  if (titles.length < 3) return '';
  const parts = titles.map((t) => t.split(/\s[|\-–—]\s/).map(clean)).filter((a) => a.length > 1);
  if (parts.length < Math.max(2, titles.length * 0.5)) return '';
  const tails = {};
  for (const a of parts) { const t = a[a.length - 1]; if (t && t.length < 45) tails[t] = (tails[t] || 0) + 1; }
  const best = Object.entries(tails).sort((a, b) => b[1] - a[1])[0];
  if (best && best[1] >= Math.max(2, parts.length * 0.4)) return best[0];

  // Fallback for sites that don't use a separator: a whole title repeated
  // across several pages is the site name, not any page's subject.
  const whole = {};
  for (const t of titles) if (t.length < 45) whole[t] = (whole[t] || 0) + 1;
  const rep = Object.entries(whole).sort((a, b) => b[1] - a[1])[0];
  return rep && rep[1] >= Math.max(2, titles.length * 0.25) ? rep[0] : '';
}

/** The page's own subject, from the strongest signal available. */
/* `common` holds strings that appear as a title or H1 on several pages. A value
   shared across the site describes the SITE, not the page — proposing it as a
   page's title or H1 is how you get every page called "Test Law Firm". The URL
   slug is almost always page-specific, so it outranks a shared heading. */
function subjectOf(page, brand = '', common = new Set()) {
  const norm = (v) => clean(v).toLowerCase();
  const shared = (v) => {
    const n = norm(v);
    if (!n) return true;
    if (brand && n === norm(brand)) return true;
    return common.has(n);
  };

  const h1 = clean(page.h1s?.[0]);
  if (h1 && h1.length > 3 && !shared(h1)) return h1;

  // The page's own title, minus the brand tail. A title that is ONLY the brand
  // tells us nothing about the page, so fall through to the URL instead —
  // otherwise every duplicate-title page gets "proposed" its own brand name.
  const fromTitle = clean(String(page.title || '').split(/\s[|\-–—·]\s/)[0]);
  if (fromTitle.length > 3 && !shared(fromTitle)) return fromTitle;

  // Only then the slug — and never the hostname, which is what a root URL's
  // last path segment resolves to. That produced titles like "Localhost:8099".
  let path;
  try { path = new URL(page.url).pathname; } catch { path = String(page.url); }
  const slug = path.replace(/\/$/, '').split('/').filter(Boolean).pop() || '';
  const fromSlug = clean(slug.replace(/[-_]+/g, ' ').replace(/\.\w+$/, ''));
  if (fromSlug.length > 2 && !/^\d+$/.test(fromSlug)) return titleCase(fromSlug);

  const h2 = clean((page.headings || []).find((x) => x.level === 2)?.text);
  if (h2.length > 3 && !shared(h2)) return h2;

  let p2;
  try { p2 = new URL(page.url).pathname; } catch { p2 = ''; }
  return p2 === '/' || p2 === '' ? 'Home' : 'This page';
}

/* ── individual fix builders ──────────────────────────────────────────────── */

export function fixTitle(page, brand, common) {
  const subject = subjectOf(page, brand, common);
  const current = clean(page.title);
  const suffix = brand ? ` | ${brand}` : '';
  let proposed = fitPixels(subject, TITLE_MAX - pixelWidth(suffix)) + suffix;

  // Too short means wasted space: add the qualifier the page already implies.
  if (pixelWidth(proposed) < TITLE_MIN) {
    const h2 = clean((page.headings || []).find((x) => x.level === 2)?.text);
    const extra = h2 && h2.length < 46 ? `: ${h2}` : '';
    proposed = fitPixels(subject + extra, TITLE_MAX - pixelWidth(suffix)) + suffix;
  }
  // Brand-first is the classic waste of the highest-value pixels.
  if (brand && current.toLowerCase().startsWith(brand.toLowerCase())) {
    return { field: 'Title tag', from: current, to: proposed,
      why: `The brand was leading, which spends the most valuable pixels on the word searchers least need. Subject first, brand last.` };
  }
  return { field: 'Title tag', from: current || null, to: proposed,
    why: current ? `Refitted to ${Math.round(pixelWidth(proposed))}px, inside the ~${TITLE_MAX}px Google renders.` : 'The page had no title at all.' };
}

export function fixMeta(page, brand, common) {
  const subject = subjectOf(page, brand, common);
  const body = sentences(page.bodyText);
  // Prefer the page's own words: a description written from the copy matches
  // the copy, which is the whole point of a description.
  let base = body[0] || '';
  if (base && body[1] && pixelWidth(base) < 400) base = `${base} ${body[1]}`;
  let desc = clean(base).slice(0, DESC_MAX + 40);
  if (desc.length > DESC_MAX) desc = `${desc.slice(0, desc.lastIndexOf(' ', DESC_MAX))}…`;
  if (!desc || desc.length < 50) {
    desc = `${subject}. What it covers, who it is for, and what to do next.`;
  }
  return { field: 'Meta description', from: clean(page.metaDescription) || null, to: desc,
    why: 'Written from the page\'s own opening so it matches what the reader lands on. Not a ranking factor — a click-through factor.' };
}

export function fixHeadings(page, brand, common) {
  const h1s = page.h1s || [];
  if (h1s.length > 1) {
    return { field: 'Headings', from: `${h1s.length} H1s: ${h1s.map(clean).join(' / ')}`,
      to: `Keep "${clean(h1s[0])}" as the only H1. Demote the rest to H2.`,
      why: 'More than one H1 leaves no single statement of what the page is about.' };
  }
  if (!h1s.length) {
    const subj = subjectOf(page, brand, common);
    return { field: 'Headings', from: 'No H1',
      to: subj === 'This page'
        ? '<h1>DESCRIBE THIS PAGE</h1>  <!-- neither the title, the URL nor the headings said what this page is about; only you can name it -->'
        : `<h1>${subj}</h1>`,
      why: 'Taken from the page\'s strongest existing signal. Check it reads the way you would say it out loud.' };
  }
  return null;
}

export function fixAlt(page, brand, common) {
  const imgs = page.images || [];
  const missing = imgs.filter((i) => !i.hasAltAttr || !String(i.alt || '').trim()).length;
  if (!missing) return null;
  const subject = subjectOf(page, brand, common);
  return { field: 'Image alt text', from: `${missing} image${missing > 1 ? 's' : ''} with no alt`,
    to: `Describe each image's content.\n${imgs.filter((i) => !i.hasAltAttr || !String(i.alt || '').trim()).slice(0, 8).map((i) => `<img src="${i.src}" alt="DESCRIBE: what does this show?">`).join('\n')}\nFor the main image, something like: "${subject} — [what is actually shown]". Leave alt="" only for decoration.`,
    why: 'Alt text is an accessibility requirement first. Generated placeholders are worse than nothing, so these need a human eye on the actual images.' };
}

export function fixCanonical(page, origin) {
  const self = page.url;
  return { field: 'Canonical', from: page.canonical || null, to: `<link rel="canonical" href="${self}">`,
    why: page.canonical
      ? 'Pointed somewhere other than itself. Unless this page is a deliberate duplicate, it should claim itself.'
      : 'No canonical, so Google picks one for you from whatever variants it finds.' };
}

/** Internal links from pages that already discuss the topic and don't link. */
export function fixInternalLinks(page, pages, brand = '', common) {
  const subject = subjectOf(page, brand, common).toLowerCase();
  const terms = subject.split(/\s+/).filter((t) => t.length > 4);
  if (!terms.length) return null;
  const candidates = pages
    .filter((p) => p.url !== page.url && !(p.links || []).some((l) => l.resolved === page.url))
    .map((p) => {
      const text = String(p.bodyText || '').toLowerCase();
      const hits = terms.filter((t) => text.includes(t));
      return { url: p.url, hits: hits.length, matched: hits };
    })
    .filter((c) => c.hits >= Math.min(2, terms.length))
    .sort((a, b) => b.hits - a.hits)
    .slice(0, 8);
  if (!candidates.length) return null;
  return { field: 'Internal links', from: `${page.inboundCount ?? 0} inbound internal link(s)`,
    to: candidates.map((c) => `${c.url} — mentions ${c.matched.join(', ')}; link "${subjectOf(page, brand, common)}" to this page`).join('\n'),
    why: 'These pages already discuss the topic without linking to it. Internal linking is the one ranking lever that needs nobody\'s permission.' };
}

export function fixSchema(page, brand, origin, common) {
  const has = page.schemaTypes || [];
  const subject = subjectOf(page, brand, common);
  const isArticle = /\/(blog|guide|guides|article|news|post)/i.test(page.url) || (page.wordCount || 0) > 900;
  if (!has.includes('BreadcrumbList')) {
    const segs = String(page.url).replace(origin, '').split('/').filter(Boolean);
    const items = [{ name: 'Home', item: `${origin}/` }];
    let acc = origin;
    segs.forEach((s) => { acc += `/${s}`; items.push({ name: titleCase(s.replace(/[-_]/g, ' ')), item: `${acc}/` }); });
    return { field: 'Structured data', from: has.length ? has.join(', ') : 'none',
      to: JSON.stringify({ '@context': 'https://schema.org', '@type': 'BreadcrumbList',
        itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: it.item })) }, null, 2),
      why: 'Breadcrumbs replace the URL in the search result with a readable path. Built from this page\'s own URL structure.' };
  }
  if (isArticle && !has.includes('Article')) {
    return { field: 'Structured data', from: has.join(', ') || 'none',
      to: JSON.stringify({ '@context': 'https://schema.org', '@type': 'Article',
        headline: subject.slice(0, 110), author: { '@type': 'Person', name: brand || 'ADD THE REAL AUTHOR' },
        dateModified: 'ADD THE REAL LAST-MODIFIED DATE', mainEntityOfPage: page.url }, null, 2),
      why: 'Fill the two placeholders with real values. An invented author or a date that always says today is worse than no markup.' };
  }
  return null;
}

/** Findings annotate their URLs for human reading — "url [404] ← referrer",
    "a → b", "99% a ≈ b", 'url — "title"'. Matching those against the crawl
    silently failed, which is why the high-severity findings produced nothing.
    Pull every real URL back out. */
export function extractUrls(entry) {
  return String(entry).match(/https?:\/\/[^\s<>"'\]),]+/g) || [];
}

/* ── fixes for the findings that gate everything else ─────────────────────── */

export function fixNoindex(pages, finding, origin) {
  const urls = (finding.urls || []).flatMap(extractUrls);
  return {
    field: 'Robots directives',
    from: urls.map((u) => `${u.replace(origin, '') || '/'} — noindex`).join('\n'),
    to: `Remove the noindex from these URLs. Check all three places it can come from:\n`
      + `1. <meta name="robots" content="noindex"> in the page head\n`
      + `2. An X-Robots-Tag: noindex response header (invisible in page source)\n`
      + `3. A sitewide "discourage search engines" setting in your CMS\n\n`
      + urls.slice(0, 10).map((u) => `curl -sI "${u}" | grep -i x-robots-tag   # confirm the header is gone`).join('\n'),
    why: 'These pages cannot rank at all while this is set. Nothing else you do to them matters until it is removed, which is why this sits at the top of the ladder.',
  };
}

export function fixHttps(origin) {
  const host = origin.replace(/^https?:\/\//, '');
  return {
    field: 'HTTPS',
    from: `Site served over http://${host}`,
    to: `Install a certificate, then force one hop to HTTPS.\n\n`
      + `# Apache\nRewriteEngine On\nRewriteCond %{HTTPS} off\nRewriteRule ^(.*)$ https://${host}/$1 [R=301,L]\n\n`
      + `# nginx\nserver {\n  listen 80;\n  server_name ${host};\n  return 301 https://${host}$request_uri;\n}\n\n`
      + `Then update canonicals, the sitemap, and internal links to https:// so nothing routes through the redirect.`,
    why: 'HTTPS is a confirmed lightweight ranking signal, and browsers mark HTTP pages as not secure, which costs more in trust than it does in rankings.',
  };
}

export function fixRobotsAssets(origin, robotsRaw) {
  return {
    field: 'robots.txt',
    from: clean(robotsRaw).slice(0, 300) || '(current robots.txt)',
    to: `User-agent: *\n`
      + `# Allow every asset the templates load — Google renders before it judges.\n`
      + `Allow: *.css\nAllow: *.js\nAllow: *.woff2\nAllow: *.svg\nAllow: *.webp\n`
      + `# Block only genuinely private paths.\nDisallow: /cart/\nDisallow: /checkout/\nDisallow: /*?*add-to-cart=\n\n`
      + `Sitemap: ${origin}/sitemap.xml`,
    why: 'Blocked CSS and JS makes Googlebot render a broken layout and judge that instead of your page. Keep asset paths crawlable and block only private routes.',
  };
}

export function fixBrokenLinks(finding, pages, origin) {
  const rows = (finding.urls || []).map((entry) => {
    const found = extractUrls(entry);
    return { broken: found[0], referrer: found[1] || null, raw: String(entry) };
  }).filter((r) => r.broken);
  if (!rows.length) return null;
  return {
    field: 'Broken internal links',
    from: rows.map((r) => `${r.broken}${r.referrer ? ` (linked from ${r.referrer})` : ''}`).join('\n'),
    to: `Fix at source — update the link, do not rely on a redirect:\n`
      + rows.map((r) => `- On ${r.referrer || '(find the referrer)'}: repoint the link to ${r.broken.replace(/\/$/, '')} → a live URL, or remove it`).join('\n')
      + `\n\nIf a page genuinely moved, add one 301:\n`
      + rows.map((r) => { try { return `Redirect 301 ${new URL(r.broken).pathname} /REPLACE-WITH-DESTINATION`; } catch { return ''; } }).filter(Boolean).join('\n'),
    why: 'A broken internal link wastes the crawl and sends readers to a dead end. Editing the link is better than redirecting it — a redirect is a patch, not a fix.',
  };
}

export function fixRedirectChains(finding) {
  const chains = (finding.urls || []).map(extractUrls).filter((c) => c.length > 1);
  if (!chains.length) return null;
  return {
    field: 'Redirect chains',
    from: chains.map((c) => c.join(' → ')).join('\n'),
    to: `Collapse each chain to a single hop, pointing straight at the final URL:\n\n`
      + chains.map((c) => { try { return `Redirect 301 ${new URL(c[0]).pathname} ${new URL(c[c.length - 1]).pathname}`; } catch { return ''; } }).filter(Boolean).join('\n')
      + `\n\nThen update any internal link still pointing at the first URL, so no visitor takes the hop at all.`,
    why: 'Each hop loses a little and slows the page. Chains usually mean two migrations layered on each other, and they compound with every later change.',
  };
}

export function fixSoft404(finding, origin) {
  const urls = (finding.urls || []).flatMap(extractUrls);
  return {
    field: 'Soft 404s',
    from: urls.map((u) => `${u} — returns 200 with empty or "not found" content`).join('\n'),
    to: `Each of these must either return a real 404/410 status, or serve real content:\n`
      + urls.slice(0, 10).map((u) => `curl -sI "${u}" | head -1    # must not say 200 if the page is empty`).join('\n')
      + `\n\nA page that says "not found" with a 200 status teaches Google to distrust your status codes across the whole site.`,
    why: 'Google decides these are 404s anyway, but slower and less predictably. An honest status code is the cheapest crawl-budget fix there is.',
  };
}

export function fixDuplicateTitles(finding, pages, brand, origin, common) {
  const urls = (finding.urls || []).flatMap(extractUrls);
  const targets = urls.map((u) => pages.find((p) => p.url === u)).filter(Boolean);
  if (!targets.length) return null;
  return {
    field: 'Duplicate titles',
    from: targets.map((p) => `${p.url.replace(origin, '') || '/'} — "${clean(p.title)}"`).join('\n'),
    to: targets.map((p) => {
      const t = fixTitle(p, brand, common);
      return `${p.url.replace(origin, '') || '/'} → ${t.to}`;
    }).join('\n'),
    why: 'Identical titles give Google no way to tell the pages apart, and no reason to show one over the other. Each title should name what is unique about that page.',
  };
}

export function fixNearDuplicate(finding, origin) {
  const pairs = (finding.urls || []).map(extractUrls).filter((p) => p.length >= 2);
  if (!pairs.length) return null;
  return {
    field: 'Near-duplicate pages',
    from: pairs.map((p) => `${p[0]} ≈ ${p[1]}`).join('\n'),
    to: `Pick one canonical page per pair and act on it. Three valid options, in order of preference:\n\n`
      + pairs.map(([a, b]) => `${a}\n${b}\n`
        + `  Best:  merge into whichever has more inbound links, 301 the other to it\n`
        + `  Or:    <link rel="canonical" href="${a}"> on both, if both must stay live\n`
        + `  Or:    differentiate them properly, if they really do serve different queries`).join('\n\n'),
    why: 'Two pages competing for one query split the signals and neither wins. This needs your judgement on which page to keep, which is why all three options are shown rather than one.',
  };
}

export function fixOrphans(finding, pages, origin, ctx) {
  const urls = (finding.urls || []).flatMap(extractUrls);
  const out = [];
  for (const u of urls.slice(0, 10)) {
    const page = pages.find((p) => p.url === u);
    if (!page) { out.push(`${u} — link to it from a relevant existing page`); continue; }
    const link = fixInternalLinks(page, pages, ctx?.brand || '', ctx?.common);
    out.push(link
      ? `${u}\n${link.to.split('\n').map((l) => `  ${l}`).join('\n')}`
      : `${u} — no page in the crawl discusses this topic; add a link from the nearest category or hub page`);
  }
  return {
    field: 'Orphaned pages',
    from: urls.map((u) => `${u} — in the sitemap, no internal links`).join('\n'),
    to: out.join('\n\n'),
    why: 'A page with no internal links is one Google reaches only via the sitemap, and it inherits no authority from the rest of the site. Sitemap presence is not discovery.',
  };
}

/* ── fixes for the header, hreflang and pagination checks ─────────────────── */

export function fixXRobots(finding, origin) {
  const rows = (finding.urls || []).map((e) => {
    const u = extractUrls(e)[0];
    const directive = (/"([^"]+)"/.exec(String(e)) || [])[1] || 'noindex';
    return { url: u, directive };
  }).filter((r) => r.url);
  return {
    field: 'X-Robots-Tag header',
    from: rows.map((r) => `${r.url} → ${r.directive}`).join('\n'),
    to: `This directive is not in the HTML, so searching the page source will never find it. Check these three places in order:\n\n`
      + `1. Server config\n`
      + `   Apache — look for: Header set X-Robots-Tag "noindex"\n`
      + `   nginx  — look for: add_header X-Robots-Tag "noindex";\n`
      + `2. CDN or edge rules (Cloudflare Transform Rules, or a Worker adding headers)\n`
      + `3. A security or SEO plugin adding it per path\n\n`
      + `Confirm which URLs still carry it:\n`
      + rows.slice(0, 8).map((r) => `curl -sI "${r.url}" | grep -i x-robots-tag`).join('\n'),
    why: 'A noindex in a response header is invisible in the page source. People lose hours to this one because every tool that shows you "the page" shows you the body, not the headers.',
  };
}

export function fixCanonicalConflict(finding) {
  const rows = (finding.urls || []).map(String);
  return {
    field: 'Conflicting canonicals',
    from: rows.join('\n'),
    to: `Emit exactly one canonical per page. Decide which layer owns it, then remove the other:\n\n`
      + `If the HTML tag is correct, drop the header:\n`
      + `  Apache — Header unset Link\n`
      + `  nginx  — proxy_hide_header Link;\n\n`
      + `If the header is correct, remove <link rel="canonical"> from the template.\n\n`
      + `Verify afterwards:\n  curl -sI <url> | grep -i "^link:"`,
    why: 'Google reads both and picks one, which may not be the one you meant. Conflicting signals also reduce the weight it gives either.',
  };
}

export function fixCanonicalChain(finding) {
  const chains = (finding.urls || []).map((e) => extractUrls(e)).filter((c) => c.length >= 2);
  return {
    field: 'Canonical chains',
    from: chains.map((c) => c.join(' → ')).join('\n'),
    to: `Point every page in each chain directly at the final destination:\n\n`
      + chains.map((c) => {
        const final = c[c.length - 1];
        return c.slice(0, -1).map((u) => `On ${u}\n  <link rel="canonical" href="${final}">`).join('\n');
      }).join('\n\n'),
    why: 'Canonicals are a hint, and Google does not reliably follow chains. The page it indexes may be none of the ones in the chain.',
  };
}

export function fixPaginationCanonical(finding) {
  const rows = (finding.urls || []).map((e) => extractUrls(e));
  return {
    field: 'Paginated canonicals',
    from: rows.map((c) => c.join(' → ')).join('\n'),
    to: `Give each paginated page a self-referencing canonical:\n\n`
      + rows.map(([from]) => `On ${from}\n  <link rel="canonical" href="${from}">`).join('\n\n')
      + `\n\nGoogle retired rel=next/prev as an indexing signal, so self-canonical plus real crawlable links between pages is the whole answer. Do not add rel=next/prev expecting it to do anything.\n\n`
      + `If you would rather have one indexable page, build a genuine view-all page with all the content on it and canonicalise the paginated set to that — but only if it loads acceptably.`,
    why: 'Canonicalising page two to page one tells Google the deeper pages are duplicates, so it stops crawling them. Anything only linked from page three effectively disappears.',
  };
}

export function fixHreflang(finding, pages, origin) {
  const kind = finding.id || '';
  if (/bad-code/.test(kind)) {
    return {
      field: 'hreflang values',
      from: (finding.urls || []).join('\n'),
      to: `Use ISO 639-1 for language and ISO 3166-1 Alpha-2 for region:\n\n`
        + `  en        language only — valid and often the right choice\n`
        + `  en-GB     United Kingdom. NOT en-UK — UK is not a country code\n`
        + `  fr-CA     French, Canada\n`
        + `  es-MX     Spanish, Mexico\n`
        + `  x-default the fallback for everyone who matches nothing\n\n`
        + `Region alone is never valid: "GB" on its own is ignored.`,
      why: 'An invalid code is dropped silently. en-UK is the commonest mistake in the wild and it does nothing at all.',
    };
  }
  if (/no-return/.test(kind)) {
    const pairs = (finding.urls || []).map((e) => extractUrls(e)).filter((c) => c.length >= 2);
    return {
      field: 'hreflang return tags',
      from: pairs.map((c) => `${c[0]} → ${c[1]} (no return)`).join('\n'),
      to: `Every declaration must be mutual. For each pair, the target needs a tag pointing back:\n\n`
        + pairs.slice(0, 6).map(([a, b]) => `On ${b}, add:\n  <link rel="alternate" hreflang="LANG-OF-A" href="${a}">`).join('\n\n')
        + `\n\nThis is almost always a template problem rather than a per-page one. Generate the whole cluster from one list of alternates so every page emits every entry, including its own.`,
      why: 'Non-reciprocal hreflang is ignored entirely. Google treats the return tag as confirmation that both sides agree, and without it discards the set.',
    };
  }
  // missing self-reference
  const urls = (finding.urls || []).flatMap(extractUrls);
  return {
    field: 'hreflang self-reference',
    from: urls.join('\n'),
    to: `Each page in a cluster must list every page in the cluster, INCLUDING itself:\n\n`
      + urls.slice(0, 5).map((u) => `On ${u}, add:\n  <link rel="alternate" hreflang="THIS-PAGES-LANG" href="${u}">`).join('\n\n')
      + `\n\nThe cleanest implementation is one shared list of alternates rendered identically on every page in the set.`,
    why: 'A cluster with no self-reference is invalid and Google discards the whole set, so every alternate on those pages is currently being ignored.',
  };
}

export function fixMetaRefresh(finding) {
  const rows = (finding.urls || []).map((e) => {
    const us = extractUrls(e);
    const target = String(e).split('→').pop().trim();
    return { from: us[0], to: us[1] || target };
  }).filter((r) => r.from);
  return {
    field: 'Meta refresh redirects',
    from: rows.map((r) => `${r.from} → ${r.to}`).join('\n'),
    to: `Replace each with a server-side 301:\n\n`
      + `# Apache\n`
      + rows.map((r) => { try { return `Redirect 301 ${new URL(r.from).pathname} ${r.to.startsWith('http') ? r.to : r.to}`; } catch { return ''; } }).filter(Boolean).join('\n')
      + `\n\n# nginx\n`
      + rows.map((r) => { try { return `location = ${new URL(r.from).pathname} { return 301 ${r.to}; }`; } catch { return ''; } }).filter(Boolean).join('\n')
      + `\n\nThen remove the <meta http-equiv="refresh"> tag, or the browser will do both.`,
    why: 'Google follows a meta refresh but treats it as a weaker signal than a 301, and the reader waits for the first page to load before being moved.',
  };
}

export function fixParamTrap(finding, origin) {
  const patterns = (finding.urls || []).filter((u) => String(u).startsWith('?'));
  const examples = (finding.urls || []).flatMap(extractUrls).slice(0, 4);
  return {
    field: 'Parameter handling',
    from: `${patterns.join(', ')}\n${examples.join('\n')}`,
    to: `Decide per parameter — there is no single right answer, and canonicals alone do not stop the crawl:\n\n`
      + `TRACKING (utm_*, gclid, fbclid) — self-canonical to the clean URL, do not block\n`
      + `  <link rel="canonical" href="CLEAN-URL">\n\n`
      + `FILTERS AND FACETS — block the crawl, because canonicals still let it happen\n`
      + `  robots.txt:\n`
      + patterns.map((p) => p.replace('?', '').split(',').map((k) => `  Disallow: /*?*${k}=`).join('\n')).join('\n')
      + `\n\nGENUINELY DISTINCT VARIANTS (a real product colour with its own content) — self-canonical and leave crawlable\n\n`
      + `Then in Search Console, watch Pages → "Crawled, currently not indexed" for a month. If it keeps growing, the block is not tight enough.`,
    why: 'Faceted navigation multiplies combinatorially. A handful of filters becomes thousands of URLs and crawl budget goes to them instead of your real pages. Blocking is the only thing that stops the crawling; a canonical only affects what gets indexed after the crawl has already happened.',
  };
}

export function fixRenderBlocking(finding) {
  const rows = (finding.urls || []).map(String);
  return {
    field: 'Render-blocking resources',
    from: rows.join('\n'),
    to: `Three changes, in order of payoff:\n\n`
      + `1. Defer every script that is not needed for first paint\n`
      + `   <script src="/x.js" defer></script>\n`
      + `   Use async only for genuinely independent scripts such as analytics.\n\n`
      + `2. Inline the critical CSS and load the rest without blocking\n`
      + `   <style>/* above-the-fold rules only */</style>\n`
      + `   <link rel="preload" as="style" href="/main.css" onload="this.rel='stylesheet'">\n\n`
      + `3. Stop print stylesheets blocking\n`
      + `   <link rel="stylesheet" href="/print.css" media="print">\n\n`
      + `Re-measure after each step rather than all three at once, so you know which one paid.`,
    why: 'Synchronous stylesheets and head scripts must download and execute before anything renders. This is the most direct cause of a slow LCP, and unlike a Lighthouse score it names the specific files.',
  };
}

export function fixFontDisplay(finding) {
  return {
    field: 'Font loading',
    from: (finding.urls || []).join('\n'),
    to: `Add font-display to every @font-face:\n\n`
      + `@font-face {\n  font-family: 'YourFont';\n  src: url('/fonts/yourfont.woff2') format('woff2');\n  font-display: swap;\n}\n\n`
      + `Then preload the one face used above the fold:\n`
      + `<link rel="preload" href="/fonts/yourfont.woff2" as="font" type="font/woff2" crossorigin>\n\n`
      + `If the font comes from a third party, self-host it. That removes a DNS lookup, a handshake and a TLS negotiation from the critical path.`,
    why: 'The browser default hides text for up to three seconds while a font downloads. That shows up as a poor LCP and, more to the point, as a blank page to the reader.',
  };
}

export function fixLinksToNoindex(finding) {
  return {
    field: 'Links to noindexed pages',
    from: (finding.urls || []).join('\n'),
    to: `Decide which of the two is true for each target:\n\n`
      + `IT SHOULD RANK — remove the noindex. Check both the meta tag and the X-Robots-Tag header, since either can set it.\n\n`
      + `IT SHOULD NOT RANK — then ask why it is in the main navigation. Utility pages (cart, account, filters) rarely need a nav link on every page. Moving them to the footer, or behind a single hub link, stops every page in the site spending signal on them.\n\n`
      + `Do NOT add nofollow to the internal links. It stops the flow without redirecting it anywhere, so the signal is simply lost.`,
    why: 'Authority flowing down these links reaches a page that can never rank. Harmless on a small site; on a large one it is a meaningful share of internal signal going nowhere.',
  };
}

export function fixSitemapHygiene(finding, origin) {
  return {
    field: 'Sitemap contents',
    from: (finding.urls || []).slice(0, 8).join('\n'),
    to: `Generate the sitemap from canonical, indexable URLs only. Exclude anything that:\n`
      + `  - carries noindex, in the meta tag or the header\n`
      + `  - canonicalises to a different URL\n`
      + `  - returns anything other than 200\n`
      + `  - is blocked in robots.txt\n\n`
      + `If it is hand-maintained, stop — it will be wrong again within a month. Every major CMS and framework can generate it from the same list of routes it already knows about.\n\n`
      + `After changing it, resubmit in Search Console and watch the "Discovered" count. A sitemap Google distrusts gets read less often.`,
    why: 'A sitemap is a statement about which URLs you want indexed. Listing pages you have told Google to ignore contradicts that, and enough contradictions make Google trust the whole file less.',
  };
}

/* ── the dispatcher ───────────────────────────────────────────────────────── */

/* Mapping from what a finding is about to how to correct it. Matching on the
   finding's id where possible, and on its title as a fallback, because ids
   change more often than the words describing the problem. */
/* Finding-level fixes: these operate on the whole finding, not page by page,
   because the correction is one config change rather than an edit per URL. */
const FINDING_ROUTES = [
  { test: /xrobots/i, build: (f, ctx) => fixXRobots(f, ctx.origin) },
  { test: /canonical-header-conflict/i, build: (f) => fixCanonicalConflict(f) },
  { test: /canonical-chain/i, build: (f) => fixCanonicalChain(f) },
  { test: /pagination-canonical/i, build: (f) => fixPaginationCanonical(f) },
  { test: /hreflang/i, build: (f, ctx) => fixHreflang(f, ctx.pages, ctx.origin) },
  { test: /meta-refresh/i, build: (f) => fixMetaRefresh(f) },
  { test: /param-crawl-trap/i, build: (f, ctx) => fixParamTrap(f, ctx.origin) },
  { test: /render-blocking/i, build: (f) => fixRenderBlocking(f) },
  { test: /font-display/i, build: (f) => fixFontDisplay(f) },
  { test: /links-to-noindex/i, build: (f) => fixLinksToNoindex(f) },
  { test: /sitemap-nonindexable|sitemap-too-large/i, build: (f, ctx) => fixSitemapHygiene(f, ctx.origin) },
  { test: /^noindex|noindex/i, build: (f, ctx) => fixNoindex(ctx.pages, f, ctx.origin) },
  { test: /^no-https|served over http|https/i, build: (f, ctx) => fixHttps(ctx.origin) },
  { test: /robots.*(asset|css|js)|blocks css/i, build: (f, ctx) => fixRobotsAssets(ctx.origin, ctx.robotsRaw) },
  { test: /broken/i, build: (f, ctx) => fixBrokenLinks(f, ctx.pages, ctx.origin) },
  { test: /redirect.?chain|chain/i, build: (f) => fixRedirectChains(f) },
  { test: /soft.?404/i, build: (f, ctx) => fixSoft404(f, ctx.origin) },
  { test: /title-duplicate|duplicate.*title|title.*more than one/i, build: (f, ctx) => fixDuplicateTitles(f, ctx.pages, ctx.brand, ctx.origin, ctx.common) },
  { test: /near.?duplicate|identical content/i, build: (f, ctx) => fixNearDuplicate(f, ctx.origin) },
  { test: /orphan/i, build: (f, ctx) => fixOrphans(f, ctx.pages, ctx.origin, ctx) },
];

const ROUTES = [
  { test: /title/i, build: (p, ctx) => [fixTitle(p, ctx.brand, ctx.common)] },
  { test: /meta description|description/i, build: (p, ctx) => [fixMeta(p, ctx.brand, ctx.common)] },
  { test: /h1|heading/i, build: (p, ctx) => [fixHeadings(p, ctx.brand, ctx.common)] },
  { test: /alt/i, build: (p, ctx) => [fixAlt(p, ctx.brand, ctx.common)] },
  { test: /canonical/i, build: (p, ctx) => [fixCanonical(p, ctx.origin)] },
  { test: /internal link|orphan|anchor/i, build: (p, ctx) => [fixInternalLinks(p, ctx.pages, ctx.brand, ctx.common)] },
  { test: /schema|structured data|breadcrumb/i, build: (p, ctx) => [fixSchema(p, ctx.brand, ctx.origin, ctx.common)] },
  { test: /thin|word count|content/i, build: (p) => [{
      field: 'Content', from: `${p.wordCount || 0} words`,
      to: `Cover what the current page leaves out. Judge it against what already ranks, not a word count — thin means "does not answer the question", and a 300-word page that answers it fully is fine.`,
      why: 'There is no minimum word count. The test is whether a reader gets their answer without going back to the results.' }] },
];

/**
 * Produces a concrete correction for a finding using only the crawl.
 * Returns null when a finding genuinely needs a human decision, which is
 * honest rather than unhelpful — inventing a fix for "choose your canonical
 * strategy" would be worse than admitting the tool cannot choose it.
 */
export function deterministicFix(finding, pages, origin, robotsRaw = '') {
  const brand = inferBrand(pages);
  const key = `${finding.id || ''} ${finding.title || ''}`;
  const ctx = { brand, origin, pages, robotsRaw, common: commonStrings(pages) };

  // Config-level corrections first — one change, not one per URL.
  const fRoute = FINDING_ROUTES.find((r) => r.test.test(key));
  if (fRoute) {
    const change = fRoute.build(finding, ctx);
    if (change) {
      return {
        source: 'deterministic',
        summary: change.field ? `${change.field}: concrete correction built from the crawl.` : 'Correction built from the crawl.',
        changes: [{ what: change.field, from: change.from, to: change.to, why: change.why }],
        code: /^[<#{]|Redirect |RewriteEngine|server \{|curl /m.test(change.to) ? change.to : '',
        acceptance: [
          `The condition in "${finding.title}" no longer holds`,
          'Re-crawl and confirm the finding is gone',
        ],
        cannotDo: '',
      };
    }
  }

  // Otherwise, per-page edits. URLs are annotated for reading, so parse them.
  const targets = (finding.urls || [])
    .flatMap(extractUrls)
    .slice(0, 5)
    .map((u) => pages.find((p) => p.url === u))
    .filter(Boolean);
  const scope = targets.length ? targets : pages.slice(0, 1);
  const route = ROUTES.find((r) => r.test.test(key));
  if (!route) return null;

  const perPage = [];
  for (const p of scope) {
    const changes = route.build(p, ctx).filter(Boolean);
    if (changes.length) perPage.push({ url: p.url, changes });
  }
  if (!perPage.length) return null;

  const code = perPage
    .flatMap(({ url, changes }) => changes
      .filter((c) => /^[<{]/.test(String(c.to).trim()))
      .map((c) => `<!-- ${url} -->\n${c.to}`))
    .join('\n\n');

  return {
    source: 'deterministic',
    summary: `${perPage.length === 1 ? 'One page' : `${perPage.length} pages`} corrected from the crawl data. ${brand ? `Brand read as "${brand}" from your title pattern.` : ''}`.trim(),
    changes: perPage.flatMap(({ url, changes }) => changes.map((c) => ({
      what: `${c.field} — ${url.replace(origin, '') || '/'}`,
      from: c.from, to: c.to, why: c.why,
    }))),
    code,
    acceptance: [
      `The condition in "${finding.title}" no longer holds on the listed URLs`,
      'Re-crawl and confirm the finding is gone',
      ...(code ? ['The pasted markup validates — check JSON-LD in the Rich Results Test'] : []),
    ],
    cannotDo: finding.urls?.length > 5
      ? `Showed the first 5 of ${finding.urls.length} affected URLs. The same correction applies to the rest; export the findings CSV for the full list.`
      : '',
  };
}

export { inferBrand, subjectOf, fitPixels };
