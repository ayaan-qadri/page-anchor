import path from 'path';
import { test, expect } from '@playwright/test';
import { SMART_ANCHORING_FLOWS } from '../shared/smart-anchoring-flows';
import { BidiFirefox } from './bidi-firefox';

test.describe('Smart Anchoring in Firefox (built extension)', () => {
  let firefox: BidiFirefox;

  test.beforeAll(async () => {
    firefox = await BidiFirefox.launch();
  });

  test.afterAll(async () => {
    await firefox?.close();
  });

  for (const flow of SMART_ANCHORING_FLOWS) {
    // Playwright requires a destructuring pattern; these tests drive their own browser and need no fixtures.
    // eslint-disable-next-line no-empty-pattern
    test(flow.name, async ({}, testInfo) => {
      await flow.run({ driver: firefox.driver(), shots: path.join(testInfo.outputDir, 'shots') });
      expect(firefox.consoleErrors, 'no extension errors in the console').toEqual([]);
    });
  }
});
