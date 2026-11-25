/** Asking for access to websites in Chrome: the settings notice in light and dark, on a phone-width window and from the keyboard, the icon badge, and the toolbar's prompt. Chrome cannot take away access a test was installed with, so its pages answer from a stand-in that the test controls. */
import path from 'path';
import type { BrowserContext, Page, Worker } from '@playwright/test';
import { test, expect } from './fixtures';
import { getServiceWorker, openToolbar, pa, startServer, type TestServer } from './helpers';

/** Stands in for the browser's permissions in extension pages: nothing granted, and every request accepted unless the page sets `__paRefuse`. */
async function fakePermissionsInExtensionPages(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    if (location.protocol !== 'chrome-extension:') return;
    const scope = globalThis as typeof globalThis & { __paRefuse?: boolean };
    const granted = new Set<string>();
    const covers = (origins: string[]) => granted.has('<all_urls>') || origins.every((o) => granted.has(o));
    chrome.permissions.contains = (async ({ origins = [] }: chrome.permissions.Permissions) => covers(origins)) as typeof chrome.permissions.contains;
    chrome.permissions.request = (async ({ origins = [] }: chrome.permissions.Permissions) => {
      if (scope.__paRefuse) return false;
      origins.forEach((o) => granted.add(o));
      return true;
    }) as typeof chrome.permissions.request;
  });
}

/** Makes the background believe access is missing everywhere, then has it look again. */
async function backgroundWithoutAccess(context: BrowserContext): Promise<Worker> {
  const worker = (await getServiceWorker(context))!;
  await worker.evaluate(async () => {
    // Once the install check has run, so it does not see the missing access and open settings in the test's tab.
    await (globalThis as { pageAnchorInstallChecked?: Promise<void> }).pageAnchorInstallChecked;
    chrome.permissions.contains = (async () => false) as typeof chrome.permissions.contains;
    await chrome.storage.local.remove('site_access_choice');
    // Any change to the choice makes the background look again.
    await chrome.storage.local.set({ site_access_choice: 'asked' });
    await chrome.storage.local.remove('site_access_choice');
  });
  return worker;
}

const iconBadge = (worker: Worker) => worker.evaluate(() => chrome.action.getBadgeText({}));
const iconTitle = (worker: Worker) => worker.evaluate(() => chrome.action.getTitle({}));

async function openSettings(context: BrowserContext, extensionId: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  return page;
}

