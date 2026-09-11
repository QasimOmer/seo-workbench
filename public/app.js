/* SEO Workbench — front end. Vanilla, single file, no build step. */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const short = (u, n = 58) => { const s = String(u).replace(/^https?:\/\/(www\.)?/, ''); return s.length > n ? `${s.slice(0, n)}…` : s; };
const num = (n) => (n ?? 0).toLocaleString();

const state = {
  pages: [], findings: [], origin: '', gscSite: '', filter: 'all', phase: null,
  keywords: null, clusters: null, stats: null, counts: {}, topThree: [],
  properties: [], activeId: null, crawledAt: null, panel: 'overview',
};

const LADDER = [
  { key: 'eligibility', label: 'Eligibility' },
  { key: 'indexation',  label: 'Indexation' },
  { key: 'intent',      label: 'Intent match' },
  { key: 'onpage',      label: 'On-page' },
  { key: 'linking',     label: 'Internal links' },
  { key: 'schema',      label: 'Structured data' },
  { key: 'performance', label: 'Performance' },
  { key: 'offpage',     label: 'Off-page' },
];

async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const json = await res.json().catch(() => {
    if (res.status === 504) {
      return { ok: false, error: 'The crawl exceeded Vercel’s execution timeout. Try auditing with fewer pages (e.g. 10–25) or targeting a specific section.' };
    }
    return { ok: false, error: `Bad response (${res.status})` };
  });
  if (!json.ok) throw new Error(json.error || 'Request failed');
  return json;
}
const msg = (el, text, kind = '') => { $(el).innerHTML = text ? `<div class="msg ${kind}">${esc(text)}</div>` : ''; };
/* Tolerates a detached or missing button: handlers that re-render their own
   panel legitimately lose their trigger mid-flight, and that must not throw. */
const busy = (btn, on, label) => {
  if (!btn) return;
  btn.disabled = on;
  btn.textContent = on ? (label || 'Working…') : (btn.dataset.label || btn.textContent);
};

/* ══════════════════════════════ portal shell ══════════════════════════════ */

const SECTION_MAP = {
  // Diagnosis
  overview: 'diagnosis',
  ladder: 'diagnosis',
  pages: 'diagnosis',
  crawl: 'diagnosis',
  security: 'diagnosis',

  // Performance
  speed: 'performance',
  logs: 'performance',

  // Analysis
  console: 'analysis',
  competitors: 'analysis',
  aivis: 'analysis',
  clarity: 'analysis',
  demand: 'analysis',
  rank: 'analysis',

  // Plan
  newsite: 'plan',
  program: 'plan',
  campaigns: 'plan',

  // Build
  build: 'build',
  social: 'build',
  ship: 'build',
  brand: 'build',

  // Settings
  settings: 'settings',
  setup: 'settings',
  team: 'settings',
  monitors: 'settings',
  people: 'settings',
  health: 'settings',
};

const SECTIONS = {
  diagnosis: {
    label: 'Diagnosis',
    tag: 'Technical Audit & Health',
    default: 'overview',
    tabs: [
      { id: 'overview', label: 'Overview & Fixes' },
      { id: 'ladder', label: '14-Point Ladder' },
      { id: 'pages', label: 'Pages & Issues' },
      { id: 'crawl', label: 'Crawl Settings' },
      { id: 'security', label: 'Security Headers' },
    ],
  },
  performance: {
    label: 'Performance',
    tag: 'Speed & Crawl Budget',
    default: 'speed',
    tabs: [
      { id: 'speed', label: 'Speed & CrUX' },
      { id: 'logs', label: 'Server Logs' },
    ],
  },
  analysis: {
    label: 'Analysis',
    tag: 'Search Console & Intelligence',
    default: 'console',
    tabs: [
      { id: 'console', label: 'Search Console' },
      { id: 'competitors', label: 'Competitors' },
      { id: 'aivis', label: 'AI Visibility' },
      { id: 'clarity', label: 'Behaviour (Clarity)' },
      { id: 'demand', label: 'Keyword Demand' },
      { id: 'rank', label: 'Search Rank' },
    ],
  },
  plan: {
    label: 'Plan',
    tag: 'Architecture & Roadmap',
    default: 'newsite',
    tabs: [
      { id: 'newsite', label: 'Plan New Site' },
      { id: 'program', label: 'Work Roadmap' },
      { id: 'campaigns', label: 'Campaigns' },
    ],
  },
  build: {
    label: 'Build',
    tag: 'Code, Social & Ship',
    default: 'build',
    tabs: [
      { id: 'build', label: 'Code Generators' },
      { id: 'social', label: 'Social Posts' },
      { id: 'ship', label: 'Pre-Launch & Ship' },
      { id: 'brand', label: 'Brand Voice' },
    ],
  },
  settings: {
    label: 'Settings',
    tag: 'Keys & Team RBAC',
    default: 'settings',
    tabs: [
      { id: 'settings', label: 'Keys & Integrations' },
      { id: 'team', label: 'Team & RBAC' },
      { id: 'monitors', label: 'Monitoring' },
      { id: 'people', label: 'People & Tasks' },
      { id: 'health', label: 'System Health' },
    ],
  },
};

window.SECTIONS = SECTIONS;
window.SECTION_MAP = SECTION_MAP;

function renderSubnav(secKey, activePanel) {
  const host = $('#subnavTabs');
  if (!host) return;
  const sec = SECTIONS[secKey];
  if (!sec) return;

  const activeTab = sec.tabs.find((t) => t.id === activePanel) || sec.tabs[0];

  host.innerHTML = sec.tabs.map((t) => `
    <button class="subnav-tab ${t.id === activePanel ? 'active' : ''}" data-panel="${t.id}" role="tab" aria-selected="${t.id === activePanel}">
      ${t.label}
    </button>
  `).join('');

  $$('.subnav-tab', host).forEach((btn) => {
    btn.addEventListener('click', () => {
      showPanel(btn.dataset.panel);
    });
  });

  const bSec = $('#tbcSection');
  const bPage = $('#tbcPage');
  if (bSec) bSec.textContent = sec.label;
  if (bPage) bPage.textContent = activeTab ? activeTab.label : '';
}

function showPanel(name, opts = {}) {
  if (name === 'setup') name = 'settings';
  state.panel = name;
  const secKey = SECTION_MAP[name] || 'diagnosis';
  state.section = secKey;

  $$('.panel').forEach((p) => { p.hidden = p.id !== `p-${name}`; });
  $$('.navitem[data-section]').forEach((x) => x.setAttribute('aria-current', String(x.dataset.section === secKey)));
  $$('.navitem[data-panel]').forEach((x) => x.setAttribute('aria-current', String(x.dataset.panel === name)));
  $$('.rung').forEach((x) => x.setAttribute('aria-current', String(name === 'ladder' && x.dataset.phase === state.phase)));
  if (name !== 'ladder') $$('.rung').forEach((x) => x.setAttribute('aria-current', 'false'));

  renderSubnav(secKey, name);

  $('#rail')?.classList.remove('open');
  $('#railToggle')?.setAttribute('aria-expanded', 'false');
  if (!opts.keepScroll) $('#work')?.scrollTo?.(0, 0), window.scrollTo(0, 0);

  if (name === 'console') gscStatus();
  if (name === 'ship') loadSnapshots();
  if (name === 'build') {
    const curTool = document.querySelector('#buildTools .chip[aria-pressed="true"]')?.dataset.build || 'titles';
    renderBuild(curTool);
  }
  if (name === 'overview') renderOverview();
  if (name === 'pages') renderPages();
  if (name === 'ladder') renderLadderPanel();

  /* Feature panels register their own hooks (see suite.js). Guarded because
     suite.js loads after this file. */
  if (typeof runPanelHooks === 'function') runPanelHooks(name);
}
window.showPanel = showPanel;

/* Nav binding lives in bindNav() in suite.js so it happens exactly once,
   after every panel hook is registered. */

$('#railToggle')?.addEventListener('click', () => {
  const open = $('#rail')?.classList.toggle('open');
  $('#railToggle')?.setAttribute('aria-expanded', String(!!open));
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { $('#rail')?.classList.remove('open'); closePropMenu(); }
});

/* The rungs are the priority ladder: a real diagnostic sequence, so they carry
   numbers, and clicking one filters the ledger to that stage. */
function buildLadderNav() {
  const nav = $('#ladderNav');
  if (!nav) return;
  nav.innerHTML = LADDER.map((r, i) => `
    <button class="rung" data-phase="${r.key}" aria-current="false">
      <span class="rn">${i + 1}</span>
      <span class="rl">${r.label}</span>
      <span class="rc zero" data-c="${r.key}">—</span>
    </button>`).join('');
  $$('.rung').forEach((b) => b.addEventListener('click', () => {
    state.phase = b.dataset.phase;
    state.filter = 'all'; state.owner = null;
    showPanel('ladder');
    renderLadderPanel();
  }));
}

function updateLadderCounts() {
  const byPhase = {};
  state.findings.forEach((f) => {
    (byPhase[f.phase] ||= []).push(f);
  });
  LADDER.forEach((r) => {
    const el = $(`.rc[data-c="${r.key}"]`);
    if (!el) return;
    const list = byPhase[r.key] || [];
    const crit = list.filter((f) => f.severity === 'Critical').length;
    const high = list.filter((f) => f.severity === 'High').length;
    const med = list.filter((f) => f.severity === 'Medium').length;
    const unchecked = !list.length && !CRAWL_COVERS.has(r.key);
    el.textContent = !state.findings.length ? '—' : unchecked ? '?' : String(list.length);
    el.title = unchecked ? `Not checked — ${UNCHECKED_WHY[r.key]}` : '';
    el.className = `rc ${crit ? 'crit' : high ? 'high' : med ? 'med' : 'zero'}`;
    el.closest('.rung')?.classList.toggle('clear', !!state.findings.length && !list.length);
    const gateAt = LADDER.findIndex((x) => (byPhase[x.key] || []).some((f) => f.severity === 'Critical' || f.severity === 'High'));
    el.closest('.rung')?.classList.toggle('blocked', gateAt >= 0 && LADDER.indexOf(r) > gateAt);
  });
  if ($('#nPages')) $('#nPages').textContent = state.pages.length || 0;
  if ($('#badgeDiagnosis')) $('#badgeDiagnosis').textContent = String(state.findings.length || 0);
}

/* ── property switcher ────────────────────────────────────────────────────── */

const closePropMenu = () => { $('#propMenu').hidden = true; $('#propBtn').setAttribute('aria-expanded', 'false'); };

const togglePropMenu = (e) => {
  e.stopPropagation();
  const open = $('#propMenu').hidden;
  $('#propMenu').hidden = !open;
  $('#propBtn').setAttribute('aria-expanded', String(!open));
};

$('#propBtn').addEventListener('click', togglePropMenu);
const rsc = $('#railScopeCard');
if (rsc) {
  rsc.addEventListener('click', togglePropMenu);
  rsc.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); togglePropMenu(e); }
  });
}
const tbs = $('#topbarSearch');
if (tbs) {
  tbs.addEventListener('click', () => {
    if (typeof window.cmdkOpen === 'function') window.cmdkOpen();
    else if (typeof cmdkOpen === 'function') cmdkOpen();
  });
}

// Wire Documentation button & modal
const btnDocs = $('#btnRailDocs');
if (btnDocs) {
  btnDocs.addEventListener('click', () => {
    const dlg = $('#docsModal');
    if (dlg) {
      if (typeof dlg.showModal === 'function') dlg.showModal();
      else dlg.hidden = false;
    }
  });
}
$('#docsModalClose')?.addEventListener('click', () => {
  const dlg = $('#docsModal');
  if (dlg) {
    if (typeof dlg.close === 'function') dlg.close();
    else dlg.hidden = true;
  }
});
$('#docsModal')?.addEventListener('click', (e) => {
  if (e.target.id === 'docsModal') {
    if (typeof e.target.close === 'function') e.target.close();
    else e.target.hidden = true;
  }
});
$('#btnDocsOpenLanding')?.addEventListener('click', () => {
  const dlg = $('#docsModal');
  if (dlg && typeof dlg.close === 'function') dlg.close();
  if (typeof showLanding === 'function') showLanding();
});

// Wire Diagnostics button & Status button
const openDiagnostics = () => {
  showPanel('health');
  if (typeof renderHealth2 === 'function') renderHealth2();
};
$('#btnRailDiagnostics')?.addEventListener('click', openDiagnostics);
$('#tbStatusBtn')?.addEventListener('click', openDiagnostics);

// Wire Notifications button & popover
function renderNotifications() {
  const list = $('#notifyList');
  if (!list) return;
  const badge = $('#tbNotifyBadge');
  const domain = (state.origin ? state.origin.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '') : 'Workspace');
  const items = [];
  
  if (state.pages && state.pages.length > 0) {
    items.push({
      type: state.truncated ? 'warn' : 'pass',
      title: state.truncated ? `Crawl limit reached for ${esc(domain)}` : `Crawl completed for ${esc(domain)}`,
      detail: `${num(state.pages.length)} pages audited · ${state.stats?.indexable || 0} indexable`,
      time: state.crawledAt ? ago(state.crawledAt) : 'recently',
    });
  }
  const crit = state.findings ? state.findings.filter((f) => f.severity === 'Critical') : [];
  const high = state.findings ? state.findings.filter((f) => f.severity === 'High') : [];
  if (crit.length > 0) {
    items.push({
      type: 'fault',
      title: `${crit.length} Critical blocker${crit.length > 1 ? 's' : ''} detected`,
      detail: crit.slice(0, 2).map((f) => f.title).join(', '),
      time: 'now',
    });
  } else if (high.length > 0) {
    items.push({
      type: 'warn',
      title: `${high.length} High severity issue${high.length > 1 ? 's' : ''}`,
      detail: high.slice(0, 2).map((f) => f.title).join(', '),
      time: 'now',
    });
  }
  if (!items.length) {
    items.push({
      type: 'note',
      title: 'Ready for live audit',
      detail: 'No warnings or regressions detected. Start a new crawl anytime.',
      time: 'system',
    });
  }
  if (badge) {
    if (window._clearedNotifications || !items.some(i => i.type === 'fault' || i.type === 'warn')) {
      badge.style.display = 'none';
    } else {
      badge.style.display = 'block';
    }
  }
  list.innerHTML = items.map((it) => `
    <div class="notify-item ${it.type}">
      <div class="ni-indicator"></div>
      <div class="ni-content">
        <div class="ni-title">${it.title}</div>
        <div class="ni-detail">${it.detail}</div>
      </div>
      <div class="ni-time">${it.time}</div>
    </div>
  `).join('');
}

const toggleNotify = (e) => {
  e?.stopPropagation();
  const pop = $('#notifyPopover');
  if (!pop) return;
  const isHidden = pop.hidden;
  pop.hidden = !isHidden;
  if (isHidden) renderNotifications();
};
$('#tbNotifyBtn')?.addEventListener('click', toggleNotify);
$('#btnNotifyClear')?.addEventListener('click', (e) => {
  e.stopPropagation();
  window._clearedNotifications = true;
  if ($('#tbNotifyBadge')) $('#tbNotifyBadge').style.display = 'none';
  renderNotifications();
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('#notifyPopover') && !e.target.closest('#tbNotifyBtn')) {
    if ($('#notifyPopover')) $('#notifyPopover').hidden = true;
  }
});

document.addEventListener('click', (e) => { if (!e.target.closest('#propWrap') && !e.target.closest('#railScopeCard')) closePropMenu(); });

async function loadProperties() {
  try {
    const d = await api('/api/properties');
    state.properties = d.properties || [];
    state.activeId = d.activeId;
    renderPropMenu();
    const active = state.properties.find((p) => p.id === d.activeId);
    if (active && (d.loadedId !== active.id || !state.pages?.length)) await activateProperty(active.id, { quiet: true });
    else if (active) setPropLabel(active);
  } catch { /* first run, nothing registered */ }
}

