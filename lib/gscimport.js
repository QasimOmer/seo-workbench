/* Search Console via CSV import.
   OAuth needs a Google Cloud project, a consent screen and a client secret —
   fifteen minutes of clicking for data you can export from the Search Console
   UI in two. This path gives the same numbers with no setup at all, which for
   most people is the difference between having Google's data and not.

   Search Console's Performance export is a ZIP of CSVs (Queries.csv,
   Pages.csv, Countries.csv, Devices.csv, Dates.csv) or a single sheet if you
   copy one table. Both shapes are accepted, and so are the localised column
   headers, because the export follows the UI language. */

/* Header synonyms across the exports and UI languages people actually hit. */
const COLS = {
  query: ['top queries', 'query', 'queries', 'search query', 'requêtes les plus fréquentes', 'consultas principales', 'suchanfrage'],
  page: ['top pages', 'page', 'pages', 'landing page', 'url', 'pages les plus populaires', 'páginas principales'],
  date: ['date', 'dates', 'fecha', 'datum'],
  country: ['country', 'countries', 'pays', 'país'],
  device: ['device', 'devices', 'appareil', 'dispositivo'],
  clicks: ['clicks', 'click', 'clics', 'klicks'],
  impressions: ['impressions', 'impression', 'impresiones', 'impressionen'],
  ctr: ['ctr', 'click through rate', 'taux de clics'],
  position: ['position', 'average position', 'avg. position', 'position moyenne', 'posición media', 'durchschnittliche position'],
};

const norm = (s) => String(s || '').trim().toLowerCase().replace(/^\uFEFF/, '').replace(/["']/g, '');

function columnIndex(header) {
  const idx = {};
  header.forEach((h, i) => {
    const n = norm(h);
    for (const [key, names] of Object.entries(COLS)) {
      if (names.includes(n) && idx[key] === undefined) idx[key] = i;
    }
  });
  return idx;
}

/** Handles quoted fields, embedded commas and both line endings. */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  const src = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim()));
}

/* Percentages, thousands separators and decimal commas all appear in the
   wild depending on locale. "1,234" is a count; "1,23%" is a rate. */
