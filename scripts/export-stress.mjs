/**
 * Stress, performance and leak suite for "Save as PNG / PDF", on a desktop window and an emulated phone.
 *
 * Drives the real built extension in Chromium: long pages, the height cap, repeated exports, cancelling by key and by touch,
 * infinite-scroll and very large DOMs. Checks output correctness, page frame times, heap, DOM nodes and leftover listeners.
 *
 * Usage: pnpm build && node scripts/export-stress.mjs
 * Env: PA_EXT_DIR=<built extension dir>, PA_RESULTS_FILE=<file name>, PA_PROFILES=desktop,mobile, PA_ONLY=<scenario>[,...]
 */
import { chromium } from '@playwright/test';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { inflateSync } from 'zlib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const EXT = process.env.PA_EXT_DIR ? path.resolve(process.env.PA_EXT_DIR) : path.join(ROOT, '.output', 'chrome-mv3');
const RESULTS_FILE = process.env.PA_RESULTS_FILE || 'export-stress-results.json';

const PROFILES = {
  desktop: { viewport: { width: 1280, height: 800 } },
  // Galaxy Note20 Ultra class phone, the device the feature was first tested on.
  mobile: { viewport: { width: 412, height: 883 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true },
};

const results = [];
function record(profile, name, pass, metrics) {
  results.push({ profile, name, pass, metrics });
  console.log(`${pass ? 'PASS' : 'FAIL'}  [${profile}] ${name}  ${JSON.stringify(metrics)}`);
}

// ---------------------------------------------------------------- pages

const card = (i) =>
  `<article class="card" style="box-sizing:border-box;height:98px;margin:0 0 24px;padding:12px;border:1px solid #cbd5e1;border-radius:8px;background:hsl(${(i * 37) % 360} 70% 92%)"><h2 style="margin:0 0 6px;font-size:16px">Item ${i}</h2><p style="margin:0">Row ${i} body text.</p></article>`;

const shell = (title, body, extra = '') => `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
<style>body{margin:0;font-family:sans-serif}main{padding:16px}header{position:sticky;top:0;height:48px;background:#1e293b;color:#fff;z-index:5}</style>
</head><body><header>Sticky header</header><main id="main">${body}</main>${extra}</body></html>`;

const cards = (n) => Array.from({ length: n }, (_, i) => card(i)).join('');

const INFINITE = `<script>
window.__batches = 0;
const main = document.getElementById('main');
let next = 40;
new IntersectionObserver((entries) => {
  if (!entries.some((e) => e.isIntersecting) || window.__batches >= 200) return;
  window.__batches++;
  main.insertAdjacentHTML('beforeend', Array.from({ length: 20 }, () => '<article class="card" style="height:98px;margin:0 0 24px;border:1px solid #ccc">Loaded ' + next++ + '</article>').join(''));
}, { rootMargin: '400px' }).observe(document.getElementById('sentinel'));
</script>`;

const pages = {
  '/long': shell('Long page', cards(280)),
  '/medium': shell('Medium page', cards(90)),
  '/huge': shell('Huge page', cards(500)),
  '/infinite': shell('Infinite feed', cards(40), `<div id="sentinel" style="height:1px"></div>${INFINITE}`),
  '/dom': shell('Big DOM', Array.from({ length: 2000 }, (_, i) => `<section>${Array.from({ length: 10 }, (_, j) => `<span>${i}.${j} </span>`).join('')}</section>`).join('')),
};

// ---- edge pages: solid colour bands so the saved image can be checked pixel by pixel.

const band = (h, rgb, extra = '') => `<div style="height:${h}px;background:rgb(${rgb})${extra}"></div>`;
const BANDS = band(1000, '0,0,255') + band(1000, '0,255,0') + band(980, '0,0,0') + band(10, '255,255,0') + band(10, '0,0,0');
const bandsPage = (title, head = '', body = BANDS) =>
  `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>${head}</head><body style="margin:0">${body}</body></html>`;

Object.assign(pages, {
  '/csp': bandsPage('Strict CSP'),
  '/smooth': bandsPage('Smooth', '<style>html{scroll-behavior:smooth;scroll-snap-type:y mandatory}div{scroll-snap-align:start}</style>'),
  '/wide': bandsPage(
    'Wide',
    '',
    `<div style="width:2600px;height:1500px;display:flex"><div style="width:1300px;background:rgb(0,255,0)"></div><div style="width:1300px;background:rgb(0,0,255)"></div></div>`
  ),
  '/tiny': bandsPage('Tiny', '', band(200, '0,255,0')),
  '/inner': bandsPage(
    'Inner scroller',
    '<style>html,body{height:100%;overflow:hidden}</style>',
    `<div style="height:100%;overflow:auto">${BANDS}</div>`
  ),
  '/locked': bandsPage('Locked window', '<style>html{overflow:hidden}</style>'),
  '/quirks': `<html><head><title>Quirks</title></head><body style="margin:0">${BANDS}</body></html>`,
  '/lazy': bandsPage(
    'Lazy images',
    '',
    `${band(2500, '0,0,255')}<img src="/slow.svg" loading="lazy" width="300" height="200" style="display:block">${band(1500, '0,0,0')}`
  ),
});

const SLOW_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="200" fill="rgb(255,0,255)"/></svg>';

const server = http.createServer((req, res) => {
  const p = (req.url || '/').split('?')[0];
  if (p === '/slow.svg') {
    // Like a real image host: the picture arrives a little after the page scrolls to it.
    setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' });
      res.end(SLOW_SVG);
    }, 400);
    return;
  }
  const headers = { 'Content-Type': 'text/html; charset=utf-8' };
  if (p === '/csp') headers['Content-Security-Policy'] = "default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; connect-src 'none'";
  res.writeHead(200, headers);
  res.end(pages[p] ?? pages['/medium']);
});
const port = await new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const origin = `http://127.0.0.1:${port}`;

