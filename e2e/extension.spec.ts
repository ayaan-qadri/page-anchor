import { test, expect } from './fixtures';
import http from 'http';

test.describe('Page Anchor: Real Browser Extension End-to-End Tests', () => {
  let server: http.Server;
  let serverPort: number;

  test.beforeAll(async () => {
    server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Real User Web Page</title>
</head>
<body style="margin: 0; padding: 20px;">
  <h1 id="title">Sample Web Document</h1>
  <p id="para">Real user interaction testing page.</p>
  <div id="target-box" style="width: 300px; height: 150px; background: #e2e8f0; border-radius: 8px; padding: 10px;">
    Target Box for Drawing
  </div>
</body>
</html>`);
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as any;
        serverPort = addr.port;
        resolve();
      });
    });
  });

  test.afterAll(async () => {
    server?.close();
  });

  test('injects into web page, toggles toolbar, and supports pointer drawing interactions', async ({
    context,
  }) => {
    const page = await context.newPage();

    // Navigate to the local HTTP server page via localhost where content scripts are permitted
    await page.goto(`http://localhost:${serverPort}/test-page`);
    await page.waitForLoadState('domcontentloaded');

    // Wait for the Page Anchor host element to be mounted into the DOM
    const host = page.locator('#page-anchor-host');
    await expect(host).toBeAttached({ timeout: 15000 });

    // Ensure the Shadow DOM root is present
    const isShadowMounted = await page.evaluate(() => {
      const el = document.getElementById('page-anchor-host');
      return !!el && !!el.shadowRoot;
    });
    expect(isShadowMounted).toBe(true);

    // Click the anchor pill to open drawing toolbar
    const pill = host.locator('.pa-anchor-pill');
    await expect(pill).toBeVisible({ timeout: 5000 });
    await pill.click();

    // Verify floating toolbar becomes visible
    const toolbar = host.locator('.pa-toolbar');
    await expect(toolbar).toBeVisible({ timeout: 5000 });

    // Select the Rectangle tool
    const rectTool = host.locator('[data-tool="rect"]');
    await expect(rectTool).toBeVisible();
    await rectTool.click();

    // Perform real mouse gestures on the active canvas
    const canvas = host.locator('.page-anchor-active-canvas');
    await expect(canvas).toBeVisible();

    const box = await canvas.boundingBox();
    if (box) {
      await page.mouse.move(box.x + 100, box.y + 100);
      await page.mouse.down();
      await page.mouse.move(box.x + 300, box.y + 250, { steps: 5 });
      await page.mouse.up();
    }

    // Switch to Pen tool and draw freehand
    const penTool = host.locator('[data-tool="pen"]');
    await penTool.click();

    if (box) {
      await page.mouse.move(box.x + 150, box.y + 150);
      await page.mouse.down();
      await page.mouse.move(box.x + 220, box.y + 180, { steps: 4 });
      await page.mouse.move(box.x + 260, box.y + 150, { steps: 4 });
      await page.mouse.up();
    }

    // Toggle DOM anchoring mode button
    const domAnchorBtn = host.locator('[data-action="dom-anchor"]');
    await expect(domAnchorBtn).toBeVisible();
    await domAnchorBtn.click();
    await expect(domAnchorBtn).toHaveAttribute('aria-pressed', 'false');

    await domAnchorBtn.click();
    await expect(domAnchorBtn).toHaveAttribute('aria-pressed', 'true');
  });

  test('opens and interacts with extension options page in browser', async ({ context, extensionId }) => {
    // If extensionId is obtained, open options via chrome-extension URL, otherwise open options.html
    const page = await context.newPage();
    const url = extensionId
      ? `chrome-extension://${extensionId}/options.html`
      : `http://127.0.0.1:${serverPort}/options.html`;

    if (extensionId) {
      await page.goto(url);
      await page.waitForLoadState('domcontentloaded');

      // Verify title and tabs
      await expect(page.locator('h1')).toHaveText(/Page Anchor/i);

      const shortcutsTab = page.locator('#tab-btn-shortcuts');
      const drawingTab = page.locator('#tab-btn-drawing');
      const persistenceTab = page.locator('#tab-btn-persistence');

      await expect(shortcutsTab).toBeVisible();
      await expect(drawingTab).toBeVisible();
      await expect(persistenceTab).toBeVisible();

      // Click drawing tab and verify inputs
      await drawingTab.click();
      const penColorInput = page.locator('#pref-pen-color');
      await expect(penColorInput).toBeVisible();

      // Click persistence tab
      await persistenceTab.click();
      const matchModeSelect = page.locator('#pref-url-match-mode');
      await expect(matchModeSelect).toBeVisible();
    }
  });
});
