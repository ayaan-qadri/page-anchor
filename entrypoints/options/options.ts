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

export async function initOptions() {
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

function announce(msg: string) {
  const el = document.getElementById('options-announcer');
  if (el) {
    el.textContent = '';
    requestAnimationFrame(() => {
      el.textContent = msg;
    });
  }
}

function setupTabs() {
  const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('.pa-tab-btn'));
  const panes = Array.from(document.querySelectorAll<HTMLElement>('.pa-tab-pane'));

  function activateTab(tab: HTMLButtonElement, shouldFocus = true) {
    tabs.forEach((t) => {
      t.classList.remove('active', 'text-sky-400', 'bg-sky-400/10', 'shadow-[0_0_1px_#38bdf8]');
      t.classList.add('text-slate-400');
      t.setAttribute('aria-selected', 'false');
      t.setAttribute('tabindex', '-1');
    });
    panes.forEach((p) => {
      p.classList.remove('active', 'block');
      p.classList.add('hidden');
      p.hidden = true;
    });

    tab.classList.remove('text-slate-400');
    tab.classList.add('active', 'text-sky-400', 'bg-sky-400/10', 'shadow-[0_0_1px_#38bdf8]');
    tab.setAttribute('aria-selected', 'true');
    tab.setAttribute('tabindex', '0');

    const targetId = `tab-${tab.getAttribute('data-tab')}`;
    const targetPane = document.getElementById(targetId);
    if (targetPane) {
      targetPane.classList.remove('hidden');
      targetPane.classList.add('active', 'block');
      targetPane.hidden = false;
    }

    if (shouldFocus) {
      tab.focus();
    }
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => {
      activateTab(tab, false);
    });

    tab.addEventListener('keydown', (e: KeyboardEvent) => {
      let nextIndex = index;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        nextIndex = (index + 1) % tabs.length;
        activateTab(tabs[nextIndex], true);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        nextIndex = (index - 1 + tabs.length) % tabs.length;
        activateTab(tabs[nextIndex], true);
      } else if (e.key === 'Home') {
        e.preventDefault();
        activateTab(tabs[0], true);
      } else if (e.key === 'End') {
        e.preventDefault();
        activateTab(tabs[tabs.length - 1], true);
      }
    });
  });
}

