import type { BrowserContext, Page } from '@playwright/test';
import type { AnchorElement, ShapeElement, StrokeElement, TextElement } from '../src/types/engine.types';
import { test, expect } from './fixtures';
import { drawStroke, openToolbar, pa, readStorage, startServer, storedElementCount, waitForContentScript, writeStorage } from './helpers';

const MISSING_ANCHOR = {
  selector: '#definitely-not-on-this-page',
  initialRect: { left: 0, top: 0, width: 10, height: 10 },
};

async function storedElements(context: BrowserContext, urlFragment: string): Promise<AnchorElement[]> {
  const all = await readStorage(context);
  for (const [key, value] of Object.entries(all)) {
    if (key.startsWith('page_anchor_data:') && key.includes(urlFragment)) {
      return (value as { elements?: AnchorElement[] }).elements ?? [];
    }
  }
  return [];
}

async function seedPage(context: BrowserContext, url: string, elements: AnchorElement[]): Promise<void> {
  await writeStorage(context, {
    [`page_anchor_data:${url}`]: {
      url,
      normalizedUrl: url,
      pageTitle: 'Seeded',
      updatedAt: Date.now(),
      elements,
      domAnchoringEnabled: true,
    },
  });
}

/** Alpha (0-255) of the overlay pixel under the given viewport point. */
async function canvasAlpha(page: Page, layer: 'base' | 'active', x: number, y: number): Promise<number> {
  return page.evaluate(
    ({ layer, x, y }) => {
      const host = document.getElementById('page-anchor-host');
      const canvas = host?.shadowRoot?.querySelector<HTMLCanvasElement>(`.page-anchor-${layer}-canvas`);
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) return -1;
      const scale = canvas.width / canvas.getBoundingClientRect().width;
      return ctx.getImageData(Math.round(x * scale), Math.round(y * scale), 1, 1).data[3];
    },
    { layer, x, y }
  );
}

function rect(id: string, x1: number, y1: number, x2: number, y2: number, extra: Partial<ShapeElement> = {}): ShapeElement {
  return {
    id,
    type: 'rect',
    startX: x1,
    startY: y1,
    endX: x2,
    endY: y2,
    strokeColor: '#ff0000',
    strokeWidth: 4,
    opacity: 1,
    createdAt: 1,
    bbox: { minX: x1 - 6, minY: y1 - 6, maxX: x2 + 6, maxY: y2 + 6 },
    ...extra,
  };
}

async function openPage(context: BrowserContext, url: string): Promise<Page> {
  const page = context.pages()[0] || (await context.newPage());
  await page.goto(url);
  await page.waitForLoadState('domcontentloaded');
  await waitForContentScript(page);
  return page;
}

async function pickShape(page: Page, tool: 'rect' | 'circle'): Promise<void> {
  await pa(page, '[data-action="shapes"]').click();
  await pa(page, `[data-tool="${tool}"]`).click();
}

