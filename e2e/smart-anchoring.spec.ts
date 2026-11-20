import path from 'path';
import type { BrowserContext, Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { drawStroke, openToolbar, readStorage, waitForContentScript } from './helpers';
import { SMART_ANCHORING_FLOWS, type ExtensionDriver } from './shared/smart-anchoring-flows';

async function storedCount(context: BrowserContext, url: string): Promise<number> {
  const value = Object.entries(await readStorage(context)).find(([key]) => key.startsWith('page_anchor_data:') && key.includes(new URL(url).host));
  return ((value?.[1] as { elements?: unknown[] } | undefined)?.elements ?? []).length;
}

function chromeDriver(page: Page, context: BrowserContext): ExtensionDriver {
  return {
    name: 'chrome',
    goto: async (url) => {
      await page.goto(url);
      await waitForContentScript(page);
    },
    reload: async () => {
      await page.reload();
      await waitForContentScript(page);
    },
    evaluate: (expression) => page.evaluate(expression),
    openToolbar: () => openToolbar(page, context),
    press: (key) => page.keyboard.press(key),
    drag: (from, to) => drawStroke(page, from, to, 10),
    setViewport: (width, height) => page.setViewportSize({ width, height }),
    waitForSave: () => expect.poll(() => storedCount(context, page.url()), { timeout: 5000 }).toBeGreaterThan(0),
    screenshot: async (file) => {
      await page.screenshot({ path: file });
    },
  };
}

test.describe('Smart Anchoring in Chrome (built extension)', () => {
  for (const flow of SMART_ANCHORING_FLOWS) {
    test(flow.name, async ({ context }, testInfo) => {
      const page = context.pages()[0] || (await context.newPage());
      const errors: string[] = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error' && /page.?anchor/i.test(msg.text())) errors.push(msg.text());
      });
      await flow.run({ driver: chromeDriver(page, context), shots: path.join(testInfo.outputDir, 'shots') });
      expect(errors, 'no extension errors in the console').toEqual([]);
    });
  }
});