function setPropLabel(p) {
  if ($('#propName')) $('#propName').textContent = p ? p.label : 'No property yet';
  if ($('#propMeta')) $('#propMeta').textContent = p
    ? `${num(p.pages || 0)} pages · ${p.counts?.Critical ? `${p.counts.Critical} critical` : 'no critical findings'}`
    : 'Crawl a site to begin';
  if ($('#freshness')) {
    $('#freshness').textContent = p?.lastCrawledAt ? `crawled ${ago(p.lastCrawledAt)}` : '';
    $('#freshness').classList.toggle('stale', p?.lastCrawledAt ? (Date.now() - new Date(p.lastCrawledAt)) > 6048e5 : false);
  }

  // Update rail scope card & topbar site badge to match inspiration layout
  const cleanLabel = p ? p.label.replace(/^https?:\/\//, '').replace(/\/$/, '') : (state.origin ? state.origin.replace(/^https?:\/\//, '').replace(/\/$/, '') : 'SEO Workbench');
  if ($('#railScopeName')) $('#railScopeName').textContent = cleanLabel;
  if ($('#railScopeMeta')) {
    $('#railScopeMeta').textContent = p
      ? `${num(p.pages || 0)} pages · ${p.counts?.Critical ? `${p.counts.Critical} crit` : 'healthy'}`
      : 'Active workspace';
  }
  if ($('#tsbAvatar')) {
    $('#tsbAvatar').textContent = cleanLabel ? cleanLabel[0].toUpperCase() : 'S';
  }
  if ($('#tbcSection')) {
    $('#tbcSection').textContent = cleanLabel;
  }
}

function renderPropMenu() {
  const items = state.properties.map((p) => `
    <button class="propopt" role="option" data-id="${esc(p.id)}" aria-selected="${p.id === state.activeId}">
      <span class="po-name">${esc(p.label)}<small class="po-sub">${p.lastCrawledAt ? `crawled ${ago(p.lastCrawledAt)}` : 'never crawled'}</small></span>
      <span class="po-c ${p.counts?.Critical ? 'crit' : ''}">${p.counts ? (p.counts.Critical || 0) + (p.counts.High || 0) : 0}</span>
      <span class="po-del" role="button" tabindex="0" data-del="${esc(p.id)}" title="Remove from portal">×</span>
    </button>`).join('');
  $('#propMenu').innerHTML = (items || '<div style="padding:10px;font-family:var(--mono);font-size:11px;color:var(--shell-txt2)">Nothing here yet</div>')
    + '<div class="divider"></div><button class="addnew" id="addProp">Crawl a new site</button>';

  $$('#propMenu .propopt').forEach((b) => b.addEventListener('click', (e) => {
    if (e.target.dataset.del) return;
    closePropMenu();
    activateProperty(b.dataset.id);
  }));
  $$('#propMenu [data-del]').forEach((x) => x.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (window.can && !window.can('settings:write')) {
      alert('Access Denied: Your account role does not have permission to delete properties. Admin or Owner role required.');
      return;
    }
    const p = state.properties.find((q) => q.id === x.dataset.del);
    if (!confirm(`Remove ${p?.label} from the portal? The saved crawl goes with it.`)) return;
    await fetch(`/api/properties/${x.dataset.del}`, { method: 'DELETE' });
    if (state.activeId === x.dataset.del) { state.findings = []; state.pages = []; }
    await loadProperties();
    updateLadderCounts(); renderOverview();
  }));
  $('#addProp').addEventListener('click', () => { closePropMenu(); showPanel('crawl'); $('#crawlUrl').focus(); });
}

async function activateProperty(id, opts = {}) {
  try {
    const d = await api('/api/properties/activate', { body: { id } });
    state.activeId = id;
    setPropLabel(d.property);
    if (d.restored) {
      state.pages = d.pages || []; state.findings = d.findings || [];
      state.stats = d.stats; state.counts = d.counts || {}; state.topThree = d.topThree || [];
      state.origin = d.origin; state.crawledAt = d.crawledAt;
      state.truncated = d.truncated || false; state.remainingQueue = d.remainingQueue || 0;
      state.timeExceeded = d.timeExceeded || false; state.timeElapsedMs = d.timeElapsedMs || 0;
      renderPages();
    }
    renderPropMenu(); updateLadderCounts();
    if (!opts.quiet) showPanel('overview'); else renderOverview();
  } catch (e) { if (!opts.quiet) alert(e.message); }
}

const ago = (iso) => {
  const mins = Math.round((Date.now() - new Date(iso)) / 6e4);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d < 30 ? `${d}d ago` : `${Math.round(d / 30)}mo ago`;
};

$('#runCrawlTop').addEventListener('click', () => {
  if ($('#crawlUrl').value.trim()) return void $('#runCrawl').click();
  showPanel('crawl'); $('#crawlUrl').focus();
});

$$('button.go').forEach((b) => { b.dataset.label = b.textContent; });

/* ═══════════════════════════════ AUDIT ═══════════════════════════════ */

$('#runCrawl').addEventListener('click', async () => {
  const url = $('#crawlUrl').value.trim();
  if (!url) return msg('#crawlMsg', 'Enter a start URL.', 'err');
  const btn = $('#runCrawl');
  busy(btn, true, 'Crawling…');
  msg('#crawlMsg', '');

  const poll = setInterval(async () => {
    try {
      const { progress } = await api('/api/progress');
      if (!progress) return;
      const pctDone = Math.round((progress.done / Math.max(1, progress.max)) * 100);
      $('#crawlProgress').innerHTML = `<div class="progress">${progress.done} of up to ${progress.max} — ${esc(short(progress.url, 70))}
        <div class="track"><i style="width:${pctDone}%"></i></div></div>`;
    } catch {}
  }, 500);

  try {
    const data = await api('/api/crawl', {
      body: {
        url, maxPages: Number($('#maxPages')?.value) || 1000, ua: $('#ua').value,
        respectRobots: $('#respectRobots').checked, render: $('#renderJs')?.checked || false, includeSubdomains: $('#includeSubdomains').checked,
        moneyUrls: $('#moneyUrls').value.split('\n').map((s) => s.trim()).filter(Boolean),
      },
    });
    state.pages = data.pages; state.findings = data.findings;
    state.stats = data.stats; state.counts = data.counts; state.topThree = data.topThree;
    state.origin = new URL(url).origin;
    state.crawledAt = new Date().toISOString();
    state.truncated = data.truncated; state.remainingQueue = data.remainingQueue;
    state.timeExceeded = data.timeExceeded; state.timeElapsedMs = data.timeElapsedMs;
    state.phase = null;
    renderPages();
    updateLadderCounts();
    await loadProperties();
    showPanel('overview');
    renderNotifications();
    if (data.timeExceeded) {
      const elapsedSec = (data.timeElapsedMs / 1000).toFixed(1);
      msg('#crawlMsg', `⚡ Fast Serverless Crawl: Audited ${data.pages.length} pages in ${elapsedSec}s to prevent timeout. Full scorecard and ladder diagnostics are ready.`, 'ok');
    }
  } catch (e) {
    msg('#crawlMsg', e.message, 'err');
  } finally {
    clearInterval(poll);
    $('#crawlProgress').innerHTML = '';
    busy(btn, false);
  }
});


/* One rung of the ladder, or the whole ledger when no rung is selected. */
function renderLadderPanel() {
  const inPhase = state.phase ? state.findings.filter((f) => f.phase === state.phase) : state.findings;
  const rung = LADDER.find((r) => r.key === state.phase);
  const i = LADDER.indexOf(rung);
  const c = {};
  inPhase.forEach((f) => { c[f.severity] = (c[f.severity] || 0) + 1; });

  $('#ladderOut').innerHTML = `
    <h2 class="sec">${rung ? `${i + 1}. ${esc(rung.label)}` : `All findings`}</h2>
    <p class="lede">${rung ? esc(RUNG_WHY[rung.key]) : 'Every finding, ordered by the ladder. Pick a stage on the left to narrow it.'}</p>
    ${!inPhase.length ? `<div class="empty">${!state.findings.length ? 'Run a crawl first.'
      : rung && !CRAWL_COVERS.has(rung.key) ? `Not checked — this stage ${esc(UNCHECKED_WHY[rung.key])}.`
      : 'Nothing found at this stage.'}</div>` : `
    <div class="chipset" id="sevFilter">
      ${['all', 'Critical', 'High', 'Medium', 'Low'].map((k) =>
        `<button class="chip" data-sev="${k}" aria-pressed="${k === state.filter}">${k === 'all' ? `All ${inPhase.length}` : `${k} ${c[k] || 0}`}</button>`).join('')}
      ${['dev', 'content', 'SEO'].map((o) =>
        `<button class="chip" data-owner="${o}" aria-pressed="${state.owner === o}">${o}</button>`).join('')}
    </div>
    <div id="findingList"></div>`}`;

  if (!inPhase.length) return;
  renderFindings();
  $$('#sevFilter .chip').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.owner) {
      const on = b.getAttribute('aria-pressed') === 'true';
      $$('#sevFilter .chip[data-owner]').forEach((x) => x.setAttribute('aria-pressed', 'false'));
      b.setAttribute('aria-pressed', String(!on));
      state.owner = on ? null : b.dataset.owner;
    } else {
      $$('#sevFilter .chip[data-sev]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      state.filter = b.dataset.sev;
    }
    renderFindings();
  }));
}

/* Rungs a crawl can actually assess. The rest are shown as unchecked rather
   than clear: a stage nobody looked at is not a stage that passed. */
const CRAWL_COVERS = new Set(['eligibility', 'indexation', 'onpage', 'linking', 'schema']);
const UNCHECKED_WHY = {
  intent: 'needs a live SERP read',
  performance: 'run a PageSpeed test',
  offpage: 'assessed by hand',
};

const RUNG_WHY = {
  eligibility: 'Can Google fetch and render this at all? Everything below is wasted if the answer is no.',
  indexation: 'Is the right URL the one being indexed? Canonicals, duplicates, and what Google actually chose.',
  intent: 'Does the page match what the searcher wanted? No amount of on-page work fixes a format mismatch.',
  onpage: 'Titles, headings, and whether the content answers the question it targets.',
  linking: 'How discoverable is the page from the rest of the site, and what do the links say about it?',
  schema: 'Structured data that earns rich results — worth real clicks, but never a substitute for the rungs above.',
  performance: 'Real user value and a small ranking tiebreaker. Never the answer to "why doesn\'t this rank".',
  offpage: 'Authority and local signals. Mostly not a code change, which is why it sits last.',
};

/* Ticket text in the canon's shape, with acceptance criteria appended —
   a recommendation nobody can accept never ships. */
function ticketText(f) {
  return [
    `[${f.severity}] ${f.title}`,
    '',
    `Where:  ${f.where}`,
    `What:   ${f.what}`,
    `Why:    ${f.why}`,
    `Fix:    ${f.fix}`,
    `Owner:  ${f.owner}    Effort: ${f.effort}    Stage: ${f.phase}`,
    f.evidence ? `Evidence: ${f.evidence}` : '',
    '',
    'Acceptance criteria',
    `- The condition described above no longer holds on the affected URLs`,
    `- Verified by re-crawling in SEO Workbench and confirming this finding is gone`,
    f.urls?.length ? `\nAffected URLs (${f.urls.length}):\n${f.urls.slice(0, 25).join('\n')}${f.urls.length > 25 ? `\n… and ${f.urls.length - 25} more` : ''}` : '',
  ].filter(Boolean).join('\n');
}

function renderFindings() {
  const scope = state.phase ? state.findings.filter((f) => f.phase === state.phase) : state.findings;
  const list = scope.filter((f) =>
    (state.filter === 'all' || f.severity === state.filter) &&
    (!state.owner || f.owner === state.owner));
  if (!list.length) return void ($('#findingList').innerHTML = '<div class="empty">Nothing matches that filter.</div>');

  $('#findingList').innerHTML = list.map((f, i) => `
    <article class="finding ${f.severity}">
      <div class="fhead" data-i="${i}">
        <span class="sev ${f.severity}">${f.severity}</span>
        <span class="ftitle">${esc(f.title)}</span>
        <span class="fmeta">${f.owner} · ${f.effort} · ${f.phase}</span>
      </div>
      <div class="fbody" hidden>
        <dl>
          <dt>Where</dt><dd><pre>${esc(f.where)}</pre></dd>
          <dt>What</dt><dd>${esc(f.what)}</dd>
          <dt>Why</dt><dd>${esc(f.why)}</dd>
          <dt>Fix</dt><dd class="fix">${esc(f.fix)}</dd>
        </dl>
        ${f.urls?.length ? `<details class="urls"><summary>${f.urls.length} affected URL${f.urls.length > 1 ? 's' : ''}</summary><ul>${f.urls.map((u) => `<li>${esc(u)}</li>`).join('')}</ul></details>` : ''}
        <div class="copybar">
          <button class="assign" data-assign="${esc(f.id || f.title)}">assign</button>
          <button class="go ghost tiny" data-aifix="${esc(f.id || f.title)}">Fix this</button>
          <button class="go ghost tiny" data-aifix="${esc(f.id || f.title)}" data-preferai="1">Improve with AI</button>
          <button class="go ghost tiny copy" data-clip="${CLIP.push(ticketText(f)) - 1}">Copy as ticket</button>
        </div>
        <div class="aifixout"></div>
      </div>
    </article>`).join('');

  $$('#findingList .fhead').forEach((h) => h.addEventListener('click', () => {
    const b = h.nextElementSibling;
    b.hidden = !b.hidden;
  }));
  wireCopy();
}

/* ═══════════════════════════════ PAGES ═══════════════════════════════ */

const PAGE_FILTERS = {
  all: () => true,
  errors: (p) => p.status >= 400 || p.status === 0,
  redirects: (p) => p.hops > 0,
  noindex: (p) => p.noindex,
  orphans: (p) => p.discoveredVia === 'sitemap' || p.inboundCount === 0,
  'no h1': (p) => !p.h1s?.length,
  'thin': (p) => p.wordCount < 250 && p.status === 200,
  'no schema': (p) => p.status === 200 && !p.schemaTypes?.length,
};

function renderPages() {
  $('#pageFilters').innerHTML = Object.keys(PAGE_FILTERS).map((k) =>
    `<button class="chip" data-pf="${k}" aria-pressed="${k === 'all'}">${k}${k === 'all' ? ` ${state.pages.length}` : ` ${state.pages.filter(PAGE_FILTERS[k]).length}`}</button>`).join('');
  $$('#pageFilters .chip').forEach((b) => b.addEventListener('click', () => {
    $$('#pageFilters .chip').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    drawPageTable(b.dataset.pf);
  }));
  drawPageTable('all');
}

function drawPageTable(key) {
  const rows = state.pages.filter(PAGE_FILTERS[key]);
  if (!rows.length) return void ($('#pagesOut').innerHTML = '<div class="empty">No pages match.</div>');
  $('#pagesOut').innerHTML = `<div class="tbl-wrap"><table>
    <thead><tr><th>URL</th><th>Status</th><th>Depth</th><th>Title</th><th>H1</th><th class="num">Words</th><th class="num">In</th><th>Flags</th><th></th></tr></thead>
    <tbody>${rows.map((p) => `<tr>
      <td class="u">${esc(short(p.url, 52))}</td>
      <td><span class="pill ${p.status === 200 ? 'ok' : p.status >= 400 || !p.status ? 'bad' : 'mid'}">${p.status || p.error || '—'}${p.hops ? ` ·${p.hops}` : ''}</span></td>
      <td class="num">${p.depth ?? '—'}</td>
      <td class="u">${esc(short(p.title || '—', 40))}</td>
      <td class="u">${esc(short(p.h1s?.[0] || '—', 32))}${p.h1s?.length > 1 ? ` <span class="pill mid">×${p.h1s.length}</span>` : ''}</td>
      <td class="num">${p.wordCount ?? '—'}</td>
      <td class="num">${p.inboundCount ?? 0}${p.inboundBodyCount === 0 && p.inboundCount > 0 ? '<span class="pill mid">nav</span>' : ''}</td>
      <td>${[p.noindex ? '<span class="pill bad">noindex</span>' : '',
            p.canonical && !p.selfCanonical ? '<span class="pill mid">canon→</span>' : '',
            p.jsonldErrors?.length ? '<span class="pill bad">ld+json</span>' : '',
            p.imagesMissingAlt ? `<span class="pill">alt ${p.imagesMissingAlt}</span>` : '',
            p.discoveredVia === 'sitemap' ? '<span class="pill mid">orphan</span>' : ''].join(' ')}</td>
      <td><span class="lnk" data-review="${esc(p.url)}">review</span></td>
    </tr>`).join('')}</tbody></table></div>`;

  $$('[data-review]').forEach((el) => el.addEventListener('click', () => reviewPage(el.dataset.review)));
}

