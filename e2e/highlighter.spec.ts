import fs from 'fs';
import path from 'path';
import type { BrowserContext, Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { decodePng, expectColor, openToolbar, pa, readStorage, startServer, waitForContentScript, type Rgb, type TestServer } from './helpers';

const page = (body: string, style = '') => `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>Highlighter</title><style>
  body { margin: 0; font: 600 20px sans-serif; height: 1000px; }
  .glyph { position: absolute; height: 4px; }
  ${style}
</style></head><body>${body}</body></html>`;

/** A white page with a line of text and a black bar standing in for text, so pixels under the highlight can be checked. */
const LIGHT_PAGE = page(`
  <p style="position:absolute;left:300px;top:180px;margin:0;color:#111827">Highlight this line of text on a light page</p>
  <div class="glyph" style="left:300px;top:298px;width:400px;background:#000000"></div>`, 'body { background: #ffffff; }');

/** A dark page like a code host in dark mode, with a white card on it. */
const DARK_PAGE = page(`
  <p style="position:absolute;left:300px;top:180px;margin:0;color:#e6edf3">Storefront: account, My Home and partner page</p>
  <div class="glyph" style="left:300px;top:298px;width:400px;background:#ffffff"></div>
  <div style="position:absolute;left:280px;top:440px;width:460px;height:100px;background:#ffffff;border-radius:8px">
    <div class="glyph" style="left:20px;top:48px;width:400px;background:#000000"></div>
  </div>`, 'body { background: #0d1117; }');

/** A page that switches between light and dark by a class on the body, as many sites do. */
const THEME_PAGE = page(`<div class="glyph" style="left:300px;top:298px;width:400px"></div>`, `
  body { background: #ffffff; } body .glyph { background: #000000; }
  body.dark { background: #0d1117; } body.dark .glyph { background: #ffffff; }`);

const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];
const DARK_BG: Rgb = [0x0d, 0x11, 0x17];
const YELLOW: Rgb = [0xff, 0xea, 0x00];
const GREEN: Rgb = [0x39, 0xff, 0x14];

/** What the page shows where a highlight of `color` at `alpha` lies over `bg`, for the blend the extension picks. */
function blended(mode: 'multiply' | 'screen', bg: Rgb, color: Rgb, alpha: number): Rgb {
  return bg.map((b, i) => {
    const c = color[i];
    const mixed = mode === 'multiply' ? (b * c) / 255 : b + c - (b * c) / 255;
    return Math.round(b * (1 - alpha) + mixed * alpha);
  }) as Rgb;
}

/** Reads the on-screen colour at a viewport point from a real screenshot, so it includes the page under the drawing. */
async function screenPixel(p: Page, x: number, y: number): Promise<Rgb> {
  const shot = await p.screenshot({ clip: { x, y, width: 1, height: 1 }, scale: 'css' });
  return p.evaluate(async (b64: string) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const ctx = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2]] as Rgb;
  }, shot.toString('base64'));
}

async function expectScreen(p: Page, x: number, y: number, want: Rgb, where: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const got = await screenPixel(p, x, y);
        return got.every((v, i) => Math.abs(v - want[i]) <= 12) ? 'ok' : `rgb(${got.join(',')})`;
      },
      { message: `${where}: want rgb(${want.join(',')})`, timeout: 5000 }
    )
    .toBe('ok');
}

/** A hand-drawn sweep along a line of text: it wobbles up and down the way a real hand does. */
async function sweep(p: Page, from: [number, number], to: [number, number], amplitude = 6): Promise<void> {
  await p.mouse.move(from[0], from[1]);
  await p.mouse.down();
  const steps = 30;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const wobble = i === steps ? 0 : Math.sin(t * Math.PI * 5) * amplitude;
    await p.mouse.move(from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t + wobble);
  }
  await p.mouse.up();
}

type StoredStroke = { type: string; strokeColor: string; opacity: number; points: Array<{ x: number; y: number }> };

async function storedHighlights(context: BrowserContext, fragment: string): Promise<StoredStroke[]> {
  const all = await readStorage(context);
  for (const [key, value] of Object.entries(all)) {
    if (key.startsWith('page_anchor_data:') && key.includes(fragment)) {
      return ((value as { elements?: StoredStroke[] }).elements ?? []).filter((el) => el.type === 'highlighter');
    }
  }
  return [];
}

async function storedSettings(context: BrowserContext): Promise<Record<string, unknown>> {
  return ((await readStorage(context)).page_anchor_settings ?? {}) as Record<string, unknown>;
}

async function openPage(context: BrowserContext, url: string): Promise<Page> {
  const p = context.pages()[0] ?? (await context.newPage());
  await p.setViewportSize({ width: 1200, height: 800 });
  await p.goto(url);
  await waitForContentScript(p);
  await openToolbar(p, context);
  await p.keyboard.press('h');
  await expect(pa(p, '[data-tool="highlighter"]')).toHaveAttribute('aria-pressed', 'true');
  return p;
}

