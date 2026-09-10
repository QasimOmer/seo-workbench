import { fetchChain, parseRobots, isAllowed, readSitemap } from './fetcher.js';
import { parsePage, normaliseUrl, sameSite } from './parse.js';

/**
 * Breadth-first crawl. BFS is not an implementation detail — click depth is a
 * Phase 3 finding, and only BFS gives you the true shortest path from home.
 */
export async function crawl(startUrl, opts = {}, onProgress = () => {}) {
  const {
    maxPages = 500,
    concurrency = 5,
    delayMs = 120,
    ua = 'googlebot',
    includeSubdomains = false,
    respectRobots = true,
    ignoreQueryStrings = false,
  } = opts;

  const origin = new URL(startUrl).origin;

  // robots.txt first — it changes what we're allowed to see and is Phase 1 evidence
  const robotsRes = await fetchChain(`${origin}/robots.txt`, { ua });
  const robots = robotsRes.ok ? parseRobots(robotsRes.body) : parseRobots('');
  robots.status = robotsRes.status;
  robots.found = robotsRes.ok && /disallow|allow|user-agent|sitemap/i.test(robotsRes.body || '');

  // sitemaps: declared in robots, plus the conventional locations
  const sitemapCandidates = [...new Set([
    ...robots.sitemaps,
    `${origin}/sitemap.xml`,
    `${origin}/sitemap_index.xml`,
    `${origin}/wp-sitemap.xml`,
  ])];
  const sitemapUrls = [];
  const sitemapSources = [];
  for (const sm of sitemapCandidates) {
    const r = await readSitemap(sm, { ua });
    if (r.urls.length) {
      sitemapUrls.push(...r.urls);
      sitemapSources.push({ url: sm, count: r.urls.length, declaredInRobots: robots.sitemaps.includes(sm) });
    }
  }
  const seenSm = new Set();
  const sitemap = sitemapUrls.filter((u) => {
    const n = normaliseUrl(u.loc, origin);
    if (!n || seenSm.has(n)) return false;
    seenSm.add(n);
    u.loc = n;
    return true;
  });

  const start = normaliseUrl(startUrl, startUrl);
  const queue = [{ url: start, depth: 0, from: null }];
  const seen = new Set([keyOf(start, ignoreQueryStrings)]);
  const pages = new Map();
  const blocked = [];
  const external = new Map();
  let stopped = false;

  const worker = async () => {
    while (queue.length && pages.size < maxPages && !stopped) {
      const job = queue.shift();
      if (!job) break;

      const verdict = isAllowed(robots, job.url, ua === 'googlebot' ? 'googlebot' : '*');
      if (respectRobots && !verdict.allowed) {
        blocked.push({ url: job.url, rule: verdict.rule, depth: job.depth, from: job.from });
        continue;
      }

      const res = await fetchChain(job.url, { ua });
      const record = {
        url: job.url,
        finalUrl: res.url,
        depth: job.depth,
        linkedFrom: [job.from].filter(Boolean),
        status: res.status,
        redirectChain: res.chain,
        hops: res.chain.length,
        contentType: res.contentType || '',
        bytes: res.bytes || 0,
        responseMs: res.timing,
        error: res.error,
        robotsAllowed: verdict.allowed,
        robotsRule: verdict.rule,
        headers: pickHeaders(res.headers),
      };

      if (res.body && /text\/html/i.test(res.contentType || '')) {
        try {
          Object.assign(record, parsePage(res.body, res.url, res.headers));
          record.rawHtmlLength = res.body.length;
        } catch (e) {
          record.parseError = String(e.message);
        }
      }

      pages.set(job.url, record);
      onProgress({ done: pages.size, queued: queue.length, url: job.url, max: maxPages });

      // enqueue
      if (record.links && res.status < 400) {
        for (const l of record.links) {
          if (!l.resolved) continue;
          if (!sameSite(l.resolved, origin, { includeSubdomains })) {
            const host = safeHost(l.resolved);
            const e = external.get(l.resolved) || { url: l.resolved, host, count: 0, anchors: [], nofollow: l.nofollow };
            e.count++;
            if (e.anchors.length < 3 && l.anchor) e.anchors.push(l.anchor);
            external.set(l.resolved, e);
            continue;
          }
          if (/\.(jpe?g|png|gif|webp|avif|svg|pdf|zip|mp4|mp3|css|js|ico|woff2?)(\?|$)/i.test(l.resolved)) continue;
          const k = keyOf(l.resolved, ignoreQueryStrings);
          const existing = pages.get(l.resolved);
          if (existing && !existing.linkedFrom.includes(job.url)) existing.linkedFrom.push(job.url);
          if (seen.has(k)) continue;
          seen.add(k);
          queue.push({ url: l.resolved, depth: job.depth + 1, from: job.url });
        }
      }

      if (delayMs) await sleep(delayMs);
    }
  };

  await Promise.all(Array.from({ length: concurrency }, worker));

  // second pass: sitemap URLs never reached by the crawl are orphan candidates
  const crawled = new Set([...pages.keys()]);
  const orphanCandidates = sitemap
    .map((s) => s.loc)
    .filter((u) => !crawled.has(u) && sameSite(u, origin, { includeSubdomains }));

  // fetch a bounded number of orphan candidates so they can still be audited
  // Was capped at 40, which silently under-audited any site with a large
  // sitemap. Scale with the crawl instead, still bounded so a runaway sitemap
  // cannot double the crawl length.
  const orphanBudget = Math.max(0, Math.min(orphanCandidates.length, maxPages - pages.size, 300));
  for (let i = 0; i < orphanBudget; i++) {
    const u = orphanCandidates[i];
    const res = await fetchChain(u, { ua });
    const record = {
      url: u, finalUrl: res.url, depth: null, linkedFrom: [], status: res.status,
      redirectChain: res.chain, hops: res.chain.length, contentType: res.contentType || '',
      responseMs: res.timing, error: res.error, discoveredVia: 'sitemap',
      robotsAllowed: isAllowed(robots, u).allowed, headers: pickHeaders(res.headers),
    };
    if (res.body && /text\/html/i.test(res.contentType || '')) {
      try { Object.assign(record, parsePage(res.body, res.url, res.headers)); } catch {}
    }
    pages.set(u, record);
    onProgress({ done: pages.size, queued: 0, url: u, max: maxPages });
  }

  // inbound internal link graph
  const inbound = new Map();
  for (const p of pages.values()) {
    for (const l of p.links || []) {
      if (!l.resolved || !sameSite(l.resolved, origin, { includeSubdomains })) continue;
      const arr = inbound.get(l.resolved) || [];
      arr.push({ from: p.url, anchor: l.anchor, nofollow: !!l.nofollow, inNav: !!l.inNav, inFooter: !!l.inFooter });
      inbound.set(l.resolved, arr);
    }
  }
  for (const p of pages.values()) {
    const links = inbound.get(p.url) || [];
    p.inboundLinks = links;
    p.inboundCount = links.length;
    p.inboundBodyCount = links.filter((l) => !l.inNav && !l.inFooter).length;
  }

  return {
    startUrl: start,
    origin,
    crawledAt: new Date().toISOString(),
    options: { maxPages, ua, includeSubdomains, respectRobots },
    robots,
    robotsRaw: robotsRes.body || '',
    robotsStatus: robotsRes.status,
    sitemap,
    sitemapSources,
    pages: [...pages.values()],
    blocked,
    external: [...external.values()].sort((a, b) => b.count - a.count),
    orphanCandidates,
    truncated: queue.length > 0,
    remainingQueue: queue.length,
  };
}

function keyOf(url, ignoreQuery) {
  if (!ignoreQuery) return url;
  try { const u = new URL(url); u.search = ''; return u.toString(); } catch { return url; }
}
function safeHost(u) { try { return new URL(u).hostname; } catch { return ''; } }
function pickHeaders(h = {}) {
  const keep = [
    // SEO-relevant
    'content-type', 'x-robots-tag', 'link', 'cache-control', 'content-encoding',
    'x-nitro-cache', 'cf-cache-status', 'vary', 'age', 'last-modified', 'etag',
    // security posture — a separate discipline, audited separately
    'strict-transport-security', 'content-security-policy',
    'content-security-policy-report-only', 'x-frame-options',
    'x-content-type-options', 'referrer-policy', 'permissions-policy',
    'cross-origin-opener-policy', 'cross-origin-resource-policy',
    'cross-origin-embedder-policy', 'set-cookie',
    // information disclosure
    'server', 'x-powered-by', 'x-aspnet-version', 'x-generator', 'x-drupal-cache',
  ];
  const out = {};
  for (const k of keep) if (h[k]) out[k] = h[k];
  return out;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