// ---------------------------------------------------------------- helpers

const pct = (a, p) => (a.length ? +[...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor((p / 100) * a.length))].toFixed(1) : null);
const mb = (bytes) => +(bytes / 1048576).toFixed(2);

async function metrics(cdp) {
  const { metrics } = await cdp.send('Performance.getMetrics');
  return Object.fromEntries(metrics.map((m) => [m.name, m.value]));
}

async function settledMetrics(cdp) {
  await cdp.send('HeapProfiler.collectGarbage');
  await cdp.send('HeapProfiler.collectGarbage');
  return metrics(cdp);
}

/** Listeners on window and document in the page and in the extension's isolated world, by type; leftovers are what would keep slowing the page. */
async function rootListeners(cdp) {
  const counts = {};
  const worlds = [undefined, ...(cdp.__isolated ?? [])];
  for (const [world, expression] of worlds.flatMap((w) => [[w, 'window'], [w, 'document']])) {
    const { result } = await cdp.send('Runtime.evaluate', { expression, ...(world === undefined ? {} : { contextId: world }) });
    const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId });
    for (const l of listeners) counts[l.type] = (counts[l.type] ?? 0) + 1;
  }
  return counts;
}

/** Screenshot pixels per CSS pixel; on Windows with display scaling this is the OS scale, not the emulated devicePixelRatio. */
async function captureScale(page, sw) {
  // Same rule as the extension: the visual viewport plus a classic scrollbar, never a phone's enlarged innerWidth.
  const innerWidth = await page.evaluate(() => {
    const width = window.visualViewport?.width ?? document.documentElement.clientWidth;
    return window.innerWidth - width <= 40 ? window.innerWidth : width;
  });
  await page.bringToFront();
  // Chrome allows two screenshots per second, and an export may have just used them.
  await page.waitForTimeout(1100);
  const dataUrl = await sw.evaluate(() => chrome.tabs.captureVisibleTab({ format: 'png' }));
  return pngSize(Buffer.from(dataUrl.split(',')[1], 'base64')).width / innerWidth;
}

function pngSize(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/** Decodes the RGB, Up-filtered PNGs the extension writes; `at(x, y)` takes CSS pixels at `scale`. */
function decodePng(buffer, scale = 1) {
  const { width, height } = pngSize(buffer);
  const idat = [];
  for (let at = 8; at < buffer.length; ) {
    const len = buffer.readUInt32BE(at);
    if (buffer.toString('latin1', at + 4, at + 8) === 'IDAT') idat.push(buffer.subarray(at + 8, at + 8 + len));
    at += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 3;
  const rgb = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let i = 0; i < stride; i++) {
      const v = raw[y * (stride + 1) + 1 + i];
      rgb[y * stride + i] = filter === 2 ? (v + (y ? rgb[(y - 1) * stride + i] : 0)) & 0xff : v;
    }
  }
  const at = (x, y) => {
    const px = Math.min(width - 1, Math.round(x * scale));
    const py = Math.min(height - 1, Math.round(y * scale));
    const i = (py * width + px) * 3;
    return [rgb[i], rgb[i + 1], rgb[i + 2]];
  };
  return { width, height, at };
}

const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= 16);

/** Inline styles the export might have left on page elements. */
const leftoverStyles = (page) =>
  page.evaluate(
    () => [...document.querySelectorAll('[style]')].filter((el) => el.id !== 'page-anchor-host' && /visibility|scroll-behavior/.test(el.getAttribute('style') ?? '')).length
  );

// ---------------------------------------------------------------- per profile

