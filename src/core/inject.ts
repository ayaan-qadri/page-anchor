import type { Browser } from 'wxt/browser';

export type ExtensionApi = typeof Browser;

const CONTENT_SCRIPT_PATH = 'content-scripts/content.js';

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

export async function injectContentScript(ext: ExtensionApi, tabId: number): Promise<boolean> {
  try {
    if (ext.scripting?.executeScript) {
      await ext.scripting.executeScript({
        target: { tabId },
        files: [CONTENT_SCRIPT_PATH],
      });
      return true;
    }
    const legacyTabs = ext.tabs as unknown as LegacyTabsApi | undefined;
    if (legacyTabs?.executeScript) {
      await legacyTabs.executeScript(tabId, { file: CONTENT_SCRIPT_PATH });
      return true;
    }
  } catch {
    return false;
  }
  return false;
}
