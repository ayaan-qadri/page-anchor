import fs from 'fs';
import type { BrowserContext, Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { drawStroke, openToolbar, pa, readStorage, sendToggle, startServer, storedElementCount, writeStorage } from './helpers';

const SETTINGS_KEY = 'page_anchor_settings';

interface FocusInfo {
  tool: string | null;
  action: string | null;
  className: string;
}

/** The element focused inside the extension's shadow root, or null when focus is on the page. */
async function focusedInToolbar(page: Page): Promise<FocusInfo | null> {
  return page.evaluate(() => {
    const el = document.getElementById('page-anchor-host')?.shadowRoot?.activeElement;
    if (!(el instanceof HTMLElement)) return null;
    return { tool: el.dataset.tool ?? null, action: el.dataset.action ?? null, className: el.className };
  });
}

async function storedSettings(context: BrowserContext): Promise<Record<string, unknown>> {
  const all = await readStorage(context);
  return (all[SETTINGS_KEY] ?? {}) as Record<string, unknown>;
}

async function patchStoredSettings(context: BrowserContext, patch: Record<string, unknown>): Promise<void> {
  const current = await storedSettings(context);
  await writeStorage(context, { [SETTINGS_KEY]: { ...current, ...patch } });
}

async function firstPage(context: BrowserContext): Promise<Page> {
  return context.pages()[0] ?? (await context.newPage());
}

/** Waits until the content script has mounted and had time to apply stored settings. */
async function waitForMount(page: Page): Promise<void> {
  await expect(page.locator('#page-anchor-host')).toBeAttached();
  await page.waitForTimeout(500);
}

test.describe('UI review fixes', () => {
  test('options save keeps settings another tab changed while the options page was open', async ({ context, extensionId }) => {
    await writeStorage(context, { [SETTINGS_KEY]: { defaultStrokeColor: '#111111' } });
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    await expect(options.locator('.pa-key-badge').first()).toBeVisible();

    await patchStoredSettings(context, { defaultStrokeColor: '#222222', toolbarPosition: { x: 33, y: 44 }, areAnnotationsVisible: false });

    await options.locator('#tab-btn-persistence').click();
    await options.locator('#pref-stroke-simplification').uncheck();
    await options.locator('#btn-save').click();
    await expect(options.locator('#save-status')).toHaveAttribute('data-state', 'saved');

    await expect
      .poll(() => storedSettings(context))
      .toMatchObject({
        strokeSimplification: false,
        defaultStrokeColor: '#222222',
        toolbarPosition: { x: 33, y: 44 },
        areAnnotationsVisible: false,
      });
  });

  test('the toolbar open state is not remembered, while keep-open preference opens it on load', async ({ context, extensionId }) => {
    const server = await startServer();
    try {
      const page = await firstPage(context);
      const toolbar = pa(page, '.pa-toolbar');
      await page.goto(`${server.origin}/keep-open`);
      await waitForMount(page);
      await expect(toolbar).toBeHidden();

      await openToolbar(page, context);
      await page.waitForTimeout(400);
      const afterOpen = await storedSettings(context);
      expect(afterOpen).not.toHaveProperty('isToolbarOpen');
      expect(afterOpen.keepToolbarOpen ?? false).toBe(false);

      await page.reload();
      await waitForMount(page);
      await expect(toolbar).toBeHidden();

      const options = await context.newPage();
      await options.goto(`chrome-extension://${extensionId}/options.html`);
      await options.locator('#tab-btn-persistence').click();
      await options.locator('#pref-toolbar-open').check();
      await options.locator('#btn-save').click();
      await expect.poll(async () => (await storedSettings(context)).keepToolbarOpen).toBe(true);
      await options.close();

      await page.reload();
      await expect(toolbar).toBeVisible({ timeout: 10000 });

      await pa(page, '[data-action="hide"]').click();
      await expect(toolbar).toBeHidden();
      await page.waitForTimeout(400);
      expect((await storedSettings(context)).keepToolbarOpen).toBe(true);

      await page.reload();
      await expect(toolbar).toBeVisible({ timeout: 10000 });
    } finally {
      await server.close();
    }
  });

  test('More menu toggles keep their labels and reflect stored settings from the first load', async ({ context }) => {
    await writeStorage(context, { [SETTINGS_KEY]: { areAnnotationsVisible: false } });
    const server = await startServer();
    try {
      const page = await firstPage(context);
      await page.goto(`${server.origin}/toggles`);
      await waitForMount(page);
      await openToolbar(page, context);

      const more = pa(page, '[data-action="more"]');
      const visibility = pa(page, '[data-action="visibility"]');
      const anchoring = pa(page, '[data-action="dom-anchor"]');

      await more.click();
      await expect(visibility).toHaveAttribute('aria-checked', 'false');
      await expect(visibility.locator('.pa-menu-item-label')).toHaveText('Show Drawings');
      await expect(visibility.locator('.pa-menu-item-hint')).toHaveText('Off');
      await expect(anchoring).toHaveAttribute('aria-checked', 'true');
      await expect(anchoring.locator('.pa-menu-item-label')).toHaveText('Smart Anchoring');

      await visibility.click();
      await more.click();
      await expect(visibility).toHaveAttribute('aria-checked', 'true');
      await expect(visibility.locator('.pa-menu-item-label')).toHaveText('Show Drawings');
      await expect(visibility.locator('.pa-menu-item-hint')).toHaveText('On');
      await expect.poll(async () => (await storedSettings(context)).areAnnotationsVisible).toBe(true);

      await visibility.click();
      await more.click();
      await expect(visibility).toHaveAttribute('aria-checked', 'false');
      await expect(visibility.locator('.pa-menu-item-label')).toHaveText('Show Drawings');

      await anchoring.click();
      await more.click();
      await expect(anchoring).toHaveAttribute('aria-checked', 'false');
      await expect(anchoring.locator('.pa-menu-item-hint')).toHaveText('Off');
    } finally {
      await server.close();
    }
  });

  test('menus and the defaults popover are fully keyboard operable', async ({ context }) => {
    const server = await startServer();
    try {
      const page = await firstPage(context);
      await page.goto(`${server.origin}/keyboard`);
      await waitForMount(page);
      await openToolbar(page, context);

      const shapes = pa(page, '[data-action="shapes"]');
      await shapes.focus();
      await page.keyboard.press('Enter');
      await expect(shapes).toHaveAttribute('aria-expanded', 'true');
      await expect.poll(async () => (await focusedInToolbar(page))?.tool).toBe('rect');

      await page.keyboard.press('ArrowDown');
      await expect.poll(async () => (await focusedInToolbar(page))?.tool).toBe('circle');
      await page.keyboard.press('End');
      await expect.poll(async () => (await focusedInToolbar(page))?.tool).toBe('double-arrow');
      await page.keyboard.press('Home');
      await expect.poll(async () => (await focusedInToolbar(page))?.tool).toBe('rect');
      await page.keyboard.press('ArrowUp');
      await expect.poll(async () => (await focusedInToolbar(page))?.tool).toBe('double-arrow');

      await page.keyboard.press('Escape');
      await expect(shapes).toHaveAttribute('aria-expanded', 'false');
      await expect(pa(page, '.pa-menu.open')).toHaveCount(0);
      await expect.poll(async () => (await focusedInToolbar(page))?.action).toBe('shapes');

      await page.keyboard.press('Enter');
      await expect(shapes).toHaveAttribute('aria-expanded', 'true');
      await page.keyboard.press('Tab');
      await expect(shapes).toHaveAttribute('aria-expanded', 'false');
      const afterTab = await focusedInToolbar(page);
      expect(afterTab).not.toBeNull();
      expect(afterTab?.className).not.toContain('pa-menu-item');

      const colorBtn = pa(page, '.pa-color-preview-btn');
      const popover = pa(page, '.pa-popover');
      await colorBtn.focus();
      await page.keyboard.press('Enter');
      await expect(popover).toHaveClass(/open/);
      await expect.poll(async () => (await focusedInToolbar(page))?.className).toContain('pa-color-swatch');

      await page.keyboard.press('Escape');
      await expect(popover).not.toHaveClass(/open/);
      await expect(colorBtn).toHaveAttribute('aria-expanded', 'false');
      await expect.poll(async () => (await focusedInToolbar(page))?.className).toContain('pa-color-preview-btn');
    } finally {
      await server.close();
    }
  });

  test('hiding the toolbar from the keyboard hands focus back to the page', async ({ context }) => {
    const server = await startServer({
      '/form': `<!DOCTYPE html><html lang="en"><head><title>Form</title></head><body style="padding:24px">
        <label for="field">Name</label> <input id="field" type="text"><div style="height:2000px"></div></body></html>`,
    });
    try {
      const page = await firstPage(context);
      await page.goto(`${server.origin}/form`);
      await waitForMount(page);

      await page.locator('#field').focus();
      await sendToggle(page, context);
      await expect(pa(page, '.pa-toolbar')).toBeVisible({ timeout: 10000 });

      await pa(page, '[data-action="hide"]').focus();
      await page.keyboard.press('Enter');
      await expect(pa(page, '.pa-toolbar')).toBeHidden();
      expect(await page.evaluate(() => document.activeElement?.id)).toBe('field');
      expect(await focusedInToolbar(page)).toBeNull();

      await page.locator('#field').evaluate((el) => el.remove());
      await sendToggle(page, context);
      await expect(pa(page, '.pa-toolbar')).toBeVisible({ timeout: 10000 });
      await pa(page, '[data-action="hide"]').focus();
      await page.keyboard.press('Enter');
      await expect(pa(page, '.pa-toolbar')).toBeHidden();
      expect(await focusedInToolbar(page)).toBeNull();
    } finally {
      await server.close();
    }
  });

  test('options refuse a shortcut that another action already uses', async ({ context, extensionId }) => {
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/options.html`);

    const pen = options.locator('.pa-key-badge[data-shortcut-id="tool-pen"]');
    await expect(pen).toHaveText('P');
    await pen.click();
    await options.keyboard.press('h');

    const error = options.locator('#shortcut-error-tool-pen');
    await expect(error).toBeVisible();
    await expect(error).toHaveText('Already used by Highlighter.');
    await expect(pen).toHaveText('P');
    await expect(pen).toHaveAttribute('aria-describedby', 'shortcut-error-tool-pen');

    await options.locator('#btn-save').click();
    await options.waitForTimeout(300);
    const shortcuts = ((await storedSettings(context)).shortcuts ?? {}) as Record<string, string>;
    expect(shortcuts['tool-pen'] ?? 'p').toBe('p');

    await pen.click();
    await expect(error).toBeHidden();
    await options.keyboard.press('q');
    await expect(pen).toHaveText('Q');
  });

  test('shortcut labels in menus and tooltips follow stored and changed settings', async ({ context }) => {
    await writeStorage(context, { [SETTINGS_KEY]: { shortcuts: { 'tool-rect': 'q', 'tool-pen': 'k' } } });
    const server = await startServer();
    try {
      const page = await firstPage(context);
      await page.goto(`${server.origin}/labels`);
      await waitForMount(page);
      await openToolbar(page, context);

      await expect(pa(page, '[data-tool="rect"] .pa-menu-item-key')).toHaveText('Q');
      await expect(pa(page, '.pa-btn[data-tool="pen"]')).toHaveAttribute('aria-label', 'Pen (K)');
      await expect(pa(page, '.pa-btn[data-tool="pen"] .pa-tooltip kbd')).toHaveText('K');

      await patchStoredSettings(context, { shortcuts: { 'tool-rect': 'w', 'tool-pen': 'j' } });
      await expect(pa(page, '[data-tool="rect"] .pa-menu-item-key')).toHaveText('W');
      await expect(pa(page, '.pa-btn[data-tool="pen"]')).toHaveAttribute('aria-label', 'Pen (J)');
    } finally {
      await server.close();
    }
  });

  test('a narrow window clamps the toolbar on screen without overwriting its saved position', async ({ context }) => {
    const server = await startServer();
    try {
      const page = await firstPage(context);
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(`${server.origin}/resize`);
      await waitForMount(page);
      await openToolbar(page, context);

      const wrapper = pa(page, '.pa-toolbar-wrapper');
      const handle = await pa(page, '.pa-drag-handle').boundingBox();
      if (!handle) throw new Error('drag handle not laid out');
      await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
      await page.mouse.down();
      await page.mouse.move(handle.x + 300, handle.y + 500, { steps: 8 });
      await page.mouse.up();

      await expect.poll(async () => (await storedSettings(context)).toolbarPosition).toBeTruthy();
      const saved = (await storedSettings(context)).toolbarPosition as { x: number; y: number };
      expect(saved.x).toBeGreaterThan(500);
      expect(saved.y).toBeGreaterThan(400);

      await page.setViewportSize({ width: 700, height: 400 });
      await expect
        .poll(async () => {
          const box = await wrapper.boundingBox();
          return box ? box.x + box.width <= 700 && box.y + box.height <= 400 : false;
        })
        .toBe(true);
      await page.waitForTimeout(400);
      expect((await storedSettings(context)).toolbarPosition).toEqual(saved);

      await page.setViewportSize({ width: 1280, height: 800 });
      await expect.poll(async () => Math.round((await wrapper.boundingBox())?.x ?? -1)).toBe(Math.round(saved.x));
    } finally {
      await server.close();
    }
  });

  test('toast Undo brings back exactly the cleared drawings and is announced', async ({ context }) => {
    const server = await startServer();
    try {
      const page = await firstPage(context);
      await page.goto(`${server.origin}/clear-undo`);
      await waitForMount(page);
      await openToolbar(page, context);
      const host = new URL(server.origin).host;
      const badge = pa(page, '.pa-count-badge');

      await pa(page, '[data-tool="pen"]').click();
      await drawStroke(page, [120, 220], [300, 260]);
      await expect(badge).toHaveText('1');

      await pa(page, '[data-action="clear"]').click();
      await expect(badge).toBeHidden();
      await expect(pa(page, '.pa-toast')).toBeVisible();
      await expect(pa(page, '.pa-live-region')).toHaveText('Page drawings cleared');

      await drawStroke(page, [120, 360], [300, 420]);
      await expect(badge).toHaveText('1');

      await pa(page, '.pa-toast-btn').click();
      await expect(badge).toHaveText('2');
      await expect.poll(() => storedElementCount(context, host)).toBe(2);
    } finally {
      await server.close();
    }
  });

  test('the clear toast waits while hovered or focused, and its Undo is reachable by keyboard', async ({ context }) => {
    const server = await startServer();
    try {
      const page = await firstPage(context);
      await page.goto(`${server.origin}/toast`);
      await waitForMount(page);
      await openToolbar(page, context);
      const badge = pa(page, '.pa-count-badge');
      const toast = pa(page, '.pa-toast');

      await pa(page, '[data-tool="pen"]').click();
      await drawStroke(page, [120, 220], [300, 260]);
      await expect(badge).toHaveText('1');

      const clear = pa(page, '[data-action="clear"]');
      await clear.focus();
      await page.keyboard.press('Enter');
      await expect(toast).toBeVisible();

      let reached = false;
      for (let i = 0; i < 6 && !reached; i++) {
        await page.keyboard.press('Tab');
        reached = (await focusedInToolbar(page))?.className.includes('pa-toast-btn') ?? false;
      }
      expect(reached).toBe(true);

      await page.waitForTimeout(5500);
      await expect(toast).toBeVisible();
      await page.keyboard.press('Enter');
      await expect(badge).toHaveText('1');
      await expect(toast).toBeHidden();

      await clear.click();
      await expect(toast).toBeVisible();
      await toast.hover();
      await page.waitForTimeout(5500);
      await expect(toast).toBeVisible();
      await page.mouse.move(5, 790);
      await expect(toast).toBeHidden({ timeout: 7000 });
    } finally {
      await server.close();
    }
  });

  test('the clear button names how many drawings it would remove', async ({ context }) => {
    const server = await startServer();
    try {
      const page = await firstPage(context);
      await page.goto(`${server.origin}/count`);
      await waitForMount(page);
      await openToolbar(page, context);
      const clear = pa(page, '[data-action="clear"]');

      await expect(clear).not.toHaveAttribute('aria-label', /drawing/);
      await pa(page, '[data-tool="pen"]').click();
      await drawStroke(page, [120, 220], [300, 260]);
      await expect(clear).toHaveAttribute('aria-label', /Clear Page, 1 drawing\b/);
      await drawStroke(page, [120, 320], [300, 360]);
      await expect(clear).toHaveAttribute('aria-label', /Clear Page, 2 drawings/);
      await expect(pa(page, '.pa-count-badge')).toHaveAttribute('aria-hidden', 'true');
    } finally {
      await server.close();
    }
  });

  test('starting another recording, switching tabs, or resetting stops a shortcut recording', async ({ context, extensionId }) => {
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/options.html`);

    const toggle = options.locator('.pa-key-badge[data-shortcut-id="toggle-active"]');
    const pen = options.locator('.pa-key-badge[data-shortcut-id="tool-pen"]');
    await expect(pen).toHaveText('P');
    const toggleText = (await toggle.textContent()) ?? '';

    await toggle.click();
    await expect(toggle).toHaveText('Press keys...');
    await pen.click();
    await expect(toggle).toHaveText(toggleText);
    await expect(toggle).not.toHaveClass(/recording/);
    await expect(pen).toHaveClass(/recording/);

    await options.locator('#tab-btn-persistence').click();
    await options.locator('#tab-btn-shortcuts').click();
    await expect(pen).not.toHaveClass(/recording/);
    await expect(pen).toHaveText('P');
    await options.keyboard.press('q');
    await expect(pen).toHaveText('P');

    await pen.click();
    options.once('dialog', (dialog) => dialog.accept());
    await options.locator('#btn-reset-shortcuts').click();
    await expect(options.locator('.pa-key-badge.recording')).toHaveCount(0);
    await options.keyboard.press('q');
    await expect(options.locator('.pa-key-badge[data-shortcut-id="tool-pen"]')).toHaveText('P');
  });

  test('backup download completes and the restore picker accepts the same file twice', async ({ context, extensionId }) => {
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    await options.locator('#tab-btn-backup').click();

    const downloadPromise = options.waitForEvent('download');
    await options.locator('#btn-export-backup').click();
    const download = await downloadPromise;
    expect(await download.failure()).toBeNull();
    const file = await download.path();
    expect(() => JSON.parse(fs.readFileSync(file, 'utf-8'))).not.toThrow();

    const backup = {
      name: 'restore.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ [SETTINGS_KEY]: { defaultStrokeColor: '#3b82f6' } })),
    };
    const input = options.locator('#backup-file-input');
    const status = options.locator('#import-status');

    await input.setInputFiles(backup);
    await expect(status).toHaveText('Backup restored successfully!');
    await expect.poll(() => input.evaluate((el) => (el as HTMLInputElement).value)).toBe('');

    await status.evaluate((el) => {
      el.textContent = '';
    });
    await input.setInputFiles(backup);
    await expect(status).toHaveText('Backup restored successfully!');
  });
});
