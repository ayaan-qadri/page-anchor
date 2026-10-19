import { test, expect } from './fixtures';
import http from 'http';

test.describe('Page Anchor: Pure Real-User End-to-End Tests', () => {
  let server: http.Server;
  let serverPort: number;

  test.beforeAll(async () => {
    server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Customer Portal Page</title>
</head>
<body style="margin: 0; padding: 24px; font-family: sans-serif;">
  <header style="border-bottom: 2px solid #ccc; padding-bottom: 12px; margin-bottom: 20px;">
    <h1 id="portal-title">Customer Documentation Portal</h1>
    <nav><a href="#overview">Overview</a> | <a href="#settings">Settings</a></nav>
  </header>
  <main>
    <section id="section-intro" style="margin-bottom: 30px;">
      <h2>Getting Started with Page Anchor</h2>
      <p id="lead-text">Draw and anchor notes directly onto any web interface.</p>
      <div id="content-card" style="width: 320px; height: 160px; background: #e2e8f0; border: 1px solid #cbd5e1; border-radius: 8px; padding: 16px;">
        Interactive Canvas Target Box
      </div>
    </section>
  </main>
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

  test('USER FLOW 1: Drawing shapes, freehand, text note, undo/redo, and keyboard shortcuts', async ({
    context,
  }) => {
    const page = await context.newPage();

    await page.goto(`http://localhost:${serverPort}/portal`);
    await page.waitForLoadState('domcontentloaded');

    const dockTab = page.locator('#page-anchor-host .pa-dock-tab');
    await expect(dockTab).toBeVisible({ timeout: 10000 });

    await dockTab.click();

    const toolbar = page.locator('#page-anchor-host .pa-toolbar');
    await expect(toolbar).toBeVisible();

    const rectTool = page.locator('#page-anchor-host [data-tool="rect"]');
    await rectTool.click();
    await expect(rectTool).toHaveClass(/active/);

    await page.mouse.move(120, 160);
    await page.mouse.down();
    await page.mouse.move(380, 320, { steps: 5 });
    await page.mouse.up();

    const badge = page.locator('#page-anchor-host .pa-dock-badge');
    await expect(badge).toHaveText('1');

    const penTool = page.locator('#page-anchor-host [data-tool="pen"]');
    await penTool.click();
    await expect(penTool).toHaveClass(/active/);

    await page.mouse.move(200, 200);
    await page.mouse.down();
    await page.mouse.move(260, 240, { steps: 4 });
    await page.mouse.move(320, 200, { steps: 4 });
    await page.mouse.up();

    await expect(badge).toHaveText('2');

    const textTool = page.locator('#page-anchor-host [data-tool="text"]');
    await textTool.click();
    await expect(textTool).toHaveClass(/active/);

    await page.mouse.click(400, 160);

    const textarea = page.locator('#page-anchor-host .pa-text-textarea');
    await expect(textarea).toBeVisible();

    await page.keyboard.type('Q4 Roadmap Feedback');
    await page.keyboard.press('Enter');

    await expect(textarea).toBeHidden();
    await expect(badge).toHaveText('3');

    const undoBtn = page.locator('#page-anchor-host [data-action="undo"]');
    await expect(undoBtn).toBeEnabled();
    await undoBtn.click();

    await expect(badge).toHaveText('2');

    const redoBtn = page.locator('#page-anchor-host [data-action="redo"]');
    await expect(redoBtn).toBeEnabled();
    await redoBtn.click();

    await expect(badge).toHaveText('3');

    await page.keyboard.press('Alt+Shift+KeyD');
    await expect(toolbar).toBeHidden();

    await page.keyboard.press('Alt+Shift+KeyD');
    await expect(toolbar).toBeVisible();

    const anchorBtn = page.locator('#page-anchor-host [data-action="dom-anchor"]');
    await expect(anchorBtn).toHaveAttribute('aria-pressed', 'true');
    await anchorBtn.click();
    await expect(anchorBtn).toHaveAttribute('aria-pressed', 'false');
    await anchorBtn.click();
    await expect(anchorBtn).toHaveAttribute('aria-pressed', 'true');
  });

  test('USER FLOW 2: Preferences configuration, tab navigation, & shortcut rebinding', async ({
    context,
    extensionId,
  }) => {
    // Unconditional validation that extension is loaded in browser
    expect(extensionId).toBeTruthy();

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('h1')).toHaveText(/Page Anchor/i);

    const persistenceTab = page.locator('#tab-btn-persistence');
    await persistenceTab.click();
    await expect(persistenceTab).toHaveAttribute('aria-selected', 'true');

    const matchMode = page.locator('#pref-url-match-mode');
    await matchMode.selectOption('domain');

    const strokeSimplification = page.locator('#pref-stroke-simplification');
    await strokeSimplification.uncheck();

    const shortcutsTab = page.locator('#tab-btn-shortcuts');
    await shortcutsTab.click();
    await expect(shortcutsTab).toHaveAttribute('aria-selected', 'true');

    const firstKeyBadge = page.locator('.pa-key-badge').first();
    await firstKeyBadge.click();
    await expect(firstKeyBadge).toHaveClass(/recording/);

    await page.keyboard.press('Control+Shift+KeyU');
    await expect(firstKeyBadge).not.toHaveClass(/recording/);
    await expect(firstKeyBadge).toHaveText(/Ctrl\s*\+\s*Shift\s*\+\s*U/i);

    const saveBtn = page.locator('#btn-save');
    await saveBtn.click();

    const toast = page.locator('div[role="status"]');
    await expect(toast).toBeVisible();
    await expect(toast).toHaveText('Settings saved successfully!');
  });

  test('USER FLOW 3: Extension popup opening, status display, and navigation to options', async ({
    context,
    extensionId,
  }) => {
    expect(extensionId).toBeTruthy();

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('.pa-brand-title')).toHaveText('Page Anchor');

    const toggleSwitch = page.locator('#toggle-draw-mode');
    await expect(toggleSwitch).toBeAttached();

    const clearCard = page.locator('#btn-clear');
    await expect(clearCard).toBeVisible();

    const optionsBtn = page.locator('#btn-options');
    await expect(optionsBtn).toBeVisible();
  });
});
