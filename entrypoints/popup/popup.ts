import { browser } from 'wxt/browser';
import { loadSettings } from '../../src/core/storage';
import { formatShortcutForDisplay } from '../../src/core/shortcuts';

async function initPopup() {
  const toggleSwitch = document.getElementById('toggle-draw-mode') as HTMLInputElement;
  const pageTitleEl = document.getElementById('page-title') as HTMLElement;
  const countEl = document.getElementById('annotation-count') as HTMLElement;
  const exportBtn = document.getElementById('btn-export') as HTMLButtonElement;
  const clearBtn = document.getElementById('btn-clear') as HTMLButtonElement;
  const optionsBtn = document.getElementById('btn-options') as HTMLButtonElement;
  const hintEl = document.getElementById('quick-shortcut-hint') as HTMLElement;

  const ext = typeof browser !== 'undefined' ? browser : (typeof chrome !== 'undefined' ? chrome : null);
  if (!ext) return;

  const settings = await loadSettings();
  const toggleKey = settings.shortcuts['toggle-active'] || 'Alt+Shift+D';
  if (hintEl) {
    hintEl.textContent = formatShortcutForDisplay(toggleKey);
  }

  optionsBtn?.addEventListener('click', () => {
    if (ext.runtime?.openOptionsPage) {
      ext.runtime.openOptionsPage();
    } else if ((ext.runtime as any)?.getURL) {
      window.open((ext.runtime as any).getURL('options.html'));
    }
  });

  const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id === undefined) {
    pageTitleEl.textContent = 'No active webpage';
    toggleSwitch.disabled = true;
    return;
  }

  const tabId = tab.id;
  pageTitleEl.textContent = tab.title || tab.url || 'Webpage';

  const announcer = document.getElementById('popup-announcer');
  const announce = (msg: string) => {
    if (announcer) {
      announcer.textContent = '';
      requestAnimationFrame(() => {
        announcer.textContent = msg;
      });
    }
  };

  try {
    const res = await ext.tabs.sendMessage(tabId, { type: 'PAGE_ANCHOR_GET_STATUS' }) as any;
    if (res) {
      toggleSwitch.checked = !!res.active;
      countEl.textContent = `${res.count || 0} annotation${res.count === 1 ? '' : 's'} on page`;
    }
  } catch {
    countEl.textContent = 'Anchor ready to activate';
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
      countEl.textContent = 'Please refresh the webpage';
      announce('Could not connect to webpage. Please refresh.');
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
