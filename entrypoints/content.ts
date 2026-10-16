import { defineContentScript } from 'wxt/utils/define-content-script';
import { CanvasEngine } from '../src/core/engine';
import { HistoryManager } from '../src/core/history';
import { ShortcutManager } from '../src/core/shortcuts';
import { clearPageData, loadPageData, loadSettings, savePageData, DEFAULT_SETTINGS } from '../src/core/storage';
import { AnchorElement, ExtensionSettings } from '../src/core/types';
import { SHADOW_STYLES } from '../src/ui/styles';
import { TextEditorOverlay } from '../src/ui/text-editor';
import { FloatingToolbar } from '../src/ui/toolbar';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_end',
  main() {
    const existing = document.getElementById('page-anchor-host');
    if (existing && existing.shadowRoot) return;

    const host = document.createElement('div');
    host.id = 'page-anchor-host';
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

    const triggerSave = (elements: AnchorElement[]) => {
      if (saveTimeout) clearTimeout(saveTimeout);
      saveTimeout = window.setTimeout(async () => {
        try {
          await savePageData(currentLoadedUrl, elements, document.title, engine.getDomAnchoringEnabled());
          toolbar?.updateBadge();
        } catch {}
      }, 250);
    };

    const flushSave = async () => {
      if (engine && currentLoadedUrl) {
        try {
          await savePageData(currentLoadedUrl, engine.getElements(), document.title, engine.getDomAnchoringEnabled());
        } catch {}
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
        onExport: () => {
          exportSnapshot();
        },
        onToggleDomAnchoring: () => {
          triggerSave(engine.getElements());
        },
        onSettingsUpdate: (newSettings) => {
          settings = newSettings;
          shortcutManager.setShortcuts(settings.shortcuts);
          engine.setOrphanedAnchorMode(settings.orphanedAnchorMode);
        },
      }
    );

    const shortcutManager = new ShortcutManager(settings.shortcuts, () => engine.getActiveMode());
    shortcutManager.addListener((action) => {
      ensureHostAttached();
      handleShortcutAction(action);
    });
    shortcutManager.attach();

    window.addEventListener('keydown', (e) => {
      if (!engine.getActiveMode()) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const target = e.target as HTMLElement | null;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
        engine.deleteSelected();
      }
    });

    const handleUrlChange = async () => {
      const newUrl = window.location.href;
      if (newUrl === currentLoadedUrl) return;

      ensureHostAttached();

      if (engine && currentLoadedUrl) {
        try {
          await savePageData(currentLoadedUrl, engine.getElements(), document.title, engine.getDomAnchoringEnabled());
        } catch {}
      }

      currentLoadedUrl = newUrl;

      try {
        const saved = await loadPageData(currentLoadedUrl);
        const newElements = saved?.elements || [];
        const isAnchoring = saved?.domAnchoringEnabled !== undefined
          ? saved.domAnchoringEnabled
          : (settings.domAnchoringEnabled ?? true);
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

    setInterval(() => {
      if (window.location.href !== currentLoadedUrl) {
        handleUrlChange();
      }
    }, 500);

    const runtime = typeof browser !== 'undefined' ? browser.runtime : (typeof chrome !== 'undefined' ? chrome.runtime : null);
    runtime?.onMessage?.addListener((msg: any, _sender: any, sendResponse: (r?: any) => void) => {
      ensureHostAttached();
      if (msg.type === 'PAGE_ANCHOR_TOGGLE') {
        toolbar.toggleDrawingMode(true);
        sendResponse({ active: engine.getActiveMode(), count: engine.getElements().length });
      } else if (msg.type === 'PAGE_ANCHOR_GET_STATUS') {
        sendResponse({
          active: engine.getActiveMode(),
          count: engine.getElements().length,
          url: currentLoadedUrl,
          title: document.title,
        });
      } else if (msg.type === 'PAGE_ANCHOR_CLEAR') {
        history.pushState([]);
        engine.clear();
        clearPageData(currentLoadedUrl).catch(() => {});
        toolbar.updateBadge();
        toolbar.updateHistoryButtons();
        sendResponse({ success: true });
      } else if (msg.type === 'PAGE_ANCHOR_EXPORT') {
        exportSnapshot();
        sendResponse({ success: true });
      } else if (msg.type === 'PAGE_ANCHOR_URL_CHANGED') {
        handleUrlChange();
        sendResponse({ success: true });
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
          if (settings.isToolbarOpen) {
            toolbar.setDrawingMode(true, false);
          }
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
          toolbar.toggleDrawingMode();
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
        case 'action-export': {
          exportSnapshot();
          break;
        }
      }
    }

    function exportSnapshot(): void {
      const dataUrl = engine.exportAsDataUrl();
      const a = document.createElement('a');
      const sanitizedTitle = (document.title || 'page-anchor').replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
      a.download = `page-anchor-${sanitizedTitle}-${Date.now()}.png`;
      a.href = dataUrl;
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
  },
});
