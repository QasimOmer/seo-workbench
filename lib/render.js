/* Rendered crawling and real Web Vitals, via the user's own Chrome.
   playwright-core (Apache-2.0) deliberately ships no browser binary — it drives
   an installed one. That is the right trade here: no 150MB download, and anyone
   running this already has Chrome.

   Two gaps close at once:
     1. Client-rendered sites. The fetch crawler sees an empty <div id="root">
        and can only report "no content in the HTML source" — true, but it
        cannot audit the page a user actually gets.
     2. Lab performance without a quota. Measuring LCP, CLS and TTFB in-page
        with PerformanceObserver needs no API key and has no daily limit, which
        was the practical problem with PageSpeed.

   Everything degrades: if no browser is found, callers fall back to the fetch
   path and the reason is surfaced rather than swallowed. */

let pw = null, cachedProbe = null;

async function playwright() {
  if (pw) return pw;
  try { pw = (await import('playwright-core')).default ?? await import('playwright-core'); }
  catch { throw new Error('playwright-core is not installed. Run: npm install playwright-core'); }
  return pw;
}

/* Channels in preference order. 'chrome' uses the stable install, which is what
   almost everyone has; msedge is a common fallback on Windows. */
const CHANNELS = ['chrome', 'msedge', 'chrome-beta'];

/** Which browser, if any, can we drive? Cached — probing launches a process. */
export async function probe({ force = false } = {}) {
  if (cachedProbe && !force) return cachedProbe;
  let p;
  try { p = await playwright(); }
  catch (e) { return (cachedProbe = { available: false, reason: e.message }); }

  for (const channel of CHANNELS) {
    let browser;
    try {
      browser = await p.chromium.launch({ channel, headless: true });
      const v = browser.version();
      await browser.close();
      return (cachedProbe = { available: true, channel, version: v });
    } catch {
      try { await browser?.close(); } catch { /* already gone */ }
    }
  }
  // Last resort: a bundled binary, if the user ran `playwright install`.
  try {
    const browser = await p.chromium.launch({ headless: true });
    const v = browser.version();
    await browser.close();
    return (cachedProbe = { available: true, channel: 'bundled', version: v });
  } catch (e) {
    return (cachedProbe = {
      available: false,
      reason: `No drivable Chrome found (tried ${CHANNELS.join(', ')} and a bundled binary). Install Google Chrome, or run: npx playwright install chromium. Details: ${String(e.message).split('\n')[0]}`,
    });
  }
}

/* ── a reusable browser for a whole crawl ─────────────────────────────────── */

/** One browser per crawl, one context per page. Launching per URL would make a
    100-page rendered crawl take minutes longer than it needs to. */
export async function openBrowser() {
  const info = await probe();
  if (!info.available) throw new Error(info.reason);
  const p = await playwright();
  const browser = await p.chromium.launch(
    info.channel === 'bundled' ? { headless: true } : { channel: info.channel, headless: true },
  );
  return { browser, info };
}

const VITALS_SCRIPT = `
/* Collected in-page: no API, no key, no quota. These are LAB numbers from one
   load on one machine — directionally useful, never a substitute for CrUX. */
(() => {
  window.__vitals = { lcp: null, cls: 0, fcp: null, ttfb: null, longTasks: 0 };
  try {
    const nav = performance.getEntriesByType('navigation')[0];
    if (nav) window.__vitals.ttfb = Math.round(nav.responseStart);
  } catch {}
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) window.__vitals.lcp = Math.round(e.startTime);
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  } catch {}
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) if (!e.hadRecentInput) window.__vitals.cls += e.value;
    }).observe({ type: 'layout-shift', buffered: true });
  } catch {}
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) if (e.duration > 50) window.__vitals.longTasks++;
    }).observe({ type: 'longtask', buffered: true });
  } catch {}
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) if (e.name === 'first-contentful-paint') window.__vitals.fcp = Math.round(e.startTime);
    }).observe({ type: 'paint', buffered: true });
  } catch {}
})();`;

