import {
  clearPageData,
  DEFAULT_SETTINGS,
  exportAllDataAsJson,
  getAllSavedPagesSummary,
  importDataFromJson,
  loadSettings,
  saveSettings,
} from '../../src/core/storage';
import { ExtensionSettings, ShortcutAction } from '../../src/core/types';
import {
  formatShortcutForDisplay,
  normalizeKeyEvent,
  SHORTCUT_DEFINITIONS,
  isReservedBrowserShortcut,
  getBrowserShortcutConflict,
} from '../../src/core/shortcuts';

let currentSettings: ExtensionSettings;
let recordingAction: ShortcutAction | null = null;
let recordingHandler: ((e: KeyboardEvent) => void) | null = null;

async function initOptions() {
  currentSettings = await loadSettings();

  setupTabs();
  renderShortcuts();
  setupDrawingForm();
  setupPersistenceForm();
  await renderSavedPages();
  setupBackupRestore();

  document.getElementById('btn-save')?.addEventListener('click', async () => {
    await saveCurrentSettings();
    showToast('Settings saved successfully!');
  });

  document.getElementById('btn-reset-shortcuts')?.addEventListener('click', () => {
    if (confirm('Reset all shortcuts to factory defaults?')) {
      currentSettings.shortcuts = { ...DEFAULT_SETTINGS.shortcuts };
      renderShortcuts();
    }
  });
}

function setupTabs() {
  const tabs = document.querySelectorAll('.pa-tab-btn');
  const panes = document.querySelectorAll('.pa-tab-pane');

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => t.classList.remove('active'));
      panes.forEach((p) => p.classList.remove('active'));

      tab.classList.add('active');
      const targetId = `tab-${tab.getAttribute('data-tab')}`;
      document.getElementById(targetId)?.classList.add('active');
    });
  });
}

function renderShortcuts() {
  const container = document.getElementById('shortcuts-container');
  if (!container) return;
  container.innerHTML = '';

  SHORTCUT_DEFINITIONS.forEach((def) => {
    const item = document.createElement('div');
    item.className = 'pa-shortcut-item';

    const info = document.createElement('div');
    info.className = 'pa-item-info';
    info.innerHTML = `
      <div class="pa-item-title">${def.name}</div>
      <div class="pa-item-desc">${def.description}</div>
    `;

    const keyVal = currentSettings.shortcuts[def.id] || def.defaultKey;
    const badge = document.createElement('button');
    badge.className = 'pa-key-badge';
    badge.textContent = formatShortcutForDisplay(keyVal);
    badge.title = 'Click to record new keystroke';

    badge.addEventListener('click', (e) => {
      e.stopPropagation();
      startRecordingShortcut(def.id, badge);
    });

    item.appendChild(info);
    item.appendChild(badge);
    container.appendChild(item);
  });
}

function startRecordingShortcut(actionId: ShortcutAction, btn: HTMLElement) {
  if (recordingHandler) {
    window.removeEventListener('keydown', recordingHandler, true);
  }

  recordingAction = actionId;
  btn.classList.add('recording');
  btn.textContent = 'Press keys...';

  recordingHandler = (e: KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const combo = normalizeKeyEvent(e);
    if (!combo) return;

    currentSettings.shortcuts[actionId] = combo;
    btn.textContent = formatShortcutForDisplay(combo);
    btn.classList.remove('recording');

    const conflict = getBrowserShortcutConflict(combo);
    if (conflict) {
      btn.style.borderColor = '#f59e0b';
      btn.style.color = '#fbbf24';
      btn.title = `Warning: "${combo}" conflicts with ${conflict.browser} (${conflict.action}). Key may be intercepted by the browser.`;
    } else {
      btn.style.borderColor = '';
      btn.style.color = '';
      btn.title = 'Click to record new keystroke';
    }

    if (recordingHandler) {
      window.removeEventListener('keydown', recordingHandler, true);
      recordingHandler = null;
    }
    recordingAction = null;
  };

  window.addEventListener('keydown', recordingHandler, true);
}

function setupDrawingForm() {
  const penColor = document.getElementById('pref-pen-color') as HTMLInputElement;
  const penColorText = document.getElementById('pref-pen-color-text') as HTMLElement;
  const penWidth = document.getElementById('pref-pen-width') as HTMLInputElement;
  const penWidthVal = document.getElementById('pref-pen-width-val') as HTMLElement;

  const highlighterColor = document.getElementById('pref-highlighter-color') as HTMLInputElement;
  const highlighterColorText = document.getElementById('pref-highlighter-color-text') as HTMLElement;
  const highlighterWidth = document.getElementById('pref-highlighter-width') as HTMLInputElement;
  const highlighterWidthVal = document.getElementById('pref-highlighter-width-val') as HTMLElement;

  const fontSize = document.getElementById('pref-font-size') as HTMLInputElement;
  const fontSizeVal = document.getElementById('pref-font-size-val') as HTMLElement;

  penColor.value = currentSettings.defaultStrokeColor;
  penColorText.textContent = currentSettings.defaultStrokeColor;
  penWidth.value = `${currentSettings.defaultStrokeWidth}`;
  penWidthVal.textContent = `${currentSettings.defaultStrokeWidth}px`;

  highlighterColor.value = currentSettings.defaultHighlighterColor;
  highlighterColorText.textContent = currentSettings.defaultHighlighterColor;
  highlighterWidth.value = `${currentSettings.defaultHighlighterWidth}`;
  highlighterWidthVal.textContent = `${currentSettings.defaultHighlighterWidth}px`;

  fontSize.value = `${currentSettings.defaultFontSize}`;
  fontSizeVal.textContent = `${currentSettings.defaultFontSize}px`;

  penColor.addEventListener('input', () => {
    penColorText.textContent = penColor.value;
    currentSettings.defaultStrokeColor = penColor.value;
  });

  penWidth.addEventListener('input', () => {
    penWidthVal.textContent = `${penWidth.value}px`;
    currentSettings.defaultStrokeWidth = parseInt(penWidth.value, 10);
  });

  highlighterColor.addEventListener('input', () => {
    highlighterColorText.textContent = highlighterColor.value;
    currentSettings.defaultHighlighterColor = highlighterColor.value;
  });

  highlighterWidth.addEventListener('input', () => {
    highlighterWidthVal.textContent = `${highlighterWidth.value}px`;
    currentSettings.defaultHighlighterWidth = parseInt(highlighterWidth.value, 10);
  });

  fontSize.addEventListener('input', () => {
    fontSizeVal.textContent = `${fontSize.value}px`;
    currentSettings.defaultFontSize = parseInt(fontSize.value, 10);
  });
}

