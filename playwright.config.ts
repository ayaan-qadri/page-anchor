import { defineConfig, devices } from '@playwright/test';

const ENGINE_SPECS = /anchoring[/\\].*\.spec\.ts$/;
const FIREFOX_EXTENSION_SPECS = /firefox[/\\].*\.spec\.ts$/;

export default defineConfig({
  testDir: './e2e',
  timeout: 45000,
  retries: 0,
  workers: 1,
  use: {
    trace: 'on-first-retry',
  },
  projects: [
    // The built extension in Chrome; these specs launch their own persistent Chromium through e2e/fixtures.ts.
    { name: 'chrome-extension', testIgnore: [ENGINE_SPECS, FIREFOX_EXTENSION_SPECS] },
    // The built extension in a real Firefox, driven over WebDriver BiDi (Playwright cannot load Firefox add-ons).
    { name: 'firefox-extension', testMatch: FIREFOX_EXTENSION_SPECS, timeout: 120000 },
    // The anchoring module itself in every browser engine and in phone profiles.
    { name: 'anchoring-chromium', testMatch: ENGINE_SPECS, use: { browserName: 'chromium', viewport: { width: 1280, height: 800 } } },
    { name: 'anchoring-firefox', testMatch: ENGINE_SPECS, use: { browserName: 'firefox', viewport: { width: 1280, height: 800 } } },
    { name: 'anchoring-webkit', testMatch: ENGINE_SPECS, use: { browserName: 'webkit', viewport: { width: 1280, height: 800 } } },
    { name: 'anchoring-android', testMatch: ENGINE_SPECS, use: { ...devices['Pixel 7'] } },
    { name: 'anchoring-iphone', testMatch: ENGINE_SPECS, use: { ...devices['iPhone 14'] } },
  ],
});
