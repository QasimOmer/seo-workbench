/* Security-header audit — a separate discipline from SEO, kept separate on purpose.
   Only two of these headers touch search at all (HSTS reinforces HTTPS; a CSP
   that blocks your own assets can break rendering). The rest matter because
   client sites get compromised, and a compromised site loses its rankings in a
   way no amount of on-page work recovers. Graded independently so it never
   muddles the priority ladder.

   Written from the header specifications rather than ported from any existing
   tool. Everything here is computed from the crawl — no network, no service. */

const lower = (o = {}) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k.toLowerCase(), v]));

/* Weights reflect real exploitability, not checklist tidiness. A missing
   X-Frame-Options is a clickjacking risk today; a missing COEP mostly is not. */
const CHECKS = [
  {
    id: 'hsts', header: 'strict-transport-security', weight: 18, label: 'HSTS',
    grade(v) {
      if (!v) return { level: 'fail', note: 'Absent. A first visit over http:// can be intercepted before the redirect to https:// happens.' };
      const max = Number((/max-age=(\d+)/i.exec(v) || [])[1] || 0);
      if (max < 10368000) return { level: 'warn', note: `max-age is ${max}s. Under 120 days is short enough that the protection lapses between visits; 31536000 (one year) is the usual target.` };
      if (!/includeSubDomains/i.test(v)) return { level: 'warn', note: 'No includeSubDomains, so a subdomain over plain HTTP can still be used to set cookies for the parent domain.' };
      return { level: 'pass', note: `max-age ${max}s with subdomains covered.` };
    },
    fix: 'Strict-Transport-Security: max-age=31536000; includeSubDomains\n\nAdd preload only once you are certain every subdomain is HTTPS — it is very hard to undo.',
  },
  {
    id: 'csp', header: 'content-security-policy', weight: 20, label: 'Content Security Policy',
    grade(v, h) {
      if (!v) {
        return h['content-security-policy-report-only']
          ? { level: 'warn', note: 'Only in report-only mode, so it logs violations and blocks nothing. Useful while tuning, no protection yet.' }
          : { level: 'fail', note: 'Absent. This is the main defence against injected scripts, which is how most CMS compromises actually monetise.' };
      }
      const issues = [];
      if (/'unsafe-inline'/.test(v) && /script-src|default-src/.test(v)) issues.push("'unsafe-inline' in script-src defeats most of the XSS protection");
      if (/'unsafe-eval'/.test(v)) issues.push("'unsafe-eval' allows string-to-code execution");
      if (/(script-src|default-src)[^;]*\*(\s|;|$)/.test(v)) issues.push('a wildcard source allows scripts from anywhere');
      if (!/object-src/.test(v) && !/default-src/.test(v)) issues.push("no object-src or default-src, so plugin content is unrestricted");
      if (issues.length) return { level: 'warn', note: `Present but weakened: ${issues.join('; ')}.` };
      return { level: 'pass', note: 'Present with no obvious bypass.' };
    },
    fix: `Content-Security-Policy: default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'

Deploy as Content-Security-Policy-Report-Only first and watch the violations for a week. A CSP that blocks your own assets will also block Googlebot's render, which turns a security header into an SEO problem.`,
  },
  {
    id: 'xfo', header: 'x-frame-options', weight: 12, label: 'Framing protection',
    grade(v, h) {
      const csp = h['content-security-policy'] || '';
      if (/frame-ancestors/i.test(csp)) return { level: 'pass', note: 'Handled by CSP frame-ancestors, which supersedes this header.' };
      if (!v) return { level: 'fail', note: 'Absent, and no CSP frame-ancestors either. The site can be framed on an attacker page and its clicks hijacked.' };
      if (/allow-from/i.test(v)) return { level: 'warn', note: 'ALLOW-FROM is obsolete and ignored by modern browsers. Use CSP frame-ancestors instead.' };
      return { level: 'pass', note: `Set to ${v}.` };
    },
    fix: "Content-Security-Policy: frame-ancestors 'self'\n\nOr, for older browsers: X-Frame-Options: SAMEORIGIN",
  },
  {
    id: 'xcto', header: 'x-content-type-options', weight: 10, label: 'MIME-sniffing protection',
    grade(v) {
      if (!v) return { level: 'fail', note: 'Absent. Browsers may guess a response is script when it is not, turning an upload directory into an execution path.' };
      return /nosniff/i.test(v) ? { level: 'pass', note: 'nosniff set.' } : { level: 'warn', note: `Unexpected value "${v}" — the only valid one is nosniff.` };
    },
    fix: 'X-Content-Type-Options: nosniff',
  },
  {
    id: 'referrer', header: 'referrer-policy', weight: 8, label: 'Referrer policy',
    grade(v) {
      if (!v) return { level: 'warn', note: 'Absent. Browsers default to strict-origin-when-cross-origin now, so the risk is modest, but paths can still leak on older clients.' };
      if (/unsafe-url|^origin-when-cross-origin$/i.test(v)) return { level: 'warn', note: `"${v}" sends more than it needs to. Full URLs of private pages can leak to third parties.` };
      return { level: 'pass', note: `Set to ${v}.` };
    },
    fix: 'Referrer-Policy: strict-origin-when-cross-origin\n\nNote: no-referrer will hide your referral traffic from your own analytics and from sites you link to. strict-origin-when-cross-origin is the balanced choice.',
  },
  {
    id: 'permissions', header: 'permissions-policy', weight: 6, label: 'Permissions policy',
    grade(v) {
      if (!v) return { level: 'warn', note: 'Absent. Embedded third-party frames can request camera, microphone and geolocation on your origin.' };
      return { level: 'pass', note: 'Present.' };
    },
    fix: 'Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()\n\nList only what the site genuinely uses; everything else empty.',
  },
  {
    id: 'coop', header: 'cross-origin-opener-policy', weight: 5, label: 'Cross-origin isolation',
    grade(v) {
      if (!v) return { level: 'warn', note: 'Absent. A window you open can retain a reference back to yours. Low risk for a content site, worth setting on anything with a login.' };
      return { level: 'pass', note: `Set to ${v}.` };
    },
    fix: 'Cross-Origin-Opener-Policy: same-origin',
  },
];

