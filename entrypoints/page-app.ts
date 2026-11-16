import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';
import { takeBootHandoff } from '../src/core/boot-handoff';
import { CanvasEngine } from '../src/core/engine';
import { HistoryManager } from '../src/core/history';
import { getExtensionApi, isExtensionContextValid } from '../src/core/inject';
import { ShortcutManager, isEditableTarget } from '../src/core/shortcuts';
import {
  DEFAULT_SETTINGS,
  SETTINGS_STORAGE_KEY,
  STORAGE_CHANGED_MESSAGE,
  getPageStorageKey,
  loadPageData,
  loadSettings,
  normalizeUrl,
  savePageData,
  type SyncBase,
} from '../src/core/storage';
import { AnchorElement, ExtensionSettings, PageAnchorData, ShortcutAction, ToolType } from '../src/types';
import { SHADOW_STYLES } from '../src/ui/styles';
import { TextEditorOverlay } from '../src/ui/text-editor';
import { FloatingToolbar } from '../src/ui/toolbar';

/** Messages this content script acts on; anything else is ignored. */
const HANDLED_MESSAGE_TYPES = new Set([
  'PAGE_ANCHOR_TOGGLE',
  'PAGE_ANCHOR_GET_STATUS',
  'PAGE_ANCHOR_CLEAR',
  'PAGE_ANCHOR_URL_CHANGED',
  STORAGE_CHANGED_MESSAGE,
]);

const HOST_ID = 'page-anchor-host';

/** A freshly injected copy (e.g. after an extension update) asks any older copy on the page to tear down. */
const TAKEOVER_EVENT = 'page-anchor:takeover';

const SAVE_DEBOUNCE_MS = 250;

/** Another tab's write is folded in quickly, but not mid-gesture. */
const REMOTE_SYNC_DELAY_MS = 50;

/** Pinned with !important so page CSS targeting `div` or `html > *` cannot hide or distort the overlay. */
const HOST_STYLES: Record<string, string> = {
  position: 'absolute',
  top: '0',
  left: '0',
  width: '0',
  height: '0',
  margin: '0',
  padding: '0',
  overflow: 'visible',
  'z-index': '2147483647',
  display: 'block',
  visibility: 'visible',
  opacity: '1',
  transform: 'none',
  translate: 'none',
  rotate: 'none',
  scale: 'none',
  filter: 'none',
  contain: 'none',
  'clip-path': 'none',
  'pointer-events': 'auto',
};

const TOOL_SHORTCUTS: Partial<Record<ShortcutAction, ToolType>> = {
  'tool-select': 'select',
  'tool-pen': 'pen',
  'tool-highlighter': 'highlighter',
  'tool-rect': 'rect',
  'tool-circle': 'circle',
  'tool-line': 'line',
  'tool-arrow': 'arrow',
  'tool-double-arrow': 'double-arrow',
  'tool-text': 'text',
  'tool-eraser': 'eraser',
};

type NavigationTarget = Window & { navigation?: EventTarget };

