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

/** A sticky red header and a fixed yellow footer over blue, green and black bands. */
const STICKY_PAGE = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>Sticky</title></head>
<body style="margin:0">
  <div style="position:sticky;top:0;height:60px;background:rgb(255,0,0)"></div>
  <div style="height:1000px;background:rgb(0,0,255)"></div>
  <div style="height:1000px;background:rgb(0,255,0)"></div>
  <div style="height:1000px;background:rgb(0,0,0)"></div>
  <div style="position:fixed;bottom:0;left:0;right:0;height:30px;background:rgb(255,255,0)"></div>
</body></html>`;

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
    server = await startServer({ '/bands': BANDS_PAGE, '/sticky': STICKY_PAGE, '/phone': BANDS_PAGE.replace('<head>', '<head><meta name="viewport" content="width=device-width">') });
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

  test.describe('Capture area', () => {
    async function selectArea(page: Page, from: [number, number], to: [number, number]) {
      await pa(page, '[data-action="more"]').click();
      await pa(page, '[data-action="capture-area"]').click();
      await expect(pa(page, '.pa-area-hint')).toBeVisible();
      await drawStroke(page, from, to, 8);
      await expect(pa(page, '.pa-area-actions')).toBeVisible();
    }

    test('saves only the selected part of the screen, with drawings, as PNG or PDF', async ({ context }) => {
      test.setTimeout(90000);
      const page = context.pages()[0] ?? (await context.newPage());
      await page.goto(`${server.origin}/bands`);
      await waitForContentScript(page);
      await openToolbar(page, context);
      await pa(page, '[data-tool="pen"]').click();
      await drawStroke(page, [400, 300], [700, 300], 12);

      await selectArea(page, [300, 250], [800, 350]);
      let download = page.waitForEvent('download', { timeout: 30000 });
      await pa(page, '[data-action="area-png"]').click();
      const file = await download;
      expect(file.suggestedFilename()).toMatch(/^Export Bands Test \d{4}-\d{2}-\d{2}\.png$/);
      const bytes = fs.readFileSync((await file.path())!);
      const decoded = decodePng(bytes);
      const dpr = decoded.width / 500;
      expect(dpr).toBeGreaterThanOrEqual(1);
      expect(Math.abs(decoded.height - 100 * dpr)).toBeLessThanOrEqual(1);
      const png = { pixel: (x: number, y: number) => decoded.pixel(Math.round(x * dpr), Math.round(y * dpr)) };
      expectColor(png.pixel(5, 5), BLUE, 'page under the area, not dimmed');
      expectColor(png.pixel(250, 50), STROKE, 'drawing');
      await expect(pa(page, '.pa-toast-text')).toHaveText('Area saved as PNG');
      await expect(pa(page, '.pa-area')).toHaveCount(0);

      await selectArea(page, [300, 250], [800, 350]);
      download = page.waitForEvent('download', { timeout: 30000 });
      await pa(page, '[data-action="area-pdf"]').click();
      const pdf = fs.readFileSync((await (await download).path())!).toString('latin1');
      expect(pdf.startsWith('%PDF-1.4\n')).toBe(true);
      expect(Number(/\/Width (\d+)/.exec(pdf)![1])).toBe(decoded.width);
      // One page the size of the area on screen (0.75pt per CSS pixel), not an A4 sheet.
      expect(pdf).toContain('/Count 1');
      expect(pdf).toContain('/MediaBox [0 0 375 75]');
      await expect(pa(page, '.pa-toast-text')).toHaveText('Area saved as PDF');
    });

    test('copies the selected area to the clipboard', async ({ context }) => {
      test.setTimeout(60000);
      await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: server.origin });
      const page = context.pages()[0] ?? (await context.newPage());
      await page.goto(`${server.origin}/bands`);
      await waitForContentScript(page);
      await openToolbar(page, context);

      await selectArea(page, [100, 50], [300, 150]);
      await pa(page, '[data-action="area-copy"]').click();
      await expect(pa(page, '.pa-toast-text')).toHaveText('Copied to clipboard');
      const copied = await page.evaluate(async () => {
        const [item] = await navigator.clipboard.read();
        const bitmap = await createImageBitmap(await item.getType('image/png'));
        return { width: bitmap.width, height: bitmap.height };
      });
      expect(copied.width / copied.height).toBeCloseTo(2, 1);
    });

    async function savedPng(page: Page) {
      const download = page.waitForEvent('download', { timeout: 30000 });
      await pa(page, '[data-action="area-png"]').click();
      return decodePng(fs.readFileSync((await (await download).path())!));
    }

    test('on a scrolled page, saves what is on screen, sticky header and fixed footer included', async ({ context }) => {
      test.setTimeout(60000);
      const page = context.pages()[0] ?? (await context.newPage());
      await page.goto(`${server.origin}/sticky`);
      await waitForContentScript(page);
      await openToolbar(page, context);
      await page.evaluate(() => window.scrollTo(0, 900));
      await pa(page, '[data-tool="pen"]').click();
      await drawStroke(page, [400, 300], [700, 300], 12);
      const viewH = await page.evaluate(() => window.innerHeight);

      await selectArea(page, [300, 10], [800, viewH - 10]);
      const decoded = await savedPng(page);
      const dpr = decoded.width / 500;
      expect(Math.abs(decoded.height - (viewH - 20) * dpr)).toBeLessThanOrEqual(1);
      // Checks are in CSS pixels of the area, whose top is at screen y 10, i.e. document y 910.
      const png = { pixel: (x: number, y: number) => decoded.pixel(Math.round(x * dpr), Math.round(y * dpr)) };
      expectColor(png.pixel(5, 20), RED, 'sticky header where it sits on screen');
      expectColor(png.pixel(5, 100), BLUE, 'first band below the header');
      expectColor(png.pixel(5, 250), GREEN, 'second band');
      expectColor(png.pixel(250, 290), STROKE, 'drawing made after scrolling');
      expectColor(png.pixel(5, 210), GREEN, 'left of the drawing');
      expectColor(png.pixel(5, viewH - 20 - 10), YELLOW, 'fixed footer');
      expect(await page.evaluate(() => window.scrollY)).toBe(900);
    });

    test('Enter selects the whole visible screen', async ({ context }) => {
      test.setTimeout(60000);
      const page = context.pages()[0] ?? (await context.newPage());
      await page.goto(`${server.origin}/bands`);
      await waitForContentScript(page);
      await openToolbar(page, context);
      const view = await page.evaluate(() => ({ w: document.documentElement.clientWidth, h: document.documentElement.clientHeight }));

      await pa(page, '[data-action="more"]').click();
      await pa(page, '[data-action="capture-area"]').click();
      await expect(pa(page, '.pa-area-hint')).toBeVisible();
      await page.keyboard.press('Enter');
      await expect(pa(page, '.pa-area-actions')).toBeVisible();
      await expect(pa(page, '[data-action="area-copy"]')).toBeFocused();
      const decoded = await savedPng(page);
      const dpr = decoded.width / view.w;
      expect(dpr).toBeGreaterThanOrEqual(1);
      expect(Math.abs(decoded.height - view.h * dpr)).toBeLessThanOrEqual(1);
      const png = { pixel: (x: number, y: number) => decoded.pixel(Math.round(x * dpr), Math.round(y * dpr)) };
      expectColor(png.pixel(5, 10), RED, 'fixed bar');
      expectColor(png.pixel(view.w - 5, view.h - 5), BLUE, 'bottom right corner');
      // No sliver of the scrollbar or the area outside, even where the screen density makes edges fall between pixels.
      expectColor(decoded.pixel(decoded.width - 1, Math.round(decoded.height / 2)), BLUE, 'last column');
      expectColor(decoded.pixel(Math.round(decoded.width / 2), decoded.height - 1), BLUE, 'last row');
    });

    test.describe('on a 2x screen', () => {
      test.use({ deviceScale: 2 });

      test('saves the area at full screen sharpness, and the PDF page at its on-screen size', async ({ context }) => {
        test.setTimeout(60000);
        const page = context.pages()[0] ?? (await context.newPage());
        await page.goto(`${server.origin}/bands`);
        await waitForContentScript(page);
        await openToolbar(page, context);
        expect(await page.evaluate(() => window.devicePixelRatio)).toBe(2);
        await pa(page, '[data-tool="pen"]').click();
        await drawStroke(page, [400, 300], [700, 300], 12);

        await selectArea(page, [300, 250], [800, 350]);
        const decoded = await savedPng(page);
        expect([decoded.width, decoded.height]).toEqual([1000, 200]);
        expectColor(decoded.pixel(10, 10), BLUE, 'page');
        expectColor(decoded.pixel(500, 100), STROKE, 'drawing');

        await selectArea(page, [300, 250], [800, 350]);
        const download = page.waitForEvent('download', { timeout: 30000 });
        await pa(page, '[data-action="area-pdf"]').click();
        const pdf = fs.readFileSync((await (await download).path())!).toString('latin1');
        expect(pdf).toContain('/Width 1000');
        expect(pdf).toContain('/MediaBox [0 0 375 75]');
      });
    });

    test.describe('on a touch phone', () => {
      test.use({ phone: true });

      test('a finger drag selects and saves an area, and Cancel leaves without a keyboard', async ({ context }) => {
        test.setTimeout(60000);
        const page = context.pages()[0] ?? (await context.newPage());
        await page.goto(`${server.origin}/phone`);
        await waitForContentScript(page);
        await openToolbar(page, context);
        const cdp = await context.newCDPSession(page);
        const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x = 0, y = 0) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });

        const openArea = async () => {
          await pa(page, '[data-action="more"]').tap();
          await pa(page, '[data-action="capture-area"]').tap();
          await expect(pa(page, '.pa-area-hint')).toBeVisible();
        };
        await openArea();
        await pa(page, '[data-action="area-close"]').tap();
        await expect(pa(page, '.pa-area')).toHaveCount(0);

        await openArea();
        await touch('touchStart', 40, 200);
        // Lifted mid-move, so the browser sees a fling; the next tap must still reach the button.
        for (let i = 1; i <= 6; i++) await touch('touchMove', 40 + i * 50, 200 + i * 50);
        await touch('touchEnd');
        await expect(pa(page, '.pa-area-actions')).toBeVisible();
        for (const button of await pa(page, '.pa-area-actions .pa-area-btn').all()) {
          const box = (await button.boundingBox())!;
          expect(box.height).toBeGreaterThanOrEqual(44);
          expect(box.x).toBeGreaterThanOrEqual(0);
          expect(box.x + box.width).toBeLessThanOrEqual(390);
        }
        const download = page.waitForEvent('download', { timeout: 30000 });
        await pa(page, '[data-action="area-png"]').tap();
        const decoded = decodePng(fs.readFileSync((await (await download).path())!));
        expect(decoded.width).toBe(900);
        expect(Math.abs(decoded.height - 900)).toBeLessThanOrEqual(1);
        expectColor(decoded.pixel(450, 450), BLUE, 'page under the area');
        await expect(pa(page, '.pa-toast-text')).toHaveText('Area saved as PNG');

        // Copying needs the tap to count as the user's action, which a finger lift does.
        await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: server.origin });
        await openArea();
        await touch('touchStart', 40, 200);
        for (let i = 1; i <= 6; i++) await touch('touchMove', 40 + i * 50, 200 + i * 50);
        await touch('touchEnd');
        await pa(page, '[data-action="area-copy"]').tap();
        await expect(pa(page, '.pa-toast-text')).toHaveText('Copied to clipboard');
      });

      test('pinch-zoomed, the controls fit the screen and Whole screen saves just what is shown, without the tap flash', async ({ context }) => {
        test.setTimeout(60000);
        const page = context.pages()[0] ?? (await context.newPage());
        await page.goto(`${server.origin}/phone`);
        await waitForContentScript(page);
        await openToolbar(page, context);
        const cdp = await context.newCDPSession(page);
        await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 });
        await expect.poll(() => page.evaluate(() => window.visualViewport!.scale)).toBe(2);
        // The toolbar's More button is off screen while pinched; the menu item is opened directly.
        await page.evaluate(() => (document.getElementById('page-anchor-host')!.shadowRoot!.querySelector('[data-action="capture-area"]') as HTMLElement).click());
        const hint = (await pa(page, '.pa-area-hint').boundingBox())!;
        // Visible part of the layout is 195 CSS pixels wide at 2x.
        expect(hint.x).toBeGreaterThanOrEqual(0);
        expect(hint.x + hint.width).toBeLessThanOrEqual(195);
        await pa(page, '[data-action="area-whole"]').tap();
        const download = page.waitForEvent('download', { timeout: 30000 });
        await pa(page, '[data-action="area-png"]').tap();
        const decoded = decodePng(fs.readFileSync((await (await download).path())!));
        expect([decoded.width, decoded.height]).toEqual([1170, 2340]);
        // Shown at 2x on a 3x screen: 6 image pixels per CSS pixel; the fixed bar is 40px tall.
        expectColor(decoded.pixel(300, 100), RED, 'fixed bar');
        expectColor(decoded.pixel(300, 1000), BLUE, 'first band');
        // The action bar, and the button just tapped, sat across the bottom of the screen.
        for (let x = 10; x < decoded.width; x += 40) expectColor(decoded.pixel(x, 2250), BLUE, `under the tapped bar at x=${x}`);
      });
    });

    test('leaves drawings out while they are hidden, and Esc during a save cancels it cleanly', async ({ context }) => {
      test.setTimeout(60000);
      const page = context.pages()[0] ?? (await context.newPage());
      await page.goto(`${server.origin}/bands`);
      await waitForContentScript(page);
      await openToolbar(page, context);
      await pa(page, '[data-tool="pen"]').click();
      await drawStroke(page, [400, 300], [700, 300], 12);
      await pa(page, '[data-action="more"]').click();
      await pa(page, '[data-action="visibility"]').click();
      await expect(pa(page, '[data-action="visibility"]')).toHaveAttribute('aria-checked', 'false');

      await selectArea(page, [300, 250], [800, 350]);
      const decoded = await savedPng(page);
      const dpr = decoded.width / 500;
      expectColor(decoded.pixel(Math.round(250 * dpr), Math.round(50 * dpr)), BLUE, 'hidden drawing left out');

      let downloads = 0;
      page.on('download', () => downloads++);
      await selectArea(page, [300, 250], [800, 350]);
      await pa(page, '[data-action="area-png"]').click();
      await page.keyboard.press('Escape');
      await expect(pa(page, '.pa-area')).toHaveCount(0);
      await page.waitForTimeout(1500);
      expect(downloads).toBe(0);
      await expect(pa(page, '.pa-toolbar')).toBeVisible();
    });

    test('Escape leaves without saving anything', async ({ context }) => {
      const page = context.pages()[0] ?? (await context.newPage());
      await page.goto(`${server.origin}/bands`);
      await waitForContentScript(page);
      await openToolbar(page, context);
      await selectArea(page, [100, 100], [300, 200]);
      await page.keyboard.press('Escape');
      await expect(pa(page, '.pa-area')).toHaveCount(0);
      await expect(pa(page, '.pa-toolbar')).toBeVisible();
    });
  });
});