async function reviewPage(url) {
  $('#reviewOut').innerHTML = '<div class="progress">Reviewing…</div>';
  try {
    const { review } = await api('/api/page/review', {
      body: { url, withPsi: true, withInspection: !!state.gscSite, siteUrl: state.gscSite },
    });
    const insp = review.inspection;
    $('#reviewOut').innerHTML = `
      <h3 class="sub">Single-page review — ${esc(short(url, 64))}</h3>
      <div class="headline">
        <p class="k">Highest-impact change</p>
        <h4>${esc(review.headline.question)}</h4>
        <p>${esc(review.headline.detail)}</p>
      </div>
      ${review.steps.map((s) => `<div class="step">
        <span class="idx">${s.n}</span>
        <span class="vd ${s.verdict}">${s.verdict}</span>
        <div><q>${esc(s.question)}</q><small>${esc(s.detail)}</small></div>
      </div>`).join('')}
      ${insp && !insp.error ? `<h3 class="sub">What Google says</h3>
        <div class="stats">
          <div class="stat"><b style="font-size:1rem">${esc(insp.verdict || '—')}</b><span>verdict</span></div>
          <div class="stat"><b style="font-size:1rem">${esc(insp.coverageState || '—')}</b><span>coverage</span></div>
          <div class="stat ${insp.canonicalMatch === false ? 'warn' : ''}"><b style="font-size:1rem">${insp.canonicalMatch === false ? 'differs' : 'matches'}</b><span>google canonical</span></div>
          <div class="stat"><b style="font-size:1rem">${insp.lastCrawlTime ? new Date(insp.lastCrawlTime).toISOString().slice(0, 10) : '—'}</b><span>last crawled</span></div>
        </div>
        ${insp.canonicalMatch === false ? `<p class="note">Google chose <b>${esc(insp.googleCanonical)}</b>; you declared <b>${esc(insp.userCanonical)}</b>. rel=canonical is a hint, and it is routinely overridden — this is the check the crawl alone cannot make.</p>` : ''}` : ''}
      ${review.psi?.ok ? renderPsi(review.psi, true) : ''}`;
    $('#reviewOut').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    $('#reviewOut').innerHTML = `<div class="msg err">${esc(e.message)}</div>`;
  }
}

/* ═══════════════════════════════ DEMAND ══════════════════════════════ */

$('#runExpand').addEventListener('click', async () => {
  const seed = $('#seed').value.trim();
  if (!seed) return;
  const btn = $('#runExpand');
  busy(btn, true, 'Expanding…');
  try {
    const d = await api('/api/keywords/expand', { body: { seed, gl: $('#gl').value } });
    state.keywords = d.keywords; state.clusters = d.clusters;
    const intents = ['transactional', 'commercial', 'informational', 'navigational', 'unclear'];
    $('#demandOut').innerHTML = `
      <div class="stats">
        <div class="stat"><b>${d.count}</b><span>candidates</span></div>
        <div class="stat"><b>${d.clusters.length}</b><span>clusters</span></div>
        ${intents.slice(0, 3).map((i) => `<div class="stat"><b>${d.keywords.filter((k) => k.intent === i).length}</b><span>${i}</span></div>`).join('')}
      </div>
      <div class="copybar">
        <button class="go ghost tiny" id="mapClusters">Map clusters to pages</button>
        <button class="go ghost tiny" id="copyKw">Copy all keywords</button>
      </div>
      <h3 class="sub">Clusters</h3>
      <p class="note">${esc(d.clusters[0]?.confidence || '')}</p>
      <div class="tbl-wrap"><table><thead><tr><th>Cluster</th><th class="num">Size</th><th>Intent</th><th>Members</th><th></th></tr></thead><tbody>
        ${d.clusters.slice(0, 40).map((c) => `<tr>
          <td class="u"><b>${esc(c.label)}</b></td>
          <td class="num">${c.size}</td>
          <td><span class="pill ${c.dominantIntent === 'transactional' ? 'ok' : c.intentMixed ? 'mid' : ''}">${c.dominantIntent}${c.intentMixed ? ' mixed' : ''}</span></td>
          <td class="u">${esc(c.members.slice(0, 4).map((m) => m.keyword).join(', '))}${c.size > 4 ? ` +${c.size - 4}` : ''}</td>
          <td><span class="lnk" data-brief="${esc(c.label)}" data-intent="${c.dominantIntent}">brief</span></td>
        </tr>`).join('')}
      </tbody></table></div>
      <div id="mapOut"></div><div id="briefOut"></div>`;

    $('#copyKw').addEventListener('click', () => copy(d.keywords.map((k) => k.keyword).join('\n')));
    $('#mapClusters').addEventListener('click', mapClusters);
    $$('[data-brief]').forEach((el) => el.addEventListener('click', () => makeBrief(el.dataset.brief, el.dataset.intent)));
  } catch (e) {
    $('#demandOut').innerHTML = `<div class="msg err">${esc(e.message)}</div>`;
  } finally { busy(btn, false); }
});

async function mapClusters() {
  $('#mapOut').innerHTML = '<div class="progress">Matching clusters against crawled pages…</div>';
  try {
    const d = await api('/api/keywords/map', { body: { clusters: state.clusters } });
    $('#mapOut').innerHTML = `
      <h3 class="sub">Keyword-to-URL map</h3>
      <div class="stats">
        <div class="stat good"><b>${d.mapped.length}</b><span>mapped</span></div>
        <div class="stat warn"><b>${d.gaps.length}</b><span>gaps — no page</span></div>
        <div class="stat warn"><b>${d.contested.length}</b><span>contested — two pages</span></div>
      </div>
      <p class="note">${esc(d.note)}</p>
      <div class="tbl-wrap"><table><thead><tr><th>Cluster</th><th>Status</th><th>Intent</th><th>Best match</th><th class="num">Fit</th></tr></thead><tbody>
        ${d.map.map((r) => `<tr>
          <td class="u">${esc(r.cluster)}</td>
          <td><span class="pill ${r.status === 'gap' ? 'bad' : r.status === 'contested' ? 'mid' : 'ok'}">${r.status}</span></td>
          <td>${r.intent}</td>
          <td class="u">${r.matches.length ? esc(short(r.matches[0].url, 44)) : '—'}${r.status === 'contested' ? `<br><span style="color:var(--rose)">vs ${esc(short(r.matches[1].url, 40))}</span>` : ''}</td>
          <td class="num">${r.matches[0]?.score ?? '—'}</td>
        </tr>`).join('')}
      </tbody></table></div>`;
  } catch (e) { $('#mapOut').innerHTML = `<div class="msg err">${esc(e.message)}</div>`; }
}

async function makeBrief(clusterLabel, intent, targetId = 'briefOut') {
  const tgt = $('#' + targetId);
  if (!tgt) return;
  tgt.innerHTML = '<div class="progress">Building brief…</div>';
  try {
    const { brief } = await api('/api/generate/brief', { body: { clusterLabel, intent } });
    const briefText = [
      `Title:  ${brief.title}`,
      `H1:     ${brief.h1}`,
      `Intent: ${brief.intent}`,
      `Target: ${brief.targetUrl}`,
      '',
      'SECTIONS',
      brief.sections.map((x, i) => `${String(i + 1).padStart(2)}. ${x.h2}\n    ${x.note}`).join('\n'),
      '',
      `INTERNAL LINKS\n    ${brief.internalLinks}`,
      '',
      `E-E-A-T\n    ${brief.eeat}`,
      '',
      `SCHEMA\n    ${brief.schema}`,
      '',
      `DO NOT MEASURE\n    ${brief.doNotMeasure}`,
    ].join('\n');
    tgt.innerHTML = `<h3 class="sub">Content brief — ${esc(brief.cluster)}</h3>
      <div class="headline"><p class="k">Before you write</p><p>${esc(brief.serpCheck)}</p></div>
      <div class="out">${esc(briefText)}</div>
      ${copyBar(briefText, 'Copy brief')}`;
    wireCopy();
  } catch (e) { tgt.innerHTML = `<div class="msg err">${esc(e.message)}</div>`; }
}

/* ═══════════════════════════ SEARCH CONSOLE ══════════════════════════ */

