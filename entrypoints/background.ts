import { defineBackground } from 'wxt/utils/define-background';
import { browser } from 'wxt/browser';

export default defineBackground(() => {
  const ext = typeof browser !== 'undefined' ? browser : (typeof chrome !== 'undefined' ? chrome : null);
  if (!ext) return;

  ext.commands?.onCommand?.addListener(async (command: string) => {
    if (command === 'toggle-drawing-mode') {
      const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        try {
          await ext.tabs.sendMessage(tab.id, { type: 'PAGE_ANCHOR_TOGGLE' });
        } catch {}
      }
    }
  });

  const actionApi = ext.action || (ext as any).browserAction;
  actionApi?.onClicked?.addListener(async (tab: any) => {
    if (tab?.id) {
      try {
        await ext.tabs.sendMessage(tab.id, { type: 'PAGE_ANCHOR_TOGGLE' });
      } catch {}
    }
  });

  ext.tabs?.onUpdated?.addListener((tabId: number, changeInfo: any) => {
    if (changeInfo.url) {
      ext.tabs.sendMessage(tabId, { type: 'PAGE_ANCHOR_URL_CHANGED', url: changeInfo.url }).catch(() => {});
    }
  });
});
