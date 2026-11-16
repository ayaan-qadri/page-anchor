/**
 * Stress and robustness suite for the built Chrome MV3 extension.
 *
 * Drives the real extension in Chromium through heavy and adversarial scenarios (thousands of drawings, very long strokes, tool switching mid-gesture, undo/redo storms, DOM mutation storms, thousands of saved pages, large imports, concurrent tabs, SPA navigation storms, repeated re-injection, resize storms) and checks both correctness and frame/heap budgets.
 *
 * Usage: pnpm build && node scripts/stress.mjs
 * Env: PA_EXT_DIR=<built extension dir> to target another build, PA_RESULTS_FILE=<file name> for the JSON report.
 */
import { chromium } from '@playwright/test';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const EXT = process.env.PA_EXT_DIR ? path.resolve(process.env.PA_EXT_DIR) : path.join(ROOT, '.output', 'chrome-mv3');
const RESULTS_FILE = process.env.PA_RESULTS_FILE || 'stress-results.json';

const BIG = 5000;
const CARDS = 1000;
const results = [];

function record(name, pass, metrics) {
  results.push({ name, pass, metrics });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(metrics)}`);
}

// ---------------------------------------------------------------- pages

function cardsPage(n, title) {
  const cards = Array.from(
    { length: n },
    (_, i) => `<article id="card-${i}" class="card" style="box-sizing:border-box;height:98px;margin:0 0 24px;padding:12px;border:1px solid #cbd5e1;border-radius:8px">
  <h2 style="margin:0 0 6px;font-size:16px">Issue ${i}</h2><p style="margin:0">Row ${i} body text.</p></article>`
  ).join('');
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<style>body{margin:0;font-family:sans-serif}main{padding:24px}.hot{background:#fef3c7}</style>
</head><body><main id="main">${cards}</main></body></html>`;
}

const MUTATE_SCRIPT = `<script>
window.__mutate = (ms) => new Promise((resolve) => {
  const main = document.getElementById('main');
  const end = performance.now() + ms;
  let n = 0;
  const tick = () => {
    for (let i = 0; i < 20; i++) {
      const card = document.getElementById('card-' + Math.floor(Math.random() * 400));
      card && card.classList.toggle('hot');
    }
    const banner = document.createElement('div');
    banner.className = 'banner';
    banner.style.height = (20 + (n % 5) * 10) + 'px';
    banner.textContent = 'banner ' + n;
    main.prepend(banner);
    const old = main.querySelectorAll('.banner');
    if (old.length > 3) old[old.length - 1].remove();
    n++;
    if (performance.now() < end) setTimeout(tick, 16); else resolve(n);
  };
  tick();
});
</script>`;

const pages = {
  '/big': cardsPage(CARDS, 'Big'),
  '/mutate': cardsPage(400, 'Mutate').replace('</body>', `${MUTATE_SCRIPT}</body>`),
  '/plain': cardsPage(30, 'Plain'),
};

const server = http.createServer((req, res) => {
  const p = (req.url || '/').split('?')[0];
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(pages[p] ?? pages['/plain']);
});
const port = await new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const origin = `http://127.0.0.1:${port}`;

