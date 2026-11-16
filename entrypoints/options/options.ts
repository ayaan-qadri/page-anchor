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
import { ExtensionSettings, OrphanedAnchorMode, ShortcutAction, UrlMatchMode } from '../../src/types';
import {
  canonicalizeShortcut,
  formatShortcutForDisplay,
  SHORTCUT_DEFINITIONS,
} from '../../src/core/shortcuts';
import { formatBytes } from '../../src/core/format';
import { appendMarkup } from '../../src/ui/dom';
import { ShortcutRecorder } from '../../src/ui/shortcut-recorder';

/** The settings this page edits. Everything else belongs to the toolbar and must not be overwritten from here. */
type EditableKey =
  | 'shortcuts'
  | 'urlMatchMode'
  | 'strokeSimplification'
  | 'domAnchoringEnabled'
  | 'orphanedAnchorMode';

interface ShortcutRow {
  badge: HTMLButtonElement;
  error: HTMLElement;
}

let currentSettings: ExtensionSettings;
let saveStatusEl: HTMLElement | null = null;
const shortcutRecorder = new ShortcutRecorder();
const dirtyKeys = new Set<EditableKey>();
const shortcutRows = new Map<ShortcutAction, ShortcutRow>();
let refusedShortcut: { id: ShortcutAction; message: string } | null = null;

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
  shortcutRecorder.stop();
  dirtyKeys.clear();
  refusedShortcut = null;
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
  content?.addEventListener('input', () => markDirty());
  content?.addEventListener('change', () => markDirty());

  document.getElementById('btn-save')?.addEventListener('click', async () => {
    if (!(await saveCurrentSettings())) {
      announce('Some shortcuts are used twice. Change them before saving.');
      return;
    }
    markSaved();
    showToast('Settings saved successfully!');
  });

  document.getElementById('btn-reset-shortcuts')?.addEventListener('click', () => {
    shortcutRecorder.cancel();
    if (confirm('Reset all shortcuts to factory defaults?')) {
      currentSettings.shortcuts = { ...DEFAULT_SETTINGS.shortcuts };
      refusedShortcut = null;
      renderShortcuts();
      markDirty('shortcuts');
      announce('Shortcuts reset to defaults. Save to apply.');
    }
  });
}

/** Marks the settings as having unsaved edits (drives the header status). */
function markDirty(key?: EditableKey) {
  if (key) dirtyKeys.add(key);
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
    shortcutRecorder.cancel();
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
  shortcutRows.clear();

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

    const error = document.createElement('span');
    error.id = `shortcut-error-${def.id}`;
    error.className = 'pa-shortcut-error mt-1 block text-xs font-medium text-brand-danger-soft';
    error.hidden = true;
    info.appendChild(error);

    const badge = document.createElement('button');
    badge.type = 'button';
    badge.className = KEY_BADGE;
    badge.dataset.shortcutId = def.id;
    badge.title = 'Click to record new keystroke (Esc to cancel)';
    badge.addEventListener('click', (e) => {
      e.stopPropagation();
      startRecordingShortcut(def.id, badge);
    });

    shortcutRows.set(def.id, { badge, error });
    renderShortcutBadge(def.id);

    item.appendChild(info);
    item.appendChild(badge);
    container.appendChild(item);
  });
  renderShortcutErrors();
}

function shortcutName(id: ShortcutAction): string {
  return SHORTCUT_DEFINITIONS.find((d) => d.id === id)?.name ?? id;
}

function bindingOf(id: ShortcutAction): string {
  return currentSettings.shortcuts[id] || SHORTCUT_DEFINITIONS.find((d) => d.id === id)?.defaultKey || '';
}

function sameShortcut(a: string, b: string): boolean {
  return !!a && !!b && canonicalizeShortcut(a).toLowerCase() === canonicalizeShortcut(b).toLowerCase();
}

/** The other action already bound to `combo`, if any. */
function findShortcutOwner(combo: string, except: ShortcutAction): ShortcutAction | null {
  const owner = SHORTCUT_DEFINITIONS.find((d) => d.id !== except && sameShortcut(bindingOf(d.id), combo));
  return owner?.id ?? null;
}

function renderShortcutBadge(id: ShortcutAction): void {
  const row = shortcutRows.get(id);
  if (!row) return;
  const display = formatShortcutForDisplay(bindingOf(id));
  row.badge.textContent = display;
  row.badge.setAttribute('aria-label', `Rebind shortcut for ${shortcutName(id)}. Current shortcut is ${display}`);
}

