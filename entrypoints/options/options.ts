import {
  clearPageData,
  DEFAULT_SETTINGS,
  exportAllDataAsJson,
  getAllSavedPagesSummary,
  importDataFromJson,
  isSafeHttpUrl,
  loadSettings,
  saveSettings,
} from '../../src/core/storage';
import { ExtensionSettings, ShortcutAction } from '../../src/core/types';
import {
  formatShortcutForDisplay,
  normalizeKeyEvent,
  SHORTCUT_DEFINITIONS,
  getBrowserShortcutConflict,
} from '../../src/core/shortcuts';

let currentSettings: ExtensionSettings;
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
      t.classList.remove('active');
      t.setAttribute('aria-selected', 'false');
      t.setAttribute('tabindex', '-1');
    });
    panes.forEach((p) => {
      p.classList.remove('active', 'block');
      p.classList.add('hidden');
      p.hidden = true;
    });

    tab.classList.add('active');
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
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        activateTab(tabs[(index + 1) % tabs.length], true);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        activateTab(tabs[(index - 1 + tabs.length) % tabs.length], true);
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
    item.className = 'pa-shortcut-item flex items-center justify-between p-3.5 bg-white/[0.03] hover:border-white/[0.14] border border-white/[0.07] rounded-[10px] transition-colors';

    const info = document.createElement('div');
    info.className = 'pa-item-info flex flex-col gap-0.5';
    info.innerHTML = `
      <div class="pa-item-title font-semibold text-brand-text text-sm">${def.name}</div>
      <div class="pa-item-desc text-xs text-brand-muted">${def.description}</div>
    `;

    const keyVal = currentSettings.shortcuts[def.id] || def.defaultKey;
    const badge = document.createElement('button');
    badge.className = 'pa-key-badge bg-white/[0.05] hover:bg-white/[0.08] border border-white/[0.1] rounded-lg px-3.5 py-1.5 text-brand-accent-soft font-mono font-semibold text-xs cursor-pointer transition-all min-w-[100px] text-center focus-visible:outline-2 focus-visible:outline-brand-ring';
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

  btn.classList.add('recording', 'border-brand-danger', 'text-brand-danger-soft', 'animate-pulse');
  btn.classList.remove('bg-white/[0.05]', 'hover:bg-white/[0.08]', 'border-white/[0.1]', 'text-brand-accent-soft');
  btn.textContent = 'Press keys...';
  btn.setAttribute('aria-label', `Recording shortcut for ${actionName}. Press keys, or press Escape to cancel.`);
  announce(`Recording shortcut for ${actionName}. Press your desired key combination, or press Escape to cancel.`);

  recordingHandler = (e: KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (e.key === 'Escape') {
      const prevKey = currentSettings.shortcuts[actionId] || (def ? def.defaultKey : '');
      btn.textContent = formatShortcutForDisplay(prevKey);
      btn.classList.remove('recording', 'border-brand-danger', 'text-brand-danger-soft', 'animate-pulse');
      btn.classList.add('border-white/[0.1]', 'text-brand-accent-soft');
      btn.setAttribute(
        'aria-label',
        `Rebind shortcut for ${actionName}. Current shortcut is ${formatShortcutForDisplay(prevKey)}`
      );
      if (recordingHandler) {
        window.removeEventListener('keydown', recordingHandler, true);
        recordingHandler = null;
      }
      announce(`Shortcut recording for ${actionName} cancelled.`);
      return;
    }

    const combo = normalizeKeyEvent(e);
    if (!combo) return;

    currentSettings.shortcuts[actionId] = combo;
    btn.textContent = formatShortcutForDisplay(combo);
    btn.classList.remove('recording', 'border-brand-danger', 'text-brand-danger-soft', 'animate-pulse');
    btn.classList.add('border-white/[0.1]', 'text-brand-accent-soft');
    btn.setAttribute(
      'aria-label',
      `Rebind shortcut for ${actionName}. Current shortcut is ${formatShortcutForDisplay(combo)}`
    );

    const conflict = getBrowserShortcutConflict(combo);
    if (conflict) {
      btn.classList.add('border-amber-500', 'text-amber-400');
      btn.classList.remove('border-white/[0.1]', 'text-brand-accent-soft');
      btn.title = `Warning: "${combo}" conflicts with ${conflict.browser} (${conflict.action}). Key may be intercepted by the browser.`;
      announce(`Shortcut set to ${combo}. Warning: conflicts with ${conflict.browser}`);
    } else {
      btn.classList.remove('border-amber-500', 'text-amber-400');
      btn.classList.add('border-white/[0.1]', 'text-brand-accent-soft');
      btn.title = 'Click to record new keystroke';
      announce(`Shortcut for ${actionName} updated to ${combo}`);
    }

    if (recordingHandler) {
      window.removeEventListener('keydown', recordingHandler, true);
      recordingHandler = null;
    }
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

  syncDrawingFormValues();

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

  syncPersistenceFormValues();

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

/** Refreshes drawing-default form controls from `currentSettings` (no rebinding). */
function syncDrawingFormValues(): void {
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
}

/** Refreshes persistence form controls from `currentSettings` (no rebinding). */
function syncPersistenceFormValues(): void {
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
}

async function renderSavedPages() {
  const listContainer = document.getElementById('saved-pages-list');
  const countBadge = document.getElementById('saved-count');
  if (!listContainer) return;

  const pages = await getAllSavedPagesSummary();
  if (countBadge) countBadge.textContent = `${pages.length}`;

  if (pages.length === 0) {
    listContainer.innerHTML = `<div style="color: var(--color-brand-muted); font-size: 13px; padding: 10px 0;">No saved annotations yet. Draw on any web page to see it anchored here!</div>`;
    return;
  }

  listContainer.innerHTML = '';
  pages.forEach((page) => {
    const item = document.createElement('div');
    item.className = 'pa-saved-item flex items-center justify-between gap-3 p-3.5 bg-white/[0.03] border border-white/[0.07] rounded-[10px]';

    const info = document.createElement('div');
    info.className = 'pa-saved-info flex flex-col gap-0.5 max-w-[70%]';

    const dateStr = new Date(page.updatedAt).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    const title = page.pageTitle || 'Untitled Page';

    const titleEl = document.createElement('div');
    titleEl.className = 'pa-saved-title font-semibold text-brand-text text-sm';
    titleEl.textContent = title;

    // Only http(s) URLs become links; a stored URL can come from an untrusted backup.
    const urlEl = document.createElement(isSafeHttpUrl(page.url) ? 'a' : 'span');
    urlEl.className = 'pa-saved-url text-xs text-brand-accent-soft hover:underline truncate';
    urlEl.textContent = page.url;
    if (urlEl instanceof HTMLAnchorElement) {
      urlEl.href = page.url;
      urlEl.target = '_blank';
      urlEl.rel = 'noopener noreferrer';
      urlEl.setAttribute('aria-label', `Open ${title} in new tab`);
    }

    const metaEl = document.createElement('div');
    metaEl.className = 'pa-saved-meta text-[11px] text-brand-faint';
    metaEl.textContent = `${page.elementCount} elements • Last updated ${dateStr}`;

    info.appendChild(titleEl);
    info.appendChild(urlEl);
    info.appendChild(metaEl);

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
        syncDrawingFormValues();
        syncPersistenceFormValues();
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
  toast.className = 'fixed bottom-6 right-6 bg-brand-success text-brand-bg px-4.5 py-2.5 rounded-lg font-semibold shadow-xl shadow-black/40 z-[9999] transition-all';
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2500);
}

document.addEventListener('DOMContentLoaded', initOptions);