// ---------------------------------------------------------------- browser

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-stress-'));
const context = await chromium.launchPersistentContext(userDataDir, {
  headless: false,
  viewport: { width: 1280, height: 800 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
let sw = context.serviceWorkers()[0];
if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 15000 });
const extensionId = sw.url().split('/')[2];

const pageErrors = [];
function watch(page, label) {
  page.on('pageerror', (e) => pageErrors.push(`${label}: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && /page.?anchor|content-scripts/i.test(m.text() + (m.location()?.url ?? ''))) {
      pageErrors.push(`${label}: ${m.text()}`);
    }
  });
  return page;
}

const storage = {
  all: () => sw.evaluate(() => chrome.storage.local.get(null)),
  set: (d) => sw.evaluate((x) => chrome.storage.local.set(x), d),
  clear: () => sw.evaluate(() => chrome.storage.local.clear()),
};

async function storedCount(url) {
  const all = await storage.all();
  return all[`page_anchor_data:${url}`]?.elements?.length ?? 0;
}

async function toggle(page) {
  await page.bringToFront();
  await sw.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.id) await chrome.tabs.sendMessage(tab.id, { type: 'PAGE_ANCHOR_TOGGLE' }).catch(() => {});
  });
}

async function openToolbar(page) {
  const toolbar = page.locator('#page-anchor-host .pa-toolbar');
  if (await toolbar.isVisible().catch(() => false)) return;
  await toggle(page);
  await toolbar.waitFor({ state: 'visible', timeout: 15000 });
}

const badge = (page) =>
  page.evaluate(() => {
    const t = document.getElementById('page-anchor-host')?.shadowRoot?.querySelector('.pa-count-badge')?.textContent ?? '';
    return t === '' ? 0 : Number(t);
  });

async function waitBadge(page, n, timeout = 15000) {
  await page.waitForFunction(
    (n) => {
      const t = document.getElementById('page-anchor-host')?.shadowRoot?.querySelector('.pa-count-badge')?.textContent ?? '';
      return (t === '' ? 0 : Number(t)) === n;
    },
    n,
    { timeout, polling: 50 }
  );
}

async function stroke(page, x, y, dx = 40, dy = 14) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy, { steps: 3 });
  await page.mouse.move(x + dx, y, { steps: 3 });
  await page.mouse.up();
}

/** Alpha sum of the active (preview) canvas; non-zero means a stale preview is left on screen. */
const activeInk = (page) =>
  page.evaluate(() => {
    const c = document.getElementById('page-anchor-host')?.shadowRoot?.querySelector('.page-anchor-active-canvas');
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return -1;
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let s = 0;
    for (let i = 3; i < d.length; i += 4) s += d[i];
    return s;
  });

// ---------------------------------------------------------------- measurement

const pct = (a, p) => (a.length ? +[...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor((p / 100) * a.length))].toFixed(1) : null);

async function metrics(cdp) {
  const { metrics } = await cdp.send('Performance.getMetrics');
  return Object.fromEntries(metrics.map((m) => [m.name, m.value]));
}

async function heapAfterGc(cdp) {
  await cdp.send('HeapProfiler.collectGarbage');
  await cdp.send('HeapProfiler.collectGarbage');
  return (await metrics(cdp)).JSHeapUsedSize;
}

async function measure(page, cdp, fn) {
  await page.evaluate(() => {
    const s = { d: [], lt: [], raf: 0, obs: null };
    window.__stress = s;
    let last = performance.now();
    const loop = (t) => {
      s.d.push(t - last);
      last = t;
      s.raf = requestAnimationFrame(loop);
    };
    s.raf = requestAnimationFrame(loop);
    try {
      s.obs = new PerformanceObserver((l) => l.getEntries().forEach((e) => s.lt.push(e.duration)));
      s.obs.observe({ entryTypes: ['longtask'] });
    } catch {}
  });
  const before = await metrics(cdp);
  const t0 = performance.now();
  const extra = (await fn()) ?? {};
  const wall = performance.now() - t0;
  const after = await metrics(cdp);
  const f = await page.evaluate(() => {
    const s = window.__stress;
    cancelAnimationFrame(s.raf);
    s.obs?.disconnect();
    return { d: s.d.slice(1), lt: s.lt };
  });
  return {
    wallMs: +wall.toFixed(0),
    scriptMs: +((after.ScriptDuration - before.ScriptDuration) * 1000).toFixed(0),
    frames: f.d.length,
    p50: pct(f.d, 50),
    p95: pct(f.d, 95),
    maxFrame: f.d.length ? +Math.max(...f.d).toFixed(0) : null,
    longTasks: f.lt.length,
    maxLongTask: f.lt.length ? +Math.max(...f.lt).toFixed(0) : 0,
    ...extra,
  };
}

// ---------------------------------------------------------------- fixtures

function bigElements(url, n) {
  const els = [];
  for (let i = 0; i < n; i++) {
    const card = i % CARDS;
    const top = 24 + card * 122 + 10 + Math.floor(i / CARDS) * 14;
    const left = 60 + (i % 7) * 90;
    const anchor = {
      selector: `#card-${card}`,
      initialRect: { left: 24, top: 24 + card * 122, width: 852, height: 122 },
      textQuote: { exact: `Issue ${card}` },
    };
    const base = { id: `el_${i}`, strokeColor: '#ef4444', strokeWidth: 3, opacity: 1, createdAt: i, anchor };
    if (i % 5 === 0) {
      els.push({ ...base, type: 'rect', startX: left, startY: top, endX: left + 70, endY: top + 30, bbox: { minX: left - 3, minY: top - 3, maxX: left + 73, maxY: top + 33 } });
    } else if (i % 5 === 1) {
      els.push({ ...base, type: 'text', x: left, y: top, text: `note ${i}`, fontSize: 14, fontColor: '#111827', bbox: { minX: left, minY: top, maxX: left + 80, maxY: top + 22 } });
    } else {
      const points = Array.from({ length: 30 }, (_, p) => ({ x: left + p * 2.5, y: top + (p % 6) * 3 }));
      els.push({ ...base, type: i % 5 === 2 ? 'highlighter' : 'pen', opacity: i % 5 === 2 ? 0.35 : 1, points, bbox: { minX: left - 3, minY: top - 3, maxX: left + 78, maxY: top + 18 } });
    }
  }
  return els;
}

function pageRecord(url, elements) {
  return { url, normalizedUrl: url, pageTitle: 'Stress', updatedAt: Date.now(), elements, domAnchoringEnabled: true };
}

async function seed(url, elements) {
  const all = await storage.all();
  const index = all.page_anchor_index ?? {};
  index[url] = { normalizedUrl: url, url, pageTitle: 'Stress', updatedAt: Date.now(), elementCount: elements.length };
  await storage.set({ [`page_anchor_data:${url}`]: pageRecord(url, elements), page_anchor_index: index });
}

async function newPage(label) {
  const page = watch(await context.newPage(), label);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  return { page, cdp };
}

// ================================================================ scenarios

async function scenarioBigPage() {
  const url = `${origin}/big`;
  await seed(url, bigElements(url, BIG));
  const { page, cdp } = await newPage('big');

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await waitBadge(page, BIG, 30000);
  const loadMs = await page.evaluate(() => +performance.now().toFixed(0));
  const dcl = await page.evaluate(() => +performance.getEntriesByType('navigation')[0].domContentLoadedEventEnd.toFixed(0));
  record(`load ${BIG} drawings`, loadMs - dcl < 3000, { msAfterDomContentLoaded: loadMs - dcl });

  await openToolbar(page);
  for (const rate of [1, 4]) {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate });
    await page.evaluate(() => window.scrollTo(0, 0));
    const m = await measure(page, cdp, async () => {
      for (let i = 0; i < 40; i++) {
        await page.mouse.wheel(0, 700);
        await page.waitForTimeout(30);
      }
    });
    const budget = rate === 1 ? 34 : 60;
    record(`scroll ${BIG} drawings @${rate}x CPU`, m.p95 <= budget && m.maxLongTask < (rate === 1 ? 150 : 400), m);
  }
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);
  const firstBefore = (await storage.all())[`page_anchor_data:${url}`].elements[0].startX;
  await page.keyboard.press('Control+a');
  await page.waitForTimeout(300);
  const drag = await measure(page, cdp, async () => {
    await page.mouse.move(400, 400);
    await page.mouse.down();
    await page.mouse.move(460, 400, { steps: 20 });
    await page.mouse.up();
    await page.waitForTimeout(600);
  });
  const firstAfter = (await storage.all())[`page_anchor_data:${url}`].elements[0].startX;
  record(`select all + drag ${BIG} drawings`, Math.round(firstAfter - firstBefore) === 60 && drag.p95 <= 50, { ...drag, movedBy: +(firstAfter - firstBefore).toFixed(1) });

  const undo = await measure(page, cdp, async () => {
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(700);
  });
  const firstUndone = (await storage.all())[`page_anchor_data:${url}`].elements[0].startX;
  record(`undo drag of ${BIG} drawings`, Math.abs(firstUndone - firstBefore) < 0.5 && (await badge(page)) === BIG, { ...undo, restoredTo: firstUndone });

  await page.keyboard.press('e');
  await page.evaluate(() => window.scrollTo(0, 0));
  const erase = await measure(page, cdp, async () => {
    await page.mouse.move(60, 70);
    await page.mouse.down();
    await page.mouse.move(700, 70, { steps: 40 });
    await page.mouse.up();
    await page.waitForTimeout(500);
  });
  const left = await badge(page);
  record(`eraser sweep across ${BIG} drawings`, left < BIG && erase.p95 <= 50, { ...erase, erased: BIG - left });

  await page.close();
}

