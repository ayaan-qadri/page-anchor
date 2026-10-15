import { defineBackground } from 'wxt/utils/define-background';
import { browser } from 'wxt/browser';

export default defineBackground(() => {
  const ext = typeof browser !== 'undefined' ? browser : (typeof chrome !== 'undefined' ? chrome : null);
  if (!ext) return;

  // Listen for extension commands (e.g. keyboard shortcuts like Alt+Shift+D defined in manifest)
  ext.commands?.onCommand?.addListener(async (command: string) => {
    if (command === 'toggle-drawing-mode') {
      const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        try {
          await ext.tabs.sendMessage(tab.id, { type: 'PAGE_ANCHOR_TOGGLE' });
        } catch {
          // If content script was not ready, inject or ignore
        }
      }
    }
  });

  // Handle extension icon click (supports MV3 action and MV2 browserAction across Chrome/Firefox/Safari)
  const actionApi = ext.action || (ext as any).browserAction;
  actionApi?.onClicked?.addListener(async (tab: any) => {
    if (tab?.id) {
      try {
        await ext.tabs.sendMessage(tab.id, { type: 'PAGE_ANCHOR_TOGGLE' });
      } catch {
        // Tab does not permit scripting or needs refresh
      }
    }
  });

  // Track URL updates in tabs for SPA routing
  ext.tabs?.onUpdated?.addListener((tabId: number, changeInfo: any) => {
    if (changeInfo.url) {
      ext.tabs.sendMessage(tabId, { type: 'PAGE_ANCHOR_URL_CHANGED', url: changeInfo.url }).catch(() => {});
    }
  });
});
