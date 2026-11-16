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
import { ExtensionSettings, OrphanedAnchorMode, PageMetadataSummary, ShortcutAction, UrlMatchMode } from '../../src/types';
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
let savedStatusTimer: number | null = null;
const shortcutRecorder = new ShortcutRecorder();
const shortcutRows = new Map<ShortcutAction, ShortcutRow>();
let refusedShortcut: { id: ShortcutAction; message: string } | null = null;
/** Deletions wait out their Undo window before touching storage. */
const pendingDeletes = new Map<string, () => Promise<void>>();

/** Shortcut cards, in the order they appear; every action belongs to exactly one. */
const SHORTCUT_GROUPS: Array<{ label: string; ids: ShortcutAction[] }> = [
  { label: 'Toolbar', ids: ['toggle-active', 'action-toggle-toolbar'] },
  {
    label: 'Tools',
    ids: ['tool-select', 'tool-pen', 'tool-highlighter', 'tool-text', 'tool-eraser', 'tool-rect', 'tool-circle', 'tool-line', 'tool-arrow', 'tool-double-arrow'],
  },
  { label: 'Editing', ids: ['action-undo', 'action-redo', 'action-select-all', 'action-delete', 'action-clear'] },
];

export async function initOptions() {
  shortcutRecorder.stop();
  refusedShortcut = null;
  currentSettings = await loadSettings();
  saveStatusEl = document.getElementById('save-status');

  setupTabs();
  renderShortcuts();
  setupPersistenceForm();
  await renderSavedPages();
  setupBackupRestore();

  document.getElementById('btn-reset-shortcuts')?.addEventListener('click', () => {
    shortcutRecorder.cancel();
    const previous = { ...currentSettings.shortcuts };
    setShortcuts({ ...DEFAULT_SETTINGS.shortcuts });
    showToast('Shortcuts reset to defaults', 'Undo', () => setShortcuts(previous));
  });

  const flushDeletes = () => {
    for (const commit of pendingDeletes.values()) void commit();
  };
  window.addEventListener('pagehide', flushDeletes);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushDeletes();
  });
}

function setShortcuts(shortcuts: ExtensionSettings['shortcuts']): void {
  currentSettings.shortcuts = shortcuts;
  refusedShortcut = null;
  renderShortcuts();
  void persist('shortcuts');
}

/** Saves one edited setting right away; the header briefly confirms it. */
async function persist(key: EditableKey): Promise<void> {
  if (key === 'shortcuts' && renderShortcutErrors()) return;
  const patch: Partial<ExtensionSettings> = {};
  copySetting(patch, key);
  if (patch.shortcuts) patch.shortcuts = { ...patch.shortcuts };
  await saveSettings(patch);
  markSaved();
}

function markSaved() {
  if (!saveStatusEl) return;
  saveStatusEl.dataset.state = 'saved';
  saveStatusEl.textContent = 'Saved';
  if (savedStatusTimer !== null) clearTimeout(savedStatusTimer);
  savedStatusTimer = window.setTimeout(() => {
    savedStatusTimer = null;
    if (!saveStatusEl) return;
    saveStatusEl.dataset.state = 'idle';
    saveStatusEl.textContent = 'Changes save automatically';
  }, 2000);
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
      p.classList.remove('flex');
      p.hidden = true;
    });

    tab.setAttribute('aria-selected', 'true');
    tab.setAttribute('tabindex', '0');

    const targetId = `tab-${tab.getAttribute('data-tab')}`;
    const targetPane = document.getElementById(targetId);
    if (targetPane) {
      targetPane.classList.remove('hidden');
      targetPane.classList.add('flex');
      targetPane.hidden = false;
    }
    window.scrollTo({ top: 0 });

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

  const grouped = new Set(SHORTCUT_GROUPS.flatMap((g) => g.ids));
  const groups = [...SHORTCUT_GROUPS, { label: 'Other', ids: SHORTCUT_DEFINITIONS.map((d) => d.id).filter((id) => !grouped.has(id)) }];

  for (const group of groups) {
    const defs = group.ids
      .map((id) => SHORTCUT_DEFINITIONS.find((d) => d.id === id))
      .filter((d): d is (typeof SHORTCUT_DEFINITIONS)[number] => !!d);
    if (defs.length === 0) continue;

    const section = document.createElement('section');
    const heading = document.createElement('h3');
    heading.className = 'pa-group-label';
    heading.textContent = group.label;
    const card = document.createElement('div');
    card.className = 'pa-card pa-rows';
    section.setAttribute('aria-label', `${group.label} shortcuts`);
    section.append(heading, card);
    container.appendChild(section);

    for (const def of defs) card.appendChild(buildShortcutRow(def));
  }
  renderShortcutErrors();
}