test.describe('Engine review fixes', () => {
  test('dropping a drawing whose anchor moved keeps it where it was dropped', async ({ context }) => {
    const server = await startServer({
      '/engine-drop': `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>Drop</title></head>
<body style="margin: 0; padding: 200px 0 0 0; font-family: sans-serif;">
  <div id="slot"></div>
  <div id="shift-target" style="margin-left: 100px; width: 500px; height: 260px; background: #e2e8f0;">Anchor target</div>
  <div style="height: 2000px"></div>
</body></html>`,
    });
    try {
      const page = await openPage(context, `${server.origin}/engine-drop`);
      await openToolbar(page, context);
      await pickShape(page, 'rect');
      await drawStroke(page, [200, 260], [400, 380], 6);
      await expect.poll(() => storedElementCount(context, '/engine-drop')).toBe(1);

      // Push the anchor target 100px down; the rectangle follows it on screen.
      await page.evaluate(() => {
        const spacer = document.createElement('div');
        spacer.style.height = '100px';
        document.getElementById('slot')!.appendChild(spacer);
      });
      await expect.poll(() => canvasAlpha(page, 'base', 200, 420)).toBeGreaterThan(0);

      await pa(page, '[data-tool="select"]').click();
      await page.mouse.move(300, 420);
      await page.mouse.down();
      await page.mouse.move(340, 420, { steps: 4 });
      await page.mouse.up();

      await expect
        .poll(async () => {
          const [el] = (await storedElements(context, '/engine-drop')) as ShapeElement[];
          return el ? [Math.round(el.startX), Math.round(el.startY)] : null;
        })
        .toEqual([240, 360]);
      // Still drawn at the drop position, not snapped back up by the old offset.
      await expect.poll(() => canvasAlpha(page, 'base', 240, 420)).toBeGreaterThan(0);
      expect(await canvasAlpha(page, 'base', 240, 300)).toBe(0);
    } finally {
      await server.close();
    }
  });

  test('orphaned drawings render dimmed in dimmed mode', async ({ context }) => {
    const server = await startServer();
    try {
      const url = `${server.origin}/engine-dimmed`;
      await writeStorage(context, { page_anchor_settings: { orphanedAnchorMode: 'dimmed' } });
      await seedPage(context, url, [
        rect('orphan', 200, 250, 500, 450, { fillColor: '#ff0000', anchor: MISSING_ANCHOR }),
        rect('control', 600, 250, 800, 450, { fillColor: '#ff0000' }),
      ]);
      const page = await openPage(context, url);

      await expect.poll(() => canvasAlpha(page, 'base', 700, 350)).toBe(255);
      const dimmed = await canvasAlpha(page, 'base', 350, 350);
      expect(dimmed).toBeGreaterThan(60);
      expect(dimmed).toBeLessThan(120);
    } finally {
      await server.close();
    }
  });

  test('opening a second note commits the text typed in the first', async ({ context }) => {
    const server = await startServer();
    try {
      const page = await openPage(context, `${server.origin}/engine-notes`);
      await openToolbar(page, context);
      await pa(page, '[data-tool="text"]').click();

      const textarea = pa(page, '.pa-text-textarea');
      await page.mouse.click(200, 300);
      await expect(textarea).toBeVisible();
      await textarea.fill('First note');

      await page.mouse.click(600, 500);
      await expect(textarea).toHaveCount(1);
      await textarea.fill('Second note');
      await textarea.press('Enter');
      await expect(textarea).toHaveCount(0);

      await expect
        .poll(async () =>
          ((await storedElements(context, '/engine-notes')) as TextElement[]).map((el) => el.text).sort()
        )
        .toEqual(['First note', 'Second note']);
    } finally {
      await server.close();
    }
  });

  test('Enter during IME composition does not commit the note', async ({ context }) => {
    const server = await startServer();
    try {
      const page = await openPage(context, `${server.origin}/engine-ime`);
      await openToolbar(page, context);
      await pa(page, '[data-tool="text"]').click();

      const textarea = pa(page, '.pa-text-textarea');
      await page.mouse.click(200, 300);
      await expect(textarea).toBeVisible();
      await textarea.fill('にほんご');

      await page.evaluate(() => {
        const el = document.getElementById('page-anchor-host')?.shadowRoot?.querySelector('.pa-text-textarea');
        el?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true }));
      });
      await page.waitForTimeout(400);
      await expect(textarea).toBeVisible();
      expect(await storedElementCount(context, '/engine-ime')).toBe(0);

      await textarea.press('Enter');
      await expect(textarea).toHaveCount(0);
      await expect
        .poll(async () => ((await storedElements(context, '/engine-ime')) as TextElement[]).map((el) => el.text))
        .toEqual(['にほんご']);
    } finally {
      await server.close();
    }
  });

  test('a second pointer cannot hijack or end a stroke in progress', async ({ context }) => {
    const server = await startServer();
    try {
      const page = await openPage(context, `${server.origin}/engine-pointers`);
      await openToolbar(page, context);
      await pa(page, '[data-tool="pen"]').click();

      await page.mouse.move(150, 300);
      await page.mouse.down();
      await page.mouse.move(250, 300, { steps: 5 });

      await page.evaluate(() => {
        const canvas = document.getElementById('page-anchor-host')?.shadowRoot?.querySelector('.page-anchor-active-canvas');
        const init = { pointerId: 99, pointerType: 'touch', isPrimary: false, button: 0, bubbles: true };
        canvas?.dispatchEvent(new PointerEvent('pointerdown', { ...init, clientX: 700, clientY: 520 }));
        window.dispatchEvent(new PointerEvent('pointermove', { ...init, clientX: 720, clientY: 540 }));
        window.dispatchEvent(new PointerEvent('pointerup', { ...init, clientX: 720, clientY: 540 }));
      });

      await page.mouse.move(400, 300, { steps: 5 });
      await page.mouse.up();

      await expect.poll(() => storedElementCount(context, '/engine-pointers')).toBe(1);
      const [stroke] = (await storedElements(context, '/engine-pointers')) as StrokeElement[];
      const xs = stroke.points.map((p) => p.x);
      expect(stroke.points.every((p) => Math.abs(p.y - 300) <= 2)).toBe(true);
      expect(Math.min(...xs)).toBeLessThanOrEqual(155);
      expect(Math.max(...xs)).toBeGreaterThanOrEqual(395);
    } finally {
      await server.close();
    }
  });

  test('switching tool mid-shape drops the shape and clears its preview', async ({ context }) => {
    const server = await startServer();
    try {
      const page = await openPage(context, `${server.origin}/engine-switch`);
      await openToolbar(page, context);
      await pickShape(page, 'rect');

      await page.mouse.move(200, 300);
      await page.mouse.down();
      await page.mouse.move(420, 460, { steps: 5 });
      await expect.poll(() => canvasAlpha(page, 'active', 200, 380)).toBeGreaterThan(0);

      await page.keyboard.press('p');
      await expect(pa(page, '[data-tool="pen"]')).toHaveClass(/active/);
      await page.mouse.up();

      expect(await canvasAlpha(page, 'active', 200, 380)).toBe(0);
      await page.waitForTimeout(600);
      expect(await storedElementCount(context, '/engine-switch')).toBe(0);
      expect(await canvasAlpha(page, 'base', 200, 380)).toBe(0);
    } finally {
      await server.close();
    }
  });

  test('a flat ellipse can be erased', async ({ context }) => {
    const server = await startServer();
    try {
      const url = `${server.origin}/engine-flat-ellipse`;
      await seedPage(context, url, [
        {
          id: 'flat',
          type: 'circle',
          startX: 300,
          startY: 200,
          endX: 300,
          endY: 450,
          strokeColor: '#ff0000',
          strokeWidth: 4,
          opacity: 1,
          createdAt: 1,
          bbox: { minX: 294, minY: 194, maxX: 306, maxY: 456 },
        },
      ]);
      const page = await openPage(context, url);
      await openToolbar(page, context);
      await expect(pa(page, '.pa-count-badge')).toHaveText('1');

      await pa(page, '[data-tool="eraser"]').click();
      await page.mouse.click(300, 325);

      await expect.poll(() => storedElementCount(context, '/engine-flat-ellipse')).toBe(0);
    } finally {
      await server.close();
    }
  });

  test('select all ignores hidden orphaned drawings', async ({ context }) => {
    const server = await startServer();
    try {
      const url = `${server.origin}/engine-select-all`;
      await seedPage(context, url, [
        rect('visible', 150, 300, 300, 400),
        rect('hidden-orphan', 500, 300, 650, 400, { anchor: MISSING_ANCHOR }),
      ]);
      const page = await openPage(context, url);
      await openToolbar(page, context);
      await expect(pa(page, '.pa-count-badge')).toHaveText('2');

      await page.mouse.move(700, 600);
      await page.keyboard.press('ControlOrMeta+a');
      await expect(pa(page, '[data-tool="select"]')).toHaveClass(/active/);

      await page.mouse.move(225, 350);
      await page.mouse.down();
      await page.mouse.move(275, 350, { steps: 4 });
      await page.mouse.up();

      await expect
        .poll(async () => {
          const els = (await storedElements(context, '/engine-select-all')) as ShapeElement[];
          return els.map((el) => [el.id, Math.round(el.startX)]);
        })
        .toEqual([
          ['visible', 200],
          ['hidden-orphan', 500],
        ]);
    } finally {
      await server.close();
    }
  });

  test('marquee selection still works after clicking empty space', async ({ context }) => {
    const server = await startServer();
    try {
      const url = `${server.origin}/engine-marquee`;
      await seedPage(context, url, [rect('target', 200, 300, 300, 380), rect('other', 600, 300, 700, 380)]);
      const page = await openPage(context, url);
      await openToolbar(page, context);
      await expect(pa(page, '.pa-count-badge')).toHaveText('2');

      await pa(page, '[data-tool="select"]').click();
      await page.mouse.click(450, 550);
      await page.mouse.click(460, 560);

      await page.mouse.move(150, 250);
      await page.mouse.down();
      await page.mouse.move(350, 430, { steps: 6 });
      await page.mouse.up();
      await page.keyboard.press('Delete');

      await expect
        .poll(async () => (await storedElements(context, '/engine-marquee')).map((el) => el.id))
        .toEqual(['other']);
    } finally {
      await server.close();
    }
  });

  test('the drawing overlay leaves the page scrollbar uncovered', async ({ context }) => {
    const server = await startServer();
    try {
      const page = await openPage(context, `${server.origin}/engine-scrollbar`);
      await openToolbar(page, context);
      await pa(page, '[data-tool="pen"]').click();

      const sizes = await page.evaluate(() => {
        const canvas = document
          .getElementById('page-anchor-host')
          ?.shadowRoot?.querySelector<HTMLCanvasElement>('.page-anchor-active-canvas');
        return {
          canvasWidth: canvas?.getBoundingClientRect().width ?? -1,
          canvasHeight: canvas?.getBoundingClientRect().height ?? -1,
          clientWidth: document.documentElement.clientWidth,
          clientHeight: document.documentElement.clientHeight,
        };
      });
      expect(sizes.canvasWidth).toBe(sizes.clientWidth);
      expect(sizes.canvasHeight).toBe(sizes.clientHeight);

      // A press in the scrollbar gutter must reach the scrollbar, not start a pen stroke.
      const viewport = page.viewportSize();
      if (viewport && viewport.width > sizes.clientWidth) {
        const x = (viewport.width + sizes.clientWidth) / 2;
        await page.mouse.move(x, 200);
        await page.mouse.down();
        await page.mouse.move(x, 260, { steps: 4 });
        await page.mouse.up();
        await page.waitForTimeout(600);
        expect(await storedElementCount(context, '/engine-scrollbar')).toBe(0);
      }
    } finally {
      await server.close();
    }
  });
});
