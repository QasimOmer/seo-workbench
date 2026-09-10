/* New-site planning.
   There is nothing to audit before a site exists, so the finding-based phases
   don't apply. What replaces them is the set of decisions that are cheap now
   and expensive later — most audit work on established sites is undoing choices
   someone made in week one.

   Everything here is computed locally from the clusters and constraints you
   give it. No crawl, no network. */

export const PHASES = [
  { id: 'expect', n: 1, label: 'Set expectations', why: 'Agree the timeline before planning anything, because every decision downstream depends on it.' },
  { id: 'position', n: 2, label: 'Positioning', why: 'What the business sells, to whom, where — and the constraints that decide the rest.' },
  { id: 'demand', n: 3, label: 'Demand research', why: 'Clusters, filtered hard for what a site with no authority can actually win.' },
  { id: 'architecture', n: 4, label: 'Architecture', why: 'Clusters become URLs, depth and taxonomy. The longest-lived consequences of the whole build.' },
  { id: 'technical', n: 5, label: 'Technical foundation', why: 'Rendering strategy, canonicals, sitemaps, staging — decided before anyone writes a template.' },
  { id: 'content', n: 6, label: 'Content order', why: 'One cluster finished beats eight scattered pages, so the order matters more than the rate.' },
  { id: 'launch', n: 7, label: 'Launch', why: 'The checklist that stops a surviving staging noindex from erasing the launch.' },
];

/* ── expectations ─────────────────────────────────────────────────────────── */

/** The honest timeline. Stated first because it makes the strategy defensible
    in month four when nothing has happened yet. */
export function expectations({ competitiveness = 'medium', hasBrand = false, isRebuild = false } = {}) {
  const window = isRebuild ? '1–3 months to recover, if redirects are clean'
    : competitiveness === 'low' ? '3–6 months for first meaningful rankings'
    : competitiveness === 'high' ? '9–18 months for anything competitive'
    : '6–12 months for meaningful rankings on competitive terms';

  return {
    window,
    statement: isRebuild
      ? `A rebuild keeps its accumulated trust as long as URLs and redirects are handled properly. Expect ${window}. The risk here is not slowness, it is a botched migration erasing history — the redirect map is the whole job.`
      : `A new domain with no presence will not rank meaningfully for competitive terms for roughly ${window}, regardless of execution quality. This is not a penalty or a sandbox — trust and links accumulate slowly and there is no shortcut.`,
    strategy: isRebuild
      ? 'Preserve first, improve second. Map every URL that had traffic or links before changing anything.'
      : 'Asymmetric: target long-tail and underserved clusters where a new site can genuinely win, and treat head terms as an 18-month goal. Early wins come from queries the incumbents ignored, not from queries they own.',
    warning: 'Anyone promising traffic in month two is selling something.',
    ...(hasBrand ? { note: 'Existing brand recognition shortens this for branded queries only. It does nothing for the non-branded terms that carry the growth.' } : {}),
  };
}

/* ── information architecture ─────────────────────────────────────────────── */

