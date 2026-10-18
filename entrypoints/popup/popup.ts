import { browser } from 'wxt/browser';
import { loadSettings } from '../../src/core/storage';
import { formatShortcutForDisplay } from '../../src/core/shortcuts';
import { injectContentScript } from '../../src/core/inject';
import { PopupSettingsPanel } from './popup-settings';

export async function initPopup() {
  const toggleSwitch = document.getElementById('toggle-draw-mode') as HTMLInputElement;
  const pageTitleEl = document.getElementById('page-title') as HTMLElement;
  const countEl = document.getElementById('annotation-count') as HTMLElement;
  const exportBtn = document.getElementById('btn-export') as HTMLButtonElement;
  const clearBtn = document.getElementById('btn-clear') as HTMLButtonElement;
  const optionsBtn = document.getElementById('btn-options') as HTMLButtonElement;
  const backBtn = document.getElementById('btn-settings-back') as HTMLButtonElement | null;
  const fullSettingsBtn = document.getElementById('btn-open-full-settings') as HTMLButtonElement | null;
  const hintEl = document.getElementById('quick-shortcut-hint') as HTMLElement;
  const homeView = document.getElementById('view-home');
  const settingsView = document.getElementById('view-settings');
  const settingsRoot = document.getElementById('popup-settings-root');

  const announcer = document.getElementById('popup-announcer');
  const announce = (msg: string) => {
    if (announcer) {
      announcer.textContent = '';
      requestAnimationFrame(() => {
        announcer.textContent = msg;
      });
    }
  };

  const ext: any = typeof browser !== 'undefined' ? browser : (typeof chrome !== 'undefined' ? chrome : null);
  if (!ext) return;

  // Settings live inside the popup itself, so the gear never navigates away.
  let settingsPanel: PopupSettingsPanel | null = null;
  let settingsMounted = false;

  const openSettings = async () => {
    homeView?.classList.add('hidden');
    settingsView?.classList.remove('hidden');
    if (!settingsMounted && settingsRoot) {
      settingsMounted = true;
      settingsPanel = new PopupSettingsPanel(settingsRoot, announce);
      await settingsPanel.mount();
      announce('Settings opened');
    }
  };

  const closeSettings = () => {
    settingsPanel?.dispose();
    settingsView?.classList.add('hidden');
    homeView?.classList.remove('hidden');
  };

  const openFullSettingsPage = () => {
    if (ext.runtime?.openOptionsPage) {
      ext.runtime.openOptionsPage();
    } else if (ext.runtime?.getURL) {
      window.open(ext.runtime.getURL('options.html'));
    }
  };

  optionsBtn?.addEventListener('click', () => {
    void openSettings();
  });
  backBtn?.addEventListener('click', closeSettings);
  fullSettingsBtn?.addEventListener('click', openFullSettingsPage);

  const settings = await loadSettings();
  const toggleKey = settings.shortcuts['toggle-active'] || 'Alt+Shift+D';
  if (hintEl) {
    hintEl.textContent = formatShortcutForDisplay(toggleKey);
  }

  const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id === undefined) {
    pageTitleEl.textContent = 'No active webpage';
    toggleSwitch.disabled = true;
    return;
  }

  const tabId = tab.id;
  pageTitleEl.textContent = tab.title || tab.url || 'Webpage';

  async function injectIntoPage(): Promise<boolean> {
    return injectContentScript(ext, tabId);
  }

  try {    const res = await ext.tabs.sendMessage(tabId, { type: 'PAGE_ANCHOR_GET_STATUS' }) as any;
    if (res) {
      toggleSwitch.checked = !!res.active;
      countEl.textContent = `${res.count || 0} annotation${res.count === 1 ? '' : 's'} on page`;
    }
  } catch {
    const injected = await injectIntoPage();
    if (injected) {
      setTimeout(async () => {
        try {
          const res = await ext.tabs.sendMessage(tabId, { type: 'PAGE_ANCHOR_GET_STATUS' }) as any;
          if (res) {
            toggleSwitch.checked = !!res.active;
            countEl.textContent = `${res.count || 0} annotation${res.count === 1 ? '' : 's'} on page`;
          }
        } catch {
          countEl.textContent = 'Anchor ready to activate';
        }
      }, 120);
    } else {
      countEl.textContent = 'Anchor ready to activate';
    }
  }

  toggleSwitch.addEventListener('change', async () => {
    try {
      const res = await ext.tabs.sendMessage(tabId, { type: 'PAGE_ANCHOR_TOGGLE' }) as any;
      toggleSwitch.checked = !!res?.active;
      if (res?.count !== undefined) {
        countEl.textContent = `${res.count} annotation${res.count === 1 ? '' : 's'} on page`;
      }
      announce(res?.active ? 'Drawing toolbar enabled' : 'Drawing toolbar disabled');
    } catch {
      const injected = await injectIntoPage();
      if (injected) {
        setTimeout(async () => {
          try {
            const res = await ext.tabs.sendMessage(tabId, { type: 'PAGE_ANCHOR_TOGGLE' }) as any;
            toggleSwitch.checked = !!res?.active;
            if (res?.count !== undefined) {
              countEl.textContent = `${res.count} annotation${res.count === 1 ? '' : 's'} on page`;
            }
            announce(res?.active ? 'Drawing toolbar enabled' : 'Drawing toolbar disabled');
          } catch {
            countEl.textContent = 'Please refresh the webpage';
            announce('Could not connect to webpage. Please refresh.');
          }
        }, 120);
      } else {
        countEl.textContent = 'Please refresh the webpage';
        announce('Could not connect to webpage. Please refresh.');
      }
    }
  });

  exportBtn.addEventListener('click', async () => {
    try {
      await ext.tabs.sendMessage(tabId, { type: 'PAGE_ANCHOR_EXPORT' });
      announce('Drawing exported as PNG');
      window.close();
    } catch {
      alert('Could not export. Please ensure the page allows extension scripts.');
    }
  });

  clearBtn.addEventListener('click', async () => {
    if (confirm('Are you sure you want to clear all annotations on this page?')) {
      try {
        await ext.tabs.sendMessage(tabId, { type: 'PAGE_ANCHOR_CLEAR' });
        countEl.textContent = '0 annotations on page';
        announce('All annotations cleared');
      } catch {
        alert('Could not clear annotations.');
      }
    }
  });
}

document.addEventListener('DOMContentLoaded', initPopup);
