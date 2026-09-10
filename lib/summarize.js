/* Extractive summarizer — local, no model, no network.
   Scores each sentence and keeps the best ones in their original order. That
   makes it factually safe by construction: every word in the output already
   appeared on the page, so it cannot invent a claim about a client's business.
   An abstractive model writes better prose and can hallucinate; for meta
   descriptions and excerpts that trade is not worth making. */

const STOP = new Set(('a about above after again against all am an and any are as at be because been before being below '
  + 'between both but by can did do does doing down during each few for from further had has have having he her here hers '
  + 'herself him himself his how i if in into is it its itself just me more most my myself no nor not now of off on once '
  + 'only or other our ours ourselves out over own same she should so some such than that the their theirs them themselves '
  + 'then there these they this those through to too under until up very was we were what when where which while who whom '
  + 'why will with you your yours yourself yourselves also may said one two get like will').split(' '));

const words = (s) => String(s).toLowerCase().match(/[a-z][a-z'-]+/g) || [];

function splitSentences(text) {
  return String(text)
    .replace(/\s+/g, ' ')
    // Protect common abbreviations so they don't create false sentence breaks.
    .replace(/\b(Mr|Mrs|Ms|Dr|Prof|Inc|Ltd|Co|vs|etc|e\.g|i\.e|St|No)\.\s/g, '$1<DOT> ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.replace(/<DOT>/g, '.').trim())
    .filter((s) => s.length > 30 && /[a-z]/i.test(s));
}

/**
 * TF-based sentence scoring with position and length priors.
 * Not TextRank: on a single page TextRank's graph is too sparse to beat term
 * frequency, and it costs an O(n²) similarity matrix to find out.
 */
export function summarize(text, { sentences = 3, maxChars = 0 } = {}) {
  const all = splitSentences(text);
  if (!all.length) return { summary: '', sentences: [], note: 'No sentences long enough to summarise.' };
  if (all.length <= sentences) return { summary: all.join(' '), sentences: all, note: 'Text was already shorter than the requested summary.' };

  const freq = {};
  for (const s of all) for (const w of words(s)) if (!STOP.has(w) && w.length > 2) freq[w] = (freq[w] || 0) + 1;
  const peak = Math.max(...Object.values(freq), 1);

  const scored = all.map((s, i) => {
    const ws = words(s).filter((w) => !STOP.has(w) && w.length > 2);
    if (!ws.length) return { s, i, score: 0 };
    const tf = ws.reduce((t, w) => t + freq[w] / peak, 0) / ws.length;
    // Opening sentences carry the thesis; very long ones are usually padding.
    const position = i === 0 ? 1.35 : i === 1 ? 1.15 : i < all.length * 0.3 ? 1.05 : 1;
    const len = s.length > 260 ? 0.8 : s.length < 60 ? 0.85 : 1;
    return { s, i, score: tf * position * len };
  });

  /* Pages repeat themselves — boilerplate, restated intros, duplicated blocks.
     Picking the top N by score alone can return the same sentence twice, which
     reads as a bug. Reject a candidate that overlaps heavily with one already
     chosen, and take the next best instead. */
  const chosen = [];
  const overlaps = (a, b) => {
    const A = new Set(words(a).filter((w) => !STOP.has(w)));
    const B = new Set(words(b).filter((w) => !STOP.has(w)));
    if (!A.size || !B.size) return false;
    let shared = 0;
    for (const w of A) if (B.has(w)) shared++;
    return shared / Math.min(A.size, B.size) > 0.7;
  };
  for (const cand of [...scored].sort((a, b) => b.score - a.score)) {
    if (chosen.length >= sentences) break;
    if (chosen.some((c) => overlaps(c.s, cand.s))) continue;
    chosen.push(cand);
  }
  let picked = chosen.sort((a, b) => a.i - b.i).map((x) => x.s);

  let summary = picked.join(' ');
  if (maxChars && summary.length > maxChars) {
    while (picked.length > 1 && picked.join(' ').length > maxChars) picked.pop();
    summary = picked.join(' ');
    if (summary.length > maxChars) summary = `${summary.slice(0, summary.lastIndexOf(' ', maxChars - 1))}…`;
  }

  return {
    summary, sentences: picked,
    keywords: Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([w, n]) => ({ term: w, count: n })),
    note: 'Extractive: every sentence is taken verbatim from the source, so nothing here is invented. Reads less smoothly than a rewrite, and is safe to put in front of a client without checking facts.',
  };
}

/** A meta description built from the page's own sentences, within the pixel budget. */
export function excerpt(text, maxChars = 155) {
  const r = summarize(text, { sentences: 2, maxChars });
  return r.summary;
}
