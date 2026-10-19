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
import { ExtensionSettings, ShortcutAction } from '../../src/types';
import {
  formatShortcutForDisplay,
  SHORTCUT_DEFINITIONS,
} from '../../src/core/shortcuts';
import { formatBytes } from '../../src/core/format';
import { appendMarkup } from '../../src/ui/dom';
import { ShortcutRecorder } from '../../src/ui/shortcut-recorder';

let currentSettings: ExtensionSettings;
let saveStatusEl: HTMLElement | null = null;
const shortcutRecorder = new ShortcutRecorder();

/* Shared Tailwind recipes for the rows the page builds in TypeScript. */
const ROW = 'pa-row flex items-center justify-between gap-6 px-4.5 py-3.5 max-[820px]:flex-col max-[820px]:items-stretch max-[820px]:gap-3';
const ROW_TEXT = 'pa-row-text flex-[1_1_auto] min-w-0';
const ROW_TITLE = 'pa-row-title block text-[13px] font-medium text-brand-text';
const ROW_DESC = 'pa-row-desc mt-0.5 text-xs leading-[1.45] text-brand-muted';
const ROW_CONTROL = 'pa-row-control flex-none flex items-center gap-3 max-[820px]:justify-start';
const KEY_BADGE =
  'pa-key-badge flex-none min-w-26 px-3 py-1.75 rounded-[9px] border border-white/10 bg-white/5 ' +
  'text-brand-accent-soft font-mono text-xs font-semibold text-center cursor-pointer ' +
  'transition-colors duration-130 hover:bg-white/9 hover:border-white/18 ' +
  'data-[capturing=true]:bg-brand-danger/[0.12] data-[capturing=true]:border-brand-danger ' +
  'data-[capturing=true]:text-brand-danger-soft data-[capturing=true]:animate-pulse ' +
  'data-[conflict=true]:border-brand-warning data-[conflict=true]:text-brand-warning-soft';

export async function initOptions() {
  currentSettings = await loadSettings();
  saveStatusEl = document.getElementById('save-status');

  setupTabs();
  renderShortcuts();
  setupPersistenceForm();
  await renderSavedPages();
  setupBackupRestore();

  // Any edit to a preference flips the header into an "unsaved" state so the
  // Save button never feels like a shot in the dark.
  const content = document.getElementById('main-settings-content');
  content?.addEventListener('input', markDirty);
  content?.addEventListener('change', markDirty);

  document.getElementById('btn-save')?.addEventListener('click', async () => {
    await saveCurrentSettings();
    markSaved();
    showToast('Settings saved successfully!');
  });

  document.getElementById('btn-reset-shortcuts')?.addEventListener('click', () => {
    if (confirm('Reset all shortcuts to factory defaults?')) {
      currentSettings.shortcuts = { ...DEFAULT_SETTINGS.shortcuts };
      renderShortcuts();
      markDirty();
      announce('Shortcuts reset to defaults. Save to apply.');
    }
  });
}

/** Marks the settings as having unsaved edits (drives the header status). */
function markDirty() {
  if (!saveStatusEl) return;
  saveStatusEl.dataset.state = 'dirty';
  saveStatusEl.textContent = 'Unsaved changes';
}

