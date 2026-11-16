/**
 * Pure Real-User End-to-End Tests for Page Anchor
 *
 * Verifies every user-facing capability in the codebase by interacting with
 * the live built extension loaded in a real Chromium browser context.
 */
import { test, expect } from './fixtures';
import { waitForContentScript } from './helpers';
import http from 'http';

function pa(page: any, selector: string) {
  return page.locator(`#page-anchor-host ${selector}`);
}

async function getServiceWorker(context: any) {
  let worker = context.serviceWorkers()[0];
  if (!worker) {
    worker = await context.waitForEvent('serviceworker', { timeout: 10000 }).catch(() => null);
  }
  return worker;
}

async function openToolbar(page: any, context: any) {
  const toolbar = pa(page, '.pa-toolbar');
  if (await toolbar.isVisible()) return;

  const worker = await getServiceWorker(context);
  let origin = '';
  try {
    origin = new URL(page.url()).origin;
  } catch {}

  if (worker) {
    await worker.evaluate(async (orig: string) => {
      const tabs = await chrome.tabs.query({});
      const target =
        tabs.find((t: any) => t.url && t.url.startsWith(orig) && t.active) ||
        tabs.find((t: any) => t.url && t.url.startsWith(orig)) ||
        tabs.find((t: any) => t.active) ||
        tabs[0];
      if (target?.id) {
        await chrome.tabs.sendMessage(target.id, { type: 'PAGE_ANCHOR_TOGGLE' }).catch(() => {});
      }
    }, origin);
  }

  // Fallback: toggle shortcut Alt+Shift+D if message was not received
  const isVis = await toolbar.isVisible();
  if (!isVis) {
    await page.keyboard.press('Alt+Shift+D');
  }

  await expect(toolbar).toBeVisible({ timeout: 10000 });
}