function setupPersistenceForm() {
  const matchMode = document.getElementById('pref-url-match-mode') as HTMLSelectElement;
  const perfMode = document.getElementById('pref-performance-mode') as HTMLInputElement;
  const toolbarOpenMode = document.getElementById('pref-toolbar-open') as HTMLInputElement;
  const showPillMode = document.getElementById('pref-show-pill') as HTMLInputElement;

  matchMode.value = currentSettings.urlMatchMode;
  perfMode.checked = currentSettings.performanceMode;
  toolbarOpenMode.checked = !!currentSettings.isToolbarOpen;
  showPillMode.checked = currentSettings.showFloatingPill !== false;

  matchMode.addEventListener('change', () => {
    currentSettings.urlMatchMode = matchMode.value as 'clean' | 'exact' | 'domain';
  });

  perfMode.addEventListener('change', () => {
    currentSettings.performanceMode = perfMode.checked;
  });

  toolbarOpenMode.addEventListener('change', () => {
    currentSettings.isToolbarOpen = toolbarOpenMode.checked;
  });

  showPillMode.addEventListener('change', () => {
    currentSettings.showFloatingPill = showPillMode.checked;
  });
}

async function renderSavedPages() {
  const listContainer = document.getElementById('saved-pages-list');
  const countBadge = document.getElementById('saved-count');
  if (!listContainer) return;

  const pages = await getAllSavedPagesSummary();
  if (countBadge) countBadge.textContent = `${pages.length}`;

  if (pages.length === 0) {
    listContainer.innerHTML = `<div style="color: #64748b; font-size: 13px; padding: 10px 0;">No saved annotations yet. Draw on any web page to see it anchored here!</div>`;
    return;
  }

  listContainer.innerHTML = '';
  pages.forEach((page) => {
    const item = document.createElement('div');
    item.className = 'pa-saved-item';

    const info = document.createElement('div');
    info.className = 'pa-saved-info';

    const dateStr = new Date(page.updatedAt).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    info.innerHTML = `
      <div class="pa-saved-title">${escapeHtml(page.pageTitle || 'Untitled Page')}</div>
      <a href="${page.url}" target="_blank" class="pa-saved-url">${escapeHtml(page.url)}</a>
      <div class="pa-saved-meta">${page.elementCount} elements • Last updated ${dateStr}</div>
    `;

    const actions = document.createElement('div');
    actions.className = 'pa-saved-actions';

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'pa-btn-danger';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', async () => {
      if (confirm(`Remove all drawings for "${page.pageTitle || page.url}"?`)) {
        await clearPageData(page.url);
        await renderSavedPages();
      }
    });

    actions.appendChild(deleteBtn);
    item.appendChild(info);
    item.appendChild(actions);
    listContainer.appendChild(item);
  });
}

function setupBackupRestore() {
  const exportBtn = document.getElementById('btn-export-backup');
  const importBtn = document.getElementById('btn-import-backup');
  const fileInput = document.getElementById('backup-file-input') as HTMLInputElement;
  const statusSpan = document.getElementById('import-status');

  exportBtn?.addEventListener('click', async () => {
    const jsonStr = await exportAllDataAsJson();
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `page-anchor-backup-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  importBtn?.addEventListener('click', () => {
    fileInput?.click();
  });

  fileInput?.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const success = await importDataFromJson(text);
      if (success) {
        if (statusSpan) statusSpan.textContent = 'Backup restored successfully!';
        currentSettings = await loadSettings();
        renderShortcuts();
        setupDrawingForm();
        setupPersistenceForm();
        await renderSavedPages();
      } else {
        if (statusSpan) statusSpan.textContent = 'Invalid backup format.';
      }
    } catch {
      if (statusSpan) statusSpan.textContent = 'Failed to read file.';
    }
  });
}

async function saveCurrentSettings() {
  await saveSettings(currentSettings);
}

function showToast(msg: string) {
  const toast = document.createElement('div');
  toast.style.position = 'fixed';
  toast.style.bottom = '24px';
  toast.style.right = '24px';
  toast.style.background = '#22c55e';
  toast.style.color = '#ffffff';
  toast.style.padding = '10px 18px';
  toast.style.borderRadius = '8px';
  toast.style.fontWeight = '600';
  toast.style.boxShadow = '0 6px 20px rgba(0, 0, 0, 0.4)';
  toast.style.zIndex = '9999';
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2500);
}

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

document.addEventListener('DOMContentLoaded', initOptions);
