// Polite HTTP layer. Captures the full redirect chain, because "one hop" is a
// finding the playbook cares about and node's fetch hides it by default.

const UA = {
  googlebot:
    'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.6422.76 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  desktop:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  workbench: 'SEOWorkbench/1.0 (+local audit tool)',
};

export function userAgent(name) {
  return UA[name] || UA.googlebot;
}

/**
 * Fetch a URL following redirects manually so the chain is observable.
 * Returns { ok, url (final), chain[], status, headers, body, timing, error }
 */
export async function fetchChain(url, opts = {}) {
  const {
    ua = 'googlebot',
    maxHops = 8,
    timeout = 20000,
    method = 'GET',
    bodyLimit = 3_000_000,
  } = opts;

  const chain = [];
  let current = url;
  const started = Date.now();

  for (let hop = 0; hop <= maxHops; hop++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeout);
    let res;
    try {
      res = await fetch(current, {
        method,
        redirect: 'manual',
        signal: ac.signal,
        headers: {
          'User-Agent': userAgent(ua),
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });
    } catch (err) {
      clearTimeout(timer);
      return {
        ok: false,
        url: current,
        chain,
        status: 0,
        headers: {},
        body: '',
        timing: Date.now() - started,
        error: err.name === 'AbortError' ? 'timeout' : String(err.message || err),
      };
    }
    clearTimeout(timer);

    const headers = Object.fromEntries(res.headers.entries());
    const status = res.status;

    if (status >= 300 && status < 400 && headers.location) {
      let next;
      try {
        next = new URL(headers.location, current).toString();
      } catch {
        break;
      }
      chain.push({ from: current, to: next, status });
      if (chain.some((c, i) => i < chain.length - 1 && c.from === next)) {
        return {
          ok: false, url: next, chain, status, headers, body: '',
          timing: Date.now() - started, error: 'redirect_loop',
        };
      }
      current = next;
      continue;
    }

    let body = '';
    const ct = headers['content-type'] || '';
    if (method !== 'HEAD' && /text\/|xml|json|javascript/.test(ct)) {
      const buf = await res.arrayBuffer();
      body = new TextDecoder('utf-8').decode(buf.slice(0, bodyLimit));
    }

    return {
      ok: res.ok,
      url: current,
      chain,
      status,
      headers,
      body,
      contentType: ct,
      bytes: Number(headers['content-length'] || body.length),
      timing: Date.now() - started,
      error: null,
    };
  }

  return {
    ok: false, url: current, chain, status: 0, headers: {}, body: '',
    timing: Date.now() - started, error: 'too_many_redirects',
  };
}

/* ---------------------------------------------------------------- robots.txt */

/**
 * Minimal but correct-enough robots.txt parser: group matching by user-agent,
 * longest-match wins between Allow and Disallow (Google's documented behaviour).
 */
export function parseRobots(text) {
  const groups = [];
  let current = null;
  const sitemaps = [];
  const lines = String(text || '').split(/\r?\n/);

  for (const raw of lines) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (field === 'user-agent') {
      if (!current || current.rules.length) {
        current = { agents: [], rules: [], crawlDelay: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if (field === 'disallow' || field === 'allow') {
      if (!current) {
        current = { agents: ['*'], rules: [], crawlDelay: null };
        groups.push(current);
      }
      current.rules.push({ type: field, path: value });
    } else if (field === 'crawl-delay' && current) {
      current.crawlDelay = parseFloat(value);
    } else if (field === 'sitemap') {
      sitemaps.push(value);
    }
  }
  return { groups, sitemaps, raw: String(text || '') };
}

function matchPattern(pattern, path) {
  if (pattern === '') return false;
  let anchoredEnd = false;
  let p = pattern;
  if (p.endsWith('$')) { anchoredEnd = true; p = p.slice(0, -1); }
  const parts = p.split('*');
  let pos = 0;
  for (let i = 0; i < parts.length; i++) {
    const seg = parts[i];
    if (seg === '') continue;
    const found = i === 0 ? (path.startsWith(seg) ? 0 : -1) : path.indexOf(seg, pos);
    if (found === -1) return false;
    if (i === 0 && found !== 0) return false;
    pos = found + seg.length;
  }
  if (anchoredEnd && pos !== path.length && !p.endsWith('*')) return false;
  return true;
}

function groupFor(robots, agent) {
  const a = agent.toLowerCase();
  let best = null;
  let bestLen = -1;
  for (const g of robots.groups) {
    for (const ga of g.agents) {
      if (ga === '*' && bestLen < 0) { best = g; bestLen = 0; }
      else if (ga !== '*' && a.includes(ga) && ga.length > bestLen) { best = g; bestLen = ga.length; }
    }
  }
  return best;
}

export function isAllowed(robots, url, agent = 'googlebot') {
  if (!robots || !robots.groups.length) return { allowed: true, rule: null };
  const g = groupFor(robots, agent);
  if (!g) return { allowed: true, rule: null };
  let path;
  try { const u = new URL(url); path = u.pathname + u.search; } catch { return { allowed: true, rule: null }; }

  let winner = null;
  for (const r of g.rules) {
    if (matchPattern(r.path, path)) {
      if (!winner || r.path.length > winner.path.length) winner = r;
    }
  }
  if (!winner) return { allowed: true, rule: null };
  return { allowed: winner.type === 'allow', rule: winner };
}

/* ---------------------------------------------------------------- sitemaps */

/** Recursively read sitemap(s) and sitemap indexes. Returns url entries. */
export async function readSitemap(url, opts = {}, seen = new Set(), depth = 0) {
  if (depth > 4 || seen.has(url)) return { urls: [], errors: [] };
  seen.add(url);
  const res = await fetchChain(url, opts);
  if (!res.ok || !res.body) {
    return { urls: [], errors: [{ url, status: res.status, error: res.error || 'not_ok' }] };
  }
  const body = res.body;
  const urls = [];
  const errors = [];

  const isIndex = /<sitemapindex/i.test(body);
  const blocks = body.match(/<(?:url|sitemap)\b[\s\S]*?<\/(?:url|sitemap)>/gi) || [];

  for (const b of blocks) {
    const loc = (b.match(/<loc>\s*([\s\S]*?)\s*<\/loc>/i) || [])[1];
    if (!loc) continue;
    const clean = loc.replace(/<!\[CDATA\[|\]\]>/g, '').trim();
    if (isIndex) {
      const sub = await readSitemap(clean, opts, seen, depth + 1);
      urls.push(...sub.urls);
      errors.push(...sub.errors);
    } else {
      const lastmod = (b.match(/<lastmod>\s*([\s\S]*?)\s*<\/lastmod>/i) || [])[1] || null;
      const priority = (b.match(/<priority>\s*([\s\S]*?)\s*<\/priority>/i) || [])[1] || null;
      urls.push({ loc: clean, lastmod, priority, source: url });
    }
  }

  // plain-text sitemap fallback
  if (!blocks.length && /^https?:\/\//m.test(body) && !/<\?xml/.test(body)) {
    for (const line of body.split(/\r?\n/)) {
      const t = line.trim();
      if (/^https?:\/\//.test(t)) urls.push({ loc: t, lastmod: null, priority: null, source: url });
    }
  }

  return { urls, errors };
}
