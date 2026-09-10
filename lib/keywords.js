// Demand research. Phase 0, and the playbook is explicit that it runs first —
// without a keyword-to-URL map, "intent mismatch", "cannibalisation" and
// "content gap" are assertions rather than findings.
//
// Honest limits of the free tier, surfaced in the UI rather than buried:
//   • No search volume. Nothing free returns it. Volume is the weakest input
//     to prioritisation anyway — conversion proximity and differentiability
//     matter more — but you cannot report a number you do not have.
//   • No live SERP scrape, so clustering by SERP similarity (the correct
//     method) is not available. Two proxies are offered and labelled as such:
//     autocomplete co-occurrence, and GSC landing-page grouping.

const AC = 'https://suggestqueries.google.com/complete/search';
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz'.split('');
const QUESTIONS = ['how', 'what', 'why', 'when', 'where', 'who', 'which', 'can', 'do', 'does', 'is', 'are', 'should', 'will'];
const COMMERCIAL = ['near me', 'cost', 'price', 'best', 'top', 'reviews', 'vs', 'attorney', 'lawyer', 'free', 'consultation'];

async function suggest(term, { gl = 'us', hl = 'en' } = {}) {
  const params = new URLSearchParams({ client: 'chrome', q: term, gl, hl });
  try {
    const res = await fetch(`${AC}?${params}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36' },
    });
    if (!res.ok) return [];
    const text = await res.text();
    const data = JSON.parse(text);
    return Array.isArray(data?.[1]) ? data[1] : [];
  } catch {
    return [];
  }
}

/**
 * Expand a seed into a candidate set. Modifier passes give shape to the
 * expansion — questions surface informational intent, commercial modifiers
 * surface transactional, alphabet soup catches the long tail.
 */
export async function expand(seed, opts = {}) {
  const { alphabet = true, questions = true, commercial = true, gl = 'us', hl = 'en', concurrency = 4 } = opts;
  const probes = [seed];
  if (questions) QUESTIONS.forEach((q) => probes.push(`${q} ${seed}`));
  if (commercial) COMMERCIAL.forEach((m) => probes.push(`${seed} ${m}`));
  if (alphabet) ALPHABET.forEach((l) => probes.push(`${seed} ${l}`));

  const found = new Map();
  const queue = [...probes];
  const worker = async () => {
    while (queue.length) {
      const p = queue.shift();
      const results = await suggest(p, { gl, hl });
      results.forEach((r, rank) => {
        const key = r.toLowerCase().trim();
        const e = found.get(key) || { keyword: key, sources: [], bestRank: 99, seenIn: 0 };
        e.sources.push(p);
        e.bestRank = Math.min(e.bestRank, rank);
        e.seenIn++;
        found.set(key, e);
      });
      await new Promise((r) => setTimeout(r, 120));
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));

  return [...found.values()]
    .filter((k) => k.keyword !== seed.toLowerCase())
    .map((k) => ({
      keyword: k.keyword,
      // seenIn is the only demand proxy available free: how many independent
      // probes surfaced the same phrase. It is a popularity hint, not volume.
      breadth: k.seenIn,
      bestRank: k.bestRank,
      intent: classifyIntent(k.keyword),
      isQuestion: QUESTIONS.some((q) => k.keyword.startsWith(`${q} `)),
      words: k.keyword.split(/\s+/).length,
    }))
    .sort((a, b) => b.breadth - a.breadth || a.bestRank - b.bestRank);
}

/** People-Also-Ask-shaped question set, built from autocomplete rather than scraped. */
export async function questionSet(seed, opts = {}) {
  const out = new Set();
  const probes = QUESTIONS.map((q) => `${q} ${seed}`);
  for (const p of probes) {
    const r = await suggest(p, opts);
    r.filter((x) => QUESTIONS.some((q) => x.toLowerCase().startsWith(`${q} `))).forEach((x) => out.add(x.toLowerCase()));
    await new Promise((r) => setTimeout(r, 100));
  }
  return [...out].sort();
}

/**
 * Intent classification from surface language. Directional only — the real
 * read is the SERP, which the playbook is emphatic about. Labelled inferred.
 */
export function classifyIntent(kw) {
  const k = ` ${kw.toLowerCase()} `;
  if (/\b(buy|hire|price|cost|fee|quote|near me|consultation|book|appointment|contact)\b/.test(k)) return 'transactional';
  if (/\b(best|top|vs|versus|compare|review|alternative|cheapest|which)\b/.test(k)) return 'commercial';
  if (/\b(how|what|why|when|guide|tutorial|meaning|definition|explained|examples?)\b/.test(k)) return 'informational';
  if (/\b(login|sign in|hours|address|phone|location|directions)\b/.test(k)) return 'navigational';
  return 'unclear';
}

/**
 * Cluster candidates. Method is declared with the result because it changes
 * how much the output can be trusted.
 */
export function cluster(keywords, { method = 'token' } = {}) {
  const STOP = new Set(['the','a','an','of','for','in','to','and','or','is','are','my','your','with','on','at','how','what','why','can','do','does','near','me','best','top']);
  const tokens = (k) => k.split(/\s+/).map((w) => w.replace(/[^a-z0-9]/g, '')).filter((w) => w.length > 2 && !STOP.has(w));

  const items = keywords.map((k) => ({ ...(typeof k === 'string' ? { keyword: k } : k), tokens: tokens(typeof k === 'string' ? k : k.keyword) }));
  const clusters = [];

  for (const item of items) {
    let best = null, bestScore = 0;
    for (const c of clusters) {
      const score = overlap(item.tokens, c.tokenSet);
      if (score > bestScore) { bestScore = score; best = c; }
    }
    if (best && bestScore >= 0.5) {
      best.members.push(item);
      item.tokens.forEach((t) => best.tokenSet.add(t));
    } else {
      clusters.push({ tokenSet: new Set(item.tokens), members: [item] });
    }
  }

  return clusters
    .map((c) => {
      const head = c.members.slice().sort((a, b) => (b.breadth || 0) - (a.breadth || 0) || a.keyword.length - b.keyword.length)[0];
      const intents = c.members.map((m) => m.intent || classifyIntent(m.keyword));
      return {
        label: head.keyword,
        size: c.members.length,
        dominantIntent: mode(intents),
        intentMixed: new Set(intents).size > 2,
        members: c.members.map((m) => ({ keyword: m.keyword, breadth: m.breadth ?? null, intent: m.intent || classifyIntent(m.keyword) })),
        method,
        confidence: 'inferred — grouped by shared tokens, not by SERP overlap. Sample the live SERPs before committing a page to a cluster.',
      };
    })
    .sort((a, b) => b.size - a.size);
}

/**
 * The keyword-to-URL map, and the two findings that fall out of it:
 * gaps (cluster with value and no page) and cannibalisation (two URLs, one cluster).
 */
export function buildMap(clusters, pages) {
  const candidates = pages
    .filter((p) => p.status === 200 && !p.noindex)
    .map((p) => ({
      url: p.url,
      text: `${p.title || ''} ${(p.h1s || []).join(' ')} ${(p.headings || []).map((h) => h.text).join(' ')} ${(p.bodyText || '').slice(0, 3000)}`.toLowerCase(),
      title: p.title,
    }));

  const rows = clusters.map((c) => {
    const terms = [...new Set(c.label.split(/\s+/).concat(c.members.slice(0, 8).flatMap((m) => m.keyword.split(/\s+/))))]
      .filter((t) => t.length > 3);
    const scored = candidates
      .map((p) => ({ url: p.url, title: p.title, score: terms.filter((t) => p.text.includes(t)).length / Math.max(1, terms.length) }))
      .filter((p) => p.score > 0.35)
      .sort((a, b) => b.score - a.score);

    return {
      cluster: c.label,
      size: c.size,
      intent: c.dominantIntent,
      matches: scored.slice(0, 4).map((m) => ({ url: m.url, title: m.title, score: Math.round(m.score * 100) })),
      status: scored.length === 0 ? 'gap' : scored.length > 1 && scored[1].score > scored[0].score * 0.85 ? 'contested' : 'mapped',
    };
  });

  return {
    map: rows,
    gaps: rows.filter((r) => r.status === 'gap'),
    contested: rows.filter((r) => r.status === 'contested'),
    mapped: rows.filter((r) => r.status === 'mapped'),
    note: 'Matching is lexical, against page text. It finds candidate pages, not confirmed intent matches. Validate the contested rows against the GSC query export before calling them cannibalisation — from a crawl alone it is a guess.',
  };
}

/** Competitor gap — queries a competitor's pages cover that yours do not. */
export function competitorGap(ourPages, theirPages) {
  const terms = (pages) => {
    const m = new Map();
    for (const p of pages) {
      const words = `${p.title || ''} ${(p.h1s || []).join(' ')} ${(p.headings || []).map((h) => h.text).join(' ')}`
        .toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/);
      for (let i = 0; i < words.length - 1; i++) {
        const bg = `${words[i]} ${words[i + 1]}`;
        if (words[i].length < 4 || words[i + 1].length < 4) continue;
        m.set(bg, (m.get(bg) || 0) + 1);
      }
    }
    return m;
  };
  const ours = terms(ourPages), theirs = terms(theirPages);
  return [...theirs.entries()]
    .filter(([t, n]) => n >= 2 && !ours.has(t))
    .map(([topic, count]) => ({ topic, theirPages: count, ourPages: 0 }))
    .sort((a, b) => b.theirPages - a.theirPages)
    .slice(0, 80);
}

function overlap(tokens, set) {
  if (!tokens.length) return 0;
  let hit = 0;
  for (const t of tokens) if (set.has(t)) hit++;
  return hit / tokens.length;
}
function mode(arr) {
  const c = {};
  arr.forEach((x) => { c[x] = (c[x] || 0) + 1; });
  return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] || 'unclear';
}