async function runProfile(profileName) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-export-stress-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    // New headless Chromium runs extensions without opening a window; PA_HEADED=1 shows it for debugging.
    channel: 'chromium',
    headless: !process.env.PA_HEADED,
    acceptDownloads: true,
    ...PROFILES[profileName],
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  let sw = context.serviceWorkers()[0];
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 15000 });
  const rec = (name, pass, m) => record(profileName, name, pass, m);
  const pageErrors = [];

  async function open(url) {
    const page = await context.newPage();
    page.on('pageerror', (e) => pageErrors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error' && /page.?anchor|content-scripts/i.test(m.text() + (m.location()?.url ?? ''))) pageErrors.push(m.text());
    });
    const cdp = await context.newCDPSession(page);
    await cdp.send('Performance.enable');
    // Isolated worlds belong to extensions; ours is the only one loaded.
    cdp.__isolated = [];
    cdp.on('Runtime.executionContextCreated', ({ context: c }) => {
      // Only the extension's own world: Playwright adds an isolated world of its own once a locator action runs.
      if (c.auxData?.type === 'isolated' && c.origin?.startsWith('chrome-extension://')) cdp.__isolated.push(c.id);
    });
    cdp.on('Runtime.executionContextsCleared', () => (cdp.__isolated = []));
    await cdp.send('Runtime.enable');
    await page.goto(url, { waitUntil: 'load' });
    await page.bringToFront();
    // The boot script answers once it is ready.
    for (let i = 0; i < 100; i++) {
      const ready = await sw.evaluate(async (u) => {
        const tab = (await chrome.tabs.query({})).find((t) => t.url === u);
        if (tab?.id === undefined) return false;
        try {
          return !!(await chrome.tabs.sendMessage(tab.id, { type: 'PAGE_ANCHOR_GET_STATUS' }));
        } catch {
          return false;
        }
      }, page.url());
      if (ready) break;
      await page.waitForTimeout(100);
    }
    // Addressed by URL: "the active tab" can still be the previous page for a moment after bringToFront.
    for (let attempt = 0; attempt < 3; attempt++) {
      await sw.evaluate(async (u) => {
        const tab = (await chrome.tabs.query({})).find((t) => t.url === u);
        if (tab?.id) await chrome.tabs.sendMessage(tab.id, { type: 'PAGE_ANCHOR_TOGGLE' }).catch(() => {});
      }, page.url());
      const shown = await page
        .locator('#page-anchor-host .pa-toolbar')
        .waitFor({ state: 'visible', timeout: 5000 })
        .then(() => true)
        .catch(() => false);
      if (shown) break;
    }
    await page.locator('#page-anchor-host .pa-toolbar').waitFor({ state: 'visible', timeout: 5000 });
    return { page, cdp };
  }

  const pa = (page, sel) => page.locator(`#page-anchor-host ${sel}`);
  const toast = (page) => pa(page, '.pa-toast-text').last();

  async function draw(page) {
    await pa(page, '[data-tool="pen"]').click();
    const vw = page.viewportSize().width;
    if (PROFILES[profileName].hasTouch) {
      const cdpTouch = await context.newCDPSession(page);
      const pts = Array.from({ length: 8 }, (_, i) => ({ x: 40 + ((vw - 80) * i) / 7, y: 320 + (i % 2) * 20 }));
      await cdpTouch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pts[0]] });
      for (const p of pts.slice(1)) await cdpTouch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [p] });
      await cdpTouch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await cdpTouch.detach();
    } else {
      await page.mouse.move(100, 320);
      await page.mouse.down();
      await page.mouse.move(vw - 100, 340, { steps: 10 });
      await page.mouse.up();
    }
    await pa(page, '[data-tool="select"]').click();
  }

  /** Clicks Save as PNG/PDF and samples page frames, long tasks and heap until the toast appears. */
  /** `direct` presses the menu item from script, for zoomed-out phone layouts where a simulated tap lands on the wrong layer. */
  async function exportOnce(page, cdp, format, { expectDownload = true, during, direct = false } = {}) {
    await page.evaluate(() => {
      const s = { d: [], lt: [], raf: 0, obs: null };
      window.__ex = s;
      let last = performance.now();
      const loop = (t) => {
        s.d.push(t - last);
        last = t;
        s.raf = requestAnimationFrame(loop);
      };
      s.raf = requestAnimationFrame(loop);
      s.obs = new PerformanceObserver((l) => l.getEntries().forEach((e) => s.lt.push(e.duration)));
      s.obs.observe({ entryTypes: ['longtask'] });
    });
    let peakHeap = 0;
    let sampling = true;
    const sampler = (async () => {
      // Stops on its own once the page is gone, so a failed step cannot crash the whole run.
      while (sampling) {
        try {
          peakHeap = Math.max(peakHeap, (await metrics(cdp)).JSHeapUsedSize);
        } catch {
          return;
        }
        await new Promise((r) => setTimeout(r, 200));
      }
    })();
    const before = await metrics(cdp);
    if (!direct) await pa(page, '[data-action="more"]').click();
    const download = expectDownload ? page.waitForEvent('download', { timeout: 180000 }) : null;
    const t0 = Date.now();
    if (direct) {
      await page.evaluate((f) => document.getElementById('page-anchor-host').shadowRoot.querySelector(`[data-action="export-${f}"]`).click(), format);
    } else {
      await pa(page, `[data-action="export-${format}"]`).click();
    }
    if (during) await during();
    let file = null;
    if (download) {
      const d = await download;
      file = fs.readFileSync(await d.path());
    }
    await toast(page).waitFor({ state: 'visible', timeout: 180000 });
    const ms = Date.now() - t0;
    sampling = false;
    await sampler;
    const after = await metrics(cdp);
    const f = await page.evaluate(() => {
      const s = window.__ex;
      cancelAnimationFrame(s.raf);
      s.obs.disconnect();
      return { d: s.d.slice(1), lt: s.lt };
    });
    return {
      file,
      toast: await toast(page).textContent(),
      ms,
      scriptMs: Math.round((after.ScriptDuration - before.ScriptDuration) * 1000),
      frameP50: pct(f.d, 50),
      frameP95: pct(f.d, 95),
      longTasks: f.lt.length,
      maxLongTask: f.lt.length ? Math.round(Math.max(...f.lt)) : 0,
      peakHeapMb: mb(peakHeap),
      heapBeforeMb: mb(before.JSHeapUsedSize),
    };
  }

  // A long page with sticky header and drawings, saved both ways.
  async function scenarioLongPage() {
    const { page, cdp } = await open(`${origin}/long`);
    await draw(page);
    await page.evaluate(() => window.scrollTo(0, 1234));
    const scrollBefore = await page.evaluate(() => window.scrollY);
    const docH = await page.evaluate(() => document.documentElement.scrollHeight);

    const png = await exportOnce(page, cdp, 'png');
    const size = pngSize(png.file);
    const scale = await captureScale(page, sw);
    const scrollBack = await page.evaluate(() => window.scrollY);
    const leftovers = await leftoverStyles(page);
    rec(
      `PNG of a ${docH}px page`,
      png.toast === 'Page saved as PNG' && Math.abs(size.height - docH * scale) <= 2 && scrollBack === scrollBefore && leftovers === 0,
      { ...png, file: undefined, png: size, expectedHeight: Math.round(docH * scale), fileMb: mb(png.file.length), scrollBefore, scrollBack, leftovers }
    );

    const pdf = await exportOnce(page, cdp, 'pdf');
    const text = pdf.file.toString('latin1');
    const pagesCount = Number(/\/Count (\d+)/.exec(text)?.[1]);
    rec(`PDF of a ${docH}px page`, pdf.toast === 'Page saved as PDF' && text.startsWith('%PDF-1.4') && text.endsWith('%%EOF\n') && pagesCount > 1, {
      ...pdf,
      file: undefined,
      pages: pagesCount,
      fileMb: mb(pdf.file.length),
    });
    await page.close();
  }

  // Pages over the height cap are cut, and the user is told.
  async function scenarioHeightCap() {
    const { page, cdp } = await open(`${origin}/huge`);
    const r = await exportOnce(page, cdp, 'png');
    const size = pngSize(r.file);
    const cssH = size.height / (await captureScale(page, sw));
    rec('page over 40,000px is cut and says so', r.toast === 'Saved part of the page as PNG' && Math.abs(cssH - 40000) <= 2, {
      ...r,
      file: undefined,
      savedCssHeight: Math.round(cssH),
      fileMb: mb(r.file.length),
    });
    await page.close();
  }

  // Repeated exports must not grow memory, DOM or listeners.
  async function scenarioRepeatLeak() {
    const { page, cdp } = await open(`${origin}/medium`);
    await draw(page);
    await exportOnce(page, cdp, 'png');
    const base = await settledMetrics(cdp);
    const baseListeners = await rootListeners(cdp);
    const heaps = [];
    const rounds = 10;
    for (let i = 0; i < rounds; i++) {
      await exportOnce(page, cdp, i % 2 ? 'pdf' : 'png');
      heaps.push(mb((await settledMetrics(cdp)).JSHeapUsedSize));
    }
    const end = await settledMetrics(cdp);
    const endListeners = await rootListeners(cdp);
    const growthMb = mb(end.JSHeapUsedSize - base.JSHeapUsedSize);
    const sameListeners = JSON.stringify(baseListeners) === JSON.stringify(endListeners);
    rec(`${rounds} exports in a row do not leak`, growthMb < 2 && end.Nodes - base.Nodes <= 20 && sameListeners && (await leftoverStyles(page)) === 0, {
      heapGrowthMb: growthMb,
      heapsMb: heaps,
      nodesBefore: base.Nodes,
      nodesAfter: end.Nodes,
      listenersBefore: baseListeners,
      listenersAfter: endListeners,
    });
    await page.close();
  }

  // Escape on desktop, a touch on phones: both stop cleanly and put the page back.
  async function scenarioCancel() {
    const { page, cdp } = await open(`${origin}/long`);
    await page.evaluate(() => window.scrollTo(0, 777));
    const scrollBefore = await page.evaluate(() => window.scrollY);
    const listenersBefore = await rootListeners(cdp);
    const r = await exportOnce(page, cdp, 'png', {
      expectDownload: false,
      during: async () => {
        await page.waitForTimeout(1500);
        if (PROFILES[profileName].hasTouch) await page.touchscreen.tap(200, 500);
        else await page.keyboard.press('Escape');
      },
    });
    await page.waitForTimeout(300);
    const state = await page.evaluate(() => ({
      scrollY: window.scrollY,
      overlayOpacity: window.getComputedStyle(document.getElementById('page-anchor-host').shadowRoot.querySelector('.page-anchor-ui-root')).opacity,
    }));
    const listenersAfter = await rootListeners(cdp);
    const how = PROFILES[profileName].hasTouch ? 'a touch' : 'Escape';
    rec(
      `${how} cancels and restores the page`,
      r.toast === 'Save cancelled' &&
        r.ms < 6000 &&
        state.scrollY === scrollBefore &&
        state.overlayOpacity === '1' &&
        JSON.stringify(listenersBefore) === JSON.stringify(listenersAfter) &&
        (await leftoverStyles(page)) === 0,
      { ms: r.ms, toast: r.toast, scrollBefore, ...state, sameListeners: JSON.stringify(listenersBefore) === JSON.stringify(listenersAfter) }
    );
    await page.close();
  }

  // Cancelling at many different moments and in every way: each must leave nothing behind, and together they must not grow memory.
  async function scenarioCancelStorm() {
    const { page, cdp } = await open(`${origin}/long`);
    const touch = !!PROFILES[profileName].hasTouch;
    const methods = touch ? ['tap', 'stop', 'tab', 'tap'] : ['escape', 'stop', 'tab', 'wheel'];
    const delays = [200, 600, 1200, 2500, 4000, 7000];
    const downloads = [];
    page.on('download', (d) => downloads.push(d.suggestedFilename()));
    await page.evaluate(() => window.scrollTo(0, 640));
    // A warm-up save stopped with a real click: Playwright adds its own page listeners on its first click, which must not count as ours.
    await page.evaluate(() => document.getElementById('page-anchor-host').shadowRoot.querySelector('[data-action="export-png"]').click());
    await pa(page, '.pa-export-status-stop').click();
    await toast(page).waitFor({ state: 'visible', timeout: 20000 });
    await page.locator('#page-anchor-host .pa-toast-text').evaluateAll((els) => els.forEach((el) => el.remove()));
    await page.waitForTimeout(500);
    const base = await settledMetrics(cdp);
    const baseListeners = await rootListeners(cdp);
    const problems = [];
    const rounds = 12;
    for (let i = 0; i < rounds; i++) {
      const method = methods[i % methods.length];
      const delay = delays[i % delays.length];
      const format = i % 2 ? 'pdf' : 'png';
      const scrollBefore = await page.evaluate(() => window.scrollY);
      await page.evaluate((f) => document.getElementById('page-anchor-host').shadowRoot.querySelector(`[data-action="export-${f}"]`).click(), format);
      await page.waitForTimeout(delay);
      if (method === 'escape') await page.keyboard.press('Escape');
      else if (method === 'wheel') await page.mouse.wheel(0, 120);
      else if (method === 'tap') await page.touchscreen.tap(150, 300);
      else if (method === 'stop') await pa(page, '.pa-export-status-stop').click({ timeout: 2000 }).catch(() => page.keyboard.press('Escape'));
      else if (method === 'tab') {
        const other = await context.newPage();
        await other.goto(`${origin}/plain`);
        await other.bringToFront();
        // Headless Chromium never reports the tab as hidden, so stay away long enough for a screenshot attempt to find the tab inactive.
        await page.waitForTimeout(2500);
        await other.close();
        await page.bringToFront();
      }
      const shown = await toast(page).waitFor({ state: 'visible', timeout: 20000 }).then(() => true, () => false);
      if (!shown) {
        const panel = await page.evaluate(() => document.getElementById('page-anchor-host').shadowRoot.querySelector('.pa-export-status')?.textContent ?? null);
        problems.push({ round: i, method, delay, stuck: true, panel });
        await page.keyboard.press('Escape');
        await toast(page).waitFor({ state: 'visible', timeout: 60000 }).catch(() => {});
        continue;
      }
      const text = await toast(page).textContent();
      await page.waitForTimeout(300);
      const state = await page.evaluate(() => {
        const root = document.getElementById('page-anchor-host').shadowRoot;
        return {
          scrollY: window.scrollY,
          panels: root.querySelectorAll('.pa-export-status').length,
          toolbarOpacity: window.getComputedStyle(root.querySelector('.page-anchor-ui-root')).opacity,
        };
      });
      const leftovers = await leftoverStyles(page);
      const okText = /Save cancelled|Stay on this tab/.test(text);
      // A wheel or tap also scrolls the page on its own, so only the other ways promise the old scroll position.
      const okScroll = method === 'wheel' || method === 'tap' || state.scrollY === scrollBefore;
      if (!okText || !okScroll || state.panels !== 0 || state.toolbarOpacity !== '1' || leftovers !== 0) {
        problems.push({ round: i, method, delay, text, ...state, scrollBefore, leftovers });
      }
      await page.locator('#page-anchor-host .pa-toast-text').evaluateAll((els) => els.forEach((el) => el.remove()));
      if (method === 'wheel' || method === 'tap') {
        await page.evaluate(() => window.scrollTo(0, 640));
        await page.waitForTimeout(200);
      }
    }
    await page.waitForTimeout(1500);
    const end = await settledMetrics(cdp);
    const endListeners = await rootListeners(cdp);
    const growthMb = mb(end.JSHeapUsedSize - base.JSHeapUsedSize);
    const sameListeners = JSON.stringify(baseListeners) === JSON.stringify(endListeners);
    const listenerDiff = Object.keys({ ...baseListeners, ...endListeners })
      .filter((k) => baseListeners[k] !== endListeners[k])
      .map((k) => `${k}: ${baseListeners[k] ?? 0} -> ${endListeners[k] ?? 0}`);
    rec(`${rounds} saves cancelled at different moments and in different ways leave nothing behind`, problems.length === 0 && downloads.length === 0 && growthMb < 2 && end.Nodes - base.Nodes <= 20 && sameListeners, {
      problems,
      downloads,
      heapGrowthMb: growthMb,
      nodesBefore: base.Nodes,
      nodesAfter: end.Nodes,
      sameListeners,
      listenerDiff,
    });
    await page.close();
  }

  // Feeds that load more on scroll: the export must finish and must not keep the page loading endlessly.
  async function scenarioInfinite() {
    const { page, cdp } = await open(`${origin}/infinite`);
    const h0 = await page.evaluate(() => document.documentElement.scrollHeight);
    const r = await exportOnce(page, cdp, 'png');
    const batches = await page.evaluate(() => window.__batches);
    rec('infinite feed exports and stops', /saved/.test(r.toast) && batches < 60, {
      ...r,
      file: undefined,
      startHeight: h0,
      png: pngSize(r.file),
      batchesLoadedDuringExport: batches,
    });
    await page.close();
  }

  // 22,000 elements: the fixed/sticky scan must not freeze the page.
  async function scenarioBigDom() {
    const { page, cdp } = await open(`${origin}/dom`);
    const docH = await page.evaluate(() => document.documentElement.scrollHeight);
    const r = await exportOnce(page, cdp, 'pdf');
    const expected = docH > 40000 ? 'Saved part of the page as PDF' : 'Page saved as PDF';
    rec('22,000-element page', r.toast === expected && r.maxLongTask < 400, { ...r, file: undefined, docH });
    await page.close();
  }

  // With the toolbar open but no export running, the page's own frames and CPU must be untouched. Also runs against an older build (PA_EXT_DIR) for comparison.
  async function scenarioIdle() {
    const { page, cdp } = await open(`${origin}/medium`);
    await draw(page);
    const listenersBefore = await rootListeners(cdp);
    const before = await metrics(cdp);
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          let y = 0;
          const step = () => {
            y += 40;
            window.scrollTo(0, y);
            if (y < 6000) requestAnimationFrame(step);
            else resolve();
          };
          requestAnimationFrame(step);
        })
    );
    const after = await metrics(cdp);
    const listeners = await rootListeners(cdp);
    // Export adds wheel listeners only while it runs.
    rec('scrolling with the toolbar open, export idle', !listeners.wheel && JSON.stringify(listeners) === JSON.stringify(listenersBefore), {
      scriptMsPerScroll: +(((after.ScriptDuration - before.ScriptDuration) * 1000) / 150).toFixed(2),
      taskMsPerScroll: +(((after.TaskDuration - before.TaskDuration) * 1000) / 150).toFixed(2),
      listenerCount: Object.values(listeners).reduce((a, b) => a + b, 0),
    });
    await page.close();
  }

  // ---------------------------------------------------------------- edge pages, checked pixel by pixel

  const BLUE = [0, 0, 255];
  const GREEN = [0, 255, 0];
  const BLACK = [0, 0, 0];
  const YELLOW = [255, 255, 0];
  const STROKE = [239, 68, 68];

  /** The 3000px BANDS layout: every band where it belongs, including the 10px stripe inside the last, clamped tile. */
  function bandsProblems(img) {
    const want = [
      [500, BLUE],
      [1500, GREEN],
      [2500, BLACK],
      [2975, BLACK],
      [2985, YELLOW],
      [2995, BLACK],
    ];
    return want.filter(([y, c]) => !near(img.at(5, y), c)).map(([y, c]) => `y=${y} got ${img.at(5, y)} want ${c}`);
  }

  async function savePng(path, options = {}) {
    const { page, cdp } = await open(`${origin}${path}`);
    const r = await exportOnce(page, cdp, 'png', { expectDownload: true, ...options });
    const scale = await captureScale(page, sw);
    return { page, cdp, r, scale, img: decodePng(r.file, scale) };
  }

  async function scenarioEdgeBands() {
    for (const [path, label] of [
      ['/csp', 'page with a strict Content-Security-Policy'],
      ['/smooth', 'page with smooth scrolling and scroll snapping'],
      ['/quirks', 'old page without a doctype (quirks mode)'],
    ]) {
      const { page, r, scale, img } = await savePng(path);
      const problems = bandsProblems(img);
      const heightOk = Math.abs(img.height - 3000 * scale) <= 2;
      rec(label, r.toast === 'Page saved as PNG' && heightOk && problems.length === 0, { ms: r.ms, size: [img.width, img.height], problems });
      await page.close();
    }
  }

  async function scenarioEdgeWide() {
    const { page, cdp } = await open(`${origin}/wide`);
    let r = await exportOnce(page, cdp, 'png', { direct: true, expectDownload: false });
    const askedToZoomOut = r.toast === 'Zoom out to save the whole page';
    if (askedToZoomOut) {
      // A phone shows only part of a too-wide page; the user zooms all the way out, as the message asks, and saves again.
      const minScale = await page.evaluate(() => window.visualViewport.width / window.innerWidth);
      await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: minScale });
      await page.waitForTimeout(400);
      await pa(page, '.pa-toast-text').evaluateAll((els) => els.forEach((el) => el.remove()));
    }
    r = await exportOnce(page, cdp, 'png', { direct: true });
    const scale = await captureScale(page, sw);
    const img = decodePng(r.file, scale);
    const docH = await page.evaluate(() => document.documentElement.scrollHeight);
    const savedW = img.width / scale;
    const problems = [
      [650, 700, GREEN],
      [1250, 1400, GREEN],
      [1350, 100, BLUE],
      [2590, 1400, BLUE],
    ]
      .filter(([x, y, c]) => !near(img.at(x, y), c))
      .map(([x, y, c]) => `(${x},${y}) got ${img.at(x, y)} want ${c}`);
    rec(
      'page wider than the screen is saved side to side',
      r.toast === 'Page saved as PNG' && Math.abs(savedW - 2600) <= 3 && Math.abs(img.height - docH * scale) <= 2 && problems.length === 0,
      { askedToZoomOut, toast: r.toast, savedCss: [Math.round(savedW), Math.round(img.height / scale)], docH, problems }
    );
    await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 }).catch(() => {});
    await page.close();
  }

  async function scenarioEdgeShortAndLocked() {
    for (const [path, label] of [
      ['/tiny', 'page shorter than the screen'],
      ['/inner', 'app that scrolls an inner panel'],
      ['/locked', 'page that hides the window scrollbar'],
    ]) {
      const { page, r, scale, img } = await savePng(path);
      const viewH = await page.evaluate(() => document.documentElement.clientHeight);
      const full = r.toast === 'Page saved as PNG';
      // A window that cannot scroll may yield only the visible part, but then the message must say so.
      const consistent = full ? Math.abs(img.height - Math.max(viewH, path === '/locked' ? 3000 : viewH) * scale) <= 2 : Math.abs(img.height - viewH * scale) <= 2;
      rec(label, /saved/i.test(r.toast) && consistent, { toast: r.toast, size: [img.width, img.height], viewH });
      await page.close();
    }
  }

  async function scenarioEdgeBrowserZoom() {
    const { page, cdp } = await open(`${origin}/csp`);
    const setZoom = (z) =>
      sw.evaluate(async (zoom) => {
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        await chrome.tabs.setZoom(tab.id, zoom);
      }, z);
    await setZoom(1.5);
    await page.waitForTimeout(500);
    try {
      const r = await exportOnce(page, cdp, 'png', { direct: true });
      const scale = await captureScale(page, sw);
      const img = decodePng(r.file, scale);
      const problems = bandsProblems(img);
      rec('browser zoom at 150%', r.toast === 'Page saved as PNG' && Math.abs(img.height - 3000 * scale) <= 3 && problems.length === 0, {
        scale: +scale.toFixed(3),
        size: [img.width, img.height],
        problems,
      });
    } finally {
      await setZoom(1);
      await page.close();
    }
  }

  async function scenarioEdgePinchZoom() {
    const { page, cdp } = await open(`${origin}/csp`);
    await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 });
    await page.waitForTimeout(300);
    const downloads = [];
    page.on('download', (d) => downloads.push(d));
    // Zoomed in, the toolbar sits outside the visible area, so press the menu item directly.
    await page.evaluate(() => document.getElementById('page-anchor-host').shadowRoot.querySelector('[data-action="export-png"]').click());
    await toast(page).waitFor({ state: 'attached', timeout: 15000 });
    const text = await toast(page).textContent();
    await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
    rec('pinch-zoomed in: asks to zoom out instead of saving a misaligned image', text === 'Zoom out to save the whole page' && downloads.length === 0, { toast: text });
    await page.close();
  }

  async function scenarioEdgeDoubleTrigger() {
    const { page } = await open(`${origin}/csp`);
    const downloads = [];
    page.on('download', (d) => downloads.push(d.suggestedFilename()));
    await page.evaluate(() => {
      const root = document.getElementById('page-anchor-host').shadowRoot;
      root.querySelector('[data-action="export-png"]').click();
      root.querySelector('[data-action="export-pdf"]').click();
      root.querySelector('[data-action="export-png"]').click();
    });
    await toast(page).waitFor({ state: 'visible', timeout: 60000 });
    await page.waitForTimeout(3000);
    rec('several Save clicks at once run a single export', downloads.length === 1 && (await toast(page).textContent()) === 'Page saved as PNG', { downloads });
    await page.close();
  }

  async function scenarioEdgeHiddenDrawings() {
    const { page, cdp } = await open(`${origin}/csp`);
    await draw(page);
    const x = page.viewportSize().width / 2;
    const visible = decodePng((await exportOnce(page, cdp, 'png')).file, await captureScale(page, sw));
    await pa(page, '[data-action="more"]').click();
    await pa(page, '[data-action="visibility"]').click();
    const hidden = decodePng((await exportOnce(page, cdp, 'png')).file, await captureScale(page, sw));
    // A finger stroke is a few pixels thick and wanders, so scan every row of the band it was drawn in.
    const rows = Array.from({ length: 61 }, (_, i) => 300 + i);
    const strokeShown = rows.some((y) => near(visible.at(x, y), STROKE));
    const strokeGone = rows.every((y) => near(hidden.at(x, y), BLUE));
    const stored = await sw.evaluate(async (u) => {
      const all = await chrome.storage.local.get(null);
      const el = all[Object.keys(all).find((k) => k.startsWith('page_anchor_data:') && k.includes(u.replace(/^https?:\/\/[^/]+/, '')))]?.elements?.[0];
      const xs = (el?.points ?? []).map((p) => p.x);
      return xs.length ? [Math.min(...xs), Math.max(...xs), xs.length] : null;
    }, page.url());
    rec('hidden drawings stay out of the saved file, shown ones are in it', strokeShown && strokeGone, {
      visible: visible.at(x, 330),
      hidden: hidden.at(x, 330),
      drawings: await page.evaluate(() => document.getElementById('page-anchor-host').shadowRoot.querySelector('.pa-count-badge')?.textContent),
      storedPointsMinMaxCount: stored,
    });
    await pa(page, '[data-action="more"]').click();
    await pa(page, '[data-action="visibility"]').click();
    await page.close();
  }

  async function scenarioEdgeTabSwitch() {
    const { page, cdp } = await open(`${origin}/long`);
    await page.evaluate(() => window.scrollTo(0, 500));
    const scrollBefore = await page.evaluate(() => window.scrollY);
    const downloads = [];
    page.on('download', (d) => downloads.push(d));
    await pa(page, '[data-action="more"]').click();
    await pa(page, '[data-action="export-png"]').click();
    await page.waitForTimeout(1500);
    const other = await context.newPage();
    await other.goto(`${origin}/tiny`);
    await other.bringToFront();
    await page.waitForTimeout(1500);
    await page.bringToFront();
    await toast(page).waitFor({ state: 'visible', timeout: 15000 });
    const state = await page.evaluate(() => ({
      scrollY: window.scrollY,
      opacity: window.getComputedStyle(document.getElementById('page-anchor-host').shadowRoot.querySelector('.page-anchor-ui-root')).opacity,
    }));
    const text = await toast(page).textContent();
    rec('switching tabs mid-save stops it and restores the page', downloads.length === 0 && /cancelled|Stay on this tab/.test(text) && state.scrollY === scrollBefore && state.opacity === '1', {
      toast: text,
      ...state,
      scrollBefore,
    });
    void cdp;
    await other.close();
    await page.close();
  }

  async function scenarioEdgeLazyImages() {
    const { page, r, img } = await savePng('/lazy');
    const pixel = img.at(150, 2600);
    rec('lazy image that arrives late is in the saved file', near(pixel, [255, 0, 255]), { pixel, toast: r.toast, ms: r.ms });
    await page.close();
  }

  const scenarios = [
    scenarioIdle,
    scenarioLongPage,
    scenarioHeightCap,
    scenarioRepeatLeak,
    scenarioCancel,
    scenarioCancelStorm,
    scenarioInfinite,
    scenarioBigDom,
    scenarioEdgeBands,
    scenarioEdgeWide,
    scenarioEdgeShortAndLocked,
    scenarioEdgeBrowserZoom,
    scenarioEdgePinchZoom,
    scenarioEdgeDoubleTrigger,
    scenarioEdgeHiddenDrawings,
    scenarioEdgeTabSwitch,
    scenarioEdgeLazyImages,
  ];
  const only = process.env.PA_ONLY?.split(',');
  for (const s of scenarios.filter((x) => !only || only.includes(x.name))) {
    try {
      await s();
    } catch (e) {
      rec(`${s.name} crashed`, false, { error: String(e?.message ?? e).split('\n').slice(0, process.env.PA_VERBOSE ? 12 : 1).join(' | ') });
    }
  }
  rec('no extension errors in page consoles', pageErrors.length === 0, { errors: pageErrors.slice(0, 10) });
  await context.close();
  try {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  } catch {}
}

for (const profile of (process.env.PA_PROFILES ?? 'desktop,mobile').split(',')) await runProfile(profile);

fs.writeFileSync(path.join(ROOT, RESULTS_FILE), JSON.stringify({ ext: EXT, generatedAt: new Date().toISOString(), results }, null, 2));
console.log(`\n${results.filter((r) => r.pass).length}/${results.length} checks passed, wrote ${RESULTS_FILE}`);
server.close();
server.closeAllConnections();
process.exit(results.every((r) => r.pass) ? 0 : 1);
