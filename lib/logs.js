/* Server log analysis.
   The only dataset in this tool that beats a paid subscription, because it is
   your server's own record of what Googlebot actually did — not a model of it.
   A crawl tells you what Google COULD reach. Logs tell you where it spent its
   time, which is a different and usually more uncomfortable answer.

   Entirely local: parsing a file on disk. No network, no service, no key. */

/* ── format detection and parsing ──────────────────────────────────────────── */

/* Four formats cover almost everything in the field. Detection is by shape
   rather than by asking the user, because most people do not know which one
   their host writes. */
const COMBINED = /^(\S+) \S+ (\S+) \[([^\]]+)\] "(\S+) ([^"]*?) (\S+)" (\d{3}) (\S+)(?: "([^"]*)" "([^"]*)")?/;
const IIS_FIELDS = /^#Fields:\s*(.+)$/i;

const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

function parseClfDate(s) {
  // 10/Oct/2026:13:55:36 -0700
  const m = /^(\d{2})\/(\w{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2})/.exec(s);
  if (!m) return null;
  return new Date(Date.UTC(+m[3], MONTHS[m[2]] ?? 0, +m[1], +m[4], +m[5], +m[6]));
}

export function detectFormat(sample) {
  const lines = String(sample).split(/\r?\n/).filter((l) => l.trim()).slice(0, 40);
  if (!lines.length) return 'empty';
  if (lines.some((l) => IIS_FIELDS.test(l)) || lines.some((l) => /^#Software: Microsoft/i.test(l))) return 'iis';
  const first = lines.find((l) => !l.startsWith('#'));
  if (!first) return 'empty';
  if (first.trim().startsWith('{')) return 'json';
  if (COMBINED.test(first)) return 'combined';
  // Some hosts prefix the vhost. Strip one leading token and retry.
  if (COMBINED.test(first.replace(/^\S+\s+/, ''))) return 'combined-vhost';
  return 'unknown';
}

/**
 * Streams lines into normalised hits. Deliberately tolerant: a real log has
 * malformed lines, and refusing the whole file because of twelve bad rows in
 * two million would be useless.
 */
export function parseLog(text, { format } = {}) {
  const lines = String(text).split(/\r?\n/);
  const fmt = format || detectFormat(text);
  const hits = [];
  let skipped = 0;
  let iisCols = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (fmt === 'iis') {
      const f = IIS_FIELDS.exec(line);
      if (f) { iisCols = f[1].trim().split(/\s+/); continue; }
      if (line.startsWith('#')) continue;
      if (!iisCols) { skipped++; continue; }
      const parts = line.split(/\s+/);
      const get = (name) => { const i = iisCols.indexOf(name); return i >= 0 ? parts[i] : undefined; };
      const date = get('date'), time = get('time');
      const uri = get('cs-uri-stem');
      if (!uri) { skipped++; continue; }
      hits.push({
        ip: get('c-ip') || '',
        at: date && time ? new Date(`${date}T${time}Z`) : null,
        method: get('cs-method') || 'GET',
        url: get('cs-uri-query') && get('cs-uri-query') !== '-' ? `${uri}?${get('cs-uri-query')}` : uri,
        status: Number(get('sc-status')) || 0,
        bytes: Number(get('sc-bytes')) || 0,
        ua: (get('cs(User-Agent)') || '').replace(/\+/g, ' '),
        ms: Number(get('time-taken')) || null,
      });
      continue;
    }

    if (fmt === 'json') {
      try {
        const j = JSON.parse(line);
        const url = j.url || j.uri || j.request || j.ClientRequestURI || j.path;
        if (!url) { skipped++; continue; }
        hits.push({
          ip: j.ip || j.remote_addr || j.ClientIP || j.clientIp || '',
          at: j.time || j.timestamp || j.EdgeStartTimestamp ? new Date(j.time || j.timestamp || j.EdgeStartTimestamp) : null,
          method: j.method || j.ClientRequestMethod || 'GET',
          url,
          status: Number(j.status || j.EdgeResponseStatus || j.response_code) || 0,
          bytes: Number(j.bytes || j.EdgeResponseBytes || j.body_bytes_sent) || 0,
          ua: j.user_agent || j.ua || j.ClientRequestUserAgent || '',
          ms: Number(j.duration || j.request_time) || null,
        });
      } catch { skipped++; }
      continue;
    }

    const target = fmt === 'combined-vhost' ? line.replace(/^\S+\s+/, '') : line;
    const m = COMBINED.exec(target);
    if (!m) { skipped++; continue; }
    hits.push({
      ip: m[1], at: parseClfDate(m[3]), method: m[4], url: m[5],
      status: Number(m[7]) || 0, bytes: m[8] === '-' ? 0 : Number(m[8]) || 0,
      referrer: m[9] || '', ua: m[10] || '', ms: null,
    });
  }

  return { format: fmt, hits, skipped, total: lines.filter((l) => l.trim()).length };
}

/* ── bot identification ────────────────────────────────────────────────────── */

/* Published Googlebot ranges, /16 prefixes. A user agent is trivially spoofed,
   so a claim of Googlebot with an IP outside these blocks is worth flagging —
   people routinely draw conclusions from logs full of fake Googlebot hits.
   The definitive check is a reverse then forward DNS lookup; this is the
   offline approximation of it, and it says so. */
const GOOGLE_PREFIXES = ['66.249.', '64.233.', '72.14.', '74.125.', '209.85.', '216.239.', '35.247.', '34.', '35.'];

export const BOTS = {
  googlebot: { label: 'Googlebot', re: /Googlebot(?!-Image|-Video|-News)/i, verify: GOOGLE_PREFIXES },
  googlebotImage: { label: 'Googlebot-Image', re: /Googlebot-Image/i, verify: GOOGLE_PREFIXES },
  bingbot: { label: 'Bingbot', re: /bingbot|BingPreview/i, verify: ['157.55.', '207.46.', '40.77.', '13.66.'] },
  gptbot: { label: 'GPTBot', re: /GPTBot/i, verify: [] },
  claudebot: { label: 'ClaudeBot', re: /ClaudeBot|Claude-Web/i, verify: [] },
  perplexity: { label: 'PerplexityBot', re: /PerplexityBot/i, verify: [] },
  ahrefs: { label: 'AhrefsBot', re: /AhrefsBot/i, verify: [] },
  semrush: { label: 'SemrushBot', re: /SemrushBot/i, verify: [] },
  other: { label: 'Other bots', re: /bot|crawler|spider|slurp/i, verify: [] },
};

const identify = (ua) => {
  for (const [id, b] of Object.entries(BOTS)) if (b.re.test(ua)) return id;
  return null;
};

const looksVerified = (id, ip) => {
  const pre = BOTS[id]?.verify || [];
  if (!pre.length) return null;               // no published range to check against
  return pre.some((p) => String(ip).startsWith(p));
};

/* ── analysis ──────────────────────────────────────────────────────────────── */

const clean = (u) => String(u).split('#')[0];
const pathOf = (u) => clean(u).split('?')[0];
const section = (u) => pathOf(u).split('/').filter(Boolean)[0] || '/';

/**
 * The cross-reference that makes logs worth reading: what Googlebot spent its
 * budget on, set against what your crawl says should matter. Neither dataset
 * answers that alone.
 */
export function analyse(parsed, { crawl = null, botId = 'googlebot' } = {}) {
  const hits = parsed.hits;
  if (!hits.length) throw new Error('No parseable lines. Check the file is a raw access log rather than an error log or a report.');

  const bots = {};
  let human = 0, spoofed = 0, verified = 0;
  const botHits = [];

  for (const h of hits) {
    const id = identify(h.ua);
    if (!id) { human++; continue; }
    (bots[id] ||= { id, label: BOTS[id].label, hits: 0, bytes: 0 });
    bots[id].hits++;
    bots[id].bytes += h.bytes;
    if (id === botId) {
      const v = looksVerified(id, h.ip);
      if (v === true) verified++;
      else if (v === false) spoofed++;
      botHits.push(h);
    }
  }

  const dates = hits.map((h) => h.at).filter((d) => d && !Number.isNaN(+d)).sort((a, b) => a - b);
  const span = dates.length ? { from: dates[0].toISOString().slice(0, 10), to: dates[dates.length - 1].toISOString().slice(0, 10) } : null;
  const days = dates.length > 1 ? Math.max(1, Math.round((dates[dates.length - 1] - dates[0]) / 86400e3)) : 1;

  /* Where the budget went. */
  const byUrl = {}, byStatus = {}, bySection = {};
  let paramHits = 0, slow = 0;
  for (const h of botHits) {
    const u = clean(h.url);
    (byUrl[u] ||= { url: u, hits: 0, statuses: {} });
    byUrl[u].hits++;
    byUrl[u].statuses[h.status] = (byUrl[u].statuses[h.status] || 0) + 1;
    byStatus[h.status] = (byStatus[h.status] || 0) + 1;
    bySection[section(u)] = (bySection[section(u)] || 0) + 1;
    if (u.includes('?')) paramHits++;
    if (h.ms && h.ms > 1000) slow++;
  }

  const urls = Object.values(byUrl).sort((a, b) => b.hits - a.hits);
  const totalBot = botHits.length;

  /* Waste: crawl spent on things that can never rank. */
  const errorHits = Object.entries(byStatus).filter(([s]) => /^[45]/.test(s)).reduce((t, [, n]) => t + n, 0);
  const redirectHits = Object.entries(byStatus).filter(([s]) => /^3/.test(s)).reduce((t, [, n]) => t + n, 0);

  const findings = [];
  const F = (o) => findings.push({ severity: 'Medium', ...o });

  if (spoofed && verified) {
    F({
      severity: 'High', id: 'log-spoofed-bot',
      title: `${spoofed} of ${spoofed + verified} "${BOTS[botId].label}" hits came from IPs outside Google's published ranges`,
      what: `${Math.round((spoofed / (spoofed + verified)) * 100)}% of the hits claiming to be ${BOTS[botId].label} are from unlisted IPs.`,
      why: 'A user agent is trivially spoofed. Scrapers routinely impersonate Googlebot to bypass rate limits, and every conclusion you draw from a log full of fake hits is wrong.',
      act: 'Verify properly with a reverse then forward DNS lookup before trusting the rest of this analysis:\n  host <ip>            → should end in .googlebot.com or .google.com\n  host <that-hostname> → should return the original IP\nThe prefix check here is an offline approximation, not proof.',
    });
  }

  if (totalBot && errorHits / totalBot > 0.05) {
    const worst = urls.filter((u) => Object.keys(u.statuses).some((s) => /^[45]/.test(s)))
      .sort((a, b) => b.hits - a.hits).slice(0, 10);
    F({
      severity: 'High', id: 'log-error-waste',
      title: `${Math.round((errorHits / totalBot) * 100)}% of crawl budget spent on 4xx and 5xx`,
      what: `${errorHits} of ${totalBot} bot requests returned an error. Worst offenders:\n${worst.map((u) => `  ${u.url} — ${u.hits} hits, ${Object.entries(u.statuses).map(([s, n]) => `${s}×${n}`).join(' ')}`).join('\n')}`,
      why: 'Every error request is budget that could have gone to a page you want indexed. A crawl finds broken links; logs tell you how much Google is actually paying for them, which is the number that justifies the work.',
      act: 'Fix or 410 the top offenders. A 410 tells Google to stop asking, where a 404 leaves it retrying for months.',
      urls: worst.map((u) => `${u.url} — ${u.hits} hits`),
    });
  }

  if (totalBot && redirectHits / totalBot > 0.15) {
    F({
      severity: 'Medium', id: 'log-redirect-waste',
      title: `${Math.round((redirectHits / totalBot) * 100)}% of crawl budget spent on redirects`,
      what: `${redirectHits} of ${totalBot} bot requests were redirected.`,
      why: 'Each redirect is two requests for one page. At this share it usually means internal links or the sitemap still point at old URLs rather than their destinations.',
      act: 'Update the links at source rather than relying on the redirect. Ship → Link graph CSV shows which pages still point at redirected URLs.',
    });
  }

  if (totalBot && paramHits / totalBot > 0.2) {
    const paramUrls = urls.filter((u) => u.url.includes('?')).slice(0, 8);
    F({
      severity: 'High', id: 'log-param-waste',
      title: `${Math.round((paramHits / totalBot) * 100)}% of crawl budget spent on parameter URLs`,
      what: `${paramHits} of ${totalBot} bot requests carried query parameters. Most crawled:\n${paramUrls.map((u) => `  ${u.url} — ${u.hits}`).join('\n')}`,
      why: 'This is the crawl-budget catastrophe made visible. A canonical does not prevent the crawl — it only affects what gets indexed afterwards. Logs are the only place you can see the cost.',
      act: 'Disallow the parameter patterns in robots.txt. Findings → the parameter fix generates the rules from your own URL patterns.',
      urls: paramUrls.map((u) => `${u.url} — ${u.hits} hits`),
    });
  }

  /* ── the cross-reference with the crawl ──────────────────────────────────── */
  let neverCrawled = [], notInCrawl = [], orphansHit = [];
  if (crawl?.pages?.length) {
    const crawlUrls = new Map();
    for (const p of crawl.pages) {
      try { crawlUrls.set(new URL(p.url).pathname + (new URL(p.url).search || ''), p); } catch { /* skip */ }
    }
    const logPaths = new Set(urls.map((u) => u.url));

    // Pages you have that Googlebot never requested in this window.
    neverCrawled = [...crawlUrls.entries()]
      .filter(([pth, p]) => !logPaths.has(pth) && p.status === 200 && !p.noindex)
      .map(([pth, p]) => ({ path: pth, inbound: p.inboundCount || 0, depth: p.depth }))
      .sort((a, b) => a.inbound - b.inbound)
      .slice(0, 40);

    // URLs Googlebot requests that your crawl never found — genuine orphans,
    // or URLs it remembers from before a migration.
    notInCrawl = urls.filter((u) => !crawlUrls.has(u.url) && !u.url.includes('?'))
      .slice(0, 30);

    if (neverCrawled.length) {
      F({
        severity: 'High', id: 'log-never-crawled',
        title: `${neverCrawled.length} indexable page(s) were not requested by ${BOTS[botId].label} at all`,
        what: `Present on the site, never fetched in this window. Lowest internal-link counts first:\n${neverCrawled.slice(0, 10).map((n) => `  ${n.path} — ${n.inbound} inbound link(s), depth ${n.depth}`).join('\n')}`,
        why: 'A page Google never requests cannot rank, and no on-page work changes that. This is the single most valuable thing logs tell you, and a crawl cannot tell you it at all — a crawl only proves the page is reachable, not that Google bothered.',
        act: 'Look at the inbound-link counts above. Nearly always the fix is internal links plus inclusion in the sitemap, not anything on the page itself.',
        urls: neverCrawled.map((n) => `${n.path} — ${n.inbound} inbound, depth ${n.depth}`),
      });
    }
    if (notInCrawl.length) {
      F({
        severity: 'Medium', id: 'log-unknown-urls',
        title: `${BOTS[botId].label} requested ${notInCrawl.length} URL(s) your crawl never found`,
        what: notInCrawl.slice(0, 10).map((u) => `  ${u.url} — ${u.hits} hits, ${Object.keys(u.statuses).join('/')}`).join('\n'),
        why: 'Either genuine orphans reachable only from outside the site, or URLs Google remembers from before a change. Both are worth knowing: the first are pages with external links and no internal ones, which is wasted equity.',
        act: 'For each: if it should exist, link to it internally. If it should not, return 410 rather than leaving it 404ing indefinitely.',
        urls: notInCrawl.map((u) => `${u.url} — ${u.hits} hits`),
      });
    }
  }

  const SEV = { High: 0, Medium: 1, Low: 2 };
  findings.sort((a, b) => SEV[a.severity] - SEV[b.severity]);

  return {
    format: parsed.format,
    lines: { total: parsed.total, parsed: hits.length, skipped: parsed.skipped },
    span, days,
    traffic: { human, bots: Object.values(bots).sort((a, b) => b.hits - a.hits) },
    bot: {
      id: botId, label: BOTS[botId].label, hits: totalBot,
      perDay: Math.round(totalBot / days),
      verified, spoofed,
      verificationNote: verified + spoofed
        ? `${verified} from Google's published IP ranges, ${spoofed} from elsewhere. This is a prefix check, not the definitive reverse-DNS verification.`
        : 'No IP range published for this bot, so its identity cannot be checked offline.',
    },
    statuses: byStatus,
    sections: Object.entries(bySection).sort((a, b) => b[1] - a[1]).slice(0, 12),
    topUrls: urls.slice(0, 30),
    waste: {
      errors: errorHits, redirects: redirectHits, params: paramHits,
      errorShare: totalBot ? Math.round((errorHits / totalBot) * 100) : 0,
      redirectShare: totalBot ? Math.round((redirectHits / totalBot) * 100) : 0,
      paramShare: totalBot ? Math.round((paramHits / totalBot) * 100) : 0,
    },
    slow,
    neverCrawled, notInCrawl,
    findings,
    read: findings.length
      ? findings[0].title
      : totalBot
        ? `${BOTS[botId].label} made ${totalBot} requests across ${days} day${days === 1 ? '' : 's'} with no obvious waste. Budget is going where it should.`
        : `No ${BOTS[botId].label} hits in this file. Either the window is too short, the log is filtered, or the bot is being blocked upstream.`,
    caveat: crawl?.pages?.length
      ? null
      : 'Crawl the site as well and re-run this. The comparison between what Google requested and what exists is where most of the value is — without it this is only a traffic breakdown.',
  };
}