/** Headers that advertise the exact software version — free reconnaissance. */
const DISCLOSURE = ['server', 'x-powered-by', 'x-aspnet-version', 'x-generator', 'x-drupal-cache'];

function cookieIssues(setCookie) {
  const raw = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const out = [];
  for (const c of raw) {
    const name = String(c).split('=')[0].trim();
    const flags = [];
    if (!/;\s*Secure/i.test(c)) flags.push('no Secure flag, so it can be sent over plain HTTP');
    if (!/;\s*HttpOnly/i.test(c)) flags.push('no HttpOnly, so injected JavaScript can read it');
    if (!/;\s*SameSite/i.test(c)) flags.push('no SameSite, which leaves it exposed to cross-site request forgery');
    if (flags.length) out.push({ name, flags });
  }
  return out;
}

/**
 * Audits one page's response headers. Grades A–F on a weighted score, because
 * "7 of 9 headers present" tells you nothing about whether the two missing ones
 * are the ones that matter.
 */
export function auditHeaders(page) {
  const h = lower(page.headers || {});
  const isHttps = String(page.url || '').startsWith('https://');
  const results = [];
  let earned = 0, possible = 0;

  for (const c of CHECKS) {
    // Grading HSTS on an HTTP origin is noise — the HTTPS finding already covers it.
    if (c.id === 'hsts' && !isHttps) {
      results.push({ ...meta(c), level: 'skip', note: 'Not applicable until the site is served over HTTPS.', fix: c.fix });
      continue;
    }
    const g = c.grade(h[c.header], h);
    possible += c.weight;
    earned += g.level === 'pass' ? c.weight : g.level === 'warn' ? c.weight * 0.5 : 0;
    results.push({ ...meta(c), level: g.level, note: g.note, value: h[c.header] || null, fix: c.fix });
  }

  const disclosed = DISCLOSURE
    .filter((k) => h[k])
    .map((k) => ({ header: k, value: h[k], versioned: /\d+\.\d+/.test(String(h[k])) }));
  const cookies = cookieIssues(h['set-cookie']);

  const pct = possible ? Math.round((earned / possible) * 100) : 0;
  const grade = pct >= 90 ? 'A' : pct >= 75 ? 'B' : pct >= 60 ? 'C' : pct >= 40 ? 'D' : pct >= 20 ? 'E' : 'F';

  return {
    url: page.url, https: isHttps, score: pct, grade, results, disclosed, cookies,
    summary: `${results.filter((r) => r.level === 'pass').length} of ${results.filter((r) => r.level !== 'skip').length} headers configured properly.`,
    seoNote: 'Only HSTS and a badly scoped CSP touch search directly. The rest matter because a compromised site loses rankings in a way on-page work cannot recover.',
  };
}

