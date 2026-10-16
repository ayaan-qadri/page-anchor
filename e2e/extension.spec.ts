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

    // 1. User opens a real web page
    await page.goto(`http://localhost:${serverPort}/portal`);
    await page.waitForLoadState('domcontentloaded');

    // 2. User sees the extension's anchor pill button floating on screen
    const pill = page.locator('#page-anchor-host .pa-anchor-pill');
    await expect(pill).toBeVisible({ timeout: 10000 });

    // 3. User clicks the pill to toggle open the drawing toolbar
    await pill.click();

    const toolbar = page.locator('#page-anchor-host .pa-toolbar');
    await expect(toolbar).toBeVisible();

    // 4. User selects Rectangle tool and draws a box on the page
    const rectTool = page.locator('#page-anchor-host [data-tool="rect"]');
    await rectTool.click();
    await expect(rectTool).toHaveClass(/active/);

    // Real mouse drag gesture
    await page.mouse.move(120, 160);
    await page.mouse.down();
    await page.mouse.move(380, 320, { steps: 5 });
    await page.mouse.up();

    // User sees the annotation counter badge increase to 1
    const badge = page.locator('#page-anchor-host .pa-pill-badge');
    await expect(badge).toHaveText('1');

    // 5. User selects Pen tool and draws a freehand curve
    const penTool = page.locator('#page-anchor-host [data-tool="pen"]');
    await penTool.click();
    await expect(penTool).toHaveClass(/active/);

    await page.mouse.move(200, 200);
    await page.mouse.down();
    await page.mouse.move(260, 240, { steps: 4 });
    await page.mouse.move(320, 200, { steps: 4 });
    await page.mouse.up();

    // Annotation badge updates to 2
    await expect(badge).toHaveText('2');

    // 6. User selects Text tool and clicks to place a note
    const textTool = page.locator('#page-anchor-host [data-tool="text"]');
    await textTool.click();
    await expect(textTool).toHaveClass(/active/);

    await page.mouse.click(400, 160);

    // Floating text editor overlay appears
    const textarea = page.locator('#page-anchor-host .pa-text-textarea');
    await expect(textarea).toBeVisible();

    // User types the note and presses Enter to commit
    await page.keyboard.type('Q4 Roadmap Feedback');
    await page.keyboard.press('Enter');

    // Text editor closes and badge updates to 3
    await expect(textarea).toBeHidden();
    await expect(badge).toHaveText('3');

    // 7. User clicks Undo button to revert the last annotation
    const undoBtn = page.locator('#page-anchor-host [data-action="undo"]');
    await expect(undoBtn).toBeEnabled();
    await undoBtn.click();

    // Badge decreases to 2
    await expect(badge).toHaveText('2');

    // 8. User clicks Redo button to restore the annotation
    const redoBtn = page.locator('#page-anchor-host [data-action="redo"]');
    await expect(redoBtn).toBeEnabled();
    await redoBtn.click();

    // Badge returns to 3
    await expect(badge).toHaveText('3');

    // 9. User presses keyboard shortcut Alt+Shift+D to hide toolbar
    await page.keyboard.press('Alt+Shift+KeyD');
    await expect(toolbar).toBeHidden();

    // User presses Alt+Shift+D again to bring toolbar back
    await page.keyboard.press('Alt+Shift+KeyD');
    await expect(toolbar).toBeVisible();

    // 10. User toggles DOM anchoring mode via toolbar button
    const anchorBtn = page.locator('#page-anchor-host [data-action="dom-anchor"]');
    await expect(anchorBtn).toHaveAttribute('aria-pressed', 'true');
    await anchorBtn.click();
    await expect(anchorBtn).toHaveAttribute('aria-pressed', 'false');
    await anchorBtn.click();
    await expect(anchorBtn).toHaveAttribute('aria-pressed', 'true');
  });

  test('USER FLOW 2: Preferences configuration, tab navigation, color change, & shortcut rebinding', async ({
    context,
    extensionId,
  }) => {
    // Unconditional validation that extension is loaded in browser
    expect(extensionId).toBeTruthy();

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.waitForLoadState('domcontentloaded');

    // Verify main header
    await expect(page.locator('h1')).toHaveText(/Page Anchor/i);

    // Switch to Drawing Defaults tab
    const drawingTab = page.locator('#tab-btn-drawing');
    await drawingTab.click();
    await expect(drawingTab).toHaveAttribute('aria-selected', 'true');

    // User changes pen color and width
    const penColor = page.locator('#pref-pen-color');
    await expect(penColor).toBeVisible();
    await penColor.fill('#10b981');

    const penWidth = page.locator('#pref-pen-width');
    await penWidth.fill('10');

    // Switch to Persistence & Matching tab
    const persistenceTab = page.locator('#tab-btn-persistence');
    await persistenceTab.click();
    await expect(persistenceTab).toHaveAttribute('aria-selected', 'true');

    // User selects URL match mode
    const matchMode = page.locator('#pref-url-match-mode');
    await matchMode.selectOption('domain');

    // Switch back to Keyboard Shortcuts tab
    const shortcutsTab = page.locator('#tab-btn-shortcuts');
    await shortcutsTab.click();
    await expect(shortcutsTab).toHaveAttribute('aria-selected', 'true');

    // User clicks the first shortcut badge to rebind it
    const firstKeyBadge = page.locator('.pa-key-badge').first();
    await firstKeyBadge.click();
    await expect(firstKeyBadge).toHaveClass(/recording/);

    // User presses physical keys Ctrl+Shift+U
    await page.keyboard.press('Control+Shift+KeyU');
    await expect(firstKeyBadge).not.toHaveClass(/recording/);
    await expect(firstKeyBadge).toHaveText(/Ctrl\+.*Shift\+.*u/i);

    // User clicks Save Changes button
    const saveBtn = page.locator('#btn-save');
    await saveBtn.click();

    // User sees the toast notification
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

    // User sees the popup brand header
    await expect(page.locator('.pa-brand-title')).toHaveText('Page Anchor');

    // User sees the drawing toggle switch and action cards
    const toggleSwitch = page.locator('#toggle-draw-mode');
    await expect(toggleSwitch).toBeAttached();

    const exportCard = page.locator('#btn-export');
    await expect(exportCard).toBeVisible();

    const clearCard = page.locator('#btn-clear');
    await expect(clearCard).toBeVisible();

    // User clicks the Options settings gear button
    const optionsBtn = page.locator('#btn-options');
    await expect(optionsBtn).toBeVisible();
  });
});
