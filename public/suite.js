
/* ══════════════════════════ icons ══════════════════════════ */
/* Inline sprite: no library, no webfont, no extra request, and they inherit
   currentColor so one definition works in both themes. Each is chosen to
   describe the section rather than to decorate it. */
const ICONS = {
  overview:  '<path d="M3 12h4l2-7 3 14 2-7h4"/>',
  pages:     '<path d="M4 3h9l3 3v11H4z"/><path d="M13 3v3h3"/><path d="M7 9h6M7 12h6"/>',
  console:   '<path d="M3 16V8M7.5 16V5M12 16v-6M16.5 16V3"/>',
  speed:     '<path d="M10 17a7 7 0 1 1 7-7"/><path d="M10 10l4-3"/><circle cx="10" cy="10" r="1"/>',
  security:  '<path d="M10 3l6 2v5c0 4-2.7 6.4-6 7-3.3-.6-6-3-6-7V5z"/><path d="M7.5 10l2 2 3.5-4"/>',
  rank:      '<path d="M3 17h14"/><path d="M6 17v-5M10 17V7M14 17v-8"/>',
  newsite:   '<path d="M10 3v14M3 10h14"/><rect x="3" y="3" width="14" height="14" rx="2"/>',
  demand:    '<circle cx="9" cy="9" r="5"/><path d="M13 13l4 4"/>',
  program:   '<rect x="3" y="4" width="14" height="13" rx="2"/><path d="M3 8h14M7 2v3M13 2v3"/><path d="M7 12l1.5 1.5L12 11"/>',
  build:     '<path d="M11 3l6 6-2 2-6-6z"/><path d="M9 5L3 11v4h4l6-6"/>',
  social:    '<circle cx="6" cy="10" r="2.5"/><circle cx="14" cy="5" r="2.5"/><circle cx="14" cy="15" r="2.5"/><path d="M8.2 8.8l3.6-2.2M8.2 11.2l3.6 2.2"/>',
  campaigns: '<path d="M4 8v4l9 4V4z"/><path d="M4 8H2v4h2"/><path d="M16 8a3 3 0 0 1 0 4"/>',
  ship:      '<path d="M3 12l7 4 7-4"/><path d="M3 8l7 4 7-4-7-4z"/>',
  monitors:  '<path d="M2 10h3l2-5 3 10 2-5h6"/>',
  crawl:     '<circle cx="10" cy="10" r="7"/><path d="M3 10h14M10 3c2.5 2.5 2.5 11.5 0 14M10 3c-2.5 2.5-2.5 11.5 0 14"/>',
  brand:     '<path d="M10 3l2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4L5.5 16.8l.9-5L2.8 8.3l5-.7z"/>',
  setup:     '<circle cx="10" cy="10" r="2.5"/><path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.5 4.5l1.4 1.4M14.1 14.1l1.4 1.4M4.5 15.5l1.4-1.4M14.1 5.9l1.4-1.4"/>',
  health:    '<path d="M2 10h4l2 4 4-8 2 4h4"/>',
  aivis:     '<path d="M10 3a7 7 0 1 0 7 7"/><path d="M10 3v7l5 2"/><circle cx="10" cy="10" r="1.3"/>',
  logs:      '<path d="M4 3h9l3 3v11H4z"/><path d="M7 8h6M7 11h6M7 14h3"/>',
  competitors: '<path d="M3 16V9M8 16V4M13 16v-5M18 16V7"/><path d="M2 18h16"/>',
  clarity:   '<path d="M4 14l3-3 2.5 2L16 6"/><circle cx="7" cy="11" r="1.4"/><circle cx="9.5" cy="13" r="1.4"/>',
  people:    '<circle cx="7" cy="7" r="2.8"/><path d="M2.5 16c0-2.6 2-4.2 4.5-4.2S11.5 13.4 11.5 16"/><path d="M13 5.2a2.8 2.8 0 0 1 0 5.4M14 11.9c2 .5 3.5 1.9 3.5 4.1"/>',
  sun:       '<circle cx="10" cy="10" r="3.5"/><path d="M10 2.5v1.8M10 15.7v1.8M2.5 10h1.8M15.7 10h1.8M4.7 4.7l1.3 1.3M14 14l1.3 1.3M4.7 15.3L6 14M14 6l1.3-1.3"/>',
  moon:      '<path d="M15.5 11.5A6.5 6.5 0 0 1 8.5 4.5a6.5 6.5 0 1 0 7 7z"/>',
  check:     '<path d="M4 10.5l3.5 3.5L16 6"/>',
  alert:     '<path d="M10 3l7 13H3z"/><path d="M10 8v3.5M10 13.6v.1"/>',
  info:      '<circle cx="10" cy="10" r="7"/><path d="M10 9v5M10 6.6v.1"/>',
};

const icon = (name, cls = '') =>
  ICONS[name] ? `<svg class="i ${cls}" viewBox="0 0 20 20" aria-hidden="true">${ICONS[name]}</svg>` : '';

/* Nav icons are injected rather than written into the markup, so the sprite
   stays in one place and index.html stays readable. */
function paintNavIcons() {
  $$('.navitem[data-panel]').forEach((b) => {
    if (b.querySelector('.i')) return;
    const svg = icon(b.dataset.panel);
    if (svg) b.insertAdjacentHTML('afterbegin', svg);
  });
}

/* ══════════════════════════ theme ══════════════════════════ */
/* Dark by default: this is a tool you sit in, and the low-chroma editor
   register is what makes an hour in it comfortable. */
const THEME_KEY = 'sw-theme';
function setTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  try { window.localStorage?.setItem(THEME_KEY, t); } catch { /* private mode */ }
  $$('.themeswitch button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.theme === t)));
}
function initTheme() {
  let t = 'dark';
  try { t = window.localStorage?.getItem(THEME_KEY) || 'dark'; } catch { /* ignore */ }
  const host = $('#themeSwitch');
  if (host) {
    host.innerHTML = `
      <button data-theme="dark" title="Dark" aria-pressed="false">${icon('moon', 'sm')}</button>
      <button data-theme="light" title="Light" aria-pressed="false">${icon('sun', 'sm')}</button>`;
    $$('.themeswitch button').forEach((b) => b.addEventListener('click', () => setTheme(b.dataset.theme)));
  }
  setTheme(t);
}

/* ══════════════════════════ toasts ══════════════════════════ */
/* Actions that finish while you are looking elsewhere need to say so. */
function toast(message, kind = 'info', title = '') {
  let host = $('#toasts');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toasts';
    host.className = 'toasts';
    document.body.appendChild(host);
  }
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = `${icon(kind === 'ok' ? 'check' : kind === 'err' ? 'alert' : 'info')}
    <div>${title ? `<b>${esc(title)}</b>` : ''}${esc(message)}</div>`;
  host.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 200); }, kind === 'err' ? 7000 : 4000);
}
window.toast = toast;
/* Charts, brand context, the plan, social posts and campaigns.
   Loaded after app.js and reuses its helpers. Charts are hand-rolled SVG: a
   charting library would be 200KB to draw eight lines, and this way the plots
   inherit the palette instead of fighting it. */

/* ══════════════════════════════ charts ══════════════════════════════ */

/** Line chart with optional good/needs-work threshold bands. Bands matter more
    than the line here — "is this passing" beats "what is the number". */
function lineChart(series, opts = {}) {
  const { w = 620, h = 150, labels = [], bands = null, unit = '', invert = false } = opts;
  const pad = { t: 10, r: 10, b: 20, l: 42 };
  const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
  const all = series.flatMap((s) => s.values.filter((v) => v != null));
  if (!all.length) return '<div class="empty">No data in this window.</div>';

  let min = Math.min(...all), max = Math.max(...all);
  if (bands) { min = Math.min(min, 0); max = Math.max(max, bands[1] * 1.15); }
  if (min === max) { min = min * 0.9; max = max * 1.1 || 1; }
  const pk = min + (max - min) * 0.06;
  min = Math.max(0, min - (max - min) * 0.12); max += (max - min) * 0.08;

  const n = Math.max(...series.map((s) => s.values.length));
  const x = (i) => pad.l + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v) => pad.t + ih - ((v - min) / (max - min)) * ih;

  let bandRects = '';
  if (bands) {
    const [g, ni] = bands;
    const yg = Math.min(ih + pad.t, Math.max(pad.t, y(g)));
    const yn = Math.min(ih + pad.t, Math.max(pad.t, y(ni)));
    bandRects = `
      <rect x="${pad.l}" y="${yg}" width="${iw}" height="${ih + pad.t - yg}" fill="var(--pine-wash)" opacity=".55"/>
      <rect x="${pad.l}" y="${yn}" width="${iw}" height="${yg - yn}" fill="var(--amber-wash)" opacity=".5"/>
      <rect x="${pad.l}" y="${pad.t}" width="${iw}" height="${yn - pad.t}" fill="var(--rose-wash)" opacity=".45"/>
      <line x1="${pad.l}" y1="${yg}" x2="${w - pad.r}" y2="${yg}" stroke="var(--pine2)" stroke-width="1" stroke-dasharray="3 3"/>`;
  }

  const fmt = (v) => (unit === 'ms' ? `${Math.round(v)}` : v >= 100 ? Math.round(v) : v >= 1 ? v.toFixed(1) : v.toFixed(2));
  const ticks = [min + (max - min) * 0.05, (min + max) / 2, max - (max - min) * 0.05]
    .map((v) => `<text x="${pad.l - 6}" y="${y(v) + 3}" text-anchor="end" class="ct">${fmt(v)}</text>
      <line x1="${pad.l}" y1="${y(v)}" x2="${w - pad.r}" y2="${y(v)}" stroke="var(--rail)" stroke-width=".5" opacity=".5"/>`).join('');

  const paths = series.map((s, si) => {
    const pts = s.values.map((v, i) => (v == null ? null : `${x(i)},${y(v)}`)).filter(Boolean);
    if (!pts.length) return '';
    const stroke = s.color || ['var(--pine)', 'var(--rose)', 'var(--amber)', 'var(--ink3)'][si % 4];
    const last = s.values.map((v, i) => [v, i]).filter(([v]) => v != null).pop();
    return `<polyline points="${pts.join(' ')}" fill="none" stroke="${stroke}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      ${last ? `<circle cx="${x(last[1])}" cy="${y(last[0])}" r="3" fill="${stroke}"/>` : ''}`;
  }).join('');

  const step = Math.max(1, Math.ceil(n / 6));
  const xlab = labels.length
    ? labels.map((l, i) => (i % step === 0 || i === n - 1 ? `<text x="${x(i)}" y="${h - 5}" text-anchor="${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}" class="ct">${l}</text>` : '')).join('')
    : '';

  return `<svg class="chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img">
    ${bandRects}${ticks}${paths}${xlab}
    <line x1="${pad.l}" y1="${pad.t + ih}" x2="${w - pad.r}" y2="${pad.t + ih}" stroke="var(--rail)"/>
  </svg>`;
}

function barChart(values, opts = {}) {
  const { w = 620, h = 110, labels = [], color = 'var(--pine)' } = opts;
  const pad = { t: 8, r: 8, b: 18, l: 40 };
  const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
  const max = Math.max(...values, 1);
  const bw = iw / values.length;
  const bars = values.map((v, i) =>
    `<rect x="${pad.l + i * bw + bw * 0.14}" y="${pad.t + ih - (v / max) * ih}" width="${bw * 0.72}" height="${Math.max(0, (v / max) * ih)}" fill="${color}"/>`).join('');
  const step = Math.max(1, Math.ceil(values.length / 7));
  const xlab = labels.map((l, i) => (i % step === 0 ? `<text x="${pad.l + i * bw + bw / 2}" y="${h - 4}" text-anchor="middle" class="ct">${l}</text>` : '')).join('');
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img">
    <text x="${pad.l - 6}" y="${pad.t + 8}" text-anchor="end" class="ct">${num(max)}</text>
    <text x="${pad.l - 6}" y="${pad.t + ih}" text-anchor="end" class="ct">0</text>
    ${bars}${xlab}
    <line x1="${pad.l}" y1="${pad.t + ih}" x2="${w - pad.r}" y2="${pad.t + ih}" stroke="var(--rail)"/>
  </svg>`;
}

/** Stacked bars — used for findings by stage, where the split by severity is
    the information and the total alone would mislead. */
function stackChart(series, opts = {}) {
  const { w = 620, h = 150, labels = [] } = opts;
  const pad = { t: 10, r: 10, b: 20, l: 34 };
  const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
  const n = Math.max(...series.map((s) => s.values.length), 1);
  const totals = Array.from({ length: n }, (_, i) => series.reduce((t, s) => t + (s.values[i] || 0), 0));
  const max = Math.max(...totals, 1);
  const bw = iw / n;
  const colors = { Critical: 'var(--rose)', High: '#C4577A', Medium: 'var(--amber)', Low: 'var(--ink3)' };

  let bars = '';
  for (let i = 0; i < n; i++) {
    let y = pad.t + ih;
    for (const s of series) {
      const v = s.values[i] || 0;
      if (!v) continue;
      const bh = (v / max) * ih;
      y -= bh;
      bars += `<rect x="${pad.l + i * bw + bw * 0.16}" y="${y}" width="${bw * 0.68}" height="${bh}" fill="${colors[s.name] || 'var(--pine)'}"/>`;
    }
  }
  const xlab = labels.map((l, i) => `<text x="${pad.l + i * bw + bw / 2}" y="${h - 5}" text-anchor="middle" class="ct">${esc(l)}</text>`).join('');
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img">
    <text x="${pad.l - 6}" y="${pad.t + 8}" text-anchor="end" class="ct">${max}</text>
    <text x="${pad.l - 6}" y="${pad.t + ih}" text-anchor="end" class="ct">0</text>
    ${bars}${xlab}
    <line x1="${pad.l}" y1="${pad.t + ih}" x2="${w - pad.r}" y2="${pad.t + ih}" stroke="var(--rail)"/>
  </svg>`;
}

/* ══════════════════════════ crawl dashboard ══════════════════════════ */

/** These charts come from the crawl, so unlike the field-data ones they are
    never empty. Each carries the sentence you would say looking at it. */
async function renderInsights() {
  const host = document.createElement('div');
  host.id = 'insightBlock';
  const ov = $('#overviewOut');
  if (!ov || !state.pages.length) return;
  $('#insightBlock')?.remove();
  host.innerHTML = '<h3 class="sub">Dashboard</h3><div class="progress">Computing…</div>';
  ov.appendChild(host);

  try {
    const d = await api('/api/insights');
    host.innerHTML = `<h3 class="sub">Dashboard</h3>
      <p class="note">Computed from the ${num(d.analysed)} crawled pages that returned 200 — no API, no quota, always populated.${
        d.truncated ? ` The crawl was capped with ${num(d.remainingQueue)} URLs still queued, so read every count as a floor, not a total.` : ''}</p>
      <div class="chartgrid">
        ${d.charts.map((c) => `
          <div class="chartcell${c.kind === 'stack' || c.labels.length > 7 ? ' wide' : ''}">
            <div class="chartcap"><b>${esc(c.title)}</b>${c.axis ? `<span class="src">${esc(c.axis)}</span>` : ''}</div>
            ${c.kind === 'stack'
              ? stackChart(c.series, { labels: c.labels, h: 150 })
              : barChart(c.series[0].values, { labels: c.labels, h: 140 })}
            ${c.kind === 'stack' ? `<p class="chartkey">${c.series.map((s) => `<i style="background:${{ Critical: 'var(--rose)', High: '#C4577A', Medium: 'var(--amber)', Low: 'var(--ink3)' }[s.name] || 'var(--pine)'}"></i> ${esc(s.name)}`).join(' &nbsp; ')}</p>` : ''}
            <p class="chartread">${esc(c.read)}</p>
          </div>`).join('')}
      </div>`;
  } catch (e) {
    host.innerHTML = `<h3 class="sub">Dashboard</h3><div class="msg">${esc(e.message)}</div>`;
  }
}

/* ══════════════════════════ dashboard trends ══════════════════════════ */

const suite = { crux: null, gscSeries: null, program: null, campaigns: [], brand: null, social: null };

/** Appended to the overview rather than replacing it: the verdict stays the
    lead, and the charts explain the trajectory underneath it. */
