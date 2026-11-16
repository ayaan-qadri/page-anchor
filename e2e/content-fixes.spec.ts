import type { BrowserContext, Page } from '@playwright/test';
import { test, expect } from './fixtures';
import {
  drawStroke,
  getServiceWorker,
  openToolbar,
  pa,
  readStorage,
  startServer,
  storedElementCount,
  writeStorage,
  type TestServer,
} from './helpers';

const DATA_PREFIX = 'page_anchor_data:';

const PAGES: Record<string, string> = {
  '/ws': `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Indented Markup</title></head>
<body style="margin: 0; font-family: sans-serif;">
  <div class="quote-card" style="position: absolute; left: 100px; top: 100px; width: 300px; height: 100px; background: #e2e8f0;">
        <span>Quarterly</span>
            <span>revenue     report</span>
        <span>for the northern region</span>
  </div>
  <div style="height: 2000px"></div>
</body>
</html>`,
  '/select': `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Select Page</title></head>
<body style="margin: 0; padding: 24px; font-family: sans-serif;">
  <select id="picker"><option>apple</option><option>eggplant</option><option>pear</option></select>
  <div style="height: 2000px"></div>
</body>
</html>`,
};

function stroke(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    type: 'pen',
    points: [
      { x: 150, y: 130 },
      { x: 220, y: 150 },
      { x: 300, y: 165 },
    ],
    strokeColor: '#ef4444',
    strokeWidth: 6,
    opacity: 1,
    createdAt: 1,
    bbox: { minX: 150, minY: 130, maxX: 300, maxY: 165 },
    ...extra,
  };
}

async function seedPage(context: BrowserContext, normalizedUrl: string, elements: unknown[]): Promise<void> {
  await writeStorage(context, {
    [`${DATA_PREFIX}${normalizedUrl}`]: {
      url: normalizedUrl,
      normalizedUrl,
      pageTitle: 'Seeded',
      updatedAt: 1,
      elements,
    },
  });
}

async function gotoReady(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#page-anchor-host')).toBeAttached();
}

async function drawOne(page: Page, context: BrowserContext, expected: string): Promise<void> {
  await openToolbar(page, context);
  await pa(page, '[data-tool="pen"]').click();
  await drawStroke(page, [140, 220], [320, 260]);
  await expect(pa(page, '.pa-count-badge')).toHaveText(expected);
}

async function dataKeys(context: BrowserContext): Promise<string[]> {
  return Object.keys(await readStorage(context)).filter((k) => k.startsWith(DATA_PREFIX));
}

/** Count of sampled non-transparent pixels across the overlay canvases. */
async function overlayInk(page: Page): Promise<number> {
  return page.evaluate(() => {
    const root = document.getElementById('page-anchor-host')?.shadowRoot;
    if (!root) return 0;
    let ink = 0;
    for (const canvas of Array.from(root.querySelectorAll('canvas'))) {
      const ctx = canvas.getContext('2d');
      if (!ctx || canvas.width === 0 || canvas.height === 0) continue;
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      for (let i = 3; i < data.length; i += 16) if (data[i] > 0) ink++;
    }
    return ink;
  });
}