const slug = (s) => String(s).toLowerCase().trim()
  .replace(/['’]/g, '').replace(/&/g, 'and')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

/** Which template a cluster becomes, from its intent. Decides URL shape,
    schema and where it sits in the tree. */
function templateFor(cluster) {
  const t = `${cluster.label} ${cluster.intent || ''}`.toLowerCase();
  if (/\bbuy|price|cost|order|quote|hire|book\b/.test(t) || cluster.intent === 'transactional') return 'service';
  if (/\bbest|top|review|compare|vs\b/.test(t) || cluster.intent === 'commercial') return 'comparison';
  if (/\bnear me|in [a-z]|location|branch\b/.test(t)) return 'location';
  if (/\bhow|what|why|guide|tutorial\b/.test(t) || cluster.intent === 'informational') return 'article';
  return 'article';
}

const TEMPLATE_RULES = {
  service:    { base: '', depth: 1, schema: ['Service', 'BreadcrumbList'], indexable: true },
  comparison: { base: '', depth: 2, schema: ['Article', 'BreadcrumbList'], indexable: true },
  location:   { base: 'locations', depth: 2, schema: ['LocalBusiness', 'BreadcrumbList'], indexable: true },
  article:    { base: 'guides', depth: 2, schema: ['Article', 'BreadcrumbList'], indexable: true },
};

/**
 * Turns clusters into a URL plan with pillar/spoke shape and linking rules.
 * Subfolders throughout — subdomains split authority, and changing that later
 * is a full migration.
 */
export function architecture(clusters = [], { origin = 'https://example.com', blogBase = 'guides' } = {}) {
  if (!clusters.length) throw new Error('Architecture is built from clusters. Do the demand research first — without it this is just guessing at a sitemap.');

  const byTemplate = {};
  for (const c of clusters) {
    const tpl = templateFor(c);
    (byTemplate[tpl] ||= []).push({ ...c, template: tpl });
  }

  /* Pillar and spoke is per TOPIC, not per template. A cluster that needs six
     pages becomes one pillar and five spokes underneath it — that is the shape
     the playbook describes, and grouping by template instead produced a flat
     list of spokes with nothing to anchor them. */
  const pages = [];
  const hubs = [];

  for (const [tpl, list] of Object.entries(byTemplate)) {
    const rule = TEMPLATE_RULES[tpl];
    const base = tpl === 'article' ? blogBase : rule.base;

    // A section index only earns its place once several topics share it.
    if (list.length > 1 && base) {
      hubs.push({
        url: `${origin}/${base}/`,
        role: 'section',
        template: `${tpl}-index`,
        cluster: '—',
        depth: 1,
        schema: ['BreadcrumbList', 'CollectionPage'],
        indexable: true,
        purpose: `Groups the ${tpl} topics and passes authority into them. Needs real introductory content, not just a list of links.`,
      });
    }

    for (const c of [...list].sort((a, b) => (b.value || 0) - (a.value || 0))) {
      const root = slug(c.label);
      const count = Math.max(1, Math.min(Number(c.pages) || 1, 40));
      const prefix = base ? `/${base}/${root}` : `/${root}`;
      const depth = base ? 2 : 1;

      pages.push({
        url: `${origin}${prefix}/`,
        cluster: c.label,
        query: c.primary || c.label,
        intent: c.intent || 'informational',
        template: tpl,
        role: count > 1 ? 'pillar' : 'standalone',
        depth,
        schema: rule.schema,
        indexable: rule.indexable,
        linksTo: base ? [`${origin}/${base}/`] : [`${origin}/`],
        purpose: count > 1
          ? `Anchors the "${c.label}" topic. Covers the whole subject at a level that stands alone, and links down to all ${count - 1} supporting pages.`
          : `Serves "${c.label}" on its own — no supporting pages planned, so it must answer the query completely.`,
      });

      // Spokes: named as placeholders because the subtopics come out of the
      // SERP read, which is a human step the tool cannot do for you.
      for (let i = 1; i < count; i++) {
        pages.push({
          url: `${origin}${prefix}/subtopic-${i}/`,
          cluster: c.label,
          query: `(subtopic ${i} of "${c.label}" — name it from the SERP and People Also Ask)`,
          intent: c.intent || 'informational',
          template: tpl,
          role: 'spoke',
          depth: depth + 1,
          schema: rule.schema,
          indexable: rule.indexable,
          linksTo: [`${origin}${prefix}/`],
          purpose: 'Answers one sub-question in depth and links up to the pillar. Rename the slug once you have read the SERP — these are placeholders, not suggestions.',
        });
      }
    }
  }

  const all = [...hubs, ...pages];
  const deep = all.filter((p) => p.depth > 3);

  return {
    origin,
    pages: all,
    counts: {
      total: all.length,
      sections: hubs.length,
      pillars: pages.filter((p) => p.role === 'pillar').length,
      spokes: pages.filter((p) => p.role === 'spoke').length,
      standalone: pages.filter((p) => p.role === 'standalone').length,
    },
    urlPattern: {
      rule: 'lowercase, hyphenated, no dates, no IDs, no stop words. Trailing slash consistently present or consistently absent — pick one and enforce it with a redirect.',
      example: `${origin}/${blogBase}/how-to-choose-a-supplier/`,
      avoid: `${origin}/2026/03/post-id-4471?cat=12 — dates age the URL, IDs mean nothing, and parameters create duplicates.`,
    },
    depth: deep.length
      ? { ok: false, note: `${deep.length} page(s) would sit deeper than three clicks. Add hub links or flatten the structure now — depth is far cheaper to fix on paper than after launch.` }
      : { ok: true, note: 'Every page is within three clicks of the homepage. Design the navigation to keep it that way rather than fixing depth later.' },
    taxonomy: {
      rule: 'Decide which category, tag and archive pages are indexable before anyone builds them.',
      recommend: 'Index category pages only where they carry unique introductory content. Set tag archives and paginated pages beyond page one to noindex, follow. Uncontrolled taxonomies are the leading cause of index bloat on CMS-driven sites.',
    },
    linking: {
      rule: sorted_rule(byTemplate),
      note: 'Put this in the template. Manual internal linking degrades the moment someone else adds a page.',
    },
    international: 'If more than one language or country is planned, decide subfolder vs subdomain vs ccTLD now. Subfolders concentrate authority and are right in nearly all cases. Changing this later is a full migration.',
  };
}

const sorted_rule = (byTemplate) => {
  const withSpokes = Object.values(byTemplate).flat().filter((c) => (Number(c.pages) || 1) > 1);
  return withSpokes.length
    ? `Every spoke links up to its pillar and sideways to the two or three most closely related spokes. Each pillar links down to all of its spokes. Build this into the template — manual internal linking degrades the moment someone else adds a page.`
    : 'No cluster needs more than one page yet, so there is no pillar-and-spoke shape to enforce. Link every page to the homepage and to its closest topical neighbour.';
};

/* ── technical foundation ─────────────────────────────────────────────────── */

/**
 * The Phase 4 spec, tailored to the stack. Rendering is separated out because
 * it is the single biggest decision and the only one with a silent failure mode.
 */
export function technicalSpec({ platform = 'unknown', rendering = 'unknown', hasStaging = true, multilingual = false, local = false } = {}) {
  const decisions = [];
  const D = (area, decision, why, severity = 'required') => decisions.push({ area, decision, why, severity });

  if (rendering === 'csr' || rendering === 'unknown') {
    D('Rendering', rendering === 'csr'
      ? 'Move to server-side rendering or static generation before launch.'
      : 'Choose server-side rendering or static generation, not client-only.',
      'The biggest single decision here, and the only one whose failure is silent: with client-only rendering, content exists for users and not reliably for Google. Every other item on this list is recoverable in an afternoon. This one is the architecture.',
      'critical');
  } else {
    D('Rendering', `${rendering === 'ssg' ? 'Static generation' : 'Server-side rendering'} confirmed.`,
      'Removes an entire class of indexing risk for the life of the site.', 'done');
  }

  if (hasStaging) {
    D('Staging', 'Staging blocked from crawling; production not. Put "remove the staging noindex" in the launch checklist as an explicit step with a named owner.',
      'A surviving staging noindex is the most common catastrophic launch failure. It is silent, it looks like nothing happened, and it can go unnoticed for weeks.',
      'critical');
  }

  D('HTTPS', 'HTTPS from day one, HSTS once you are confident, no mixed content.',
    'Cheap now. A protocol migration later is a redirect exercise across every URL.');
  D('Canonicals', 'Self-referencing canonical on every indexable template, emitted by the template rather than per page.',
    'Stops parameter and trailing-slash variants becoming duplicates the day someone adds a filter.');
  D('Sitemap', 'Generated automatically from canonical, indexable URLs. Never hand-maintained.',
    'A hand-maintained sitemap is wrong within a month, and a sitemap full of non-canonical URLs teaches Google to ignore it.');
  D('robots.txt', 'Allow all asset paths. Block only genuine private routes such as cart, checkout and account.',
    'Blocked CSS or JS makes Googlebot render a broken layout and judge that instead of your page.');
  D('Navigation', 'Real <a href> elements, not JavaScript click handlers.',
    'A link Googlebot cannot follow is a page it cannot find. This is a template decision, not a content one.');
  D('Core Web Vitals', 'Set budgets before the design gets heavy: LCP under 2.5s, CLS under 0.1, INP under 200ms on mobile.',
    'Retrofitting performance onto a finished design costs far more than constraining it during the build.');
  D('Images', 'Modern formats, explicit width and height on every image, lazy-load below the fold only.',
    'Explicit dimensions protect CLS. Lazy-loading the hero image actively damages LCP — a common and self-inflicted problem.');
  D('Measurement', 'Verify Search Console and analytics BEFORE launch.',
    'Post-launch verification loses the baseline permanently, and the baseline is what tells you whether launch went well.',
    'critical');

  if (multilingual) {
    D('International', 'Subfolders per language, with reciprocal hreflang including a self-reference and an x-default.',
      'Non-reciprocal hreflang is ignored entirely. Subdomains and ccTLDs split authority for no benefit in most cases.');
  }
  if (local) {
    D('Local', 'Google Business Profile created and verified, NAP consistent everywhere, LocalBusiness schema at template level.',
      'For a service-area business this is a whole workstream, and proximity outweighs page content in the local pack.');
  }
  if (platform === 'wordpress') {
    D('Platform', 'Decide which plugin owns canonicals, titles and sitemaps — exactly one. Turn off the others.',
      'Two plugins emitting canonicals is the most common duplicate-tag problem on WordPress, and it is invisible in the editor.');
  }

  return {
    decisions,
    critical: decisions.filter((d) => d.severity === 'critical'),
    note: 'These are template-level decisions. Made now they cost nothing; made after launch each one is a migration with real risk.',
  };
}

/* ── content production order ─────────────────────────────────────────────── */

/**
 * Publication order, not rate. One cluster completed beats eight scattered
 * pages, because topical depth gives a coherent signal about what the site is
 * for — and a new site has nothing else to offer.
 */
export function productionOrder(clusters = [], { pagesPerWeek = 2 } = {}) {
  if (!clusters.length) throw new Error('Nothing to order yet — build the cluster list first.');

  const scored = clusters.map((c) => ({
    ...c,
    // Winnability first: a new site cannot enter a cluster the incumbents own.
    score: (c.winnability ?? 3) * 3 + (c.value ?? 3) * 2 - (c.difficulty ?? 3),
  })).sort((a, b) => b.score - a.score);

  let week = 1, used = 0;
  const waves = [];
  for (const c of scored) {
    const size = c.pages || 1;
    waves.push({
      cluster: c.label,
      pages: size,
      startWeek: week,
      endWeek: week + Math.max(0, Math.ceil(size / pagesPerWeek) - 1),
      why: `Winnability ${c.winnability ?? 3}/5, value ${c.value ?? 3}/5. ${
        (c.winnability ?? 3) >= 4 ? 'A site with no authority can realistically enter this one.'
          : 'Harder to enter — worth doing, but not first.'}`,
    });
    week += Math.ceil(size / pagesPerWeek);
    used += size;
  }

  return {
    waves, totalPages: used, weeks: week - 1, pagesPerWeek,
    rule: 'Finish one cluster before starting the next. A complete cluster of eight pages outperforms eight pages spread across eight topics, and on a new domain that coherence is the only signal you control.',
  };
}