async function renderTrendBlock() {
  const host = document.createElement('div');
  host.id = 'trendBlock';
  host.innerHTML = '<h3 class="sub">Trends</h3><div class="progress">Loading field data…</div>';
  const ov = $('#overviewOut');
  if (!ov || !state.pages.length) return;
  $('#trendBlock')?.remove();
  ov.appendChild(host);

  const parts = [];

  try {
    const d = await api('/api/trends/crux', { body: { target: state.origin, formFactor: 'PHONE' } });
    suite.crux = d;
    const wk = d.periods.map((p) => p.slice(5).replace('-', '/'));
    parts.push(`
      <div class="cardhd"><h4>Core Web Vitals, real users</h4>
        <span class="src">${esc(d.source)}</span></div>
      <div class="chartgrid">
        ${d.series.map((s) => `
          <div class="chartcell">
            <div class="chartcap">
              <b>${s.label}</b>
              <span class="pill ${s.rating === 'GOOD' ? 'ok' : s.rating === 'POOR' ? 'bad' : 'mid'}">${s.latest != null ? (s.unit === 'ms' ? `${Math.round(s.latest)}ms` : s.latest.toFixed(3)) : '—'}</span>
              ${s.change != null ? `<span class="chg ${s.change < 0 ? 'good' : s.change > 0 ? 'bad' : ''}">${s.change > 0 ? '+' : ''}${s.change}% over 6mo</span>` : ''}
            </div>
            ${lineChart([{ values: s.p75s, color: 'var(--ink)' }], { labels: wk, bands: s.thresholds, unit: s.unit, h: 132 })}
          </div>`).join('')}
      </div>
      <p class="note">Each point is the 75th percentile across a 28-day rolling window, so consecutive points overlap heavily. A fix takes two to three weeks to show up here — don't read week-to-week wobble as a regression.</p>`);
  } catch (e) {
    parts.push(`<div class="cardhd"><h4>Core Web Vitals, real users</h4></div>
      <div class="msg">${esc(e.message)}</div>`);
  }
  if (suite.crux?.snapshot) parts.push(`<p class="note">${esc(suite.crux.note)}</p>`);

  if (state.gscSite) {
    try {
      const g = await api('/api/trends/gsc', { body: { siteUrl: state.gscSite, days: 90 } });
      suite.gscSeries = g;
      const lab = g.points.map((p) => p.date.slice(5).replace('-', '/'));
      parts.push(`
        <div class="cardhd"><h4>Search performance</h4><span class="src">Search Console, last 90 days</span></div>
        <div class="statrow">
          ${[['Clicks', num(g.totals.clicks), g.delta.clicks, false],
             ['Impressions', num(g.totals.impressions), g.delta.impressions, false],
             ['Avg position', g.totals.position, g.delta.position, true]].map(([l, v, d, inv]) =>
            `<div class="statcell"><span>${l}</span><b>${v}</b>
              <em class="chg ${(inv ? -d : d) > 0 ? 'good' : (inv ? -d : d) < 0 ? 'bad' : ''}">${d > 0 ? '+' : ''}${d}${inv ? '' : '%'}</em></div>`).join('')}
        </div>
        ${lineChart([
          { values: g.points.map((p) => p.clicks), color: 'var(--pine)' },
          { values: g.points.map((p) => p.impressions / 10), color: 'var(--rail)' },
        ], { labels: lab, h: 150 })}
        <p class="chartkey"><i style="background:var(--pine)"></i> clicks &nbsp; <i style="background:var(--rail)"></i> impressions ÷ 10</p>
        ${lineChart([{ values: g.points.map((p) => p.position), color: 'var(--rose)' }], { labels: lab, h: 120, invert: true })}
        <p class="chartkey"><i style="background:var(--rose)"></i> average position — lower is better</p>
        ${g.read ? `<div class="readout ${g.read.kind}"><b>What this shape means.</b> ${esc(g.read.text)}</div>` : ''}`);
    } catch (e) {
      parts.push(`<div class="msg">${esc(e.message)}</div>`);
    }
  } else {
    parts.push(`<div class="cardhd"><h4>Search performance</h4></div>
      <div class="msg">Connect Search Console to chart clicks, impressions and position. Until then, ranking data here would be guesswork — there is no free source for positions you don't already own.</div>`);
  }

  try {
    const { series } = await api('/api/trends/psi');
    if (series.length) {
      const top = series.slice(0, 4);
      parts.push(`
        <div class="cardhd"><h4>Your Lighthouse runs</h4><span class="src">Lab data — a debugging trail, not a ranking signal</span></div>
        ${top.map((s) => `<div class="chartcell">
          <div class="chartcap"><b>${esc(short(s.url, 46))}</b><span class="pill">${s.runs} run${s.runs > 1 ? 's' : ''}</span></div>
          ${lineChart([{ values: s.points.map((p) => p.performance), color: 'var(--amber)' }],
            { labels: s.points.map((p) => p.at.slice(5, 10)), h: 110 })}
        </div>`).join('')}`);
    }
  } catch { /* no log yet */ }

  host.innerHTML = `<h3 class="sub">Trends</h3>${parts.join('')}`;
}

/* ══════════════════════════ brand context ══════════════════════════ */

const BRAND_FIELDS = [
  ['name', 'Business name', 'text'],
  ['oneLiner', 'What it does, in one line', 'text'],
  ['services', 'Services — one per line', 'list'],
  ['locations', 'Places it serves — one per line', 'list'],
  ['audience', 'Who the customer is, and what state they are in when they search', 'area'],
  ['voice', 'Voice — how it should sound, and to whom', 'area'],
  ['differentiators', 'True differentiators. Only what you can support', 'area'],
  ['avoid', 'Words and claims to never use', 'area'],
  ['cta', 'Preferred call to action', 'text'],
  ['phone', 'Phone', 'text'],
  ['bookingUrl', 'Booking or contact URL', 'text'],
  ['competitors', 'Competitors — one per line', 'list'],
  ['compliance', 'Compliance constraints. Regulated sectors, put the rules here', 'area'],
  ['notes', 'Anything else the writing should know', 'area'],
];

async function renderBrand() {
  const out = $('#brandOut');
  out.innerHTML = '<div class="progress">Loading…</div>';
  const d = await api('/api/brand');
  suite.brand = d.brand;
  const b = d.brand;
  $('#nBrand').textContent = `${d.completeness.pct}%`;

  out.innerHTML = `
    <div class="meter">
      <div class="meterbar"><i style="width:${d.completeness.pct}%"></i></div>
      <p class="note" style="margin-top:8px">Context is <b>${d.completeness.pct}%</b> complete.
      ${d.completeness.missing.length ? `Still empty: ${d.completeness.missing.join(', ')}. Thin context is the main reason AI copy comes back bland.` : 'Enough to write from.'}
</p>
    </div>

    <div class="copybar">
      <button class="go ghost" id="brandInfer"${state.pages.length ? '' : ' disabled'}>Read it from the site</button>
      <button class="go" id="brandSave">Save context</button>
    </div>
    ${!state.pages.length ? '<p class="note">Crawl the site first and this can propose most of the fields for you.</p>' : ''}
    <div id="inferOut"></div>

    <div class="fieldgrid">
      ${BRAND_FIELDS.map(([k, label, type]) => `
        <div class="field ${type === 'area' || type === 'list' ? 'wide' : ''}">
          <label for="b_${k}">${esc(label)}</label>
          ${type === 'text'
            ? `<input id="b_${k}" value="${esc(b[k] || '')}">`
            : `<textarea id="b_${k}" rows="${type === 'list' ? 3 : 3}">${esc(Array.isArray(b[k]) ? b[k].join('\n') : b[k] || '')}</textarea>`}
        </div>`).join('')}
      <div class="field"><label for="b_primaryColor">Brand colour</label>
        <input id="b_primaryColor" type="color" value="${esc(b.primaryColor || '#17564A')}" style="height:38px;padding:3px"></div>
    </div>`;

  $('#brandSave').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    busy(btn, true, 'Saving…');
    const patch = {};
    for (const [k, , type] of BRAND_FIELDS) {
      const v = $(`#b_${k}`).value;
      patch[k] = type === 'list' ? v.split('\n').map((x) => x.trim()).filter(Boolean) : v.trim();
    }
    patch.primaryColor = $('#b_primaryColor').value;
    try {
      const r = await api('/api/brand', { body: { brand: patch } });
      suite.brand = r.brand;
      $('#nBrand').textContent = `${r.completeness.pct}%`;
      msg('#inferOut', 'Context saved. Everything the AI writes from now on uses it.', 'ok');
    } catch (err) { msg('#inferOut', err.message, 'err'); }
    finally { busy(btn, false); }
  });

  $('#brandInfer').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    busy(btn, true, 'Reading the site…');
    try {
      const { draft, note } = await api('/api/brand/infer', { body: {} });
      for (const [k, , type] of BRAND_FIELDS) {
        if (draft[k] == null || $(`#b_${k}`).value.trim()) continue;
        $(`#b_${k}`).value = type === 'list' ? (draft[k] || []).join('\n') : draft[k];
      }
      $('#inferOut').innerHTML = `<div class="msg ok">${esc(note)}${draft.uncertain?.length
        ? ` Check these especially: <b>${esc(draft.uncertain.join(', '))}</b>.` : ''}</div>`;
    } catch (err) { msg('#inferOut', err.message, 'err'); }
    finally { busy(btn, false); }
  });
}

/* ══════════════════════════ the plan ══════════════════════════ */

async function renderProgram() {
  const out = $('#programOut');
  out.innerHTML = '<div class="progress">Building the plan…</div>';
  try {
    const cap = suite.capacity || 10;
    const d = await api(`/api/program?capacity=${cap}`);
    suite.program = d;
    $('#nWeeks').textContent = `${d.horizonWeeks}w`;
    const done = new Set(d.progress.done);

    out.innerHTML = `
      <div class="statrow">
        <div class="statcell"><span>Items</span><b>${d.totalItems}</b></div>
        <div class="statcell"><span>Effort points</span><b>${d.totalPoints}</b></div>
        <div class="statcell"><span>Weeks at ${cap}/wk</span><b>${d.horizonWeeks}</b></div>
        <div class="statcell"><span>Done</span><b class="good">${done.size}</b></div>
      </div>

      <div class="form">
        <div class="field"><label for="capIn">Effort points a week</label>
          <input id="capIn" type="number" min="2" max="40" value="${cap}" style="width:90px"></div>
        <div class="field"><label>&nbsp;</label><button class="go ghost" id="capGo">Re-plan</button></div>
      </div>

      <h3 class="sub">Stage by stage</h3>
      <div class="tbl-wrap"><table><thead><tr><th>Stage</th><th>Goal — you are done when</th><th class="num">Items</th><th class="num">Weeks</th></tr></thead><tbody>
        ${d.stages.map((s, i) => `<tr class="${s.blocking ? 'blocking' : ''}">
          <td class="u"><b>${i + 1}. ${esc(s.phase)}</b></td>
          <td>${esc(s.goal)}</td>
          <td class="num">${s.count || '—'}</td>
          <td class="num">${s.firstWeek ? (s.firstWeek === s.lastWeek ? s.firstWeek : `${s.firstWeek}–${s.lastWeek}`) : '—'}</td>
        </tr>`).join('')}
      </tbody></table></div>

      <h3 class="sub">Week by week</h3>
      ${d.weeks.map((wk) => `
        <div class="week">
          <div class="weekhd">
            <b>Week ${wk.n}</b>
            <span class="wkdate">from ${wk.startDate}</span>
            <span class="pill">${wk.points} pts</span>
            ${wk.owners.length ? `<span class="src">${esc(wk.owners.join(', '))}</span>` : ''}
          </div>
          ${wk.focus ? `<p class="weekfocus">${esc(wk.focus)}</p>` : ''}
          ${wk.items.map((it) => `
            <label class="task ${done.has(it.id) ? 'done' : ''}">
              <input type="checkbox" data-task="${esc(it.id)}"${done.has(it.id) ? ' checked' : ''}>
              <span class="sev ${it.severity}">${it.severity}</span>
              <span class="tt">${esc(it.title)}</span>
              <span class="src">${esc(it.phase)} · ${it.effort} · ${esc(it.owner || '')}</span>
            </label>`).join('')}
        </div>`).join('')}
      <p class="note">${esc(d.note)}</p>`;

    $('#capGo').addEventListener('click', () => {
      suite.capacity = Number($('#capIn').value) || 10;
      renderProgram();
    });
    $$('[data-task]').forEach((cb) => cb.addEventListener('change', async () => {
      cb.closest('.task').classList.toggle('done', cb.checked);
      try { await api('/api/program/toggle', { body: { findingId: cb.dataset.task } }); } catch {}
    }));
  } catch (e) {
    out.innerHTML = `<div class="msg">${esc(e.message)}</div>`;
  }
}

/* ══════════════════════════ social posts ══════════════════════════ */

async function renderSocial() {
  const out = $('#socialOut');
  out.innerHTML = '<div class="progress">Loading…</div>';
  const meta = await api('/api/social/meta');
  suite.meta = meta;

  out.innerHTML = `
    <p class="note">Artwork is generated on your machine by default — instant, offline, and repeatable. "Vary" reshuffles it. AI photography is there if you want it, and falls back to local artwork when the free providers are busy.</p>
    <div class="form">
      <div class="field grow"><label for="soTopic">What is the post about?</label>
        <input id="soTopic" placeholder="how to pick running shoes for flat feet"></div>
      <div class="field"><label for="soProvider">Artwork</label>
        <select id="soProvider">
          <option value="local">Generated locally — instant, always works</option>
          <option value="ai">AI photo — needs a reachable provider</option>
          <option value="none">Flat brand colour</option>
        </select></div>
    </div>
    <div class="form" style="margin-top:-8px">
      <div class="field grow"><label>Platforms</label>
        <div class="chipset" id="soPlatforms">${meta.platforms.map((p) =>
          `<button class="chip" data-pf="${p.key}" aria-pressed="${p.key === 'instagram_post'}">${esc(p.label)} <span class="dim">${p.w}×${p.h}</span></button>`).join('')}</div></div>
    </div>
    <div class="form" style="margin-top:-8px">
      <div class="field grow"><label for="soNotes">Anything specific to include</label>
        <input id="soNotes" placeholder="mention the free returns policy"></div>
      <div class="field"><label>&nbsp;</label><button class="go" id="soGo">Write the posts</button></div>
    </div>

    <div id="soOut"></div>`;

  $$('#soPlatforms .chip').forEach((b) => b.addEventListener('click', () =>
    b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true'))));

  $('#soGo').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const topic = $('#soTopic').value.trim();
    if (!topic) return msg('#soOut', 'Say what the post is about first.', 'err');
    const platforms = $$('#soPlatforms .chip[aria-pressed=true]').map((b) => b.dataset.pf);
    if (!platforms.length) return msg('#soOut', 'Pick at least one platform.', 'err');
    busy(btn, true, 'Writing…');
    $('#soOut').innerHTML = '<div class="progress">Drafting copy for each platform…</div>';
    try {
      const d = await api('/api/social/draft', { body: { topic, platforms, notes: $('#soNotes').value.trim() } });
      suite.social = d;
      renderPosts(d);
      if (d.note) $('#soOut').insertAdjacentHTML('afterbegin', `<div class="msg">${esc(d.note)}</div>`);
    } catch (err) { msg('#soOut', err.message, 'err'); }
    finally { busy(btn, false); }
  });
}

function renderPosts(d) {
  const artMode = $('#soProvider').value;
  $('#soOut').innerHTML = d.posts.map((p, i) => {
    const spec = suite.meta.platforms.find((x) => x.key === p.platform) || {};
    return `
    <div class="post" data-i="${i}">
      <div class="cardhd"><h4>${esc(spec.label || p.platform)}</h4><span class="src">${spec.w}×${spec.h}</span></div>
      <div class="postgrid">
        <div class="postart">
          <div class="artframe" id="art${i}" style="aspect-ratio:${spec.w}/${spec.h}">
            <div class="empty">No artwork yet</div>
          </div>
          <div class="copybar">
            <button class="go ghost tiny" data-art="${i}">Make artwork</button>
            <button class="go ghost tiny" data-reroll="${i}" title="Same settings, new random variation">Vary</button>
            <button class="go ghost tiny" data-dl="${i}" disabled>Download PNG</button>
            <select data-layout="${i}" style="width:auto;font-size:11px">
              ${suite.meta.layouts.map((l) => `<option value="${l.key}">${esc(l.label)}</option>`).join('')}
            </select>
            <select data-style="${i}" style="width:auto;font-size:11px">
              ${(suite.styles || []).map((st) => `<option value="${st.key}"${st.key === (p.style || 'mesh') ? ' selected' : ''}>${esc(st.label)}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="postcopy">
          <div class="field"><label>Headline on the image</label><input data-f="headline" value="${esc(p.headline || '')}"></div>
          <div class="field"><label>Subhead</label><input data-f="subhead" value="${esc(p.subhead || '')}"></div>
          <div class="field"><label>Button text</label><input data-f="cta" value="${esc(d.cta || '')}"></div>
          <div class="field"><label>Caption${spec.chars ? ` — ${p.caption?.length || 0} of ${spec.chars} characters` : ''}</label>
            <textarea data-f="caption" rows="5">${esc(p.caption || '')}</textarea></div>
          ${p.hashtags?.length ? `<div class="field"><label>Hashtags</label><input data-f="hashtags" value="${esc(p.hashtags.join(' '))}"></div>` : ''}
          <div class="field"><label>Alt text</label><input data-f="altText" value="${esc(p.altText || '')}"></div>
          <details class="urls"><summary>Image prompt</summary>
            <textarea data-f="imagePrompt" rows="3">${esc(p.imagePrompt || '')}</textarea></details>
          <div class="copybar"><button class="go ghost tiny copy" data-clip="${CLIP.push([p.caption, p.hashtags?.join(' ')].filter(Boolean).join('\n\n')) - 1}">Copy caption</button></div>
        </div>
      </div>
    </div>`;
  }).join('');

  wireCopy();

  $$('[data-art]').forEach((b) => b.addEventListener('click', async () => {
    const i = +b.dataset.art;
    const post = $(`.post[data-i="${i}"]`);
    const get = (f) => post.querySelector(`[data-f="${f}"]`)?.value || '';
    const frame = $(`#art${i}`);
    busy(b, true, 'Generating…');
    frame.innerHTML = '<div class="progress">Generating the background, then setting the type…</div>';
    try {
      let imageSrc = null, bgNote = '';
      if (artMode !== 'none') {
        const bg = await api('/api/social/background', {
          body: {
            prompt: get('imagePrompt'), platform: d.posts[i].platform, mode: artMode,
            style: post.querySelector(`[data-style="${i}"]`)?.value || 'mesh',
            seed: suite[`seed${i}`] ?? (suite[`seed${i}`] = Math.floor(Math.random() * 9999)),
          },
        });
        imageSrc = bg.src;
        bgNote = bg.note || '';
      }
      const { svg } = await api('/api/social/compose', {
        body: {
          platform: d.posts[i].platform, layout: post.querySelector(`[data-layout="${i}"]`).value,
          headline: get('headline'), subhead: get('subhead'), cta: get('cta'), imageSrc,
        },
      });
      frame.innerHTML = svg;
      suite[`svg${i}`] = svg;
      post.querySelector(`[data-dl="${i}"]`).disabled = false;
      if (bgNote) frame.insertAdjacentHTML('afterend', `<div class="msg">${esc(bgNote)}</div>`);
    } catch (err) {
      frame.innerHTML = `<div class="msg err">${esc(err.message)}</div>`;
    } finally { busy(b, false); }
  }));

  /* Rasterise in the browser: the SVG already holds the image, so this needs no
     server-side render pipeline. */
  $$('[data-reroll]').forEach((b) => b.addEventListener('click', () => {
    const i = +b.dataset.reroll;
    suite[`seed${i}`] = Math.floor(Math.random() * 9999);
    $(`[data-art="${i}"]`).click();
  }));

  $$('[data-dl]').forEach((b) => b.addEventListener('click', () => {
    const i = +b.dataset.dl;
    const svg = suite[`svg${i}`];
    if (!svg) return;
    const spec = suite.meta.platforms.find((x) => x.key === d.posts[i].platform);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const cv = document.createElement('canvas');
      cv.width = spec.w; cv.height = spec.h;
      cv.getContext('2d').drawImage(img, 0, 0, spec.w, spec.h);
      try {
        const a = document.createElement('a');
        a.href = cv.toDataURL('image/png');
        a.download = `${d.posts[i].platform}-${Date.now()}.png`;
        a.click();
      } catch {
        alert('The browser blocked the export because the generated image came from another origin. Switch the image provider to Cloudflare in .env — it returns image data directly, which exports cleanly.');
      }
    };
    img.onerror = () => alert('Could not rasterise. Right-click the artwork and save the SVG instead.');
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }));
}