function num(v) {
  let s = String(v ?? '').trim().replace(/%/g, '');
  if (!s) return 0;
  if (/,\d{1,2}$/.test(s) && !/\.\d/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

const rate = (v) => {
  const raw = String(v ?? '');
  const n = num(raw);
  // A CTR may arrive as "3.2%" or as "0.032".
  return raw.includes('%') || n > 1 ? n / 100 : n;
};

/**
 * Reads one exported table and works out what dimension it carries from its
 * own header, so you can drop in Queries.csv or Pages.csv without saying which.
 */
export function importTable(text, hint = '') {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error('That file has no data rows. Export the Performance report from Search Console, then upload one of the CSVs from the ZIP.');

  const idx = columnIndex(rows[0]);
  if (idx.clicks === undefined && idx.impressions === undefined) {
    throw new Error(`Could not find Clicks or Impressions columns. Header was: ${rows[0].slice(0, 6).join(', ')}. This importer expects a Search Console Performance export — Console → Performance → Export → CSV.`);
  }

  const dimension = ['query', 'page', 'date', 'country', 'device'].find((d) => idx[d] !== undefined)
    || (hint && COLS[hint] ? hint : null);
  if (!dimension) {
    throw new Error(`The file has metrics but no recognisable dimension column. Header was: ${rows[0].slice(0, 6).join(', ')}.`);
  }

  const out = [];
  for (const r of rows.slice(1)) {
    const key = String(r[idx[dimension]] ?? '').trim();
    if (!key) continue;
    out.push({
      [dimension]: key,
      clicks: idx.clicks !== undefined ? Math.round(num(r[idx.clicks])) : 0,
      impressions: idx.impressions !== undefined ? Math.round(num(r[idx.impressions])) : 0,
      ctr: idx.ctr !== undefined ? rate(r[idx.ctr]) : 0,
      position: idx.position !== undefined ? num(r[idx.position]) : 0,
    });
  }
  if (!out.length) throw new Error('Every row was empty after parsing. Check the file is the CSV and not the ZIP itself.');

  // Derive CTR when the export omitted it.
  for (const r of out) if (!r.ctr && r.impressions) r.ctr = r.clicks / r.impressions;

  return {
    dimension, rows: out,
    totals: {
      clicks: out.reduce((t, r) => t + r.clicks, 0),
      impressions: out.reduce((t, r) => t + r.impressions, 0),
      position: out.length ? +(out.reduce((t, r) => t + r.position, 0) / out.length).toFixed(1) : 0,
    },
  };
}

/** Accepts several files at once — the ZIP contains one per dimension. */
export function importBundle(files) {
  const byDimension = {};
  const errors = [];
  for (const f of files) {
    try {
      const t = importTable(f.text, f.name);
      byDimension[t.dimension] = t;
    } catch (e) {
      errors.push({ file: f.name, error: e.message });
    }
  }
  if (!Object.keys(byDimension).length) {
    throw new Error(errors.length ? errors.map((e) => `${e.file}: ${e.error}`).join(' — ') : 'No usable files.');
  }
  return { dimensions: byDimension, errors };
}

/* ── analysis that needs no API ───────────────────────────────────────────── */

/** Queries ranking 4–20 with real impressions: the cheapest wins available. */
export function strikingDistance(queryTable, { minImpressions = 30 } = {}) {
  return (queryTable?.rows || [])
    .filter((r) => r.position >= 4 && r.position <= 20 && r.impressions >= minImpressions)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 40)
    .map((r) => ({
      ...r,
      note: r.position <= 10
        ? 'Already on page one. Small on-page and internal-link gains move this the fastest of anything on your list.'
        : 'Page two. Usually needs a genuine content or link improvement rather than a tweak.',
    }));
}

/* Expected CTR by position — a rough industry curve, used only to spot pages
   whose CTR is far below what their position should earn. Absolute values vary
   enormously by query type, so the gap is the signal, never the number. */
const CTR_CURVE = [0, 0.28, 0.15, 0.11, 0.08, 0.06, 0.05, 0.04, 0.033, 0.028, 0.025];

export function ctrGaps(queryTable, { minImpressions = 100 } = {}) {
  return (queryTable?.rows || [])
    .filter((r) => r.impressions >= minImpressions && r.position >= 1 && r.position <= 10)
    .map((r) => {
      const expected = CTR_CURVE[Math.round(r.position)] || 0.02;
      return { ...r, expected, gap: +(((r.ctr - expected) / expected) * 100).toFixed(0) };
    })
    .filter((r) => r.gap <= -35)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 30)
    .map((r) => ({
      ...r,
      note: `Ranking ${r.position.toFixed(1)} but earning ${(r.ctr * 100).toFixed(1)}% CTR against roughly ${(r.expected * 100).toFixed(0)}% expected. You are being shown and not chosen — that is a title and snippet problem, or a SERP feature taking the click.`,
    }));
}

/** Two or more pages competing on one query, from Google's own numbers. */
export function cannibalisation(pageQueryTable) {
  const byQuery = {};
  for (const r of pageQueryTable?.rows || []) {
    if (!r.query || !r.page) continue;
    (byQuery[r.query] ||= []).push(r);
  }
  const out = [];
  for (const [query, rows] of Object.entries(byQuery)) {
    const impressions = rows.reduce((t, r) => t + r.impressions, 0);
    if (impressions < 60 || rows.length < 2) continue;
    const sharing = rows.filter((r) => r.impressions / impressions > 0.15);
    if (sharing.length < 2) continue;
    out.push({
      query, impressions,
      pages: sharing.sort((a, b) => b.impressions - a.impressions)
        .map((r) => ({ page: r.page, clicks: r.clicks, impressions: r.impressions, position: r.position, share: Math.round((r.impressions / impressions) * 100) })),
    });
  }
  return out.sort((a, b) => b.impressions - a.impressions).slice(0, 25);
}
