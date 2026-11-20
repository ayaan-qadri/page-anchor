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
  /** Screen pixel density for the whole browser, so screenshots really come at it; 0 keeps the machine's own. */
  deviceScale: number;
  /** A touch-only phone screen: coarse pointer, touch events and a phone-sized window. */
  phone: boolean;
}>({
  deviceScale: [0, { option: true }],
  phone: [false, { option: true }],
  context: async ({ deviceScale, phone }, use) => {
    const scale = deviceScale || (phone ? 3 : 0);
    const pathToExtension = path.resolve(__dirname, '../.output/chrome-mv3');
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'page-anchor-e2e-'));

    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      ...(scale ? { deviceScaleFactor: scale } : {}),
      ...(phone ? { viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true } : {}),
      args: [
        `--disable-extensions-except=${pathToExtension}`,
        `--load-extension=${pathToExtension}`,
        ...(scale ? [`--force-device-scale-factor=${scale}`] : []),
        // Locally the real window opens off-screen so it does not cover the desktop; CI runs on a virtual display and keeps its default placement. PA_HEADED=1 shows it.
        ...(process.env.CI || process.env.PA_HEADED ? [] : ['--window-position=-32000,-32000', '--disable-features=CalculateNativeWinOcclusion', '--disable-backgrounding-occluded-windows']),
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