async function scenarioLongStroke() {
  const url = `${origin}/long-stroke`;
  const { page, cdp } = await newPage('long-stroke');
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await openToolbar(page);
  await page.keyboard.press('p');
  for (const rate of [1, 4]) {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate });
    const m = await measure(page, cdp, async () => {
      await page.mouse.move(100, 150);
      await page.mouse.down();
      for (let i = 0; i < 300; i++) {
        await page.mouse.move(100 + (i % 2 ? 900 : 0), 150 + i * 1.5, { steps: 10 });
      }
      await page.mouse.up();
      await page.waitForTimeout(500);
    });
    record(`3000-point stroke @${rate}x CPU`, m.p95 <= (rate === 1 ? 34 : 60) && m.maxLongTask < (rate === 1 ? 200 : 500), m);
  }
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  const all = await storage.all();
  const pts = all[`page_anchor_data:${url}`]?.elements?.map((e) => e.points?.length ?? 0) ?? [];
  record('long strokes are saved', pts.length === 2 && pts.every((n) => n > 50), { storedPoints: pts });
  await page.close();
}

async function scenarioToolSwitchMidGesture() {
  const url = `${origin}/tool-switch`;
  const { page } = await newPage('tool-switch');
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await openToolbar(page);
  const keys = ['p', 'h', 'r', 'c', 'l', 'a', 'd', 'e', 'v'];
  const t0 = performance.now();
  for (let i = 0; i < 300; i++) {
    await page.keyboard.press(keys[i % keys.length]);
    const x = 120 + (i * 37) % 700;
    const y = 160 + (i * 53) % 450;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 30, y + 20, { steps: 2 });
    await page.keyboard.press(keys[(i + 3) % keys.length]);
    await page.mouse.move(x + 60, y + 10, { steps: 2 });
    await page.mouse.up();
  }
  await page.waitForTimeout(600);
  const ink = await activeInk(page);
  const count = await badge(page);
  const stored = await storedCount(url);
  await page.keyboard.press('p');
  await stroke(page, 300, 700);
  await page.waitForTimeout(600);
  const after = await badge(page);
  record('300 tool switches mid-gesture', ink === 0 && count === stored && after === count + 1, {
    ms: +(performance.now() - t0).toFixed(0),
    leftoverPreviewInk: ink,
    badge: count,
    stored,
    drawsAfterwards: after - count,
  });
  await page.close();
}

