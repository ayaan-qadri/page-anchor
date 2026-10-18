const CONTENT_SCRIPT_PATH = 'content-scripts/content.js';

/**
 * Injects the content script into an already-open tab, where manifest
 * auto-injection has not run. Shared by the popup and the service worker so the
 * path and the MV2 fallback stay in one place.
 */
export async function injectContentScript(ext: any, tabId: number): Promise<boolean> {
  try {
    if (ext.scripting?.executeScript) {
      await ext.scripting.executeScript({
        target: { tabId },
        files: [CONTENT_SCRIPT_PATH],
      });
      return true;
    } else if (ext.tabs?.executeScript) {
      await new Promise<void>((resolve, reject) => {
        ext.tabs.executeScript(tabId, { file: CONTENT_SCRIPT_PATH }, () => {
          if (ext.runtime?.lastError) reject(ext.runtime.lastError);
          else resolve();
        });
      });
      return true;
    }
  } catch {
    return false;
  }
  return false;
}
