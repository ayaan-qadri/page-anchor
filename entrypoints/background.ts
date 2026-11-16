import { defineBackground } from 'wxt/utils/define-background';
import { getExtensionApi, injectContentScript } from '../src/core/inject';
import { rekeySavedPages } from '../src/core/storage';

export default defineBackground(() => {
  const maybeExt = getExtensionApi();
  if (!maybeExt) return;
  const ext = maybeExt;

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

  async function activeTabId(): Promise<number | undefined> {
    const [activeTab] = await ext.tabs.query({ active: true, currentWindow: true });
    return activeTab?.id;
  }

  const actionApi = ext.action ?? (ext as unknown as { browserAction?: typeof ext.action }).browserAction;
  actionApi?.onClicked?.addListener(async (tab?: { id?: number }) => {
    const tabId = tab?.id ?? (await activeTabId());
    if (tabId) {
      await safeToggleTab(tabId);
    }
  });

  ext.commands?.onCommand?.addListener(async (command: string) => {
    if (command === 'toggle-drawing-mode') {
      const tabId = await activeTabId();
      if (tabId) {
        await safeToggleTab(tabId);
      }
    }
  });

  // The in-page toolbar's "Settings & Backup" item routes through the
  // background, because only an extension context can open the options page.
  ext.runtime?.onMessage?.addListener((msg: unknown) => {
    if ((msg as { type?: unknown } | null)?.type === 'PAGE_ANCHOR_OPEN_OPTIONS') {
      ext.runtime.openOptionsPage?.();
    }
    return false;
  });

  // Page scripts call history.pushState in the main world, which the content script cannot observe on every browser.
  ext.tabs?.onUpdated?.addListener((tabId: number, changeInfo: { url?: string }) => {
    if (!changeInfo.url) return;
    try {
      const sent = ext.tabs.sendMessage(tabId, { type: 'PAGE_ANCHOR_URL_CHANGED' });
      if (sent && typeof sent.catch === 'function') sent.catch(() => {});
    } catch {}
  });

  ext.runtime?.onInstalled?.addListener(async (details?: { reason?: string }) => {
    const reason = details?.reason;
    if (reason !== 'install' && reason !== 'update') return;

    if (reason === 'update') {
      await rekeySavedPages().catch(() => {});
    }

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
