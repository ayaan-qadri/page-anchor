/**
 * Throttled load test for the built Chrome MV3 extension.
 *
 * Loads the real extension into Chromium, serves a synthetic page, seeds 1,000
 * anchored elements, then drives drawing/scroll/select/erase/resize/text paths
 * while CDP applies CPU and network throttling. Reports main-thread task time,
 * frame-time percentiles, and long tasks per phase.
 *
 * Usage: pnpm build && node scripts/perf-throttle.mjs [--quick]
 */
import { chromium } from '@playwright/test';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const EXT = path.join(ROOT, '.output', 'chrome-mv3');
const QUICK = process.argv.includes('--quick');
const CARDS = QUICK ? 300 : 1000;
const RESULTS = [];

function pageHtml(cards) {
  const items = Array.from({ length: cards }, (_, i) => `
    <article id="card-${i}" class="card" style="height:96px;margin:0 0 24px;padding:12px;border:1px solid #cbd5e1;border-radius:8px">
      <h2 style="margin:0 0 6px;font-size:16px">Issue ${i}</h2>
      <p style="margin:0;color:#475569">Row ${i} body text for anchoring. Draw on this card and it should follow layout shifts.</p>
      <a href="/issue/${i}">Open issue ${i}</a>
    </article>`).join('');
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Stress ${cards}</title>
  <style>
    body{margin:0;font-family:sans-serif;background:#f8fafc}
    header{position:sticky;top:0;z-index:10;background:#fff;border-bottom:1px solid #ddd;padding:12px 24px}
    main{max-width:900px;margin:0 auto;padding:24px}
  </style></head><body>
  <header><strong>Stress page</strong> — ${cards} cards</header>
  <main>${items}</main></body></html>`;
}

const server = http.createServer((req, res) => {
  if (req.url?.startsWith('/light')) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(pageHtml(20));
    return;
  }
  if (req.url?.startsWith('/stress')) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(pageHtml(CARDS));
    return;
  }
  res.writeHead(404).end('nope');
});

const listen = () =>
  new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));

const pct = (arr, p) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return +s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))].toFixed(1);
};

const summarizeFrames = (deltas) => ({
  n: deltas.length,
  p50: pct(deltas, 50),
  p95: pct(deltas, 95),
  p99: pct(deltas, 99),
  max: deltas.length ? +Math.max(...deltas).toFixed(1) : null,
  over33ms: deltas.filter((d) => d > 33).length,
});

const summarizeLong = (list) => ({
  count: list.length,
  total: +list.reduce((a, b) => a + b, 0).toFixed(1),
  max: list.length ? +Math.max(...list).toFixed(1) : null,
});

async function snap(cdp) {
  const { metrics } = await cdp.send('Performance.getMetrics');
  const out = {};
  for (const m of metrics) out[m.name] = m.value;
  return out;
}

async function startFrames(page) {
  await page.evaluate(() => {
    const prev = window.__paPerf;
    if (prev?.raf) cancelAnimationFrame(prev.raf);
    prev?.obs?.disconnect();
    const state = { d: [], lt: [], raf: 0, obs: null };
    window.__paPerf = state;
    let last = performance.now();
    const loop = (t) => {
      state.d.push(t - last);
      last = t;
      state.raf = requestAnimationFrame(loop);
    };
    state.raf = requestAnimationFrame(loop);
    try {
      state.obs = new PerformanceObserver((l) => {
        for (const e of l.getEntries()) state.lt.push(e.duration);
      });
      state.obs.observe({ entryTypes: ['longtask'] });
    } catch {}
  });
}

async function stopFrames(page) {
  return page.evaluate(() => {
    const s = window.__paPerf;
    if (!s) return { d: [], lt: [] };
    cancelAnimationFrame(s.raf);
    s.obs?.disconnect();
    return { d: s.d.slice(1), lt: s.lt };
  });
}

async function runPhase(cdp, page, name, fn, meta = {}) {
  await startFrames(page);
  const before = await snap(cdp);
  const t0 = performance.now();
  let extra = {};
  let error = null;
  try {
    extra = (await fn()) ?? {};
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  const wall = +(performance.now() - t0).toFixed(1);
  const after = await snap(cdp);
  const frames = await stopFrames(page);
  const row = {
    phase: name,
    wallMs: wall,
    taskMs: +((after.TaskDuration - before.TaskDuration) * 1000).toFixed(1),
    scriptMs: +((after.ScriptDuration - before.ScriptDuration) * 1000).toFixed(1),
    layoutMs: +((after.LayoutDuration - before.LayoutDuration) * 1000).toFixed(1),
    styleMs: +((after.RecalcStyleDuration - before.RecalcStyleDuration) * 1000).toFixed(1),
    frames: summarizeFrames(frames.d),
    longTasks: summarizeLong(frames.lt),
    ...meta,
    ...extra,
    ...(error ? { error } : {}),
  };
  RESULTS.push(row);
  return row;
}

async function setCpu(cdp, rate) {
  await cdp.send('Emulation.setCPUThrottlingRate', { rate });
}

async function openDock(page) {
  const toolbar = page.locator('#page-anchor-host .pa-toolbar');
  if (await toolbar.isVisible().catch(() => false)) return;
  const dock = page.locator('#page-anchor-host .pa-dock-tab');
  await dock.waitFor({ state: 'visible', timeout: 15000 });
  await dock.click();
  await toolbar.waitFor({ state: 'visible', timeout: 10000 });
}

async function drawStrokes(page, n) {
  for (let i = 0; i < n; i++) {
    const x = 120 + ((i * 37) % 620);
    const y = 150 + ((i * 53) % 420);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 22, y + 14, { steps: 3 });
    await page.mouse.move(x + 44, y, { steps: 3 });
    await page.mouse.up();
  }
}

async function scrollSteps(page, steps, dy = 900) {
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, dy);
    await page.waitForTimeout(24);
  }
}

async function seedElements(context, extensionId, port, count) {
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  const result = await options.evaluate(
    async ({ count, port }) => {
      const url = `http://127.0.0.1:${port}/stress`;
      const elements = [];
      for (let i = 0; i < count; i++) {
        const top = 24 + 12 + 12 + i * 120 + 8;
        const points = [];
        for (let p = 0; p < 24; p++) {
          points.push({ x: 120 + p * 6, y: top + (p % 5) * 3 });
        }
        elements.push({
          id: `stroke_${i}`,
          type: 'pen',
          points,
          strokeColor: '#ef4444',
          strokeWidth: 4,
          opacity: 1,
          createdAt: Date.now(),
          bbox: {
            minX: 120,
            minY: top,
            maxX: 120 + 23 * 6,
            maxY: top + 12,
          },
          anchor: {
            selector: `#card-${i}`,
            initialRect: { left: 24 + 450 - 450, top: top - 8, width: 852, height: 96 },
            textQuote: { exact: `Issue ${i}` },
          },
        });
      }
      const data = {
        url,
        normalizedUrl: url,
        pageTitle: 'Stress page',
        updatedAt: Date.now(),
        elements,
        domAnchoringEnabled: true,
      };
      const index = {
        [url]: {
          normalizedUrl: url,
          url,
          pageTitle: 'Stress page',
          updatedAt: Date.now(),
          elementCount: elements.length,
          bytes: JSON.stringify(data).length,
        },
      };
      await chrome.storage.local.set({
        [`page_anchor_data:${url}`]: data,
        page_anchor_index: index,
      });
      const check = await chrome.storage.local.get(`page_anchor_data:${url}`);
      return {
        stored: !!check[`page_anchor_data:${url}`],
        count: check[`page_anchor_data:${url}`]?.elements?.length ?? 0,
        bytes: JSON.stringify(data).length,
      };
    },
    { count, port }
  );
  await options.close();
  return result;
}

