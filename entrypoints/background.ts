import { defineBackground } from 'wxt/utils/define-background';
import { browser } from 'wxt/browser';
import { injectContentScript } from '../src/core/inject';

export default defineBackground(() => {
  const ext: any = typeof browser !== 'undefined' ? browser : (typeof chrome !== 'undefined' ? chrome : null);
  if (!ext) return;

  async function safeToggleTab(tabId: number): Promise<void> {
    try {
      await ext.tabs.sendMessage(tabId, { type: 'PAGE_ANCHOR_TOGGLE' });
    } catch {
      const injected = await injectContentScript(ext, tabId);
      if (injected) {
        setTimeout(async () => {
          try {
            await ext.tabs.sendMessage(tabId, { type: 'PAGE_ANCHOR_TOGGLE' });
          } catch {}
        }, 120);
      }
    }
  }

  ext.commands?.onCommand?.addListener(async (command: string) => {
    if (command === 'toggle-drawing-mode') {
      const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        await safeToggleTab(tab.id);
      }
    }
  });

  ext.runtime?.onInstalled?.addListener(async () => {
    try {
      const tabs = await ext.tabs.query({ url: ['http://*/*', 'https://*/*'] });
      for (const tab of tabs) {
        if (tab.id) {
          injectContentScript(ext, tab.id).catch(() => {});
        }
      }
    } catch {}
  });

  ext.tabs?.onUpdated?.addListener((tabId: number, changeInfo: any) => {
    if (changeInfo.url) {
      ext.tabs.sendMessage(tabId, { type: 'PAGE_ANCHOR_URL_CHANGED', url: changeInfo.url }).catch(() => {});
    }
  });
});
