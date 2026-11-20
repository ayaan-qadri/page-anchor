/** Everyday use of the built extension in a real Firefox, done the way a user does it: keyboard shortcut, clicks on the toolbar, typing, reloads, a second tab and the settings page. */
import fs from 'fs';
import path from 'path';
import { test, expect } from '@playwright/test';
import { startServer, type TestServer } from '../helpers';
import { BidiFirefox, KEY } from './bidi-firefox';

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Firefox user flows</title></head>
<body style="margin:0;padding:24px;font:16px/1.5 sans-serif;min-height:1400px">
<h1>Release notes</h1>
<p id="intro">Draw on this page, reload it, and open it in another tab.</p>
<button id="route" onclick="history.pushState({}, '', location.pathname === '/spa' ? '/spa/other' : '/spa')">Switch route</button>
</body></html>`;

// Short enough that Firefox suspends the background between steps, as it does on a real machine after 30 s idle.
const IDLE_MS = 1500;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const host = `document.getElementById('page-anchor-host')?.shadowRoot`;

async function centerOf(firefox: BidiFirefox, selector: string, root = host): Promise<[number, number]> {
  let box: [number, number] | null = null;
  await expect
    .poll(
      async () => {
        box = await firefox.evaluate<[number, number] | null>(`(() => {
          const el = ${root}?.querySelector(${JSON.stringify(selector)});
          const r = el?.getBoundingClientRect();
          return r && r.width && r.height ? [r.left + r.width / 2, r.top + r.height / 2] : null;
        })()`);
        return box;
      },
      { message: `${selector} is on screen`, timeout: 8000 }
    )
    .not.toBeNull();
  return box!;
}

async function clickOn(firefox: BidiFirefox, selector: string, root = host): Promise<void> {
  const [x, y] = await centerOf(firefox, selector, root);
  await firefox.click(x, y);
}

const badge = (firefox: BidiFirefox) => firefox.evaluate<string>(`(() => { const b = ${host}?.querySelector('.pa-count-badge'); return b && getComputedStyle(b).display !== 'none' && !b.hidden ? b.textContent.trim() : '' })()`);
const toolbarShown = (firefox: BidiFirefox) => firefox.evaluate<boolean>(`!!${host}?.querySelector('.pa-toolbar')?.checkVisibility()`);

/** Overlay alpha at a viewport point, so drawings shown without the toolbar are visible too. */
const inkAt = (firefox: BidiFirefox, x: number, y: number) =>
  firefox.evaluate<number>(`(() => {
    const canvas = ${host}?.querySelector('.page-anchor-base-canvas');
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || canvas.style.display === 'none') return 0;
    const s = canvas.width / canvas.getBoundingClientRect().width;
    const d = ctx.getImageData(Math.round(${x} * s) - 4, Math.round(${y} * s) - 4, 9, 9).data;
    let max = 0;
    for (let i = 3; i < d.length; i += 4) max = Math.max(max, d[i]);
    return max;
  })()`);

/** The settings tab the add-on opened since `before` was taken. */
async function waitForSettingsTab(firefox: BidiFirefox, before: Set<string>): Promise<string> {
  let found: string | undefined;
  await expect
    .poll(
      async () => {
        found = (await firefox.tabs()).find((t) => !before.has(t.context) && t.url.startsWith('moz-extension://'))?.context;
        return !!found;
      },
      { message: 'settings page opened in a new tab', timeout: 10000 }
    )
    .toBe(true);
  firefox.useAddonPage(found!);
  await expect.poll(() => firefox.evaluate<string>(`document.querySelector('h1')?.textContent ?? ''`)).toMatch(/Page Anchor/i);
  return found!;
}

const noticeShown = (firefox: BidiFirefox) => firefox.evaluate<boolean>(`!!document.getElementById('site-access-notice')?.checkVisibility()`);
const lastToast = (firefox: BidiFirefox) => firefox.evaluate<string>(`(() => { const t = ${host}?.querySelectorAll('.pa-toast-text'); return t && t.length ? t[t.length - 1].textContent : '' })()`);

async function drawPen(firefox: BidiFirefox, from: [number, number], to: [number, number]): Promise<void> {
  await clickOn(firefox, '[data-tool="pen"]');
  await firefox.driver().drag(from, to);
}

test.describe('Firefox user flows (built extension)', () => {
  let server: TestServer;
  let firefox: BidiFirefox;

  test.beforeAll(async () => {
    server = await startServer({ '/': PAGE, '/spa': PAGE, '/spa/other': PAGE, '/notes': PAGE, '/fresh': PAGE });
    firefox = await BidiFirefox.launch({
      openBeforeInstall: `${server.origin}/`,
      // Grants a requested permission without Firefox's prompt, which automation cannot click.
      prefs: { 'extensions.background.idle.timeout': IDLE_MS, 'extensions.webextOptionalPermissionPrompts': false },
    });
  });

  test.afterAll(async () => {
    await firefox?.close();
    await server?.close();
  });

  test.afterEach(() => {
    expect(firefox.consoleErrors, 'no extension errors in the console').toEqual([]);
  });

  test('a tab that was open before install gets the toolbar from the shortcut', async () => {
    const [opened] = (await firefox.tabs()).filter((t) => t.url.startsWith(server.origin));
    expect(opened, 'the tab opened before install is still there').toBeTruthy();
    await firefox.switchTo(opened.context);
    await firefox.driver().openToolbar();
    expect(await toolbarShown(firefox)).toBe(true);
  });

  // eslint-disable-next-line no-empty-pattern
  test('pen, shape and text note by clicks, with undo, redo, clear and toast undo', async ({}, testInfo) => {
    await firefox.driver().goto(`${server.origin}/notes`);
    await firefox.driver().openToolbar();

    await drawPen(firefox, [200, 300], [420, 320]);
    await expect.poll(() => badge(firefox)).toBe('1');

    await clickOn(firefox, '[data-action="shapes"]');
    await clickOn(firefox, '[data-tool="rect"]');
    await firefox.driver().drag([220, 380], [420, 480]);
    await expect.poll(() => badge(firefox)).toBe('2');

    await clickOn(firefox, '[data-tool="text"]');
    await firefox.click(240, 560);
    await centerOf(firefox, '.pa-text-textarea');
    await firefox.type('Ship it');
    await firefox.keys(KEY.Enter);
    await expect.poll(() => badge(firefox)).toBe('3');

    await clickOn(firefox, '[data-action="undo"]');
    await expect.poll(() => badge(firefox)).toBe('2');
    await clickOn(firefox, '[data-action="redo"]');
    await expect.poll(() => badge(firefox)).toBe('3');

    await clickOn(firefox, '[data-action="clear"]');
    await expect.poll(() => badge(firefox)).toBe('');
    await clickOn(firefox, '.pa-toast-btn');
    await expect.poll(() => badge(firefox)).toBe('3');
    await firefox.driver().screenshot(path.join(testInfo.outputDir, 'drawings.png'));
    await firefox.driver().waitForSave();
  });

  test('drawings come back on reload after the background was suspended, and the toolbar still opens', async () => {
    await firefox.driver().goto(`${server.origin}/notes`);
    await sleep(IDLE_MS * 3);
    await firefox.driver().reload();
    // The page asks the background for the app on its own, without the toolbar being opened.
    await expect.poll(() => inkAt(firefox, 310, 310), { timeout: 10000 }).toBeGreaterThan(100);
    expect(await toolbarShown(firefox)).toBe(false);

    await sleep(IDLE_MS * 3);
    await firefox.driver().openToolbar();
    await expect.poll(() => badge(firefox)).toBe('3');
  });

  test('an edit in one tab shows up live in another tab of the same page', async () => {
    const first = firefox.currentTab;
    await firefox.newTab();
    await firefox.driver().goto(`${server.origin}/notes`);
    await expect.poll(() => inkAt(firefox, 310, 310), { timeout: 10000 }).toBeGreaterThan(100);
    const second = firefox.currentTab;

    await firefox.switchTo(first);
    await sleep(IDLE_MS * 3);
    await drawPen(firefox, [600, 300], [800, 300]);
    await expect.poll(() => badge(firefox)).toBe('4');
    await firefox.driver().waitForSave();

    await firefox.switchTo(second);
    await expect.poll(() => inkAt(firefox, 700, 300), { timeout: 10000 }).toBeGreaterThan(100);
    await firefox.send('browsingContext.close', { context: second });
    await firefox.switchTo(first);
  });

  test('a route change made by the page script shows that route’s own drawings', async () => {
    await firefox.driver().goto(`${server.origin}/spa`);
    await firefox.driver().openToolbar();
    await drawPen(firefox, [200, 300], [420, 300]);
    await expect.poll(() => badge(firefox)).toBe('1');
    await firefox.driver().waitForSave();

    await firefox.evaluate(`document.getElementById('route').click()`);
    await expect.poll(() => firefox.evaluate<string>('location.pathname')).toBe('/spa/other');
    await expect.poll(() => inkAt(firefox, 310, 300)).toBe(0);

    await firefox.evaluate(`document.getElementById('route').click()`);
    await expect.poll(() => firefox.evaluate<string>('location.pathname')).toBe('/spa');
    await expect.poll(() => inkAt(firefox, 310, 300), { timeout: 10000 }).toBeGreaterThan(100);
  });

  test('Settings & Backup opens the settings page, which lists the page and downloads a backup', async () => {
    await firefox.driver().goto(`${server.origin}/notes`);
    await firefox.driver().openToolbar();
    const before = new Set((await firefox.tabs()).map((t) => t.context));

    await clickOn(firefox, '[data-action="more"]');
    await clickOn(firefox, '[data-action="open-options"]');

    const options = await waitForSettingsTab(firefox, before);
    expect(await noticeShown(firefox), 'no access notice while access is granted').toBe(false);

    await clickOn(firefox, '#tab-btn-saved-pages', 'document');
    await expect.poll(() => firefox.evaluate<string>(`document.getElementById('saved-pages-list')?.textContent ?? ''`)).toContain('Firefox user flows');

    const downloadsBefore = new Set(fs.readdirSync(firefox.downloadDir));
    await clickOn(firefox, '#tab-btn-backup', 'document');
    await clickOn(firefox, '#btn-export-backup', 'document');
    // Firefox creates the file before it has finished writing it.
    const readBackup = (): string => {
      const file = fs.readdirSync(firefox.downloadDir).find((f) => !downloadsBefore.has(f) && /^page-anchor-backup.*\.json$/.test(f));
      if (!file) return '';
      try {
        return Object.keys(JSON.parse(fs.readFileSync(path.join(firefox.downloadDir, file), 'utf8'))).join(' ');
      } catch {
        return '';
      }
    };
    await expect.poll(readBackup, { message: 'backup downloaded with the saved page', timeout: 10000 }).toContain('/notes');
    await firefox.send('browsingContext.close', { context: options });
  });

  // What the user does in Firefox's add-on manager when they turn access to websites off.
  const removeSiteAccess = () => firefox.evaluate(`browser.permissions.remove({ origins: ['<all_urls>'] })`);
  const settingsText = (id: string) => firefox.evaluate<string>(`document.getElementById('${id}')?.textContent ?? ''`);
  const settingsToast = () => firefox.evaluate<string>(`document.querySelector('.pa-toast span')?.textContent ?? ''`);
  const iconBadge = () => firefox.evaluate<string>(`browser.action.getBadgeText({})`);
  const contains = (origin: string) => firefox.evaluate<boolean>(`browser.permissions.contains({ origins: ['${origin}'] })`);

  // eslint-disable-next-line no-empty-pattern
  test('when access to websites is taken away, settings and the toolbar ask for it, and allowing it brings drawings back', async ({}, testInfo) => {
    const shot = (name: string) => firefox.driver().screenshot(path.join(testInfo.outputDir, `${name}.png`));
    const page = (await firefox.tabs()).find((t) => t.url.startsWith(server.origin))!;
    await firefox.switchTo(page.context);
    await firefox.driver().goto(`${server.origin}/fresh`);
    await firefox.driver().openToolbar();
    const before = new Set((await firefox.tabs()).map((t) => t.context));
    await clickOn(firefox, '[data-action="more"]');
    await clickOn(firefox, '[data-action="open-options"]');
    const options = await waitForSettingsTab(firefox, before);
    expect(await iconBadge()).toBe('');

    // Settings asks for every website, with the icon marked, until the user decides.
    await removeSiteAccess();
    await expect.poll(() => noticeShown(firefox), { message: 'settings page asks for access' }).toBe(true);
    expect(await settingsText('site-access-title')).toBe('Let Page Anchor work on every website');
    await expect.poll(iconBadge).toBe('!');
    await shot('settings-asks-for-every-website');

    await clickOn(firefox, '#btn-keep-limited', 'document');
    await expect.poll(() => noticeShown(firefox)).toBe(false);
    await expect.poll(settingsToast).toBe('Kept limited. You can change this in Drawings & pages.');
    await expect.poll(iconBadge, { message: 'icon stops asking once the user chose' }).toBe('');

    // A newly opened page no longer brings its drawings back by itself.
    const probe = await firefox.newTab();
    await firefox.driver().goto(`${server.origin}/notes`);
    await sleep(1500);
    expect(await inkAt(firefox, 310, 310)).toBe(0);
    await firefox.send('browsingContext.close', { context: probe });

    // The page that stayed open: reopening its toolbar says what this site is missing.
    await firefox.switchTo(page.context);
    await firefox.keys(KEY.Alt, KEY.Shift, 'D');
    await expect.poll(() => toolbarShown(firefox)).toBe(false);
    await firefox.driver().openToolbar();
    await expect.poll(() => lastToast(firefox)).toBe("Drawings on this site won't reappear on their own");
    await shot('toolbar-says-site-is-missing-out');

    // Set up brings the open settings page forward with the question about this one site.
    await clickOn(firefox, '.pa-toast-btn');
    firefox.useAddonPage(options);
    await expect.poll(() => firefox.evaluate<string>('document.visibilityState'), { message: 'settings page is in front' }).toBe('visible');
    await expect.poll(() => settingsText('site-access-title')).toBe('Allow Page Anchor on localhost?');
    expect(await firefox.evaluate<string>('document.activeElement?.id')).toBe('site-access-notice');
    expect(await settingsText('btn-allow-one-site')).toBe('Only localhost');
    await shot('settings-asks-for-this-site');

    await clickOn(firefox, '#btn-allow-one-site', 'document');
    await expect.poll(() => noticeShown(firefox), { message: 'notice goes away once the site is allowed' }).toBe(false);
    await expect.poll(settingsToast).toBe('Access allowed on localhost');
    expect(await contains('http://localhost/*')).toBe(true);
    expect(await contains('<all_urls>')).toBe(false);
    expect(await iconBadge()).toBe('');

    await firefox.switchTo(page.context);
    await firefox.driver().goto(`${server.origin}/notes`);
    await expect.poll(() => inkAt(firefox, 310, 310), { message: 'drawings reappear on their own on the allowed site', timeout: 10000 }).toBeGreaterThan(100);

    // Drawings & pages shows the limited access and offers every website; settings come forward from the More menu.
    await firefox.driver().openToolbar();
    await clickOn(firefox, '[data-action="more"]');
    await clickOn(firefox, '[data-action="open-options"]');
    firefox.useAddonPage(options);
    await expect.poll(() => firefox.evaluate<string>('document.visibilityState'), { message: 'settings page is in front' }).toBe('visible');
    await clickOn(firefox, '#tab-btn-persistence', 'document');
    expect(await firefox.evaluate<string | null>(`document.getElementById('tab-btn-persistence').getAttribute('aria-selected')`)).toBe('true');
    expect(await settingsText('site-access-status')).toBe('Limited');
    // Lets the tab highlight finish its colour transition.
    await sleep(400);
    await shot('settings-access-row-limited');
    await clickOn(firefox, '#btn-allow-all-sites-row', 'document');
    await expect.poll(() => settingsText('site-access-status')).toBe('All websites');
    await expect.poll(settingsToast).toBe('Access allowed. Your drawings will reappear on their own.');
    expect(await contains('<all_urls>')).toBe(true);
    await firefox.send('browsingContext.close', { context: options });
  });
});