async function scenarioUndoRedoStorm() {
  const url = `${origin}/undo`;
  const { page, cdp } = await newPage('undo');
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await openToolbar(page);
  await page.keyboard.press('p');
  for (let i = 0; i < 150; i++) await stroke(page, 100 + (i % 15) * 60, 150 + Math.floor(i / 15) * 50, 30, 10);
  await waitBadge(page, 150);
  const m = await measure(page, cdp, async () => {
    for (let i = 0; i < 80; i++) await page.keyboard.press('Control+z');
    await page.waitForTimeout(600);
  });
  const afterUndo = await badge(page);
  const storedUndo = await storedCount(url);
  for (let i = 0; i < 80; i++) await page.keyboard.press('Control+y');
  await page.waitForTimeout(600);
  const afterRedo = await badge(page);
  const storedRedo = await storedCount(url);
  record('150 edits, 80 undos, 80 redos', afterUndo === 100 && storedUndo === 100 && afterRedo === 150 && storedRedo === 150, {
    ...m,
    afterUndo,
    storedUndo,
    afterRedo,
    storedRedo,
    heapMB: +((await heapAfterGc(cdp)) / 1048576).toFixed(1),
  });
  await page.close();
}

async function scenarioMutationStorm() {
  const url = `${origin}/mutate`;
  const els = bigElements(url, 400).map((e, i) => ({
    ...e,
    anchor: { ...e.anchor, selector: `#card-${i}`, textQuote: { exact: `Issue ${i}` }, initialRect: { left: 24, top: 24 + i * 122, width: 852, height: 122 } },
  }));
  const { page, cdp } = await newPage('mutate');

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  const idle = await measure(page, cdp, () => page.evaluate(() => window.__mutate(4000)));

  await seed(url, els);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitBadge(page, 400);
  await page.waitForTimeout(500);
  const busy = await measure(page, cdp, () => page.evaluate(() => window.__mutate(4000)));

  const overheadPerSec = ((busy.scriptMs - idle.scriptMs) / busy.wallMs) * 1000;
  record('DOM mutation storm with 400 anchored drawings', overheadPerSec < 150 && busy.p95 <= 34 && (await badge(page)) === 400, {
    pageOnlyScriptMs: idle.scriptMs,
    withDrawingsScriptMs: busy.scriptMs,
    extensionMsPerSecond: +overheadPerSec.toFixed(0),
    p95: busy.p95,
    maxLongTask: busy.maxLongTask,
  });
  await page.close();
}