/** Marks the settings as in sync with storage. */
function markSaved() {
  if (!saveStatusEl) return;
  saveStatusEl.dataset.state = 'saved';
  saveStatusEl.textContent = 'All changes saved';
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
      t.setAttribute('aria-selected', 'false');
      t.setAttribute('tabindex', '-1');
    });
    panes.forEach((p) => {
      p.classList.add('hidden');
      p.hidden = true;
    });

    tab.setAttribute('aria-selected', 'true');
    tab.setAttribute('tabindex', '0');

    const targetId = `tab-${tab.getAttribute('data-tab')}`;
    const targetPane = document.getElementById(targetId);
    if (targetPane) {
      targetPane.classList.remove('hidden');
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
  container.replaceChildren();

  SHORTCUT_DEFINITIONS.forEach((def) => {
    const item = document.createElement('div');
    item.className = ROW;

    const info = document.createElement('div');
    info.className = ROW_TEXT;
    const titleEl = document.createElement('span');
    titleEl.className = ROW_TITLE;
    titleEl.textContent = def.name;
    const descEl = document.createElement('span');
    descEl.className = ROW_DESC;
    descEl.textContent = def.description;
    info.replaceChildren(titleEl, descEl);

    const keyVal = currentSettings.shortcuts[def.id] || def.defaultKey;
    const badge = document.createElement('button');
    badge.type = 'button';
    badge.className = KEY_BADGE;
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
  const def = SHORTCUT_DEFINITIONS.find((d) => d.id === actionId);
  const actionName = def ? def.name : actionId;

  const setConflict = (on: boolean) => {
    if (on) {
      btn.dataset.conflict = 'true';
      btn.classList.add('border-amber-500', 'text-amber-400');
    } else {
      delete btn.dataset.conflict;
      btn.classList.remove('border-amber-500', 'text-amber-400');
    }
  };

  btn.dataset.capturing = 'true';
  btn.classList.add('recording');
  btn.textContent = 'Press keys...';
  btn.setAttribute('aria-label', `Recording shortcut for ${actionName}. Press keys, or press Escape to cancel.`);
  announce(`Recording shortcut for ${actionName}. Press your desired key combination, or press Escape to cancel.`);

  shortcutRecorder.start((result) => {
    delete btn.dataset.capturing;
    btn.classList.remove('recording');

    if (result.type === 'cancel') {
      const prevKey = currentSettings.shortcuts[actionId] || (def ? def.defaultKey : '');
      btn.textContent = formatShortcutForDisplay(prevKey);
      setConflict(false);
      btn.setAttribute(
        'aria-label',
        `Rebind shortcut for ${actionName}. Current shortcut is ${formatShortcutForDisplay(prevKey)}`
      );
      announce(`Shortcut recording for ${actionName} cancelled.`);
      return;
    }

    const { combo, conflict } = result;
    currentSettings.shortcuts[actionId] = combo;
    btn.textContent = formatShortcutForDisplay(combo);
    btn.setAttribute(
      'aria-label',
      `Rebind shortcut for ${actionName}. Current shortcut is ${formatShortcutForDisplay(combo)}`
    );
    markDirty();

    if (conflict) {
      setConflict(true);
      btn.title = `Warning: "${combo}" conflicts with ${conflict.browser} (${conflict.action}). Key may be intercepted by the browser.`;
      announce(`Shortcut set to ${combo}. Warning: conflicts with ${conflict.browser}`);
    } else {
      setConflict(false);
      btn.title = 'Click to record new keystroke';
      announce(`Shortcut for ${actionName} updated to ${combo}`);
    }
  });
}

function setupPersistenceForm() {
  const matchMode = document.getElementById('pref-url-match-mode') as HTMLSelectElement;
  const strokeSimplification = document.getElementById('pref-stroke-simplification') as HTMLInputElement;
  const toolbarOpenMode = document.getElementById('pref-toolbar-open') as HTMLInputElement;
  const domAnchorMode = document.getElementById('pref-dom-anchoring') as HTMLInputElement;
  const orphanMode = document.getElementById('pref-orphan-mode') as HTMLSelectElement;

  syncPersistenceFormValues();

  matchMode.addEventListener('change', () => {
    currentSettings.urlMatchMode = matchMode.value as 'clean' | 'exact' | 'domain';
  });

  strokeSimplification.addEventListener('change', () => {
    currentSettings.strokeSimplification = strokeSimplification.checked;
  });

  toolbarOpenMode.addEventListener('change', () => {
    currentSettings.isToolbarOpen = toolbarOpenMode.checked;
  });

  domAnchorMode?.addEventListener('change', () => {
    currentSettings.domAnchoringEnabled = domAnchorMode.checked;
  });

  orphanMode?.addEventListener('change', () => {
    currentSettings.orphanedAnchorMode = orphanMode.value as 'hide' | 'dimmed';
  });
}

/** Refreshes persistence form controls from `currentSettings` (no rebinding). */
function syncPersistenceFormValues(): void {
  const matchMode = document.getElementById('pref-url-match-mode') as HTMLSelectElement;
  const strokeSimplification = document.getElementById('pref-stroke-simplification') as HTMLInputElement;
  const toolbarOpenMode = document.getElementById('pref-toolbar-open') as HTMLInputElement;
  const domAnchorMode = document.getElementById('pref-dom-anchoring') as HTMLInputElement;
  const orphanMode = document.getElementById('pref-orphan-mode') as HTMLSelectElement;

  matchMode.value = currentSettings.urlMatchMode;
  strokeSimplification.checked = currentSettings.strokeSimplification;
  toolbarOpenMode.checked = !!currentSettings.isToolbarOpen;
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
    listContainer.replaceChildren();
    appendMarkup(
      listContainer,
      '<div class="pa-empty p-4.5 text-[13px] text-brand-muted text-center">No saved annotations yet. Draw on any web page and it will appear here.</div>'
    );
    return;
  }

  listContainer.replaceChildren();
  pages.forEach((page) => {
    const item = document.createElement('div');
    item.className = ROW;

    const info = document.createElement('div');
    info.className = ROW_TEXT;

    const dateStr = new Date(page.updatedAt).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    const title = page.pageTitle || 'Untitled Page';

    const titleEl = document.createElement('div');
    titleEl.className = `pa-saved-title ${ROW_TITLE}`;
    titleEl.textContent = title;

    // Only http(s) URLs become links; a stored URL can come from an untrusted backup.
    const isLink = isSafeHttpUrl(page.url);
    const urlEl = document.createElement(isLink ? 'a' : 'span');
    urlEl.className =
      'pa-saved-url block text-xs text-brand-accent-soft max-w-[46ch] truncate' + (isLink ? ' hover:underline' : '');
    urlEl.textContent = page.url;
    if (urlEl instanceof HTMLAnchorElement) {
      urlEl.href = page.url;
      urlEl.target = '_blank';
      urlEl.rel = 'noopener noreferrer';
      urlEl.setAttribute('aria-label', `Open ${title} in new tab`);
    }

    const metaEl = document.createElement('div');
    metaEl.className = `pa-saved-meta ${ROW_DESC}`;
    const elementLabel = `${page.elementCount} element${page.elementCount === 1 ? '' : 's'}`;
    metaEl.textContent = `${elementLabel} • ${formatBytes(page.bytes ?? 0)} • Last updated ${dateStr}`;

    info.appendChild(titleEl);
    info.appendChild(urlEl);
    info.appendChild(metaEl);

    const actions = document.createElement('div');
    actions.className = `pa-saved-actions ${ROW_CONTROL}`;

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'pa-btn-danger px-3 py-1.5 rounded-lg border border-brand-danger/35 bg-brand-danger/10 text-xs font-semibold text-brand-danger-soft cursor-pointer transition-colors duration-130 ease-out hover:bg-brand-danger/20 hover:border-brand-danger/50';
    deleteBtn.textContent = 'Delete';
    deleteBtn.setAttribute('aria-label', `Delete saved drawings for ${page.pageTitle || page.url}`);
    deleteBtn.addEventListener('click', async () => {
      if (confirm(`Remove all drawings for "${page.pageTitle || page.url}"?`)) {
        await clearPageData(page.url, page.normalizedUrl);
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
        syncPersistenceFormValues();
        await renderSavedPages();
        markSaved();
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
  toast.className = 'fixed bottom-6 right-6 bg-brand-success text-brand-bg px-4.5 py-2.5 rounded-lg font-semibold shadow-xl shadow-black/40 z-9999 transition-all';
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2500);
}

document.addEventListener('DOMContentLoaded', initOptions);