function buildShortcutRow(def: (typeof SHORTCUT_DEFINITIONS)[number]): HTMLElement {
  const item = document.createElement('div');
  item.className = 'pa-row !py-3';

  const info = document.createElement('div');
  info.className = 'pa-row-text';
  const titleEl = document.createElement('span');
  titleEl.className = 'pa-row-title';
  titleEl.textContent = def.name;
  const descEl = document.createElement('span');
  descEl.className = 'pa-row-desc block !mt-0.5';
  descEl.textContent = def.description;
  info.replaceChildren(titleEl, descEl);

  const error = document.createElement('span');
  error.id = `shortcut-error-${def.id}`;
  error.className = 'pa-shortcut-error mt-1.5 block text-[13px] font-medium text-brand-danger-soft';
  error.hidden = true;
  info.appendChild(error);

  const badge = document.createElement('button');
  badge.type = 'button';
  badge.className = 'pa-key-badge';
  badge.dataset.shortcutId = def.id;
  badge.title = 'Click, then press the new keys (Esc to cancel)';
  badge.addEventListener('click', (e) => {
    e.stopPropagation();
    startRecordingShortcut(def.id, badge);
  });

  shortcutRows.set(def.id, { badge, error });
  renderShortcutBadge(def.id);

  item.appendChild(info);
  item.appendChild(badge);
  return item;
}

/** Shows each key as its own keycap; the text still reads "Ctrl + Z" for tests and assistive tech. */
function renderKeycaps(target: HTMLElement, display: string): void {
  target.replaceChildren();
  display.split(' + ').forEach((key, i) => {
    if (i > 0) {
      const plus = document.createElement('span');
      plus.className = 'pa-key-plus';
      plus.textContent = ' + ';
      target.appendChild(plus);
    }
    const cap = document.createElement('kbd');
    cap.className = 'pa-keycap';
    cap.textContent = key;
    target.appendChild(cap);
  });
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
  renderKeycaps(row.badge, display);
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
    if (on) btn.dataset.conflict = 'true';
    else delete btn.dataset.conflict;
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
    void persist('shortcuts');

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
    void persist('urlMatchMode');
  });

  strokeSimplification.addEventListener('change', () => {
    currentSettings.strokeSimplification = strokeSimplification.checked;
    void persist('strokeSimplification');
  });

  domAnchorMode?.addEventListener('change', () => {
    currentSettings.domAnchoringEnabled = domAnchorMode.checked;
    void persist('domAnchoringEnabled');
  });

  orphanMode?.addEventListener('change', () => {
    currentSettings.orphanedAnchorMode = orphanMode.value as OrphanedAnchorMode;
    void persist('orphanedAnchorMode');
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

  const pages = (await getAllSavedPagesSummary()).filter((page) => !pendingDeletes.has(page.normalizedUrl));
  if (countBadge) countBadge.textContent = `${pages.length}`;

  if (pages.length === 0) {
    listContainer.replaceChildren();
    appendMarkup(
      listContainer,
      '<div class="pa-empty flex flex-col items-center gap-1 px-6 py-12 text-center">' +
        '<p class="text-[15px] font-semibold text-brand-text">No saved pages yet</p>' +
        '<p class="text-[13px] text-brand-muted">Draw on any web page and it will show up here.</p>' +
        '</div>'
    );
    return;
  }

  listContainer.replaceChildren();
  pages.forEach((page) => {
    const item = document.createElement('div');
    item.className = 'pa-row !justify-start !gap-4 max-[820px]:!flex-row max-[820px]:!items-center';

    const avatar = document.createElement('div');
    avatar.className =
      'flex-none flex items-center justify-center w-10 h-10 rounded-xl bg-brand-accent-tint text-brand-accent-soft text-[15px] font-semibold uppercase';
    avatar.setAttribute('aria-hidden', 'true');
    avatar.textContent = siteInitial(page.url, page.pageTitle);

    const info = document.createElement('div');
    info.className = 'pa-row-text';

    const dateStr = new Date(page.updatedAt).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    const title = page.pageTitle || 'Untitled Page';

    const titleEl = document.createElement('div');
    titleEl.className = 'pa-saved-title pa-row-title truncate';
    titleEl.textContent = title;

    // Only http(s) URLs become links; a stored URL can come from an untrusted backup.
    const isLink = isSafeHttpUrl(page.url);
    const urlEl = document.createElement(isLink ? 'a' : 'span');
    urlEl.className =
      'pa-saved-url block mt-0.5 text-[13px] text-brand-accent-soft max-w-[52ch] truncate' + (isLink ? ' hover:underline' : '');
    urlEl.textContent = page.url;
    if (urlEl instanceof HTMLAnchorElement) {
      urlEl.href = page.url;
      urlEl.target = '_blank';
      urlEl.rel = 'noopener noreferrer';
      urlEl.setAttribute('aria-label', `Open ${title} in new tab`);
    }

    const metaEl = document.createElement('div');
    metaEl.className = 'pa-saved-meta mt-1 text-xs text-brand-faint';
    const elementLabel = `${page.elementCount} drawing${page.elementCount === 1 ? '' : 's'}`;
    metaEl.textContent = `${elementLabel} · ${formatBytes(page.bytes ?? 0)} · Updated ${dateStr}`;

    info.appendChild(titleEl);
    info.appendChild(urlEl);
    info.appendChild(metaEl);

    const actions = document.createElement('div');
    actions.className = 'pa-saved-actions pa-row-control ml-auto';

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'pa-btn-danger';
    appendMarkup(
      deleteBtn,
      '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>'
    );
    deleteBtn.append('Delete');
    deleteBtn.setAttribute('aria-label', `Delete saved drawings for ${page.pageTitle || page.url}`);
    deleteBtn.addEventListener('click', () => deleteSavedPage(page));

    actions.appendChild(deleteBtn);
    item.appendChild(avatar);
    item.appendChild(info);
    item.appendChild(actions);
    listContainer.appendChild(item);
  });
}

function siteInitial(url: string, title: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').charAt(0) || '?';
  } catch {
    return title.trim().charAt(0) || '?';
  }
}

