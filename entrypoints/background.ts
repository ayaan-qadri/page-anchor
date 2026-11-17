import { defineBackground } from 'wxt/utils/define-background';
import { APP_SCRIPT_PATH, LOAD_APP_MESSAGE, getExtensionApi, injectContentScript } from '../src/core/inject';
import { STORAGE_CHANGED_MESSAGE, rekeySavedPages, setStorageChangeRelay, type StorageChangedMessage } from '../src/core/storage';
import { CAPTURE_VIEWPORT_MESSAGE, type CaptureViewportRequest, type CaptureViewportResponse } from '../src/export/messages';

const CAPTURE_RETRY_MS = 550;

/** How Chrome and Firefox word a refusal to screenshot a protected page (browser pages, add-on stores, other extensions). */
const BLOCKED_CAPTURE = /permission|cannot access|cannot be scripted|not allowed|restricted|extensions gallery|missing host/i;

function isValidRegion(region: CaptureViewportRequest['region']): region is NonNullable<CaptureViewportRequest['region']> {
  if (!region) return false;
  const { rect, scale } = region;
  const values = [rect?.x, rect?.y, rect?.width, rect?.height, scale];
  return values.every((v) => typeof v === 'number' && Number.isFinite(v)) && rect.width > 0 && rect.height > 0 && scale > 0;
}

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
  ext.runtime?.onMessage?.addListener((msg: unknown, sender: { tab?: { id?: number } }, sendResponse: (response?: unknown) => void) => {
    const type = (msg as { type?: unknown } | null)?.type;
    if (type === LOAD_APP_MESSAGE) {
      const tabId = sender.tab?.id;
      if (tabId === undefined) return false;
      void injectContentScript(ext, tabId, APP_SCRIPT_PATH).then((ok) => sendResponse({ ok }));
      // Keeps the channel open for the asynchronous injection result.
      return true;
    }
    if (type === CAPTURE_VIEWPORT_MESSAGE) {
      const tabId = sender.tab?.id;
      if (tabId === undefined) return false;
      void captureViewport(tabId, (msg as CaptureViewportRequest).region).then(sendResponse);
      return true;
    }
    if (type === 'PAGE_ANCHOR_OPEN_OPTIONS') {
      ext.runtime.openOptionsPage?.();
    } else if (type === STORAGE_CHANGED_MESSAGE) {
      void relayStorageChange(msg as StorageChangedMessage, sender.tab?.id);
    }
    return false;
  });

  /** captureVisibleTab shoots whatever tab is showing, so refuse once the user switches away mid-export. */
  async function captureViewport(tabId: number, region: CaptureViewportRequest['region']): Promise<CaptureViewportResponse> {
    try {
      const tab = await ext.tabs.get(tabId);
      if (!tab.active) return { error: 'tab-inactive' };
      const options = isValidRegion(region) ? { format: 'png' as const, rect: region.rect, scale: region.scale } : { format: 'png' as const };
      const capture = ext.tabs.captureVisibleTab.bind(ext.tabs) as (windowId: number | undefined, options: object) => Promise<string>;
      for (let attempt = 0; ; attempt++) {
        try {
          return { dataUrl: await capture(tab.windowId, options) };
        } catch (error) {
          // Chrome allows two captures per second and rejects the rest.
          if (attempt >= 5 || !/MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND/.test(String(error))) throw error;
          await new Promise((resolve) => setTimeout(resolve, CAPTURE_RETRY_MS));
        }
      }
    } catch (error) {
      const detail = String(error);
      return { error: BLOCKED_CAPTURE.test(detail) ? 'blocked' : 'capture-failed', detail };
    }
  }

  setStorageChangeRelay((keys) => void relayStorageChange({ type: STORAGE_CHANGED_MESSAGE, keys }, undefined));

  async function relayStorageChange(msg: StorageChangedMessage, fromTabId: number | undefined): Promise<void> {
    if (!Array.isArray(msg.keys)) return;
    const relayed: StorageChangedMessage = { type: STORAGE_CHANGED_MESSAGE, keys: msg.keys.filter((k) => typeof k === 'string') };
    try {
      const tabs = await ext.tabs.query({});
      for (const tab of tabs) {
        if (tab.id === undefined || tab.id === fromTabId) continue;
        try {
          const sent = ext.tabs.sendMessage(tab.id, relayed);
          if (sent && typeof sent.catch === 'function') sent.catch(() => {});
        } catch {}
      }
    } catch {}
  }

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