/** Shows the refused-recording message, or flags bindings shared with another action. Returns true when any are shared. */
function renderShortcutErrors(): boolean {
  let hasDuplicates = false;
  for (const [id, { badge, error }] of shortcutRows) {
    const owner = findShortcutOwner(bindingOf(id), id);
    if (owner) hasDuplicates = true;
    const message =
      refusedShortcut?.id === id ? refusedShortcut.message : owner ? `Also used by ${shortcutName(owner)}.` : '';
    error.textContent = message;
    error.hidden = !message;
    if (message) {
      badge.setAttribute('aria-describedby', error.id);
      badge.setAttribute('aria-invalid', 'true');
    } else {
      badge.removeAttribute('aria-describedby');
      badge.removeAttribute('aria-invalid');
    }
  }
  return hasDuplicates;
}

function startRecordingShortcut(actionId: ShortcutAction, btn: HTMLElement) {
  const actionName = shortcutName(actionId);
  refusedShortcut = null;
  renderShortcutErrors();

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
      renderShortcutBadge(actionId);
      setConflict(false);
      announce(`Shortcut recording for ${actionName} cancelled.`);
      return;
    }

    const { combo, conflict } = result;
    const owner = findShortcutOwner(combo, actionId);
    if (owner) {
      renderShortcutBadge(actionId);
      refusedShortcut = { id: actionId, message: `Already used by ${shortcutName(owner)}.` };
      renderShortcutErrors();
      announce(`${formatShortcutForDisplay(combo)} is already used by ${shortcutName(owner)}. Choose another key.`);
      return;
    }

    currentSettings.shortcuts[actionId] = combo;
    renderShortcutBadge(actionId);
    renderShortcutErrors();
    markDirty('shortcuts');

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
  const domAnchorMode = document.getElementById('pref-dom-anchoring') as HTMLInputElement;
  const orphanMode = document.getElementById('pref-orphan-mode') as HTMLSelectElement;

  syncPersistenceFormValues();

  matchMode.addEventListener('change', () => {
    currentSettings.urlMatchMode = matchMode.value as UrlMatchMode;
    markDirty('urlMatchMode');
  });

  strokeSimplification.addEventListener('change', () => {
    currentSettings.strokeSimplification = strokeSimplification.checked;
    markDirty('strokeSimplification');
  });

  domAnchorMode?.addEventListener('change', () => {
    currentSettings.domAnchoringEnabled = domAnchorMode.checked;
    markDirty('domAnchoringEnabled');
  });

  orphanMode?.addEventListener('change', () => {
    currentSettings.orphanedAnchorMode = orphanMode.value as OrphanedAnchorMode;
    markDirty('orphanedAnchorMode');
  });
}

/** Refreshes persistence form controls from `currentSettings` (no rebinding). */
function syncPersistenceFormValues(): void {
  const matchMode = document.getElementById('pref-url-match-mode') as HTMLSelectElement;
  const strokeSimplification = document.getElementById('pref-stroke-simplification') as HTMLInputElement;
  const domAnchorMode = document.getElementById('pref-dom-anchoring') as HTMLInputElement;
  const orphanMode = document.getElementById('pref-orphan-mode') as HTMLSelectElement;

  matchMode.value = currentSettings.urlMatchMode;
  strokeSimplification.checked = currentSettings.strokeSimplification;
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
    a.hidden = true;
    // Firefox cancels the download if the anchor is detached or the URL is revoked before it starts.
    document.body.appendChild(a);
    a.click();
    window.setTimeout(() => {
      a.remove();
      URL.revokeObjectURL(url);
    }, 1000);
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
        shortcutRecorder.cancel();
        currentSettings = await loadSettings();
        dirtyKeys.clear();
        refusedShortcut = null;
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
    } finally {
      // Without this, picking the same file again fires no change event.
      fileInput.value = '';
    }
  });
}

function copySetting<K extends EditableKey>(target: Partial<ExtensionSettings>, key: K): void {
  target[key] = currentSettings[key];
}

/** Writes only the keys edited here, so changes made in open tabs meanwhile are kept. Refuses while a shortcut is shared. */
async function saveCurrentSettings(): Promise<boolean> {
  refusedShortcut = null;
  if (renderShortcutErrors()) return false;
  const patch: Partial<ExtensionSettings> = {};
  for (const key of dirtyKeys) copySetting(patch, key);
  if (patch.shortcuts) patch.shortcuts = { ...patch.shortcuts };
  if (Object.keys(patch).length > 0) await saveSettings(patch);
  dirtyKeys.clear();
  return true;
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