/* ══════════════════════════ campaigns ══════════════════════════ */

async function renderCampaigns() {
  const out = $('#campOut');
  out.innerHTML = '<div class="progress">Loading…</div>';
  const { campaigns } = await api('/api/campaigns');
  suite.campaigns = campaigns;
  $('#nCamp').textContent = campaigns.length;

  out.innerHTML = `
    <div class="form">
      <div class="field grow"><label for="cName">Campaign name</label><input id="cName" placeholder="Spring product launch"></div>
      <div class="field grow"><label for="cGoal">Goal, in numbers</label><input id="cGoal" placeholder="30% more organic signups"></div>
      <div class="field"><label for="cChannel">Channel</label>
        <select id="cChannel"><option value="organic">Organic</option><option value="local">Local</option><option value="content">Content</option><option value="social">Social</option><option value="technical">Technical</option></select></div>
      <div class="field"><label>&nbsp;</label><button class="go" id="cAdd">Add</button></div>
    </div>
    ${!campaigns.length ? '<div class="empty">No campaigns yet. A campaign is how you tie a set of changes to a number you care about.</div>' : ''}
    ${campaigns.map((c) => `
      <div class="camp">
        <div class="camphd">
          <b>${esc(c.name)}</b>
          <span class="pill ${c.status === 'running' ? 'ok' : c.status === 'done' ? '' : 'mid'}">${c.status}</span>
          <span class="src">${esc(c.channel)}</span>
          <button class="po-del" data-cdel="${esc(c.id)}" title="Delete">×</button>
        </div>
        ${c.goal ? `<p class="campgoal">${esc(c.goal)}</p>` : ''}
        ${c.baseline ? `
          <div class="statrow sm">
            <div class="statcell"><span>Clicks at start</span><b>${num(c.baseline.clicks)}</b></div>
            <div class="statcell"><span>Impressions</span><b>${num(c.baseline.impressions)}</b></div>
            <div class="statcell"><span>Avg position</span><b>${c.baseline.position ?? '—'}</b></div>
            <div class="statcell"><span>Baselined</span><b>${c.baseline.at.slice(0, 10)}</b></div>
          </div>
          ${suite.gscSeries ? (() => {
            const t = suite.gscSeries.totals;
            const d = (a, b) => (a ? Math.round(((b - a) / a) * 100) : 0);
            return `<div class="statrow sm">
              <div class="statcell"><span>Clicks now</span><b>${num(t.clicks)}</b><em class="chg ${d(c.baseline.clicks, t.clicks) >= 0 ? 'good' : 'bad'}">${d(c.baseline.clicks, t.clicks) > 0 ? '+' : ''}${d(c.baseline.clicks, t.clicks)}%</em></div>
              <div class="statcell"><span>Position now</span><b>${t.position}</b></div>
            </div>`;
          })() : '<p class="note">Connect Search Console to see movement against this baseline.</p>'}`
        : `<div class="copybar"><button class="go ghost tiny" data-cbase="${esc(c.id)}"${state.gscSite ? '' : ' disabled'}>Record the baseline now</button>
             ${state.gscSite ? '' : '<span class="src">Needs Search Console connected</span>'}</div>`}
      </div>`).join('')}`;

  $('#cAdd').addEventListener('click', async () => {
    const name = $('#cName').value.trim();
    if (!name) return;
    await api('/api/campaigns', { body: { campaign: { name, goal: $('#cGoal').value.trim(), channel: $('#cChannel').value } } });
    renderCampaigns();
  });
  $$('[data-cdel]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Delete this campaign?')) return;
    await fetch(`/api/campaigns/${b.dataset.cdel}`, { method: 'DELETE' });
    renderCampaigns();
  }));
  $$('[data-cbase]').forEach((b) => b.addEventListener('click', async () => {
    busy(b, true, 'Recording…');
    try {
      const g = suite.gscSeries || await api('/api/trends/gsc', { body: { siteUrl: state.gscSite, days: 90 } });
      await api(`/api/campaigns/${b.dataset.cbase}/baseline`, { body: { metrics: g.totals } });
      renderCampaigns();
    } catch (e) { alert(e.message); } finally { busy(b, false); }
  }));
}

/* ══════════════════════════ AI fix, per finding ══════════════════════════ */

/** Delegated so it survives every re-render of the findings ledger. */
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-aifix]');
  if (!btn) return;
  const host = btn.closest('.fbody')?.querySelector('.aifixout') || btn.parentElement;
  busy(btn, true, btn.dataset.preferai === '1' ? 'Asking the model…' : 'Building…');
  host.innerHTML = `<div class="progress">${btn.dataset.preferai === '1' ? 'Drafting with AI, falling back to the offline fix if it is unavailable…' : 'Building the correction from your crawl…'}</div>`;
  try {
    const { fix } = await api('/api/ai/fix', { body: { findingId: btn.dataset.aifix, preferAi: btn.dataset.preferai === '1' } });
    host.innerHTML = `
      <div class="aifix">
        <p class="aisum">${esc(fix.summary)}</p>
        ${(fix.changes || []).map((c) => `
          <div class="chg-row">
            <span class="chg-what">${esc(c.what)}</span>
            ${c.from ? `<span class="chg-from">${esc(c.from)}</span>` : ''}
            <span class="chg-to">${esc(c.to)}</span>
          </div>`).join('')}
        ${fix.code ? `<div class="out code">${esc(fix.code)}</div>${copyBar(fix.code, 'Copy code')}` : ''}
        ${fix.acceptance?.length ? `<p class="ailab">Done when</p><ul class="acc">${fix.acceptance.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}
        ${fix.cannotDo ? `<div class="msg">${esc(fix.cannotDo)}</div>` : ''}
        ${fix.note ? `<div class="msg">${esc(fix.note)}</div>` : ''}
        <p class="note">${fix.source === 'ai'
          ? 'Written by a model, so read it before it ships. The finding itself came from the rule set.'
          : 'Built from your crawl data with no guesswork — the values are derived from your own pages. Check anything marked in capitals; those are the parts only you can decide.'}</p>
      </div>`;
    wireCopy();
  } catch (err) {
    host.innerHTML = `<div class="msg err">${esc(err.message)}</div>`;
  } finally { busy(btn, false); }
});

/* ══════════════════════════ hook into the shell ══════════════════════════ */


const _renderOverview = renderOverview;
renderOverview = function () {
  _renderOverview();
  renderInsights().catch(() => {});
  renderTrendBlock().catch(() => {});
};

(async () => {
  await new Promise((r) => setTimeout(r, 400));
  // Keep the schema dropdown honest: ask the server what it can actually build.
  try { const { types } = await api('/api/schema/types'); state.schemaTypes = types; } catch {}
  try { const { styles } = await api('/api/social/styles'); suite.styles = styles; } catch {}
  try {
    const { engines } = await api('/api/serp/engines');
    if ($('#rkEngine')) $('#rkEngine').innerHTML = engines.map((e) => `<option value="${e.key}">${esc(e.label)}</option>`).join('');
  } catch {}
  try { const d = await api('/api/brand'); $('#nBrand').textContent = `${d.completeness.pct}%`; } catch {}
  try { const { campaigns } = await api('/api/campaigns'); $('#nCamp').textContent = campaigns.length; } catch {}
  if (state.pages?.length) { renderInsights().catch(() => {}); renderTrendBlock().catch(() => {}); }
})();

/* ══════════════════════════ system check ══════════════════════════ */


/* ══════════════════════════ visibility ══════════════════════════ */

$('#rkGo')?.addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  const queries = $('#rkQueries').value.split('\n').map((s) => s.trim()).filter(Boolean);
  if (!queries.length) return msg('#rankOut', 'Add at least one query.', 'err');
  const domain = $('#rkDomain').value.trim() || state.origin;
  if (!domain) return msg('#rankOut', 'Add a domain, or crawl a site first.', 'err');
  busy(btn, true, 'Checking…');
  $('#rankOut').innerHTML = `<div class="progress">Checking ${queries.length} quer${queries.length > 1 ? 'ies' : 'y'}, paced to stay polite…</div>`;
  try {
    const d = await api('/api/position/batch', { body: { queries: queries.slice(0, 12), domain, engine: $('#rkEngine').value || 'duckduckgo' } });
    const found = d.results.filter((r) => r.position);
    $('#rankOut').innerHTML = `
      <div class="statrow">
        <div class="statcell"><span>Queries checked</span><b>${d.results.length}</b></div>
        <div class="statcell"><span>Found in top 30</span><b class="${found.length ? 'good' : 'bad'}">${found.length}</b></div>
        <div class="statcell"><span>Best position</span><b>${found.length ? Math.min(...found.map((r) => r.position)) : '—'}</b></div>
        <div class="statcell"><span>Engine</span><b style="font-size:1rem">${esc(d.engine)}</b></div>
      </div>
      <div class="tbl-wrap"><table><thead><tr><th>Query</th><th class="num">Position</th><th>URL that ranks</th></tr></thead><tbody>
        ${d.results.map((r) => `<tr>
          <td>${esc(r.query)}</td>
          <td class="num">${r.error ? '<span class="pill mid">failed</span>' : r.position ? `<span class="pill ${r.position <= 10 ? 'ok' : 'mid'}">${r.position}</span>` : '<span class="pill bad">not in top 30</span>'}</td>
          <td class="u">${esc(r.error || (r.url ? short(r.url, 54) : '—'))}</td>
        </tr>`).join('')}
      </tbody></table></div>
      <p class="note">${esc(d.caveat)}</p>
      ${d.results.some((r) => r.top?.length) ? `<h3 class="sub">Who else is there</h3>
        ${d.results.filter((r) => r.top?.length).map((r) => `
          <details class="urls"><summary>${esc(r.query)}</summary>
            <ol style="font-family:var(--mono);font-size:11px;line-height:1.9;padding-left:22px">
              ${r.top.map((t) => `<li>${esc(short(t.url, 62))}</li>`).join('')}
            </ol></details>`).join('')}` : ''}`;
  } catch (err) { msg('#rankOut', err.message, 'err'); }
  finally { busy(btn, false); }
});


/* ══════════════════════════ security headers ══════════════════════════ */

async function renderSecurity() {
  const out = $('#securityOut');
  out.innerHTML = '<div class="progress">Grading response headers…</div>';
  try {
    const d = await api('/api/security');
    $('#nSec').textContent = d.grade;
    $('#nSec').className = `ni-n ${'ABC'.includes(d.grade) ? '' : 'hot'}`;

    out.innerHTML = `
      <div class="statrow">
        <div class="statcell"><span>Grade</span><b class="${'AB'.includes(d.grade) ? 'good' : d.grade === 'C' ? '' : 'bad'}" style="font-size:2rem">${d.grade}</b></div>
        <div class="statcell"><span>Score</span><b>${d.score}%</b></div>
        <div class="statcell"><span>Pages checked</span><b>${d.pagesAudited}</b></div>
        <div class="statcell"><span>Config</span><b style="font-size:.95rem">${d.consistent ? 'consistent' : 'varies by page'}</b></div>
      </div>
      <p class="note">${esc(d.representative.seoNote)}</p>

      ${d.issues.length ? `<h3 class="sub">What's missing — heaviest first</h3>
        ${d.issues.map((i) => `
          <div class="finding">
            <div class="fhead">
              <span class="sev ${i.level === 'fail' ? 'High' : 'Medium'}">${i.level === 'fail' ? 'Missing' : 'Weak'}</span>
              <div class="ftitle">${esc(i.label)}<span class="fmeta">${esc(i.header)} · ${i.allPages ? 'every page' : `${i.pages} page${i.pages > 1 ? 's' : ''}`}</span></div>
            </div>
            <div class="fbody" hidden>
              <p><b>What</b> ${esc(i.note)}</p>
              ${i.value ? `<p><b>Currently</b> <code>${esc(i.value)}</code></p>` : ''}
              <p><b>Fix</b></p><div class="out code">${esc(i.fix)}</div>
              ${i.failing.length && !i.allPages ? `<details class="urls"><summary>${i.pages} affected URL${i.pages > 1 ? 's' : ''}</summary><ul>${i.failing.map((u) => `<li>${esc(u)}</li>`).join('')}</ul></details>` : ''}
            </div>
          </div>`).join('')}` : '<div class="msg ok">Every header checked is configured properly.</div>'}

      ${d.config ? `<h3 class="sub">Everything at once</h3>
        <p class="note">${esc(d.config.note)}</p>
        <div class="chipset" id="cfgPick">
          <button class="chip" data-cfg="apache" aria-pressed="true">Apache</button>
          <button class="chip" data-cfg="nginx" aria-pressed="false">nginx</button>
          <button class="chip" data-cfg="raw" aria-pressed="false">Header list</button>
        </div>
        <div id="cfgOut"></div>` : ''}

      ${d.disclosed.length ? `<h3 class="sub">Information disclosure</h3>
        <div class="tbl-wrap"><table><thead><tr><th>Header</th><th>Value</th><th>Risk</th></tr></thead><tbody>
          ${d.disclosed.map((x) => `<tr><td class="u">${esc(x.header)}</td><td><code>${esc(x.value)}</code></td>
            <td>${x.versioned ? 'Exposes an exact version — free reconnaissance for anyone scanning for known CVEs' : 'Names the software, no version'}</td></tr>`).join('')}
        </tbody></table></div>
        <p class="note">Suppress these in your server config. They give an attacker your patch level without them having to probe for it.</p>` : ''}

      ${d.cookies.length ? `<h3 class="sub">Cookie flags</h3>
        ${d.cookies.map((c) => `<div class="msg"><b>${esc(c.name)}</b> — ${esc(c.flags.join('; '))}.</div>`).join('')}` : ''}`;

    $$('#securityOut .fhead').forEach((h) => h.addEventListener('click', () => {
      const b = h.nextElementSibling; b.hidden = !b.hidden;
    }));
    if (d.config) {
      const show = (k) => {
        $('#cfgOut').innerHTML = `<div class="out code">${esc(d.config[k])}</div>` + copyBar(d.config[k]);
        wireCopy();
      };
      show('apache');
      $$('#cfgPick .chip').forEach((c) => c.addEventListener('click', () => {
        $$('#cfgPick .chip').forEach((x) => x.setAttribute('aria-pressed', String(x === c)));
        show(c.dataset.cfg);
      }));
    }
  } catch (e) {
    out.innerHTML = `<div class="msg">${esc(e.message)}</div>`;
  }
}

/* ══════════════════════════ summarizer ══════════════════════════ */

function renderSummarize() {
  $('#buildOut').innerHTML = `
    <h3 class="sub">Summarise text</h3>
    <p class="lede">Extractive: it selects the strongest sentences and leaves them exactly as written. Nothing is rephrased, so nothing can be invented — safe to put in front of a client without fact-checking.</p>
    <div class="form">
      <div class="field grow"><label for="smUrl">Summarise a crawled page</label>
        <select id="smUrl"><option value="">— paste text instead —</option>
          ${(state.pages || []).filter((p) => p.status === 200).map((p) => `<option value="${esc(p.url)}">${esc(short(p.url, 60))}</option>`).join('')}
        </select></div>
      <div class="field"><label for="smN">Sentences</label><input id="smN" type="number" value="3" min="1" max="8" style="width:80px"></div>
      <div class="field"><label>&nbsp;</label><button class="go" id="smGo">Summarise</button></div>
    </div>
    <div class="form" style="margin-top:-8px">
      <div class="field grow"><label for="smText">Or paste text</label><textarea id="smText" rows="6" placeholder="Paste an article, a page, a transcript…"></textarea></div>
    </div>
    <div id="smOut"></div>`;

  $('#smGo').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const url = $('#smUrl').value, text = $('#smText').value.trim();
    if (!url && !text) return msg('#smOut', 'Pick a crawled page or paste some text.', 'err');
    busy(btn, true, 'Summarising…');
    try {
      const d = await api('/api/summarize', { body: { url: url || undefined, text: text || undefined, sentences: Number($('#smN').value) || 3 } });
      $('#smOut').innerHTML = `
        <h3 class="sub">Summary</h3>
        <div class="out">${esc(d.summary)}</div>${copyBar(d.summary)}
        <h3 class="sub">As a meta description</h3>
        <div class="out code">${esc(d.metaDescription)}</div>
        <p class="note">${d.metaDescription.length} characters.</p>${copyBar(d.metaDescription, 'Copy meta')}
        ${d.keywords?.length ? `<h3 class="sub">Most frequent terms</h3>
          <div class="chipset">${d.keywords.map((k) => `<span class="chip" aria-pressed="false" style="cursor:default">${esc(k.term)} <span class="dim">${k.count}</span></span>`).join('')}</div>
          <p class="note">Frequency only — a term appearing often is not evidence the page ranks for it, and keyword density has never been a ranking factor.</p>` : ''}
        <p class="note">${esc(d.note)}</p>`;
      wireCopy();
    } catch (err) { msg('#smOut', err.message, 'err'); }
    finally { busy(btn, false); }
  });
}

const _rb = typeof renderBuild === 'function' ? renderBuild : null;
if (_rb) {
  renderBuild = function (tool) {
    if (tool === 'summarize') {
      $$('#buildTools .chip').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.build === 'summarize')));
      return renderSummarize();
    }
    return _rb(tool);
  };
  $$('#buildTools .chip').forEach((c) => {
    const n = c.cloneNode(true);
    c.replaceWith(n);
    n.addEventListener('click', () => renderBuild(n.dataset.build));
  });
}


/* ══════════════════════════ rendering capability ══════════════════════════ */

(async () => {
  const note = $('#renderNote'), box = $('#renderJs');
  if (!note) return;
  try {
    const p = await api('/api/render/probe');
    if (p.available) {
      note.textContent = `— using ${p.channel} ${String(p.version).split('.')[0]}, slower but sees what users see`;
    } else {
      note.textContent = '— unavailable on this machine';
      box.disabled = true;
      box.closest('.check').title = p.reason;
    }
  } catch { note.textContent = ''; }
})();

/* ══════════════════════════ monitoring ══════════════════════════ */

async function renderMonitors() {
  const out = $('#monitorOut');
  out.innerHTML = '<div class="progress">Loading…</div>';
  try {
    const d = await api('/api/monitors');
    $('#nMon').textContent = d.monitors.length;

    out.innerHTML = `
      ${d.scheduling
        ? `<div class="msg ok">Scheduling is active — ${d.active} monitor${d.active === 1 ? '' : 's'} armed. Schedules only fire while this server is running, so leave it up or run it as a service.</div>`
        : `<div class="msg">${esc(d.reason)}</div>`}

      <div class="form">
        <div class="field grow"><label for="moUrl">Site to watch</label><input id="moUrl" type="url" placeholder="https://example.com/"></div>
        <div class="field"><label for="moCron">How often</label>
          <select id="moCron">${d.presets.map((p) => `<option value="${esc(p.expr)}">${esc(p.label)}</option>`).join('')}</select></div>
        <div class="field"><label for="moMax">Max pages</label><input id="moMax" type="number" value="500" min="1" max="25000" style="width:100px"></div>
        <div class="field"><label>&nbsp;</label><button class="go" id="moAdd">Add monitor</button></div>
      </div>
      <p class="note">Alerts on Critical and High only. Everything else accumulates in the log without interrupting you.</p>

      ${!d.monitors.length ? '<div class="empty">No monitors yet.</div>' : d.monitors.map((m) => `
        <div class="camp">
          <div class="camphd">
            <b>${esc(m.label)}</b>
            <span class="pill ${m.lastStatus === 'changed' ? 'bad' : m.lastStatus === 'quiet' ? 'ok' : 'mid'}">${esc(m.lastStatus || 'never run')}</span>
            <span class="src">${esc(m.cron)} · ${m.maxPages} pages</span>
            <button class="po-del" data-mdel="${esc(m.id)}" title="Remove">×</button>
          </div>
          <p class="campgoal">${esc(m.url)}${m.lastRunAt ? ` — last run ${ago(m.lastRunAt)}` : ''}</p>
          <div class="copybar">
            <button class="go ghost tiny" data-mrun="${esc(m.id)}">Run now</button>
            <button class="go ghost tiny" data-mlog="${esc(m.id)}">History</button>
          </div>
          <div class="mout" id="mout-${esc(m.id)}"></div>
        </div>`).join('')}`;

    $('#moAdd').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const url = $('#moUrl').value.trim();
      if (!url) return;
      busy(btn, true, 'Adding…');
      try {
        await api('/api/monitors', { body: { monitor: { url, cron: $('#moCron').value, maxPages: Number($('#moMax').value) || 500 } } });
        renderMonitors();   // replaces btn, so nothing to restore afterwards
      } catch (err) {
        busy(btn, false);
        msg('#monitorOut', err.message, 'err');
      }
    });

    $$('[data-mdel]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Remove this monitor and its history?')) return;
      await fetch(`/api/monitors/${b.dataset.mdel}`, { method: 'DELETE' });
      renderMonitors();
    }));

    $$('[data-mrun]').forEach((b) => b.addEventListener('click', async () => {
      const host = $(`#mout-${b.dataset.mrun}`);
      busy(b, true, 'Crawling…');
      host.innerHTML = '<div class="progress">Re-crawling and comparing against the last run…</div>';
      try {
        const r = await api(`/api/monitors/${b.dataset.mrun}/run`, { body: {} });
        host.innerHTML = r.baseline
          ? `<div class="msg ok">Baseline recorded — ${num(r.stats.crawled)} pages. The next run compares against this one.</div>`
          : renderDiff(r.diff);
      } catch (err) { host.innerHTML = `<div class="msg err">${esc(err.message)}</div>`; }
      finally { busy(b, false); }
    }));

    $$('[data-mlog]').forEach((b) => b.addEventListener('click', async () => {
      const host = $(`#mout-${b.dataset.mlog}`);
      try {
        const r = await api(`/api/monitors/${b.dataset.mlog}/log`);
        if (!r.runs.length) return void (host.innerHTML = '<div class="empty">No runs yet.</div>');
        host.innerHTML = `
          ${lineChart([
            { values: r.runs.map((x) => x.counts?.Critical || 0), color: 'var(--rose)' },
            { values: r.runs.map((x) => x.counts?.High || 0), color: 'var(--amber)' },
          ], { labels: r.runs.map((x) => x.at.slice(5, 10)), h: 120 })}
          <p class="chartkey"><i style="background:var(--rose)"></i> Critical &nbsp; <i style="background:var(--amber)"></i> High</p>
          <div class="tbl-wrap"><table><thead><tr><th>Run</th><th class="num">Pages</th><th>Outcome</th></tr></thead><tbody>
            ${[...r.runs].reverse().map((x) => `<tr>
              <td class="u">${x.at.slice(0, 16).replace('T', ' ')}</td>
              <td class="num">${num(x.pages)}</td>
              <td>${x.summary ? esc(x.summary) : 'baseline'}</td></tr>`).join('')}
          </tbody></table></div>`;
      } catch (err) { host.innerHTML = `<div class="msg err">${esc(err.message)}</div>`; }
    }));
  } catch (e) {
    out.innerHTML = `<div class="msg">${esc(e.message)}</div>`;
  }
}

