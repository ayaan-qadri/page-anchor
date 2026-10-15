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

  // Load user settings for shortcut hint
  const settings = await loadSettings();
  const toggleKey = settings.shortcuts['toggle-active'] || 'Alt+D';
  if (hintEl) {
    hintEl.textContent = formatShortcutForDisplay(toggleKey);
  }

  // Open Options page
  optionsBtn?.addEventListener('click', () => {
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      window.open(chrome.runtime.getURL('options.html'));
    }
  });

  // Query active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id === undefined) {
    pageTitleEl.textContent = 'No active webpage';
    toggleSwitch.disabled = true;
    return;
  }

  const tabId = tab.id;
  pageTitleEl.textContent = tab.title || tab.url || 'Webpage';

  // Request status from content script
  try {
    const res = await chrome.tabs.sendMessage(tabId, { type: 'PAGE_ANCHOR_GET_STATUS' });
    if (res) {
      toggleSwitch.checked = !!res.active;
      countEl.textContent = `${res.count || 0} annotation${res.count === 1 ? '' : 's'} on page`;
    }
  } catch {
    countEl.textContent = 'Anchor ready to activate';
  }

  // Handle draw mode switch
  toggleSwitch.addEventListener('change', async () => {
    try {
      const res = await chrome.tabs.sendMessage(tabId, { type: 'PAGE_ANCHOR_TOGGLE' });
      toggleSwitch.checked = !!res?.active;
      if (res?.count !== undefined) {
        countEl.textContent = `${res.count} annotation${res.count === 1 ? '' : 's'} on page`;
      }
    } catch {
      // Content script might need refresh
      countEl.textContent = 'Please refresh the webpage';
    }
  });

  // Handle Export
  exportBtn.addEventListener('click', async () => {
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'PAGE_ANCHOR_EXPORT' });
      window.close();
    } catch {
      alert('Could not export. Please ensure the page allows extension scripts.');
    }
  });

  // Handle Clear
  clearBtn.addEventListener('click', async () => {
    if (confirm('Are you sure you want to clear all annotations on this page?')) {
      try {
        await chrome.tabs.sendMessage(tabId, { type: 'PAGE_ANCHOR_CLEAR' });
        countEl.textContent = '0 annotations on page';
      } catch {
        alert('Could not clear annotations.');
      }
    }
  });
}

document.addEventListener('DOMContentLoaded', initPopup);
