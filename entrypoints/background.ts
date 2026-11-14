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

  const actionApi = ext.action || ext.browserAction;
  actionApi?.onClicked?.addListener(async (tab?: any) => {
    let tabId = tab?.id;
    if (!tabId) {
      const [activeTab] = await ext.tabs.query({ active: true, currentWindow: true });
      tabId = activeTab?.id;
    }
    if (tabId) {
      await safeToggleTab(tabId);
    }
  });

  ext.commands?.onCommand?.addListener(async (command: string) => {
    if (command === 'toggle-drawing-mode') {
      const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        await safeToggleTab(tab.id);
      }
    }
  });

  // The in-page toolbar's "Settings & Backup" item routes through the
  // background, because only an extension context can open the options page.
  ext.runtime?.onMessage?.addListener((msg: any) => {
    if (msg?.type === 'PAGE_ANCHOR_OPEN_OPTIONS') {
      ext.runtime.openOptionsPage?.();
    }
    return false;
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
});