function renderDiff(d) {
  if (!d) return '<div class="msg">No comparison available.</div>';
  const list = (title, items, cls) => (items.length ? `
    <p class="ailab">${title}</p>
    ${items.slice(0, 10).map((f) => `<div class="chg-row"><span class="chg-what">${esc(f.severity)}${f.from ? ` (was ${esc(f.from)})` : ''}</span><span class="chg-to">${esc(f.title)}</span></div>`).join('')}` : '');
  return `
    <div class="${d.quiet ? 'msg ok' : 'aifix'}">
      <p class="aisum">${esc(d.summary)}</p>
      ${d.structural.map((x) => `<div class="msg err">${esc(x)}</div>`).join('')}
      ${list('New', d.appeared.filter((f) => ['Critical', 'High'].includes(f.severity)), 'bad')}
      ${list('Got worse', d.worsened, 'bad')}
      ${list('Affecting more pages now', d.grew, '')}
      ${list('Resolved', d.resolved, 'good')}
    </div>`;
}

(async () => {
  try { const d = await api('/api/monitors'); $('#nMon').textContent = d.monitors.length; } catch {}
})();

/* ══════════════════════════ intent match ══════════════════════════ */

function fillIntentPages() {
  const sel = $('#inPage');
  if (!sel) return;
  const pages = (state.pages || []).filter((p) => p.status === 200);
  sel.innerHTML = pages.length
    ? pages.map((p) => `<option value="${esc(p.url)}">${esc(short(p.url, 58))}</option>`).join('')
    : '<option value="">Crawl a site first</option>';
}

$('#inGo')?.addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  const query = $('#inQuery').value.trim();
  const url = $('#inPage').value;
  if (!query) return msg('#intentOut', 'Give it the query this page targets — that is the one input the tool cannot guess.', 'err');
  if (!url) return msg('#intentOut', 'Crawl a site first, then pick a page.', 'err');
  busy(btn, true, 'Reading Google…');
  $('#intentOut').innerHTML = '<div class="progress">Opening the SERP in your Chrome and classifying the top ten results…</div>';
  try {
    const d = await api('/api/intent', { body: { query, url, gl: $('#inGl').value } });
    $('#intentOut').innerHTML = `
      <div class="${d.severity ? 'aifix' : 'msg ok'}" style="${d.severity ? 'border-left-color:var(--rose);background:var(--rose-wash)' : ''}">
        <p class="aisum"><b>${d.severity ? `${d.severity} — format mismatch` : d.mixed ? 'Mixed SERP' : 'Format matches'}</b></p>
        <p>${esc(d.what)}</p>
        <p><b>What to do.</b> ${esc(d.fix)}</p>
        <p class="note">${esc(d.featureNote)}</p>
        ${d.yourPosition ? `<p class="note">Your domain appears at position ${d.yourPosition}.</p>` : ''}
      </div>
      <div class="statrow">
        ${d.distribution.map((x) => `<div class="statcell"><span>${esc(x.kind)}</span><b>${x.count}</b></div>`).join('')}
      </div>
      <h3 class="sub">What is ranking</h3>
      <div class="tbl-wrap"><table><thead><tr><th class="num">#</th><th>Type</th><th>Result</th></tr></thead><tbody>
        ${d.competitors.map((c) => `<tr><td class="num">${c.position}</td>
          <td><span class="pill ${c.kind === d.pageKind ? 'ok' : 'mid'}">${esc(c.kind)}</span></td>
          <td class="u">${esc(c.title || short(c.url, 60))}<br><span class="src">${esc(short(c.url, 70))}</span></td></tr>`).join('')}
      </tbody></table></div>
      <p class="note">${esc(d.caveat)}</p>`;
  } catch (err) {
    $('#intentOut').innerHTML = `<div class="msg err">${esc(err.message)}</div>`;
  } finally { busy(btn, false); }
});

/* ══════════════════════════ GSC CSV import ══════════════════════════ */

$('#gscImport')?.addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  const input = $('#gscFiles');
  if (!input.files?.length) return msg('#gscCsvOut', 'Pick the CSV files from your Search Console export first.', 'err');
  busy(btn, true, 'Importing…');
  try {
    const files = await Promise.all([...input.files].map(async (f) => ({ name: f.name, text: await f.text() })));
    const d = await api('/api/gsc/import', { body: { files } });
    const dims = Object.entries(d.dimensions);
    $('#gscCsvOut').innerHTML = `
      <div class="msg ok">${esc(d.note)}</div>
      ${d.errors?.length ? d.errors.map((x) => `<div class="msg">${esc(x.file)}: ${esc(x.error)}</div>`).join('') : ''}
      <div class="statrow">
        ${dims.map(([k, v]) => `<div class="statcell"><span>${esc(k)}</span><b>${num(v.rows)}</b></div>`).join('')}
        ${dims[0] ? `<div class="statcell"><span>Clicks</span><b>${num(dims[0][1].totals.clicks)}</b></div>
        <div class="statcell"><span>Impressions</span><b>${num(dims[0][1].totals.impressions)}</b></div>` : ''}
      </div>
      ${d.striking?.length ? `<h3 class="sub">Striking distance — ${d.striking.length}</h3>
        <p class="note">Ranking 4–20 with real impressions. The cheapest wins on your list.</p>
        <div class="tbl-wrap"><table><thead><tr><th>Query</th><th class="num">Pos</th><th class="num">Impr.</th><th class="num">Clicks</th><th>Read</th></tr></thead><tbody>
          ${d.striking.slice(0, 20).map((r) => `<tr><td>${esc(r.query)}</td><td class="num">${r.position.toFixed(1)}</td>
            <td class="num">${num(r.impressions)}</td><td class="num">${num(r.clicks)}</td><td>${esc(r.note)}</td></tr>`).join('')}
        </tbody></table></div>` : ''}
      ${d.ctrGaps?.length ? `<h3 class="sub">Shown but not chosen — ${d.ctrGaps.length}</h3>
        <div class="tbl-wrap"><table><thead><tr><th>Query</th><th class="num">Pos</th><th class="num">CTR</th><th class="num">Gap</th></tr></thead><tbody>
          ${d.ctrGaps.slice(0, 15).map((r) => `<tr><td>${esc(r.query)}</td><td class="num">${r.position.toFixed(1)}</td>
            <td class="num">${(r.ctr * 100).toFixed(1)}%</td><td class="num"><span class="pill bad">${r.gap}%</span></td></tr>`).join('')}
        </tbody></table></div>
        <p class="note">These rank well and get skipped. Titles, meta descriptions and SERP features are the levers, not content.</p>` : ''}
      ${d.dates?.length ? `<h3 class="sub">Clicks over time</h3>
        ${lineChart([{ values: d.dates.map((x) => x.clicks), color: 'var(--pine)' }], { labels: d.dates.map((x) => String(x.date).slice(5)), h: 140 })}` : ''}`;
  } catch (err) { msg('#gscCsvOut', err.message, 'err'); }
  finally { busy(btn, false); }
});


/* ══════════════════════════ setup & keys ══════════════════════════ */

async function renderSetup() {
  const out = $('#setupOut');
  out.innerHTML = '<div class="progress">Loading…</div>';
  try {
    renderModels();
    renderAuthSettings();
    const d = await api('/api/settings');
    const entries = Object.entries(d.fields);
    $('#nKeys').textContent = entries.filter(([, f]) => f.set).length;

    out.innerHTML = `
      <div id="authBlock"></div>
      <div id="modelsBlock"></div>
      <h3 class="sub">Keys</h3>
      <div class="fieldgrid">
        ${entries.map(([k, f]) => `
          <div class="field wide">
            <label for="set_${k}">${esc(f.label)}${f.set ? ` — in use, ending ${esc(f.hint)}` : ''}</label>
            <input id="set_${k}" type="${f.secret ? 'password' : 'text'}" autocomplete="off" spellcheck="false"
              placeholder="${f.set ? 'leave blank to keep, or paste a new one' : 'not set'}">
            ${f.warning ? `<div class="msg err" style="margin:7px 0 0">${esc(f.warning)}</div>` : ''}
            <p class="note" style="margin:6px 0 0"><b>Adds:</b> ${esc(f.unlocks)}<br><b>Where:</b> ${esc(f.how)}</p>
            ${f.set ? `<div class="copybar" style="margin:7px 0 0"><button class="go ghost tiny" data-verify="${k}">Test the key in use</button></div>` : ''}
            <div id="res_${k}"></div>
          </div>`).join('')}
      </div>
      <div class="copybar">
        <button class="go" id="setSave">Check and save</button>
        <span class="src">Validated against each API before saving. Applied immediately — no restart.</span>
      </div>
      <p class="note">Written to <code>${esc(d.envPath)}</code> with owner-only permissions. Values are never sent back to this page — only whether one is set and its last four characters.</p>
      <p class="note">To remove a key, clear its box and save.</p>`;

    /* "Which key is the server actually holding, and does Google accept it" —
       the question .env cannot answer, and the one that resolves a new key
       appearing to have no effect. */
    $$('[data-verify]').forEach((b) => b.addEventListener('click', async () => {
      const k = b.dataset.verify;
      const host = $(`#res_${k}`);
      busy(b, true, 'Asking Google…');
      host.innerHTML = '<div class="progress">Testing the key this server is holding…</div>';
      try {
        const r = await api(`/api/settings/verify/${k}`);
        host.innerHTML = `<div class="msg ${r.ok ? 'ok' : 'err'}">${esc(r.verdict)}</div>`
          + (r.shadowWarning ? `<div class="msg err">${esc(r.shadowWarning)}</div>` : '');
      } catch (e2) { host.innerHTML = `<div class="msg err">${esc(e2.message)}</div>`; }
      finally { busy(b, false); }
    }));

    $('#setSave').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const values = {};
      for (const [k] of entries) {
        const v = $(`#set_${k}`).value;
        if (v.trim()) values[k] = v.trim();
      }
      if (!Object.keys(values).length) return msg('#setupOut', 'Nothing entered.', 'err');
      busy(btn, true, 'Checking with Google…');
      entries.forEach(([k]) => { if (values[k]) $(`#res_${k}`).innerHTML = '<div class="progress">Verifying…</div>'; });
      try {
        const r = await api('/api/settings', { body: { values } });
        for (const [k, res] of Object.entries(r.results)) {
          const host = $(`#res_${k}`);
          if (host) host.innerHTML = `<div class="msg ${res.ok ? 'ok' : 'err'}">${esc(res.detail)}</div>`;
          if (res.ok) $(`#set_${k}`).value = '';
        }
        $('#nKeys').textContent = Object.values(r.status).filter((f) => f.set).length;
        if (r.saved.length) {
          // Re-probe the things a new key unlocks so the UI reflects reality now.
          renderTrendBlock().catch(() => {});
        }
      } catch (err) { msg('#setupOut', err.message, 'err'); }
      finally { busy(btn, false); }
    });
  } catch (e) {
    out.innerHTML = `<div class="msg">${esc(e.message)}</div>`;
  }
}