function renderShortcuts() {
  const container = document.getElementById('shortcuts-container');
  if (!container) return;
  container.innerHTML = '';

  SHORTCUT_DEFINITIONS.forEach((def) => {
    const item = document.createElement('div');
    item.className = 'pa-shortcut-item flex items-center justify-between p-3.5 bg-white/[0.03] hover:border-white/15 border border-white/[0.06] rounded-[10px] transition-colors';

    const info = document.createElement('div');
    info.className = 'pa-item-info flex flex-col gap-0.5';
    info.innerHTML = `
      <div class="pa-item-title font-semibold text-white text-sm">${def.name}</div>
      <div class="pa-item-desc text-xs text-slate-400">${def.description}</div>
    `;

    const keyVal = currentSettings.shortcuts[def.id] || def.defaultKey;
    const badge = document.createElement('button');
    badge.className = 'pa-key-badge bg-sky-400/10 hover:bg-sky-400/20 border border-sky-400/30 rounded-md px-3.5 py-1.5 text-sky-400 font-mono font-semibold text-xs cursor-pointer transition-all min-w-[100px] text-center focus-visible:outline-2 focus-visible:outline-sky-400';
    badge.textContent = formatShortcutForDisplay(keyVal);
    badge.title = 'Click to record new keystroke (Esc to cancel)';
    badge.setAttribute(
      'aria-label',
      `Rebind shortcut for ${def.name}. Current shortcut is ${formatShortcutForDisplay(keyVal)}`
    );

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

  const def = SHORTCUT_DEFINITIONS.find((d) => d.id === actionId);
  const actionName = def ? def.name : actionId;

  recordingAction = actionId;
  btn.classList.add('recording', 'bg-red-600', 'border-red-500', 'text-white', 'animate-pulse');
  btn.classList.remove('bg-sky-400/10', 'border-sky-400/30', 'text-sky-400');
  btn.textContent = 'Press keys...';
  btn.setAttribute('aria-label', `Recording shortcut for ${actionName}. Press keys, or press Escape to cancel.`);
  announce(`Recording shortcut for ${actionName}. Press your desired key combination, or press Escape to cancel.`);

  recordingHandler = (e: KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (e.key === 'Escape') {
      const prevKey = currentSettings.shortcuts[actionId] || (def ? def.defaultKey : '');
      btn.textContent = formatShortcutForDisplay(prevKey);
      btn.classList.remove('recording', 'bg-red-600', 'border-red-500', 'text-white', 'animate-pulse');
      btn.classList.add('bg-sky-400/10', 'border-sky-400/30', 'text-sky-400');
      btn.setAttribute(
        'aria-label',
        `Rebind shortcut for ${actionName}. Current shortcut is ${formatShortcutForDisplay(prevKey)}`
      );
      if (recordingHandler) {
        window.removeEventListener('keydown', recordingHandler, true);
        recordingHandler = null;
      }
      recordingAction = null;
      announce(`Shortcut recording for ${actionName} cancelled.`);
      return;
    }

    const combo = normalizeKeyEvent(e);
    if (!combo) return;

    currentSettings.shortcuts[actionId] = combo;
    btn.textContent = formatShortcutForDisplay(combo);
    btn.classList.remove('recording', 'bg-red-600', 'border-red-500', 'text-white', 'animate-pulse');
    btn.classList.add('bg-sky-400/10', 'border-sky-400/30', 'text-sky-400');
    btn.setAttribute(
      'aria-label',
      `Rebind shortcut for ${actionName}. Current shortcut is ${formatShortcutForDisplay(combo)}`
    );

    const conflict = getBrowserShortcutConflict(combo);
    if (conflict) {
      btn.classList.add('border-amber-500', 'text-amber-400');
      btn.classList.remove('border-sky-400/30', 'text-sky-400');
      btn.title = `Warning: "${combo}" conflicts with ${conflict.browser} (${conflict.action}). Key may be intercepted by the browser.`;
      announce(`Shortcut set to ${combo}. Warning: conflicts with ${conflict.browser}`);
    } else {
      btn.classList.remove('border-amber-500', 'text-amber-400');
      btn.classList.add('border-sky-400/30', 'text-sky-400');
      btn.title = 'Click to record new keystroke';
      announce(`Shortcut for ${actionName} updated to ${combo}`);
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
  const domAnchorMode = document.getElementById('pref-dom-anchoring') as HTMLInputElement;
  const orphanMode = document.getElementById('pref-orphan-mode') as HTMLSelectElement;

  matchMode.value = currentSettings.urlMatchMode;
  perfMode.checked = currentSettings.performanceMode;
  toolbarOpenMode.checked = !!currentSettings.isToolbarOpen;
  showPillMode.checked = currentSettings.showFloatingPill !== false;
  if (domAnchorMode) domAnchorMode.checked = currentSettings.domAnchoringEnabled ?? true;
  if (orphanMode) orphanMode.value = currentSettings.orphanedAnchorMode || 'hide';

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

  domAnchorMode?.addEventListener('change', () => {
    currentSettings.domAnchoringEnabled = domAnchorMode.checked;
  });

  orphanMode?.addEventListener('change', () => {
    currentSettings.orphanedAnchorMode = orphanMode.value as 'hide' | 'dimmed';
  });
}

async function renderSavedPages() {
  const listContainer = document.getElementById('saved-pages-list');
  const countBadge = document.getElementById('saved-count');
  if (!listContainer) return;

  const pages = await getAllSavedPagesSummary();
  if (countBadge) countBadge.textContent = `${pages.length}`;

  if (pages.length === 0) {
    listContainer.innerHTML = `<div style="color: #94a3b8; font-size: 13px; padding: 10px 0;">No saved annotations yet. Draw on any web page to see it anchored here!</div>`;
    return;
  }

  listContainer.innerHTML = '';
  pages.forEach((page) => {
    const item = document.createElement('div');
    item.className = 'pa-saved-item flex items-center justify-between p-3.5 bg-white/[0.03] border border-white/[0.06] rounded-[10px]';

    const info = document.createElement('div');
    info.className = 'pa-saved-info flex flex-col gap-0.5 max-w-[70%]';

    const dateStr = new Date(page.updatedAt).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    info.innerHTML = `
      <div class="pa-saved-title font-semibold text-white text-sm">${escapeHtml(page.pageTitle || 'Untitled Page')}</div>
      <a href="${page.url}" target="_blank" class="pa-saved-url text-xs text-sky-400 hover:underline truncate" aria-label="Open ${escapeHtml(page.pageTitle || page.url)} in new tab">${escapeHtml(page.url)}</a>
      <div class="pa-saved-meta text-[11px] text-slate-400">${page.elementCount} elements • Last updated ${dateStr}</div>
    `;

    const actions = document.createElement('div');
    actions.className = 'pa-saved-actions flex items-center gap-2.5';

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'pa-btn-danger';
    deleteBtn.textContent = 'Delete';
    deleteBtn.setAttribute('aria-label', `Delete saved drawings for ${page.pageTitle || page.url}`);
    deleteBtn.addEventListener('click', async () => {
      if (confirm(`Remove all drawings for "${page.pageTitle || page.url}"?`)) {
        await clearPageData(page.url);
        await renderSavedPages();
        announce(`Deleted annotations for ${page.pageTitle || page.url}`);
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
    announce('Backup JSON downloaded successfully');
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
        announce('Backup restored successfully!');
        currentSettings = await loadSettings();
        renderShortcuts();
        setupDrawingForm();
        setupPersistenceForm();
        await renderSavedPages();
      } else {
        if (statusSpan) statusSpan.textContent = 'Invalid backup format.';
        announce('Failed to restore backup: Invalid format.');
      }
    } catch {
      if (statusSpan) statusSpan.textContent = 'Failed to read file.';
      announce('Failed to read backup file.');
    }
  });
}

async function saveCurrentSettings() {
  await saveSettings(currentSettings);
}

function showToast(msg: string) {
  announce(msg);
  const toast = document.createElement('div');
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  toast.className = 'fixed bottom-6 right-6 bg-emerald-500 text-white px-4.5 py-2.5 rounded-lg font-semibold shadow-xl shadow-black/40 z-[9999] transition-all';
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
