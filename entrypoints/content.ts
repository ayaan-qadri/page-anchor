import { defineContentScript } from 'wxt/utils/define-content-script';
import { setBootHandoff } from '../src/core/boot-handoff';
import { LOAD_APP_MESSAGE, getExtensionApi } from '../src/core/inject';
import { SETTINGS_STORAGE_KEY, STORAGE_CHANGED_MESSAGE, getPageStorageKey } from '../src/core/page-key';
import { DEFAULT_SHORTCUTS, ShortcutManager, canonicalizeShortcut } from '../src/core/shortcuts';
import type { PageAnchorData, ShortcutAction, UrlMatchMode } from '../src/types';

const HOST_ID = 'page-anchor-host';

/** A freshly injected copy (e.g. after an extension update) asks any older copy on the page to tear down. */
const TAKEOVER_EVENT = 'page-anchor:takeover';

const URL_MATCH_MODES: readonly UrlMatchMode[] = ['clean', 'exact', 'domain'];

type NavigationTarget = Window & { navigation?: EventTarget };

/** Set in this extension context's own global, which pages and other extension versions cannot see. */
const BOOTED_FLAG = '__pageAnchorBooted';

/**
 * Runs on every page, so it stays tiny: it only checks whether this page has drawings and waits for the user to open the toolbar.
 * Everything else lives in the app script, which the background injects on demand.
 */
export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  main() {
    // The manifest copy can run after the background already injected one (icon clicked before the page was idle); the first one owns the tab.
    const scope = globalThis as typeof globalThis & { [BOOTED_FLAG]?: boolean };
    if (scope[BOOTED_FLAG]) return;
    scope[BOOTED_FLAG] = true;

    // Only copies from an older extension version, running in another context, react to this.
    document.dispatchEvent(new CustomEvent(TAKEOVER_EVENT));
    document.querySelectorAll<HTMLElement>(`#${HOST_ID}`).forEach((stale) => {
      // Older builds re-attach their host unless it is flagged as destroyed.
      stale.dataset.destroyed = 'true';
      stale.remove();
    });

    const api = getExtensionApi();
    if (!api) return;

    let lifetime = new AbortController();
    let launched = false;
    let urlMatchMode: UrlMatchMode = 'clean';
    let checkedUrl: string | null = null;
    let checkToken = 0;

    const shortcutManager = new ShortcutManager({ ...DEFAULT_SHORTCUTS }, () => false);
    shortcutManager.addListener((action: ShortcutAction) => {
      if (action === 'toggle-active' || action === 'action-toggle-toolbar') void launch(true);
    });

    const readSettings = async () => {
      const stored = (await api.storage.local.get(SETTINGS_STORAGE_KEY))[SETTINGS_STORAGE_KEY] as
        | { urlMatchMode?: unknown; shortcuts?: Record<string, unknown> }
        | undefined;
      const mode = stored?.urlMatchMode;
      urlMatchMode = URL_MATCH_MODES.includes(mode as UrlMatchMode) ? (mode as UrlMatchMode) : 'clean';
      const shortcuts: Record<string, string> = { ...DEFAULT_SHORTCUTS };
      for (const [action, key] of Object.entries(stored?.shortcuts ?? {})) {
        if (typeof key === 'string') shortcuts[action] = canonicalizeShortcut(key);
      }
      shortcutManager.setShortcuts(shortcuts as typeof DEFAULT_SHORTCUTS);
    };

    /** Loads the app only if this page has saved drawings to show. */
    const checkPage = async (force = false) => {
      const url = window.location.href;
      if (launched || (!force && url === checkedUrl)) return;
      checkedUrl = url;
      const token = ++checkToken;
      const key = getPageStorageKey(url, urlMatchMode);
      let data: PageAnchorData | undefined;
      try {
        data = (await api.storage.local.get(key))[key] as PageAnchorData | undefined;
      } catch {
        return;
      }
      if (token !== checkToken || launched || window.location.href !== url) return;
      if (data?.elements?.length) void launch(false, data);
    };

    const onMessage = (msg: unknown, _sender: unknown, sendResponse: (response?: unknown) => void): boolean => {
      const type = (msg as { type?: unknown } | null)?.type;
      switch (type) {
        case 'PAGE_ANCHOR_TOGGLE':
          void launch(true);
          sendResponse({ active: true, count: 0 });
          break;
        case 'PAGE_ANCHOR_GET_STATUS':
          sendResponse({ active: false, count: 0, url: window.location.href, title: document.title });
          break;
        case 'PAGE_ANCHOR_CLEAR':
          sendResponse({ success: true });
          break;
        case 'PAGE_ANCHOR_URL_CHANGED':
          void checkPage();
          sendResponse({ success: true });
          break;
        case STORAGE_CHANGED_MESSAGE: {
          const keys = (msg as { keys?: unknown }).keys;
          if (!Array.isArray(keys)) break;
          if (keys.includes(SETTINGS_STORAGE_KEY)) {
            void readSettings().then(() => checkPage(true), () => {});
          } else if (keys.includes(getPageStorageKey(window.location.href, urlMatchMode))) {
            void checkPage(true);
          }
          break;
        }
      }
      return false;
    };

    const arm = () => {
      lifetime = new AbortController();
      const { signal } = lifetime;
      const recheck = () => void checkPage();
      window.addEventListener('popstate', recheck, { signal });
      window.addEventListener('hashchange', recheck, { signal });
      // Fires after the URL commits, including for history.pushState calls made by the page's own scripts.
      const navigation = (window as NavigationTarget).navigation;
      navigation?.addEventListener?.('currententrychange', recheck, { signal });
      document.addEventListener('visibilitychange', recheck, { signal });
      document.addEventListener(TAKEOVER_EVENT, disarm, { signal });
      shortcutManager.attach();
      api.runtime.onMessage.addListener(onMessage);
    };

    function disarm(): void {
      lifetime.abort();
      shortcutManager.detach();
      try {
        api?.runtime.onMessage.removeListener(onMessage);
      } catch {}
    }

    /** Hands this tab over to the app; if the background cannot inject it, keep listening so the user can try again. */
    const launch = async (openToolbar: boolean, data?: PageAnchorData) => {
      if (launched) return;
      launched = true;
      disarm();
      setBootHandoff({ openToolbar, data });
      let ok = false;
      try {
        const response = (await api.runtime.sendMessage({ type: LOAD_APP_MESSAGE })) as { ok?: boolean } | undefined;
        ok = response?.ok === true;
      } catch {}
      if (ok) return;
      launched = false;
      checkedUrl = null;
      arm();
    };

    arm();
    void readSettings().then(() => checkPage(), () => {});
  },
});