(async () => {
  try { const d = await api('/api/settings'); $('#nKeys').textContent = Object.values(d.fields).filter((f) => f.set).length; } catch {}
})();

/* ══════════════════════════ command palette ══════════════════════════ */
/* Sixteen destinations is more than anyone scans. Ctrl/Cmd+K to type instead.
   Entries carry the words people actually use, not just the panel names — you
   look for "backlinks" and land on Visibility. */

const CMDK = [
  { panel: 'overview', label: 'Overview', group: 'Diagnose', alt: 'verdict dashboard summary charts' },
  { panel: 'ladder', label: 'All findings', group: 'Diagnose', alt: 'issues problems list ledger' },
  { panel: 'pages', label: 'Pages', group: 'Evidence', alt: 'urls single page review intent match serp' },
  { panel: 'console', label: 'Search Console', group: 'Evidence', alt: 'gsc clicks impressions csv import oauth queries' },
  { panel: 'speed', label: 'Speed', group: 'Evidence', alt: 'core web vitals lcp cls performance pagespeed lighthouse' },
  { panel: 'monitors', label: 'Monitoring', group: 'Evidence', alt: 'schedule alerts regression watch cron' },
  { panel: 'security', label: 'Security headers', group: 'Evidence', alt: 'hsts csp headers grade ssl' },
  { panel: 'demand', label: 'Keywords', group: 'Evidence', alt: 'keyword research volume autocomplete clusters' },
  { panel: 'rank', label: 'Visibility', group: 'Evidence', alt: 'rank position serp backlinks competitors' },
  { panel: 'program', label: 'Plan', group: 'Act', alt: 'roadmap weeks sequence schedule tasks' },
  { panel: 'build', label: 'Build', group: 'Act', alt: 'titles meta schema jsonld redirects robots sitemap brief summarise' },
  { panel: 'social', label: 'Social posts', group: 'Act', alt: 'instagram linkedin captions artwork images' },
  { panel: 'campaigns', label: 'Campaigns', group: 'Act', alt: 'goals baseline tracking' },
  { panel: 'ship', label: 'Ship', group: 'Act', alt: 'export csv azure devops prelaunch snapshot compare' },
  { panel: 'setup', label: 'Setup & keys', group: 'Settings', alt: 'api key google oauth anthropic cloudflare env' },
  { panel: 'health', label: 'System check', group: 'Settings', alt: 'diagnostics status providers reachable' },
  { panel: 'brand', label: 'Brand context', group: 'Settings', alt: 'voice services audience tone compliance' },
  { panel: 'crawl', label: 'Crawl settings', group: 'Settings', alt: 'start url max pages render javascript' },
];

let cmdkSel = 0, cmdkHits = CMDK;

function cmdkRender(q = '') {
  const needle = q.trim().toLowerCase();
  cmdkHits = needle
    ? CMDK.filter((c) => `${c.label} ${c.group} ${c.alt}`.toLowerCase().includes(needle))
    : CMDK;
  cmdkSel = 0;
  const list = $('#cmdkList');
  list.innerHTML = cmdkHits.length
    ? cmdkHits.map((c, i) => `<button class="cmdk-item" data-cmdk="${c.panel}" aria-selected="${i === 0}">
        <span>${esc(c.label)}</span><span class="ci-group">${esc(c.group)}</span></button>`).join('')
    : '<div class="cmdk-empty">Nothing matches that.</div>';
  $$('#cmdkList .cmdk-item').forEach((b, i) => {
    b.addEventListener('click', () => { cmdkClose(); showPanel(b.dataset.cmdk); });
    b.addEventListener('mousemove', () => { cmdkSel = i; cmdkMark(); });
  });
}

const cmdkMark = () => $$('#cmdkList .cmdk-item').forEach((b, i) => b.setAttribute('aria-selected', String(i === cmdkSel)));

function cmdkOpen() {
  $('#cmdk').hidden = false;
  $('#cmdkInput').value = '';
  cmdkRender('');
  $('#cmdkInput').focus();
}
const cmdkClose = () => { $('#cmdk').hidden = true; };

$('#cmdkOpen')?.addEventListener('click', cmdkOpen);
$('#cmdk')?.addEventListener('click', (e) => { if (e.target.id === 'cmdk') cmdkClose(); });
$('#cmdkInput')?.addEventListener('input', (e) => cmdkRender(e.target.value));
$('#cmdkInput')?.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { e.preventDefault(); cmdkSel = Math.min(cmdkSel + 1, cmdkHits.length - 1); cmdkMark(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); cmdkSel = Math.max(cmdkSel - 1, 0); cmdkMark(); }
  else if (e.key === 'Enter' && cmdkHits[cmdkSel]) { cmdkClose(); showPanel(cmdkHits[cmdkSel].panel); }
  else if (e.key === 'Escape') cmdkClose();
});
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); cmdkOpen(); }
  else if (e.key === 'Escape' && !$('#cmdk').hidden) cmdkClose();
});

/* ══════════════════════════ text models ══════════════════════════ */

async function renderModels() {
  const host = () => $('#modelsBlock');
  await new Promise((r) => setTimeout(r, 60));
  if (!host()) return;
  host().innerHTML = '<h3 class="sub">Text models</h3><div class="progress">Checking what is reachable…</div>';
  try {
    const d = await api('/api/models');
    host().innerHTML = `
      <h3 class="sub">Text models</h3>
      <div class="msg ${d.usable ? (d.active?.kind === 'local' ? 'ok' : '') : 'err'}">${esc(d.note)}</div>
      <div class="checks">
        ${d.providers.map((p) => `
          <div class="chk ${p.available ? 'up' : 'down'}">
            <span class="chkdot"></span>
            <div>
              <b>${esc(p.label)}${d.active?.id === p.id ? ' — in use' : ''}</b>
              <span class="src">${p.kind === 'local' ? 'runs on this machine' : p.kind === 'keyless' ? 'no key needed' : 'needs a key'}</span>
              <p>${esc(p.available ? `${p.model}${p.models?.length > 1 ? ` — ${p.models.length} models available` : ''}` : p.reason)}</p>
              <p class="note" style="margin:5px 0 0">${esc(p.why)}${p.available ? '' : `<br>${esc(p.setup)}`}</p>
            </div>
            ${p.available ? `<button class="go ghost tiny" data-prefer="${esc(p.id)}"${d.preferred === p.id ? ' disabled' : ''}>${d.preferred === p.id ? 'preferred' : 'Use this'}</button>` : '<span class="chkms"></span>'}
          </div>`).join('')}
      </div>
      <div class="copybar">
        <button class="go ghost" id="modelTest">Send a test prompt</button>
        <button class="go ghost" id="modelRecheck">Re-check</button>
        ${d.preferred ? '<button class="go ghost tiny" id="modelAuto">Back to automatic</button>' : ''}
      </div>
      <div id="modelTestOut"></div>
      <p class="note">Order is deliberate: a local model first because nothing you audit leaves your machine, then any keyed provider, then the keyless one. If one fails mid-request the next takes over.</p>`;

    $$('[data-prefer]').forEach((b) => b.addEventListener('click', async () => {
      busy(b, true, 'Setting…');
      try { await api('/api/models/prefer', { body: { provider: b.dataset.prefer } }); renderModels(); }
      catch (e) { alert(e.message); busy(b, false); }
    }));
    $('#modelAuto')?.addEventListener('click', async () => {
      await api('/api/models/prefer', { body: { provider: null } });
      renderModels();
    });
    $('#modelRecheck')?.addEventListener('click', async (e) => {
      busy(e.currentTarget, true, 'Checking…');
      await api('/api/models?force=1').catch(() => {});
      renderModels();
    });
    $('#modelTest')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      busy(btn, true, 'Asking…');
      $('#modelTestOut').innerHTML = '<div class="progress">Sending one short prompt…</div>';
      try {
        const r = await api('/api/models/test', { body: {} });
        $('#modelTestOut').innerHTML = `
          <div class="msg ok"><b>${esc(r.provider)} / ${esc(r.model)}</b> answered:</div>
          <div class="out">${esc(r.text)}</div>
          ${r.tried?.length ? `<p class="note">Tried first, without success: ${esc(r.tried.join(' · '))}</p>` : ''}`;
      } catch (err) { msg('#modelTestOut', err.message, 'err'); }
      finally { busy(btn, false); }
    });
  } catch (e) {
    if (host()) host().innerHTML = `<h3 class="sub">Text models</h3><div class="msg">${esc(e.message)}</div>`;
  }
}

/* ══════════════════════════ plan a new site ══════════════════════════ */

const NS = { phase: 'expect', clusters: [] };