async function scenarioManySavedPages() {
  const N = 3000;
  const data = {};
  const index = {};
  for (let i = 0; i < N; i++) {
    const u = `https://site${i % 50}.example/page/${i}`;
    data[`page_anchor_data:${u}`] = pageRecord(u, [
      { id: `p${i}`, type: 'rect', startX: 1, startY: 1, endX: 9, endY: 9, strokeColor: '#000', strokeWidth: 2, opacity: 1, createdAt: i, bbox: { minX: 0, minY: 0, maxX: 10, maxY: 10 } },
    ]);
    index[u] = { normalizedUrl: u, url: u, pageTitle: `Page ${i}`, updatedAt: i, elementCount: 1 };
  }
  await storage.set({ ...data, page_anchor_index: index });

  const { page } = await newPage('options');
  const openList = async () => {
    const t0 = performance.now();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.waitForFunction((n) => document.querySelectorAll('.pa-saved-url').length >= n, N, { timeout: 30000, polling: 50 });
    return +(performance.now() - t0).toFixed(0);
  };
  const listMs = await openList();
  record(`options page lists ${N} saved pages`, listMs < 3000, { ms: listMs });

  await sw.evaluate(() => chrome.storage.local.remove('page_anchor_index'));
  const rebuildMs = await openList();
  const rebuilt = Object.keys((await storage.all()).page_anchor_index ?? {}).length;
  record(`lost index is rebuilt from ${N} saved pages`, rebuilt >= N && rebuildMs < 5000, { ms: rebuildMs, indexEntries: rebuilt });

  const pagesPerBackup = 100;
  const backup = {};
  for (let p = 0; p < pagesPerBackup; p++) {
    const u = `https://imported.example/doc/${p}`;
    const elements = Array.from({ length: 45 }, (_, k) => ({
      id: `imp_${p}_${k}`,
      type: 'pen',
      strokeColor: '#2563eb',
      strokeWidth: 3,
      opacity: 1,
      createdAt: k,
      points: Array.from({ length: 30 }, (_, j) => ({ x: 100 + j * 3.3, y: 100 + k * 9 + (j % 4) })),
      bbox: { minX: 97, minY: 97 + k * 9, maxX: 200, maxY: 107 + k * 9 },
    }));
    backup[`page_anchor_data:${u}`] = pageRecord(u, elements);
  }
  backup.page_anchor_index = Object.fromEntries(
    Object.values(backup).map((d) => [d.url, { normalizedUrl: d.url, url: d.url, pageTitle: 'Imported', updatedAt: Date.now(), elementCount: 45 }])
  );
  const json = JSON.stringify(backup);
  const importMs = await page.evaluate(async (payload) => {
    const input = document.getElementById('backup-file-input');
    const status = document.getElementById('import-status');
    if (status) status.textContent = '';
    const dt = new DataTransfer();
    dt.items.add(new File([payload], 'backup.json', { type: 'application/json' }));
    input.files = dt.files;
    const t0 = performance.now();
    input.dispatchEvent(new Event('change', { bubbles: true }));
    while (!status?.textContent && performance.now() - t0 < 20000) await new Promise((r) => setTimeout(r, 20));
    return { ms: +(performance.now() - t0).toFixed(0), status: status?.textContent ?? '' };
  }, json);
  const after = await storage.all();
  const imported = Object.keys(after).filter((k) => k.startsWith('page_anchor_data:https://imported.example')).length;
  const indexSize = Object.keys(after.page_anchor_index ?? {}).length;
  record(`import ${(json.length / 1048576).toFixed(1)}MB backup into ${N} existing pages`, imported === pagesPerBackup && indexSize >= N + pagesPerBackup && importMs.ms < 5000 && !/invalid|fail/i.test(importMs.status), {
    ...importMs,
    imported,
    indexSize,
  });
  await page.close();
}

