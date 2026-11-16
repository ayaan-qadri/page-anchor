import type { Browser } from 'wxt/browser';

export type ExtensionApi = typeof Browser;

const CONTENT_SCRIPT_PATH = 'content-scripts/content.js';

/** The drawing app, injected into a tab only once the page has drawings or the user opens the toolbar. */
export const APP_SCRIPT_PATH = 'page-app.js';

/** Sent by the boot script to ask the background to inject the app into its tab. */
export const LOAD_APP_MESSAGE = 'PAGE_ANCHOR_LOAD_APP';

/** Resolved per call because the globals can be swapped (tests) or vanish (invalidated context). */
export function getExtensionApi(): ExtensionApi | null {
  const scope = globalThis as unknown as { browser?: ExtensionApi; chrome?: ExtensionApi };
  try {
    if (scope.browser?.runtime?.id) return scope.browser;
    return scope.chrome ?? null;
  } catch {
    return null;
  }
}

/** False once the extension was reloaded or updated underneath this content script. */
export function isExtensionContextValid(): boolean {
  try {
    return Boolean(getExtensionApi()?.runtime?.id);
  } catch {
    return false;
  }
}

interface LegacyTabsApi {
  executeScript?: (tabId: number, details: { file: string }) => Promise<unknown>;
}

export async function injectContentScript(ext: ExtensionApi, tabId: number, file = CONTENT_SCRIPT_PATH): Promise<boolean> {
  try {
    if (ext.scripting?.executeScript) {
      await ext.scripting.executeScript({
        target: { tabId },
        files: [file],
      });
      return true;
    }
    const legacyTabs = ext.tabs as unknown as LegacyTabsApi | undefined;
    if (legacyTabs?.executeScript) {
      await legacyTabs.executeScript(tabId, { file });
      return true;
    }
  } catch {
    return false;
  }
  return false;
}
