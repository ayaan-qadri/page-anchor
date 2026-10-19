/**
 * Functional edge-case probes against the built extension, in a real browser.
 * Each probe reports PASS/FAIL plus the observed value.
 *
 * `chrome.storage` is unavailable in the page's main world, so every storage
 * read/write goes through a real extension page.
 *
 * Usage: pnpm build && node scripts/edge-cases.mjs
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
const out = [];
const record = (name, pass, detail) => {
  out.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Edge Cases</title>
<style>body{margin:0;font-family:sans-serif}header{padding:12px}main{padding:16px}
article{height:90px;margin-bottom:20px;border:1px solid #ccc;padding:10px}</style></head>
<body><header><h1>Edge cases</h1></header><main>
${Array.from({ length: 8 }, (_, i) => `<article id="card-${i}"><h2>Card ${i}</h2><p>Body ${i}</p></article>`).join('')}
</main></body></html>`;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(html);
});

const port = await new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const base = `http://127.0.0.1:${port}/page`;

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-edge-'));
const context = await chromium.launchPersistentContext(userDataDir, {
  headless: false,
  viewport: { width: 1280, height: 800 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});

let background = context.serviceWorkers()[0];
if (!background) background = await context.waitForEvent('serviceworker', { timeout: 10000 });
const extensionId = background.url().split('/')[2];

const options = await context.newPage();
await options.goto(`chrome-extension://${extensionId}/options.html`);

const store = (fn, arg) => options.evaluate(fn, arg);

async function openToolbar(page) {
  const toolbar = page.locator('#page-anchor-host .pa-toolbar');
  if (await toolbar.isVisible().catch(() => false)) return toolbar;
  const dock = page.locator('#page-anchor-host .pa-dock-tab');
  await dock.waitFor({ state: 'visible', timeout: 20000 });
  await dock.click();
  await toolbar.waitFor({ state: 'visible', timeout: 10000 });
  return toolbar;
}

const page = await context.newPage();
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(base);
await openToolbar(page);

// ---- 1. Toolbar drag position persists across reload ----
const handle = page.locator('#page-anchor-host .pa-drag-handle');
const hb = await handle.boundingBox();
await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
await page.mouse.down();
await page.mouse.move(hb.x + 160, hb.y + 120, { steps: 8 });
await page.mouse.up();
const dragged = await page
  .locator('#page-anchor-host .pa-toolbar-wrapper')
  .evaluate((el) => ({ left: el.style.left, top: el.style.top }));
await page.waitForTimeout(700);
const stored = await store(() =>
  new Promise((r) => chrome.storage.local.get('page_anchor_settings', (v) => r(v.page_anchor_settings)))
);
await page.reload();
await openToolbar(page);
const afterReload = await page
  .locator('#page-anchor-host .pa-toolbar-wrapper')
  .evaluate((el) => ({ left: el.style.left, top: el.style.top }));
record(
  'toolbar drag position persists across reload',
  JSON.stringify(afterReload) === JSON.stringify(dragged),
  `dragged=${JSON.stringify(dragged)} stored=${JSON.stringify(stored?.toolbarPosition ?? null)} afterReload=${JSON.stringify(afterReload)}`
);

// ---- 2. Quota exhaustion on the real save path ----
await page.evaluate(() => window.scrollTo(0, 0));
await openToolbar(page);
await page.locator('#page-anchor-host [data-tool="rect"]').click();
await page.mouse.move(120, 200);
await page.mouse.down();
await page.mouse.move(300, 300, { steps: 5 });
await page.mouse.up();
await page.waitForTimeout(600);

const beforeQuota = await store(() =>
  new Promise((r) =>
    chrome.storage.local.get(null, (v) =>
      r({
        dataKeys: Object.keys(v).filter((k) => k.startsWith('page_anchor_data:')).length,
        indexEntries: Object.keys(v.page_anchor_index || {}).length,
      })
    )
  )
);

const fill = await store(async () => {
  // Fill to the exact remaining quota so even a tiny page payload cannot fit.
  const quota = chrome.storage.local.QUOTA_BYTES;
  const used = await chrome.storage.local.getBytesInUse(null);
  const key = 'filler_exact';
  const overhead = key.length;
  const size = Math.max(0, quota - used - overhead - 40);
  try {
    await chrome.storage.local.set({ [key]: 'x'.repeat(size) });
    const usedAfter = await chrome.storage.local.getBytesInUse(null);
    return { quota, used, usedAfter, freeAfter: quota - usedAfter };
  } catch (e) {
    return { quota, used, error: String(e?.message || e) };
  }
});

errors.length = 0;
await page.mouse.move(400, 200);
await page.mouse.down();
await page.mouse.move(560, 320, { steps: 5 });
await page.mouse.up();
await page.waitForTimeout(1000);

const afterQuota = await store(() =>
  new Promise((r) => {
    chrome.storage.local.get(null, (v) => {
      const keys = Object.keys(v).filter((k) => k.startsWith('page_anchor_data:'));
      r({
        dataKeys: keys.length,
        indexEntries: Object.keys(v.page_anchor_index || {}).length,
        counts: keys.map((k) => v[k].elements.length),
      });
    });
  })
);
const pageBadge = await page.locator('#page-anchor-host .pa-dock-badge').textContent();
const quotaErrorSurfaced = await page.evaluate(() => {
  const host = document.getElementById('page-anchor-host');
  const toast = host?.shadowRoot?.querySelector('.pa-save-error');
  return !!toast;
});
record(
  'quota exhaustion is surfaced to the user',
  quotaErrorSurfaced,
  `fill=${JSON.stringify(fill)} before=${JSON.stringify(beforeQuota)} after=${JSON.stringify(afterQuota)} badge=${pageBadge}`
);

await store(async () => {
  const all = await chrome.storage.local.get(null);
  await chrome.storage.local.remove(Object.keys(all).filter((k) => k.startsWith('filler_')));
});
await store(() =>
  new Promise((r) => {
    chrome.storage.local.get(null, async (all) => {
      await chrome.storage.local.remove(
        Object.keys(all).filter(
          (k) => k.startsWith('page_anchor_data:http://x.test') || k.startsWith('page_anchor_data:http://y.test')
        )
      );
      r(null);
    });
  })
);

// ---- 3. Malformed / hostile backup import ----
const importProbe = await options.evaluate(async () => {
  const results = {};
  const target = document.getElementById('backup-file-input');
  const status = document.getElementById('import-status');

  const tryImport = async (label, payload) => {
    if (status) status.textContent = '';
    const file = new File([payload], 'backup.json', { type: 'application/json' });
    const dt = new DataTransfer();
    dt.items.add(file);
    target.files = dt.files;
    target.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 500));
    results[label] = { status: status?.textContent || '' };
  };

  await tryImport('not-json', 'this is not json');
  await tryImport('empty-object', '{}');
  await tryImport('foreign-keys', JSON.stringify({ evil: { a: 1 } }));
  await tryImport(
    'xss-url',
    JSON.stringify({
      'page_anchor_data:http://x.test/': {
        url: 'javascript:alert(1)',
        normalizedUrl: 'http://x.test/',
        pageTitle: '<img src=x onerror=alert(1)>',
        updatedAt: 1,
        elements: [{ id: 'a', type: 'pen', points: [{ x: 1, y: 2 }], strokeColor: '#000' }],
      },
      page_anchor_index: {
        'http://x.test/': {
          normalizedUrl: 'http://x.test/',
          url: 'javascript:alert(1)',
          pageTitle: '<img src=x onerror=alert(1)>',
          updatedAt: 1,
          elementCount: 1,
        },
      },
    })
  );
  await tryImport(
    'bad-element-types',
    JSON.stringify({
      'page_anchor_data:http://y.test/': {
        url: 'http://y.test/',
        normalizedUrl: 'http://y.test/',
        pageTitle: 'y',
        updatedAt: 1,
        elements: [
          { id: 'nope', type: 'evil' },
          { id: 'nan', type: 'rect', startX: 'NaN', endX: null, strokeWidth: 'wide' },
          { type: 'text', text: 42 },
          null,
          7,
        ],
      },
    })
  );
  return results;
});

record('rejects non-JSON backup', /invalid/i.test(importProbe['not-json'].status), importProbe['not-json'].status);
record('rejects empty object backup', /invalid/i.test(importProbe['empty-object'].status), importProbe['empty-object'].status);
record(
  'rejects backup with only foreign keys',
  /invalid/i.test(importProbe['foreign-keys'].status),
  importProbe['foreign-keys'].status
);

await options.reload();
await options.waitForTimeout(800);
const savedRows = await options.evaluate(() =>
  Array.from(document.querySelectorAll('.pa-saved-url')).map((el) => ({
    tag: el.tagName,
    text: el.textContent,
    href: el.getAttribute('href'),
  }))
);
const jsRow = savedRows.find((r) => r.text?.includes('javascript:'));
record(
  'untrusted javascript: URL never becomes a link',
  !jsRow || jsRow.tag !== 'A',
  JSON.stringify(savedRows)
);
const titles = await options.evaluate(() =>
  Array.from(document.querySelectorAll('.pa-saved-title')).map((e) => e.innerHTML)
);
record('stored page title is escaped as text', !titles.some((h) => h.includes('<img')), JSON.stringify(titles));

const storedBad = await store(() =>
  new Promise((r) => chrome.storage.local.get('page_anchor_data:http://y.test/', (v) => r(v['page_anchor_data:http://y.test/'])))
);
record(
  'malformed elements are dropped, valid ones kept',
  Array.isArray(storedBad?.elements) && storedBad.elements.length === 1,
  `kept=${storedBad?.elements?.length} ${JSON.stringify(storedBad?.elements?.map((e) => e.type))}`
);

// ---- 4. Rapid SPA URL changes ----
await page.goto(base);
await openToolbar(page);
const spa = await page.evaluate(async () => {
  const t0 = performance.now();
  for (let i = 0; i < 40; i++) history.pushState({}, '', `/page?step=${i}`);
  const pushMs = performance.now() - t0;
  await new Promise((r) => setTimeout(r, 1000));
  return { pushMs: +pushMs.toFixed(1), url: location.href };
});
const stillAlive = await page.evaluate(() => !!document.getElementById('page-anchor-host')?.dataset.paMounted);
record(
  'rapid SPA navigation does not wedge the content script',
  stillAlive && spa.url.includes('step=39'),
  `40 pushState in ${spa.pushMs}ms, mounted=${stillAlive}`
);

// ---- 5. Orphaned anchors respect the hide/dim setting ----
await page.goto(base);
await openToolbar(page);
await page.locator('#page-anchor-host [data-tool="rect"]').click();
await page.mouse.move(140, 260);
await page.mouse.down();
await page.mouse.move(320, 340, { steps: 5 });
await page.mouse.up();
await page.waitForTimeout(700);
const orphan = await page.evaluate(async () => {
  const card = document.getElementById('card-3');
  const anchorEl = document.querySelector('#page-anchor-host .pa-dock-badge');
  card?.remove();
  await new Promise((r) => setTimeout(r, 400));
  const root = document.getElementById('page-anchor-host')?.shadowRoot;
  const canvas = root?.querySelector('.page-anchor-base-canvas');
  if (!canvas) return { alpha: null, badge: anchorEl?.textContent, reason: 'canvas missing' };
  const ctx = canvas.getContext('2d');
  const dpr = canvas.width / window.innerWidth;
  const px = ctx.getImageData(180 * dpr, 280 * dpr, 1, 1).data;
  return { alpha: px[3], badge: anchorEl?.textContent };
});
record('orphaned drawing is hidden by default', orphan.alpha === 0, `pixel alpha=${orphan.alpha} badge=${orphan.badge}`);

// ---- 6. domain URL match mode ----
const pageKeyBefore = await store(async () => {
  const all = await chrome.storage.local.get(null);
  return Object.keys(all).filter((k) => k.startsWith('page_anchor_data:'));
});
await store(async () => {
  const s = await chrome.storage.local.get('page_anchor_settings');
  await chrome.storage.local.set({
    page_anchor_settings: { ...(s.page_anchor_settings || {}), urlMatchMode: 'domain' },
  });
});
await page.reload();
await openToolbar(page);
await page.locator('#page-anchor-host [data-tool="rect"]').click();
await page.mouse.move(150, 320);
await page.mouse.down();
await page.mouse.move(280, 400, { steps: 5 });
await page.mouse.up();
await page.waitForTimeout(800);
const domain = await store(async () => {
  const all = await chrome.storage.local.get(null);
  return Object.keys(all).filter((k) => k.startsWith('page_anchor_data:'));
});
const newKeys = domain.filter((k) => !pageKeyBefore.includes(k));
record(
  'domain mode keys data by origin',
  newKeys.length > 0 && newKeys.every((k) => /^page_anchor_data:https?:\/\/[^/]+$/.test(k)),
  JSON.stringify({ before: pageKeyBefore, after: domain, newKeys })
);

fs.writeFileSync(path.join(ROOT, 'edge-results.json'), JSON.stringify(out, null, 2));
console.log(`\n${out.filter((r) => r.pass).length}/${out.length} probes passed`);

await context.close();
server.close();
try {
  fs.rmSync(userDataDir, { recursive: true, force: true });
} catch {}
process.exit(out.every((r) => r.pass) ? 0 : 1);