async function renderNewsite() {
  if (!$('#phaseTabs').innerHTML) {
    const { phases } = await api('/api/newsite/phases');
    NS.phases = phases;
    $('#phaseTabs').innerHTML = phases.map((p) => `
      <button class="chip phasetab" data-phase-tab="${p.id}" aria-pressed="${p.id === NS.phase}">
        <span class="pn">${p.n}</span>${esc(p.label)}</button>`).join('');
    $$('[data-phase-tab]').forEach((b) => b.addEventListener('click', () => {
      NS.phase = b.dataset.phaseTab;
      $$('[data-phase-tab]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      renderPhase();
    }));
  }
  renderPhase();
}

function phaseWhy() {
  const p = (NS.phases || []).find((x) => x.id === NS.phase);
  return p ? `<div class="phase-why"><b>Phase ${p.n} — ${esc(p.label)}.</b> ${esc(p.why)}</div>` : '';
}

const clusterRows = () => (NS.clusters.length ? NS.clusters : [{ label: '', intent: 'informational', pages: 1, winnability: 3, value: 3 }])
  .map((c, i) => `<tr>
    <td><input data-cl="label" data-i="${i}" value="${esc(c.label || '')}" placeholder="what this group of queries is about"></td>
    <td><select data-cl="intent" data-i="${i}">${['informational', 'commercial', 'transactional', 'local'].map((x) =>
      `<option value="${x}"${c.intent === x ? ' selected' : ''}>${x}</option>`).join('')}</select></td>
    <td><input data-cl="pages" data-i="${i}" type="number" min="1" max="40" value="${c.pages || 1}" style="width:64px"></td>
    <td><input data-cl="winnability" data-i="${i}" type="number" min="1" max="5" value="${c.winnability ?? 3}" style="width:56px"></td>
    <td><input data-cl="value" data-i="${i}" type="number" min="1" max="5" value="${c.value ?? 3}" style="width:56px"></td>
  </tr>`).join('');

function wireClusters() {
  $$('[data-cl]').forEach((el) => el.addEventListener('change', () => {
    const i = +el.dataset.i, k = el.dataset.cl;
    NS.clusters[i] = NS.clusters[i] || { label: '', intent: 'informational', pages: 1, winnability: 3, value: 3 };
    NS.clusters[i][k] = ['pages', 'winnability', 'value'].includes(k) ? Number(el.value) : el.value;
  }));
}

async function renderPhase() {
  const out = $('#newsiteOut');
  const P = NS.phase;

  if (P === 'expect') {
    out.innerHTML = `${phaseWhy()}
      <div class="form">
        <div class="field"><label for="nsComp">How competitive is the market?</label>
          <select id="nsComp"><option value="low">Low — niche or local</option><option value="medium" selected>Medium</option><option value="high">High — national, well-funded incumbents</option></select></div>
        <div class="field"><label for="nsKind">Is this a new domain or a rebuild?</label>
          <select id="nsKind"><option value="new">Brand new domain</option><option value="rebuild">Rebuild of an existing site</option></select></div>
        <div class="field"><label class="check"><input type="checkbox" id="nsBrand"> The business already has brand recognition</label></div>
        <div class="field"><label>&nbsp;</label><button class="go" id="nsExpect">Set the expectation</button></div>
      </div>
      <div id="nsExpectOut"></div>`;
    $('#nsExpect').addEventListener('click', async (e) => {
      busy(e.currentTarget, true, 'Working…');
      try {
        const d = await api('/api/newsite/expectations', { body: {
          competitiveness: $('#nsComp').value, isRebuild: $('#nsKind').value === 'rebuild', hasBrand: $('#nsBrand').checked,
        } });
        $('#nsExpectOut').innerHTML = `
          <div class="msg err"><b>${esc(d.window)}</b><br>${esc(d.statement)}</div>
          <div class="msg"><b>The strategy that follows.</b> ${esc(d.strategy)}</div>
          <p class="note"><b>${esc(d.warning)}</b>${d.note ? ` ${esc(d.note)}` : ''}</p>
          <p class="note">Say this to the client before planning anything. It is what makes the strategy defensible in month four when nothing has happened yet.</p>`;
      } catch (err) { msg('#nsExpectOut', err.message, 'err'); }
      finally { busy(e.currentTarget, false); }
    });
    return;
  }

  if (P === 'position') {
    out.innerHTML = `${phaseWhy()}
      <p class="note">This is the same record as <b>Brand context</b> — fill it there and everything that writes copy reads from it. The constraints below are the ones that decide the rest of the build.</p>
      <div class="firstwork">
        <h3>Constraints to settle before anything else</h3>
        ${[
          ['CMS or framework, and whether it is already chosen', 'If it is not chosen yet, this is the moment to influence it. After launch it is a migration.'],
          ['Who writes the content, and at what rate', 'Decides whether the production order below is weeks or quarters.'],
          ['Launch deadline, and whether it can move', 'A fixed date changes which decisions you get to make properly.'],
          ['Physical or service-area footprint', 'Decides whether local is a whole workstream or nothing at all.'],
          ['SERP competitors, not business competitors', 'Frequently different sets. Whoever occupies the SERP may be a publisher or marketplace, not a rival.'],
        ].map(([t, w]) => `<div class="fw-item"><span class="sev Medium">decide</span><div><p class="ftitle">${esc(t)}</p><p class="fwhy">${esc(w)}</p></div></div>`).join('')}
      </div>
      <div class="copybar"><button class="go ghost" onclick="showPanel('brand')">Open Brand context</button></div>`;
    return;
  }

  if (P === 'demand' || P === 'architecture' || P === 'content') {
    const isArch = P === 'architecture';
    out.innerHTML = `${phaseWhy()}
      ${P === 'demand' ? '<p class="note">On a new site there is no first-party data, so competitor research substitutes for it entirely. Score each cluster on whether a site with <b>zero authority</b> can realistically enter it — long-tail and underserved beats high-volume every time in year one.</p>' : ''}
      <div class="tbl-wrap"><table><thead><tr>
        <th>Cluster</th><th>Intent</th><th class="num">Pages</th><th class="num" title="Can a site with no authority enter this? 1–5">Winnable</th><th class="num" title="Conversion proximity, not volume. 1–5">Value</th>
      </tr></thead><tbody id="clRows">${clusterRows()}</tbody></table></div>
      <div class="copybar">
        <button class="go ghost tiny" id="clAdd">Add a cluster</button>
        <button class="go ghost tiny" id="clSave">Save clusters</button>
        ${isArch ? '<button class="go" id="nsArch">Build the architecture</button>' : ''}
        ${P === 'content' ? '<button class="go" id="nsOrder">Work out the order</button>' : ''}
      </div>
      ${isArch ? `<div class="form"><div class="field"><label for="nsOrigin">Domain</label><input id="nsOrigin" placeholder="https://example.com"></div>
        <div class="field"><label for="nsBlog">Folder for guides</label><input id="nsBlog" value="guides" style="width:130px"></div></div>` : ''}
      <div id="nsPhaseOut"></div>`;
    wireClusters();
    $('#clAdd').addEventListener('click', () => {
      NS.clusters.push({ label: '', intent: 'informational', pages: 1, winnability: 3, value: 3 });
      $('#clRows').innerHTML = clusterRows(); wireClusters();
    });
    $('#clSave').addEventListener('click', async (e) => {
      NS.clusters = NS.clusters.filter((c) => c.label?.trim());
      await api('/api/newsite/clusters', { body: { clusters: NS.clusters } });
      msg('#nsPhaseOut', `${NS.clusters.length} cluster(s) saved. They drive the architecture and the production order.`, 'ok');
    });
    $('#nsArch')?.addEventListener('click', async (e) => {
      busy(e.currentTarget, true, 'Building…');
      try {
        const d = await api('/api/newsite/architecture', { body: { clusters: NS.clusters.filter((c) => c.label?.trim()), origin: $('#nsOrigin').value.trim() || 'https://example.com', blogBase: $('#nsBlog').value.trim() || 'guides' } });
        $('#nsPhaseOut').innerHTML = `
          <div class="msg ${d.depth.ok ? 'ok' : 'err'}">${esc(d.depth.note)}</div>
          <h3 class="sub">The URL plan — ${d.counts.total} pages</h3>
          <div class="tbl-wrap"><table><thead><tr><th>URL</th><th>Role</th><th>Template</th><th class="num">Depth</th><th>Schema</th></tr></thead><tbody>
            ${d.pages.map((pg) => `<tr><td class="u">${esc(pg.url)}</td>
              <td><span class="pill ${pg.role === 'hub' ? 'ok' : pg.role === 'pillar' ? 'mid' : ''}">${esc(pg.role)}</span></td>
              <td>${esc(pg.template)}</td><td class="num">${pg.depth}</td><td class="u">${esc((pg.schema || []).join(', '))}</td></tr>`).join('')}
          </tbody></table></div>
          ${copyBar(d.pages.map((pg) => pg.url).join('\n'), 'Copy the URL list')}
          <h3 class="sub">Rules to hold</h3>
          <div class="decision"><span class="area">URL pattern</span><h4>${esc(d.urlPattern.rule)}</h4>
            <p>Good: <code>${esc(d.urlPattern.example)}</code></p><p>Avoid: ${esc(d.urlPattern.avoid)}</p></div>
          <div class="decision"><span class="area">Taxonomy</span><h4>${esc(d.taxonomy.rule)}</h4><p>${esc(d.taxonomy.recommend)}</p></div>
          <div class="decision"><span class="area">Internal linking</span><h4>${esc(d.linking.rule)}</h4><p>${esc(d.linking.note)}</p></div>
          <div class="decision"><span class="area">International</span><h4>${esc(d.international)}</h4></div>`;
        wireCopy();
      } catch (err) { msg('#nsPhaseOut', err.message, 'err'); }
      finally { busy(e.currentTarget, false); }
    });
    $('#nsOrder')?.addEventListener('click', async (e) => {
      busy(e.currentTarget, true, 'Ordering…');
      try {
        const d = await api('/api/newsite/order', { body: { clusters: NS.clusters.filter((c) => c.label?.trim()), pagesPerWeek: 2 } });
        $('#nsPhaseOut').innerHTML = `
          <div class="msg"><b>${esc(d.rule)}</b></div>
          <div class="statrow"><div class="statcell"><span>Pages</span><b>${d.totalPages}</b></div>
            <div class="statcell"><span>Weeks at ${d.pagesPerWeek}/wk</span><b>${d.weeks}</b></div>
            <div class="statcell"><span>Clusters</span><b>${d.waves.length}</b></div></div>
          ${d.waves.map((w) => `<div class="week"><div class="weekhd"><b>${esc(w.cluster)}</b>
            <span class="wkdate">weeks ${w.startWeek}${w.endWeek !== w.startWeek ? `–${w.endWeek}` : ''}</span>
            <span class="pill">${w.pages} page${w.pages > 1 ? 's' : ''}</span></div>
            <p class="weekfocus">${esc(w.why)}</p></div>`).join('')}`;
      } catch (err) { msg('#nsPhaseOut', err.message, 'err'); }
      finally { busy(e.currentTarget, false); }
    });
    return;
  }

  if (P === 'technical') {
    out.innerHTML = `${phaseWhy()}
      <div class="form">
        <div class="field"><label for="nsRender">Rendering strategy</label>
          <select id="nsRender"><option value="unknown">Not decided yet</option><option value="ssr">Server-side rendered</option><option value="ssg">Static generated</option><option value="csr">Client-side only</option></select></div>
        <div class="field"><label for="nsPlat">Platform</label>
          <select id="nsPlat"><option value="unknown">Not decided</option><option value="wordpress">WordPress</option><option value="shopify">Shopify</option><option value="next">Next.js / Nuxt</option><option value="other">Other</option></select></div>
        <div class="field"><label class="check"><input type="checkbox" id="nsLocal"> Physical or service-area business</label></div>
        <div class="field"><label class="check"><input type="checkbox" id="nsIntl"> More than one language or country</label></div>
        <div class="field"><label>&nbsp;</label><button class="go" id="nsTech">Produce the spec</button></div>
      </div>
      <div id="nsPhaseOut"></div>`;
    $('#nsTech').addEventListener('click', async (e) => {
      busy(e.currentTarget, true, 'Working…');
      try {
        const d = await api('/api/newsite/technical', { body: {
          rendering: $('#nsRender').value, platform: $('#nsPlat').value,
          local: $('#nsLocal').checked, multilingual: $('#nsIntl').checked, hasStaging: true,
        } });
        $('#nsPhaseOut').innerHTML = `
          ${d.critical.length ? `<div class="msg err"><b>${d.critical.length} of these is where launches actually fail.</b> They are marked below.</div>` : ''}
          ${d.decisions.map((x) => `<div class="decision ${x.severity}">
            <span class="area">${esc(x.area)}${x.severity === 'critical' ? ' — launch-critical' : x.severity === 'done' ? ' — already handled' : ''}</span>
            <h4>${esc(x.decision)}</h4><p>${esc(x.why)}</p></div>`).join('')}
          <p class="note">${esc(d.note)}</p>
          ${copyBar(d.decisions.map((x) => `[${x.severity.toUpperCase()}] ${x.area}: ${x.decision}\n    Why: ${x.why}`).join('\n\n'), 'Copy the spec')}`;
        wireCopy();
      } catch (err) { msg('#nsPhaseOut', err.message, 'err'); }
      finally { busy(e.currentTarget, false); }
    });
    return;
  }

  if (P === 'launch') {
    out.innerHTML = `${phaseWhy()}
      <p class="note">Run the pre-launch check in <b>Ship</b> against the staging URL, then crawl the live site on day one and compare. Migrations are the single most common cause of catastrophic traffic loss in the field, so the day-one crawl is not optional.</p>
      <div class="firstwork"><h3>Launch day, in order</h3>
        ${[
          ['Staging noindex removed from production', 'And staging still blocked. This is the most common catastrophic launch failure, and it is silent.'],
          ['Search Console and analytics verified BEFORE launch', 'Verifying afterwards loses the baseline permanently.'],
          ['Redirect map complete and tested', 'Every old URL with traffic or links resolves in one hop to its closest equivalent.'],
          ['Sitemap generated and submitted', 'From canonical, indexable URLs only.'],
          ['HTTPS clean, no mixed content', 'Check the rendered page, not just the document.'],
          ['Crawl the live site on day one', 'Compare against the pre-launch crawl. Use Ship → snapshots.'],
          ['Watch Page Indexing and Performance daily for a month', 'Set up Monitoring so this happens without you remembering.'],
        ].map(([t, w]) => `<div class="fw-item"><span class="sev High">do</span><div><p class="ftitle">${esc(t)}</p><p class="fwhy">${esc(w)}</p></div></div>`).join('')}
      </div>
      <div class="copybar">
        <button class="go ghost" onclick="showPanel('ship')">Open pre-launch check</button>
        <button class="go ghost" onclick="showPanel('monitors')">Set up monitoring</button>
      </div>`;
    return;
  }
}


/* ══════════════════════════ people & workload ══════════════════════════ */

const PEOPLE = { list: [], roles: [], assignments: {} };

async function loadPeople() {
  const d = await api('/api/people');
  PEOPLE.list = d.people; PEOPLE.roles = d.roles; PEOPLE.assignments = d.assignments;
  const n = $('#nPeople');
  if (n) n.textContent = d.people.length;
  return d;
}

const avatar = (p, cls = '') =>
  `<span class="avatar ${cls}" style="background:hsl(${p.hue} 52% 42%)" title="${esc(p.name)}">${esc(p.initials)}</span>`;

async function renderPeople() {
  const out = $('#peopleOut');
  out.innerHTML = '<div class="skel row"></div><div class="skel row"></div>';
  try {
    await loadPeople();
    const w = await api('/api/people/workload');

    out.innerHTML = `
      <div class="form">
        <div class="field grow"><label for="peName">Name</label><input id="peName" placeholder="Wajiha Ghazal"></div>
        <div class="field"><label for="peRole">Role</label>
          <select id="peRole">${PEOPLE.roles.map((r) => `<option value="${r.id}">${esc(r.label)}</option>`).join('')}</select></div>
        <div class="field"><label for="peCap" title="Effort points per week: S=1, M=3, L=8">Capacity / week</label>
          <input id="peCap" type="number" min="1" max="60" value="10" style="width:100px"></div>
        <div class="field"><label>&nbsp;</label><button class="go" id="peAdd">Add</button></div>
      </div>
      <p class="note">Capacity is in the same effort points the plan uses — S counts 1, M counts 3, L counts 8. It only exists so the tool can tell you when someone has four weeks of work queued.</p>

      ${!w.people.length ? '<div class="empty">Nobody added yet.</div>' : `
        <h3 class="sub">Load</h3>
        <div class="msg ${w.unassignedPoints ? '' : 'ok'}">${esc(w.note)}</div>
        <div class="checks">
          ${w.people.map((p) => `
            <div class="person">
              ${avatar(p)}
              <span class="pn"><b>${esc(p.name)}</b><span class="pr"> — ${esc((PEOPLE.roles.find((r) => r.id === p.role) || {}).label || p.role)}</span>
                <span class="pr" style="display:block">${esc(p.note)}</span></span>
              <span class="pill ${p.weeks > 4 ? 'bad' : p.items ? 'ok' : ''}">${p.items} item${p.items === 1 ? '' : 's'} · ${p.points} pts</span>
              <button class="po-del" data-pdel="${esc(p.id)}" title="Remove">×</button>
            </div>`).join('')}
        </div>`}`;

    $('#peAdd').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const name = $('#peName').value.trim();
      if (!name) return toast('A person needs a name.', 'err');
      busy(btn, true, 'Adding…');
      try {
        await api('/api/people', { body: { person: { name, role: $('#peRole').value, capacity: Number($('#peCap').value) || 10 } } });
        toast(`${name} added.`, 'ok');
        renderPeople();
      } catch (err) { busy(btn, false); toast(err.message, 'err'); }
    });
    $$('[data-pdel]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Remove this person? Anything assigned to them becomes unassigned.')) return;
      await fetch(`/api/people/${b.dataset.pdel}`, { method: 'DELETE' });
      toast('Removed, and their assignments cleared.', 'ok');
      renderPeople();
    }));
  } catch (e) {
    out.innerHTML = `<div class="msg err">${esc(e.message)}</div>`;
  }
}

/* Assignment control on each finding, so ownership is set where the work is
   read rather than in a separate screen. */
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-assign]');
  if (!btn) return;
  e.stopPropagation();
  if (!PEOPLE.list.length) {
    await loadPeople().catch(() => {});
    if (!PEOPLE.list.length) return toast('Add someone under People first.', 'info');
  }
  const fid = btn.dataset.assign;
  const current = PEOPLE.assignments[fid];
  const ids = [null, ...PEOPLE.list.map((p) => p.id)];
  const next = ids[(ids.indexOf(current ?? null) + 1) % ids.length];
  try {
    await api('/api/people/assign', { body: { findingId: fid, personId: next } });
    if (next) PEOPLE.assignments[fid] = next; else delete PEOPLE.assignments[fid];
    const p = PEOPLE.list.find((x) => x.id === next);
    btn.className = `assign${next ? ' set' : ''}`;
    btn.innerHTML = p ? `${avatar(p, 'sm')} ${esc(p.name.split(' ')[0])}` : `${icon('people', 'sm')} assign`;
  } catch (err) { toast(err.message, 'err'); }
});


initTheme();
paintNavIcons();
loadPeople().catch(() => {});

/* ══════════════════════════ sign-in ══════════════════════════ */
/* Off unless enabled. When it is on, the cover sits above everything until a
   session resolves — the panels behind it never render unauthenticated data. */

const AUTH = { user: null, enabled: false };

async function authBoot() {
  let st;
  try { st = await api('/api/auth/status'); } catch { return; }
  AUTH.enabled = st.enabled; AUTH.user = st.user; AUTH.transport = st.transport;

  if (!st.enabled) { $('#authGate').hidden = true; renderWhoami(st); return; }
  if (st.needsSetup || !st.userCount) return renderAuthForm('setup', st);
  if (!st.user) return renderAuthForm('login', st);

  $('#authGate').hidden = true;
  renderWhoami(st);
}

function renderWhoami(st) {
  const host = $('#whoami');
  if (!host) return;
  if (!st.enabled || !st.user) {
    host.innerHTML = st.enabled ? '' : '';
    return;
  }
  const u = st.user;
  const initials = u.name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  host.innerHTML = `<button class="whoami" id="whoBtn" title="${esc(u.username)} — ${esc(u.role)}">
    <span class="avatar sm" style="background:hsl(210 52% 42%)">${esc(initials)}</span>
    <span class="wn">${esc(u.name.split(' ')[0])}</span></button>`;
  $('#whoBtn').addEventListener('click', async () => {
    if (!confirm('Sign out?')) return;
    await api('/api/auth/logout', { body: {} });
    location.reload();
  });
}

function renderAuthForm(mode, st) {
  $('#authGate').hidden = false;
  const t = st.transport || {};
  $('#authBody').innerHTML = `<div class="authbody">
    ${mode === 'setup'
      ? `<h3>Create the first account</h3>
         <p>This becomes the owner. Only an owner can add other people afterwards, and this form refuses to run again once an account exists.</p>`
      : `<h3>Sign in</h3><p>&nbsp;</p>`}
    ${t.message ? `<div class="transport ${t.level === 'danger' ? 'danger' : 'ok'}">${esc(t.message)}</div>` : ''}
    <div class="field"><label for="auUser">Username</label>
      <input id="auUser" autocomplete="username" autocapitalize="off" spellcheck="false"></div>
    <div class="field"><label for="auPass">Password</label>
      <input id="auPass" type="password" autocomplete="${mode === 'setup' ? 'new-password' : 'current-password'}"></div>
    ${mode === 'setup' ? `<div class="field"><label for="auName">Your name</label><input id="auName" autocomplete="name"></div>
      <p class="note" style="margin:0 0 14px">At least 12 characters. Length matters far more than punctuation — four ordinary words beat a short scrambled password, and are easier to remember.</p>` : ''}
    <button class="go" id="auGo">${mode === 'setup' ? 'Create account' : 'Sign in'}</button>
    <div id="auMsg"></div>
  </div>`;

  const submit = async () => {
    const btn = $('#auGo');
    const username = $('#auUser').value.trim();
    const password = $('#auPass').value;
    if (!username || !password) return msg('#auMsg', 'Both fields are required.', 'err');
    busy(btn, true, mode === 'setup' ? 'Creating…' : 'Signing in…');
    try {
      await api(mode === 'setup' ? '/api/auth/setup' : '/api/auth/login',
        { body: { username, password, name: $('#auName')?.value.trim() } });
      location.reload();
    } catch (e) { busy(btn, false); msg('#auMsg', e.message, 'err'); }
  };
  $('#auGo').addEventListener('click', submit);
  ['#auUser', '#auPass', '#auName'].forEach((sel) => $(sel)?.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); }));
  $('#auUser').focus();
}

/* A session expiring mid-use must land you back at sign-in rather than showing
   a wall of failed panels. */
const _apiAuth = api;
api = async function (path, opts) {
  try { return await _apiAuth(path, opts); }
  catch (e) {
    if (/Not signed in/i.test(e.message)) { authBoot(); }
    throw e;
  }
};

authBoot();

/* ══════════════════════════ sign-in settings ══════════════════════════ */