const meta = (c) => ({ id: c.id, label: c.label, header: c.header, weight: c.weight });

/** Site-level roll-up: header config is usually server-wide, so a per-page list
    would be the same row repeated. Report the shared posture and any outliers. */
export function auditSite(pages) {
  const html = pages.filter((p) => p.status === 200 && /html/i.test(p.contentType || ''));
  if (!html.length) return null;
  const audits = html.map(auditHeaders);

  const byId = {};
  for (const a of audits) {
    for (const r of a.results) {
      (byId[r.id] ||= { ...r, pages: 0, failing: [] });
      if (r.level === 'fail' || r.level === 'warn') { byId[r.id].pages++; byId[r.id].failing.push(a.url); }
    }
  }
  const worst = audits.reduce((a, b) => (a.score <= b.score ? a : b));
  const best = audits.reduce((a, b) => (a.score >= b.score ? a : b));

  return {
    pagesAudited: audits.length,
    score: Math.round(audits.reduce((t, a) => t + a.score, 0) / audits.length),
    grade: worst.grade,
    consistent: worst.score === best.score,
    representative: worst,
    issues: Object.values(byId)
      .filter((r) => r.pages > 0)
      .sort((a, b) => b.weight - a.weight)
      .map((r) => ({ ...r, failing: r.failing.slice(0, 8), allPages: r.pages === audits.length })),
    disclosed: worst.disclosed,
    // Cookies are set server-wide, so the same one appears on every page.
    cookies: [...new Map(audits.flatMap((a) => a.cookies).map((c) => [c.name, c])).values()].slice(0, 10),
  };
}

/** One block covering every gap, since these ship together in one config file. */
export function headerConfig(site, platform = 'generic') {
  const needed = (site?.issues || []).map((i) => i.id);
  const raw = CHECKS.filter((c) => needed.includes(c.id)).map((c) => c.fix.split('\n')[0]);

  /* One header name must appear once. The framing fix and the CSP fix are both
     Content-Security-Policy directives, so emitting both would set the header
     twice and the second would silently replace the first — dropping the real
     policy and leaving the site less protected than before. Merge instead. */
  const byName = new Map();
  for (const line of raw) {
    const i = line.indexOf(':');
    if (i < 0) continue;
    const name = line.slice(0, i).trim();
    const value = line.slice(i + 1).trim();
    if (!byName.has(name)) { byName.set(name, value); continue; }
    if (name.toLowerCase() === 'content-security-policy') {
      const existing = byName.get(name);
      const merged = [...new Set([...existing.split(';'), ...value.split(';')]
        .map((d) => d.trim()).filter(Boolean))];
      // Keep one directive per keyword; the more specific value wins.
      const seenKey = new Map();
      for (const d of merged) {
        const key = d.split(/\s+/)[0];
        if (!seenKey.has(key) || d.length > seenKey.get(key).length) seenKey.set(key, d);
      }
      byName.set(name, [...seenKey.values()].join('; '));
    }
  }
  const lines = [...byName.entries()].map(([k, v]) => `${k}: ${v}`);
  if (!lines.length) return null;

  const apache = `# .htaccess or vhost\n<IfModule mod_headers.c>\n${lines.map((l) => {
    const [k, ...v] = l.split(':');
    return `  Header always set ${k.trim()} "${v.join(':').trim()}"`;
  }).join('\n')}\n</IfModule>`;

  const nginx = `# inside your server { } block\n${lines.map((l) => {
    const [k, ...v] = l.split(':');
    return `add_header ${k.trim()} "${v.join(':').trim()}" always;`;
  }).join('\n')}`;

  return {
    raw: lines.join('\n'), apache, nginx,
    note: 'Ship the CSP as Content-Security-Policy-Report-Only first. A CSP that blocks your own stylesheets also blocks Googlebot\'s render, which turns a security fix into a ranking problem.',
  };
}

export { CHECKS as SECURITY_CHECKS };