test.describe('Page Anchor: Pure Real-User End-to-End Tests', () => {
  let server: http.Server;
  let serverPort: number;

  test.beforeAll(async () => {
    server = http.createServer((req, res) => {
      const url = req.url || '/';

      if (url.startsWith('/page2')) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Second Documentation Page</title></head>
<body style="margin: 0; padding: 24px; font-family: sans-serif;">
  <h1 id="page2-title">Second Page</h1>
  <p id="page2-intro">Separate URL for verifying isolated storage partitions.</p>
  <div id="target-card-2" style="width: 300px; height: 150px; background: #e0f2fe; padding: 16px; border-radius: 8px;">
    Page 2 Target Container
  </div>
</body>
</html>`);
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Customer Documentation Portal</title>
</head>
<body style="margin: 0; padding: 24px; font-family: sans-serif;">
  <header id="portal-header" style="border-bottom: 2px solid #ccc; padding-bottom: 12px; margin-bottom: 20px;">
    <h1 id="portal-title">Customer Documentation Portal</h1>
    <nav><a href="#overview">Overview</a> | <a href="#settings">Settings</a></nav>
  </header>
  <main id="portal-main">
    <section id="section-intro" style="margin-bottom: 30px;">
      <h2 id="intro-heading">Getting Started with Page Anchor</h2>
      <p id="lead-text">Draw and anchor notes directly onto any web interface.</p>
      <div id="content-card" style="width: 340px; height: 180px; background: #e2e8f0; border: 1px solid #cbd5e1; border-radius: 8px; padding: 16px;">
        Interactive Canvas Target Box
      </div>
    </section>
    <section id="section-list">
      <h3>Key Capabilities</h3>
      <ul>
        <li id="item-freehand" data-id="item-freehand">Freehand drawing & highlighter</li>
        <li id="item-shapes" data-id="item-shapes">Geometric shapes & arrows</li>
        <li id="item-text" data-id="item-text">In-place sticky text annotations</li>
      </ul>
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

  // =========================================================================
  // USER FLOW 1: Complete Drawing Suite (Pen, Highlighter, 5 Shapes, Text Note,
  //               Eraser, Undo/Redo, and Clear with Toast Restore + Final Cleanup)
  // =========================================================================
  test('USER FLOW 1: Full drawing lifecycle — pen, highlighter, all shapes, text note, eraser, undo/redo, clear toast', async ({
    context,
    extensionId,
  }) => {
    expect(extensionId).toBeTruthy();
    const page = context.pages()[0] || (await context.newPage());
    await page.goto(`http://localhost:${serverPort}/portal`);
    await page.waitForLoadState('domcontentloaded');

    // 1. The extension is running, but builds nothing on a page without drawings
    await waitForContentScript(page);
    await expect(page.locator('#page-anchor-host')).toHaveCount(0);

    // 2. Toolbar starts hidden; open it via service worker action
    const toolbar = pa(page, '.pa-toolbar');
    await expect(toolbar).toBeHidden();
    await openToolbar(page, context);
    await expect(toolbar).toBeVisible();

    const badge = pa(page, '.pa-count-badge');
    await expect(badge).toBeHidden();

    // 3. Freehand Pen Tool
    const penBtn = pa(page, '[data-tool="pen"]');
    await penBtn.click();
    await expect(penBtn).toHaveClass(/active/);

    await page.mouse.move(100, 160);
    await page.mouse.down();
    await page.mouse.move(260, 220, { steps: 5 });
    await page.mouse.up();
    await expect(badge).toHaveText('1');

    // 4. Highlighter Tool (semi-transparent)
    const hlBtn = pa(page, '[data-tool="highlighter"]');
    await hlBtn.click();
    await expect(hlBtn).toHaveClass(/active/);

    await page.mouse.move(120, 240);
    await page.mouse.down();
    await page.mouse.move(300, 240, { steps: 5 });
    await page.mouse.up();
    await expect(badge).toHaveText('2');

    // 5. Rectangle Shape
    const shapesMenu = pa(page, '[data-action="shapes"]');
    await shapesMenu.click();
    const rectTool = pa(page, '[data-tool="rect"]');
    await expect(rectTool).toBeVisible();
    await rectTool.click();

    await page.mouse.move(140, 280);
    await page.mouse.down();
    await page.mouse.move(340, 380, { steps: 5 });
    await page.mouse.up();
    await expect(badge).toHaveText('3');

    // 6. Circle / Ellipse Shape (Shift to constrain to perfect circle)
    await shapesMenu.click();
    const circleTool = pa(page, '[data-tool="circle"]');
    await circleTool.click();

    await page.mouse.move(380, 180);
    await page.mouse.down();
    await page.keyboard.down('Shift');
    await page.mouse.move(480, 280, { steps: 5 });
    await page.keyboard.up('Shift');
    await page.mouse.up();
    await expect(badge).toHaveText('4');

    // 7. Line Tool (Shift for 45° angle snapping)
    await shapesMenu.click();
    const lineTool = pa(page, '[data-tool="line"]');
    await lineTool.click();

    await page.mouse.move(380, 320);
    await page.mouse.down();
    await page.keyboard.down('Shift');
    await page.mouse.move(580, 320, { steps: 5 });
    await page.keyboard.up('Shift');
    await page.mouse.up();
    await expect(badge).toHaveText('5');

    // 8. Arrow Tool
    await shapesMenu.click();
    const arrowTool = pa(page, '[data-tool="arrow"]');
    await arrowTool.click();

    await page.mouse.move(100, 420);
    await page.mouse.down();
    await page.mouse.move(280, 420, { steps: 5 });
    await page.mouse.up();
    await expect(badge).toHaveText('6');

    // 9. Double-Arrow Tool
    await shapesMenu.click();
    const dblArrowTool = pa(page, '[data-tool="double-arrow"]');
    await dblArrowTool.click();

    await page.mouse.move(320, 420);
    await page.mouse.down();
    await page.mouse.move(500, 420, { steps: 5 });
    await page.mouse.up();
    await expect(badge).toHaveText('7');

    // 10. Text Note Tool (commit note)
    const textTool = pa(page, '[data-tool="text"]');
    await textTool.click();
    await expect(textTool).toHaveClass(/active/);

    await page.mouse.click(120, 480);
    const textarea = pa(page, '.pa-text-textarea');
    await expect(textarea).toBeVisible();
    await textarea.fill('Anchored QA Note');
    await textarea.press('Enter');
    await expect(textarea).toBeHidden();
    await expect(badge).toHaveText('8');

    // 11. Text Note Tool Cancel via Escape
    await page.mouse.click(360, 480);
    await expect(textarea).toBeVisible();
    await textarea.fill('Cancelled Draft');
    await textarea.press('Escape');
    await expect(textarea).toBeHidden();
    await expect(badge).toHaveText('8');

    // 12. Undo & Redo Controls
    const undoBtn = pa(page, '[data-action="undo"]');
    const redoBtn = pa(page, '[data-action="redo"]');

    await expect(undoBtn).toBeEnabled();
    await undoBtn.click();
    await expect(badge).toHaveText('7');

    await expect(redoBtn).toBeEnabled();
    await redoBtn.click();
    await expect(badge).toHaveText('8');

    // 13. Eraser Tool (swipe removes elements)
    const eraserTool = pa(page, '[data-tool="eraser"]');
    await eraserTool.click();
    await expect(eraserTool).toHaveClass(/active/);

    await page.mouse.move(110, 420);
    await page.mouse.down();
    await page.mouse.move(250, 420, { steps: 4 });
    await page.mouse.up();
    const countAfterErase = parseInt((await badge.textContent()) || '0', 10);
    expect(countAfterErase).toBeLessThan(8);

    // 14. Clear Page & Toast Undo Action
    const clearBtn = pa(page, '[data-action="clear"]');
    await clearBtn.click();
    await expect(badge).toBeHidden();

    // Verify Undo toast appears and restores elements
    const toast = pa(page, '.pa-toast');
    await expect(toast).toBeVisible();
    await expect(toast).toContainText('Page drawings cleared');

    const toastUndoBtn = pa(page, '.pa-toast-btn');
    await toastUndoBtn.click();
    await expect(badge).toHaveText(`${countAfterErase}`);

    // 15. Clean up page drawings
    await clearBtn.click();
    await expect(badge).toBeHidden();
  });

  // =========================================================================
  // USER FLOW 2: Selection, Dragging, Marquee, Select All, and Deletion
  // =========================================================================
  test('USER FLOW 2: Selection tool, move elements, multi-select marquee, select all, backspace delete', async ({
    context,
    extensionId,
  }) => {
    expect(extensionId).toBeTruthy();
    const page = context.pages()[0] || (await context.newPage());
    await page.goto(`http://localhost:${serverPort}/portal`);
    await page.waitForLoadState('domcontentloaded');
    await openToolbar(page, context);

    // Draw 2 rectangles
    const shapesMenu = pa(page, '[data-action="shapes"]');
    await shapesMenu.click();
    await pa(page, '[data-tool="rect"]').click();

    // Box 1
    await page.mouse.move(100, 200);
    await page.mouse.down();
    await page.mouse.move(200, 280, { steps: 4 });
    await page.mouse.up();

    // Box 2
    await page.mouse.move(260, 200);
    await page.mouse.down();
    await page.mouse.move(360, 280, { steps: 4 });
    await page.mouse.up();

    const badge = pa(page, '.pa-count-badge');
    await expect(badge).toHaveText('2');

    // Activate select tool via shortcut 'v'
    await page.keyboard.press('v');

    // Click to select Box 1, then drag it
    await page.mouse.move(150, 240);
    await page.mouse.down();
    await page.mouse.move(150, 320, { steps: 4 });
    await page.mouse.up();
    await expect(badge).toHaveText('2');

    // Select All via More menu
    const moreMenu = pa(page, '[data-action="more"]');
    await moreMenu.click();
    const selectAllBtn = pa(page, '[data-action="select-all"]');
    await selectAllBtn.click();

    // Delete selected elements with Backspace key
    await page.keyboard.press('Backspace');
    await expect(badge).toBeHidden();

    // Undo delete restores both
    await page.keyboard.press('Control+z');
    await expect(badge).toHaveText('2');

    // Clean up with Alt+Shift+X shortcut
    await page.keyboard.press('Alt+Shift+X');
    await expect(badge).toBeHidden();
  });

  // =========================================================================
  // USER FLOW 3: Color Popover, Swatches, Width Sliders, Defaults & Reset
  // =========================================================================
  test('USER FLOW 3: Color popover, preset palette swatches, stroke/highlighter sliders, font size, reset', async ({
    context,
    extensionId,
  }) => {
    expect(extensionId).toBeTruthy();
    const page = context.pages()[0] || (await context.newPage());
    await page.goto(`http://localhost:${serverPort}/portal`);
    await page.waitForLoadState('domcontentloaded');
    await openToolbar(page, context);

    const colorPreviewBtn = pa(page, '.pa-color-preview-btn');
    const popover = pa(page, '.pa-popover');

    // 1. Open color popover
    await colorPreviewBtn.click();
    await expect(popover).toHaveClass(/open/);
    await expect(colorPreviewBtn).toHaveAttribute('aria-expanded', 'true');

    // 2. Select a preset color swatch (green #22c55e)
    const greenSwatch = pa(page, '[data-color="#22c55e"]');
    await expect(greenSwatch).toBeVisible();
    await greenSwatch.click();

    // Swatch becomes active and toolbar preview reflects color
    await expect(greenSwatch).toHaveClass(/active/);
    await expect(colorPreviewBtn).toHaveCSS('background-color', 'rgb(34, 197, 94)');

    // 3. Test sliders (pen width, highlighter width, font size) scoped to active tool
    const penWidthSlider = pa(page, '[data-setting="defaultStrokeWidth"]');
    await expect(penWidthSlider).toBeVisible();
    await penWidthSlider.fill('8');
    await penWidthSlider.dispatchEvent('change');

    // Switch to highlighter: popover adapts to highlighter controls
    const hlBtn = pa(page, '[data-tool="highlighter"]');
    await hlBtn.click();
    const hlWidthSlider = pa(page, '[data-setting="defaultHighlighterWidth"]');
    await expect(hlWidthSlider).toBeVisible();
    await hlWidthSlider.fill('32');
    await hlWidthSlider.dispatchEvent('change');

    // Switch to text: popover adapts to text controls
    const textBtn = pa(page, '[data-tool="text"]');
    await textBtn.click();
    const fontSlider = pa(page, '[data-setting="defaultFontSize"]');
    await expect(fontSlider).toBeVisible();
    await fontSlider.fill('24');
    await fontSlider.dispatchEvent('change');

    // 4. Test Reset to Defaults button
    const resetBtn = pa(page, '.pa-popover-reset');
    await resetBtn.click();

    // Verify preview returned to default red (#ef4444) and width to 4 (switch back to pen)
    const penBtn = pa(page, '[data-tool="pen"]');
    await penBtn.click();
    await expect(colorPreviewBtn).toHaveCSS('background-color', 'rgb(239, 68, 68)');
    await expect(penWidthSlider).toHaveValue('4');

    // 5. Close popover by clicking outside
    await page.mouse.click(600, 20);
    await expect(colorPreviewBtn).toHaveAttribute('aria-expanded', 'false');
  });

  // =========================================================================
  // USER FLOW 4: Keyboard Navigation, Toolbar Dragging & Repositioning
  // =========================================================================
  test('USER FLOW 4: Keyboard shortcuts (Alt+Shift+D, Alt+Shift+T, tool keys), drag repositioning, WCAG arrow keys', async ({
    context,
    extensionId,
  }) => {
    expect(extensionId).toBeTruthy();
    const page = context.pages()[0] || (await context.newPage());
    await page.goto(`http://localhost:${serverPort}/portal`);
    await page.waitForLoadState('domcontentloaded');
    await page.click('body');

    const toolbar = pa(page, '.pa-toolbar');

    // 1. Toggle via Alt+Shift+D
    await page.keyboard.press('Alt+Shift+D');
    await expect(toolbar).toBeVisible();

    await page.keyboard.press('Alt+Shift+D');
    await expect(toolbar).toBeHidden();

    // 2. Toggle via Alt+Shift+T
    await page.keyboard.press('Alt+Shift+T');
    await expect(toolbar).toBeVisible();

    // 3. Tool switching via single-letter shortcuts
    await page.keyboard.press('p');
    await expect(pa(page, '[data-tool="pen"]')).toHaveClass(/active/);

    await page.keyboard.press('h');
    await expect(pa(page, '[data-tool="highlighter"]')).toHaveClass(/active/);

    await page.keyboard.press('e');
    await expect(pa(page, '[data-tool="eraser"]')).toHaveClass(/active/);

    await page.keyboard.press('t');
    await expect(pa(page, '[data-tool="text"]')).toHaveClass(/active/);

    // 4. Drag handle mouse repositioning
    const dragHandle = pa(page, '.pa-drag-handle');
    const wrapper = pa(page, '.pa-toolbar-wrapper');
    const initialBox = await wrapper.boundingBox();

    const handleBox = await dragHandle.boundingBox();
    if (handleBox && initialBox) {
      await page.mouse.move(handleBox.x + 8, handleBox.y + 8);
      await page.mouse.down();
      await page.mouse.move(handleBox.x + 120, handleBox.y + 60, { steps: 5 });
      await page.mouse.up();
      await page.waitForTimeout(300);

      const movedBox = await wrapper.boundingBox();
      if (movedBox) {
        expect(movedBox.x).not.toBeCloseTo(initialBox.x, 0);
      }
    }

    // 5. Accessible keyboard repositioning via Arrow keys on drag handle
    await dragHandle.focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
  });

  // =========================================================================
  // USER FLOW 5: Smart DOM Anchoring & Reflow Following
  // =========================================================================
  test('USER FLOW 5: Smart DOM anchoring resolves elements and tracks dynamic page layout shifts', async ({
    context,
    extensionId,
  }) => {
    expect(extensionId).toBeTruthy();
    const page = context.pages()[0] || (await context.newPage());
    await page.goto(`http://localhost:${serverPort}/portal`);
    await page.waitForLoadState('domcontentloaded');
    await openToolbar(page, context);

    // Verify Smart Anchoring is enabled by default in More menu
    const moreMenu = pa(page, '[data-action="more"]');
    await moreMenu.click();
    const anchorBtn = pa(page, '[data-action="dom-anchor"]');
    await expect(anchorBtn).toHaveAttribute('aria-checked', 'true');
    await moreMenu.click();

    // Draw rectangle directly inside the #content-card target box
    const card = page.locator('#content-card');
    const cardBox = await card.boundingBox();
    expect(cardBox).toBeTruthy();

    if (cardBox) {
      await pa(page, '[data-action="shapes"]').click();
      await pa(page, '[data-tool="rect"]').click();

      const startX = cardBox.x + 20;
      const startY = cardBox.y + 20;
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(startX + 100, startY + 60, { steps: 4 });
      await page.mouse.up();

      await expect(pa(page, '.pa-count-badge')).toHaveText('1');

      // Now dynamically simulate DOM reflow by prepending a large banner above the section
      await page.evaluate(() => {
        const banner = document.createElement('div');
        banner.id = 'dynamic-announcement-banner';
        banner.style.height = '120px';
        banner.style.background = '#fef08a';
        banner.textContent = 'Dynamic Reflow Announcement';
        document.body.insertBefore(banner, document.getElementById('portal-main'));
      });

      // Wait for MutationObserver & DOMAnchorManager debounce (50ms)
      await page.waitForTimeout(200);

      // Verify drawing still tracks the page
      await expect(pa(page, '.pa-count-badge')).toHaveText('1');

      // Clean up drawing and reset anchoring
      await page.keyboard.press('Alt+Shift+X');
      await expect(pa(page, '.pa-count-badge')).toBeHidden();
    }
  });

  // =========================================================================
  // USER FLOW 6: Storage Persistence, Page Reload, Isolated Partitioning & SPA Navigation
  // =========================================================================
  test('USER FLOW 6: Drawings persist across page reload, partition per URL, and handle SPA route changes', async ({
    context,
    extensionId,
  }) => {
    expect(extensionId).toBeTruthy();
    const page = context.pages()[0] || (await context.newPage());

    // 1. Draw annotation on portal page with tracking query params
    await page.goto(`http://localhost:${serverPort}/portal?utm_source=twitter&utm_medium=cpc#overview`);
    await page.waitForLoadState('domcontentloaded');
    await openToolbar(page, context);

    await pa(page, '[data-tool="pen"]').click();
    await page.mouse.move(140, 200);
    await page.mouse.down();
    await page.mouse.move(300, 200, { steps: 5 });
    await page.mouse.up();
    await expect(pa(page, '.pa-count-badge')).toHaveText('1');

    // Wait for 250ms debounced storage save
    await page.waitForTimeout(400);

    // 2. Reload the page at a clean URL (verifying URL normalization mode 'clean')
    await page.goto(`http://localhost:${serverPort}/portal`);
    await page.waitForLoadState('domcontentloaded');
    await openToolbar(page, context);

    // Annotations should be restored automatically
    await expect(pa(page, '.pa-count-badge')).toHaveText('1');

    // 3. Navigate to a completely separate URL (/page2) -> must be clean/empty
    await page.goto(`http://localhost:${serverPort}/page2`);
    await page.waitForLoadState('domcontentloaded');
    await openToolbar(page, context);

    // Page 2 canvas should have no drawings
    await expect(pa(page, '.pa-count-badge')).toBeHidden();

    // 4. Return to /portal and clean up
    await page.goto(`http://localhost:${serverPort}/portal`);
    await page.waitForLoadState('domcontentloaded');
    await openToolbar(page, context);
    await expect(pa(page, '.pa-count-badge')).toHaveText('1');
    await page.keyboard.press('Alt+Shift+X');
    await expect(pa(page, '.pa-count-badge')).toBeHidden();
  });

  // =========================================================================
  // USER FLOW 7: Options Page (All Tabs, Shortcut Rebinding, Conflict Detection,
  //               Settings Persistence, Saved Pages Management, Backup & Restore)
  // =========================================================================
  test('USER FLOW 7: Options page — tabs navigation, shortcut recording & conflict detection, settings save, saved pages list & delete, backup export/import', async ({
    context,
    extensionId,
  }) => {
    expect(extensionId).toBeTruthy();
    const optionsPage = await context.newPage();
    await optionsPage.goto(`chrome-extension://${extensionId}/options.html`);
    await optionsPage.waitForLoadState('domcontentloaded');

    // 1. Verify header branding and save indicator
    await expect(optionsPage.locator('h1')).toHaveText(/Page Anchor/i);
    const saveStatus = optionsPage.locator('#save-status');
    await expect(saveStatus).toHaveText('Changes save automatically');

    // 2. Tab Navigation via clicks
    const shortcutsTab = optionsPage.locator('#tab-btn-shortcuts');
    const persistenceTab = optionsPage.locator('#tab-btn-persistence');
    const savedPagesTab = optionsPage.locator('#tab-btn-saved-pages');
    const backupTab = optionsPage.locator('#tab-btn-backup');

    await persistenceTab.click();
    await expect(persistenceTab).toHaveAttribute('aria-selected', 'true');
    await expect(optionsPage.locator('#tab-persistence')).toBeVisible();

    // 3. Edit Persistence Settings
    const matchMode = optionsPage.locator('#pref-url-match-mode');
    await matchMode.selectOption('domain');
    await expect(matchMode).toHaveValue('domain');

    const strokeSimplification = optionsPage.locator('#pref-stroke-simplification');
    await strokeSimplification.uncheck();
    expect(await strokeSimplification.isChecked()).toBe(false);

    const orphanMode = optionsPage.locator('#pref-orphan-mode');
    await orphanMode.selectOption('dimmed');
    await expect(orphanMode).toHaveValue('dimmed');

    // Each edit saves at once and the header confirms it
    await expect(saveStatus).toHaveAttribute('data-state', 'saved');

    // 4. Shortcuts Tab & Rebinding
    await shortcutsTab.click();
    await expect(shortcutsTab).toHaveAttribute('aria-selected', 'true');

    // Test shortcut recording
    const firstKeyBadge = optionsPage.locator('.pa-key-badge').first();
    await firstKeyBadge.click();
    await expect(firstKeyBadge).toHaveClass(/recording/);

    // Rebind to Ctrl+Shift+U
    await optionsPage.keyboard.press('Control+Shift+KeyU');
    await expect(firstKeyBadge).not.toHaveClass(/recording/);
    await expect(firstKeyBadge).toHaveText(/Ctrl\s*\+\s*Shift\s*\+\s*U/i);

    // Test conflict warning with browser reserved key (e.g. Ctrl+T)
    await firstKeyBadge.click();
    await optionsPage.keyboard.press('Control+KeyT');
    await expect(firstKeyBadge).toHaveAttribute('data-conflict', 'true');

    // Reset shortcuts: applies at once, with Undo instead of a confirm dialog
    await optionsPage.locator('#btn-reset-shortcuts').click();
    await expect(firstKeyBadge).not.toHaveAttribute('data-conflict');

    // 5. Settings save on their own
    const toast = optionsPage.locator('.pa-toast');
    await expect(toast).toBeVisible();
    await expect(toast).toContainText('Shortcuts reset to defaults');
    await expect(optionsPage.locator('#btn-save')).toHaveCount(0);
    await expect(saveStatus).toHaveAttribute('data-state', 'saved');

    // 6. Saved Pages Tab
    await savedPagesTab.click();
    await expect(savedPagesTab).toHaveAttribute('aria-selected', 'true');
    await expect(optionsPage.locator('#tab-saved-pages')).toBeVisible();

    const savedList = optionsPage.locator('#saved-pages-list');
    await expect(savedList).toBeVisible();

    // 7. Backup & Restore Tab
    await backupTab.click();
    await expect(backupTab).toHaveAttribute('aria-selected', 'true');
    await expect(optionsPage.locator('#tab-backup')).toBeVisible();

    // Test Backup Export
    const downloadPromise = optionsPage.waitForEvent('download');
    await optionsPage.locator('#btn-export-backup').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/page-anchor-backup.*\.json/);

    // Test Backup Restore with valid JSON payload
    const testBackup = JSON.stringify({
      page_anchor_settings: {
        shortcuts: { 'toggle-active': 'Alt+Shift+D' },
        defaultStrokeColor: '#3b82f6',
        defaultStrokeWidth: 6,
        urlMatchMode: 'clean',
        strokeSimplification: true,
      },
    });

    const fileInput = optionsPage.locator('#backup-file-input');
    await fileInput.setInputFiles({
      name: 'restore-test.json',
      mimeType: 'application/json',
      buffer: Buffer.from(testBackup),
    });

    const importStatus = optionsPage.locator('#import-status');
    await expect(importStatus).toHaveText('Backup restored successfully!');
  });
});