async function renderAuthSettings() {
  await new Promise((r) => setTimeout(r, 70));
  const host = $('#authBlock');
  if (!host) return;
  try {
    const st = await api('/api/auth/status');
    const t = st.transport || {};

    host.innerHTML = `<h3 class="sub">Sign-in</h3>
      <div class="transport ${t.level === 'danger' ? 'danger' : 'ok'}">${esc(t.message)}</div>
      ${st.enabled ? `
        <div class="msg ok">Sign-in is on. ${st.userCount} account${st.userCount === 1 ? '' : 's'}.</div>
        <div class="checks">
          ${st.users.map((u) => `<div class="person">
            <span class="avatar" style="background:hsl(210 52% 42%)">${esc(u.name.trim().split(/\\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase())}</span>
            <span class="pn"><b>${esc(u.name)}</b><span class="pr"> — ${esc(u.username)} · ${esc(u.role)}</span>
              <span class="pr" style="display:block">${u.lastLoginAt ? `last signed in ${ago(u.lastLoginAt)}` : 'never signed in'}</span></span>
            ${st.user?.role === 'owner' && u.id !== st.user.id ? `<button class="po-del" data-udel="${esc(u.id)}" title="Remove">×</button>` : ''}
          </div>`).join('')}
        </div>
        ${st.user?.role === 'owner' ? `
          <div class="form">
            <div class="field"><label for="nuUser">Username</label><input id="nuUser" autocapitalize="off"></div>
            <div class="field"><label for="nuName">Name</label><input id="nuName"></div>
            <div class="field"><label for="nuPass">Password</label><input id="nuPass" type="password" autocomplete="new-password"></div>
            <div class="field"><label for="nuRole">Role</label><select id="nuRole"><option value="member">Member</option><option value="owner">Owner</option></select></div>
            <div class="field"><label>&nbsp;</label><button class="go" id="nuAdd">Add person</button></div>
          </div>` : '<p class="note">Only an owner can add or remove accounts.</p>'}
        <div class="copybar">
          <button class="go ghost tiny" id="auRevoke">Sign out everywhere</button>
          <span class="src">Ends every session for your account, including this one. Use it if a machine goes missing.</span>
        </div>
        <div id="authMsg"></div>`
      : `
        <p class="note">Off. Anyone who opens this page can use the tool and read the crawl data. That is usually right on your own machine, and wrong the moment this is reachable from anywhere else.</p>
        <div class="form">
          <div class="field"><label for="suUser">Username</label><input id="suUser" autocapitalize="off" spellcheck="false"></div>
          <div class="field"><label for="suName">Your name</label><input id="suName"></div>
          <div class="field"><label for="suPass">Password</label><input id="suPass" type="password" autocomplete="new-password"></div>
          <div class="field"><label>&nbsp;</label><button class="go" id="suGo">Turn sign-in on</button></div>
        </div>
        <p class="note">At least 12 characters. Length matters far more than punctuation. This account becomes the owner, and there is no password reset — if you lose it, delete <code>data/auth.json</code> to start over.</p>
        <div id="authMsg"></div>`}`;

    $('#suGo')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      busy(btn, true, 'Setting up…');
      try {
        await api('/api/auth/setup', { body: { username: $('#suUser').value.trim(), password: $('#suPass').value, name: $('#suName').value.trim() } });
        toast('Sign-in is on. You are signed in as the owner.', 'ok');
        setTimeout(() => location.reload(), 900);
      } catch (err) { busy(btn, false); msg('#authMsg', err.message, 'err'); }
    });
    $('#nuAdd')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      busy(btn, true, 'Adding…');
      try {
        await api('/api/auth/users', { body: { username: $('#nuUser').value.trim(), name: $('#nuName').value.trim(), password: $('#nuPass').value, role: $('#nuRole').value } });
        toast('Account created.', 'ok');
        renderAuthSettings();
      } catch (err) { busy(btn, false); msg('#authMsg', err.message, 'err'); }
    });
    $$('[data-udel]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Remove this account? Their sessions end immediately.')) return;
      try { await fetch(`/api/auth/users/${b.dataset.udel}`, { method: 'DELETE' }); toast('Account removed.', 'ok'); renderAuthSettings(); }
      catch (err) { toast(err.message, 'err'); }
    }));
    $('#auRevoke')?.addEventListener('click', async () => {
      if (!confirm('Sign out of every session, including this one?')) return;
      await api('/api/auth/revoke-all', { body: {} });
      location.reload();
    });
  } catch (e) {
    host.innerHTML = `<h3 class="sub">Sign-in</h3><div class="msg">${esc(e.message)}</div>`;
  }
}

/* ══════════════════════════ Microsoft Clarity ══════════════════════════ */

async function renderClarity() {
  const out = $('#clarityOut');
  out.innerHTML = '<div class="skel row"></div><div class="skel row"></div>';
  try {
    const st = await api('/api/clarity/status');
    $('#dotClarity')?.classList.toggle('on', st.configured);

    if (!st.configured) {
      out.innerHTML = `
        <div class="msg">No Clarity token yet. It takes a minute: <b>clarity.microsoft.com</b> → your project → <b>Settings → Data Export → Generate new API token</b>, then paste it into Setup &amp; keys.</div>
        <h3 class="sub">What this adds that nothing else here can</h3>
        <div class="firstwork">
          ${Object.entries(st.signals).map(([, v]) => `
            <div class="fw-item"><span class="sev ${v.severity}">${esc(v.severity)}</span>
              <div><p class="ftitle">${esc(v.label)}</p><p class="fwhy">${esc(v.means)}</p></div></div>`).join('')}
        </div>
        <p class="note">Clarity's export API allows ten calls per project per day and exposes the last three days only, so this is a recent snapshot rather than a trend. Responses are cached for six hours to stop a repeated query burning the budget.</p>`;
      return;
    }

    out.innerHTML = `
      <div class="form">
        <div class="field"><label for="clDays">Window</label>
          <select id="clDays"><option value="3">Last 3 days</option><option value="2">Last 2 days</option><option value="1">Last 24 hours</option></select></div>
        <div class="field grow"><label for="clDim">Break down by (up to 3)</label>
          <div class="chipset" id="clDims">${st.dimensions.map((d) => `<button class="chip" data-dim="${esc(d)}" aria-pressed="${d === 'URL' ? 'true' : 'false'}">${esc(d)}</button>`).join('')}</div></div>
        <div class="field"><label>&nbsp;</label><button class="go" id="clGo">Fetch</button></div>
      </div>
      <p class="note">${st.budget.remaining} of ${st.budget.cap} API calls left today, resetting at ${esc(st.budget.resetsAt)}. Cached responses cost nothing.</p>
      <div id="clOut"></div>`;

    $$('#clDims .chip').forEach((b) => b.addEventListener('click', () => {
      const on = $$('#clDims .chip[aria-pressed=true]');
      if (b.getAttribute('aria-pressed') === 'true') b.setAttribute('aria-pressed', 'false');
      else if (on.length < 3) b.setAttribute('aria-pressed', 'true');
      else toast('Clarity allows at most three dimensions per call.', 'info');
    }));

    $('#clGo').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      busy(btn, true, 'Fetching…');
      $('#clOut').innerHTML = '<div class="progress">Asking Clarity…</div>';
      try {
        const d = await api('/api/clarity/insights', { body: {
          numOfDays: Number($('#clDays').value),
          dimensions: $$('#clDims .chip[aria-pressed=true]').map((x) => x.dataset.dim),
        } });
        renderClarityData(d);
      } catch (err) { msg('#clOut', err.message, 'err'); }
      finally { busy(btn, false); }
    });
  } catch (e) {
    out.innerHTML = `<div class="msg err">${esc(e.message)}</div>`;
  }
}

function renderClarityData(d) {
  $('#clOut').innerHTML = `
    ${d.cached ? `<div class="msg">Cached ${ago(d.cachedAt)}${d.stale ? ' — and the daily API limit is used up, so this is the last stored copy.' : ', so this cost none of your daily calls.'}</div>` : ''}
    <div class="statrow">
      <div class="statcell"><span>Sessions</span><b>${num(d.sessions)}</b></div>
      <div class="statcell"><span>Bot sessions</span><b>${num(d.bots)}</b>${d.botShare != null ? `<em class="chg ${d.botShare > 50 ? 'bad' : ''}">${d.botShare}% of all</em>` : ''}</div>
      <div class="statcell"><span>Friction signals</span><b class="${d.friction.length ? 'bad' : 'good'}">${d.friction.length}</b></div>
      <div class="statcell"><span>Window</span><b style="font-size:1rem">${d.days} day${d.days === 1 ? '' : 's'}</b></div>
    </div>
    <div class="readout ${d.friction.length ? 'ctr' : ''}"><b>What this says.</b> ${esc(d.read)}</div>

    ${d.friction.length ? `<h3 class="sub">Friction, worst first</h3>
      ${d.friction.map((f) => `
        <div class="finding">
          <div class="fhead"><span class="sev ${f.severity}">${f.total}</span>
            <div class="ftitle">${esc(f.label)}<span class="fmeta">${f.per1k != null ? `${f.per1k} per 1,000 sessions` : ''}</span></div></div>
          <div class="fbody" hidden>
            <p><b>What it means</b> ${esc(f.means)}</p>
            <p><b>What to do</b> ${esc(f.act)}</p>
            ${f.breakdown?.length ? `<div class="tbl-wrap"><table><tbody>
              ${f.breakdown.map((r) => `<tr>${Object.entries(r).map(([k, v]) => `<td${/count|Count/i.test(k) ? ' class="num"' : ''}>${esc(String(v))}</td>`).join('')}</tr>`).join('')}
            </tbody></table></div>` : ''}
          </div>
        </div>`).join('')}` : '<div class="msg ok">No friction signals in this window.</div>'}

    ${d.pages?.length ? `<h3 class="sub">Most visited pages</h3>
      <div class="tbl-wrap"><table><tbody>
        ${d.pages.map((r) => `<tr>${Object.values(r).map((v) => `<td class="u">${esc(String(v))}</td>`).join('')}</tr>`).join('')}
      </tbody></table></div>` : ''}

    <p class="note">${esc(d.caveat)}</p>
    <p class="note">Metrics returned: ${esc((d.metricsSeen || []).join(', ') || 'none')}.</p>`;

  $$('#clOut .fhead').forEach((h) => h.addEventListener('click', () => {
    const b = h.nextElementSibling; b.hidden = !b.hidden;
  }));
}

/* ══════════════════════════ diagnostics, rebuilt ══════════════════════════ */

async function renderHealth2() {
  const out = $('#healthOut');
  out.innerHTML = '<div class="progress">Checking each layer in order — network first, then the APIs. Up to a minute.</div>';
  try {
    const d = await api('/api/diagnostics');
    $('#dotHealth').classList.toggle('on', d.healthy);
    const LAYERS = { network: 'Network', google: 'Google APIs', ai: 'Text & images', free: 'Free endpoints', local: 'On this machine', clarity: 'Behaviour' };

    out.innerHTML = `
      <div class="msg ${d.healthy ? 'ok' : 'err'}"><b>${esc(d.summary)}.</b> ${esc(d.verdict)}</div>
      ${Object.entries(d.byLayer).map(([layer, checks]) => `
        <h3 class="sub">${esc(LAYERS[layer] || layer)}</h3>
        <div class="checks">
          ${checks.map((c) => `
            <div class="chk ${c.ok ? 'up' : 'down'}">
              <span class="chkdot"></span>
              <div><b>${esc(c.name)}</b><span class="src">${esc(c.detail)}</span>
                <p>${esc(c.ok ? c.info : c.error)}</p></div>
              <span class="chkms">${c.ms}ms</span>
            </div>`).join('')}
        </div>`).join('')}
      <h3 class="sub">Copyable report</h3>
      <p class="note">If something is red and the message does not explain it, send this.</p>
      <div class="out code">${esc(d.report)}</div>${copyBar(d.report, 'Copy the report')}
      <div class="copybar"><button class="go ghost" id="healthAgain">Run again</button></div>`;
    wireCopy();
    $('#healthAgain').addEventListener('click', () => renderHealth2());
  } catch (e) {
    out.innerHTML = `<div class="msg err">${esc(e.message)}</div>
      <p class="note">If this request itself failed, the server is not responding — check the terminal window it is running in.</p>`;
  }
}


/* ══════════════════════════ competitors ══════════════════════════ */

async function renderCompetitors() {
  const out = $('#compOut');
  out.innerHTML = '<div class="skel row"></div><div class="skel row"></div>';
  try {
    const d = await api('/api/competitors');
    $('#nComp2') && ($('#nComp2').textContent = d.competitors.length);

    out.innerHTML = `
      <div class="form">
        <div class="field grow"><label for="cpUrl">Competitor URL</label><input id="cpUrl" type="url" placeholder="https://competitor.com"></div>
        <div class="field"><label for="cpMax">Max pages</label><input id="cpMax" type="number" value="150" min="10" max="500" style="width:100px"></div>
        <div class="field"><label>&nbsp;</label><button class="go" id="cpAdd">Crawl and profile</button></div>
      </div>
      <p class="note">Only the aggregate profile is stored, never their pages. Crawls respect their robots.txt and are paced the same as yours.</p>

      ${!d.mine ? '<div class="empty">Crawl your own site first — there is nothing to compare against otherwise.</div>' : ''}
      ${d.competitors.length ? `<h3 class="sub">Profiled</h3>
        <div class="checks">${d.competitors.map((c) => `
          <div class="person">
            <span class="avatar" style="background:hsl(${[...c.host].reduce((a, ch) => a + ch.charCodeAt(0), 0) % 360} 45% 40%)">${esc(c.host.slice(0, 2).toUpperCase())}</span>
            <span class="pn"><b>${esc(c.host)}</b><span class="pr" style="display:block">${num(c.pages)} pages · crawled ${ago(c.crawledAt)}</span></span>
            <button class="po-del" data-cpdel="${esc(c.host)}" title="Remove">×</button>
          </div>`).join('')}</div>
        <div class="copybar"><button class="go" id="cpGo">Compare</button></div>` : ''}
      <div id="cpOut"></div>`;

    $('#cpAdd').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const url = $('#cpUrl').value.trim();
      if (!url) return toast('Give it a competitor URL.', 'err');
      busy(btn, true, 'Crawling…');
      $('#cpOut').innerHTML = '<div class="progress">Crawling them. This takes as long as crawling your own site of the same size.</div>';
      try {
        const r = await api('/api/competitors', { body: { url, maxPages: Number($('#cpMax').value) || 150 } });
        toast(`${r.profile.host} profiled — ${r.profile.pages} pages.`, 'ok');
        renderCompetitors();
      } catch (err) { busy(btn, false); msg('#cpOut', err.message, 'err'); }
    });

    $$('[data-cpdel]').forEach((b) => b.addEventListener('click', async () => {
      await fetch(`/api/competitors/${encodeURIComponent(b.dataset.cpdel)}`, { method: 'DELETE' });
      renderCompetitors();
    }));

    $('#cpGo')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      busy(btn, true, 'Comparing…');
      try {
        const c = await api('/api/competitors/compare');
        $('#cpOut').innerHTML = `
          ${c.truncatedWarning ? `<div class="msg err">${esc(c.truncatedWarning)}</div>` : ''}
          <div class="statrow">
            <div class="statcell"><span>Gaps found</span><b class="${c.gaps.length ? 'bad' : 'good'}">${c.gaps.length}</b></div>
            <div class="statcell"><span>Ahead on</span><b class="good">${c.ahead.length}</b></div>
            <div class="statcell"><span>Your pages</span><b>${num(c.mine.pages)}</b></div>
            <div class="statcell"><span>Compared against</span><b>${c.theirs.length}</b></div>
          </div>

          ${c.gaps.length ? `<h3 class="sub">Where they are ahead</h3>
            ${c.gaps.map((g) => `
              <div class="finding">
                <div class="fhead"><span class="sev ${g.severity}">${esc(g.severity)}</span>
                  <div class="ftitle">${esc(g.area)}<span class="fmeta">${esc(g.what)}</span></div></div>
                <div class="fbody" hidden>
                  <p><b>Why it matters</b> ${esc(g.why)}</p>
                  <p><b>What to do</b> ${esc(g.act)}</p>
                  <p class="note">Evidence: ${esc(g.evidence)}</p>
                </div>
              </div>`).join('')}` : '<div class="msg ok">No meaningful gaps found against the sites profiled.</div>'}

          ${c.ahead.length ? `<h3 class="sub">Where you are ahead</h3>
            <div class="firstwork">${c.ahead.map((a) => `<div class="fw-item"><span class="sev Low">ahead</span><div><p class="fwhy">${esc(a)}</p></div></div>`).join('')}</div>
            <p class="note">Worth knowing so you do not spend effort here.</p>` : ''}

          <h3 class="sub">Side by side</h3>
          <div class="tbl-wrap"><table><thead><tr><th>Measure</th><th class="num">You</th>${c.theirs.map((t) => `<th class="num">${esc(t.host)}</th>`).join('')}</tr></thead><tbody>
            ${[
              ['Pages crawled', (x) => num(x.pages)],
              ['Median words', (x) => num(x.words.median)],
              ['Median click depth', (x) => x.depth.median],
              ['Deeper than 3 clicks', (x) => num(x.depth.deep)],
              ['Inbound links, median', (x) => x.inbound.median],
              ['Pages with schema', (x) => `${x.schema.pagesWithAny} of ${x.pages}`],
              ['Breadcrumb markup', (x) => num(x.hasBreadcrumbs)],
              ['Author markup', (x) => num(x.hasAuthor)],
              ['Median response', (x) => `${x.responseMs}ms`],
            ].map(([label, fn]) => `<tr><td>${esc(label)}</td><td class="num">${fn(c.mine)}</td>${c.theirs.map((t) => `<td class="num">${fn(t)}</td>`).join('')}</tr>`).join('')}
          </tbody></table></div>

          <h3 class="sub">Their top-level sections</h3>
          <p class="note">The closest a crawl gets to a content gap. A section carrying several pages is a topic they decided to invest in.</p>
          ${c.theirs.map((t) => `<p class="note"><b>${esc(t.host)}</b> — ${t.sections.map(([sg, n]) => `/${esc(sg)}/ (${n})`).join(', ') || 'no sections'}</p>`).join('')}
          <p class="note">${esc(c.limits)}</p>`;
        $$('#cpOut .fhead').forEach((h) => h.addEventListener('click', () => {
          const bd = h.nextElementSibling; bd.hidden = !bd.hidden;
        }));
      } catch (err) { msg('#cpOut', err.message, 'err'); }
      finally { busy(btn, false); }
    });
  } catch (e) {
    out.innerHTML = `<div class="msg err">${esc(e.message)}</div>`;
  }
}


/* ══════════════════════════ server logs ══════════════════════════ */

async function renderLogs() {
  const sel = $('#lgBot');
  if (sel && !sel.options.length) {
    try {
      const { bots } = await api('/api/logs/bots');
      sel.innerHTML = bots.map((b) => `<option value="${b.id}"${b.id === 'googlebot' ? ' selected' : ''}>${esc(b.label)}${b.verifiable ? '' : ' (identity unverifiable)'}</option>`).join('');
    } catch { /* leave empty */ }
  }
}

$('#lgGo')?.addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  const f = $('#lgFile').files?.[0];
  if (!f) return toast('Pick a log file first.', 'err');
  busy(btn, true, 'Parsing…');
  $('#logsOut').innerHTML = `<div class="progress">Reading ${esc(f.name)} — ${Math.round(f.size / 1024)}KB…</div>`;
  try {
    const text = await f.text();
    const d = await api('/api/logs/analyse', { body: { text, bot: $('#lgBot').value || 'googlebot' } });
    renderLogData(d);
  } catch (err) { msg('#logsOut', err.message, 'err'); }
  finally { busy(btn, false); }
});

