import http from 'http';
import { inflateSync } from 'zlib';
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

/** Serves `routes[path]` as HTML (query string ignored), or a default fixture page for unknown paths. A function route is called per request, so a page can change between loads. */
export async function startServer(routes: Record<string, string | (() => string)> = {}): Promise<TestServer> {
  const server = http.createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    const route = routes[path];
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end((typeof route === 'function' ? route() : route) ?? DEFAULT_PAGE);
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

export type Rgb = [number, number, number];

export interface DecodedPng {
  width: number;
  height: number;
  pixel(x: number, y: number): Rgb;
}

export function decodePng(bytes: Buffer): DecodedPng {
  expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  let at = 8;
  let width = 0;
  let height = 0;
  const idat: Buffer[] = [];
  while (at < bytes.length) {
    const length = bytes.readUInt32BE(at);
    const type = bytes.toString('latin1', at + 4, at + 8);
    const data = bytes.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      expect([data[8], data[9]]).toEqual([8, 2]);
    } else if (type === 'IDAT') idat.push(data);
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 3;
  const rgb = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let i = 0; i < stride; i++) {
      const value = raw[y * (stride + 1) + 1 + i];
      const up = y > 0 ? rgb[(y - 1) * stride + i] : 0;
      rgb[y * stride + i] = filter === 2 ? (value + up) & 0xff : value;
    }
  }
  return {
    width,
    height,
    pixel: (x, y) => {
      const i = (y * width + x) * 3;
      return [rgb[i], rgb[i + 1], rgb[i + 2]];
    },
  };
}

export function expectColor(actual: Rgb, expected: Rgb, where: string): void {
  const close = actual.every((v, i) => Math.abs(v - expected[i]) <= 12);
  expect(close, `${where}: got rgb(${actual.join(',')}), want rgb(${expected.join(',')})`).toBe(true);
}
