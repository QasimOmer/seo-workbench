/* Additional checks, kept in their own module so the core rule set stays
   readable. Everything here is computed from the crawl — no extra requests.

   Selection principle: each of these catches something that is either silent
   (invisible in the page, so nobody finds it by looking) or systemic (a
   template-level mistake repeated across the site). Checks that merely restate
   what a human can see in the browser are not worth a finding. */

const F = (o) => ({ owner: 'dev', effort: 'S', urls: [], evidence: 'observed', ...o });

const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const path = (u) => { try { return new URL(u).pathname; } catch { return u; } };

/* BCP-47 shapes Google accepts. Region without language, and made-up codes like
   "en-UK", are the two that actually appear in the wild. */
const VALID_LANG = /^(x-default|[a-z]{2,3}(-[A-Z][a-z]{3})?(-([A-Z]{2}|\d{3}))?)$/;
const FAKE_REGIONS = { 'en-UK': 'en-GB', 'en-EU': 'no such region — use a country code', 'zh-CN': 'zh-Hans or zh-CN are both accepted, but be consistent' };

export function extraChecks(crawl, ctx = {}) {
  const out = [];
  const push = (...f) => f.forEach((x) => x && out.push(x));
  const pages = (crawl.pages || []).filter((p) => /text\/html/i.test(p.contentType || '') && p.status === 200);
  const byUrl = new Map(pages.map((p) => [p.url, p]));
  const origin = crawl.origin || '';

  /* ── X-Robots-Tag: previously reported as "not checked" ─────────────────── */
  /* The crawler keeps response headers now, so this is a real check rather than
     a disclaimer. It matters because a noindex in a header is invisible in the
     page source — people spend hours looking at the HTML for it. */
  const hdrNoindex = pages.filter((p) => /noindex/i.test(p.xRobotsTag || ''));
  if (hdrNoindex.length) {
    push(F({
      severity: 'Critical', phase: 'eligibility', id: 'xrobots-noindex',
      title: `${hdrNoindex.length} page(s) carry noindex in an X-Robots-Tag response header`,
      where: hdrNoindex.slice(0, 6).map((p) => p.url).join('\n          '),
      what: `The header says: ${hdrNoindex.slice(0, 3).map((p) => `${path(p.url)} → "${p.xRobotsTag}"`).join('; ')}`,
      why: 'Crawl stage. These pages cannot be indexed, and the directive is invisible in the page source — which is where everyone looks first. It usually comes from server config, a CDN rule or a security plugin rather than the CMS.',
      fix: 'Find the emitter: check .htaccess or nginx config, CDN and edge rules, and any security or SEO plugin. Confirm with: curl -sI <url> | grep -i x-robots-tag',
      owner: 'dev', effort: 'M', urls: hdrNoindex.map((p) => `${p.url} — "${p.xRobotsTag}"`),
    }));
  }
  const hdrNofollow = pages.filter((p) => /nofollow/i.test(p.xRobotsTag || '') && !/noindex/i.test(p.xRobotsTag || ''));
  if (hdrNofollow.length) {
    push(F({
      severity: 'High', phase: 'linking', id: 'xrobots-nofollow',
      title: `${hdrNofollow.length} page(s) send nofollow in a response header`,
      where: hdrNofollow.slice(0, 6).map((p) => p.url).join('\n          '),
      what: 'The header instructs Google not to follow any link on these pages.',
      why: 'Link stage. Every link out of these pages is dropped, so anything only reachable through them becomes undiscoverable.',
      fix: 'Remove nofollow from the X-Robots-Tag unless these pages genuinely should pass nothing on.',
      owner: 'dev', effort: 'S', urls: hdrNofollow.map((p) => p.url),
    }));
  }

  /* ── canonical conflicts the HTML alone will not show ──────────────────── */
  const canonConflict = pages.filter((p) => p.headerCanonical && p.canonical && p.headerCanonical !== p.canonical);
  if (canonConflict.length) {
    push(F({
      severity: 'High', phase: 'indexation', id: 'canonical-header-conflict',
      title: `${canonConflict.length} page(s) declare two different canonicals`,
      where: canonConflict.slice(0, 5).map((p) => p.url).join('\n          '),
      what: canonConflict.slice(0, 3).map((p) => `${path(p.url)}: header says ${p.headerCanonical}, HTML says ${p.canonical}`).join('\n'),
      why: 'Index stage. Google sees both and picks one, which may not be the one you meant. Conflicting signals also reduce how much weight it gives either.',
      fix: 'Emit exactly one. Remove the Link rel=canonical header, or remove the HTML tag — whichever is not the intended source of truth.',
      owner: 'dev', effort: 'S', urls: canonConflict.map((p) => `${p.url} — header ${p.headerCanonical} vs html ${p.canonical}`),
    }));
  }

  /* A canonical pointing at a URL that itself redirects, or is itself
     canonicalised elsewhere, is a chain Google may simply not follow. */
  const canonChain = [];
  for (const p of pages) {
    if (!p.canonical || p.canonical === p.url) continue;
    const target = byUrl.get(p.canonical);
    if (!target) continue;
    if (target.canonical && target.canonical !== target.url) {
      canonChain.push(`${p.url} → ${p.canonical} → ${target.canonical}`);
    }
  }
  if (canonChain.length) {
    push(F({
      severity: 'High', phase: 'indexation', id: 'canonical-chain',
      title: `${canonChain.length} canonical chain(s)`,
      where: canonChain.slice(0, 5).join('\n          '),
      what: 'A page canonicalises to a URL that canonicalises somewhere else again.',
      why: 'Index stage. Google treats canonicals as a hint and does not reliably follow chains, so the page it indexes may be none of the three.',
      fix: 'Point every page in the chain directly at the final destination. One hop, never two.',
      owner: 'dev', effort: 'M', urls: canonChain,
    }));
  }

  /* ── pagination ────────────────────────────────────────────────────────── */
  /* Canonicalising page 2+ back to page 1 is the classic pagination error: it
     tells Google the deeper pages are duplicates, so everything only linked
     from them stops being discovered. */
  const pagedToFirst = pages.filter((p) => {
    if (!/\/(page|p)\/(\d+)|[?&](page|paged)=\d+/i.test(p.url)) return false;
    if (!p.canonical || p.canonical === p.url) return false;
    return !/\/(page|p)\/(\d+)|[?&](page|paged)=\d+/i.test(p.canonical);
  });
  if (pagedToFirst.length) {
    push(F({
      severity: 'High', phase: 'indexation', id: 'pagination-canonical',
      title: `${pagedToFirst.length} paginated page(s) canonicalise to page one`,
      where: pagedToFirst.slice(0, 5).map((p) => `${p.url} → ${p.canonical}`).join('\n          '),
      what: 'Page two onward declare page one as their canonical.',
      why: 'Index stage. This tells Google the deeper pages are duplicates of the first, so it stops crawling them — and anything reachable only from page three effectively disappears.',
      fix: 'Give each paginated page a self-referencing canonical. Google retired rel=next/prev as an indexing signal, so self-canonical plus real internal links is the whole answer. If you want one indexable page instead, build a genuine view-all page and canonicalise to that.',
      owner: 'dev', effort: 'M', urls: pagedToFirst.map((p) => `${p.url} → ${p.canonical}`),
    }));
  }

  /* ── hreflang: parsed for a long time, never validated until now ────────── */
  const withHreflang = pages.filter((p) => (p.hreflang || []).length);
  if (withHreflang.length) {
    const noSelf = [], badCodes = [], noReturn = [], noXDefault = [];
    const hreflangSet = new Set(withHreflang.map((p) => p.url));

    for (const p of withHreflang) {
      const entries = p.hreflang;
      if (!entries.some((h) => h.href === p.url)) noSelf.push(p.url);
      for (const h of entries) {
        if (!VALID_LANG.test(h.lang)) badCodes.push(`${path(p.url)}: "${h.lang}"`);
        else if (FAKE_REGIONS[h.lang]) badCodes.push(`${path(p.url)}: "${h.lang}" — should be ${FAKE_REGIONS[h.lang]}`);
      }
      // Return tags: if A points to B, B must point back to A.
      for (const h of entries) {
        const target = byUrl.get(h.href);
        if (!target || !hreflangSet.has(h.href)) continue;
        if (!(target.hreflang || []).some((x) => x.href === p.url)) {
          noReturn.push(`${p.url} → ${h.href} (no return tag)`);
        }
      }
      if (!entries.some((h) => h.lang === 'x-default')) noXDefault.push(p.url);
    }

    if (noSelf.length) {
      push(F({
        severity: 'High', phase: 'indexation', id: 'hreflang-no-self',
        title: `${noSelf.length} page(s) with hreflang omit a self-reference`,
        where: noSelf.slice(0, 5).join('\n          '),
        what: 'The hreflang cluster does not include the page it sits on.',
        why: 'Index stage. A cluster without a self-reference is invalid, and Google discards the whole set — so every alternate on those pages is being ignored.',
        fix: 'Add a self-referencing hreflang to every page in the set. Every page must list every page in the cluster, including itself.',
        owner: 'dev', effort: 'M', urls: noSelf,
      }));
    }
    if (noReturn.length) {
      push(F({
        severity: 'High', phase: 'indexation', id: 'hreflang-no-return',
        title: `${noReturn.length} hreflang pair(s) are not reciprocal`,
        where: noReturn.slice(0, 5).join('\n          '),
        what: 'Page A declares B as an alternate, but B does not declare A.',
        why: 'Index stage. Non-reciprocal hreflang is ignored entirely — Google requires the return tag as confirmation that both sides agree.',
        fix: 'Make every declaration mutual. This is almost always a template problem rather than a per-page one, so fix it where the tags are generated.',
        owner: 'dev', effort: 'M', urls: noReturn,
      }));
    }
    if (badCodes.length) {
      push(F({
        severity: 'Medium', phase: 'indexation', id: 'hreflang-bad-code',
        title: `${badCodes.length} invalid hreflang value(s)`,
        where: badCodes.slice(0, 6).join('\n          '),
        what: 'Language or region codes that are not valid BCP-47.',
        why: 'Index stage. An invalid code is silently dropped. "en-UK" is the commonest — the country code for the United Kingdom is GB.',
        fix: 'Use ISO 639-1 for language and ISO 3166-1 Alpha-2 for region: en-GB, fr-CA, es-MX. Language alone is fine; region alone is not.',
        owner: 'dev', effort: 'S', urls: badCodes,
      }));
    }
    if (noXDefault.length === withHreflang.length && withHreflang.length > 1) {
      push(F({
        severity: 'Low', phase: 'indexation', id: 'hreflang-no-xdefault',
        title: 'No x-default in any hreflang cluster',
        where: `${withHreflang.length} pages with hreflang`,
        what: 'None of the clusters nominate a fallback for unmatched languages.',
        why: 'Index stage. Without x-default, a visitor whose language matches nothing gets whichever version Google guesses.',
        fix: 'Add x-default pointing at the version that best serves everyone else — usually the English or global page.',
        owner: 'dev', effort: 'S', urls: [],
      }));
    }
  }

  /* ── meta refresh ──────────────────────────────────────────────────────── */
  const refreshers = pages.filter((p) => p.metaRefresh);
  if (refreshers.length) {
    push(F({
      severity: 'Medium', phase: 'eligibility', id: 'meta-refresh',
      title: `${refreshers.length} page(s) redirect with a meta refresh`,
      where: refreshers.slice(0, 5).map((p) => `${p.url} → ${p.metaRefresh.target || '(unparsed)'}`).join('\n          '),
      what: 'A client-side meta refresh is being used instead of an HTTP redirect.',
      why: 'Crawl stage. Google follows these but treats them as a weaker signal than a 301, and they are slower for users because the first page loads fully before the jump.',
      fix: 'Replace with a server-side 301. If the delay is non-zero it is an interstitial rather than a redirect, and that is a separate problem.',
      owner: 'dev', effort: 'S', urls: refreshers.map((p) => `${p.url} → ${p.metaRefresh.target || '?'}`),
    }));
  }

  /* ── internal links pointing at pages that cannot be indexed ───────────── */
  const blocked = new Set(pages.filter((p) => p.noindex || /noindex/i.test(p.xRobotsTag || '')).map((p) => p.url));
  if (blocked.size) {
    const wasters = [];
    for (const p of pages) {
      const bad = (p.links || []).filter((l) => l.resolved && blocked.has(l.resolved) && !l.nofollow);
      if (bad.length) wasters.push({ url: p.url, count: bad.length, targets: bad.slice(0, 3).map((l) => l.resolved) });
    }
    if (wasters.length) {
      const total = wasters.reduce((t, w) => t + w.count, 0);
      push(F({
        severity: 'Medium', phase: 'linking', id: 'links-to-noindex',
        title: `${total} internal link(s) point at pages that cannot be indexed`,
        where: wasters.slice(0, 5).map((w) => `${w.url} → ${w.targets.join(', ')}`).join('\n          '),
        what: 'Followed internal links to noindexed pages.',
        why: 'Link stage. Not harmful in itself, but the authority flowing down those links reaches a page that can never rank. On a large site that is a meaningful share of internal signal going nowhere.',
        fix: 'If the target should rank, remove its noindex. If it genuinely should not be indexed, consider whether it needs to be in the main navigation at all.',
        owner: 'SEO', effort: 'M', evidence: 'inferred',
        urls: wasters.map((w) => `${w.url} → ${w.count} noindexed target(s)`),
      }));
    }
  }

  /* ── excessive links per page ──────────────────────────────────────────── */
  /* No hard limit exists any more, but a page with 300 links dilutes each one
     and usually means a mega-menu or footer dump rather than editorial links. */
  const linkHeavy = pages.filter((p) => (p.links || []).length > 200)
    .sort((a, b) => (b.links || []).length - (a.links || []).length);
  if (linkHeavy.length) {
    push(F({
      severity: 'Low', phase: 'linking', id: 'link-heavy',
      title: `${linkHeavy.length} page(s) carry more than 200 internal links`,
      where: linkHeavy.slice(0, 5).map((p) => `${p.url} — ${(p.links || []).length} links`).join('\n          '),
      what: 'Very high link counts, almost always from a mega-menu or a footer listing every page.',
      why: 'Link stage. There is no penalty threshold, but every link divides the page\'s outgoing signal, so 300 links each carry a third of what 100 would. It also makes the crawl less efficient.',
      fix: 'Reduce navigation to what people actually use. If a mega-menu must list everything, accept that the internal linking signal from it is close to noise and place editorial links in the body instead.',
      owner: 'SEO', effort: 'M', evidence: 'inferred',
      urls: linkHeavy.map((p) => `${p.url} — ${(p.links || []).length}`),
    }));
  }

  /* ── sitemap hygiene ───────────────────────────────────────────────────── */
  const sitemapUrls = (crawl.sitemap || []).map((s) => s.loc).filter(Boolean);
  if (sitemapUrls.length) {
    const nonIndexable = [];
    for (const u of sitemapUrls) {
      const p = byUrl.get(u);
      if (!p) continue;
      if (p.noindex || /noindex/i.test(p.xRobotsTag || '')) nonIndexable.push(`${u} — noindex`);
      else if (p.canonical && p.canonical !== p.url) nonIndexable.push(`${u} — canonicalises to ${p.canonical}`);
    }
    if (nonIndexable.length) {
      push(F({
        severity: 'Medium', phase: 'indexation', id: 'sitemap-nonindexable',
        title: `${nonIndexable.length} sitemap URL(s) are not indexable`,
        where: nonIndexable.slice(0, 6).join('\n          '),
        what: 'The sitemap lists URLs that are noindexed or canonicalise elsewhere.',
        why: 'Index stage. A sitemap is a statement about which URLs you want indexed. Listing pages you have told Google to ignore contradicts that, and enough contradictions make Google trust the file less.',
        fix: 'Generate the sitemap from canonical, indexable URLs only. If it is hand-maintained, stop — it will be wrong again within a month.',
        owner: 'dev', effort: 'M', urls: nonIndexable,
      }));
    }
    if (sitemapUrls.length > 50000) {
      push(F({
        severity: 'Medium', phase: 'indexation', id: 'sitemap-too-large',
        title: `Sitemap contains ${sitemapUrls.length} URLs, above the 50,000 limit`,
        where: crawl.origin,
        what: 'A single sitemap file exceeds the specification limit.',
        why: 'Crawl stage. Google stops reading at 50,000 URLs or 50MB uncompressed, so everything past that point is never seen.',
        fix: 'Split into multiple sitemaps under a sitemap index, grouped by section so you can also see indexation rates per type in Search Console.',
        owner: 'dev', effort: 'M', urls: [],
      }));
    }
  }

  /* ── parameter and facet crawl traps ───────────────────────────────────── */
  const paramGroups = {};
  for (const p of pages) {
    try {
      const u = new URL(p.url);
      if (![...u.searchParams.keys()].length) continue;
      const key = [...u.searchParams.keys()].sort().join(',');
      (paramGroups[key] ||= []).push(p.url);
    } catch { /* skip */ }
  }
  const traps = Object.entries(paramGroups).filter(([, list]) => list.length >= 3);
  if (traps.length) {
    push(F({
      severity: 'Medium', phase: 'eligibility', id: 'param-crawl-trap',
      title: `${traps.length} parameter pattern(s) generating multiple crawlable URLs`,
      where: traps.slice(0, 4).map(([k, list]) => `?${k} — ${list.length} URLs, e.g. ${list[0]}`).join('\n          '),
      what: 'Query parameters producing distinct crawlable URLs for what is probably one piece of content.',
      why: 'Crawl stage. Faceted navigation multiplies combinatorially — a handful of filters becomes thousands of URLs, and crawl budget is spent on them instead of your real pages. This is the classic crawl-budget catastrophe.',
      fix: 'Decide per parameter: self-canonical if the variant is genuinely distinct, canonical to the clean URL if it is a filter, and robots.txt Disallow if it should never be crawled at all. Do not rely on canonicals alone for facets — the crawl still happens.',
      owner: 'dev', effort: 'L',
      urls: traps.flatMap(([k, list]) => [`?${k}`, ...list.slice(0, 4)]),
    }));
  }

  /* ── render-blocking and font loading ──────────────────────────────────── */
  const blockingHeavy = pages.filter((p) => (p.renderBlocking || 0) > 6)
    .sort((a, b) => (b.renderBlocking || 0) - (a.renderBlocking || 0));
  if (blockingHeavy.length) {
    push(F({
      severity: 'Medium', phase: 'performance', id: 'render-blocking',
      title: `${blockingHeavy.length} page(s) load more than six render-blocking resources`,
      where: blockingHeavy.slice(0, 5).map((p) => `${p.url} — ${p.renderBlocking} blocking`).join('\n          '),
      what: 'Synchronous stylesheets and scripts in the head that must download and execute before anything renders.',
      why: 'Performance stage. This is the most direct cause of a slow LCP, and unlike most performance advice it names the specific files rather than a score.',
      fix: 'Inline the critical CSS and defer the rest. Add defer or async to any script that is not needed for first paint. Print stylesheets should carry media="print" so they stop blocking.',
      owner: 'dev', effort: 'M', evidence: 'observed',
      urls: blockingHeavy.map((p) => `${p.url} — ${p.renderBlocking}`),
    }));
  }

  const fontsNoDisplay = pages.filter((p) => (p.fontFaces || 0) > 0 && (p.fontDisplay || 0) === 0);
  if (fontsNoDisplay.length) {
    push(F({
      severity: 'Low', phase: 'performance', id: 'font-display',
      title: `${fontsNoDisplay.length} page(s) declare fonts without font-display`,
      where: fontsNoDisplay.slice(0, 5).map((p) => p.url).join('\n          '),
      what: '@font-face rules with no font-display descriptor.',
      why: 'Performance stage. The browser default hides text for up to three seconds while the font downloads, which shows up as a poor LCP and, more importantly, as a blank page to the reader.',
      fix: 'Add font-display: swap to every @font-face. Preload the one font used above the fold and self-host it if it currently comes from a third party.',
      owner: 'dev', effort: 'S', urls: fontsNoDisplay.map((p) => p.url),
    }));
  }

  /* ── third-party origins without preconnect ────────────────────────────── */
  const thirdParty = new Map();
  for (const p of pages) {
    for (const l of p.links || []) {
      const h = host(l.resolved || l.href || '');
      if (!h || h === host(origin)) continue;
    }
  }
  const fontHosts = pages.filter((p) => /fonts\.googleapis\.com|fonts\.gstatic\.com/.test(p.bodyText || '') === false
    && (p.fontFaces || 0) === 0 && (p.preconnects || []).length === 0);
  if (fontHosts.length && fontHosts.length === pages.length && pages.length > 2) {
    push(F({
      severity: 'Low', phase: 'performance', id: 'no-preconnect',
      title: 'No preconnect hints anywhere on the site',
      where: `${pages.length} pages checked`,
      what: 'No rel=preconnect or dns-prefetch on any crawled page.',
      why: 'Performance stage. Every third-party origin costs a DNS lookup, a TCP handshake and a TLS negotiation before the first byte. A preconnect moves that cost off the critical path.',
      fix: 'Add preconnect for the two or three third-party origins that serve above-the-fold resources — typically a font host and an image CDN. Do not add more than four; each one costs a connection.',
      owner: 'dev', effort: 'S', evidence: 'inferred', urls: [],
    }));
  }

  return out;
}
