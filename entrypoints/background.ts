import { defineBackground } from 'wxt/utils/define-background';
import { APP_SCRIPT_PATH, LOAD_APP_MESSAGE, getExtensionApi, injectContentScript } from '../src/core/inject';
import {
  SITE_ACCESS_CHOICE_KEY,
  SITE_ACCESS_MESSAGE,
  SITE_ACCESS_REQUEST_KEY,
  hasSiteAccess,
  keptLimited,
  type SiteAccessRequest,
  type SiteAccessResponse,
} from '../src/core/site-access';
import { STORAGE_CHANGED_MESSAGE, rekeySavedPages, setStorageChangeRelay, type StorageChangedMessage } from '../src/core/storage';
import { CAPTURE_VIEWPORT_MESSAGE, type CaptureViewportRequest, type CaptureViewportResponse } from '../src/export/messages';

const CAPTURE_RETRY_MS = 550;
const NO_ACCESS_TITLE = 'Page Anchor needs access to websites';
const NO_ACCESS_BADGE_COLOR = '#d97706';

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

  const defaultTitle = ext.runtime.getManifest?.()?.action?.default_title ?? 'Page Anchor';

  /** Asking on the icon stops once the user chose to keep access limited. */
  async function needsToAsk(): Promise<boolean> {
    return !(await hasSiteAccess(ext)) && !(await keptLimited(ext));
  }

  async function showSiteAccess(): Promise<void> {
    const ask = await needsToAsk();
    try {
      await ext.action.setBadgeText({ text: ask ? '!' : '' });
      if (ask) await ext.action.setBadgeBackgroundColor({ color: NO_ACCESS_BADGE_COLOR });
      await ext.action.setTitle({ title: ask ? NO_ACCESS_TITLE : defaultTitle });
    } catch {}
  }

  async function openOptions(siteUrl?: unknown): Promise<void> {
    if (typeof siteUrl === 'string') {
      await ext.storage.local.set({ [SITE_ACCESS_REQUEST_KEY]: { url: siteUrl } satisfies SiteAccessRequest }).catch(() => {});
    }
    await ext.runtime.openOptionsPage?.();
  }

  async function injectIntoOpenTabs(): Promise<void> {
    try {
      const tabs = await ext.tabs.query({ url: ['http://*/*', 'https://*/*'] });
      for (const tab of tabs) {
        if (tab.id) {
          injectContentScript(ext, tab.id).catch(() => {});
        }
      }
    } catch {}
  }

  void showSiteAccess();
  ext.permissions?.onAdded?.addListener(() => {
    void showSiteAccess();
    void injectIntoOpenTabs();
  });
  ext.permissions?.onRemoved?.addListener(() => void showSiteAccess());
  ext.storage?.onChanged?.addListener((changes: Record<string, unknown>) => {
    if (SITE_ACCESS_CHOICE_KEY in changes) void showSiteAccess();
  });

  ext.action.onClicked.addListener(async (tab?: { id?: number }) => {
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
  ext.runtime?.onMessage?.addListener((msg: unknown, sender: { tab?: { id?: number; url?: string }; url?: string }, sendResponse: (response?: unknown) => void) => {
    const type = (msg as { type?: unknown } | null)?.type;
    if (type === LOAD_APP_MESSAGE) {
      const tabId = sender.tab?.id;
      if (tabId === undefined) return false;
      void injectContentScript(ext, tabId, APP_SCRIPT_PATH).then((ok) => sendResponse({ ok }));
      // Keeps the channel open for the asynchronous injection result.
      return true;
    }
    if (type === SITE_ACCESS_MESSAGE) {
      void hasSiteAccess(ext, sender.url ?? sender.tab?.url ?? '').then((granted) => sendResponse({ granted } satisfies SiteAccessResponse));
      return true;
    }
    if (type === CAPTURE_VIEWPORT_MESSAGE) {
      const tabId = sender.tab?.id;
      if (tabId === undefined) return false;
      void captureViewport(tabId, (msg as CaptureViewportRequest).region).then(sendResponse);
      return true;
    }
    if (type === 'PAGE_ANCHOR_OPEN_OPTIONS') {
      void openOptions((msg as { site?: unknown }).site);
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

  let installChecked = () => {};
  // Lets the e2e suite change the access it reports only after this check has read it.
  (globalThis as { pageAnchorInstallChecked?: Promise<void> }).pageAnchorInstallChecked = new Promise<void>((resolve) => (installChecked = resolve));

  ext.runtime?.onInstalled?.addListener(async (details?: { reason?: string }) => {
    try {
      const reason = details?.reason;
      if (reason !== 'install' && reason !== 'update') return;

      if (reason === 'update') {
        await rekeySavedPages().catch(() => {});
      }
      if (reason === 'install' && (await needsToAsk())) {
        await openOptions();
        return;
      }
      await injectIntoOpenTabs();
    } finally {
      installChecked();
    }
  });
});
