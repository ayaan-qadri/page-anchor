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
import { ShortcutRecorder } from '../../src/ui/shortcut-recorder';

let currentSettings: ExtensionSettings;
let saveStatusEl: HTMLElement | null = null;
const shortcutRecorder = new ShortcutRecorder();

export async function initOptions() {
  currentSettings = await loadSettings();
  saveStatusEl = document.getElementById('save-status');

  setupTabs();
  renderShortcuts();
  setupDrawingForm();
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
    item.className = 'pa-row';

    const info = document.createElement('div');
    info.className = 'pa-row-text';
    info.innerHTML = `
      <span class="pa-row-title">${def.name}</span>
      <span class="pa-row-desc">${def.description}</span>
    `;

    const keyVal = currentSettings.shortcuts[def.id] || def.defaultKey;
    const badge = document.createElement('button');
    badge.type = 'button';
    badge.className = 'pa-key-badge';
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

  const clearConflict = () => btn.classList.remove('border-amber-500', 'text-amber-400');

  btn.classList.add('recording');
  btn.textContent = 'Press keys...';
  btn.setAttribute('aria-label', `Recording shortcut for ${actionName}. Press keys, or press Escape to cancel.`);
  announce(`Recording shortcut for ${actionName}. Press your desired key combination, or press Escape to cancel.`);

  shortcutRecorder.start((result) => {
    btn.classList.remove('recording');

    if (result.type === 'cancel') {
      const prevKey = currentSettings.shortcuts[actionId] || (def ? def.defaultKey : '');
      btn.textContent = formatShortcutForDisplay(prevKey);
      clearConflict();
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
      clearConflict();
      btn.classList.add('border-amber-500', 'text-amber-400');
      btn.title = `Warning: "${combo}" conflicts with ${conflict.browser} (${conflict.action}). Key may be intercepted by the browser.`;
      announce(`Shortcut set to ${combo}. Warning: conflicts with ${conflict.browser}`);
    } else {
      clearConflict();
      btn.title = 'Click to record new keystroke';
      announce(`Shortcut for ${actionName} updated to ${combo}`);
    }
  });
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
  const strokeSimplification = document.getElementById('pref-stroke-simplification') as HTMLInputElement;
  const toolbarOpenMode = document.getElementById('pref-toolbar-open') as HTMLInputElement;
  const showPillMode = document.getElementById('pref-show-pill') as HTMLInputElement;
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
  const strokeSimplification = document.getElementById('pref-stroke-simplification') as HTMLInputElement;
  const toolbarOpenMode = document.getElementById('pref-toolbar-open') as HTMLInputElement;
  const showPillMode = document.getElementById('pref-show-pill') as HTMLInputElement;
  const domAnchorMode = document.getElementById('pref-dom-anchoring') as HTMLInputElement;
  const orphanMode = document.getElementById('pref-orphan-mode') as HTMLSelectElement;

  matchMode.value = currentSettings.urlMatchMode;
  strokeSimplification.checked = currentSettings.strokeSimplification;
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
    listContainer.innerHTML = `<div class="pa-empty">No saved annotations yet. Draw on any web page and it will appear here.</div>`;
    return;
  }

  listContainer.innerHTML = '';
  pages.forEach((page) => {
    const item = document.createElement('div');
    item.className = 'pa-row';

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
    titleEl.className = 'pa-saved-title pa-row-title';
    titleEl.textContent = title;

    // Only http(s) URLs become links; a stored URL can come from an untrusted backup.
    const urlEl = document.createElement(isSafeHttpUrl(page.url) ? 'a' : 'span');
    urlEl.className = 'pa-saved-url';
    urlEl.textContent = page.url;
    if (urlEl instanceof HTMLAnchorElement) {
      urlEl.href = page.url;
      urlEl.target = '_blank';
      urlEl.rel = 'noopener noreferrer';
      urlEl.setAttribute('aria-label', `Open ${title} in new tab`);
    }

    const metaEl = document.createElement('div');
    metaEl.className = 'pa-saved-meta pa-row-desc';
    metaEl.textContent = `${page.elementCount} elements • Last updated ${dateStr}`;

    info.appendChild(titleEl);
    info.appendChild(urlEl);
    info.appendChild(metaEl);

    const actions = document.createElement('div');
    actions.className = 'pa-saved-actions pa-row-control';

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'pa-btn-danger';
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
        syncDrawingFormValues();
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
  toast.className = 'fixed bottom-6 right-6 bg-brand-success text-brand-bg px-4.5 py-2.5 rounded-lg font-semibold shadow-xl shadow-black/40 z-[9999] transition-all';
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2500);
}

document.addEventListener('DOMContentLoaded', initOptions);
