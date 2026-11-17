import http from 'http';
import type { AddressInfo } from 'net';
import type { BrowserContext, Page, Worker } from '@playwright/test';
import { expect } from './fixtures';

export function pa(page: Page, selector: string) {
  return page.locator(`#page-anchor-host ${selector}`);
}

export async function getServiceWorker(context: BrowserContext): Promise<Worker | null> {
  const existing = context.serviceWorkers()[0];
  if (existing) return existing;
  return context.waitForEvent('serviceworker', { timeout: 10000 }).catch(() => null);
}

/** Sends PAGE_ANCHOR_TOGGLE to the tab showing `page`, as the toolbar icon click does. */
export async function sendToggle(page: Page, context: BrowserContext): Promise<void> {
  const worker = await getServiceWorker(context);
  if (!worker) throw new Error('extension service worker not found');
  await worker.evaluate(async (url: string) => {
    const tabs = await chrome.tabs.query({});
    const target = tabs.find((t) => t.url === url) ?? tabs.find((t) => t.active);
    if (target?.id) await chrome.tabs.sendMessage(target.id, { type: 'PAGE_ANCHOR_TOGGLE' }).catch(() => {});
  }, page.url());
}

/** Waits until the content script in `page` answers; it builds no DOM on pages without drawings, so the host element is not a readiness signal. */
export async function waitForContentScript(page: Page): Promise<void> {
  const worker = await getServiceWorker(page.context());
  if (!worker) throw new Error('extension service worker not found');
  await expect
    .poll(
      () =>
        worker.evaluate(async (url: string) => {
          const tabs = await chrome.tabs.query({});
          const tab = tabs.find((t) => t.url === url);
          if (tab?.id === undefined) return false;
          try {
            return !!(await chrome.tabs.sendMessage(tab.id, { type: 'PAGE_ANCHOR_GET_STATUS' }));
          } catch {
            return false;
          }
        }, page.url()),
      { timeout: 10000 }
    )
    .toBe(true);
}

export async function openToolbar(page: Page, context: BrowserContext): Promise<void> {
  const toolbar = pa(page, '.pa-toolbar');
  if (await toolbar.isVisible()) return;
  await sendToggle(page, context);
  // The drawing app mounts a moment after the toggle reply; pressing the shortcut once it has mounted would close the toolbar again.
  const opened = await toolbar.waitFor({ state: 'visible', timeout: 3000 }).then(
    () => true,
    () => false
  );
  if (!opened) await page.keyboard.press('Alt+Shift+D');
  await expect(toolbar).toBeVisible({ timeout: 10000 });
}

export async function drawStroke(page: Page, from: [number, number], to: [number, number], steps = 6): Promise<void> {
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move(to[0], to[1], { steps });
  await page.mouse.up();
}

/** Reads every extension storage key from the service worker. */
export async function readStorage(context: BrowserContext): Promise<Record<string, unknown>> {
  const worker = await getServiceWorker(context);
  if (!worker) throw new Error('extension service worker not found');
  return worker.evaluate(() => chrome.storage.local.get(null));
}

export async function writeStorage(context: BrowserContext, data: Record<string, unknown>): Promise<void> {
  const worker = await getServiceWorker(context);
  if (!worker) throw new Error('extension service worker not found');
  await worker.evaluate(async (d) => {
    await chrome.storage.local.set(d);
    // Same notice every in-extension writer sends, so open tabs react as they would to a real change.
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.id !== undefined) chrome.tabs.sendMessage(tab.id, { type: 'PAGE_ANCHOR_STORAGE_CHANGED', keys: Object.keys(d) }).catch(() => {});
    }
  }, data);
}

export async function clearStorage(context: BrowserContext): Promise<void> {
  const worker = await getServiceWorker(context);
  if (!worker) throw new Error('extension service worker not found');
  await worker.evaluate(() => chrome.storage.local.clear());
}

/** Element count stored for the page whose data key contains `urlFragment`. */
export async function storedElementCount(context: BrowserContext, urlFragment: string): Promise<number> {
  const all = await readStorage(context);
  for (const [key, value] of Object.entries(all)) {
    if (key.startsWith('page_anchor_data:') && key.includes(urlFragment)) {
      return ((value as { elements?: unknown[] }).elements ?? []).length;
    }
  }
  return 0;
}

export interface TestServer {
  origin: string;
  close: () => Promise<void>;
}

const DEFAULT_PAGE = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Fixture Page</title></head>
<body style="margin: 0; padding: 24px; font-family: sans-serif;">
  <h1 id="title">Fixture Page</h1>
  <div id="card" style="width: 340px; height: 180px; background: #e2e8f0; padding: 16px;">Target Box</div>
  <div style="height: 3000px"></div>
</body>
</html>`;

/** Serves `routes[path]` as HTML (query string ignored), or a default fixture page for unknown paths. */
export async function startServer(routes: Record<string, string> = {}): Promise<TestServer> {
  const server = http.createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(routes[path] ?? DEFAULT_PAGE);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://localhost:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        // The browser holds keep-alive sockets open, which would block close() until the test times out.
        server.closeAllConnections();
      }),
  };
}