/**
 * Renders one URL and returns the DOM as the browser built it, plus vitals and
 * the raw-vs-rendered comparison that tells you whether rendering matters here.
 */
export async function renderPage(browser, url, { ua, timeout = 25000, vitals = true, waitFor = 'load' } = {}) {
  const context = await browser.newContext({
    userAgent: ua,
    viewport: { width: 412, height: 915 },   // Googlebot smartphone-ish
    deviceScaleFactor: 2,
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  if (vitals) await page.addInitScript(VITALS_SCRIPT);

  const t0 = Date.now();
  let status = 0, headers = {}, chain = [];
  try {
    const res = await page.goto(url, { waitUntil: waitFor, timeout });
    if (res) {
      status = res.status();
      headers = res.headers();
      // Walk the redirect chain the browser followed.
      let r = res.request().redirectedFrom();
      while (r) { chain.unshift(r.url()); r = r.redirectedFrom(); }
    }
    // Give hydration a moment; networkidle alone hangs on sites that poll.
    await page.waitForTimeout(600);
    try { await page.waitForLoadState('networkidle', { timeout: 3000 }); } catch { /* polling site */ }
  } catch (e) {
    await context.close();
    return { ok: false, url, error: `Render failed: ${String(e.message).split('\n')[0]}`, responseMs: Date.now() - t0 };
  }

  const html = await page.content();
  const v = vitals ? await page.evaluate(() => window.__vitals).catch(() => null) : null;
  await context.close();

  return {
    ok: status >= 200 && status < 400,
    url: page.url ? url : url,
    finalUrl: chain.length ? url : url,
    status, headers, chain, body: html,
    responseMs: Date.now() - t0,
    rendered: true,
    vitals: v ? { ...v, cls: Math.round((v.cls || 0) * 1000) / 1000 } : null,
  };
}

/**
 * The comparison that decides whether a site needs rendered crawling at all.
 * Run on the homepage before committing to a slow full render crawl.
 */
export function renderGap(rawHtml, renderedHtml) {
  const textOf = (h) => String(h)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ').trim();
  // Strip scripts first: an inline bundle containing the string `<a href="/x">`
  // would otherwise count as a link in the source, which understates how
  // JS-dependent the page is — the direction that causes a wrong decision.
  const linksOf = (h) => new Set(
    (String(h)
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .match(/<a\b[^>]*href\s*=\s*["']([^"'#]+)/gi) || []),
  );

  const rawWords = textOf(rawHtml).split(' ').filter(Boolean).length;
  const renWords = textOf(renderedHtml).split(' ').filter(Boolean).length;
  const rawLinks = linksOf(rawHtml).size;
  const renLinks = linksOf(renderedHtml).size;

  const wordRatio = renWords ? rawWords / renWords : 1;
  const linkRatio = renLinks ? rawLinks / renLinks : 1;
  const dependent = wordRatio < 0.5 || linkRatio < 0.5;

  return {
    rawWords, renderedWords: renWords, rawLinks, renderedLinks: renLinks,
    wordRatio: Math.round(wordRatio * 100) / 100,
    linkRatio: Math.round(linkRatio * 100) / 100,
    dependent,
    verdict: dependent
      ? `This site depends on JavaScript: the HTML source carries ${rawWords} words and ${rawLinks} links, the rendered page ${renWords} and ${renLinks}. Auditing the source alone would judge a page nobody sees. Crawl with rendering on.`
      : `The HTML source already carries ${Math.round(wordRatio * 100)}% of the rendered words and ${Math.round(linkRatio * 100)}% of the links. Rendering is not needed here — the plain crawl is faster and sees the same page.`,
  };
}

/** Print an HTML report to PDF using the same browser. */
export async function htmlToPdf(html, { format = 'A4' } = {}) {
  const { browser } = await openBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    await page.waitForTimeout(400);
    return await page.pdf({
      format, printBackground: true,
      margin: { top: '16mm', bottom: '16mm', left: '14mm', right: '14mm' },
    });
  } finally {
    await browser.close();
  }
}

export const _renderGap = renderGap;
