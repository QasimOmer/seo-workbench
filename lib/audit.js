import { jaccard, pixelWidth, normaliseUrl } from './parse.js';
import { extraChecks } from './audit-extra.js';

/**
 * Every rule returns findings in the canon's finding shape:
 *   { severity, title, where, what, why, fix, owner, effort, phase, urls[] }
 *
 * Ordering follows the priority ladder, not the rule order. Eligibility
 * failures outrank everything because everything below them is wasted.
 */

const LADDER = {
  eligibility: 1, indexation: 2, intent: 3, onpage: 4,
  linking: 5, schema: 6, performance: 7, offpage: 8,
};
const SEV_RANK = { Critical: 0, High: 1, Medium: 2, Low: 3 };

const F = (o) => ({ owner: 'dev', effort: 'S', urls: [], ...o });

const YMYL_HINT = /\b(lawyer|attorney|legal|law|injury|malpractice|medical|doctor|health|clinic|insurance|loan|mortgage|tax|financial|invest|billing|claim)\b/i;
const GENERIC_ANCHOR = /^(click here|read more|learn more|more|here|this|link|continue|see more|view|details|read on|find out more)\.?$/i;
const BLOAT_PATTERN = /\/(tag|author|feed|search|page\/\d+|attachment|wp-json|\?s=|category\/uncategorized)/i;