function renderLogData(d) {
  const w = d.waste;
  $('#logsOut').innerHTML = `
    <div class="statrow">
      <div class="statcell"><span>${esc(d.bot.label)} hits</span><b>${num(d.bot.hits)}</b><em class="chg">${num(d.bot.perDay)}/day</em></div>
      <div class="statcell"><span>Wasted on errors</span><b class="${w.errorShare > 5 ? 'bad' : ''}">${w.errorShare}%</b></div>
      <div class="statcell"><span>On redirects</span><b class="${w.redirectShare > 15 ? 'bad' : ''}">${w.redirectShare}%</b></div>
      <div class="statcell"><span>On parameters</span><b class="${w.paramShare > 20 ? 'bad' : ''}">${w.paramShare}%</b></div>
      <div class="statcell"><span>Window</span><b style="font-size:1rem">${d.span ? `${d.span.from} → ${d.span.to}` : `${d.days}d`}</b></div>
    </div>
    <div class="readout ${d.findings.length ? 'ctr' : ''}"><b>What the log says.</b> ${esc(d.read)}</div>
    ${d.caveat ? `<div class="msg">${esc(d.caveat)}</div>` : ''}
    <p class="note">Format detected: ${esc(d.format)}. Parsed ${num(d.lines.parsed)} of ${num(d.lines.total)} lines${d.lines.skipped ? `, skipped ${num(d.lines.skipped)} malformed` : ''}. ${esc(d.bot.verificationNote)}</p>

    ${d.findings.length ? `<h3 class="sub">Findings — ${d.findings.length}</h3>
      ${d.findings.map((f) => `
        <div class="finding">
          <div class="fhead"><span class="sev ${f.severity}">${esc(f.severity)}</span>
            <div class="ftitle">${esc(f.title)}</div></div>
          <div class="fbody" hidden>
            <p><b>What</b></p><div class="out code">${esc(f.what)}</div>
            <p><b>Why it matters</b> ${esc(f.why)}</p>
            <p><b>What to do</b></p><div class="out">${esc(f.act)}</div>
            ${f.urls?.length ? `<details class="urls"><summary>${f.urls.length} URL(s)</summary><ul>${f.urls.map((u) => `<li>${esc(u)}</li>`).join('')}</ul></details>` : ''}
          </div>
        </div>`).join('')}` : '<div class="msg ok">No crawl waste worth reporting.</div>'}

    <h3 class="sub">Who is crawling</h3>
    <div class="tbl-wrap"><table><thead><tr><th>Agent</th><th class="num">Requests</th><th class="num">Share</th></tr></thead><tbody>
      <tr><td>Humans</td><td class="num">${num(d.traffic.human)}</td><td class="num">${Math.round((d.traffic.human / d.lines.parsed) * 100)}%</td></tr>
      ${d.traffic.bots.map((b) => `<tr><td>${esc(b.label)}</td><td class="num">${num(b.hits)}</td><td class="num">${Math.round((b.hits / d.lines.parsed) * 100)}%</td></tr>`).join('')}
    </tbody></table></div>

    <h3 class="sub">Where the budget went</h3>
    ${barChart(d.sections.map(([, n]) => n), { labels: d.sections.map(([s]) => s.slice(0, 12)), h: 150 })}
    <p class="chartread">Requests per top-level section. A section taking a large share while carrying few of your important pages is budget in the wrong place.</p>

    <h3 class="sub">Response codes served to ${esc(d.bot.label)}</h3>
    ${barChart(Object.values(d.statuses), { labels: Object.keys(d.statuses), h: 130 })}

    <h3 class="sub">Most requested URLs</h3>
    <div class="tbl-wrap"><table><thead><tr><th>URL</th><th class="num">Hits</th><th>Codes</th></tr></thead><tbody>
      ${d.topUrls.slice(0, 20).map((u) => `<tr><td class="u">${esc(u.url)}</td><td class="num">${num(u.hits)}</td>
        <td>${Object.entries(u.statuses).map(([s, n]) => `<span class="pill ${/^[45]/.test(s) ? 'bad' : /^3/.test(s) ? 'mid' : 'ok'}">${s}×${n}</span>`).join(' ')}</td></tr>`).join('')}
    </tbody></table></div>

    ${d.neverCrawled?.length ? `<h3 class="sub">Never requested — ${d.neverCrawled.length}</h3>
      <p class="note">Indexable pages Googlebot did not fetch once in this window. Sorted by inbound internal links, fewest first, because that is almost always the cause.</p>
      <div class="tbl-wrap"><table><thead><tr><th>Path</th><th class="num">Inbound links</th><th class="num">Depth</th></tr></thead><tbody>
        ${d.neverCrawled.slice(0, 20).map((n) => `<tr><td class="u">${esc(n.path)}</td>
          <td class="num"><span class="pill ${n.inbound ? '' : 'bad'}">${n.inbound}</span></td><td class="num">${n.depth}</td></tr>`).join('')}
      </tbody></table></div>` : ''}`;

  $$('#logsOut .fhead').forEach((h) => h.addEventListener('click', () => {
    const b = h.nextElementSibling; b.hidden = !b.hidden;
  }));
}

/* ══════════════════════════ panel hooks ══════════════════════════ */
/* One registry instead of wrapping showPanel once per feature. The old shape
   reassigned showPanel eleven times and re-cloned every nav button after each
   one, which meant: an eleven-deep call chain per navigation, listeners
   silently destroyed by later clones, and a dead handler that survived because
   it was registered on the chain rather than on the element. Each feature now
   registers once and nav items are bound exactly once, at boot. */

const PANEL_HOOKS = {};
function onPanel(name, fn) { (PANEL_HOOKS[name] ||= []).push(fn); }

function runPanelHooks(name) {
  for (const fn of PANEL_HOOKS[name] || []) {
    try { fn(); } catch (e) { console.error(`panel hook for ${name} failed:`, e); }
  }
}

onPanel('security', () => renderSecurity());
onPanel('monitors', () => renderMonitors());
onPanel('pages', () => fillIntentPages());
onPanel('setup', () => renderSetup());
onPanel('newsite', () => renderNewsite().catch((e) => msg('#newsiteOut', e.message, 'err')));
onPanel('people', () => renderPeople());
onPanel('clarity', () => renderClarity());
onPanel('health', () => renderHealth2());
onPanel('competitors', () => renderCompetitors());
onPanel('logs', () => renderLogs());
onPanel('brand', () => renderBrand().catch((e) => msg('#brandOut', e.message, 'err')));
onPanel('program', () => renderProgram());
onPanel('campaigns', () => renderCampaigns().catch((e) => msg('#campOut', e.message, 'err')));

/* Bound once. Nothing after this point may re-clone nav items. */
function bindNav() {
  $$('.navitem[data-panel]').forEach((b) => {
    if (b.dataset.bound) return;
    b.dataset.bound = '1';
    b.addEventListener('click', () => showPanel(b.dataset.panel));
  });
  paintNavIcons();
}


/* ══════════════════════════ AI visibility ══════════════════════════ */

const SOV_HUES = [212, 158, 32, 280, 344, 48, 190, 108, 266, 12];

function ring(value, size = 118) {
  const r = size / 2 - 9, c = 2 * Math.PI * r;
  const v = value == null ? 0 : Math.max(0, Math.min(100, value));
  const col = v >= 70 ? 'var(--pass)' : v >= 40 ? 'var(--note)' : 'var(--warn)';
  return `<div class="ring" style="width:${size}px;height:${size}px">
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--sunk)" stroke-width="10"/>
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${col}" stroke-width="10"
        stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - v / 100)}"/>
    </svg>
    <div class="rv"><span class="rn">${value == null ? '—' : v}</span><span class="rd">of 100</span></div>
  </div>`;
}

function donut(slices, size = 190) {
  const r = size / 2 - 16, c = 2 * Math.PI * r;
  let off = 0;
  const total = slices.reduce((t, s) => t + s.share, 0) || 100;
  const arcs = slices.map((s, i) => {
    const len = (s.share / total) * c;
    const seg = `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none"
      stroke="${s.you ? 'var(--note)' : `hsl(${SOV_HUES[i % SOV_HUES.length]} 48% 48%)`}"
      stroke-width="${s.you ? 22 : 16}" stroke-dasharray="${len} ${c - len}"
      stroke-dashoffset="${-off}"/>`;
    off += len;
    return seg;
  }).join('');
  const you = slices.find((s) => s.you);
  return `<div class="donut" style="width:${size}px;height:${size}px">
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="transform:rotate(-90deg)">${arcs}</svg>
    <div class="dv"><span class="dn">${you ? `${you.share}%` : '0%'}</span><span class="dl">yours</span></div>
  </div>`;
}

async function renderAivis() {
  const out = $('#aivisOut');
  out.innerHTML = '<div class="skel row"></div><div class="skel row"></div><div class="skel row"></div>';
  try {
    const d = await api('/api/aivis');
    const L = d.latest;
    $('#nAivis') && ($('#nAivis').textContent = L?.score != null ? L.score : '—');

    const initials = (d.brand.name || 'Your brand').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
    const runs = d.runs || [];

    out.innerHTML = `
      <div class="brandhead">
        <div class="bh-id">
          <span class="bh-mark" style="background:hsl(212 52% 44%)">${esc(initials)}</span>
          <div>
            <h3 class="bh-name">${esc(d.brand.name || 'Brand name not set')}</h3>
            <p class="bh-sub">${d.brand.domain ? esc(short(d.brand.domain, 40)) : 'No domain — crawl a site to enable citation tracking'}</p>
            <div class="bh-tags">
              ${runs.length ? `<span class="tag ok">${runs.length} run${runs.length === 1 ? '' : 's'}</span>` : '<span class="tag">no runs yet</span>'}
              ${L?.providers?.length ? `<span class="tag">${L.providers.length} model${L.providers.length === 1 ? '' : 's'} answered</span>` : ''}
              <span class="tag">${d.prompts.length} prompt${d.prompts.length === 1 ? '' : 's'} tracked</span>
            </div>
          </div>
        </div>
        <div>
          ${ring(L?.score ?? null)}
          <p class="ringcap">AI visibility${runs.length > 1 ? `, latest of ${runs.length} runs` : ''}</p>
        </div>
        <div class="bh-stats">
          <div class="bh-stat"><span>Named</span><b>${L ? `${L.namedRate}%` : '—'}</b></div>
          <div class="bh-stat"><span>Cited</span><b>${L ? `${L.citedRate}%` : '—'}</b></div>
          <div class="bh-stat"><span>Sentiment</span><b>${L?.sentiment != null ? `${L.sentiment}/10` : '—'}</b></div>
        </div>
      </div>

      ${L ? `<div class="sovgrid">
        <div class="sovcard">
          <h3>Share of voice</h3>
          <p class="sub">Every brand the models named, across this run</p>
          ${donut(L.shareOfVoice)}
          <div class="sovlegend">
            ${L.shareOfVoice.slice(0, 6).map((s, i) => `<div>
              <i style="background:${s.you ? 'var(--note)' : `hsl(${SOV_HUES[i % SOV_HUES.length]} 48% 48%)`}"></i>
              ${esc(s.brand)}${s.you ? ' (you)' : ''}<b>${s.share}%</b></div>`).join('')}
          </div>
          ${L.shareOfVoice.length > 6 ? `<p class="note">and ${L.shareOfVoice.length - 6} more</p>` : ''}
        </div>
        <div class="runcard">
          <h3>Visibility across runs</h3>
          <p class="sub">Runs are the unit of time, not days — answers are stochastic, so two runs on one day will differ</p>
          ${runs.length >= 2
            ? lineChart([
                { values: runs.map((r) => r.score ?? 0), color: 'var(--note)' },
                { values: runs.map((r) => r.namedRate ?? 0), color: 'var(--pass)' },
                { values: runs.map((r) => r.citedRate ?? 0), color: 'var(--warn)' },
              ], { labels: runs.map((r, i) => `Run ${i + 1}`), h: 170 })
              + `<p class="chartkey"><i style="background:var(--note)"></i> score &nbsp; <i style="background:var(--pass)"></i> named % &nbsp; <i style="background:var(--warn)"></i> cited %</p>`
            : '<div class="empty">One run so far. A single run is an anecdote — run it three times before reading a trend.</div>'}
        </div>
      </div>` : ''}

      <div class="form">
        <div class="field grow"><label for="avPrompts">Prompts — one per line. Questions a customer would type, not keywords</label>
          <textarea id="avPrompts" rows="5">${esc((d.prompts.length ? d.prompts : d.suggested).join('\n'))}</textarea></div>
      </div>
      <div class="copybar">
        <button class="go ghost tiny" id="avSave">Save prompts</button>
        <button class="go" id="avRun">Run now</button>
        <span class="src">${d.prompts.length || d.suggested.length} prompt(s) × every reachable model, paced. Expect a minute or two.</span>
      </div>
      ${!d.brand.name ? '<div class="msg err">No brand name set. Fill in Brand context first — the brand name is what is being looked for in the answers.</div>' : ''}
      <div id="avMsg"></div>

      ${d.byPrompt.length ? `<h3 class="sub">Prompts — ${d.byPrompt.length} tracked</h3>
        <div class="tbl-wrap"><table class="prompttable"><thead><tr>
          <th>Prompt</th><th class="num">Trend</th><th>Visibility</th><th class="num">Cited</th><th class="num">Sentiment</th>
        </tr></thead><tbody>
          ${d.byPrompt.map((r, i) => `<tr data-prompt="${i}" style="cursor:pointer">
            <td>${esc(r.prompt)}</td>
            <td class="num">${r.trend == null ? '<span class="src">—</span>'
              : `<span class="${r.trend > 0 ? 'trend-up' : r.trend < 0 ? 'trend-down' : ''}">${r.trend > 0 ? '+' : ''}${r.trend}%</span>`}</td>
            <td><span class="vbar-track"><span class="vbar" style="width:${Math.round(r.visibility * 0.7)}px"></span></span>${r.visibility}%</td>
            <td class="num">${r.citedRate}%</td>
            <td class="num">${r.sentiment != null ? `<span class="pill ${r.sentiment >= 6 ? 'ok' : r.sentiment <= 4 ? 'bad' : 'mid'}">${r.sentiment}</span>` : '—'}</td>
          </tr>`).join('')}
        </tbody></table></div>
        <div id="avAnswer"></div>` : ''}

      <p class="note"><b>What this can and cannot tell you.</b> ${esc(d.limits)}</p>
      ${L?.scoring ? `<p class="note">${esc(L.scoring)}</p>` : ''}`;

    $('#avSave').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      busy(btn, true, 'Saving…');
      try {
        const r = await api('/api/aivis/prompts', { body: { prompts: $('#avPrompts').value.split('\n') } });
        toast(`${r.prompts.length} prompt(s) saved.`, 'ok');
      } catch (err) { toast(err.message, 'err'); }
      finally { busy(btn, false); }
    });

    $('#avRun').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      busy(btn, true, 'Running…');
      $('#avMsg').innerHTML = '<div class="progress">Asking every reachable model, one prompt at a time and paced so a free tier does not cut us off…</div>';
      try {
        await api('/api/aivis/run', { body: { prompts: $('#avPrompts').value.split('\n').map((x) => x.trim()).filter(Boolean) } });
        toast('Run complete.', 'ok');
        renderAivis();
      } catch (err) { busy(btn, false); msg('#avMsg', err.message, 'err'); }
    });

    /* Reading the actual answer is the point — a score without the text behind
       it is not something you can act on. */
    $$('[data-prompt]').forEach((row) => row.addEventListener('click', () => {
      const r = d.byPrompt[+row.dataset.prompt];
      const answers = (L?.results || []).filter((x) => x.prompt === r.prompt && !x.error);
      $('#avAnswer').innerHTML = `
        <h3 class="sub">${esc(r.prompt)}</h3>
        ${answers.length ? answers.map((a) => `
          <div class="finding">
            <div class="fhead">
              <span class="sev ${a.named ? (a.cited ? 'Low' : 'Medium') : 'High'}">${a.named ? (a.cited ? 'named + cited' : 'named only') : 'absent'}</span>
              <div class="ftitle">${esc(a.provider)} <span class="fmeta">${esc(a.model || '')}${a.position ? ` · mentioned ${a.position}${a.position === 1 ? 'st' : a.position === 2 ? 'nd' : a.position === 3 ? 'rd' : 'th'}` : ''}${a.sentiment ? ` · ${esc(a.sentiment.label)}` : ''}</span></div>
            </div>
            <div class="fbody" hidden>
              <div class="out answerbox">${esc(a.answer)}</div>
              ${a.brands?.length ? `<p class="note">Brands named: ${a.brands.slice(0, 8).map((x) => esc(x.brand)).join(', ')}</p>` : ''}
              ${a.sentiment ? `<p class="note">Sentiment basis: ${esc(a.sentiment.basis)}. Lexicon-based, so treat it as a hint.</p>` : ''}
            </div>
          </div>`).join('') : '<div class="empty">No stored answers for this prompt in the latest run.</div>'}`;
      $$('#avAnswer .fhead').forEach((h) => h.addEventListener('click', () => {
        const bd = h.nextElementSibling; bd.hidden = !bd.hidden;
      }));
      $('#avAnswer').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }));
  } catch (e) {
    out.innerHTML = `<div class="msg err">${esc(e.message)}</div>`;
  }
}

onPanel('aivis', renderAivis);

/* Last line in the file: every hook is registered by now. */
bindNav();