async function scenarioMultiTab() {
  const url = `${origin}/multi`;
  const tabs = [];
  for (let i = 0; i < 4; i++) {
    const { page } = await newPage(`tab${i}`);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    tabs.push(page);
  }
  for (let i = 0; i < tabs.length; i++) {
    await openToolbar(tabs[i]);
    await tabs[i].keyboard.press('p');
    await stroke(tabs[i], 150 + i * 80, 200);
    await tabs[i].waitForTimeout(700);
  }
  await tabs[0].waitForTimeout(800);
  const badges = await Promise.all(tabs.map(badge));
  const stored = await storedCount(url);
  record('4 tabs editing one page in turn keep every drawing', stored === 4 && badges.every((b) => b === 4), { badges, stored });

  for (let round = 0; round < 3; round++) {
    for (let i = 0; i < tabs.length; i++) {
      await tabs[i].bringToFront();
      await stroke(tabs[i], 150 + i * 80, 300 + round * 60);
    }
  }
  await tabs[0].waitForTimeout(1500);
  const badges2 = await Promise.all(tabs.map(badge));
  const stored2 = await storedCount(url);
  record('4 tabs editing in rapid succession converge', badges2.every((b) => b === stored2) && stored2 === 16, { badges: badges2, stored: stored2, expected: 16 });

  await tabs[3].close();
  await tabs[0].waitForTimeout(800);
  record('closing a tab keeps the shared drawings', (await storedCount(url)) === stored2, { stored: await storedCount(url) });
  for (const t of tabs.slice(0, 3)) await t.close();
}

async function scenarioSpaStorm() {
  const routes = 5;
  for (let r = 0; r < routes; r++) {
    const u = `${origin}/spa/r${r}`;
    await seed(u, bigElements(u, (r + 1) * 3).map((e) => ({ ...e, anchor: undefined })));
  }
  const { page, cdp } = await newPage('spa');
  await page.goto(`${origin}/spa/r0`, { waitUntil: 'domcontentloaded' });
  await waitBadge(page, 3);
  await page.waitForTimeout(500);
  const heap0 = await heapAfterGc(cdp);
  const m = await measure(page, cdp, () =>
    page.evaluate(async (routes) => {
      for (let i = 1; i <= 200; i++) {
        history.pushState({}, '', `/spa/r${i % routes}`);
        await new Promise((r) => setTimeout(r, i % 10 === 0 ? 120 : 8));
      }
    }, routes)
  );
  await page.waitForTimeout(800);
  const finalRoute = 200 % routes;
  const count = await badge(page);
  const heap1 = await heapAfterGc(cdp);
  const hosts = await page.evaluate(() => document.querySelectorAll('#page-anchor-host').length);
  record('200 SPA route changes', count === (finalRoute + 1) * 3 && hosts === 1 && heap1 - heap0 < 3 * 1048576, {
    ...m,
    badge: count,
    expected: (finalRoute + 1) * 3,
    heapGrowthMB: +((heap1 - heap0) / 1048576).toFixed(2),
  });

  for (let r = 0; r < routes; r++) {
    const stored = await storedCount(`${origin}/spa/r${r}`);
    if (stored !== (r + 1) * 3) {
      record('SPA storm leaves every route intact', false, { route: r, stored });
      await page.close();
      return;
    }
  }
  record('SPA storm leaves every route intact', true, {});
  await page.close();
}

async function scenarioReinjection() {
  const url = `${origin}/reinject`;
  const { page, cdp } = await newPage('reinject');
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await openToolbar(page);
  await page.waitForTimeout(300);
  const heap0 = await heapAfterGc(cdp);
  const inject = () =>
    sw.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content-scripts/content.js'] });
        return 'ok';
      } catch (e) {
        return String(e?.message ?? e);
      }
    });
  await page.bringToFront();
  const outcomes = [];
  for (let i = 0; i < 15; i++) outcomes.push(await inject());
  await page.waitForTimeout(600);
  const shape = await page.evaluate(() => {
    const hosts = document.querySelectorAll('#page-anchor-host');
    const root = hosts[0]?.shadowRoot;
    return {
      hosts: hosts.length,
      toolbars: root?.querySelectorAll('.pa-toolbar').length ?? 0,
      activeCanvases: root?.querySelectorAll('.page-anchor-active-canvas').length ?? 0,
    };
  });
  await openToolbar(page);
  await page.keyboard.press('p');
  await stroke(page, 300, 300);
  await page.waitForTimeout(700);
  const count = await badge(page);
  const stored = await storedCount(url);
  const heap1 = await heapAfterGc(cdp);
  record('15 re-injections leave one working instance', outcomes.every((o) => o === 'ok') && shape.hosts === 1 && shape.toolbars === 1 && shape.activeCanvases === 1 && count === 1 && stored === 1 && heap1 - heap0 < 5 * 1048576, {
    injections: outcomes.filter((o) => o === 'ok').length,
    injectError: outcomes.find((o) => o !== 'ok'),
    ...shape,
    badge: count,
    stored,
    heapGrowthMB: +((heap1 - heap0) / 1048576).toFixed(2),
  });
  await page.close();
}