test.describe('Page Anchor: content script fixes', () => {
  let server: TestServer;

  test.beforeAll(async () => {
    server = await startServer(PAGES);
  });

  test.afterAll(async () => {
    await server?.close();
  });

  test('SPA pushState from the page script loads the new route drawings', async ({ context }) => {
    await seedPage(context, `${server.origin}/spa/b`, [stroke('spa-b')]);

    const page = context.pages()[0] || (await context.newPage());
    await gotoReady(page, `${server.origin}/spa/a`);
    await openToolbar(page, context);
    await expect(pa(page, '.pa-count-badge')).toBeHidden();

    await page.evaluate(() => history.pushState({}, '', '/spa/b'));
    await expect(pa(page, '.pa-count-badge')).toHaveText('1', { timeout: 5000 });

    await page.evaluate(() => history.pushState({}, '', '/spa/a'));
    await expect(pa(page, '.pa-count-badge')).toBeHidden({ timeout: 5000 });
  });

  test('two tabs on one page: idle tab never overwrites, edits sync live', async ({ context }) => {
    // Tracking params are stripped from the key, so both tabs share one page while staying distinguishable.
    const tabA = context.pages()[0] || (await context.newPage());
    await gotoReady(tabA, `${server.origin}/shared?utm_source=a`);
    const tabB = await context.newPage();
    await gotoReady(tabB, `${server.origin}/shared?utm_source=b`);

    await openToolbar(tabA, context);
    await tabB.bringToFront();
    await drawOne(tabB, context, '1');
    await expect.poll(() => storedElementCount(context, '/shared')).toBe(1);

    await expect(pa(tabA, '.pa-count-badge')).toHaveText('1', { timeout: 5000 });

    await tabA.close();
    await tabB.waitForTimeout(600);
    expect(await storedElementCount(context, '/shared')).toBe(1);
    await expect(pa(tabB, '.pa-count-badge')).toHaveText('1');
  });

  test('a re-injected content script takes over and keeps saving', async ({ context }) => {
    const page = context.pages()[0] || (await context.newPage());
    await gotoReady(page, `${server.origin}/takeover`);

    const worker = await getServiceWorker(context);
    if (!worker) throw new Error('extension service worker not found');
    await worker.evaluate(async (url: string) => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find((t) => t.url === url);
      if (!tab?.id) throw new Error('tab not found');
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content-scripts/content.js'] });
    }, page.url());

    await expect(page.locator('#page-anchor-host')).toHaveCount(1);
    await drawOne(page, context, '1');
    await expect(page.locator('#page-anchor-host')).toHaveCount(1);
    await expect.poll(() => storedElementCount(context, '/takeover')).toBe(1);
  });

  test('an anchor whose element has whitespace-indented text still resolves', async ({ context }) => {
    await seedPage(context, `${server.origin}/ws`, [
      stroke('ws-1', {
        anchor: {
          selector: '#card-that-no-longer-exists',
          textQuote: { exact: 'Quarterly revenue report for the northern region' },
          initialRect: { left: 100, top: 100, width: 300, height: 100 },
        },
      }),
    ]);

    const page = context.pages()[0] || (await context.newPage());
    await gotoReady(page, `${server.origin}/ws`);
    await expect.poll(() => overlayInk(page), { timeout: 5000 }).toBeGreaterThan(0);
  });

  test('hash routes are separate pages, plain #section anchors are the same page', async ({ context }) => {
    const page = context.pages()[0] || (await context.newPage());
    await gotoReady(page, `${server.origin}/hr#/a`);
    await drawOne(page, context, '1');
    await expect.poll(() => storedElementCount(context, '/hr#/a')).toBe(1);

    await page.evaluate(() => {
      location.hash = '#/b';
    });
    await expect(pa(page, '.pa-count-badge')).toBeHidden({ timeout: 5000 });

    await page.evaluate(() => {
      location.hash = '#/a';
    });
    await expect(pa(page, '.pa-count-badge')).toHaveText('1', { timeout: 5000 });

    await gotoReady(page, `${server.origin}/doc`);
    await drawOne(page, context, '1');
    await expect.poll(() => storedElementCount(context, '/doc')).toBe(1);
    await page.evaluate(() => {
      location.hash = '#section';
    });
    await page.waitForTimeout(400);
    await expect(pa(page, '.pa-count-badge')).toHaveText('1');

    await gotoReady(page, `${server.origin}/doc?utm_source=x#another-section`);
    await openToolbar(page, context);
    await expect(pa(page, '.pa-count-badge')).toHaveText('1');
    expect((await dataKeys(context)).filter((k) => k.includes('/doc'))).toEqual([`${DATA_PREFIX}${server.origin}/doc`]);
  });

  test('a trailing slash is the same page', async ({ context }) => {
    const page = context.pages()[0] || (await context.newPage());
    await gotoReady(page, `${server.origin}/slash/`);
    await drawOne(page, context, '1');
    await expect.poll(() => storedElementCount(context, '/slash')).toBe(1);

    await gotoReady(page, `${server.origin}/slash`);
    await openToolbar(page, context);
    await expect(pa(page, '.pa-count-badge')).toHaveText('1');
  });

  test('changing the URL match mode migrates saved drawings', async ({ context, extensionId }) => {
    const page = context.pages()[0] || (await context.newPage());
    await gotoReady(page, `${server.origin}/mode/one?x=1`);
    await drawOne(page, context, '1');
    await expect.poll(() => storedElementCount(context, '/mode/one')).toBe(1);

    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    await options.waitForLoadState('domcontentloaded');
    await expect(options.locator('#pref-url-match-mode')).toBeAttached();
    // Retried because the options page wires its listeners only after its async init.
    await expect
      .poll(async () => {
        await options.evaluate(() => {
          const select = document.getElementById('pref-url-match-mode') as HTMLSelectElement;
          select.value = 'domain';
          select.dispatchEvent(new Event('change', { bubbles: true }));
          (document.getElementById('btn-save') as HTMLButtonElement).click();
        });
        const settings = (await readStorage(context)).page_anchor_settings as { urlMatchMode?: string } | undefined;
        return settings?.urlMatchMode;
      })
      .toBe('domain');

    await expect.poll(() => dataKeys(context)).toEqual([`${DATA_PREFIX}${server.origin}`]);
    await options.close();

    await page.bringToFront();
    await openToolbar(page, context);
    await expect(pa(page, '.pa-count-badge')).toHaveText('1', { timeout: 5000 });

    await gotoReady(page, `${server.origin}/mode/two`);
    await openToolbar(page, context);
    await expect(pa(page, '.pa-count-badge')).toHaveText('1');
  });

  test('importing a backup merges with existing saved pages', async ({ context, extensionId }) => {
    const page = context.pages()[0] || (await context.newPage());
    await gotoReady(page, `${server.origin}/imp/local`);
    await drawOne(page, context, '1');
    await expect.poll(() => storedElementCount(context, '/imp/local')).toBe(1);

    const importedUrl = `${server.origin}/imp/remote`;
    const backup = {
      page_anchor_index: {
        [importedUrl]: { normalizedUrl: importedUrl, url: importedUrl, pageTitle: 'Imported', updatedAt: 2, elementCount: 1 },
      },
      [`${DATA_PREFIX}${importedUrl}`]: {
        url: importedUrl,
        normalizedUrl: importedUrl,
        pageTitle: 'Imported',
        updatedAt: 2,
        elements: [stroke('imported-1')],
      },
    };

    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    await options.waitForLoadState('domcontentloaded');
    const indexKeys = async () =>
      Object.keys(((await readStorage(context)).page_anchor_index ?? {}) as Record<string, unknown>).sort();
    // Retried because the options page wires its file listener only after its async init.
    await expect
      .poll(async () => {
        await options.setInputFiles('#backup-file-input', {
          name: 'backup.json',
          mimeType: 'application/json',
          buffer: Buffer.from(JSON.stringify(backup)),
        });
        return indexKeys();
      })
      .toEqual([`${server.origin}/imp/local`, importedUrl].sort());
    expect(await storedElementCount(context, '/imp/local')).toBe(1);
    expect(await storedElementCount(context, '/imp/remote')).toBe(1);
  });

  test('tool shortcuts do not fire while a select element has focus', async ({ context }) => {
    const page = context.pages()[0] || (await context.newPage());
    await gotoReady(page, `${server.origin}/select`);
    await openToolbar(page, context);
    await pa(page, '[data-tool="pen"]').click();
    await expect(pa(page, '[data-tool="pen"]')).toHaveClass(/active/);

    await page.focus('#picker');
    await page.keyboard.press('e');
    await expect(pa(page, '[data-tool="pen"]')).toHaveClass(/active/);
    await expect(pa(page, '[data-tool="eraser"]')).not.toHaveClass(/active/);

    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('e');
    await expect(pa(page, '[data-tool="eraser"]')).toHaveClass(/active/);
  });

  test('a same-page hash change keeps undo history', async ({ context }) => {
    const page = context.pages()[0] || (await context.newPage());
    await gotoReady(page, `${server.origin}/undo`);
    await drawOne(page, context, '1');
    const undo = pa(page, '[data-action="undo"]');
    await expect(undo).toBeEnabled();

    await page.evaluate(() => {
      location.hash = 'section-2';
    });
    await page.waitForTimeout(400);

    await expect(undo).toBeEnabled();
    await undo.click();
    await expect(pa(page, '.pa-count-badge')).toBeHidden();
  });
});