/** Hides the page at once and only deletes it once the Undo window has passed. */
async function deleteSavedPage(page: PageMetadataSummary): Promise<void> {
  const key = page.normalizedUrl;
  let done = false;
  const commit = async () => {
    if (done) return;
    done = true;
    pendingDeletes.delete(key);
    await clearPageData(page.url, page.normalizedUrl);
  };
  pendingDeletes.set(key, commit);
  await renderSavedPages();
  showToast(
    `Drawings removed from ${page.pageTitle || page.url}`,
    'Undo',
    async () => {
      done = true;
      pendingDeletes.delete(key);
      await renderSavedPages();
    },
    () => void commit()
  );
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

let activeToast: { el: HTMLElement; finish: () => void } | null = null;

/** A short notice with an optional action; `onExpire` runs when it closes without the action being used. */
function showToast(msg: string, actionLabel?: string, onAction?: () => void | Promise<void>, onExpire?: () => void) {
  activeToast?.finish();
  announce(msg);
  const toast = document.createElement('div');
  toast.setAttribute('role', 'status');
  toast.className =
    'pa-toast fixed bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-4 max-w-[min(560px,calc(100vw-32px))] ' +
    'pl-4.5 pr-2 py-2 rounded-xl bg-brand-elevated text-[#eef0f6] text-sm font-medium shadow-2xl shadow-black/30 z-9999';
  const text = document.createElement('span');
  text.className = 'truncate';
  text.textContent = msg;
  toast.appendChild(text);

  let timer = 0;
  const finish = (expired = true) => {
    clearTimeout(timer);
    toast.remove();
    if (activeToast?.el === toast) activeToast = null;
    if (expired) onExpire?.();
  };
  if (actionLabel && onAction) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className =
      'pa-toast-btn flex-none px-3 py-1.5 rounded-lg border-none bg-white/10 text-[#b9cdfa] text-[13px] font-semibold cursor-pointer hover:bg-white/16';
    btn.textContent = actionLabel;
    btn.addEventListener('click', () => {
      finish(false);
      void onAction();
      announce('Undone');
    });
    toast.appendChild(btn);
  }
  document.body.appendChild(toast);
  timer = window.setTimeout(() => finish(), actionLabel ? 6000 : 2500);
  activeToast = { el: toast, finish };
}

document.addEventListener('DOMContentLoaded', initOptions);