async function scenarioResizeStorm() {
  const url = `${origin}/big`;
  const { page, cdp } = await newPage('resize');
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await openToolbar(page);
  const m = await measure(page, cdp, async () => {
    for (let i = 0; i < 40; i++) {
      await page.setViewportSize({ width: 700 + (i % 5) * 150, height: 500 + (i % 3) * 150 });
      await page.waitForTimeout(20);
    }
    await page.setViewportSize({ width: 1100, height: 760 });
    await page.waitForTimeout(400);
  });
  const fit = await page.evaluate(() => {
    const root = document.getElementById('page-anchor-host')?.shadowRoot;
    const c = root?.querySelector('.page-anchor-base-canvas');
    const tb = root?.querySelector('.pa-toolbar-wrapper')?.getBoundingClientRect();
    return {
      canvasCss: c ? Math.round(c.getBoundingClientRect().width) : -1,
      clientWidth: document.documentElement.clientWidth,
      toolbarOnScreen: !!tb && tb.left >= 0 && tb.top >= 0 && tb.right <= window.innerWidth && tb.bottom <= window.innerHeight,
    };
  });
  record('40 viewport resizes', fit.canvasCss === fit.clientWidth && fit.toolbarOnScreen && m.maxLongTask < 200, { ...m, ...fit });
  await page.close();
}

async function scenarioIdleTabCost() {
  const url = `${origin}/big`;
  await seed(url, bigElements(url, BIG));
  const idle = [];
  for (let i = 0; i < 2; i++) idle.push(await newPage(`idle${i}`));
  for (const [i, t] of idle.entries()) await t.page.goto(`${origin}/plain?idle=${i}`, { waitUntil: 'domcontentloaded' });
  const { page } = await newPage('saver');
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await waitBadge(page, BIG, 30000);
  await openToolbar(page);
  await page.keyboard.press('p');
  const before = await Promise.all(idle.map((t) => metrics(t.cdp)));
  const saves = 6;
  for (let i = 0; i < saves; i++) {
    await stroke(page, 300, 200 + i * 40);
    await page.waitForTimeout(450);
  }
  await page.waitForTimeout(600);
  const after = await Promise.all(idle.map((t) => metrics(t.cdp)));
  const perSave = after.map((a, i) => +(((a.TaskDuration - before[i].TaskDuration) * 1000) / saves).toFixed(1));
  record(`saving a ${BIG}-drawing page costs other tabs almost nothing`, perSave.every((ms) => ms < 10), { idleTabMsPerSave: perSave });
  for (const t of idle) await t.page.close();
  await page.close();
}

// ---------------------------------------------------------------- run

const scenarios = [
  scenarioBigPage,
  scenarioLongStroke,
  scenarioToolSwitchMidGesture,
  scenarioUndoRedoStorm,
  scenarioMutationStorm,
  scenarioManySavedPages,
  scenarioMultiTab,
  scenarioSpaStorm,
  scenarioReinjection,
  scenarioResizeStorm,
  scenarioIdleTabCost,
];

// PA_ONLY=scenarioName[,scenarioName] runs a subset while iterating.
const only = process.env.PA_ONLY?.split(',');
for (const s of scenarios.filter((x) => !only || only.includes(x.name))) {
  try {
    await storage.clear();
    await s();
  } catch (e) {
    record(`${s.name} crashed`, false, { error: String(e?.message ?? e).split('\n')[0] });
  }
}

record('no extension errors in page consoles', pageErrors.length === 0, { errors: pageErrors.slice(0, 10) });

fs.writeFileSync(path.join(ROOT, RESULTS_FILE), JSON.stringify({ ext: EXT, generatedAt: new Date().toISOString(), results }, null, 2));
console.log(`\n${results.filter((r) => r.pass).length}/${results.length} checks passed, wrote ${RESULTS_FILE}`);

await context.close();
server.close();
server.closeAllConnections();
try {
  fs.rmSync(userDataDir, { recursive: true, force: true });
} catch {}
process.exit(results.every((r) => r.pass) ? 0 : 1);
