import { defineBackground } from 'wxt/utils/define-background';
import { browser } from 'wxt/browser';

export default defineBackground(() => {
  const ext: any = typeof browser !== 'undefined' ? browser : (typeof chrome !== 'undefined' ? chrome : null);
  if (!ext) return;

  async function injectContentScript(tabId: number): Promise<boolean> {
    try {
      if (ext.scripting?.executeScript) {
        await ext.scripting.executeScript({
          target: { tabId },
          files: ['content-scripts/content.js'],
        });
        return true;
      } else if (ext.tabs?.executeScript) {
        await new Promise<void>((resolve, reject) => {
          ext.tabs.executeScript(tabId, { file: 'content-scripts/content.js' }, () => {
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

  async function safeToggleTab(tabId: number): Promise<void> {
    try {
      await ext.tabs.sendMessage(tabId, { type: 'PAGE_ANCHOR_TOGGLE' });
    } catch {
      const injected = await injectContentScript(tabId);
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

  const actionApi = ext.action || (ext as any).browserAction;
  actionApi?.onClicked?.addListener(async (tab: any) => {
    if (tab?.id) {
      await safeToggleTab(tab.id);
    }
  });

  ext.runtime?.onInstalled?.addListener(async () => {
    try {
      const tabs = await ext.tabs.query({ url: ['http://*/*', 'https://*/*'] });
      for (const tab of tabs) {
        if (tab.id) {
          injectContentScript(tab.id).catch(() => {});
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
