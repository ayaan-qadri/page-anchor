import fs from 'fs';
import { inflateSync } from 'zlib';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { drawStroke, openToolbar, pa, startServer, waitForContentScript, type TestServer } from './helpers';

const RED: Rgb = [255, 0, 0];
const BLUE: Rgb = [0, 0, 255];
const GREEN: Rgb = [0, 255, 0];
const BLACK: Rgb = [0, 0, 0];
const YELLOW: Rgb = [255, 255, 0];
const STROKE: Rgb = [239, 68, 68];

type Rgb = [number, number, number];

/** 3500px tall: a fixed red bar, colored bands, and a yellow stripe near the bottom to check the clamped last tile lines up. */
const BANDS_PAGE = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>Export: Bands / Test</title></head>
<body style="margin:0">
  <div style="position:fixed;top:0;left:0;right:0;height:40px;background:rgb(255,0,0)"></div>
  <div style="height:1000px;background:rgb(0,0,255)"></div>
  <div style="height:1000px;background:rgb(0,255,0)"></div>
  <div style="height:1480px;background:rgb(0,0,0)"></div>
  <div style="height:10px;background:rgb(255,255,0)"></div>
  <div style="height:10px;background:rgb(0,0,0)"></div>
</body></html>`;

interface DecodedPng {
  width: number;
  height: number;
  pixel(x: number, y: number): Rgb;
}

function decodePng(bytes: Buffer): DecodedPng {
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

function expectColor(actual: Rgb, expected: Rgb, where: string): void {
  const close = actual.every((v, i) => Math.abs(v - expected[i]) <= 12);
  expect(close, `${where}: got rgb(${actual.join(',')}), want rgb(${expected.join(',')})`).toBe(true);
}

/** Saves through the More menu; also reports the progress panel text seen while saving and where the panel sat. */
async function exportVia(page: Page, action: 'export-png' | 'export-pdf') {
  await pa(page, '[data-action="more"]').click();
  const download = page.waitForEvent('download', { timeout: 30000 });
  await pa(page, `[data-action="${action}"]`).click();
  let done = false;
  const panelSeen: { text: string; box: { x: number; y: number; width: number; height: number } | null } = { text: '', box: null };
  const watch = (async () => {
    while (!done) {
      // Short timeouts: the panel can vanish between reads, and Playwright would otherwise wait for it forever.
      const panel = pa(page, '.pa-export-status');
      if (await panel.isVisible().catch(() => false)) {
        panelSeen.text = (await panel.textContent({ timeout: 200 }).catch(() => '')) || panelSeen.text;
        panelSeen.box = (await panel.boundingBox({ timeout: 200 }).catch(() => null)) ?? panelSeen.box;
      }
      await page.waitForTimeout(100);
    }
  })();
  const file = await download;
  done = true;
  await watch;
  return { bytes: fs.readFileSync((await file.path())!), name: file.suggestedFilename(), panelText: panelSeen.text, panelBox: panelSeen.box };
}

test.describe('Save page as PNG / PDF', () => {
  let server: TestServer;

  test.beforeAll(async () => {
    server = await startServer({ '/bands': BANDS_PAGE });
  });

  test.afterAll(async () => {
    await server.close();
  });

  test('PNG covers the whole page with drawings, without the toolbar or repeated fixed bars', async ({ context }) => {
    test.setTimeout(90000);
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(`${server.origin}/bands`);
    await waitForContentScript(page);
    await openToolbar(page, context);
    await pa(page, '[data-tool="pen"]').click();
    await drawStroke(page, [400, 300], [700, 300], 12);

    const toolbarBox = (await pa(page, '.pa-toolbar').boundingBox())!;
    await page.evaluate(() => window.scrollTo(0, 500));
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);

    const { bytes, name, panelText, panelBox } = await exportVia(page, 'export-png');
    expect(panelText).toMatch(/^Saving page as PNG image\d+%Scrolling, clicking, pressing a key or switching tabs stops saving\.Stop$/);
    expect(name).toMatch(/^Export Bands Test \d{4}-\d{2}-\d{2}\.png$/);
    const decoded = decodePng(bytes);
    // Screenshots come at the screen's pixel density, which can differ from the emulated devicePixelRatio.
    const dpr = decoded.width / clientWidth;
    expect(dpr).toBeGreaterThanOrEqual(1);
    expect(Math.abs(decoded.height - 3500 * dpr)).toBeLessThanOrEqual(1);
    // Checks below are in CSS pixels.
    const png = { pixel: (x: number, y: number) => decoded.pixel(Math.round(x * dpr), Math.round(y * dpr)) };

    expectColor(png.pixel(5, 10), RED, 'fixed bar in the first tile');
    expectColor(png.pixel(5, 730), BLUE, 'fixed bar hidden in later tiles');
    expectColor(png.pixel(5, 1500), GREEN, 'second band');
    expectColor(png.pixel(5, 3000), BLACK, 'third band');
    expectColor(png.pixel(5, 3475), BLACK, 'above the stripe');
    expectColor(png.pixel(5, 3485), YELLOW, 'stripe in the clamped last tile');
    expectColor(png.pixel(5, 3495), BLACK, 'below the stripe');

    expectColor(png.pixel(550, 300), STROKE, 'drawing');
    const toolbarCenter: [number, number] = [Math.round(toolbarBox.x + toolbarBox.width / 2), Math.round(toolbarBox.y + toolbarBox.height / 2)];
    expectColor(png.pixel(...toolbarCenter), toolbarCenter[1] < 40 ? RED : BLUE, 'toolbar hidden');

    // The panel sat over the page while saving, but every screenshot was taken with it out of the way.
    const panelCenter: [number, number] = [Math.round(panelBox!.x + panelBox!.width / 2), Math.round(panelBox!.y + panelBox!.height / 2)];
    expectColor(png.pixel(...panelCenter), BLUE, 'progress panel kept out of the image');

    expect(await page.evaluate(() => window.scrollY)).toBe(500);
    await expect(pa(page, '.pa-toolbar')).toBeVisible();
    await expect(pa(page, '.pa-toast-text')).toHaveText('Page saved as PNG');
    await expect(pa(page, '.pa-export-status')).toHaveCount(0);
  });

  test('Stop ends a save half way and leaves the page as it was', async ({ context }) => {
    test.setTimeout(90000);
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(`${server.origin}/bands`);
    await waitForContentScript(page);
    await openToolbar(page, context);
    await page.evaluate(() => window.scrollTo(0, 700));
    const scrollBefore = await page.evaluate(() => window.scrollY);
    let downloads = 0;
    page.on('download', () => downloads++);

    await pa(page, '[data-action="more"]').click();
    await pa(page, '[data-action="export-pdf"]').click();
    const stop = pa(page, '.pa-export-status-stop');
    await expect(stop).toBeVisible();
    await expect(pa(page, '.pa-export-status-title')).toHaveText('Saving page as PDF');
    await page.waitForTimeout(1200);
    await stop.click();

    await expect(pa(page, '.pa-toast-text')).toHaveText('Save cancelled');
    await expect(pa(page, '.pa-export-status')).toHaveCount(0);
    await expect(pa(page, '.pa-toolbar')).toBeVisible();
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
    await page.waitForTimeout(1500);
    expect(downloads).toBe(0);
  });

  test('PDF is a valid multi-page A4 document', async ({ context }) => {
    test.setTimeout(90000);
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(`${server.origin}/bands`);
    await waitForContentScript(page);
    await openToolbar(page, context);

    const { bytes, name } = await exportVia(page, 'export-pdf');
    expect(name).toMatch(/\.pdf$/);
    const text = bytes.toString('latin1');
    expect(text.startsWith('%PDF-1.4\n')).toBe(true);
    expect(text.endsWith('%%EOF\n')).toBe(true);

    const width = Number(/\/Width (\d+)/.exec(text)![1]);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    const pageRows = Math.floor((width * 841.89) / 595.28);
    // Pages may end early, in a gap, so a line is never cut in half; together they still hold every row once.
    const heights = [...text.matchAll(/\/Height (\d+)/g)].map((m) => Number(m[1]));
    expect(text).toContain(`/Count ${heights.length}`);
    expect(heights.every((h) => h <= pageRows)).toBe(true);
    expect(Math.abs(heights.reduce((a, b) => a + b, 0) - (3500 * width) / clientWidth)).toBeLessThanOrEqual(2);

    const startxref = Number(/startxref\n(\d+)\n/.exec(text)![1]);
    expect(text.slice(startxref, startxref + 5)).toBe('xref\n');
    await expect(pa(page, '.pa-toast-text')).toHaveText('Page saved as PDF');
  });

  test('on a phone-width window every toolbar control and the save items stay on screen', async ({ context }) => {
    test.setTimeout(90000);
    const page = context.pages()[0] ?? (await context.newPage());
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto(`${server.origin}/bands`);
    await waitForContentScript(page);
    await openToolbar(page, context);

    const offscreen = await page.evaluate(() => {
      const root = document.getElementById('page-anchor-host')!.shadowRoot!;
      return [...root.querySelectorAll<HTMLElement>('.pa-toolbar > .pa-btn, .pa-toolbar .pa-menu-trigger, .pa-toolbar .pa-color-preview-btn')]
        .map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter(({ r }) => r.width > 0 && (r.left < 0 || r.right > window.innerWidth))
        .map(({ el }) => el.dataset.action ?? el.dataset.tool ?? el.className);
    });
    expect(offscreen).toEqual([]);

    await pa(page, '[data-action="more"]').click();
    for (const action of ['export-png', 'export-pdf']) {
      const box = (await pa(page, `[data-action="${action}"]`).boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(360);
    }
    const download = page.waitForEvent('download', { timeout: 60000 });
    await pa(page, '[data-action="export-png"]').click();
    expect((await download).suggestedFilename()).toMatch(/\.png$/);
    await expect(pa(page, '.pa-toast-text')).toHaveText('Page saved as PNG');
  });
});