async function measureLoad(page, url) {
  const t0 = performance.now();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.locator('#page-anchor-host').waitFor({ state: 'attached', timeout: 60000 });
  await page
    .locator('#page-anchor-host .pa-dock-tab, #page-anchor-host .pa-toolbar')
    .first()
    .waitFor({ state: 'attached', timeout: 60000 });
  const dockMs = +(performance.now() - t0).toFixed(1);
  const nav = await page.evaluate(() => {
    const n = performance.getEntriesByType('navigation')[0];
    return n
      ? {
          domContentLoaded: +n.domContentLoadedEventEnd.toFixed(1),
          load: +n.loadEventEnd.toFixed(1),
          transfer: n.transferSize,
        }
      : null;
  });
  return { dockMs, nav };
}

async function main() {
  const port = await listen();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-perf-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: { width: 1280, height: 800 },
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });

  let background = context.serviceWorkers()[0];
  if (!background) background = await context.waitForEvent('serviceworker', { timeout: 10000 });
  const extensionId = background.url().split('/')[2];

  const seeded = await seedElements(context, extensionId, port, CARDS);
  const lightUrl = `http://127.0.0.1:${port}/light`;
  const stressUrl = `http://127.0.0.1:${port}/stress`;

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');

  // ---- Baseline: light page, escalating CPU throttling ----
  await page.goto(lightUrl);
  await openDock(page);
  for (const rate of [1, 4, 6]) {
    await setCpu(cdp, rate);
    await runPhase(cdp, page, `light/idle@${rate}x`, async () => {
      await page.waitForTimeout(1500);
    });
    await runPhase(cdp, page, `light/draw-30-strokes@${rate}x`, async () => {
      await drawStrokes(page, 30);
    });
    await runPhase(cdp, page, `light/scroll-20@${rate}x`, async () => {
      await scrollSteps(page, 20);
    });
    await runPhase(cdp, page, `light/tool-toggle-30@${rate}x`, async () => {
      for (let i = 0; i < 3; i++) {
        for (const k of ['p', 'h', 'r', 'c', 'l', 'a', 'd', 't', 'e', 'v']) {
          await page.keyboard.press(k);
        }
      }
    });
    await runPhase(cdp, page, `light/resize-10@${rate}x`, async () => {
      for (let i = 0; i < 10; i++) {
        await page.setViewportSize({ width: 1100 + (i % 3) * 120, height: 720 + (i % 2) * 80 });
      }
      await page.setViewportSize({ width: 1280, height: 800 });
    });
    // Clear between rates so later phases start from a known element count.
    await page.keyboard.press('Alt+Shift+X');
  }

  // ---- Stress: 1,000 anchored elements ----
  for (const rate of [1, 4, 6]) {
    await setCpu(cdp, 1);
    const load = await measureLoad(page, stressUrl);
    await openDock(page);
    RESULTS.push({ phase: `stress/load@1x`, wallMs: load.dockMs, nav: load.nav, seeded: seeded.count });
    await setCpu(cdp, rate);

    await runPhase(cdp, page, `stress/idle-1.5s@${rate}x`, async () => {
      await page.waitForTimeout(1500);
    });
    await runPhase(cdp, page, `stress/scroll-20@${rate}x`, async () => {
      await scrollSteps(page, 20);
      await page.evaluate(() => window.scrollTo(0, 0));
    });
    await runPhase(cdp, page, `stress/select-all-drag@${rate}x`, async () => {
      await page.keyboard.press('Control+a');
      await page.mouse.move(640, 400);
      await page.mouse.down();
      for (let i = 0; i < 8; i++) await page.mouse.move(640 + i * 6, 400 + i * 4);
      await page.mouse.up();
    });
    await runPhase(cdp, page, `stress/eraser-drag@${rate}x`, async () => {
      await page.keyboard.press('e');
      await page.mouse.move(200, 250);
      await page.mouse.down();
      for (let i = 0; i < 10; i++) await page.mouse.move(200 + i * 60, 250 + (i % 2) * 40);
      await page.mouse.up();
    });
    await runPhase(cdp, page, `stress/tool-toggle-20@${rate}x`, async () => {
      for (let i = 0; i < 2; i++) {
        for (const k of ['p', 'h', 'r', 'c', 'l', 'a', 'd', 't', 'v']) await page.keyboard.press(k);
      }
    });
    await runPhase(cdp, page, `stress/resize-5@${rate}x`, async () => {
      for (let i = 0; i < 5; i++) {
        await page.setViewportSize({ width: 1024 + i * 60, height: 700 + i * 20 });
      }
      await page.setViewportSize({ width: 1280, height: 800 });
    });
    // Cache invalidation: every anchor must re-resolve.
    await runPhase(cdp, page, `stress/anchor-cache-invalidate@${rate}x`, async () => {
      await page.evaluate(() => {
        const d = document.createElement('div');
        d.id = 'perf-bump';
        d.textContent = 'bump';
        document.querySelector('main')?.appendChild(d);
      });
      await page.waitForTimeout(120);
      await scrollSteps(page, 4, 400);
    });
  }

  // ---- Orphan storm: every anchor target disappears ----
  await setCpu(cdp, 1);
  await page.goto(stressUrl);
  await openDock(page);
  for (const rate of [1, 4]) {
    await setCpu(cdp, rate);
    await runPhase(cdp, page, `stress/orphan-all-${CARDS}@${rate}x`, async () => {
      await page.evaluate(() => {
        for (const el of Array.from(document.querySelectorAll('main article'))) el.remove();
      });
      await page.waitForTimeout(200);
      await scrollSteps(page, 2, 500);
    });
  }

  // ---- Huge text note ----
  await setCpu(cdp, 1);
  await page.goto(lightUrl);
  await openDock(page);
  for (const rate of [1, 4]) {
    await setCpu(cdp, rate);
    await runPhase(cdp, page, `text/20k-chars@${rate}x`, async () => {
      await page.keyboard.press('t');
      await page.mouse.click(420, 220);
      const ta = page.locator('#page-anchor-host .pa-text-textarea');
      await ta.waitFor({ state: 'visible', timeout: 5000 });
      await ta.fill('lorem ipsum dolor sit amet '.repeat(800));
      await page.keyboard.press('Enter');
      await page.waitForTimeout(400);
      await scrollSteps(page, 6, 300);
    });
  }

  // ---- Network throttle: cold load with the extension attached ----
  await setCpu(cdp, 1);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 400,
    downloadThroughput: (400 * 1024) / 8,
    uploadThroughput: (400 * 1024) / 8,
  });
  await page.goto('about:blank');
  const slow = await measureLoad(page, stressUrl);
  RESULTS.push({ phase: 'network/slow-3g-load', wallMs: slow.dockMs, nav: slow.nav });
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });

  // ---- Storage pipeline + quota behaviour (extension page, CPU 6x) ----
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  const optionsCdp = await context.newCDPSession(options);
  await optionsCdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });

  const storage = await options.evaluate(async ({ count }) => {
    const key = `page_anchor_data:http://127.0.0.1/quota-test`;
    const payload = {
      url: 'http://127.0.0.1/quota-test',
      normalizedUrl: 'http://127.0.0.1/quota-test',
      pageTitle: 'quota',
      updatedAt: Date.now(),
      elements: Array.from({ length: count }, (_, i) => ({
        id: `s${i}`,
        type: 'pen',
        points: Array.from({ length: 24 }, (_, p) => ({ x: p * 5, y: i % 400 })),
        strokeColor: '#ef4444',
        strokeWidth: 4,
        opacity: 1,
        createdAt: 0,
        bbox: { minX: 0, minY: i % 400, maxX: 115, maxY: (i % 400) + 10 },
      })),
    };
    const round = async (fn) => {
      const t = performance.now();
      const v = await fn();
      return { ms: +(performance.now() - t).toFixed(1), v };
    };
    const getSettings = await round(() => chrome.storage.local.get('page_anchor_settings'));
    const setData = await round(() => chrome.storage.local.set({ [key]: payload }));
    const getData = await round(() => chrome.storage.local.get(key));
    const getIndex = await round(() => chrome.storage.local.get('page_anchor_index'));
    const setIndex = await round(() =>
      chrome.storage.local.set({ page_anchor_index: getIndex.v.page_anchor_index || {} })
    );
    const all = await round(() => chrome.storage.local.get(null));
    const bytes = JSON.stringify(payload).length;
    const quota = chrome.storage.local.QUOTA_BYTES;

    let quotaError = null;
    try {
      const huge = 'x'.repeat(11 * 1024 * 1024);
      await chrome.storage.local.set({ page_anchor_quota_probe: huge });
      await chrome.storage.local.remove('page_anchor_quota_probe');
    } catch (e) {
      quotaError = e instanceof Error ? e.message : String(e);
    }
    await chrome.storage.local.remove(key);
    return {
      bytes,
      quota,
      getSettings: getSettings.ms,
      setData: setData.ms,
      getData: getData.ms,
      getIndex: getIndex.ms,
      setIndex: setIndex.ms,
      getAll: all.ms,
      totalKeys: Object.keys(all.v || {}).length,
      quotaError,
    };
  }, { count: CARDS });

  RESULTS.push({ phase: 'storage/pipeline@6x', ...storage });

  await optionsCdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });

  const report = { generatedAt: new Date().toISOString(), cards: CARDS, seeded, errors, results: RESULTS };
  fs.writeFileSync(path.join(ROOT, 'perf-results.json'), JSON.stringify(report, null, 2));

  const pad = (v, n) => String(v ?? '-').padEnd(n);
  console.log(
    `\n${pad('phase', 44)}${pad('wall', 9)}${pad('task', 9)}${pad('script', 9)}${pad('p50', 7)}${pad('p95', 7)}${pad('p99', 7)}${pad('max', 8)}${pad('long', 7)}`
  );
  for (const r of RESULTS) {
    if (r.phase === 'storage/pipeline@6x') continue;
    const f = r.frames ?? {};
    console.log(
      `${pad(r.phase, 44)}${pad(r.wallMs, 9)}${pad(r.taskMs, 9)}${pad(r.scriptMs, 9)}${pad(f.p50, 7)}${pad(f.p95, 7)}${pad(f.p99, 7)}${pad(f.max, 8)}${pad(r.longTasks?.count, 7)}`
    );
  }
  console.log('\nstorage@6x:', JSON.stringify(storage, null, 2));
  if (errors.length) console.log('\npage errors:', errors.slice(0, 10));
  console.log('\nwrote perf-results.json');

  await context.close();
  server.close();
  try {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  } catch {}
}

main().catch((e) => {
  console.error(e);
  server.close();
  process.exit(1);
});