/** The drawing app. The boot content script injects it only once a page has drawings or the user opens the toolbar. */
export default defineUnlistedScript({
  main() {
    document.dispatchEvent(new CustomEvent(TAKEOVER_EVENT));
    document.querySelectorAll<HTMLElement>(`#${HOST_ID}`).forEach((stale) => {
      // Older builds re-attach their host unless it is flagged as destroyed.
      stale.dataset.destroyed = 'true';
      stale.remove();
    });

    const lifetime = new AbortController();
    const { signal } = lifetime;
    let torn = false;

    let settings: ExtensionSettings = { ...DEFAULT_SETTINGS };
    let currentLoadedUrl = window.location.href;
    let currentPageKey = getPageStorageKey(currentLoadedUrl, settings.urlMatchMode);
    let saveTimeout: number | null = null;
    let saveErrorVisible = false;

    /** True once this page's stored drawings were read; saving earlier could overwrite them with an empty canvas. */
    let loaded = false;
    let hasLoadedOnce = false;
    let loadInFlight = false;
    /** Unsaved local edits exist; only a dirty tab writes, so idle tabs never clobber another tab's work. */
    let dirty = false;
    let editVersion = 0;
    let saveInFlight = 0;
    /** The stored version this tab's drawings derive from; saves merge against it so other tabs' edits survive. */
    let syncBase: SyncBase = { elements: [], stamp: null };
    /** Another tab changed this page while this tab was busy; fold it in on the next sync. */
    let pendingRemote = false;
    let syncChain: Promise<void> = Promise.resolve();
    let navToken = 0;
    let navigatingTo: string | null = null;

    // Built only once the page has drawings or the user opens the toolbar, so pages without drawings pay almost nothing.
    let mounted = false;
    let host!: HTMLElement;
    let uiContainer!: HTMLElement;
    let hostObserver: MutationObserver | null = null;
    let history!: HistoryManager;
    let textEditor!: TextEditorOverlay;
    let engine!: CanvasEngine;
    let toolbar!: FloatingToolbar;

    const setLoadedUrl = (url: string) => {
      currentLoadedUrl = url;
      currentPageKey = getPageStorageKey(url, settings.urlMatchMode);
    };

    const ensureHostAttached = () => {
      if (!mounted || host.dataset.destroyed === 'true') return;
      if (!host.isConnected) {
        const root = document.documentElement || document.body;
        if (root) root.appendChild(host);
      }
    };

    const showSaveError = (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error ?? '');
      console.warn('[Page Anchor] could not save drawings:', error);
      if (saveErrorVisible) return;
      saveErrorVisible = true;

      const isQuota = /quota|QUOTA_BYTES/i.test(message);
      const toast = document.createElement('div');
      toast.className = 'pa-save-error';
      toast.setAttribute('role', 'status');
      toast.setAttribute('aria-live', 'polite');
      toast.textContent = isQuota
        ? 'Page Anchor could not save: browser storage is full. Free space in Settings → Saved pages.'
        : 'Page Anchor could not save your drawings. Try reloading the page.';
      Object.assign(toast.style, {
        position: 'fixed',
        bottom: '16px',
        right: '16px',
        zIndex: '2147483647',
        maxWidth: '320px',
        padding: '10px 14px',
        borderRadius: '10px',
        background: 'rgba(120, 24, 32, 0.96)',
        color: '#fff',
        font: '600 12px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        boxShadow: '0 10px 30px -12px rgba(0, 0, 0, 0.8)',
        pointerEvents: 'none',
      });
      uiContainer.appendChild(toast);

      window.setTimeout(() => {
        toast.remove();
        saveErrorVisible = false;
      }, 8000);
    };

    const handleSaveError = (error: unknown) => {
      // An updated or reloaded extension orphans this script; a newer copy owns the page now.
      if (!isExtensionContextValid()) {
        teardown();
        return;
      }
      showSaveError(error);
    };

    const applyPageData = (elements: AnchorElement[], domAnchoringEnabled: boolean | undefined) => {
      const isAnchoring = domAnchoringEnabled ?? settings.domAnchoringEnabled ?? true;
      engine.setDomAnchoringEnabled(isAnchoring);
      toolbar.updateDomAnchoringUI(isAnchoring);
      history.reset(elements);
      engine.setElements(elements);
      toolbar.updateBadge();
      toolbar.updateHistoryButtons();
    };

    const showStored = (data: PageAnchorData | null) => {
      applyPageData(data?.elements ?? [], data?.domAnchoringEnabled);
      syncBase = { elements: engine.getElements(), stamp: data?.updatedAt ?? null };
    };

    /** Pushes local edits, or with nothing to push, folds in another tab's save; both go through the same merge. */
    const syncWithStorage = async (forceWrite: boolean) => {
      const version = editVersion;
      const local = engine.getElements();
      const result = await savePageData(
        currentLoadedUrl,
        local,
        document.title,
        engine.getDomAnchoringEnabled(),
        syncBase,
        !dirty
      );
      const stamp = result.data?.updatedAt ?? null;
      if (!result.mergedRemote) {
        syncBase = { elements: local, stamp };
        if (version === editVersion) dirty = false;
      } else if (version === editVersion && (forceWrite || !engine.isInteracting())) {
        showStored(result.data);
        dirty = false;
      } else {
        // Newer local edits arrived during the save; the next sync merges them against the old base.
        pendingRemote = true;
        scheduleSave(REMOTE_SYNC_DELAY_MS);
      }
    };

    const syncOnce = async (forceWrite: boolean) => {
      if (saveTimeout !== null) {
        clearTimeout(saveTimeout);
        saveTimeout = null;
      }
      if (!mounted || !loaded || torn || (!dirty && !pendingRemote)) return;

      const hadPendingRemote = pendingRemote;
      pendingRemote = false;
      saveInFlight++;
      try {
        await syncWithStorage(forceWrite);
        if (!torn) toolbar.updateBadge();
      } catch (error) {
        pendingRemote = pendingRemote || hadPendingRemote;
        handleSaveError(error);
      } finally {
        saveInFlight--;
      }
    };

    /** Serialized so overlapping saves never merge against a base the other one is about to replace. */
    const persist = (forceWrite = false): Promise<void> => {
      syncChain = syncChain.then(() => syncOnce(forceWrite));
      return syncChain;
    };

    const scheduleSave = (delay = SAVE_DEBOUNCE_MS) => {
      if (saveTimeout !== null) clearTimeout(saveTimeout);
      saveTimeout = window.setTimeout(() => {
        saveTimeout = null;
        void persist();
      }, delay);
    };

    const markDirty = () => {
      if (torn) return;
      dirty = true;
      editVersion++;
      if (!loaded) {
        // A failed initial read is retried on the first edit; the load merges the edit and then saves.
        if (!loadInFlight) void loadPage(window.location.href);
        return;
      }
      scheduleSave();
    };

    const applySettings = (next: ExtensionSettings) => {
      settings = next;
      setLoadedUrl(currentLoadedUrl);
      shortcutManager.setShortcuts(next.shortcuts);
      if (!mounted) return;
      toolbar.setSettings(next);
      engine.setOrphanedAnchorMode(next.orphanedAnchorMode);
      engine.setStrokeSimplification(next.strokeSimplification);
    };

    function mount(): void {
      if (mounted || torn) return;
      mounted = true;

      host = document.createElement('div');
      host.id = HOST_ID;
      host.dataset.paMounted = 'true';
      for (const [property, value] of Object.entries(HOST_STYLES)) {
        host.style.setProperty(property, value, 'important');
      }
      const shadowRoot = host.attachShadow({ mode: 'open' });
      const styleSheet = document.createElement('style');
      styleSheet.textContent = SHADOW_STYLES;
      shadowRoot.appendChild(styleSheet);
      uiContainer = document.createElement('div');
      uiContainer.className = 'page-anchor-ui-root';
      shadowRoot.appendChild(uiContainer);
      ensureHostAttached();

      if (typeof MutationObserver !== 'undefined' && document.documentElement) {
        hostObserver = new MutationObserver(() => {
          if (host.dataset.destroyed === 'true') {
            hostObserver?.disconnect();
            return;
          }
          if (!host.isConnected) ensureHostAttached();
        });
        hostObserver.observe(document.documentElement, { childList: true });
      }

      history = new HistoryManager([]);
      textEditor = new TextEditorOverlay(uiContainer);

      engine = new CanvasEngine(uiContainer, {
        onElementsChange: (elements) => {
          history.pushState(elements);
          toolbar.updateHistoryButtons();
          toolbar.updateBadge();
          markDirty();
        },
        onSelectionChange: () => toolbar?.refreshColorControls(),
        onTextCreateRequested: (pt) => {
          // A click away from an open note only saves it; a second click starts the next one.
          if (textEditor.isOpen()) return;
          textEditor.open(
            pt,
            {
              fontSize: settings.defaultFontSize,
              fontColor: settings.defaultStrokeColor,
            },
            (textEl) => {
              engine.addElement(textEl);
            }
          );
        },
      });

      toolbar = new FloatingToolbar(uiContainer, engine, history, textEditor, settings, {
        onToggleActive: () => {
          ensureHostAttached();
        },
        onClear: () => {
          markDirty();
        },
        onToggleDomAnchoring: () => {
          markDirty();
        },
        onSettingsUpdate: (newSettings) => {
          settings = newSettings;
          shortcutManager.setShortcuts(settings.shortcuts);
          engine.setOrphanedAnchorMode(settings.orphanedAnchorMode);
          engine.setStrokeSimplification(settings.strokeSimplification);
        },
        onOpenOptions: () => {
          try {
            const sent = getExtensionApi()?.runtime.sendMessage({ type: 'PAGE_ANCHOR_OPEN_OPTIONS' });
            if (sent && typeof sent.catch === 'function') sent.catch(() => {});
          } catch {
            // The background may be asleep; the options page stays reachable
            // through the browser's extension management UI either way.
          }
        },
      });
      applySettings(settings);

      // Backspace stays a fixed convenience key for deleting the selection.
      // The configurable Delete key is dispatched by ShortcutManager ('action-delete').
      window.addEventListener(
        'keydown',
        (e) => {
          if (!engine.getActiveMode()) return;
          if (e.key !== 'Backspace') return;
          if (isEditableTarget(e)) return;
          engine.deleteSelected();
        },
        { signal }
      );
    }

    /** The user asked for the toolbar on a page that had no drawings yet, so build the UI now. */
    const mountForUser = () => {
      if (mounted) return;
      mount();
      if (!loaded && !loadInFlight) void loadPage(currentLoadedUrl);
    };

    async function loadPage(url: string, preloaded?: PageAnchorData | null): Promise<void> {
      const token = ++navToken;
      loadInFlight = true;
      try {
        const saved = preloaded !== undefined ? preloaded : await loadPageData(url);
        if (token !== navToken || torn) return;

        let elements = saved?.elements ?? [];
        // Only edits made before the very first read are merged; mid-navigation edits belong to the previous page.
        const keepLocalEdits = !hasLoadedOnce && dirty;
        if (keepLocalEdits) {
          const local = engine.getElements();
          const localIds = new Set(local.map((el) => el.id));
          elements = [...elements.filter((el) => !localIds.has(el.id)), ...local];
        }

        setLoadedUrl(url);
        applyPageData(elements, saved?.domAnchoringEnabled);
        syncBase = { elements: keepLocalEdits ? (saved?.elements ?? []) : engine.getElements(), stamp: saved?.updatedAt ?? null };
        pendingRemote = false;
        loaded = true;
        hasLoadedOnce = true;
        dirty = keepLocalEdits;
        if (keepLocalEdits) scheduleSave();
        // The URL can change again while this read is in flight; that navigation saw the old URL as current and bailed, so follow it now.
        if (window.location.href !== url) void handleUrlChange();
      } catch {
        // Stay unloaded so nothing is written over drawings this tab could not read.
      } finally {
        if (token === navToken) loadInFlight = false;
      }
    }

    /** While dormant, checks whether `url` has saved drawings and only then builds the UI to show them. */
    async function probe(url: string): Promise<void> {
      const token = ++navToken;
      let saved: PageAnchorData | null;
      try {
        saved = await loadPageData(url);
      } catch {
        return;
      }
      if (token !== navToken || torn || mounted) return;
      if (window.location.href !== url) {
        void handleUrlChange();
        return;
      }
      if (!saved || saved.elements.length === 0) return;
      mount();
      await loadPage(url, saved);
    }

    const handleUrlChange = async () => {
      if (torn) return;
      const newUrl = window.location.href;
      if (!mounted) {
        if (newUrl === currentLoadedUrl) return;
        setLoadedUrl(newUrl);
        await probe(newUrl);
        return;
      }
      if (newUrl === currentLoadedUrl || newUrl === navigatingTo) return;

      // Same page under the current match mode (e.g. a #section jump): keep drawings and undo history.
      if (loaded && normalizeUrl(newUrl, settings.urlMatchMode) === normalizeUrl(currentLoadedUrl, settings.urlMatchMode)) {
        setLoadedUrl(newUrl);
        return;
      }

      navigatingTo = newUrl;
      try {
        ensureHostAttached();
        if (loaded) await persist(true);
        if (torn || window.location.href !== newUrl) return;
        loaded = false;
        dirty = false;
        await loadPage(newUrl);
      } finally {
        if (navigatingTo === newUrl) navigatingTo = null;
      }
    };

    const flushIfDirty = () => {
      if (dirty) void persist(true);
    };

    window.addEventListener('beforeunload', flushIfDirty, { signal });
    window.addEventListener('pagehide', flushIfDirty, { signal });
    window.addEventListener('popstate', () => void handleUrlChange(), { signal });
    window.addEventListener('hashchange', () => void handleUrlChange(), { signal });

    // Fires after the URL commits, including for history.pushState calls made by the page's own scripts.
    const navigation = (window as NavigationTarget).navigation;
    navigation?.addEventListener?.('currententrychange', () => void handleUrlChange(), { signal });
    navigation?.addEventListener?.('navigatesuccess', () => void handleUrlChange(), { signal });

    document.addEventListener(
      'visibilitychange',
      () => {
        if (document.visibilityState === 'hidden') {
          flushIfDirty();
        } else if (window.location.href !== currentLoadedUrl) {
          void handleUrlChange();
        }
      },
      { signal }
    );

    const onStorageChanged = async (keys: string[]) => {
      if (torn) return;
      if (keys.includes(SETTINGS_STORAGE_KEY)) {
        const next = await loadSettings();
        if (torn) return;
        if (JSON.stringify(next) !== JSON.stringify(settings)) {
          const modeChanged = next.urlMatchMode !== settings.urlMatchMode;
          applySettings(next);
          if (modeChanged && !mounted) {
            await probe(currentLoadedUrl);
            return;
          }
          if (modeChanged && loaded && !dirty && saveInFlight === 0) {
            void loadPage(currentLoadedUrl);
            return;
          }
        }
      }
      if (!keys.includes(currentPageKey)) return;
      if (!mounted) {
        await probe(currentLoadedUrl);
      } else if (loaded) {
        pendingRemote = true;
        scheduleSave(REMOTE_SYNC_DELAY_MS);
      }
    };

    const onMessage = (msg: unknown, _sender: unknown, sendResponse: (response?: unknown) => void): boolean => {
      const rawType = (msg as { type?: unknown } | null)?.type;
      const type = typeof rawType === 'string' ? rawType : '';
      if (!HANDLED_MESSAGE_TYPES.has(type) || torn) return false;

      ensureHostAttached();

      switch (type) {
        case 'PAGE_ANCHOR_TOGGLE':
          mountForUser();
          toolbar.toggleDrawingMode();
          sendResponse({ active: engine.getActiveMode(), count: engine.getElements().length });
          break;
        case 'PAGE_ANCHOR_GET_STATUS':
          sendResponse({
            active: mounted && engine.getActiveMode(),
            count: mounted ? engine.getElements().length : 0,
            url: currentLoadedUrl,
            title: document.title,
          });
          break;
        case 'PAGE_ANCHOR_CLEAR':
          if (mounted) toolbar.clearPageWithToast();
          sendResponse({ success: true });
          break;
        case 'PAGE_ANCHOR_URL_CHANGED':
          void handleUrlChange();
          sendResponse({ success: true });
          break;
        case STORAGE_CHANGED_MESSAGE: {
          const keys = (msg as { keys?: unknown }).keys;
          if (Array.isArray(keys)) void onStorageChanged(keys.filter((k): k is string => typeof k === 'string'));
          break;
        }
      }
      // Every response above is sent synchronously, so the channel can close.
      return false;
    };

    const shortcutManager = new ShortcutManager(settings.shortcuts, () => mounted && engine.getActiveMode());
    shortcutManager.addListener((action) => {
      mountForUser();
      ensureHostAttached();
      handleShortcutAction(action);
    });
    shortcutManager.attach();

    const api = getExtensionApi();
    const runtimeEvents = api?.runtime?.onMessage;
    runtimeEvents?.addListener(onMessage);

    function teardown(): void {
      if (torn) return;
      torn = true;
      if (saveTimeout !== null) clearTimeout(saveTimeout);
      lifetime.abort();
      const safely = (fn: () => void) => {
        try {
          fn();
        } catch {}
      };
      safely(() => shortcutManager.detach());
      safely(() => runtimeEvents?.removeListener(onMessage));
      if (!mounted) return;
      host.dataset.destroyed = 'true';
      hostObserver?.disconnect();
      safely(() => textEditor.close());
      safely(() => toolbar.destroy());
      safely(() => engine.destroy());
      host.remove();
    }

    document.addEventListener(TAKEOVER_EVENT, teardown, { signal });

    const handoff = takeBootHandoff();
    if (handoff?.openToolbar) {
      mountForUser();
      toolbar.toggleDrawingMode();
    }

    void (async () => {
      const loadedSettings = await loadSettings();
      if (torn) return;
      applySettings(loadedSettings);
      if (mounted || navToken !== 0) return;
      if (handoff?.data?.elements.length) {
        mount();
        await loadPage(window.location.href, handoff.data);
      } else {
        await probe(window.location.href);
      }
    })();

    function handleShortcutAction(action: ShortcutAction): void {
      const tool = TOOL_SHORTCUTS[action];
      if (tool) {
        toolbar.setDrawingMode(true);
        engine.setTool(tool);
        toolbar.updateActiveToolUI();
        return;
      }

      switch (action) {
        case 'toggle-active':
        case 'action-toggle-toolbar':
          toolbar.toggleDrawingMode();
          break;
        case 'action-select-all':
          toolbar.setDrawingMode(true);
          engine.selectAll();
          toolbar.updateActiveToolUI();
          break;
        case 'action-undo':
          toolbar.undo();
          break;
        case 'action-redo':
          toolbar.redo();
          break;
        case 'action-delete':
          engine.deleteSelected();
          break;
        case 'action-clear':
          toolbar.clearPageWithToast();
          break;
      }
    }
  },
});
