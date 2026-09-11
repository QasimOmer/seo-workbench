import { fetchChain, parseRobots, isAllowed, readSitemap } from './fetcher.js';
import { parsePage, normaliseUrl, sameSite } from './parse.js';

/**
 * Breadth-first crawl. BFS is not an implementation detail — click depth is a
 * Phase 3 finding, and only BFS gives you the true shortest path from home.
 */
export async function crawl(startUrl, opts = {}, onProgress = () => {}) {
  const isVercel = Boolean(process.env.VERCEL);
  const {
    maxPages = 1000,
    concurrency = isVercel ? 12 : 8,
    delayMs = isVercel ? 0 : 60,
    ua = 'googlebot',
    includeSubdomains = false,
    respectRobots = true,
    ignoreQueryStrings = false,
    timeLimitMs,
  } = opts;

  const origin = new URL(startUrl).origin;
  const startTime = Date.now();
  const timeBudget = timeLimitMs || (isVercel ? 45000 : 90000);
  const isTimeUp = () => (Date.now() - startTime) >= timeBudget;
  let timeExceeded = false;

  // Fetch robots.txt and start page in parallel at boot to maximize crawl throughput
  const [robotsRes, startProbeRes] = await Promise.all([
    fetchChain(`${origin}/robots.txt`, { ua, timeout: isVercel ? 3500 : 6000 }),
    fetchChain(startUrl, { ua, timeout: isVercel ? 4000 : 8000 }),
  ]);
  const robots = robotsRes.ok ? parseRobots(robotsRes.body) : parseRobots('');
  robots.status = robotsRes.status;
  robots.found = robotsRes.ok && /disallow|allow|user-agent|sitemap/i.test(robotsRes.body || '');

  // sitemaps: if declared in robots.txt, prioritize those and avoid redundant probing
  const sitemapCandidates = robots.sitemaps.length
    ? [...new Set(robots.sitemaps.slice(0, 3))]
    : [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`, `${origin}/wp-sitemap.xml`];
  const sitemapUrls = [];
  const sitemapSources = [];

  if (!isTimeUp()) {
    const toCheck = sitemapCandidates.slice(0, isVercel ? 3 : 4);
    const smResults = await Promise.allSettled(toCheck.map(async (sm) => {
      const r = await readSitemap(sm, { ua, timeout: isVercel ? 3500 : 6000 });
      return { sm, r };
    }));
    for (const res of smResults) {
      if (res.status === 'fulfilled' && res.value?.r?.urls?.length) {
        sitemapUrls.push(...res.value.r.urls);
        sitemapSources.push({
          url: res.value.sm,
          count: res.value.r.urls.length,
          declaredInRobots: robots.sitemaps.includes(res.value.sm),
        });
      }
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

  // Enqueue sitemap pages to ensure complete site discovery even if the homepage is an SPA or JS-rendered
  for (const smEntry of sitemap) {
    if (!smEntry.loc || !sameSite(smEntry.loc, origin, { includeSubdomains })) continue;
    const k = keyOf(smEntry.loc, ignoreQueryStrings);
    if (!seen.has(k)) {
      seen.add(k);
      queue.push({ url: smEntry.loc, depth: 1, from: null, discoveredVia: 'sitemap' });
    }
  }

  const pages = new Map();
  const blocked = [];
  const external = new Map();
  let stopped = false;
  let activeWorkers = 0;

  const worker = async () => {
    while (!stopped && pages.size < maxPages) {
      if (isTimeUp()) {
        stopped = true;
        timeExceeded = true;
        break;
      }

      if (!queue.length) {
        // If queue is temporarily empty but other workers are still fetching pages,
        // wait for them to push discovered links rather than terminating the worker pool!
        if (activeWorkers > 0) {
          await sleep(25);
          continue;
        }
        break;
      }

      const job = queue.shift();
      if (!job) break;

      activeWorkers++;
      try {
        const verdict = isAllowed(robots, job.url, ua === 'googlebot' ? 'googlebot' : '*');
        if (respectRobots && !verdict.allowed) {
          blocked.push({ url: job.url, rule: verdict.rule, depth: job.depth, from: job.from });
          continue;
        }

        let res;
        if (job.url === start && startProbeRes && (startProbeRes.ok || startProbeRes.status)) {
          res = startProbeRes;
        } else {
          res = await fetchChain(job.url, { ua, timeout: isVercel ? 4000 : 10000 });
        }
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
          discoveredVia: job.discoveredVia,
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

        // enqueue discovered links
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
            if (/\.(jpe?g|png|gif|webp|avif|svg|pdf|zip|mp4|mp3|css|js|ico|woff2?|xml|json|txt|docx?|xlsx?|pptx?|csv|gz|tar|rar|7z|exe|dmg|apk)(\?|$)/i.test(l.resolved)) continue;
            if (/\/(feed|trackback|wp-json|comments\/feed)(\/|$)/i.test(l.resolved)) continue;
            const k = keyOf(l.resolved, ignoreQueryStrings);
            const existing = pages.get(l.resolved);
            if (existing && !existing.linkedFrom.includes(job.url)) existing.linkedFrom.push(job.url);
            if (seen.has(k)) continue;
            seen.add(k);
            queue.push({ url: l.resolved, depth: job.depth + 1, from: job.url });
          }
        }

        if (delayMs) await sleep(delayMs);
      } finally {
        activeWorkers--;
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, worker));

  // second pass: sitemap URLs never reached by the crawl are orphan candidates
  const crawled = new Set([...pages.keys()]);
  const orphanCandidates = sitemap
    .map((s) => s.loc)
    .filter((u) => !crawled.has(u) && sameSite(u, origin, { includeSubdomains }));

  // fetch a bounded number of orphan candidates if time budget permits
  if (!isTimeUp() && (Date.now() - startTime) < (timeBudget - 1500)) {
    const orphanBudget = Math.max(0, Math.min(orphanCandidates.length, maxPages - pages.size, isVercel ? 6 : 50));
    const orphanToFetch = orphanCandidates.slice(0, orphanBudget);
    await Promise.allSettled(orphanToFetch.map(async (u) => {
      if (isTimeUp()) return;
      try {
        const res = await fetchChain(u, { ua, timeout: isVercel ? 2500 : 6000 });
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
      } catch {}
    }));
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
    truncated: queue.length > 0 || stopped || pages.size >= maxPages,
    timeExceeded,
    timeElapsedMs: Date.now() - startTime,
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