const MOBILE_PAGE = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Mobile</title></head>
<body style="margin:0;padding:16px;font:16px/1.5 sans-serif"><h1>Trip notes</h1><p>A page built for phones.</p></body></html>`;

test.describe('Access to websites', () => {
  let server: TestServer;

  test.beforeAll(async () => {
    server = await startServer({ '/mobile': MOBILE_PAGE });
  });

  test.afterAll(async () => {
    await server?.close();
  });

  test('settings ask for every website, in light and dark, and keyboard users can answer', async ({ context, extensionId }, testInfo) => {
    await fakePermissionsInExtensionPages(context);
    const page = await openSettings(context, extensionId);
    const notice = page.getByRole('region', { name: 'Let Page Anchor work on every website' });
    await expect(notice).toBeVisible();
    await expect(notice).toHaveAccessibleDescription(/only reappear on their own on websites Page Anchor can access\. It uses this only to show your drawings, and nothing is sent anywhere\./);
    await expect(page.getByRole('button', { name: 'Only' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Not now' })).toHaveCount(0);

    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      // Buttons ease between colour schemes.
      await page.waitForTimeout(300);
      await notice.screenshot({ path: path.join(testInfo.outputDir, `notice-every-website-${colorScheme}.png`) });
    }

    // Keyboard: Tab reaches both answers in order, and Enter keeps it limited.
    const allowAll = page.getByRole('button', { name: 'Allow on all websites' }).first();
    await allowAll.focus();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Keep it limited' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(notice).toBeHidden();
    await expect(page.locator('#main-settings-content')).toBeFocused();
    await expect(page.locator('.pa-toast')).toContainText('Kept limited. You can change this in Drawings & pages.');
    await expect(page.locator('#options-announcer')).toHaveText('Kept limited. You can change this in Drawings & pages.');

    await page.locator('.pa-toast-btn').click();
    await expect(notice).toBeVisible();

    // Refused at the browser prompt: the notice stays and says so.
    await page.evaluate(() => ((globalThis as typeof globalThis & { __paRefuse?: boolean }).__paRefuse = true));
    await allowAll.click();
    await expect(page.locator('.pa-toast')).toContainText("Access wasn't allowed");
    await expect(notice).toBeVisible();

    await page.evaluate(() => ((globalThis as typeof globalThis & { __paRefuse?: boolean }).__paRefuse = false));
    await allowAll.focus();
    await page.keyboard.press('Enter');
    await expect(notice).toBeHidden();
    await expect(page.locator('.pa-toast')).toContainText('Access allowed. Your drawings will reappear on their own.');
    await page.getByRole('tab', { name: 'Drawings & pages' }).click();
    await expect(page.locator('#site-access-status')).toHaveText('All websites');
    await expect(page.locator('#btn-allow-all-sites-row')).toBeHidden();
  });

  test('on a phone-width window the notice and its buttons fit without sideways scrolling', async ({ context, extensionId }, testInfo) => {
    await fakePermissionsInExtensionPages(context);
    const page = await openSettings(context, extensionId);
    await page.setViewportSize({ width: 360, height: 760 });
    const notice = page.locator('#site-access-notice');
    await expect(notice).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
    const boxes = await notice.locator('button:visible').evaluateAll((buttons) => buttons.map((b) => b.getBoundingClientRect().toJSON() as DOMRect));
    const noticeBox = (await notice.boundingBox())!;
    for (const box of boxes) {
      expect(box.left).toBeGreaterThanOrEqual(noticeBox.x);
      expect(box.right).toBeLessThanOrEqual(noticeBox.x + noticeBox.width + 0.5);
      // Comfortable touch targets.
      expect(box.height).toBeGreaterThanOrEqual(36);
    }
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      // Buttons ease between colour schemes.
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(testInfo.outputDir, `notice-phone-${colorScheme}.png`) });
    }
  });

  test('the icon is marked while access is missing, and stops once the user keeps it limited', async ({ context }) => {
    const worker = await backgroundWithoutAccess(context);
    await expect.poll(() => iconBadge(worker)).toBe('!');
    await expect.poll(() => iconTitle(worker)).toBe('Page Anchor needs access to websites');

    await worker.evaluate(() => chrome.storage.local.set({ site_access_choice: 'limited' }));
    await expect.poll(() => iconBadge(worker)).toBe('');
    await expect.poll(() => iconTitle(worker)).toBe('Page Anchor: toggle drawing toolbar');
  });

  test('the toolbar says when this site is missing out, and Set up opens settings on that site', async ({ context, extensionId }, testInfo) => {
    await fakePermissionsInExtensionPages(context);
    await backgroundWithoutAccess(context);
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(`${server.origin}/`);
    await openToolbar(page, context);

    const toast = pa(page, '.pa-toast');
    await expect(toast).toContainText("Drawings on this site won't reappear on their own");
    await expect(pa(page, '.pa-live-region, [role="status"]').first()).toBeAttached();
    await page.screenshot({ path: path.join(testInfo.outputDir, 'toolbar-toast.png') });

    // Reachable from the keyboard: focus the button and press Enter.
    const setUp = pa(page, '.pa-toast-btn');
    await expect(setUp).toHaveText('Set up');
    const settingsOpened = context.waitForEvent('page');
    await setUp.focus();
    await page.keyboard.press('Enter');
    const settings = await settingsOpened;
    await settings.waitForLoadState('domcontentloaded');
    expect(settings.url()).toBe(`chrome-extension://${extensionId}/options.html`);

    const notice = settings.getByRole('region', { name: 'Allow Page Anchor on localhost?' });
    await expect(notice).toBeVisible();
    await expect(notice).toBeFocused();
    await expect(notice).toHaveAccessibleDescription(/Drawings you make on localhost will reappear on their own when you come back\./);
    await notice.screenshot({ path: path.join(testInfo.outputDir, 'notice-this-site.png') });

    await settings.getByRole('button', { name: 'Only localhost' }).click();
    await expect(notice).toBeHidden();
    await expect(settings.locator('.pa-toast')).toContainText('Access allowed on localhost');
    expect(await settings.evaluate(() => chrome.storage.local.get('site_access_choice'))).toEqual({ site_access_choice: 'limited' });

    // Closing and reopening the toolbar on the same page does not repeat the prompt.
    await page.bringToFront();
    await page.keyboard.press('Alt+Shift+D');
    await expect(pa(page, '.pa-toolbar')).toBeHidden();
    await page.keyboard.press('Alt+Shift+D');
    await expect(pa(page, '.pa-toolbar')).toBeVisible();
    await page.waitForTimeout(500);
    await expect(pa(page, '.pa-toast')).toHaveCount(0);
  });

  test('the toolbar stays quiet on a site that has access', async ({ context }) => {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(`${server.origin}/`);
    await openToolbar(page, context);
    await page.waitForTimeout(800);
    await expect(pa(page, '.pa-toast')).toHaveCount(0);
  });

  test.describe('on a phone', () => {
    test.use({ phone: true });

    for (const [name, route] of [
      ['a page built for phones', '/mobile'],
      ['a desktop page', '/'],
    ] as const) {
      test(`the toolbar prompt fits the screen on ${name}`, async ({ context }, testInfo) => {
        await backgroundWithoutAccess(context);
        const page = context.pages()[0] ?? (await context.newPage());
        await page.goto(`${server.origin}${route}`);
        await openToolbar(page, context);
        const toast = pa(page, '.pa-toast');
        await expect(toast).toContainText("Drawings on this site won't reappear on their own");
        // The one-time touch scroll hint waits instead of replacing it.
        await page.waitForTimeout(1200);
        await expect(toast).toContainText("Drawings on this site won't reappear on their own");
        const width = await page.evaluate(() => window.innerWidth);
        for (const box of [(await toast.boundingBox())!, (await pa(page, '.pa-toast-btn').boundingBox())!]) {
          expect(box.x).toBeGreaterThanOrEqual(0);
          expect(box.x + box.width).toBeLessThanOrEqual(width);
        }
        await page.screenshot({ path: path.join(testInfo.outputDir, 'toolbar-toast-phone.png') });
      });
    }
  });
});