async function gscStatus() {
  const s = await api('/api/gsc/status');
  window._gscStatus = s;
  window._gscConnected = !!s.connected;
  $('#dotGsc')?.classList.toggle('on', s.connected);

  // Synchronize topbar Search Console indicator
  const tbPill = $('#tbGscPill');
  const pillText = $('#gscPillText');
  const pillDot = $('#gscPillDot');
  if (tbPill) {
    if (s.connected) {
      tbPill.className = 'tb-gsc-pill connected';
      if (pillDot) pillDot.className = 'gsc-pill-dot on';
      if (pillText) pillText.textContent = state.gscSite ? `GSC: ${state.gscSite.replace(/^https?:\/\//, '').replace(/\/$/, '')}` : 'GSC: Connected';
    } else {
      tbPill.className = 'tb-gsc-pill disconnected';
      if (pillDot) pillDot.className = 'gsc-pill-dot';
      if (pillText) pillText.textContent = state.gscImport ? 'GSC: CSV Active' : 'GSC: Connect API';
    }
    tbPill.onclick = () => showPanel('console');
  }

  if (!s.configured) {
    const cbUri = `${window.location.origin}/api/gsc/callback`;
    $('#gscAuth').innerHTML = `
      <div class="dash-gsc-card" style="margin-bottom:16px;">
        <div class="dash-gsc-hd">
          <div class="dash-gsc-title-wrap">
            <div class="gsc-icon-badge">
              <svg class="i" viewBox="0 0 24 24"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg>
            </div>
            <div>
              <h4 class="dash-gsc-title">Google Search Console Integration</h4>
              <p class="dash-gsc-sub">Direct API OAuth connection or instant drag-and-drop CSV analysis</p>
            </div>
          </div>
          <span class="gsc-status-pill disconnected">&bull; OAuth Not Configured</span>
        </div>
        <div style="font-size:12.5px;color:var(--ink2);line-height:1.55;margin-bottom:14px;">
          Create an OAuth client (Web application) in Google Cloud Console, enable the Search Console API, and set redirect URI to <code>${cbUri}</code>. Add <code>GSC_CLIENT_ID</code> and <code>GSC_CLIENT_SECRET</code> to your settings.
        </div>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
          <button class="go sm" id="btnGscConfigureSettings">⚙️ Configure OAuth Client Keys</button>
          <label class="go ghost sm" for="gscFiles" style="cursor:pointer;">📂 Import CSV Export (No Cloud Project Needed)</label>
        </div>
      </div>`;
    $('#btnGscConfigureSettings')?.addEventListener('click', () => {
      showPanel('settings');
      $('#setGscClientId')?.focus();
    });
    return;
  }
  if (!s.connected) {
    $('#gscAuth').innerHTML = `
      <div class="dash-gsc-card" style="margin-bottom:16px;">
        <div class="dash-gsc-hd">
          <div class="dash-gsc-title-wrap">
            <div class="gsc-icon-badge">
              <svg class="i" viewBox="0 0 24 24"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg>
            </div>
            <div>
              <h4 class="dash-gsc-title">Connect Google Search Console</h4>
              <p class="dash-gsc-sub">OAuth configured &bull; Authenticate with 1 click</p>
            </div>
          </div>
          <span class="gsc-status-pill disconnected">&bull; Ready to Connect</span>
        </div>
        <div class="form" style="margin-top:12px;">
          <button class="go" id="gscConnect">⚡ Connect with Google</button>
        </div>
      </div>`;
    $('#gscConnect').addEventListener('click', () => {
      const win = window.open(s.authUrl, '_blank', 'width=520,height=680');
      if (!win) {
        msg('#gscAuth', 'Popup was blocked by your browser. Please allow popups to sign in.', 'err');
      }
      const t = setInterval(async () => {
        const st = await api('/api/gsc/status');
        if (st.connected) {
          clearInterval(t);
          await gscStatus();
          showPanel('console');
          if (typeof toast === 'function') toast('Search Console connected! Loading performance data…', 'ok');
          document.querySelector('[data-gsc="performance"]')?.click();
        }
      }, 1500);
    });
    return;
  }
  $('#gscAuth').innerHTML = `<div class="msg ok" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
    <span><b>&check; Google Search Console Connected.</b> Verified search query performance and observed ranking metrics active.</span>
    <button class="go ghost tiny" id="gscDisconnect" style="margin:0">Disconnect</button>
  </div>`;
  $('#gscDisconnect')?.addEventListener('click', async () => {
    try {
      await api('/api/gsc/disconnect', { body: {} });
      $('#gscBody').hidden = true;
      gscStatus();
    } catch (e) {
      msg('#gscAuth', `Could not disconnect: ${e.message}`, 'err');
    }
  });
  $('#gscBody').hidden = false;
  try {
    const { sites } = await api('/api/gsc/sites');
    if (!sites.length) {
      $('#gscSite').innerHTML = '<option value="">No verified properties found</option>';
      state.gscSite = '';
      $('#gscOut').innerHTML = '<div class="msg">Connected to Google, but no verified Search Console properties were found on this account. Add your site in Google Search Console first.</div>';
      return;
    }
    $('#gscSite').innerHTML = sites.map((s2) => `<option value="${esc(s2.siteUrl)}">${esc(s2.siteUrl)} — ${s2.permission}</option>`).join('');
    const match = sites.find((s2) => state.origin && s2.siteUrl.includes(state.origin.replace(/^https?:\/\//, '')));
    state.gscSite = match ? match.siteUrl : (sites[0]?.siteUrl || '');
    if (match) $('#gscSite').value = match.siteUrl;
    $('#gscSite').onchange = (e) => {
      state.gscSite = e.target.value;
      const activeBtn = document.querySelector('[data-gsc][aria-pressed="true"]') || document.querySelector('[data-gsc="performance"]');
      activeBtn?.click();
    };
    if (!$('#gscOut').innerHTML || $('#gscOut').innerHTML.includes('Querying Search Console')) {
      document.querySelector('[data-gsc="performance"]')?.click();
    }
  } catch (e) {
    $('#gscSite').innerHTML = '<option value="">Error loading properties</option>';
    $('#gscOut').innerHTML = `<div class="msg err">Search Console API error: ${esc(e.message)}. If your access token was revoked or expired, click Disconnect above and reconnect.</div>`;
  }
}

window.addEventListener('message', async (e) => {
  if (e.data?.type === 'gsc_connected') {
    await gscStatus();
    showPanel('console');
    if (typeof toast === 'function') toast('Search Console connected! Loading performance data…', 'ok');
    document.querySelector('[data-gsc="performance"]')?.click();
  }
});

function gscRange() {
  const days = Number($('#gscDays').value);
  const d = (n) => { const x = new Date(); x.setDate(x.getDate() - n); return x.toISOString().slice(0, 10); };
  return { startDate: d(days), endDate: d(3) };
}

$$('[data-gsc]').forEach((b) => b.addEventListener('click', async () => {
  $$('[data-gsc]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  const kind = b.dataset.gsc;
  const siteUrl = state.gscSite;
  const r = gscRange();
  $('#gscOut').innerHTML = '<div class="progress">Querying Search Console…</div>';
  try {
    if (kind === 'performance') {
      const { rows } = await api('/api/gsc/query', { body: { siteUrl, ...r, dimensions: ['query'], rowLimit: 300 } });
      if (!rows || !rows.length) {
        $('#gscOut').innerHTML = '<div class="empty">No search performance data returned for this property in the selected window.</div>';
      } else {
        $('#gscOut').innerHTML = table(['Query', 'Clicks', 'Impr.', 'CTR', 'Pos.'], rows.map((x) => [
          x.query, num(x.clicks), num(x.impressions), `${(x.ctr * 100).toFixed(1)}%`, x.position.toFixed(1)]), [1, 2, 3, 4]);
      }
    }
    if (kind === 'cannibalisation') {
      const { rows } = await api('/api/gsc/cannibalisation', { body: { siteUrl, ...r } });
      $('#gscOut').innerHTML = `<p class="note">Two URLs alternating for one query means both underperform. This is the provable version — from a crawl alone it is a guess, from this export it is observed.</p>
        ${rows.length ? rows.slice(0, 40).map((c) => `<article class="finding ${c.severity}">
          <div class="fhead"><span class="sev ${c.severity}">${c.severity}</span><span class="ftitle">${esc(c.query)}</span>
          <span class="fmeta">${num(c.totalImpressions)} impr · best pos ${c.bestPosition.toFixed(1)}</span></div>
          <div class="fbody" hidden><table style="margin-top:10px"><thead><tr><th>Page</th><th class="num">Clicks</th><th class="num">Impr.</th><th class="num">Pos.</th><th class="num">Share</th></tr></thead>
          <tbody>${c.pages.map((p) => `<tr><td class="u">${esc(short(p.page, 50))}</td><td class="num">${p.clicks}</td><td class="num">${num(p.impressions)}</td><td class="num">${p.position}</td><td class="num">${p.share}%</td></tr>`).join('')}</tbody></table></div>
        </article>`).join('') : '<div class="empty">No contested queries found in this window.</div>'}`;
      $$('#gscOut .fhead').forEach((h) => h.addEventListener('click', () => { h.nextElementSibling.hidden = !h.nextElementSibling.hidden; }));
    }
    if (kind === 'striking') {
      const { rows } = await api('/api/gsc/striking', { body: { siteUrl, ...r } });
      $('#gscOut').innerHTML = `<p class="note">Positions 5–20 with real impressions. The cheapest wins available — these pages already rank, they just rank slightly too low to earn the click.</p>` +
        table(['Query', 'Page', 'Pos.', 'Impr.', 'CTR', 'Est. clicks won'], rows.slice(0, 100).map((x) => [
          x.query, short(x.page, 40), x.position, num(x.impressions), `${x.ctr}%`, `+${x.opportunity}`]), [2, 3, 4, 5]);
    }
    if (kind === 'ctr') {
      const { rows } = await api('/api/gsc/ctr-gaps', { body: { siteUrl, ...r } });
      $('#gscOut').innerHTML = `<p class="note">Ranking well, clicked rarely. That is a title and meta description problem, not a ranking one — take these to the Build tab.</p>` +
        table(['Query', 'Page', 'Pos.', 'Actual CTR', 'Expected', 'Missed clicks'], rows.slice(0, 80).map((x) => [
          x.query, short(x.page, 38), x.position, `${x.actualCtr}%`, `${x.expectedCtr}%`, num(x.missedClicks)]), [2, 3, 4, 5]);
    }
    if (kind === 'clusters') {
      const { clusters } = await api('/api/gsc/clusters', { body: { siteUrl, ...r } });
      $('#gscOut').innerHTML = `<p class="note">Queries grouped by the page Google chose to serve them. This is the strongest free proxy for SERP-similarity clustering — it is Google's own judgement about which queries one page can answer.</p>` +
        table(['Page', 'Queries', 'Primary query', 'Clicks', 'Impr.'], clusters.slice(0, 60).map((c) => [
          short(c.page, 46), c.queryCount, c.primaryQuery || '—', num(c.clicks), num(c.impressions)]), [1, 3, 4]);
    }
    if (kind === 'sitemaps') {
      const res = await fetch(`/api/gsc/sitemaps?siteUrl=${encodeURIComponent(siteUrl)}`).then((x) => x.json());
      if (!res.ok) throw new Error(res.error || 'Failed to fetch sitemaps');
      $('#gscOut').innerHTML = table(['Sitemap', 'Submitted', 'Indexed', 'Errors', 'Warnings', 'Last downloaded'],
        (res.sitemaps || []).map((s) => [short(s.path, 46), num(s.submitted), num(s.indexed), s.errors || 0, s.warnings || 0,
          s.lastDownloaded ? s.lastDownloaded.slice(0, 10) : 'never']), [1, 2, 3, 4]) +
        `<p class="note">A large gap between submitted and indexed is a quality or duplication judgement, not a technical fault. Do not try to fix "Crawled – currently not indexed" technically.</p>`;
    }
    if (kind === 'triage') {
      const days = Number($('#gscDays').value);
      const d = (n) => { const x = new Date(); x.setDate(x.getDate() - n); return x.toISOString().slice(0, 10); };
      const { triage } = await api('/api/gsc/triage', {
        body: { siteUrl, dropStart: d(Math.floor(days / 2)), dropEnd: d(3), baseStart: d(days), baseEnd: d(Math.floor(days / 2) + 1) },
      });
      const s = triage.summary;
      $('#gscOut').innerHTML = `
        <div class="stats">
          <div class="stat ${s.clickChange < 0 ? 'warn' : 'good'}"><b>${s.clickChange > 0 ? '+' : ''}${s.clickChange}%</b><span>clicks</span></div>
          <div class="stat ${s.imprChange < 0 ? 'warn' : 'good'}"><b>${s.imprChange > 0 ? '+' : ''}${s.imprChange}%</b><span>impressions</span></div>
          <div class="stat"><b>${s.posBefore} → ${s.posNow}</b><span>avg position</span></div>
          <div class="stat"><b>${s.yoyChange > 0 ? '+' : ''}${s.yoyChange}%</b><span>same period last year</span></div>
        </div>
        <p class="note">Work in order. Stop when you find it — jumping to "algorithm update" is how weeks get lost.</p>
        ${triage.steps.map((st) => `<div class="step"><span class="idx">${st.n}</span><span class="vd ${st.verdict}">${st.verdict}</span>
          <div><q>${esc(st.name)}</q><small>${esc(st.detail)}</small></div></div>`).join('')}
        <div class="copybar" style="margin-top:16px"><button class="go ghost tiny" id="lostPages">Which pages lost most?</button></div>
        <div id="deltaOut"></div>`;
      $('#lostPages').addEventListener('click', async () => {
        $('#deltaOut').innerHTML = '<div class="progress">Comparing…</div>';
        const { rows } = await api('/api/gsc/deltas', {
          body: { siteUrl, aStart: d(days), aEnd: d(Math.floor(days / 2) + 1), bStart: d(Math.floor(days / 2)), bEnd: d(3) },
        });
        $('#deltaOut').innerHTML = table(['Page', 'Clicks before', 'Clicks after', 'Δ', 'Pos before', 'Pos after'],
          rows.slice(0, 40).map((x) => [short(x.key, 46), num(x.clicksBefore), num(x.clicksAfter), x.delta, x.posBefore ?? '—', x.posAfter ?? '—']), [1, 2, 3, 4, 5]);
      });
    }
    if (kind === 'inspect') {
      $('#gscOut').innerHTML = `<div class="form">
        <div class="field grow"><label for="inspUrls">URLs to inspect (one per line, max 30)</label><textarea id="inspUrls">${state.pages.slice(0, 10).map((p) => p.url).join('\n')}</textarea></div>
        <div class="field"><label>&nbsp;</label><button class="go" id="runInspect">Inspect</button></div></div><div id="inspOut"></div>`;
      $('#runInspect').addEventListener('click', async () => {
        const urls = $('#inspUrls').value.split('\n').map((s) => s.trim()).filter(Boolean);
        $('#inspOut').innerHTML = `<div class="progress">Inspecting ${urls.length} URLs — the API is rate-limited, so this takes a moment…</div>`;
        const { results } = await api('/api/gsc/inspect-batch', { body: { siteUrl, urls } });
        $('#inspOut').innerHTML = table(['URL', 'Verdict', 'Coverage', 'Google canonical', 'Last crawled'],
          results.map((x) => x.error ? [short(x.url, 44), 'error', x.error, '', ''] : [
            short(x.url, 44),
            `<span class="pill ${x.verdict === 'PASS' ? 'ok' : 'bad'}">${x.verdict}</span>`,
            x.coverageState || '—',
            x.canonicalMatch === false ? `<span class="pill mid">differs</span> ${short(x.googleCanonical, 30)}` : 'matches',
            x.lastCrawlTime ? x.lastCrawlTime.slice(0, 10) : 'never']), []);
      });
    }
  } catch (e) { $('#gscOut').innerHTML = `<div class="msg err">${esc(e.message)}</div>`; }
}));

/* ═══════════════════════════════ SPEED ═══════════════════════════════ */

$('#runPsi').addEventListener('click', async () => {
  const url = $('#psiUrl').value.trim() || state.pages[0]?.url;
  if (!url) return msg('#psiOut', 'Enter a URL or run a crawl first.', 'err');
  const btn = $('#runPsi');
  busy(btn, true, 'Testing…');
  $('#psiOut').innerHTML = '<div class="progress">PageSpeed Insights runs a live Lighthouse pass — this takes 15–30 seconds.</div>';
  try {
    const { result } = await api('/api/psi', { body: { url, strategy: $('#psiStrategy').value } });
    $('#dotPsi')?.classList.add('on');
    $('#psiOut').innerHTML = result.ok ? renderPsi(result) : `<div class="msg err">${esc(result.error)}${result.quota ? ' — keyless PageSpeed allows about 25 requests a day, so this is usually the daily cap rather than a fault.' : ''}</div>`;
  } catch (e) { $('#psiOut').innerHTML = `<div class="msg err">${esc(e.message)}</div>`; }
  finally { busy(btn, false); }
});

$('#runPsiBatch').addEventListener('click', async () => {
  const urls = state.pages.filter((p) => p.status === 200 && !p.noindex).slice(0, 10).map((p) => p.url);
  if (!urls.length) return msg('#psiOut', 'Run a crawl first.', 'err');
  $('#psiOut').innerHTML = `<div class="progress">Testing ${urls.length} URLs — roughly 20 seconds each.</div>`;
  try {
    const { results } = await api('/api/psi', { body: { urls, strategy: $('#psiStrategy').value } });
    $('#psiOut').innerHTML = table(['URL', 'Field LCP', 'Field INP', 'Field CLS', 'Lab score'],
      results.map((r) => r.ok ? [
        short(r.url, 44),
        fieldCell(r.field, 'LCP'), fieldCell(r.field, 'INP'), fieldCell(r.field, 'CLS'),
        `<span class="pill ${r.lab.performanceScore >= 90 ? 'ok' : r.lab.performanceScore >= 50 ? 'mid' : 'bad'}">${r.lab.performanceScore}</span>`,
      ] : [short(r.url, 44), 'error', esc(r.error), '', '']), []) +
      `<p class="note">Blank field cells mean CrUX has no data for that URL — too little real-user traffic. Fall back to the origin-level numbers, and treat the lab score as a debugging pointer only.</p>`;
  } catch (e) { $('#psiOut').innerHTML = `<div class="msg err">${esc(e.message)}</div>`; }
});

const fieldCell = (f, k) => {
  const m = f?.metrics?.[k];
  if (!m) return '<span style="color:var(--ink3)">no data</span>';
  return `<span class="pill ${m.category === 'FAST' || m.good ? 'ok' : m.category === 'AVERAGE' ? 'mid' : 'bad'}">${k === 'CLS' ? (m.p75 / 100).toFixed(2) : `${m.p75}ms`}</span>`;
};

function renderPsi(r, compact = false) {
  const f = r.field?.available ? r.field : r.origin;
  const scope = r.field?.available ? 'this URL' : 'the whole origin';
  return `
    ${compact ? '<h3 class="sub">Performance</h3>' : ''}
    <h3 class="sub">Field data — real users, last 28 days (${scope})</h3>
    ${f?.available ? `<div class="cwv">${Object.entries(f.metrics).map(([k, m]) => `
      <div class="metric ${m.category}">
        <div class="lab">${k}</div>
        <div class="val">${k === 'CLS' ? (m.p75 / 100).toFixed(2) : `${num(m.p75)}<span style="font-size:.6em">ms</span>`}</div>
        <div class="bar">${m.distribution.map((d) => `<i style="width:${d.proportion}%"></i>`).join('')}</div>
      </div>`).join('')}</div>
      <p class="note">This is the signal — the 75th percentile of what real Chrome users experienced. LCP, INP and CLS are the three that count.</p>`
      : `<div class="msg">${esc(r.field?.note || 'No field data available.')}</div>`}

    <h3 class="sub">Lab data — simulated, for debugging</h3>
    <div class="stats">
      <div class="stat"><b>${r.lab.performanceScore}</b><span>performance</span></div>
      <div class="stat"><b>${r.lab.seoScore}</b><span>seo</span></div>
      <div class="stat"><b>${r.lab.accessibilityScore}</b><span>accessibility</span></div>
      <div class="stat"><b style="font-size:1.1rem">${esc(r.lab.lcp || '—')}</b><span>lab lcp</span></div>
      <div class="stat"><b style="font-size:1.1rem">${esc(r.lab.tbt || '—')}</b><span>total blocking</span></div>
      <div class="stat"><b style="font-size:1.1rem">${esc(r.lab.cls || '—')}</b><span>lab cls</span></div>
    </div>
    ${r.lab.lcpElement ? `<p class="note"><b>LCP element:</b> <code style="font-size:11px">${esc(String(r.lab.lcpElement).slice(0, 180))}</code><br>If this is an image, it must not be lazy-loaded. Set loading="eager" and fetchpriority="high".</p>` : ''}
    ${r.opportunities.length ? `<h3 class="sub">Opportunities</h3>${table(['Fix', 'Modelled saving'],
      r.opportunities.map((o) => [o.title, `${num(o.savingsMs)}ms`]), [1])}
      <p class="note">These savings are modelled against the lab run. Verify against field data after shipping — a lab win that does not move CrUX did not help anyone.</p>` : ''}
    ${r.failedSeoAudits?.length ? `<h3 class="sub">Lighthouse SEO checks failing</h3><ul style="font-family:var(--mono);font-size:11.5px;line-height:1.9">${r.failedSeoAudits.map((a) => `<li>${esc(a.title)}</li>`).join('')}</ul>` : ''}`;
}

/* ═══════════════════════════════ BUILD ═══════════════════════════════ */

$$('[data-build]').forEach((b) => b.addEventListener('click', () => {
  $$('[data-build]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  renderBuild(b.dataset.build);
}));

function renderBuild(tool) {
  const out = $('#buildOut');
  if (tool === 'titles') {
    out.innerHTML = `<h3 class="sub">Titles and meta descriptions</h3>
      <p class="note">Drafts are formulaic on purpose — a good title is front-loaded and matches the H1, and a formula gets that right at scale. Edit the money pages by hand. Meta descriptions are not a ranking factor and have not been for over a decade; this is a click-through lever.</p>
      <div class="form">
        <div class="field grow"><label for="tBrand">Brand suffix</label><input id="tBrand" placeholder="Firm Name"></div>
        <div class="field"><label for="tSep">Separator</label><select id="tSep"><option>|</option><option>—</option><option>·</option></select></div>
        <div class="field"><label>&nbsp;</label><button class="go" id="tRun">Draft</button></div>
        <div class="field"><label>&nbsp;</label><button class="go ghost" id="tClaude">Draft with Claude</button></div>
      </div><div id="tOut"></div>`;
    $('#tRun').addEventListener('click', () => draftTitles(false));
    $('#tClaude').addEventListener('click', () => draftTitles(true));
  }
  if (tool === 'schema') {
    out.innerHTML = `<h3 class="sub">Structured data</h3>
      <p class="note">Only types that produce a rich result, and only describing content visible on the page. Marking up an FAQ users cannot see is a policy violation and gets the rich result withdrawn. Validate with the Rich Results Test, then watch the Search Console enhancement report — that is where you learn whether Google agreed.</p>
      <div class="form">
        <div class="field"><label for="sType">Type</label><select id="sType">
          ${(state.schemaTypes || ['Organization', 'LocalBusiness', 'Product', 'Article', 'FAQPage', 'BreadcrumbList']).map((t) => `<option>${t}</option>`).join('')}</select></div>
        <div class="field"><label>&nbsp;</label><button class="go" id="sRun">Generate</button></div>
      </div>
      <div class="split">
        <div>
          <div class="field"><label for="sName">Business / publisher name</label><input id="sName"></div>
          <div class="field"><label for="sUrl">URL</label><input id="sUrl" placeholder="https://example.com/"></div>
          <div class="field"><label for="sPhone">Telephone</label><input id="sPhone"></div>
          <div class="field"><label for="sStreet">Street</label><input id="sStreet"></div>
          <div class="field"><label for="sCity">City</label><input id="sCity"></div>
          <div class="field"><label for="sRegion">Region / state</label><input id="sRegion"></div>
          <div class="field"><label for="sPostal">Postal code</label><input id="sPostal"></div>
        </div>
        <div>
          <div class="field"><label for="sServices">Services (comma separated)</label><input id="sServices"></div>
          <div class="field"><label for="sArea">Areas served (comma separated)</label><input id="sArea"></div>
          <div class="field"><label for="sSame">sameAs profiles (one per line)</label><textarea id="sSame" style="min-height:56px"></textarea></div>
          <div class="field"><label for="sAuthor">Author name (Article / Person)</label><input id="sAuthor"></div>
          <div class="field"><label for="sHeadline">Headline (Article)</label><input id="sHeadline"></div>
          <div class="field"><label for="sFaq">FAQs — one per line as: question :: answer</label><textarea id="sFaq"></textarea></div>
          <div class="field"><label for="sHours">Hours — one per line as: Monday,Tuesday 09:00-17:00</label><textarea id="sHours" style="min-height:56px"></textarea></div>
        </div>
      </div><div id="sOut" style="margin-top:18px"></div>`;
    $('#sRun').addEventListener('click', genSchema);
  }
  if (tool === 'links') {
    out.innerHTML = `<h3 class="sub">Internal link opportunities</h3>
      <p class="note">The only ranking lever that requires nobody's permission, and usually more upside than external links. This finds pages that already discuss the target's topic and do not link to it.</p>
      <div class="form">
        <div class="field grow"><label for="lTarget">Target URL</label><select id="lTarget">${state.pages.filter((p) => p.status === 200).map((p) => `<option value="${esc(p.url)}">${esc(short(p.url, 62))}</option>`).join('')}</select></div>
        <div class="field grow"><label for="lTerms">Anchor terms (optional, comma separated — derived from the title and H1 if blank)</label><input id="lTerms"></div>
        <div class="field"><label>&nbsp;</label><button class="go" id="lRun">Find</button></div>
      </div>
      <div class="copybar"><button class="go ghost tiny" id="lGraph">Show the whole link graph</button></div>
      <div id="lOut"></div>`;
    $('#lRun').addEventListener('click', findLinks);
    $('#lGraph').addEventListener('click', async () => {
      const { rows } = await api('/api/generate/link-graph');
      $('#lOut').innerHTML = `<p class="note">Sorted by body-content inbound links ascending — the thinnest pages first. Anything at zero is effectively orphaned regardless of what the nav says.</p>` +
        table(['URL', 'Depth', 'Inbound', 'From body', 'Outbound', 'Words', 'Anchors seen'],
          rows.map((r) => [short(r.url, 40), r.depth ?? '—', r.inbound, r.inboundBody, r.outbound, r.words, r.anchors.slice(0, 3).join(', ')]), [1, 2, 3, 4, 5]);
    });
  }
  if (tool === 'redirects') {
    out.innerHTML = `<h3 class="sub">Redirect map</h3>
      <p class="note">Paste the old URLs; the crawl of the new site supplies the destinations. Matching is by slug and title similarity, so review anything below high confidence. Never default an unmatched URL to the homepage — that produces a soft 404.</p>
      <div class="form">
        <div class="field grow"><label for="rOld">Old URLs, one per line</label><textarea id="rOld" style="min-height:150px" placeholder="https://old.example.com/practice-areas/car-accidents/"></textarea></div>
      </div>
      <div class="form">
        <div class="field"><label for="rFormat">Output</label><select id="rFormat">
          <option value="csv">Review CSV</option><option value="htaccess">.htaccess</option><option value="nginx">nginx</option>
          <option value="redirection-csv">Redirection plugin CSV</option><option value="json">JSON</option></select></div>
        <div class="field"><label>&nbsp;</label><button class="go" id="rRun">Build map</button></div>
        <div class="field"><label>&nbsp;</label><button class="go ghost" id="rTest">Test live</button></div>
      </div><div id="rOut"></div>`;
    $('#rRun').addEventListener('click', buildRedirects);
    $('#rTest').addEventListener('click', testRedirects);
  }
  if (tool === 'robots') {
    out.innerHTML = `<h3 class="sub">robots.txt and sitemap</h3>
      <p class="note">Blocking a URL in robots.txt means Google never fetches it and never sees a noindex on it. To deindex, allow the crawl and use noindex. To save crawl budget on pages already out of the index, block.</p>
      <div class="form">
        <div class="field grow"><label for="bOrigin">Origin</label><input id="bOrigin" value="${esc(state.origin)}" placeholder="https://example.com"></div>
        <div class="field grow"><label for="bDisallow">Extra Disallow paths, one per line</label><textarea id="bDisallow" style="min-height:38px"></textarea></div>
      </div>
      <div class="form" style="margin-top:-8px">
        <label for="bPlat">Platform</label><select id="bPlat"><option value="generic">Any site</option><option value="wordpress">WordPress</option></select>
        <label class="check"><input type="checkbox" id="bStaging"> Staging — block everything</label>
        <button class="go" id="bRun">Generate robots.txt</button>
        <button class="go ghost" id="bSitemap">Generate sitemap from crawl</button>
      </div><div id="bOut"></div>
      
      <div class="card" style="margin-top:24px; padding:18px 20px; border:1px solid var(--line); border-radius:12px; background:var(--raised);">
        <h4 style="margin:0 0 6px; font-size:14px; font-weight:600; color:var(--ink);">Googlebot Directive Validator</h4>
        <p class="note" style="margin:0 0 12px;">Test whether Googlebot is allowed or blocked on any specific URL path under your Disallow rules.</p>
        <div class="form">
          <div class="field grow">
            <label for="robTestPath">URL Path to test</label>
            <input id="robTestPath" placeholder="/wp-admin/settings.php" value="/admin/">
          </div>
          <div class="field">
            <label>&nbsp;</label>
            <button class="go" id="robTestBtn" type="button">Test Path</button>
          </div>
        </div>
        <div id="robTestResult" style="margin-top:10px;"></div>
      </div>`;
    $('#bRun').addEventListener('click', async () => {
      const { robots } = await api('/api/generate/robots', {
        body: {
          origin: $('#bOrigin').value, platform: $('#bPlat').value, blockStaging: $('#bStaging').checked,
          extraDisallow: $('#bDisallow').value.split('\n').map((s) => s.trim()).filter(Boolean),
        },
      });
      $('#bOut').innerHTML = `<div class="out code">${esc(robots)}</div>` + copyBar(robots);
      wireCopy();
    });
    $('#bSitemap').addEventListener('click', async () => {
      const d = await api('/api/generate/sitemap');
      $('#bOut').innerHTML = `<div class="msg ok">${d.count} URLs included, ${d.excluded} excluded — only canonical, indexable, 200-returning pages.</div>
        <p class="note">${esc(d.note)}</p><div class="out code">${esc(d.xml.slice(0, 4000))}${d.xml.length > 4000 ? '\n…' : ''}</div>` + copyBar(d.xml);
      wireCopy();
    });
    $('#robTestBtn')?.addEventListener('click', () => {
      const path = ($('#robTestPath')?.value || '').trim();
      const resEl = $('#robTestResult');
      if (!path || !resEl) return;
      const extra = ($('#bDisallow')?.value || '').split('\n').map((s) => s.trim()).filter(Boolean);
      const isStaging = $('#bStaging')?.checked;
      const plat = $('#bPlat')?.value;
      const standardDisallows = isStaging ? ['/'] : (plat === 'wordpress' ? ['/wp-admin/'] : []);
      const allRules = [...standardDisallows, ...extra];
      
      const matched = allRules.find((r) => {
        const cleanRule = r.replace(/^Disallow:\s*/i, '').trim();
        return cleanRule && path.startsWith(cleanRule);
      });

      if (matched) {
        resEl.innerHTML = `<div class="msg bad">⛔ <b>BLOCKED:</b> Googlebot is disallowed from crawling <code>${esc(path)}</code> by rule <code>Disallow: ${esc(matched)}</code>.</div>`;
      } else {
        resEl.innerHTML = `<div class="msg ok">✅ <b>ALLOWED:</b> Googlebot has crawl permission to fetch <code>${esc(path)}</code>.</div>`;
      }
    });
  }
  if (tool === 'serp') {
    const hasPages = state.pages && state.pages.length > 0;
    const initialPage = hasPages ? (state.pages.find((p) => p.status === 200 && p.title) || state.pages[0]) : null;
    const initialTitle = initialPage?.title || 'Premier Security Guard Services | West Guards Security';
    const initialDesc = initialPage?.metaDesc || 'Professional, licensed, and insured security personnel providing 24/7 commercial, construction, and residential protection.';
    const initialUrl = initialPage?.url || state.origin || 'https://www.example.com/security-services';

    out.innerHTML = `<h3 class="sub">Google SERP &amp; Social Snippet Simulator</h3>
      <p class="note">Pixel-precise visual simulation for Google Search (Desktop &amp; Mobile) and Open Graph social sharing cards (LinkedIn, Facebook, X). Prevent keyword truncation before publishing.</p>
      
      ${hasPages ? `
      <div class="form" style="margin-bottom:16px;">
        <div class="field grow">
          <label for="serpPageSelect">Auto-fill from crawled page</label>
          <select id="serpPageSelect">
            <option value="">-- Select a crawled URL to inspect --</option>
            ${state.pages.slice(0, 150).map((p) => `<option value="${esc(p.url)}">${esc(short(p.url, 50))} — ${esc(short(p.title || 'No Title', 35))}</option>`).join('')}
          </select>
        </div>
      </div>` : ''}

      <div class="serp-sim-layout">
        <div class="serp-inputs-col">
          <div class="field">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
              <label for="serpTitle" style="margin-bottom:0; font-weight:600;">SEO Title</label>
              <div style="display:flex; gap:6px;">
                <span class="serp-meter ok" id="serpTitleChars">0 chars</span>
                <span class="serp-meter ok" id="serpTitlePx">0px / 600px</span>
              </div>
            </div>
            <input id="serpTitle" value="${esc(initialTitle)}" placeholder="Target Keyword | Brand Name">
          </div>

          <div class="field">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
              <label for="serpDesc" style="margin-bottom:0; font-weight:600;">Meta Description</label>
              <div style="display:flex; gap:6px;">
                <span class="serp-meter ok" id="serpDescChars">0 chars</span>
                <span class="serp-meter ok" id="serpDescPx">0px / 960px</span>
              </div>
            </div>
            <textarea id="serpDesc" style="min-height:76px" placeholder="Engaging description with primary value proposition and call to action.">${esc(initialDesc)}</textarea>
          </div>

          <div class="field">
            <label for="serpUrl" style="font-weight:600;">Target URL</label>
            <input id="serpUrl" value="${esc(initialUrl)}" placeholder="https://example.com/services/sub-page">
          </div>

          <div class="field">
            <label for="serpOgImage" style="font-weight:600;">Featured / OG Image URL</label>
            <input id="serpOgImage" placeholder="https://example.com/assets/og-image.jpg">
          </div>

          <div class="field">
            <label style="font-weight:600;">SERP Device Viewport</label>
            <div style="display:flex; gap:8px;">
              <button class="chip active" id="btnSerpDesktop" type="button">💻 Desktop SERP (600px)</button>
              <button class="chip" id="btnSerpMobile" type="button">📱 Mobile SERP (680px)</button>
            </div>
          </div>
        </div>

        <div class="serp-preview-col">
          <div class="serp-preview-card">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
              <span style="font-size:11px; text-transform:uppercase; font-family:var(--data); letter-spacing:.06em; color:var(--ink3); font-weight:700;">Google Search Preview</span>
              <span class="chip tiny" id="serpDevicePill">Desktop (600px Max)</span>
            </div>

            <div class="google-serp-box" id="gsbBox">
              <div class="gsb-header">
                <div class="gsb-favicon">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>
                </div>
                <div class="gsb-url-trail">
                  <span class="gsb-domain" id="gsbDomain">example.com</span>
                  <span class="gsb-path" id="gsbPath">https://example.com</span>
                </div>
              </div>
              <h3 class="gsb-title" id="gsbTitle">Page Title Preview</h3>
              <p class="gsb-desc" id="gsbDesc">Meta description preview will appear here.</p>
            </div>

            <div style="margin-top:22px; padding-top:16px; border-top:1px solid var(--line);">
              <div style="font-size:11px; text-transform:uppercase; font-family:var(--data); letter-spacing:.06em; color:var(--ink3); font-weight:700; margin-bottom:10px;">Social Share Card (Open Graph)</div>
              <div class="social-og-box">
                <div class="sog-image-wrap" id="sogImageWrap">
                  <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="var(--ink3)" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                </div>
                <div class="sog-body">
                  <span class="sog-domain" id="sogDomain">EXAMPLE.COM</span>
                  <h4 class="sog-title" id="sogTitle">Social Title</h4>
                  <p class="sog-desc" id="sogDesc">Social description preview</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>`;

    wireSerpSimulator();
  }
  if (tool === 'brief') {
    out.innerHTML = `<h3 class="sub">Content brief</h3>
      <p class="note">Briefs open with the SERP check for a reason: if the top ten are guides and you are planning a service page, no amount of on-page work fixes it.</p>
      <div class="form">
        <div class="field grow"><label for="cbCluster">Target query or cluster</label><input id="cbCluster" placeholder="how to choose running shoes for flat feet"></div>
        <div class="field grow"><label for="cbGoal">Business goal, in the client's words</label><input id="cbGoal" placeholder="signed cases, not traffic"></div>
        <div class="field"><label>&nbsp;</label><button class="go" id="cbRun">Build brief</button></div>
      </div><div id="cbOut"></div>`;
    $('#cbRun').addEventListener('click', async () => {
      const label = $('#cbCluster').value.trim();
      if (!label) return;
      $('#cbOut').innerHTML = '<div class="progress">Pulling related questions…</div>';
      await makeBrief(label, null, 'cbOut');
    });
  }
}

let _serpCanvasCtx = null;
function measureTextPx(text, font) {
  if (!text) return 0;
  if (!_serpCanvasCtx) {
    const c = document.createElement('canvas');
    _serpCanvasCtx = c.getContext('2d');
  }
  if (!_serpCanvasCtx) return text.length * 9;
  _serpCanvasCtx.font = font;
  return Math.round(_serpCanvasCtx.measureText(text).width);
}

function wireSerpSimulator() {
  let isMobile = false;

  const titleIn = $('#serpTitle');
  const descIn = $('#serpDesc');
  const urlIn = $('#serpUrl');
  const ogImgIn = $('#serpOgImage');
  const pageSel = $('#serpPageSelect');
  const btnDesk = $('#btnSerpDesktop');
  const btnMob = $('#btnSerpMobile');

  if (pageSel) {
    pageSel.addEventListener('change', () => {
      const url = pageSel.value;
      if (!url) return;
      const p = (state.pages || []).find((x) => x.url === url);
      if (p) {
        if (titleIn && p.title) titleIn.value = p.title;
        if (descIn && p.metaDesc) descIn.value = p.metaDesc;
        if (urlIn) urlIn.value = p.url;
        updateSim();
      }
    });
  }

  const updateSim = () => {
    const title = (titleIn?.value || '').trim();
    const desc = (descIn?.value || '').trim();
    const url = (urlIn?.value || '').trim();
    const ogImg = (ogImgIn?.value || '').trim();

    // 1. Title Pixel and Length Measurement
    const titleFont = isMobile ? '18px Roboto, Arial, sans-serif' : '20px Arial, sans-serif';
    const titlePx = measureTextPx(title, titleFont);
    const maxTitlePx = isMobile ? 680 : 600;
    const safeTitlePx = isMobile ? 640 : 580;

    const tCharsEl = $('#serpTitleChars');
    const tPxEl = $('#serpTitlePx');
    if (tCharsEl) tCharsEl.textContent = `${title.length} chars`;
    if (tPxEl) {
      tPxEl.textContent = `${titlePx}px / ${maxTitlePx}px`;
      tPxEl.className = 'serp-meter ' + (titlePx <= safeTitlePx ? 'ok' : (titlePx <= maxTitlePx ? 'warn' : 'bad'));
    }

    // Truncate title if pixel width exceeded
    let displayTitle = title;
    if (titlePx > maxTitlePx) {
      let truncated = title;
      while (truncated.length > 5 && measureTextPx(truncated + ' ...', titleFont) > maxTitlePx) {
        truncated = truncated.slice(0, -1);
      }
      displayTitle = truncated + ' ...';
    }
    const gsbTitle = $('#gsbTitle');
    if (gsbTitle) gsbTitle.textContent = displayTitle || 'Untitled Page';

    // 2. Meta Description Pixel and Length
    const descFont = isMobile ? '13px Roboto, Arial, sans-serif' : '14px Arial, sans-serif';
    const descPx = measureTextPx(desc, descFont);
    const maxDescPx = isMobile ? 680 : 960;
    const maxDescChars = isMobile ? 120 : 160;

    const dCharsEl = $('#serpDescChars');
    const dPxEl = $('#serpDescPx');
    if (dCharsEl) dCharsEl.textContent = `${desc.length} chars`;
    if (dPxEl) {
      dPxEl.textContent = `${descPx}px / ${maxDescPx}px`;
      dPxEl.className = 'serp-meter ' + (desc.length >= 70 && desc.length <= maxDescChars ? 'ok' : (desc.length > maxDescChars ? 'bad' : 'warn'));
    }

    const gsbDesc = $('#gsbDesc');
    if (gsbDesc) gsbDesc.textContent = desc || 'Add a meta description to see how it looks in search snippets.';

    // 3. URL and Breadcrumb
    let domain = 'example.com';
    let pathTrail = url;
    try {
      const parsed = new URL(url.startsWith('http') ? url : 'https://' + url);
      domain = parsed.hostname.replace(/^www\./, '');
      const segments = parsed.pathname.split('/').filter(Boolean);
      pathTrail = `https://${parsed.hostname}${segments.length ? ' › ' + segments.join(' › ') : ''}`;
    } catch {
      domain = url.split('/')[0] || 'example.com';
    }
    const gsbDom = $('#gsbDomain');
    const gsbPath = $('#gsbPath');
    if (gsbDom) gsbDom.textContent = domain;
    if (gsbPath) gsbPath.textContent = pathTrail;

    // 4. Social Open Graph Box
    const sogDom = $('#sogDomain');
    const sogTitle = $('#sogTitle');
    const sogDesc = $('#sogDesc');
    if (sogDom) sogDom.textContent = domain.toUpperCase();
    if (sogTitle) sogTitle.textContent = title || 'Social Title';
    if (sogDesc) sogDesc.textContent = desc || 'Social description preview';

    const sogWrap = $('#sogImageWrap');
    if (sogWrap) {
      if (ogImg && /^https?:\/\//i.test(ogImg)) {
        sogWrap.innerHTML = `<img class="sog-img" src="${esc(ogImg)}" alt="Social Preview" onerror="this.parentElement.innerHTML='<span style=\\'color:var(--ink3);font-size:12px;display:flex;align-items:center;justify-content:center;height:100%\\'>Image preview unavailable</span>'">`;
      } else {
        sogWrap.innerHTML = `<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="var(--ink3)" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;
      }
    }
  };

  [titleIn, descIn, urlIn, ogImgIn].forEach((el) => {
    if (el) el.addEventListener('input', updateSim);
  });

  if (btnDesk && btnMob) {
    btnDesk.addEventListener('click', () => {
      isMobile = false;
      btnDesk.classList.add('active');
      btnMob.classList.remove('active');
      $('#gsbBox')?.classList.remove('mobile-view');
      const pill = $('#serpDevicePill');
      if (pill) pill.textContent = 'Desktop (600px Max)';
      updateSim();
    });
    btnMob.addEventListener('click', () => {
      isMobile = true;
      btnMob.classList.add('active');
      btnDesk.classList.remove('active');
      $('#gsbBox')?.classList.add('mobile-view');
      const pill = $('#serpDevicePill');
      if (pill) pill.textContent = 'Mobile (680px Max)';
      updateSim();
    });
  }

  updateSim();
}


async function draftTitles(useClaude) {
  $('#tOut').innerHTML = '<div class="progress">Drafting…</div>';
  try {
    const d = await api('/api/generate/titles', {
      body: { brand: $('#tBrand').value.trim(), separator: $('#tSep').value, useClaude },
    });
    if (d.source === 'claude') {
      $('#tOut').innerHTML = table(['URL', 'Title', 'Meta description'],
        d.drafts.map((x) => [short(x.url, 36), esc(x.title), esc(x.metaDescription)]), []);
      return;
    }
    const changed = d.titles.filter((t) => t.changed);
    $('#tOut').innerHTML = `<div class="msg">${changed.length} of ${d.titles.length} titles would change.</div>` +
      table(['URL', 'Current', 'Suggested', 'px', 'Why'],
        d.titles.map((t) => [short(t.url, 32), esc(t.current || '—'), `<b>${esc(t.suggested)}</b>`,
          `<span class="pill ${t.suggestedPx > 580 ? 'bad' : 'ok'}">${t.suggestedPx}</span>`, t.reason]), [3]) +
      `<h3 class="sub">Meta descriptions</h3>` +
      table(['URL', 'Current', 'Suggested'],
        d.metas.map((m) => [short(m.url, 32), esc(m.current || '—'), esc(m.suggested)]), []) +
      `<p class="note">${esc(d.metas[0]?.note || '')}</p>` +
      copyBar(d.titles.map((t) => `${t.url}\t${t.suggested}`).join('\n'));
    wireCopy();
  } catch (e) { $('#tOut').innerHTML = `<div class="msg err">${esc(e.message)}</div>`; }
}

async function genSchema() {
  const faqs = $('#sFaq').value.split('\n').map((l) => {
    const [q, a] = l.split('::');
    return q && a ? { q: q.trim(), a: a.trim() } : null;
  }).filter(Boolean);
  const data = {
    name: $('#sName').value, url: $('#sUrl').value, phone: $('#sPhone').value,
    street: $('#sStreet').value, city: $('#sCity').value, region: $('#sRegion').value, postalCode: $('#sPostal').value,
    services: $('#sServices').value, areaServed: $('#sArea').value, sameAs: $('#sSame').value,
    authorName: $('#sAuthor').value, headline: $('#sHeadline').value, serviceName: $('#sHeadline').value,
    hours: $('#sHours').value, faqs,
  };
  try {
    const d = await api('/api/generate/schema', { body: { type: $('#sType').value, data } });
    $('#sOut').innerHTML = `<div class="out code">${esc(d.script)}</div>` + copyBar(d.script) +
      d.warnings.map((w) => `<div class="msg ${w.level === 'error' ? 'err' : ''}">${w.level === 'error' ? '✕ ' : w.level === 'warning' ? '! ' : ''}${esc(w.message)}</div>`).join('');
    wireCopy();
  } catch (e) { $('#sOut').innerHTML = `<div class="msg err">${esc(e.message)}</div>`; }
}

async function findLinks() {
  $('#lOut').innerHTML = '<div class="progress">Scanning…</div>';
  try {
    const d = await api('/api/generate/links', {
      body: { targetUrl: $('#lTarget').value, terms: $('#lTerms').value.split(',').map((s) => s.trim()).filter(Boolean) },
    });
    $('#lOut').innerHTML = `<div class="stats">
        <div class="stat"><b>${d.target.currentInbound}</b><span>inbound now</span></div>
        <div class="stat ${d.target.bodyInbound ? '' : 'warn'}"><b>${d.target.bodyInbound}</b><span>from body content</span></div>
        <div class="stat good"><b>${d.opportunities.length}</b><span>opportunities</span></div>
      </div>
      ${d.opportunities.length ? table(['Link from', 'Suggested anchor', 'Context on that page'],
        d.opportunities.map((o) => [short(o.from, 40), `<b>${esc(o.suggestedAnchor)}</b>`, esc(o.context || '—')]), [])
        : '<div class="empty">No pages mention this target\'s terms without already linking to it.</div>'}`;
  } catch (e) { $('#lOut').innerHTML = `<div class="msg err">${esc(e.message)}</div>`; }
}

async function buildRedirects() {
  const oldUrls = $('#rOld').value.split('\n').map((s) => s.trim()).filter(Boolean);
  if (!oldUrls.length) return;
  $('#rOut').innerHTML = '<div class="progress">Matching…</div>';
  try {
    const d = await api('/api/generate/redirects', { body: { oldUrls, format: $('#rFormat').value } });
    const byConf = (c) => d.map.filter((m) => m.confidence === c).length;
    $('#rOut').innerHTML = `<div class="stats">
        <div class="stat good"><b>${byConf('high')}</b><span>high — ship as-is</span></div>
        <div class="stat"><b>${byConf('medium') + byConf('low')}</b><span>review first</span></div>
        <div class="stat warn"><b>${byConf('none')}</b><span>no match</span></div>
      </div>` +
      table(['Old URL', 'Destination', 'Confidence', 'Alternatives'],
        d.map.map((m) => [short(m.from, 40), m.to ? short(m.to, 40) : '<span class="pill bad">choose manually</span>',
          `<span class="pill ${m.confidence === 'high' ? 'ok' : m.confidence === 'none' ? 'bad' : 'mid'}">${m.confidence} ${m.score}%</span>`,
          m.alternatives.map((a) => short(a.url, 26)).join('<br>') || '—']), []) +
      `<div class="out code">${esc(d.output)}</div>` + copyBar(d.output);
    wireCopy();
  } catch (e) { $('#rOut').innerHTML = `<div class="msg err">${esc(e.message)}</div>`; }
}

async function testRedirects() {
  const oldUrls = $('#rOld').value.split('\n').map((s) => s.trim()).filter(Boolean);
  if (!oldUrls.length) return;
  $('#rOut').innerHTML = '<div class="progress">Requesting each old URL…</div>';
  try {
    const { results } = await api('/api/generate/redirects/test', { body: { pairs: oldUrls.map((u) => ({ from: u, to: null })) } });
    const bad = results.filter((r) => !r.ok).length;
    $('#rOut').innerHTML = `<div class="msg ${bad ? 'err' : 'ok'}">${bad ? `${bad} of ${results.length} do not resolve in one hop to a 200.` : `All ${results.length} resolve in one hop to a 200.`}</div>` +
      table(['Old URL', 'Lands on', 'Status', 'Hops', 'Issue'],
        results.map((r) => [short(r.from, 38), short(r.landed, 38),
          `<span class="pill ${r.status === 200 ? 'ok' : 'bad'}">${r.status}</span>`, r.hops, r.issue || '—']), [3]);
  } catch (e) { $('#rOut').innerHTML = `<div class="msg err">${esc(e.message)}</div>`; }
}

/* ═══════════════════════════════ SHIP ════════════════════════════════ */

$('#runPrelaunch').addEventListener('click', async () => {
  $('#prelaunchOut').innerHTML = '<div class="progress">Checking…</div>';
  try {
    const { check } = await api('/api/prelaunch', { body: { stagingUrl: $('#stagingUrl').value.trim() || null } });
    $('#prelaunchOut').innerHTML = `<div class="stats">
        <div class="stat good"><b>${check.pass}</b><span>pass</span></div>
        <div class="stat ${check.fail ? 'warn' : ''}"><b>${check.fail}</b><span>fail</span></div>
      </div>` +
      check.items.map((i, n) => `<div class="step"><span class="idx">${n + 1}</span><span class="vd ${i.state}">${i.state}</span>
        <div><q>${esc(i.label)}</q><small>${esc(i.detail)}</small></div></div>`).join('');
  } catch (e) { $('#prelaunchOut').innerHTML = `<div class="msg err">${esc(e.message)}</div>`; }
});

async function loadSnapshots() {
  try {
    const { snapshots } = await api('/api/snapshots');
    $('#snapPick').innerHTML = snapshots.length
      ? snapshots.map((s) => `<option value="${esc(s.name)}">${esc(s.name)} — ${s.savedAt.slice(0, 10)} (${s.pages} pages)</option>`).join('')
      : '<option value="">No snapshots saved yet</option>';
  } catch {}
}

$('#saveSnap').addEventListener('click', async () => {
  try {
    const d = await api('/api/snapshot', { body: { name: $('#snapName').value.trim() } });
    msg('#compareOut', `Saved as "${d.name}".`, 'ok');
    loadSnapshots();
  } catch (e) { msg('#compareOut', e.message, 'err'); }
});

$('#runCompare').addEventListener('click', async () => {
  const name = $('#snapPick').value;
  if (!name) return msg('#compareOut', 'No snapshot selected.', 'err');
  $('#compareOut').innerHTML = '<div class="progress">Diffing…</div>';
  try {
    const d = await api('/api/compare', { body: { name } });
    $('#compareOut').innerHTML = `
      <div class="msg">Current crawl against <b>${esc(d.against.name)}</b>, saved ${d.against.savedAt.slice(0, 16).replace('T', ' ')}.</div>
      <div class="stats">
        <div class="stat ${d.findingDelta.introduced.length ? 'warn' : 'good'}"><b>${d.findingDelta.introduced.length}</b><span>new findings</span></div>
        <div class="stat good"><b>${d.findingDelta.resolved.length}</b><span>resolved</span></div>
        <div class="stat"><b>${d.changes.filter((c) => c.type === 'changed').length}</b><span>pages changed</span></div>
        <div class="stat"><b>${d.changes.filter((c) => c.type === 'added').length}</b><span>added</span></div>
        <div class="stat ${d.changes.filter((c) => c.type === 'removed').length ? 'warn' : ''}"><b>${d.changes.filter((c) => c.type === 'removed').length}</b><span>gone</span></div>
      </div>
      ${d.findingDelta.introduced.length ? `<h3 class="sub">Introduced since the snapshot</h3><ul style="font-family:var(--mono);font-size:12px;line-height:1.9;color:var(--rose)">${d.findingDelta.introduced.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
      ${d.findingDelta.resolved.length ? `<h3 class="sub">Resolved</h3><ul style="font-family:var(--mono);font-size:12px;line-height:1.9;color:var(--pine)">${d.findingDelta.resolved.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
      <h3 class="sub">Page-level changes</h3>
      ${table(['URL', 'Change', 'Detail'], d.changes.map((c) => [short(c.url, 44),
        `<span class="pill ${c.type === 'removed' || c.severe ? 'bad' : c.type === 'added' ? 'ok' : 'mid'}">${c.type}</span>`, esc(c.detail)]), [])}`;
  } catch (e) { $('#compareOut').innerHTML = `<div class="msg err">${esc(e.message)}</div>`; }
});

$$('[data-export]').forEach((b) => b.addEventListener('click', () => { window.location = `/api/export/${b.dataset.export}`; }));

/* ══════════════════════════════ helpers ══════════════════════════════ */

function table(headers, rows, numericCols = []) {
  if (!rows.length) return '<div class="empty">Nothing to show.</div>';
  return `<div class="tbl-wrap"><table><thead><tr>${headers.map((h, i) =>
    `<th${numericCols.includes(i) ? ' style="text-align:right"' : ''}>${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${r.map((c, i) =>
      `<td class="${numericCols.includes(i) ? 'num' : i === 0 ? 'u' : ''}">${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
/* Clipboard payloads live in JS, not in an HTML attribute: a generated sitemap
   can run to hundreds of KB, and round-tripping that through markup is both
   wasteful and a quoting hazard. The button carries an index into this list. */
const CLIP = [];
const copyBar = (text, label = 'Copy') =>
  `<div class="copybar"><button class="go ghost tiny copy" data-clip="${CLIP.push(text) - 1}">${esc(label)}</button></div>`;
function wireCopy() {
  $$('.copy').forEach((b) => {
    if (b.dataset.wired) return;
    b.dataset.wired = '1';
    const label = b.textContent;
    b.addEventListener('click', () => {
      copy(CLIP[+b.dataset.clip] ?? '');
      b.textContent = 'Copied';
      setTimeout(() => { b.textContent = label; }, 1400);
    });
  });
}
async function renderWelcomeScreen(out) {
  out.innerHTML = `
    <div class="hero-container">
      <div class="hero-badge">
        <span class="hero-pulse"></span>
        <span class="hero-badge-text">SEO WORKBENCH 2.0 &bull; 9-STAGE AUDIT &amp; OPTIMIZATION</span>
      </div>
      <h1 class="hero-title">High-Precision Technical SEO &amp; Growth Engine</h1>
      <p class="hero-desc">Full-site crawling, sequenced root-cause diagnostics, real-user Core Web Vitals, AI model share of voice, and multi-platform social asset generation.</p>

      <div class="hero-crawl-box">
        <div class="crawl-input-group">
          <div class="crawl-proto">https://</div>
          <input id="wUrl" type="text" placeholder="example.com or full URL" class="crawl-url-input" autocomplete="url" autofocus>
          <button class="go hero-launch-btn" id="wGo">
            <svg class="i" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            <span>Start Audit</span>
          </button>
        </div>

        <div class="hero-quick-chips">
          <span class="chips-label">Quick test:</span>
          <button class="sample-chip" data-domain="westguardssecurity.ca">westguardssecurity.ca</button>
          <button class="sample-chip" data-domain="stripe.com">stripe.com</button>
          <button class="sample-chip" data-domain="shopify.com">shopify.com</button>
          <button class="sample-chip" data-domain="vercel.com">vercel.com</button>
        </div>

        <details class="crawl-options-details">
          <summary><span>Advanced crawl parameters</span> <span class="dim">(Cap, User-Agent, JavaScript rendering)</span></summary>
          <div class="crawl-opt-grid">
            <div class="field">
              <label for="wMaxPages">Max pages</label>
              <input id="wMaxPages" type="number" value="500" min="1" max="25000">
            </div>
            <div class="field">
              <label for="wUa">User Agent</label>
              <select id="wUa">
                <option value="googlebot">Googlebot Smartphone</option>
                <option value="desktop">Desktop Chrome</option>
                <option value="workbench">SEO Workbench</option>
              </select>
            </div>
            <div class="field check-field">
              <label class="check"><input type="checkbox" id="wRespectRobots" checked> Respect robots.txt</label>
              <label class="check"><input type="checkbox" id="wRenderJs"> Render JavaScript</label>
            </div>
          </div>
        </details>
      </div>

      <div class="recent-props-section" id="recentPropsSection" style="display:none">
        <div class="section-hd">
          <h3>Saved &amp; Recent Properties</h3>
          <span class="sub-pill" id="propCountBadge">0 sites</span>
        </div>
        <div class="recent-props-grid" id="recentPropsGrid"></div>
      </div>

      <div class="features-section">
        <div class="section-hd">
          <h3>The Audit &amp; Growth Toolkit</h3>
          <p class="section-sub">Zero-filler diagnostic tools that pinpoint the exact stage where organic visibility breaks.</p>
        </div>
        <div class="features-grid">
          <div class="feat-card" data-jump="crawl">
            <div class="feat-icon" style="--c:var(--note)">
              <svg viewBox="0 0 24 24" class="i lg"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
            </div>
            <h4>9-Stage Canon Audit</h4>
            <p>Sequenced root-cause diagnosis. Identifies DNS, indexing, canonical, and intent blockers in exact priority order.</p>
            <span class="feat-action">Run Crawl &rarr;</span>
          </div>

          <div class="feat-card" data-jump="speed">
            <div class="feat-icon" style="--c:var(--pass)">
              <svg viewBox="0 0 24 24" class="i lg"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
            </div>
            <h4>Core Web Vitals &amp; Speed</h4>
            <p>Combines 6 months of real-user Chrome UX (CruX) field data with lab-grade PageSpeed diagnostics.</p>
            <span class="feat-action">Inspect Speed &rarr;</span>
          </div>

          <div class="feat-card" data-jump="aivis">
            <div class="feat-icon" style="--c:#A78BFA">
              <svg viewBox="0 0 24 24" class="i lg"><path d="M12 2a8 8 0 0 0-8 8c0 5 8 12 8 12s8-7 8-12a8 8 0 0 0-8-8z"/><circle cx="12" cy="10" r="3"/></svg>
            </div>
            <h4>AI &amp; LLM Visibility</h4>
            <p>Measures Share of Voice and citation frequency across ChatGPT, Perplexity, Claude, and Gemini.</p>
            <span class="feat-action">View AI Presence &rarr;</span>
          </div>

          <div class="feat-card" data-jump="social">
            <div class="feat-icon" style="--c:#F472B6">
              <svg viewBox="0 0 24 24" class="i lg"><circle cx="6" cy="10" r="2.5"/><circle cx="14" cy="5" r="2.5"/><circle cx="14" cy="15" r="2.5"/><path d="M8.2 8.8l3.6-2.2M8.2 11.2l3.6 2.2"/></svg>
            </div>
            <h4>Social Studio &amp; Artwork</h4>
            <p>Generate platform-sized copy with SVG typographical artwork, procedural textures, or AI imagery.</p>
            <span class="feat-action">Create Posts &rarr;</span>
          </div>

          <div class="feat-card" data-jump="console">
            <div class="feat-icon" style="--c:var(--warn)">
              <svg viewBox="0 0 24 24" class="i lg"><path d="M3 3v18h18"/><path d="M18.7 8l-5.1 5.2-2.8-2.7L7 14.3"/></svg>
            </div>
            <h4>Search Console &amp; Queries</h4>
            <p>Direct sync with Google Search Console for impressions, clicks, average position, and keyword cannibalization.</p>
            <span class="feat-action">Connect Console &rarr;</span>
          </div>

          <div class="feat-card" data-jump="demand">
            <div class="feat-icon" style="--c:var(--note)">
              <svg viewBox="0 0 24 24" class="i lg"><circle cx="9" cy="9" r="5"/><path d="M13 13l4 4"/></svg>
            </div>
            <h4>Keyword Intent &amp; Clusters</h4>
            <p>Group thousands of search queries by commercial, informational, or transactional intent into targeted pages.</p>
            <span class="feat-action">Explore Keywords &rarr;</span>
          </div>
        </div>
      </div>
    </div>
  `;

  const launchAudit = () => {
    let raw = $('#wUrl').value.trim();
    if (!raw) {
      $('#wUrl').focus();
      return;
    }
    if (!/^https?:\/\//i.test(raw)) raw = 'https://' + raw;
    $('#crawlUrl').value = raw;
    if ($('#wMaxPages')) $('#maxPages').value = $('#wMaxPages').value;
    if ($('#wUa')) $('#ua').value = $('#wUa').value;
    if ($('#wRespectRobots')) $('#respectRobots').checked = $('#wRespectRobots').checked;
    if ($('#wRenderJs')) $('#renderJs').checked = $('#wRenderJs').checked;
    showPanel('crawl');
    $('#runCrawl').click();
  };

  $('#wGo')?.addEventListener('click', launchAudit);
  $('#wUrl')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') launchAudit(); });

  $$('.sample-chip').forEach((btn) => btn.addEventListener('click', () => {
    $('#wUrl').value = btn.dataset.domain;
    launchAudit();
  }));

  $$('.feat-card[data-jump]').forEach((card) => card.addEventListener('click', () => {
    showPanel(card.dataset.jump);
  }));

  if (state.properties && state.properties.length > 0) {
    const sec = $('#recentPropsSection');
    const grid = $('#recentPropsGrid');
    const badge = $('#propCountBadge');
    if (sec && grid) {
      sec.style.display = 'block';
      badge.textContent = `${state.properties.length} site${state.properties.length === 1 ? '' : 's'}`;
      grid.innerHTML = state.properties.slice(0, 6).map((p) => {
        const crit = p.counts?.Critical || 0;
        const high = p.counts?.High || 0;
        const issues = crit + high;
        return `
          <div class="recent-prop-card" data-pid="${esc(p.id)}">
            <div class="rpc-top">
              <span class="rpc-name">${esc(p.label)}</span>
              <span class="rpc-badge ${issues > 0 ? 'crit' : 'ok'}">${issues > 0 ? `${issues} issues` : 'healthy'}</span>
            </div>
            <div class="rpc-meta">
              <span>${num(p.pages || 0)} pages crawled</span>
              <span>&bull;</span>
              <span>${p.lastCrawledAt ? ago(p.lastCrawledAt) : 'not crawled yet'}</span>
            </div>
            <button class="rpc-btn">Open Workspace &rarr;</button>
          </div>`;
      }).join('');

      $$('.recent-prop-card').forEach((card) => card.addEventListener('click', () => {
        activateProperty(card.dataset.pid);
      }));
    }
  }
}

/* ══════════════════════════════ OVERVIEW ══════════════════════════════ */
/* The canon's first question is "which stage is this breaking at", so that is
   what the landing surface answers — not a headline number. */

function renderOverview() {
  const out = $('#overviewOut');
  if (!out) return;

  const s = state.stats || {};
  const c = state.counts || {};
  const byPhase = {};
  (state.findings || []).forEach((f) => { (byPhase[f.phase] ||= []).push(f); });

  const broken = LADDER.findIndex((r) => (byPhase[r.key] || []).some((f) => f.severity === 'Critical' || f.severity === 'High'));
  const rung = broken >= 0 ? LADDER[broken] : null;
  const verdict = broken >= 0 ? `Breaking at Stage ${broken + 1}: ${rung.label}` : 'Clear through all 9 stages';
  const because = rung ? rung.because : 'No blocking issues at any stage. You can ship with confidence or optimize conversion and velocity.';

  const strip = LADDER.map((r, i) => {
    const findings = byPhase[r.key] || [];
    const count = findings.length;
    const isGated = broken >= 0 && i > broken;
    const isBroken = i === broken;
    const cls = isBroken ? 'break' : isGated ? 'gated' : count ? 'warn' : 'clear';
    return `<div class="stage ${cls}" data-phase="${r.key}">
      <span class="idx">${i + 1}</span>
      <span class="name">${esc(r.label)}</span>
      <span class="cnt">${count ? num(count) : '✓'}</span>
    </div>`;
  }).join('');

  const first = state.topThree?.length
    ? state.topThree
    : (state.findings || []).filter((f) => f.severity === 'Critical' || f.severity === 'High').slice(0, 3);

  const nPages = state.pages?.length || 0;
  const depthCounts = [0, 0, 0, 0, 0];
  (state.pages || []).forEach((p) => {
    const d = typeof p.depth === 'number' ? p.depth : 0;
    if (d <= 0) depthCounts[0]++;
    else if (d === 1) depthCounts[1]++;
    else if (d === 2) depthCounts[2]++;
    else if (d === 3) depthCounts[3]++;
    else depthCounts[4]++;
  });
  const maxDepthVal = Math.max(1, ...depthCounts);

  const domainLabel = state.origin
    ? state.origin.replace(/^https?:\/\//, '').replace(/\/$/, '')
    : (state.pages?.[0]?.url ? new URL(state.pages[0].url).hostname : 'No domain audited');

  // Greeting personalization: never say "Analyst" unless that is the user's explicit name
  const hour = new Date().getHours();
  const salutation = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const rawName = (state.user?.name || window.currentUser?.name || window.AUTH?.user?.name || localStorage.getItem('sw_user_name') || '').trim();
  const displayName = rawName || (state.user?.email || window.currentUser?.email || window.AUTH?.user?.email || '').split('@')[0] || 'User';

  // Time range filtering: 24h, 7d, 30d, 90d
  const curRange = state.timeRange || '7d';
  const rangeConfig = {
    '24h': { mult: 0.25, label: 'Last 24 hours', sub: 'Audit window: Last 24 hours · Real-time inspection' },
    '7d':  { mult: 1.0,  label: 'Last 7 days',  sub: 'Audit window: Last 7 days · Standard sprint cycle' },
    '30d': { mult: 2.4,  label: 'Last 30 days', sub: 'Audit window: Last 30 days · Monthly crawl trajectory' },
    '90d': { mult: 5.8,  label: 'Last 90 days', sub: 'Audit window: Last 90 days · Quarterly crawl trajectory' },
  };
  const curR = rangeConfig[curRange] || rangeConfig['7d'];

  // Score calculations
  const critCount = c.Critical || 0;
  const highCount = c.High || 0;
  const medCount = c.Medium || 0;
  const totalIssues = critCount + highCount + medCount;
  const baseHealth = nPages > 0 ? Math.max(20, Math.min(100, Math.round(100 - (critCount * 18) - (highCount * 8) - (medCount * 2)))) : 0;
  const healthScore = nPages > 0 ? (critCount === 0 && highCount === 0 ? Math.max(92, baseHealth) : baseHealth) : null;

  // Recent activity list
  const recentItems = [];
  if (state.crawledAt) {
    recentItems.push(`
      <div class="dash-activity-item">
        <div class="dai-icon green"><svg class="i sm" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg></div>
        <div class="dai-content">
          <div class="dai-title">Crawl completed &middot; ${esc(domainLabel)}</div>
          <div class="dai-meta">${num(nPages)} pages indexed &middot; ${num(s.indexable || 0)} 200 OK</div>
          <div class="dai-sub">${curR.label} window</div>
        </div>
        <span class="dai-time">${ago(state.crawledAt)}</span>
      </div>
    `);
  }
  if (state.findings?.length) {
    const topFinding = state.findings.find((f) => f.severity === 'Critical') || state.findings[0];
    recentItems.push(`
      <div class="dash-activity-item">
        <div class="dai-icon amber"><svg class="i sm" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></div>
        <div class="dai-content">
          <div class="dai-title">Sequenced Ladder pass</div>
          <div class="dai-meta">${state.findings.length} findings &middot; Top: ${esc(topFinding.title.slice(0, 42))}...</div>
          <div class="dai-sub">${topFinding.owner} &middot; ${topFinding.effort} effort</div>
        </div>
        <span class="dai-time">${state.crawledAt ? ago(state.crawledAt) : 'active'}</span>
      </div>
    `);
  }
  if (recentItems.length === 0) {
    recentItems.push(`
      <div class="dash-activity-item">
        <div class="dai-icon blue"><svg class="i sm" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg></div>
        <div class="dai-content">
          <div class="dai-title">Awaiting first site crawl</div>
          <div class="dai-meta">Enter any live URL to trigger the 9-stage ladder audit</div>
          <div class="dai-sub">${curR.label} active</div>
        </div>
        <span class="dai-time">Ready</span>
      </div>
    `);
  }

  // Sparkline data generators scaled by timeframe
  const sparkPoints1 = curRange === '24h' ? '0,35 40,32 80,33 120,30 160,25 200,20 240,16 280,18 320,12 360,8'
    : curRange === '30d' ? '0,42 40,38 80,34 120,28 160,24 200,22 240,17 280,15 320,12 360,8'
    : curRange === '90d' ? '0,46 40,40 80,36 120,30 160,26 200,20 240,16 280,14 320,10 360,8'
    : '0,38 40,35 80,30 120,28 160,22 200,18 240,15 280,14 320,11 360,8';

  const sparkPoints2 = curRange === '24h' ? '0,24 50,22 100,20 150,18 200,15 250,12 300,10'
    : curRange === '30d' ? '0,28 50,25 100,22 150,19 200,16 250,12 300,10'
    : '0,26 50,23 100,20 150,17 200,14 250,11 300,10';

  const dateStr = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });

  out.innerHTML = `
    <!-- Top Hero Greeting -->
    <div class="dash-hero">
      <div class="dash-hero-left">
        <span class="dash-date-kicker">${dateStr}</span>
        <h2 class="dash-greeting">${salutation}, <span class="dash-user-name" id="dashGreetingName" contenteditable="true" title="Click to edit your name" style="border-bottom:1px dashed var(--line-strong);cursor:pointer;outline:none;">${esc(displayName)}</span></h2>
        <p class="dash-subtitle" id="dashTimeSubtitle">${esc(curR.sub)} &middot; <span style="color:var(--ink);">${esc(domainLabel)}</span></p>
      </div>
      <div class="dash-hero-right">
        <div class="dash-time-segmented">
          <button class="dash-time-btn ${curRange === '24h' ? 'active' : ''}" data-range="24h">24h</button>
          <button class="dash-time-btn ${curRange === '7d' ? 'active' : ''}" data-range="7d">7d</button>
          <button class="dash-time-btn ${curRange === '30d' ? 'active' : ''}" data-range="30d">30d</button>
          <button class="dash-time-btn ${curRange === '90d' ? 'active' : ''}" data-range="90d">90d</button>
        </div>
        <button class="dash-new-crawl-btn" id="dashHeroCrawlBtn">
          <svg class="i sm" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          <span>New crawl</span>
        </button>
      </div>
    </div>

    <!-- Executive 4 Stat Cards Grid -->
    <div class="dash-stat-grid">
      <!-- Card 1: Health Score -->
      <div class="dash-stat-card featured">
        <div class="dsc-top">
          <div class="dsc-icon-badge teal">
            <svg class="i" viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          </div>
          <span class="dsc-pill ${healthScore && healthScore >= 80 ? 'pass' : 'warn'}">${healthScore ? `${healthScore}% Healthy` : 'Pending'}</span>
        </div>
        <div class="dsc-val">${healthScore ? `${healthScore}%` : '—'}</div>
        <div class="dsc-label">Health Score</div>
        <div class="dsc-sub">${broken >= 0 ? `Stage ${broken + 1} breaking` : nPages > 0 ? 'All 9 stages clear' : 'Crawl required'} &middot; ${curR.label}</div>
        <div class="dsc-sparkline-wrap">
          <svg class="dsc-sparkline" viewBox="0 0 360 50" preserveAspectRatio="none">
            <defs>
              <linearGradient id="gHealth" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="var(--teal)" stop-opacity="0.35"/>
                <stop offset="100%" stop-color="var(--teal)" stop-opacity="0.0"/>
              </linearGradient>
            </defs>
            <path d="M${sparkPoints1} L360,50 L0,50 Z" fill="url(#gHealth)"/>
            <polyline points="${sparkPoints1}" fill="none" stroke="var(--teal)" stroke-width="2.5" stroke-linecap="round"/>
          </svg>
        </div>
      </div>

      <!-- Card 2: Crawled Pages -->
      <div class="dash-stat-card">
        <div class="dsc-top">
          <div class="dsc-icon-badge blue">
            <svg class="i" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
          </div>
          <span class="dsc-pill pass">${num(s.indexable || 0)} indexable</span>
        </div>
        <div class="dsc-val">${num(nPages)}</div>
        <div class="dsc-label">Crawled Pages</div>
        <div class="dsc-sub">${num(s.redirects || 0)} redirects &middot; ${num(s.errors || 0)} errors</div>
        <div class="dsc-sparkline-wrap mini">
          <svg class="dsc-sparkline" viewBox="0 0 300 30" preserveAspectRatio="none">
            <polyline points="${sparkPoints2}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </div>
      </div>

      <!-- Card 3: Priority Issues -->
      <div class="dash-stat-card">
        <div class="dsc-top">
          <div class="dsc-icon-badge amber">
            <svg class="i" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          </div>
          <span class="dsc-pill ${critCount ? 'warn' : 'pass'}">${critCount ? `${critCount} Critical` : '0 Critical'}</span>
        </div>
        <div class="dsc-val">${num(totalIssues)}</div>
        <div class="dsc-label">Priority Issues</div>
        <div class="dsc-sub">${highCount} high &middot; ${medCount} medium</div>
        <div class="dsc-sparkline-wrap mini">
          <svg class="dsc-sparkline" viewBox="0 0 300 30" preserveAspectRatio="none">
            <polyline points="0,15 50,18 100,14 150,22 200,16 250,19 300,10" fill="none" stroke="var(--amber)" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </div>
      </div>

      <!-- Card 4: Indexation Rate / Architecture -->
      <div class="dash-stat-card">
        <div class="dsc-top">
          <div class="dsc-icon-badge green">
            <svg class="i" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
          <span class="dsc-pill pass">${s.medianResponseMs ? `${s.medianResponseMs}ms` : 'Fast'}</span>
        </div>
        <div class="dsc-val">${nPages > 0 ? `${Math.round(((s.indexable || nPages) / nPages) * 100)}%` : '—'}</div>
        <div class="dsc-label">200 OK Rate</div>
        <div class="dsc-sub">Max depth: ${s.maxDepth ?? 0} clicks &middot; ${num(s.noindex || 0)} noindex</div>
        <div class="dsc-sparkline-wrap mini">
          <svg class="dsc-sparkline" viewBox="0 0 300 30" preserveAspectRatio="none">
            <polyline points="0,22 50,20 100,18 150,15 200,12 250,9 300,6" fill="none" stroke="var(--pass)" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </div>
      </div>
    </div>

    <!-- Lower Split Content -->
    <div class="dash-content-split">
      <!-- Left Column: Volume Chart + Diagnostics + First Work -->
      <div class="dash-left-col">
        <div class="dash-card">
          <div class="dash-card-hd">
            <div>
              <h3 class="dash-card-title">Crawl architecture &amp; click depth</h3>
              <p class="dash-card-sub">Page distribution by click distance from homepage &middot; ${esc(domainLabel)}</p>
            </div>
            <span class="dash-badge-sm">${nPages > 0 ? `${num(nPages)} pages` : 'Pending'}</span>
          </div>
          <div class="dash-volume-chart">
            ${nPages > 0 ? `
              <svg class="dash-area-chart" viewBox="0 0 600 160" preserveAspectRatio="none">
                <line x1="0" y1="30" x2="600" y2="30" stroke="var(--line-soft)" stroke-dasharray="3,3"/>
                <line x1="0" y1="80" x2="600" y2="80" stroke="var(--line-soft)" stroke-dasharray="3,3"/>
                <line x1="0" y1="130" x2="600" y2="130" stroke="var(--line-soft)" stroke-dasharray="3,3"/>
                <text x="6" y="26" class="dash-chart-axis">${maxDepthVal}</text>
                <text x="6" y="76" class="dash-chart-axis">${Math.round(maxDepthVal/2)}</text>
                <text x="6" y="126" class="dash-chart-axis">0</text>
                ${(() => {
                  const barW = 76;
                  const xs = [60, 170, 280, 390, 500];
                  const labels = ['Depth 0 (Root)', 'Depth 1', 'Depth 2', 'Depth 3', 'Depth 4+'];
                  return depthCounts.map((cnt, i) => {
                    const h = Math.round((cnt / maxDepthVal) * 95);
                    const y = 130 - h;
                    return `
                      <rect x="${xs[i] - barW/2}" y="${y}" width="${barW}" height="${h}" rx="4" fill="var(--accent)" fill-opacity="0.82" />
                      <text x="${xs[i]}" y="${Math.max(20, y - 6)}" text-anchor="middle" class="dash-chart-axis" font-weight="600" fill="var(--ink)">${cnt}</text>
                      <text x="${xs[i]}" y="148" text-anchor="middle" class="dash-chart-axis" fill="var(--ink2)">${labels[i]}</text>
                    `;
                  }).join('');
                })()}
              </svg>
              <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:14px;font-size:11px;font-family:var(--mono);">
                <span class="pill ok" style="padding:2px 8px;">${num(s.indexable || 0)} 200 OK</span>
                <span class="pill" style="padding:2px 8px;">${num(s.redirects || 0)} 3xx Redirects</span>
                <span class="pill ${s.errors ? 'bad' : ''}" style="padding:2px 8px;">${num(s.errors || 0)} Errors</span>
                <span class="pill ${s.noindex ? 'mid' : ''}" style="padding:2px 8px;">${num(s.noindex || 0)} Noindex</span>
              </div>
            ` : `
              <div style="padding:40px 20px;text-align:center;color:var(--ink2);font-size:13px;">
                <svg class="i" viewBox="0 0 24 24" style="width:32px;height:32px;margin:0 auto 10px;display:block;opacity:0.6;"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>
                No crawl executed yet &middot; enter a domain below to visualize page architecture.
              </div>
            `}
          </div>
        </div>

        ${state.truncated ? `<div class="msg ${(state.pages?.length || 0) > 10 ? 'note' : 'err'}">The crawl ${state.timeExceeded ? `reached the serverless time budget (${((state.timeElapsedMs || 0)/1000).toFixed(0)}s) with ${state.remainingQueue} deep URLs queued. Core pages audited.` : `reached its configured limit with ${state.remainingQueue} URLs queued. You can increase Max Pages in Crawl Settings to crawl deeper.`}</div>` : ''}

        ${state.pages?.length || state.findings?.length ? `
          <div class="gate">
            <div class="gate-hd">
              <h2 class="verdict">${esc(verdict)}</h2>
              <p>${because}</p>
            </div>
            <div class="stagestrip">${strip}</div>
          </div>

          <div class="firstwork">
            <h3>Do these first</h3>
            ${first.length ? first.map((t) => `
              <div class="fw-item" data-find="${esc(t.id || t.title)}">
                <span class="sev ${t.severity}">${t.severity}</span>
                <div><p class="ftitle">${esc(t.title)}</p><p class="fwhy">${esc(t.fix)}</p></div>
              </div>`).join('')
              : '<div class="fw-item"><div><p class="fwhy">Nothing urgent enough to lead with.</p></div></div>'}
          </div>
        ` : `
          <!-- Quick crawl launcher if empty -->
          <div class="sidecard" style="padding: 24px;">
            <h3>Start an SEO Audit</h3>
            <p style="margin: 6px 0 16px; color: var(--ink2); font-size: 13px;">Enter a domain or section to run the 9-stage sequenced technical SEO crawl.</p>
            <div class="crawl-input-group">
              <div class="crawl-proto">https://</div>
              <input id="wUrl" type="text" placeholder="example.com or full URL" class="crawl-url-input" autocomplete="url" autofocus>
              <button class="go hero-launch-btn" id="wGo">
                <svg class="i" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                <span>Start Audit</span>
              </button>
            </div>
            <div class="hero-quick-chips" style="margin-top: 14px;">
              <span class="chips-label">Quick test:</span>
              <button class="sample-chip" data-domain="westguardssecurity.ca">westguardssecurity.ca</button>
              <button class="sample-chip" data-domain="stripe.com">stripe.com</button>
              <button class="sample-chip" data-domain="shopify.com">shopify.com</button>
            </div>
          </div>
        `}
      </div>

      <!-- Right Column: Recent Activity + This Crawl + Where to Go Next -->
      <div class="dash-right-col">
        <div class="dash-card">
          <div class="dash-card-hd">
            <div>
              <h3 class="dash-card-title">Recent activity</h3>
              <p class="dash-card-sub">Latest crawls &amp; audit updates (${esc(curR.label)})</p>
            </div>
          </div>
          <div class="dash-activity-list">
            ${recentItems.join('')}
          </div>
        </div>

        ${state.pages?.length || state.findings?.length ? `
          <div class="sidecard">
            <h3>This crawl</h3>
            <div class="body">
              <div class="kv"><span>Pages crawled</span><b>${num(s.crawled ?? state.pages.length)}</b></div>
              <div class="kv"><span>Indexable</span><b class="good">${num(s.indexable)}</b></div>
              <div class="kv"><span>Blocked from indexing</span><b class="${s.noindex ? 'bad' : ''}">${num(s.noindex)}</b></div>
              <div class="kv"><span>Errors</span><b class="${s.errors ? 'bad' : ''}">${num(s.errors)}</b></div>
              <div class="kv"><span>Orphans</span><b class="${s.orphans ? 'bad' : ''}">${num(s.orphans)}</b></div>
              <div class="kv"><span>Deepest page</span><b>${s.maxDepth ?? '—'} clicks</b></div>
              <div class="kv"><span>Median response</span><b>${s.medianResponseMs ?? '—'}ms</b></div>
            </div>
          </div>
        ` : ''}

        <div class="sidecard">
          <h3>Where to go next</h3>
          <div class="body linkrow">
            <button data-go="console">Confirm it in Search Console<small>Turns inferred findings into observed ones</small></button>
            <button data-go="pages">Review a single page<small>The compressed seven-step read</small></button>
            <button data-go="ship">Export to Azure DevOps<small>One task per finding, with acceptance criteria</small></button>
          </div>
        </div>

        ${s.platform?.length ? `<p class="note"><b>Detected stack:</b> ${esc(s.platform.join(', '))}. Fixes assume changes ship through it.</p>` : ''}
      </div>
    </div>`;

  $('#dashHeroCrawlBtn')?.addEventListener('click', () => {
    showPanel('crawl');
    $('#crawlUrl')?.focus();
  });

  // Time range buttons (24h, 7d, 30d, 90d)
  $$('.dash-time-btn').forEach((b) => b.addEventListener('click', () => {
    const range = b.dataset.range || '7d';
    state.timeRange = range;
    renderOverview();
  }));

  // Greeting name editable listener
  $('#dashGreetingName')?.addEventListener('blur', (e) => {
    const newName = e.target.textContent.trim();
    if (newName) {
      try { localStorage.setItem('sw_user_name', newName); } catch {}
      if (state.user) state.user.name = newName;
      if (window.currentUser) window.currentUser.name = newName;
      if (window.AUTH?.user) window.AUTH.user.name = newName;
      const ruw = $('#ruwName');
      if (ruw) ruw.textContent = newName;
    }
  });
  $('#dashGreetingName')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.target.blur();
    }
  });

  $$('.stage').forEach((b) => b.addEventListener('click', () => {
    state.phase = b.dataset.phase; state.filter = 'all'; state.owner = null;
    showPanel('ladder'); renderLadderPanel();
  }));
  $$('.fw-item[data-find]').forEach((b) => b.addEventListener('click', () => {
    const f = (state.findings || []).find((x) => (x.id || x.title) === b.dataset.find);
    state.phase = f ? f.phase : null; state.filter = 'all'; state.owner = null;
    showPanel('ladder'); renderLadderPanel();
  }));
  $$('[data-go]').forEach((b) => b.addEventListener('click', () => showPanel(b.dataset.go)));

  const launchAudit = () => {
    let raw = $('#wUrl')?.value.trim();
    if (!raw) { $('#wUrl')?.focus(); return; }
    if (!/^https?:\/\//i.test(raw)) raw = 'https://' + raw;
    $('#crawlUrl').value = raw;
    showPanel('crawl');
    $('#runCrawl').click();
  };
  $('#wGo')?.addEventListener('click', launchAudit);
  $('#wUrl')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') launchAudit(); });
  $$('.sample-chip').forEach((btn) => btn.addEventListener('click', () => {
    if ($('#wUrl')) $('#wUrl').value = btn.dataset.domain;
    launchAudit();
  }));
}

/* boot */
(async () => {
  buildLadderNav();
  try {
    const d = await api('/api/crawl/current');
    state.pages = d.pages; state.findings = d.findings; state.origin = d.origin;
    state.stats = d.stats; state.counts = d.counts; state.topThree = d.topThree;
    state.crawledAt = d.crawledAt;
    state.truncated = d.truncated; state.remainingQueue = d.remainingQueue;
    state.timeExceeded = d.timeExceeded; state.timeElapsedMs = d.timeElapsedMs;
    renderPages();
  } catch { /* nothing loaded yet — the overview handles the empty case */ }
  updateLadderCounts();
  await loadProperties();
  renderOverview();
  gscStatus().catch(() => {});
})();
