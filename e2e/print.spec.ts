import fs from 'fs';
import path from 'path';
import { chromium, type Frame, type Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { decodePng, drawStroke, expectColor, openToolbar, pa, startServer, waitForContentScript, type Rgb, type TestServer } from './helpers';

const BLUE: Rgb = [0, 0, 255];
const GREEN: Rgb = [0, 255, 0];
const STROKE: Rgb = [239, 68, 68];

/** 3500px tall: a fixed red bar over blue, green and black bands. */
const BANDS_PAGE = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>Print bands</title></head>
<body style="margin:0">
  <div style="position:fixed;top:0;left:0;right:0;height:40px;background:rgb(255,0,0)"></div>
  <div style="height:1000px;background:rgb(0,0,255)"></div>
  <div style="height:1000px;background:rgb(0,255,0)"></div>
  <div style="height:1500px;background:rgb(0,0,0)"></div>
</body></html>`;

const PRINT_HTML = path.resolve(process.cwd(), '.output/chrome-mv3/print.html');

/** The real dialog would block the test; the print page records the call instead. */
async function stubPrintDialog(page: Page) {
  await page.context().addInitScript(() => {
    if (!location.pathname.endsWith('/print.html')) return;
    window.print = () => {
      (window as unknown as { printCalls: number }).printCalls = ((window as unknown as { printCalls?: number }).printCalls ?? 0) + 1;
    };
  });
}

async function printFrame(page: Page): Promise<Frame> {
  await expect.poll(() => page.frames().some((f) => f.url().endsWith('/print.html')), { timeout: 30000 }).toBe(true);
  const frame = page.frames().find((f) => f.url().endsWith('/print.html'))!;
  await frame.waitForFunction(() => (window as unknown as { printCalls?: number }).printCalls === 1, undefined, { timeout: 30000 });
  return frame;
}

async function printedImages(frame: Frame) {
  const images = await frame.evaluate(() =>
    Promise.all(
      [...document.images].map(async (img) => {
        const bytes = new Uint8Array(await (await fetch(img.src)).arrayBuffer());
        let binary = '';
        for (const b of bytes) binary += String.fromCharCode(b);
        return { base64: btoa(binary), style: img.getAttribute('style') ?? '' };
      })
    )
  );
  return images.map((image) => ({ ...image, bytes: Buffer.from(image.base64, 'base64') }));
}

/** Prints the sheets the way the browser does, from the built print page's own styles, and returns the page count. */
async function printToPdf(images: Buffer[], format: 'A4' | 'Letter', out: string): Promise<number> {
  const style = /<style>([\s\S]*?)<\/style>/.exec(fs.readFileSync(PRINT_HTML, 'utf8'))![1];
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const imgs = images.map((b) => `<div class="page"><img class="sheet" src="data:image/png;base64,${b.toString('base64')}"></div>`).join('');
    await page.setContent(`<!DOCTYPE html><html><head><style>${style}</style></head><body>${imgs}</body></html>`);
    const pdf = await page.pdf({ format, path: out, preferCSSPageSize: true });
    return (pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) ?? []).length;
  } finally {
    await browser.close();
  }
}

test.describe('Print', () => {
  let server: TestServer;

  test.beforeAll(async () => {
    server = await startServer({ '/bands': BANDS_PAGE });
  });

  test.afterAll(async () => {
    await server.close();
  });

  test('prints the whole page with drawings as A4 sheets that fit A4 and Letter paper', async ({ context }, testInfo) => {
    test.setTimeout(120000);
    const page = context.pages()[0] ?? (await context.newPage());
    await stubPrintDialog(page);
    await page.goto(`${server.origin}/bands`);
    await waitForContentScript(page);
    await openToolbar(page, context);
    await pa(page, '[data-tool="pen"]').click();
    await drawStroke(page, [400, 300], [700, 300], 12);

    await pa(page, '[data-action="more"]').click();
    await pa(page, '[data-action="print"]').click();
    const frame = await printFrame(page);
    await expect(pa(page, '.pa-export-status')).toHaveCount(0);

    const images = await printedImages(frame);
    expect(images.length).toBe(2);
    const sheets = images.map((image) => decodePng(image.bytes));
    const width = sheets[0].width;
    const scale = width / (await page.evaluate(() => document.documentElement.clientWidth));
    expect(sheets.every((sheet) => sheet.width === width && sheet.height <= Math.floor((width * 841.89) / 595.28))).toBe(true);
    expect(Math.abs(sheets[0].height + sheets[1].height - 3500 * scale)).toBeLessThanOrEqual(2);
    expectColor(sheets[0].pixel(Math.round(550 * scale), Math.round(300 * scale)), STROKE, 'drawing on the first sheet');
    expectColor(sheets[0].pixel(Math.round(100 * scale), Math.round(500 * scale)), BLUE, 'page on the first sheet');
    expectColor(sheets[1].pixel(Math.round(100 * scale), 5), GREEN, 'page continues on the second sheet');

    const buffers = images.map((image) => image.bytes);
    expect(await printToPdf(buffers, 'A4', testInfo.outputPath('print-a4.pdf'))).toBe(2);
    expect(await printToPdf(buffers, 'Letter', testInfo.outputPath('print-letter.pdf'))).toBe(2);

    // Closing the dialog removes the hidden print frame.
    await frame.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    await expect.poll(() => page.frames().some((f) => f.url().endsWith('/print.html'))).toBe(false);
    await expect(pa(page, '.pa-toolbar')).toBeVisible();
  });

  test('websites cannot probe for the print page to tell Page Anchor is installed, and Print still works', async ({ context, extensionId }) => {
    test.setTimeout(90000);
    const page = context.pages()[0] ?? (await context.newPage());
    await stubPrintDialog(page);
    await page.goto(`${server.origin}/bands`);
    await waitForContentScript(page);
    const probe = () =>
      page.evaluate(async (id) => {
        const fetched = await fetch(`chrome-extension://${id}/print.html`).then(
          (r) => r.ok,
          () => false
        );
        return fetched;
      }, extensionId);
    expect(await probe()).toBe(false);

    await openToolbar(page, context);
    await pa(page, '[data-action="more"]').click();
    await pa(page, '[data-action="print"]').click();
    const frame = await printFrame(page);
    // The address a website could see on the frame is the per-session one, not the extension's fixed one.
    const src = await page.evaluate(() => document.getElementById('page-anchor-host')!.shadowRoot!.querySelector('iframe')!.src);
    expect(new URL(src).host).not.toBe(extensionId);
    expect((await printedImages(frame)).length).toBeGreaterThan(0);
    await frame.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    await expect.poll(() => page.frames().some((f) => f.url().endsWith('/print.html'))).toBe(false);
    // Still hidden from a probe made after printing.
    expect(await probe()).toBe(false);
  });

  test('prints a selected area at its on-screen size', async ({ context }) => {
    test.setTimeout(90000);
    const page = context.pages()[0] ?? (await context.newPage());
    await stubPrintDialog(page);
    await page.goto(`${server.origin}/bands`);
    await waitForContentScript(page);
    await openToolbar(page, context);
    await pa(page, '[data-tool="pen"]').click();
    await drawStroke(page, [400, 300], [700, 300], 12);

    await pa(page, '[data-action="more"]').click();
    await pa(page, '[data-action="capture-area"]').click();
    await drawStroke(page, [300, 250], [800, 350], 8);
    await pa(page, '[data-action="area-print"]').click();
    const frame = await printFrame(page);
    await expect(pa(page, '.pa-area')).toHaveCount(0);

    const [image] = await printedImages(frame);
    expect(image.style).toContain('min(500px, 100%)');
    const area = decodePng(image.bytes);
    const scale = area.width / 500;
    expect(Math.abs(area.height - 100 * scale)).toBeLessThanOrEqual(1);
    expectColor(area.pixel(Math.round(250 * scale), Math.round(50 * scale)), STROKE, 'drawing');
    expectColor(area.pixel(5, 5), BLUE, 'page under the area');
  });
});