export function runAudit(crawl, ctx = {}) {
  const findings = [];
  const pages = crawl.pages || [];
  const html = pages.filter((p) => /text\/html/i.test(p.contentType || '') && p.status === 200);
  const money = new Set((ctx.moneyUrls || []).map((u) => normaliseUrl(u, crawl.origin)).filter(Boolean));
  const isMoney = (u) => money.size === 0 || money.has(u);

  const push = (...f) => f.forEach((x) => x && findings.push(x));

  // ═══════════════════════════════ PHASE 1 — ELIGIBILITY ═══════════════════════

  // robots.txt missing or erroring
  if (crawl.robotsStatus !== 200) {
    push(F({
      severity: crawl.robotsStatus >= 500 ? 'High' : 'Low',
      phase: 'eligibility', id: 'robots-missing',
      title: crawl.robotsStatus >= 500 ? 'robots.txt returns a server error' : 'No robots.txt found',
      where: `${crawl.origin}/robots.txt`,
      what: `The file returned HTTP ${crawl.robotsStatus || 'no response'}.`,
      why: crawl.robotsStatus >= 500
        ? 'Crawl stage. A 5xx on robots.txt makes Google pause crawling the whole host until it resolves — this is the one file where a server error stops everything.'
        : 'Crawl stage. Absence is treated as full allow, so nothing is blocked, but you also have no sitemap declaration and no control point.',
      fix: crawl.robotsStatus >= 500
        ? 'Fix the 5xx. robots.txt must return 200 or 404, never 5xx.'
        : `Add a robots.txt at the origin with a Sitemap: line pointing at ${crawl.origin}/sitemap.xml.`,
      effort: 'S',
    }));
  }

  // sitewide or path-level Disallow: /
  const globalBlock = (crawl.robots?.groups || []).find((g) =>
    g.rules.some((r) => r.type === 'disallow' && (r.path === '/' || r.path === '/*')));
  if (globalBlock) {
    push(F({
      severity: 'Critical', phase: 'eligibility', id: 'robots-disallow-all',
      title: 'robots.txt disallows the entire site',
      where: `${crawl.origin}/robots.txt — group for user-agent: ${globalBlock.agents.join(', ')}`,
      what: 'A `Disallow: /` rule is live and applies to that user-agent group.',
      why: 'Crawl stage. Nothing below this matters. This is the classic staging rule surviving a launch, and it silently removes the site from search over the following weeks.',
      fix: 'Remove the `Disallow: /` line. Deploy, then use Search Console\'s robots.txt report to confirm Google has refetched it, and request indexing on the top templates.',
      owner: 'dev', effort: 'S',
    }));
  }

  // blocked CSS/JS
  const blockedAssets = (crawl.robots?.groups || []).flatMap((g) => g.rules)
    .filter((r) => r.type === 'disallow' && /\.(css|js)|\/wp-includes|\/wp-content\/(themes|plugins)/i.test(r.path));
  if (blockedAssets.length) {
    push(F({
      severity: 'High', phase: 'eligibility', id: 'robots-blocked-assets',
      title: 'robots.txt blocks CSS or JavaScript',
      where: `${crawl.origin}/robots.txt`,
      what: `Blocking rules: ${blockedAssets.map((r) => r.path).join(', ')}`,
      why: 'Render stage. Google renders the page to index it. Blocked stylesheets and scripts mean it renders a broken page and may misjudge layout, mobile-friendliness, and any content those scripts inject.',
      fix: 'Stop disallowing the directories your CSS and JS are served from. Google renders the page before judging it, so blocked assets make it score a broken layout. Block only genuine admin and checkout paths, and allow any asset path your templates reference.',
      owner: 'dev', effort: 'S',
    }));
  }

  // the noindex + Disallow trap
  const trap = html.filter((p) => p.noindex && !p.robotsAllowed);
  if (trap.length) {
    push(F({
      severity: 'High', phase: 'eligibility', id: 'noindex-disallow-trap',
      title: 'Pages carry noindex but are also blocked in robots.txt',
      where: `${trap.length} URL(s), e.g. ${trap[0].url}`,
      what: 'The URL is disallowed in robots.txt and also serves a noindex directive.',
      why: 'Crawl stage. This is the opposite of belt and braces. Because the fetch is blocked, Google never sees the noindex, and can still index the URL from external links — with no snippet, since it never read the page.',
      fix: 'Pick one. To deindex: remove the robots.txt block so the noindex can be read, wait for the URLs to drop out, then re-block if you want to save crawl budget. To index: remove both.',
      owner: 'dev', effort: 'S', urls: trap.map((p) => p.url).slice(0, 50),
    }));
  }

  // unexpected noindex
  const noindexed = html.filter((p) => p.noindex && p.robotsAllowed && !BLOAT_PATTERN.test(p.url));
  if (noindexed.length) {
    const share = noindexed.length / Math.max(1, html.length);
    push(F({
      severity: share > 0.5 ? 'Critical' : 'High', phase: 'eligibility', id: 'noindex-present',
      title: share > 0.5 ? 'Sitewide noindex is live' : 'noindex on pages that look like they should be indexed',
      where: `${noindexed.length} of ${html.length} crawled pages, e.g. ${noindexed.slice(0, 3).map((p) => p.url).join(', ')}`,
      what: `Directive source: ${noindexed[0].xRobotsTag ? `X-Robots-Tag header (${noindexed[0].xRobotsTag})` : `meta robots (${noindexed[0].metaRobots.map((m) => m.content).join('; ')})`}`,
      why: 'Index stage. These pages cannot rank at all. The usual cause is a sitewide noindex switch left on from staging — most CMSs and site builders have one, and it survives launch far more often than anyone expects.',
      fix: 'Check Settings → Reading first. Then check the SEO plugin\'s per-post-type indexing settings and any server-level X-Robots-Tag. Remove the directive, then request indexing for the top templates.',
      owner: 'dev', effort: 'S', urls: noindexed.map((p) => p.url).slice(0, 50),
    }));
  }

  // non-200 pages reachable by internal links
  const broken = pages.filter((p) => p.status >= 400 || p.status === 0);
  if (broken.length) {
    const server = broken.filter((p) => p.status >= 500 || p.status === 0);
    push(F({
      severity: server.length ? 'Critical' : 'High', phase: 'eligibility', id: 'broken-links',
      title: `${broken.length} internal URL(s) return an error`,
      where: broken.slice(0, 5).map((p) => `${p.url} → ${p.status || p.error}`).join('\n          '),
      what: `${broken.filter((p) => p.status === 404).length} × 404, ${server.length} × 5xx/timeout.`,
      why: 'Crawl stage. Link equity stops here, users hit dead ends, and 5xx responses in particular cause Google to slow crawling of the whole host.',
      fix: 'For each: either restore the page, 301 it to the closest live equivalent, or remove the internal links pointing at it. Do not blanket-redirect 404s to the homepage — that produces soft 404s.',
      owner: 'dev', effort: 'M',
      urls: broken.map((p) => `${p.url} [${p.status || p.error}] ← ${(p.linkedFrom || [])[0] || 'sitemap'}`).slice(0, 60),
    }));
  }

  // redirect chains
  const chains = pages.filter((p) => p.hops > 1);
  if (chains.length) {
    push(F({
      severity: 'Medium', phase: 'eligibility', id: 'redirect-chains',
      title: `${chains.length} URL(s) redirect through more than one hop`,
      where: chains.slice(0, 4).map((p) => p.redirectChain.map((c) => c.from).concat(p.finalUrl).join(' → ')).join('\n          '),
      what: `Longest chain: ${Math.max(...chains.map((p) => p.hops))} hops.`,
      why: 'Crawl stage. Each hop loses a little signal and adds latency. Chains also break silently when one link in the middle is removed later.',
      fix: 'Rewrite each rule to point at the final destination directly. Then update the internal links so they target the destination and the redirect is only serving external traffic.',
      owner: 'dev', effort: 'M', urls: chains.map((p) => p.redirectChain.map((c) => c.from).concat(p.finalUrl).join(' → ')).slice(0, 40),
    }));
  }

  // internal links pointing at redirects
  const redirectTargets = new Set(pages.filter((p) => p.hops > 0).map((p) => p.url));
  const linksToRedirects = [];
  for (const p of html) {
    for (const l of p.links || []) {
      if (l.resolved && redirectTargets.has(l.resolved)) linksToRedirects.push({ from: p.url, to: l.resolved });
    }
  }
  if (linksToRedirects.length > 3) {
    push(F({
      severity: 'Low', phase: 'eligibility', id: 'internal-links-to-redirects',
      title: `${linksToRedirects.length} internal links point at a redirecting URL`,
      where: linksToRedirects.slice(0, 4).map((l) => `${l.from} → ${l.to}`).join('\n          '),
      what: 'Internal links target URLs that 301 rather than the final destination.',
      why: 'Crawl stage. Harmless individually, wasteful at scale, and it hides the fact that the redirect is load-bearing when someone later deletes the rule.',
      fix: 'Update the links at source — in page content, navigation and templates — rather than relying on the redirect. A find-and-replace across your content store handles the bulk; check hand-built nav and footer links separately.',
      owner: 'dev', effort: 'M', urls: linksToRedirects.slice(0, 40).map((l) => `${l.from} → ${l.to}`),
    }));
  }

  // HTTPS
  const insecure = html.filter((p) => (p.insecureRefs || []).length);
  if (insecure.length) {
    push(F({
      severity: 'Medium', phase: 'eligibility', id: 'mixed-content',
      title: 'Mixed content on HTTPS pages',
      where: `${insecure.length} page(s), e.g. ${insecure[0].url}`,
      what: `Insecure references, e.g. ${insecure[0].insecureRefs.slice(0, 2).join(', ')}`,
      why: 'Serve stage. Browsers block or downgrade these resources, so the page a user sees is not the page you built. It also undermines the trust signals the padlock carries.',
      fix: 'Rewrite the http:// references to https://. Find-and-replace across templates and stored content, then add an upgrade-insecure-requests CSP header as a backstop for anything you miss.',
      owner: 'dev', effort: 'S', urls: insecure.map((p) => p.url).slice(0, 30),
    }));
  }
  if (crawl.origin.startsWith('http://')) {
    push(F({
      severity: 'Critical', phase: 'eligibility', id: 'no-https',
      title: 'Site is served over HTTP',
      where: crawl.origin,
      what: 'The crawl origin is not HTTPS.',
      why: 'Serve stage. HTTPS is a confirmed (if light) ranking signal, browsers mark the site as not secure, and forms on it will be flagged.',
      fix: 'Install a certificate, force HTTPS with a single 301 from every http:// URL to its https:// equivalent, and update the canonical, sitemap, and Search Console property.',
      owner: 'dev', effort: 'M',
    }));
  }

  // soft 404 heuristic
  const soft404 = html.filter((p) =>
    p.status === 200 && p.wordCount < 60 &&
    /\b(not found|no results|nothing found|page (doesn'?t|does not) exist|404)\b/i.test(`${p.title} ${p.h1s?.join(' ')} ${(p.bodyText || '').slice(0, 500)}`));
  if (soft404.length) {
    push(F({
      severity: 'High', phase: 'eligibility', id: 'soft-404',
      title: `${soft404.length} likely soft 404(s)`,
      where: soft404.slice(0, 4).map((p) => p.url).join('\n          '),
      what: 'Pages return HTTP 200 while their content says nothing was found.',
      why: 'Index stage. Google detects these and reports them as soft 404s in Page Indexing. They consume crawl budget and can dilute quality signals across the template.',
      fix: 'Return a real 404 or 410 status for these URLs. If a redirect is more appropriate, 301 to the closest genuine equivalent rather than to the homepage.',
      owner: 'dev', effort: 'M', urls: soft404.map((p) => p.url),
    }));
  }

  // ═══════════════════════════════ PHASE 2 — INDEXATION ════════════════════════

  const indexable = html.filter((p) => !p.noindex && p.robotsAllowed);

  const noCanonical = indexable.filter((p) => !p.canonical);
  if (noCanonical.length) {
    push(F({
      severity: 'Medium', phase: 'indexation', id: 'canonical-missing',
      title: `${noCanonical.length} indexable page(s) have no canonical tag`,
      where: noCanonical.slice(0, 4).map((p) => p.url).join('\n          '),
      what: 'No rel=canonical in the HTML or the Link header.',
      why: 'Index stage. Without one, Google picks a canonical itself. It usually picks correctly, but on sites with parameter or trailing-slash variants it routinely does not — and you have no signal in the fight.',
      fix: 'Emit a self-referencing absolute canonical on every indexable page. Yoast and Rank Math both do this by default; if they are installed and it is missing, a theme or plugin is stripping the head.',
      owner: 'dev', effort: 'S', urls: noCanonical.map((p) => p.url).slice(0, 40),
    }));
  }

  const crossCanonical = indexable.filter((p) => p.canonical && p.canonical !== p.url && !BLOAT_PATTERN.test(p.url));
  if (crossCanonical.length) {
    const bad = crossCanonical.filter((p) => {
      const target = pages.find((x) => x.url === p.canonical);
      return target && (target.status >= 300 || target.noindex);
    });
    push(F({
      severity: bad.length ? 'High' : 'Medium', phase: 'indexation', id: 'canonical-cross',
      title: `${crossCanonical.length} page(s) canonicalise to a different URL`,
      where: crossCanonical.slice(0, 4).map((p) => `${p.url}\n            → canonical: ${p.canonical}`).join('\n          '),
      what: bad.length
        ? `${bad.length} of them point at a URL that redirects or is noindexed — a broken canonical target.`
        : 'Content is being consolidated onto another URL.',
      why: 'Index stage. Intentional consolidation is fine. A canonical pointing at a redirecting, 404ing, or noindexed URL is a conflicting signal, and Google resolves conflicts by ignoring your hint entirely.',
      fix: 'Confirm each target is a 200, indexable, self-canonical URL. Where the consolidation was not intended, switch the tag to self-referencing. Verify with URL Inspection which canonical Google actually chose — it overrides yours routinely.',
      owner: 'dev', effort: 'M', urls: crossCanonical.map((p) => `${p.url} → ${p.canonical}`).slice(0, 40),
    }));
  }

  const multiCanonical = html.filter((p) => (p.canonicals || []).length > 1 && new Set(p.canonicals).size > 1);
  if (multiCanonical.length) {
    push(F({
      severity: 'High', phase: 'indexation', id: 'canonical-conflict',
      title: `${multiCanonical.length} page(s) declare conflicting canonicals`,
      where: multiCanonical.slice(0, 3).map((p) => `${p.url}: ${p.canonicals.join(' | ')}`).join('\n          '),
      what: 'More than one rel=canonical with different values on the same page.',
      why: 'Index stage. Google ignores all of them when they conflict, so you have handed the choice back to the algorithm. Usually two plugins, or a plugin plus a hardcoded theme tag.',
      fix: 'Find the second emitter. Disable each candidate — SEO plugin, theme template, framework head component — one at a time to see which output disappears, then remove the duplicate at source.',
      owner: 'dev', effort: 'M', urls: multiCanonical.map((p) => p.url),
    }));
  }

  // duplicate + near-duplicate content
  const byHash = groupBy(indexable.filter((p) => p.wordCount > 80), (p) => p.contentHash);
  const exactDupes = Object.values(byHash).filter((g) => g.length > 1);
  if (exactDupes.length) {
    push(F({
      severity: 'High', phase: 'indexation', id: 'duplicate-content',
      title: `${exactDupes.length} set(s) of URLs serve identical content`,
      where: exactDupes.slice(0, 3).map((g) => g.map((p) => p.url).join('\n            ')).join('\n          ─\n          '),
      what: `${exactDupes.reduce((n, g) => n + g.length, 0)} URLs across ${exactDupes.length} sets.`,
      why: 'Index stage. There is no duplicate content penalty — this is a consolidation problem. Google picks one URL and may not pick the one you want, and the signals from the others are only partly transferred.',
      fix: 'Decide the canonical URL for each set. Either 301 the others to it, or canonicalise them to it if they must stay reachable. Then fix the internal links and sitemap so they agree.',
      owner: 'dev', effort: 'M',
      urls: exactDupes.flatMap((g) => g.map((p) => p.url)).slice(0, 40),
    }));
  }

  const nearDupes = findNearDuplicates(indexable, 0.85);
  if (nearDupes.length) {
    push(F({
      severity: 'Medium', phase: 'indexation', id: 'near-duplicate',
      title: `${nearDupes.length} page pair(s) are near-identical`,
      where: nearDupes.slice(0, 4).map((d) => `${Math.round(d.score * 100)}% — ${d.a}\n                 ${d.b}`).join('\n          '),
      what: 'Body content overlaps above 85% between pairs of distinct URLs.',
      why: 'Index stage plus rank stage. Templated pages with only a name or city swapped compete with each other and none of them accumulate enough distinct signal to win. This is the classic multi-location failure.',
      fix: 'Differentiate genuinely — local proof, distinct case examples, different FAQs, real photographs — or consolidate into one page and serve the variants as sections. A template with the city swapped is not a differentiated page.',
      owner: 'content', effort: 'L', urls: nearDupes.map((d) => `${Math.round(d.score * 100)}% ${d.a} ≈ ${d.b}`).slice(0, 30),
    }));
  }

  // trailing slash / case variants
  const variants = findUrlVariants(pages);
  if (variants.length) {
    push(F({
      severity: 'Medium', phase: 'indexation', id: 'url-variants',
      title: `${variants.length} URL(s) resolve under more than one form`,
      where: variants.slice(0, 4).map((v) => v.join('  ↔  ')).join('\n          '),
      what: 'Trailing-slash, uppercase, or index-file variants are both reachable and both return 200.',
      why: 'Index stage. Each variant is a separate URL to Google. They split link signals and inflate the indexed count.',
      fix: 'Pick one form and 301 the others to it at the server level. Then make internal links, the sitemap, and the canonical all emit the chosen form.',
      owner: 'dev', effort: 'M', urls: variants.map((v) => v.join(' ↔ ')).slice(0, 30),
    }));
  }

  // sitemap hygiene
  if (crawl.sitemap?.length) {
    const smSet = new Set(crawl.sitemap.map((s) => s.loc));
    const pageByUrl = new Map(pages.map((p) => [p.url, p]));
    const smBad = crawl.sitemap.filter((s) => {
      const p = pageByUrl.get(s.loc);
      return p && (p.status !== 200 || p.noindex || (p.canonical && p.canonical !== p.url));
    });
    if (smBad.length) {
      push(F({
        severity: 'Medium', phase: 'indexation', id: 'sitemap-dirty',
        title: `${smBad.length} sitemap URL(s) are not canonical, indexable 200s`,
        where: smBad.slice(0, 5).map((s) => { const p = pageByUrl.get(s.loc); return `${s.loc} [${p.status}${p.noindex ? ', noindex' : ''}${p.canonical && p.canonical !== p.url ? ', canonicalised away' : ''}]`; }).join('\n          '),
        what: 'The sitemap lists URLs that redirect, error, carry noindex, or canonicalise elsewhere.',
        why: 'Index stage. A sitemap is a statement about which URLs you consider canonical. Contradicting it with the canonical tags weakens both signals and wastes crawl budget.',
        fix: 'Regenerate the sitemap to include only canonical, indexable, 200-returning URLs. If the SEO plugin generates it, exclude the offending post types or taxonomies in its settings rather than post-processing the file.',
        owner: 'dev', effort: 'S', urls: smBad.map((s) => s.loc).slice(0, 40),
      }));
    }

    const lastmods = crawl.sitemap.map((s) => s.lastmod).filter(Boolean);
    const uniqueDays = new Set(lastmods.map((d) => String(d).slice(0, 10)));
    if (lastmods.length > 15 && uniqueDays.size <= 2) {
      push(F({
        severity: 'Low', phase: 'indexation', id: 'sitemap-lastmod',
        title: 'Every sitemap entry shares the same lastmod date',
        where: 'XML sitemap',
        what: `${lastmods.length} entries across only ${uniqueDays.size} distinct date(s).`,
        why: 'Crawl stage. lastmod is a hint about what changed. When everything changes at once on every regeneration, Google learns the field carries no information and stops using it.',
        fix: 'Emit each URL\'s genuine last-modified date rather than the build time. A uniform date across every entry usually means the sitemap is generated fresh on each request, or a cache layer is rewriting it.',
        owner: 'dev', effort: 'S',
      }));
    }
    const missingFromSitemap = indexable.filter((p) => !smSet.has(p.url) && p.status === 200 && !BLOAT_PATTERN.test(p.url));
    if (missingFromSitemap.length > 2) {
      push(F({
        severity: 'Low', phase: 'indexation', id: 'sitemap-incomplete',
        title: `${missingFromSitemap.length} indexable page(s) are absent from the sitemap`,
        where: missingFromSitemap.slice(0, 5).map((p) => p.url).join('\n          '),
        what: 'Crawled, indexable, 200-returning URLs that the sitemap does not list.',
        why: 'Crawl stage. Submitting a sitemap aids discovery and guarantees nothing, so this is not why a page is unindexed — but on a large or shallow-linked site it delays discovery for no reason.',
        fix: 'Include these post types in the sitemap configuration. If they are deliberately excluded, confirm the exclusion is intentional and matches the indexing directives.',
        owner: 'dev', effort: 'S', urls: missingFromSitemap.map((p) => p.url).slice(0, 40),
      }));
    }
  } else {
    push(F({
      severity: 'Medium', phase: 'indexation', id: 'sitemap-absent',
      title: 'No XML sitemap found',
      where: `${crawl.origin}/sitemap.xml, /sitemap_index.xml, /wp-sitemap.xml, and robots.txt`,
      what: 'None of the conventional locations returned a parseable sitemap and robots.txt declares none.',
      why: 'Crawl stage. Discovery relies entirely on internal links, so anything shallowly linked or newly published waits longer. It also removes your ability to read per-sitemap coverage in Search Console.',
      fix: 'Enable sitemap generation in the SEO plugin, declare it in robots.txt with a Sitemap: line, and submit it in Search Console.',
      owner: 'dev', effort: 'S',
    }));
  }

  // index bloat
  const bloat = indexable.filter((p) => BLOAT_PATTERN.test(p.url));
  if (bloat.length > 3) {
    push(F({
      severity: 'Medium', phase: 'indexation', id: 'index-bloat',
      title: `${bloat.length} low-value URL(s) are indexable`,
      where: bloat.slice(0, 5).map((p) => p.url).join('\n          '),
      what: 'Tag archives, author archives, attachment pages, paginated series, or search results are open to indexing.',
      why: 'Index stage. These dilute the site\'s quality profile and consume crawl budget that should go to money pages. Attachment pages in particular are pure noise.',
      fix: 'noindex them (leaving them crawlable so the directive is read), and disable attachment pages entirely — most SEO plugins have a redirect-attachment-to-parent setting. Keep tag archives only where a human curated them.',
      owner: 'dev', effort: 'S', urls: bloat.map((p) => p.url).slice(0, 40),
    }));
  }

  // ═══════════════════════ PHASE 3 — ARCHITECTURE & INTERNAL LINKS ═════════════

  const deep = indexable.filter((p) => p.depth !== null && p.depth > 3);
  if (deep.length) {
    push(F({
      severity: 'Medium', phase: 'linking', id: 'click-depth',
      title: `${deep.length} page(s) sit more than three clicks from the homepage`,
      where: deep.slice(0, 5).map((p) => `${p.url} (depth ${p.depth})`).join('\n          '),
      what: `Maximum crawl depth reached: ${Math.max(...indexable.map((p) => p.depth ?? 0))}.`,
      why: 'Crawl and rank stages. Depth is a proxy for how much internal signal reaches a page. Deep pages get crawled less often and rank worse for the same content.',
      fix: 'Add links from hub pages, relevant body content, or the main navigation so each commercially important page is within three clicks. Internal linking is the only ranking lever that requires nobody\'s permission.',
      owner: 'dev', effort: 'M', urls: deep.map((p) => `${p.url} (depth ${p.depth})`).slice(0, 40),
    }));
  }

  /* An orphan claim depends on having seen the WHOLE site. If the crawl stopped
     at its page cap, every URL it never reached looks orphaned when it is only
     unvisited — on a large site that turns into a four-figure number that is
     entirely an artefact of the cap. Report the limitation instead. */
  if (crawl.truncated) {
    push(F({
      severity: 'Medium', phase: 'linking', id: 'orphans-unknown',
      title: 'Internal linking could not be assessed — the crawl was capped',
      where: `${crawl.pages.length} of at least ${crawl.pages.length + (crawl.remainingQueue || 0)} URLs crawled`,
      what: `The crawl stopped at its page limit with ${crawl.remainingQueue} URLs still queued, so pages it never reached cannot be told apart from genuinely orphaned ones.`,
      why: 'Crawl stage. Orphan detection needs the complete link graph. A partial crawl produces a confidently wrong number here, which is worse than no number.',
      fix: 'Raise the page cap above the site size, or scope the crawl to one section and assess that section on its own.',
      owner: 'SEO', effort: 'S', evidence: 'observed', urls: [],
    }));
  }

  const orphans = crawl.truncated
    ? []
    : indexable.filter((p) => p.discoveredVia === 'sitemap' || (p.inboundCount === 0 && p.url !== crawl.startUrl));
  if (orphans.length) {
    push(F({
      severity: 'High', phase: 'linking', id: 'orphans',
      title: `${orphans.length} page(s) have no internal links pointing at them`,
      where: orphans.slice(0, 5).map((p) => p.url).join('\n          '),
      what: 'Found in the sitemap but unreachable by following links from the start URL.',
      why: 'Crawl and rank stages. An orphan receives no internal signal and is discoverable only via the sitemap. It will usually be crawled and rarely ranked.',
      fix: 'Link to each from a relevant hub, parent, or body-content mention with descriptive anchor text. If a page genuinely should not be linked, it probably should not be indexed either.',
      owner: 'dev', effort: 'M', urls: orphans.map((p) => p.url).slice(0, 40),
    }));
  }

  const thinInbound = indexable.filter((p) => p.inboundBodyCount === 0 && p.inboundCount > 0 && p.depth > 0 && isMoney(p.url));
  if (thinInbound.length > 2) {
    push(F({
      severity: 'Medium', phase: 'linking', id: 'nav-only-links',
      title: `${thinInbound.length} page(s) are linked only from navigation or footer`,
      where: thinInbound.slice(0, 5).map((p) => p.url).join('\n          '),
      what: 'Every inbound internal link comes from a sitewide nav or footer block; none from body content.',
      why: 'Rank stage. Sitewide links are heavily discounted precisely because they are sitewide. A contextual link inside relevant body copy carries far more, and carries anchor text that means something.',
      fix: 'Add contextual links from related articles and service pages, with anchors describing the destination.',
      owner: 'content', effort: 'M', urls: thinInbound.map((p) => p.url).slice(0, 30),
    }));
  }

  const genericAnchors = [];
  for (const p of html) {
    for (const l of p.links || []) {
      if (l.resolved && l.anchor && GENERIC_ANCHOR.test(l.anchor) && !l.inNav && !l.inFooter) {
        genericAnchors.push({ from: p.url, to: l.resolved, anchor: l.anchor });
      }
    }
  }
  if (genericAnchors.length > 4) {
    push(F({
      severity: 'Low', phase: 'linking', id: 'generic-anchors',
      title: `${genericAnchors.length} internal links use non-descriptive anchor text`,
      where: genericAnchors.slice(0, 5).map((a) => `"${a.anchor}" on ${a.from} → ${a.to}`).join('\n          '),
      what: 'Anchors like "click here", "read more", "learn more".',
      why: 'Rank stage. Internal anchor text is a relevance signal you control completely, and these spend it on nothing. They are also worse for screen reader users navigating by link list.',
      fix: 'Rewrite each anchor to describe where it goes — the destination\'s topic rather than "learn more" or "click here". Where the anchor comes from a template button, change the template.',
      owner: 'content', effort: 'M', urls: genericAnchors.slice(0, 40).map((a) => `"${a.anchor}" ${a.from} → ${a.to}`),
    }));
  }

  const noBreadcrumbs = indexable.filter((p) => p.depth > 1 && !p.hasBreadcrumbMarkup);
  if (noBreadcrumbs.length > 3) {
    push(F({
      severity: 'Low', phase: 'schema', id: 'breadcrumbs-missing',
      title: `${noBreadcrumbs.length} deep page(s) have no BreadcrumbList markup`,
      where: `${noBreadcrumbs.slice(0, 3).map((p) => p.url).join(', ')}${noBreadcrumbs.some((p) => p.hasBreadcrumbEl) ? '\n          (visible breadcrumbs exist on some of these but are not marked up)' : ''}`,
      what: 'No BreadcrumbList JSON-LD on pages below the top level.',
      why: 'Serve stage. Breadcrumbs replace the URL in the SERP with a readable hierarchy, which lifts click-through. They also add internal links up the hierarchy on every page.',
      fix: 'Enable breadcrumbs in the SEO plugin and output BreadcrumbList JSON-LD matching the visible trail and the URL hierarchy.',
      owner: 'dev', effort: 'S', urls: noBreadcrumbs.map((p) => p.url).slice(0, 30),
    }));
  }

  // ═══════════════════════════ PHASE 4 — CONTENT & ON-PAGE ═════════════════════

  const noTitle = indexable.filter((p) => !p.title);
  if (noTitle.length) {
    push(F({
      severity: 'High', phase: 'onpage', id: 'title-missing',
      title: `${noTitle.length} page(s) have no title tag`,
      where: noTitle.slice(0, 5).map((p) => p.url).join('\n          '),
      what: 'Empty or absent <title>.',
      why: 'Rank and serve stages. The title is the strongest on-page relevance signal and the SERP headline. Google will generate one from the page, usually badly.',
      fix: 'Write a unique title for each, leading with the primary term and matching the page\'s H1.',
      owner: 'content', effort: 'S', urls: noTitle.map((p) => p.url),
    }));
  }

  const dupTitles = Object.entries(groupBy(indexable.filter((p) => p.title), (p) => p.title.toLowerCase()))
    .filter(([, g]) => g.length > 1);
  if (dupTitles.length) {
    push(F({
      severity: 'High', phase: 'onpage', id: 'title-duplicate',
      title: `${dupTitles.length} title(s) are used on more than one page`,
      where: dupTitles.slice(0, 3).map(([t, g]) => `"${t}"\n            ${g.map((p) => p.url).join('\n            ')}`).join('\n          '),
      what: `${dupTitles.reduce((n, [, g]) => n + g.length, 0)} pages share ${dupTitles.length} titles.`,
      why: 'Rank stage. Identical titles tell Google the pages target the same thing, which is how cannibalisation starts. It is also the strongest hint that the pages themselves are undifferentiated.',
      fix: 'Give each page a title reflecting its own primary intent. If two pages genuinely target the same query, they should be one page.',
      owner: 'content', effort: 'M',
      urls: dupTitles.flatMap(([t, g]) => g.map((p) => `${p.url} — "${t}"`)).slice(0, 40),
    }));
  }

  const longTitles = indexable.filter((p) => p.title && pixelWidth(p.title) > 580);
  if (longTitles.length) {
    push(F({
      severity: 'Low', phase: 'onpage', id: 'title-length',
      title: `${longTitles.length} title(s) will be truncated in the SERP`,
      where: longTitles.slice(0, 4).map((p) => `${p.url}\n            "${p.title}" (~${pixelWidth(p.title)}px)`).join('\n          '),
      what: 'Estimated rendered width exceeds the ~580px desktop SERP limit.',
      why: 'Serve stage only — length is not a ranking factor. But the tail gets cut, and a truncated title reads as careless and converts worse.',
      fix: 'Front-load the distinguishing terms and move brand to the end. Aim for roughly 50–60 characters of typical text.',
      owner: 'content', effort: 'S', urls: longTitles.map((p) => `${p.url} — "${p.title}"`).slice(0, 40),
    }));
  }

  const titleH1Mismatch = indexable.filter((p) => {
    if (!p.title || !p.h1s?.length) return false;
    const t = norm(p.title.split(/[|–—-]/)[0]);
    const h = norm(p.h1s[0]);
    return t && h && jaccardWords(t, h) < 0.25;
  });
  if (titleH1Mismatch.length > 2) {
    push(F({
      severity: 'Medium', phase: 'onpage', id: 'title-h1-mismatch',
      title: `${titleH1Mismatch.length} page(s) have a title that contradicts the H1`,
      where: titleH1Mismatch.slice(0, 4).map((p) => `${p.url}\n            title: "${p.title}"\n            H1:    "${p.h1s[0]}"`).join('\n          '),
      what: 'Low word overlap between the title tag and the page\'s own H1.',
      why: 'Rank and serve stages. Google rewrites roughly a third of title tags, and contradiction with the H1 is one of the documented triggers. When it rewrites, you lose control of the SERP headline.',
      fix: 'Align the two on the same primary term. The title can be longer and carry the brand; the core noun phrase should match.',
      owner: 'content', effort: 'M', urls: titleH1Mismatch.map((p) => p.url).slice(0, 30),
    }));
  }

  const noH1 = indexable.filter((p) => !p.h1s?.length);
  const multiH1 = indexable.filter((p) => p.h1s?.length > 1);
  if (noH1.length) {
    push(F({
      severity: 'Medium', phase: 'onpage', id: 'h1-missing',
      title: `${noH1.length} page(s) have no H1`,
      where: noH1.slice(0, 5).map((p) => p.url).join('\n          '),
      what: 'No <h1> element in the rendered source.',
      why: 'Rank stage. The H1 is a clear statement of what the page is about, for Google and for anyone navigating by headings. Zero-H1 pages are usually a page-builder default, not a decision.',
      fix: 'Set the main heading to H1 in the template or page-builder widget. Exactly one per page, describing what the page is about.',
      owner: 'dev', effort: 'S', urls: noH1.map((p) => p.url).slice(0, 40),
    }));
  }
  if (multiH1.length) {
    push(F({
      severity: 'Low', phase: 'onpage', id: 'h1-multiple',
      title: `${multiH1.length} page(s) have more than one H1`,
      where: multiH1.slice(0, 4).map((p) => `${p.url} (${p.h1s.length}: ${p.h1s.slice(0, 3).map((h) => `"${h.slice(0, 40)}"`).join(', ')})`).join('\n          '),
      what: 'Multiple H1 elements, typically an index or archive template repeating H1 per item.',
      why: 'Rank stage, mildly. HTML5 permits it and Google tolerates it, but it dilutes the "what is this page about" signal and usually indicates the heading hierarchy was never designed.',
      fix: 'One H1 describing the page; demote item headings in listings to H2 or H3.',
      owner: 'dev', effort: 'S', urls: multiH1.map((p) => p.url).slice(0, 30),
    }));
  }

  const skips = indexable.filter((p) => (p.headingSkips || []).length);
  if (skips.length > 2) {
    push(F({
      severity: 'Low', phase: 'onpage', id: 'heading-skips',
      title: `${skips.length} page(s) skip heading levels`,
      where: skips.slice(0, 4).map((p) => `${p.url} (${p.headingSkips[0].from} → ${p.headingSkips[0].to})`).join('\n          '),
      what: 'Heading levels jump downward by more than one, e.g. H2 straight to H4.',
      why: 'Rank stage, mildly, plus accessibility. Nesting is how the outline of the page is communicated; skips make the structure ambiguous to parsers and to screen readers.',
      fix: 'Set heading levels by position in the outline, not by the size you want. Style with CSS instead.',
      owner: 'dev', effort: 'M', urls: skips.map((p) => p.url).slice(0, 30),
    }));
  }

  const noMeta = indexable.filter((p) => !p.metaDescription);
  if (noMeta.length) {
    push(F({
      severity: 'Low', phase: 'onpage', id: 'meta-missing',
      title: `${noMeta.length} page(s) have no meta description`,
      where: noMeta.slice(0, 5).map((p) => p.url).join('\n          '),
      what: 'No meta description element.',
      why: 'Serve stage. Meta descriptions are not a ranking factor and have not been for over a decade — this is purely a click-through lever. Google will pull a snippet from the body, which is sometimes fine and sometimes a nav menu.',
      fix: 'Write one per commercially important page: the specific promise, differentiator, and an action. Leave low-value archives to Google.',
      owner: 'content', effort: 'M', urls: noMeta.map((p) => p.url).slice(0, 40),
    }));
  }

  const dupMeta = Object.entries(groupBy(indexable.filter((p) => p.metaDescription), (p) => p.metaDescription.toLowerCase()))
    .filter(([, g]) => g.length > 1);
  if (dupMeta.length) {
    push(F({
      severity: 'Low', phase: 'onpage', id: 'meta-duplicate',
      title: `${dupMeta.length} meta description(s) repeat across pages`,
      where: dupMeta.slice(0, 3).map(([m, g]) => `"${m.slice(0, 70)}…" × ${g.length}`).join('\n          '),
      what: 'The same description is used on multiple URLs.',
      why: 'Serve stage. A boilerplate description almost guarantees Google discards it and writes its own snippet, so the field is doing no work.',
      fix: 'Write per-page descriptions for money pages. If they are template-generated, add per-page overrides for at least the top pages.',
      owner: 'content', effort: 'M',
      urls: dupMeta.flatMap(([, g]) => g.map((p) => p.url)).slice(0, 40),
    }));
  }

  const thin = indexable.filter((p) => p.wordCount < 250 && p.wordCount > 0 && !BLOAT_PATTERN.test(p.url) && isMoney(p.url));
  if (thin.length) {
    push(F({
      severity: 'Medium', phase: 'onpage', id: 'thin-content',
      title: `${thin.length} page(s) have very little body content`,
      where: thin.slice(0, 5).map((p) => `${p.url} (${p.wordCount} words)`).join('\n          '),
      what: 'Under 250 words in the main content area.',
      why: 'Rank stage. Word count is not a ranking factor — length is a symptom of covering a topic, not a cause. What matters is that these pages probably do not answer the sub-questions their query implies, and that is what retrieval matches against.',
      fix: 'Check each against the SERP for its target query. Cover the subtopics the top results cover, answer-first: each section opening with a direct two-to-three sentence answer.',
      owner: 'content', effort: 'L', urls: thin.map((p) => `${p.url} (${p.wordCount}w)`).slice(0, 40),
    }));
  }

  // images
  const missingAlt = [];
  for (const p of indexable) {
    const bad = (p.images || []).filter((i) => !i.decorative && (!i.hasAltAttr || !String(i.alt).trim()));
    if (bad.length) missingAlt.push({ url: p.url, count: bad.length, sample: bad[0]?.rawSrc });
  }
  if (missingAlt.length) {
    const total = missingAlt.reduce((n, m) => n + m.count, 0);
    push(F({
      severity: 'Low', phase: 'onpage', id: 'img-alt',
      title: `${total} image(s) across ${missingAlt.length} page(s) have no alt text`,
      where: missingAlt.slice(0, 4).map((m) => `${m.url} (${m.count} images, e.g. ${String(m.sample).split('/').pop()})`).join('\n          '),
      what: 'Missing or empty alt attribute on non-decorative images.',
      why: 'Rank stage for image search, plus accessibility, which is the stronger reason. Alt text is also the anchor text of an image link.',
      fix: 'Describe what the image shows and why it is on the page. Leave alt="" only for genuinely decorative images. If your CMS stores alt text on the media item rather than per-use, fix it there so it applies everywhere.',
      owner: 'content', effort: 'M', urls: missingAlt.map((m) => `${m.url} (${m.count})`).slice(0, 40),
    }));
  }

  const noDims = indexable.filter((p) => (p.images || []).some((i) => !i.width || !i.height));
  if (noDims.length > 2) {
    push(F({
      severity: 'Low', phase: 'performance', id: 'img-dimensions',
      title: `${noDims.length} page(s) serve images without width and height`,
      where: noDims.slice(0, 4).map((p) => p.url).join('\n          '),
      what: 'img elements with no explicit dimension attributes.',
      why: 'Serve stage — CLS. The browser cannot reserve space before the image loads, so content jumps. CLS is a Core Web Vital and this is its most common single cause.',
      fix: 'Add width and height attributes, or a CSS aspect-ratio, to every img so the browser reserves space before the file loads. Page builders and lazy-load scripts are the usual culprits for stripping them.',
      owner: 'dev', effort: 'M', urls: noDims.map((p) => p.url).slice(0, 30),
    }));
  }

  const lazyAboveFold = indexable.filter((p) => (p.images || []).some((i) => i.likelyAboveFold && i.loading === 'lazy'));
  if (lazyAboveFold.length > 1) {
    push(F({
      severity: 'Medium', phase: 'performance', id: 'lazy-above-fold',
      title: `${lazyAboveFold.length} page(s) lazy-load their first images`,
      where: lazyAboveFold.slice(0, 4).map((p) => p.url).join('\n          '),
      what: 'loading="lazy" on images at the very top of the document, which are usually the LCP element.',
      why: 'Serve stage — LCP. Lazy-loading the hero image defers the exact request LCP measures, so it directly makes the metric worse. This is the most common self-inflicted LCP regression.',
      fix: 'Set loading="eager" and fetchpriority="high" on the hero image, and lazy-load only below the fold. If NitroPack or a similar plugin applies lazy-loading globally, add the hero to its exclusion list.',
      owner: 'dev', effort: 'S', urls: lazyAboveFold.map((p) => p.url).slice(0, 30),
    }));
  }

  // structured data
  const sdErrors = indexable.filter((p) => (p.jsonldErrors || []).length);
  if (sdErrors.length) {
    push(F({
      severity: 'Medium', phase: 'schema', id: 'jsonld-invalid',
      title: `${sdErrors.length} page(s) have JSON-LD that will not parse`,
      where: sdErrors.slice(0, 4).map((p) => `${p.url} — ${p.jsonldErrors[0]}`).join('\n          '),
      what: 'A script[type="application/ld+json"] block contains invalid JSON.',
      why: 'Serve stage. Invalid JSON-LD is discarded entirely, so any rich result eligibility it was meant to create is gone. Usually an unescaped quote or a smart quote from a WYSIWYG paste.',
      fix: 'Validate each block, escape quotes properly, and stop authoring JSON-LD in a rich text field. Confirm with the Rich Results Test, then watch the Search Console enhancement report — that is where you learn whether Google agreed.',
      owner: 'dev', effort: 'S', urls: sdErrors.map((p) => p.url),
    }));
  }

  const noSchema = indexable.filter((p) => !p.schemaTypes?.length && !p.microdataTypes?.length && isMoney(p.url) && p.wordCount > 200);
  if (noSchema.length > 2) {
    push(F({
      severity: 'Low', phase: 'schema', id: 'schema-absent',
      title: `${noSchema.length} substantive page(s) carry no structured data`,
      where: noSchema.slice(0, 5).map((p) => p.url).join('\n          '),
      what: 'No JSON-LD and no microdata.',
      why: 'Serve stage. Structured data is not a ranking factor; it determines rich result eligibility. On a professional services site the realistic wins are Organization/LocalBusiness, BreadcrumbList, FAQPage where a real FAQ exists, and Person for named authors.',
      fix: 'Add only types that produce a rich result and that match visible content. Use the Schema tab in this tool to generate the JSON-LD, then validate before shipping.',
      owner: 'dev', effort: 'M', urls: noSchema.map((p) => p.url).slice(0, 30),
    }));
  }

  // YMYL / E-E-A-T
  const ymyl = indexable.filter((p) => YMYL_HINT.test(`${p.title} ${p.h1s?.join(' ')} ${p.url}`));
  const ymylNoAuthor = ymyl.filter((p) => !p.hasAuthorMarkup && p.wordCount > 400);
  if (ymylNoAuthor.length > 2) {
    push(F({
      severity: 'Medium', phase: 'onpage', id: 'eeat-author',
      title: `${ymylNoAuthor.length} substantial YMYL page(s) have no identified author`,
      where: ymylNoAuthor.slice(0, 5).map((p) => p.url).join('\n          '),
      what: 'No author byline, author markup, or Person schema on legal, medical, or financial content.',
      why: 'Rank stage. On YMYL topics, thin or unattributed content is demoted hard by the quality systems. Named authors with real credentials, citations, and first-hand experience stop being nice-to-haves here.',
      fix: 'Add a named author with credentials, linking to a bio page that establishes expertise. Add Person schema referencing that page, and cite the statutes, studies, or sources the claims rest on.',
      owner: 'content', effort: 'L', urls: ymylNoAuthor.map((p) => p.url).slice(0, 30),
    }));
  }

  // NAP consistency
  const phoneCounts = {};
  for (const p of indexable) for (const ph of p.phones || []) phoneCounts[ph] = (phoneCounts[ph] || 0) + 1;
  const phoneList = Object.entries(phoneCounts).sort((a, b) => b[1] - a[1]);
  if (phoneList.length > 2) {
    push(F({
      severity: 'Medium', phase: 'offpage', id: 'nap-inconsistent',
      title: `${phoneList.length} different phone numbers appear across the site`,
      where: phoneList.slice(0, 6).map(([p, n]) => `${formatPhone(p)} on ${n} page(s)`).join('\n          '),
      what: 'Multiple distinct numbers in body content.',
      why: 'Off-page and local. NAP consistency is a local ranking signal and a trust signal. Multiple numbers are legitimate for multi-location firms and a problem when they are tracking numbers, stale numbers, or a template that was never updated.',
      fix: 'Confirm which are intentional. Make the primary number match Google Business Profile and citations exactly, including format. Where call-tracking numbers are used, keep the GBP number in the markup and swap only the display number via script.',
      owner: 'SEO', effort: 'M', urls: phoneList.map(([p, n]) => `${formatPhone(p)} (${n} pages)`),
    }));
  }

  // ═══════════════════════ PHASE 5 — RENDERING ═════════════════════════════════

  const jsDependent = indexable.filter((p) => p.rootDivEmpty || (p.rawBodyTextLength < 400 && p.scriptCount > 5));
  if (jsDependent.length) {
    push(F({
      severity: 'High', phase: 'performance', id: 'js-dependency',
      title: `${jsDependent.length} page(s) deliver little or no content in the HTML source`,
      where: jsDependent.slice(0, 4).map((p) => `${p.url} (${p.rawBodyTextLength} chars of source text, ${p.scriptCount} scripts)`).join('\n          '),
      what: 'The served HTML contains almost no text; content appears to be injected client-side.',
      why: 'Render stage. Google renders in a deferred second wave, which delays indexing and can drop content entirely if rendering fails or times out. Anything client-side only — text, internal links, structured data — is at risk.',
      fix: 'Server-render or statically generate the primary content, internal links, and JSON-LD. Verify with the URL Inspection live test: diff the rendered HTML against view-source and confirm the money content is in both.',
      owner: 'dev', effort: 'L', urls: jsDependent.map((p) => p.url).slice(0, 30),
    }));
  }

  const noViewport = indexable.filter((p) => !p.viewport);
  if (noViewport.length) {
    push(F({
      severity: 'Medium', phase: 'performance', id: 'viewport-missing',
      title: `${noViewport.length} page(s) have no viewport meta tag`,
      where: noViewport.slice(0, 4).map((p) => p.url).join('\n          '),
      what: 'No <meta name="viewport">.',
      why: 'Render stage. Indexing is mobile-first, so the mobile rendering is the one that counts. Without a viewport the page renders at desktop width on mobile and is judged that way.',
      fix: 'Add <meta name="viewport" content="width=device-width, initial-scale=1"> to the head of the template.',
      owner: 'dev', effort: 'S', urls: noViewport.map((p) => p.url).slice(0, 30),
    }));
  }

  const noLang = indexable.filter((p) => !p.lang);
  if (noLang.length > 2) {
    push(F({
      severity: 'Low', phase: 'onpage', id: 'lang-missing',
      title: `${noLang.length} page(s) have no lang attribute on <html>`,
      where: noLang.slice(0, 3).map((p) => p.url).join('\n          '),
      what: 'The html element declares no language.',
      why: 'Serve stage, mildly, plus accessibility — screen readers use it to select pronunciation rules.',
      fix: 'Set lang="en-US" (or the correct locale) on the html element in the template.',
      owner: 'dev', effort: 'S', urls: noLang.map((p) => p.url).slice(0, 20),
    }));
  }

  const slow = pages.filter((p) => p.responseMs > 1500 && p.status === 200);
  if (slow.length > 2) {
    push(F({
      severity: 'Low', phase: 'performance', id: 'slow-ttfb',
      title: `${slow.length} page(s) took over 1.5s to respond`,
      where: slow.slice(0, 4).map((p) => `${p.url} (${p.responseMs}ms)`).join('\n          '),
      what: `Median response across the crawl: ${median(pages.filter((p) => p.status === 200).map((p) => p.responseMs))}ms.`,
      why: 'Crawl and serve stages. Server response is a component of LCP and it constrains crawl rate. Note this is a lab-style single measurement from one location, not field data — treat it as a pointer, not the signal.',
      fix: 'Check page caching is actually serving (look for a cache-hit header), then object caching and PHP version. Confirm against CrUX field data in the Performance tab before investing.',
      owner: 'dev', effort: 'M', urls: slow.map((p) => `${p.url} (${p.responseMs}ms)`).slice(0, 30),
    }));
  }

  /* Extra checks live in their own module to keep this one readable. They must
     be collected BEFORE the sort — appending afterwards leaves them unordered
     at the end, which silently breaks the one guarantee the ladder makes. */
  push(...extraChecks(crawl, ctx));

  // ═══════════════════════════════ ORDER & SCORE ═══════════════════════════════

  findings.sort((a, b) =>
    (SEV_RANK[a.severity] - SEV_RANK[b.severity]) ||
    (LADDER[a.phase] - LADDER[b.phase]));

  const counts = findings.reduce((acc, f) => { acc[f.severity] = (acc[f.severity] || 0) + 1; return acc; }, {});

  return {
    findings,
    counts,
    stats: buildStats(crawl, html, indexable),
    topThree: findings.slice(0, 3).map((f) => ({ severity: f.severity, title: f.title, fix: f.fix })),
    generatedAt: new Date().toISOString(),
  };
}

/* ───────────────────────────── single page review ───────────────────────────── */

export function reviewPage(page, crawl, extras = {}) {
  const steps = [];
  const S = (n, q, verdict, detail) => steps.push({ n, question: q, verdict, detail });

  S(1, 'Is it eligible to be indexed?',
    page.status === 200 && !page.noindex && page.robotsAllowed ? 'pass' : 'fail',
    `HTTP ${page.status}${page.hops ? ` after ${page.hops} redirect(s)` : ''}; robots.txt ${page.robotsAllowed ? 'allows' : 'blocks'}; ${page.noindex ? 'noindex present' : 'no noindex'}.`);

  S(2, 'Is it the canonical you intended?',
    page.selfCanonical ? 'pass' : page.canonical ? 'warn' : 'warn',
    page.canonical
      ? (page.selfCanonical ? 'Self-referencing canonical.' : `Canonicalises to ${page.canonical}.`)
      : 'No canonical tag — Google chooses. Confirm its choice with URL Inspection.');

  S(3, 'Does the page type match the SERP for its target query?',
    'manual',
    'Not machine-checkable. Read the current SERP for the target query: if the top ten are guides and this is a service page, the problem is not the title tag.');

  S(4, 'Title, H1, headings, coverage',
    page.title && page.h1s?.length === 1 && !page.headingSkips?.length ? 'pass' : 'warn',
    `Title: ${page.title ? `"${page.title}" (~${pixelWidth(page.title)}px)` : 'missing'}. H1: ${page.h1s?.length === 1 ? `"${page.h1s[0]}"` : `${page.h1s?.length || 0} found`}. ${page.headingSkips?.length || 0} heading skip(s). ${page.wordCount} words.`);

  S(5, 'Internal links in — how many, from where, with what anchors?',
    page.inboundBodyCount > 0 ? 'pass' : 'fail',
    `${page.inboundCount || 0} inbound internal link(s), ${page.inboundBodyCount || 0} from body content. Anchors: ${[...new Set((page.inboundLinks || []).map((l) => l.anchor).filter(Boolean))].slice(0, 5).map((a) => `"${a}"`).join(', ') || 'none'}.`);

  S(6, 'Structured data present and valid?',
    page.jsonldErrors?.length ? 'fail' : page.schemaTypes?.length ? 'pass' : 'warn',
    page.jsonldErrors?.length ? `Parse errors: ${page.jsonldErrors[0]}`
      : page.schemaTypes?.length ? `Types: ${page.schemaTypes.join(', ')}` : 'No structured data.');

  const jsRisk = page.rootDivEmpty || (page.rawBodyTextLength < 400 && page.scriptCount > 5);
  S(7, 'Is the content in the HTML, or only after render?',
    jsRisk ? 'fail' : 'pass',
    page.rootDivEmpty
      ? `Empty app root with ${page.rawBodyTextLength} characters of source text — the content is injected client-side.`
      : jsRisk
        ? `Only ${page.rawBodyTextLength} characters of source text across ${page.scriptCount} scripts, which suggests client-side rendering.`
        : `${page.rawBodyTextLength} characters of text present in the source. This tool does not execute JavaScript, so confirm with the URL Inspection live test if the page uses hydration.`);

  const fails = steps.filter((s) => s.verdict === 'fail');
  const warns = steps.filter((s) => s.verdict === 'warn');
  const lead = fails[0] || warns[0];

  return {
    url: page.url,
    headline: lead
      ? { question: lead.question, detail: lead.detail, verdict: lead.verdict }
      : { question: 'No blocking issue found', detail: 'The mechanical checks pass. The remaining question is intent match, which needs a human reading the SERP.', verdict: 'pass' },
    steps,
    psi: extras.psi || null,
    inspection: extras.inspection || null,
  };
}

/* ───────────────────────────── pre-launch check ────────────────────────────── */

export function preLaunchCheck(liveCrawl, stagingProbe = null, redirectResults = null) {
  const items = [];
  const add = (label, state, detail) => items.push({ label, state, detail });

  const noindexed = liveCrawl.pages.filter((p) => p.noindex);
  add('Staging noindex removed from production',
    noindexed.length ? 'fail' : 'pass',
    noindexed.length ? `${noindexed.length} live page(s) still carry noindex: ${noindexed.slice(0, 3).map((p) => p.url).join(', ')}` : 'No noindex directives on live pages.');

  const blockAll = (liveCrawl.robots?.groups || []).some((g) => g.rules.some((r) => r.type === 'disallow' && r.path === '/'));
  add('robots.txt correct on the live host',
    liveCrawl.robotsStatus === 200 && !blockAll ? 'pass' : 'fail',
    blockAll ? 'Disallow: / is live.' : liveCrawl.robotsStatus === 200 ? 'Present and not blocking the site.' : `robots.txt returned ${liveCrawl.robotsStatus}.`);

  if (stagingProbe) {
    add('Staging still blocked',
      stagingProbe.blocked ? 'pass' : 'fail',
      stagingProbe.detail);
  } else {
    add('Staging still blocked', 'manual', 'Not checked. Enter the staging URL in the Pre-launch tab to test it.');
  }

  if (redirectResults) {
    const bad = redirectResults.filter((r) => r.status !== 200 || r.hops !== 1);
    add('Redirect map complete and tested',
      bad.length ? 'fail' : 'pass',
      bad.length ? `${bad.length} of ${redirectResults.length} old URLs do not resolve in exactly one hop to a 200.` : `All ${redirectResults.length} old URLs resolve in one hop to a 200.`);
  } else {
    add('Redirect map complete and tested', 'manual', 'Not checked. Paste the old URL list into the Redirects tab.');
  }

  add('Sitemap generated and submitted',
    liveCrawl.sitemap?.length ? 'pass' : 'fail',
    liveCrawl.sitemap?.length ? `${liveCrawl.sitemap.length} URLs across ${liveCrawl.sitemapSources.length} sitemap file(s).` : 'No sitemap found.');

  const mixed = liveCrawl.pages.filter((p) => (p.insecureRefs || []).length);
  add('HTTPS clean, no mixed content',
    liveCrawl.origin.startsWith('https://') && !mixed.length ? 'pass' : 'fail',
    !liveCrawl.origin.startsWith('https://') ? 'Origin is HTTP.' : mixed.length ? `${mixed.length} page(s) reference http:// resources.` : 'All references are secure.');

  add('Analytics and Search Console verified before launch', 'manual',
    'Connect Search Console in this tool to confirm the property is verified. Verify before launch, not after — you cannot backfill the data.');

  add('Crawl the live site on day one and diff against the pre-launch crawl', 'manual',
    'Save this crawl as a snapshot, then re-run and compare in the Compare tab. Monitor Page Indexing and Performance daily for a month — migrations are the single most common cause of catastrophic traffic loss.');

  return { items, pass: items.filter((i) => i.state === 'pass').length, fail: items.filter((i) => i.state === 'fail').length };
}

/* ───────────────────────────────── helpers ─────────────────────────────────── */

function buildStats(crawl, html, indexable) {
  const ok = crawl.pages.filter((p) => p.status === 200);
  return {
    crawled: crawl.pages.length,
    html: html.length,
    indexable: indexable.length,
    noindex: html.filter((p) => p.noindex).length,
    blockedByRobots: crawl.blocked.length,
    errors: crawl.pages.filter((p) => p.status >= 400 || p.status === 0).length,
    redirects: crawl.pages.filter((p) => p.hops > 0).length,
    maxDepth: Math.max(0, ...crawl.pages.map((p) => p.depth ?? 0)),
    sitemapUrls: crawl.sitemap?.length || 0,
    orphans: crawl.truncated ? null : (crawl.orphanCandidates?.length || 0),
    externalDomains: new Set(crawl.external.map((e) => e.host)).size,
    medianResponseMs: median(ok.map((p) => p.responseMs)),
    medianWords: median(html.map((p) => p.wordCount || 0)),
    platform: [...new Set(html.flatMap((p) => p.platform || []))],
    truncated: crawl.truncated,
  };
}

function findNearDuplicates(pages, threshold) {
  const out = [];
  const list = pages.filter((p) => p.wordCount > 120 && p.shingles?.length);
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      if (list[i].contentHash === list[j].contentHash) continue;
      const score = jaccard(list[i].shingles, list[j].shingles);
      if (score >= threshold) out.push({ a: list[i].url, b: list[j].url, score });
    }
    if (out.length > 200) break;
  }
  return out.sort((a, b) => b.score - a.score);
}

function findUrlVariants(pages) {
  const ok = pages.filter((p) => p.status === 200);
  const byKey = new Map();
  for (const p of ok) {
    let key;
    try {
      const u = new URL(p.url);
      key = (u.hostname + u.pathname.replace(/\/+$/, '').toLowerCase() + u.search) || '/';
    } catch { continue; }
    const arr = byKey.get(key) || [];
    arr.push(p.url);
    byKey.set(key, arr);
  }
  return [...byKey.values()].filter((v) => v.length > 1);
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 2);
function jaccardWords(a, b) {
  const sa = new Set(a), sb = new Set(b);
  if (!sa.size || !sb.size) return 0;
  let i = 0;
  for (const x of sa) if (sb.has(x)) i++;
  return i / (sa.size + sb.size - i);
}
function groupBy(arr, fn) {
  return arr.reduce((acc, x) => { const k = fn(x); (acc[k] = acc[k] || []).push(x); return acc; }, {});
}
function median(a) {
  if (!a?.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return Math.round(s[Math.floor(s.length / 2)]);
}
function formatPhone(d) {
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : d;
}
