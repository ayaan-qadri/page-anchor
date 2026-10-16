import { test as base, chromium, type BrowserContext } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const test = base.extend<{
  context: BrowserContext;
  extensionId: string;
}>({
  context: async (_fixtures, use) => {
    const pathToExtension = path.resolve(__dirname, '../.output/chrome-mv3');
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'page-anchor-e2e-'));

    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      args: [
        `--disable-extensions-except=${pathToExtension}`,
        `--load-extension=${pathToExtension}`,
      ],
    });

    await use(context);
    await context.close();

    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch {}
  },
  extensionId: async ({ context }, use) => {
    let background = context.serviceWorkers()[0];
    if (!background) {
      background = await context.waitForEvent('serviceworker', { timeout: 8000 }).catch(() => null as any);
    }

    const extensionId = background ? background.url().split('/')[2] : '';
    await use(extensionId);
  },
});

export const expect = test.expect;