async function setIntensity(p: Page, key: 'Home' | 'End'): Promise<void> {
  await pa(p, '.pa-color-preview-btn').click();
  await pa(p, '[data-setting="defaultHighlighterIntensity"]').focus();
  await p.keyboard.press(key);
  await p.keyboard.press('Escape');
}

async function exportPng(p: Page) {
  await pa(p, '[data-action="more"]').click();
  const download = p.waitForEvent('download', { timeout: 30000 });
  await pa(p, '[data-action="export-png"]').click();
  const decoded = decodePng(fs.readFileSync((await (await download).path())!));
  const dpr = decoded.width / (await p.evaluate(() => document.documentElement.clientWidth));
  return (x: number, y: number) => decoded.pixel(Math.round(x * dpr), Math.round(y * dpr));
}

test.describe('Highlighter', () => {
  let server: TestServer;

  test.beforeAll(async () => {
    server = await startServer({ '/light': LIGHT_PAGE, '/light-other': LIGHT_PAGE, '/dark': DARK_PAGE, '/theme': THEME_PAGE });
  });

  test.afterAll(async () => {
    await server.close();
  });

  test('on a light page: a wobbly sweep comes out straight, text under it stays black, and settings carry over', async ({ context }, testInfo) => {
    test.setTimeout(90000);
    const p = await openPage(context, `${server.origin}/light`);

    await sweep(p, [290, 300], [710, 300]);
    await expect.poll(async () => (await storedHighlights(context, '/light')).length).toBe(1);
    const [bar] = await storedHighlights(context, '/light');
    expect(bar).toMatchObject({ strokeColor: '#ffea00', opacity: 0.6 });
    expect(bar.points).toHaveLength(2);
    expect(bar.points[0].y).toBe(bar.points[1].y);
    expect(Math.abs(bar.points[0].y - 300)).toBeLessThanOrEqual(6);

    await expectScreen(p, 500, 306, blended('multiply', WHITE, YELLOW, 0.6), 'default highlight on white');
    await expectScreen(p, 500, 300, BLACK, 'text under the highlight stays black');
    await expectScreen(p, 704, 306, blended('multiply', WHITE, YELLOW, 0.6), 'flat end reaches the end of the sweep');
    await expectScreen(p, 716, 300, WHITE, 'no rounded cap past the end');

    // A loop around a word stays freehand.
    await p.mouse.move(900, 300);
    await p.mouse.down();
    for (let i = 1; i <= 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      await p.mouse.move(840 + Math.cos(a) * 60, 300 + Math.sin(a) * 40);
    }
    await p.mouse.up();
    await expect.poll(async () => (await storedHighlights(context, '/light')).length).toBe(2);
    expect((await storedHighlights(context, '/light'))[1].points.length).toBeGreaterThan(2);

    await pa(p, '.pa-color-preview-btn').click();
    const swatches = pa(p, 'button.pa-color-swatch');
    await expect(swatches).toHaveCount(6);
    expect(await swatches.evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')))).toEqual(['Yellow', 'Green', 'Cyan', 'Pink', 'Orange', 'Purple']);
    const rows = await pa(p, '.pa-color-grid > *:visible').evaluateAll((els) => new Set(els.map((el) => Math.round(el.getBoundingClientRect().top))).size);
    expect(rows, 'six colours and the custom picker fit one row').toBe(1);
    await expect(pa(p, '.pa-hl-sample')).toBeVisible();
    await expect(pa(p, '.pa-slider-scale')).toHaveText('SoftBold');

    await pa(p, 'button.pa-color-swatch[aria-label="Green"]').click();
    await expect(pa(p, 'button.pa-color-swatch[aria-label="Green"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(pa(p, '.pa-hl-chip.is-light .pa-hl-mark')).toHaveCSS('background-color', 'rgb(57, 255, 20)');
    await pa(p, '[data-setting="defaultHighlighterIntensity"]').focus();
    await p.keyboard.press('End');
    await expect(pa(p, '.pa-hl-chip.is-light .pa-hl-mark')).toHaveCSS('opacity', '1');
    const preview = await pa(p, '.pa-hl-sample').boundingBox();
    const colours = await pa(p, '.pa-color-grid').boundingBox();
    expect(preview!.y, 'the preview sits above the colours').toBeLessThan(colours!.y);
    await expect(pa(p, '.pa-hl-chip.is-light .pa-hl-mark')).toHaveCSS('height', '16px');
    await pa(p, '[data-setting="defaultHighlighterWidth"]').focus();
    await p.keyboard.press('End');
    await expect(pa(p, '.pa-hl-chip.is-light .pa-hl-mark')).toHaveCSS('height', '40px');
    await p.keyboard.press('Home');
    await expect(pa(p, '.pa-hl-chip.is-light .pa-hl-mark')).toHaveCSS('height', '6px');
    for (let i = 0; i < 12; i++) await p.keyboard.press('ArrowRight');
    await expect(pa(p, '[data-setting="defaultHighlighterWidth"]')).toHaveValue('20');
    await expect.poll(async () => (await storedSettings(context)).defaultHighlighterIntensity).toBe(100);
    await p.screenshot({ path: path.join(testInfo.outputDir, 'light-panel.png') });
    await p.keyboard.press('Escape');

    await sweep(p, [290, 190], [880, 190]);
    await expect.poll(async () => (await storedHighlights(context, '/light')).length).toBe(3);
    expect((await storedHighlights(context, '/light'))[2]).toMatchObject({ strokeColor: '#39ff14', opacity: 1 });
    await expectScreen(p, 870, 190, GREEN, 'full intensity is the full colour on white');
    await p.screenshot({ path: path.join(testInfo.outputDir, 'light-page.png') });

    const png = await exportPng(p);
    expectColor(png(500, 300), BLACK, 'export: text under the highlight stays black');
    expectColor(png(500, 306), blended('multiply', WHITE, YELLOW, 0.6), 'export: highlight on white');
    expectColor(png(870, 190), GREEN, 'export: full-intensity highlight');

    await p.reload();
    await waitForContentScript(p);
    await expectScreen(p, 500, 306, blended('multiply', WHITE, YELLOW, 0.6), 'highlight after reload');
    await expectScreen(p, 500, 300, BLACK, 'text still black after reload');

    const other = await context.newPage();
    await other.setViewportSize({ width: 1200, height: 800 });
    await other.goto(`${server.origin}/light-other`);
    await waitForContentScript(other);
    await openToolbar(other, context);
    await other.keyboard.press('h');
    await sweep(other, [290, 300], [710, 300]);
    await expect.poll(async () => (await storedHighlights(context, '/light-other')).length).toBe(1);
    expect((await storedHighlights(context, '/light-other'))[0]).toMatchObject({ strokeColor: '#39ff14', opacity: 1 });

    await pa(other, '.pa-color-preview-btn').click();
    await pa(other, '.pa-popover-reset').click();
    await expect(pa(other, '[data-setting="defaultHighlighterIntensity"]')).toHaveValue('50');
    await expect.poll(async () => (await storedSettings(context)).defaultHighlighterColor).toBe('#ffea00');
  });

  test('on a dark page: highlights brighten the page, white text stays white, and a white card on it is handled like a light page', async ({ context }, testInfo) => {
    const p = await openPage(context, `${server.origin}/dark`);
    await setIntensity(p, 'End');

    await sweep(p, [290, 190], [880, 190]);
    await sweep(p, [290, 300], [710, 300]);
    await sweep(p, [290, 490], [710, 490]);
    await expect.poll(async () => (await storedHighlights(context, '/dark')).length).toBe(3);

    await expectScreen(p, 500, 306, blended('screen', DARK_BG, YELLOW, 0.5), 'highlight on the dark page');
    await expectScreen(p, 500, 300, WHITE, 'white text under it stays white');
    const lum = (rgb: Rgb) => {
      const [r, g, b] = rgb.map((c) => (c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const contrast = 1.05 / (lum(await screenPixel(p, 500, 306)) + 0.05);
    expect(contrast, 'white text on a full-intensity highlight stays readable').toBeGreaterThanOrEqual(4);
    await expectScreen(p, 500, 496, blended('multiply', WHITE, YELLOW, 1), 'highlight on the white card');
    await expectScreen(p, 500, 490, BLACK, 'black text on the card stays black');
    await p.screenshot({ path: path.join(testInfo.outputDir, 'dark-page.png') });

    const png = await exportPng(p);
    expectColor(png(500, 300), WHITE, 'export: white text under the highlight');
    expectColor(png(500, 306), blended('screen', DARK_BG, YELLOW, 0.5), 'export: highlight on dark');
    expectColor(png(500, 490), BLACK, 'export: black text on the card');
  });

  test('a site switching to dark mode re-blends highlights already drawn', async ({ context }) => {
    const p = await openPage(context, `${server.origin}/theme`);
    await setIntensity(p, 'End');
    await sweep(p, [290, 300], [710, 300]);
    await expect.poll(async () => (await storedHighlights(context, '/theme')).length).toBe(1);
    await expectScreen(p, 500, 300, BLACK, 'light theme: text black');
    await expectScreen(p, 500, 306, blended('multiply', WHITE, YELLOW, 1), 'light theme: highlight');

    await p.evaluate(() => document.body.classList.add('dark'));
    await expectScreen(p, 500, 300, WHITE, 'dark theme: text white');
    await expectScreen(p, 500, 306, blended('screen', DARK_BG, YELLOW, 0.5), 'dark theme: highlight');

    await setIntensity(p, 'Home');
    await sweep(p, [290, 400], [710, 400]);
    await expect.poll(async () => (await storedHighlights(context, '/theme')).length).toBe(2);
    expect((await storedHighlights(context, '/theme'))[1].opacity).toBe(0.2);
    await expectScreen(p, 500, 400, blended('screen', DARK_BG, YELLOW, 0.1), 'softest highlight is faint but visible');
  });
});
