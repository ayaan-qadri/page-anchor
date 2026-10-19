import { defineContentScript } from 'wxt/utils/define-content-script';
import { CanvasEngine } from '../src/core/engine';
import { HistoryManager } from '../src/core/history';
import { ShortcutManager, isEditableTarget } from '../src/core/shortcuts';
import { clearPageData, loadPageData, loadSettings, savePageData, DEFAULT_SETTINGS } from '../src/core/storage';
import { AnchorElement, ExtensionSettings } from '../src/types';
import { SHADOW_STYLES } from '../src/ui/styles';
import { TextEditorOverlay } from '../src/ui/text-editor';
import { FloatingToolbar } from '../src/ui/toolbar';

/** Messages this content script acts on; anything else is ignored. */
const HANDLED_MESSAGE_TYPES = new Set([
  'PAGE_ANCHOR_TOGGLE',
  'PAGE_ANCHOR_GET_STATUS',
  'PAGE_ANCHOR_CLEAR',
  'PAGE_ANCHOR_URL_CHANGED',
]);

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_end',
  main() {
    const existing = document.getElementById('page-anchor-host');
    if (existing && existing.dataset.paMounted === 'true') return;

    const host = document.createElement('div');
    host.id = 'page-anchor-host';
    host.dataset.paMounted = 'true';
    host.style.position = 'absolute';
    host.style.top = '0';
    host.style.left = '0';
    host.style.width = '0';
    host.style.height = '0';
    host.style.overflow = 'visible';
    host.style.zIndex = '2147483647';

    const shadowRoot = host.attachShadow({ mode: 'open' });

    const styleSheet = document.createElement('style');
    styleSheet.textContent = SHADOW_STYLES;
    shadowRoot.appendChild(styleSheet);

    const uiContainer = document.createElement('div');
    uiContainer.className = 'page-anchor-ui-root';
    shadowRoot.appendChild(uiContainer);

    const ensureHostAttached = () => {
      if (host.dataset.destroyed === 'true') return;
      if (!host.isConnected) {
        const root = document.documentElement || document.body;
        if (root) root.appendChild(host);
      }
    };

    ensureHostAttached();

    if (typeof MutationObserver !== 'undefined' && document.documentElement) {
      const observer = new MutationObserver(() => {
        if (host.dataset.destroyed === 'true') {
          observer.disconnect();
          return;
        }
        if (!host.isConnected) {
          ensureHostAttached();
        }
      });
      observer.observe(document.documentElement, { childList: true });
    }

    let settings: ExtensionSettings = { ...DEFAULT_SETTINGS };
    let currentLoadedUrl = window.location.href;
    let saveTimeout: number | null = null;
    let saveErrorVisible = false;

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

    const triggerSave = (elements: AnchorElement[]) => {
      if (saveTimeout) clearTimeout(saveTimeout);
      const url = currentLoadedUrl;
      saveTimeout = window.setTimeout(async () => {
        try {
          await savePageData(url, elements, document.title, engine.getDomAnchoringEnabled());
          toolbar?.updateBadge();
        } catch (error) {
          showSaveError(error);
        }
      }, 250);
    };

    const flushSave = async () => {
      if (engine && currentLoadedUrl) {
        try {
          await savePageData(currentLoadedUrl, engine.getElements(), document.title, engine.getDomAnchoringEnabled());
        } catch (error) {
          showSaveError(error);
        }
      }
    };

    const history = new HistoryManager([]);
    const textEditor = new TextEditorOverlay(uiContainer);

    const engine = new CanvasEngine(uiContainer, {
      onElementsChange: (elements) => {
        history.pushState(elements);
        toolbar.updateHistoryButtons();
        toolbar.updateBadge();
        triggerSave(elements);
      },
      onTextCreateRequested: (pt) => {
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

    const toolbar = new FloatingToolbar(
      uiContainer,
      engine,
      history,
      textEditor,
      settings,
      {
        onToggleActive: () => {
          ensureHostAttached();
        },
        onClear: () => {
          triggerSave(engine.getElements());
        },
        onToggleDomAnchoring: () => {
          triggerSave(engine.getElements());
        },
        onSettingsUpdate: (newSettings) => {
          settings = newSettings;
          shortcutManager.setShortcuts(settings.shortcuts);
          engine.setOrphanedAnchorMode(settings.orphanedAnchorMode);
          engine.setStrokeSimplification(settings.strokeSimplification);
        },
      }
    );

    const shortcutManager = new ShortcutManager(settings.shortcuts, () => engine.getActiveMode());
    shortcutManager.addListener((action) => {
      ensureHostAttached();
      handleShortcutAction(action);
    });
    shortcutManager.attach();

    // Backspace stays a fixed convenience key for deleting the selection.
    // The configurable Delete key is dispatched by ShortcutManager ('action-delete').
    window.addEventListener('keydown', (e) => {
      if (!engine.getActiveMode()) return;
      if (e.key !== 'Backspace') return;
      if (isEditableTarget(e)) return;
      engine.deleteSelected();
    });

    let navToken = 0;

    const handleUrlChange = async () => {
      const newUrl = window.location.href;
      if (newUrl === currentLoadedUrl) return;

      const token = ++navToken;
      const prevUrl = currentLoadedUrl;

      ensureHostAttached();

      if (engine && prevUrl) {
        try {
          await savePageData(prevUrl, engine.getElements(), document.title, engine.getDomAnchoringEnabled());
        } catch (error) {
          showSaveError(error);
        }
      }

      if (token !== navToken) return;

      try {
        const saved = await loadPageData(newUrl);
        if (token !== navToken) return;

        const newElements = saved?.elements || [];
        const isAnchoring = saved?.domAnchoringEnabled !== undefined
          ? saved.domAnchoringEnabled
          : (settings.domAnchoringEnabled ?? true);
        currentLoadedUrl = newUrl;
        engine.setDomAnchoringEnabled(isAnchoring);
        toolbar.updateDomAnchoringUI(isAnchoring);

        history.reset(newElements);
        engine.setElements(newElements);
        toolbar.updateBadge();
        toolbar.updateHistoryButtons();
      } catch {}
    };

    window.addEventListener('beforeunload', () => {
      flushSave();
    });
    window.addEventListener('pagehide', () => {
      flushSave();
    });
    window.addEventListener('popstate', () => {
      handleUrlChange();
    });
    window.addEventListener('hashchange', () => {
      handleUrlChange();
    });

    const origPush = window.history.pushState;
    window.history.pushState = function (data: any, unused: string, url?: string | URL | null) {
      const res = origPush.call(this, data, unused, url);
      handleUrlChange();
      return res;
    };

    const origReplace = window.history.replaceState;
    window.history.replaceState = function (data: any, unused: string, url?: string | URL | null) {
      const res = origReplace.call(this, data, unused, url);
      handleUrlChange();
      return res;
    };

    // Catches URL changes the patched history methods miss, event-driven rather
    // than polled so an idle page costs no main-thread time.
    const navigation = (window as any).navigation;
    navigation?.addEventListener?.('navigate', () => {
      handleUrlChange();
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && window.location.href !== currentLoadedUrl) {
        handleUrlChange();
      }
    });

    const runtime = typeof browser !== 'undefined' ? browser.runtime : (typeof chrome !== 'undefined' ? chrome.runtime : null);
    runtime?.onMessage?.addListener((msg: any, _sender: any, sendResponse: (r?: any) => void) => {
      const type = typeof msg?.type === 'string' ? msg.type : '';
      if (!HANDLED_MESSAGE_TYPES.has(type)) {
        // Not one of ours: don't hold the response channel open.
        return false;
      }

      ensureHostAttached();

      switch (type) {
        case 'PAGE_ANCHOR_TOGGLE':
          toolbar.toggleDrawingMode(true);
          sendResponse({ active: engine.getActiveMode(), count: engine.getElements().length });
          break;
        case 'PAGE_ANCHOR_GET_STATUS':
          sendResponse({
            active: engine.getActiveMode(),
            count: engine.getElements().length,
            url: currentLoadedUrl,
            title: document.title,
          });
          break;
        case 'PAGE_ANCHOR_CLEAR':
          history.pushState([]);
          engine.clear();
          clearPageData(currentLoadedUrl).catch(() => {});
          toolbar.updateBadge();
          toolbar.updateHistoryButtons();
          sendResponse({ success: true });
          break;
        case 'PAGE_ANCHOR_URL_CHANGED':
          handleUrlChange();
          sendResponse({ success: true });
          break;
      }
      return true;
    });

    (async () => {
      try {
        const loadedSettings = await loadSettings();
        if (loadedSettings) {
          settings = loadedSettings;
          toolbar.setSettings(settings);
          shortcutManager.setShortcuts(settings.shortcuts);
          engine.setOrphanedAnchorMode(settings.orphanedAnchorMode);
          engine.setStrokeSimplification(settings.strokeSimplification);
        }
      } catch {}

      try {
        const saved = await loadPageData(window.location.href);
        const initialElements = saved?.elements || [];
        const isAnchoring = saved?.domAnchoringEnabled !== undefined
          ? saved.domAnchoringEnabled
          : (settings.domAnchoringEnabled ?? true);
        engine.setDomAnchoringEnabled(isAnchoring);
        toolbar.updateDomAnchoringUI(isAnchoring);

        history.reset(initialElements);
        engine.setElements(initialElements);
        toolbar.updateBadge();
        toolbar.updateHistoryButtons();
      } catch {}
    })();

    function handleShortcutAction(action: string): void {
      switch (action) {
        case 'toggle-active':
          toolbar.toggleDrawingMode();
          break;
        case 'action-toggle-toolbar':
          toolbar.toggleToolbarVisibility();
          break;
        case 'tool-select':
          toolbar.setDrawingMode(true);
          engine.setTool('select');
          toolbar.updateActiveToolUI();
          break;
        case 'action-select-all':
          toolbar.setDrawingMode(true);
          engine.selectAll();
          toolbar.updateActiveToolUI();
          break;
        case 'tool-pen':
          toolbar.setDrawingMode(true);
          engine.setTool('pen');
          toolbar.updateActiveToolUI();
          break;
        case 'tool-highlighter':
          toolbar.setDrawingMode(true);
          engine.setTool('highlighter');
          toolbar.updateActiveToolUI();
          break;
        case 'tool-rect':
          toolbar.setDrawingMode(true);
          engine.setTool('rect');
          toolbar.updateActiveToolUI();
          break;
        case 'tool-circle':
          toolbar.setDrawingMode(true);
          engine.setTool('circle');
          toolbar.updateActiveToolUI();
          break;
        case 'tool-line':
          toolbar.setDrawingMode(true);
          engine.setTool('line');
          toolbar.updateActiveToolUI();
          break;
        case 'tool-arrow':
          toolbar.setDrawingMode(true);
          engine.setTool('arrow');
          toolbar.updateActiveToolUI();
          break;
        case 'tool-double-arrow':
          toolbar.setDrawingMode(true);
          engine.setTool('double-arrow');
          toolbar.updateActiveToolUI();
          break;
        case 'tool-text':
          toolbar.setDrawingMode(true);
          engine.setTool('text');
          toolbar.updateActiveToolUI();
          break;
        case 'tool-eraser':
          toolbar.setDrawingMode(true);
          engine.setTool('eraser');
          toolbar.updateActiveToolUI();
          break;
        case 'action-undo': {
          const prev = history.undo();
          if (prev !== null) {
            engine.setElements(prev);
            toolbar.updateHistoryButtons();
            toolbar.updateBadge();
            triggerSave(prev);
          }
          break;
        }
        case 'action-redo': {
          const next = history.redo();
          if (next !== null) {
            engine.setElements(next);
            toolbar.updateHistoryButtons();
            toolbar.updateBadge();
            triggerSave(next);
          }
          break;
        }
        case 'action-delete': {
          engine.deleteSelected();
          break;
        }
        case 'action-clear': {
          if (confirm('Clear all drawings on this page?')) {
            history.pushState([]);
            engine.clear();
            toolbar.updateHistoryButtons();
            toolbar.updateBadge();
            triggerSave([]);
          }
          break;
        }
      }
    }
  },
});
