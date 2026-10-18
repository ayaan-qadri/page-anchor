import {
  DEFAULT_SETTINGS,
  clearPageData,
  exportAllDataAsJson,
  getAllSavedPagesSummary,
  importDataFromJson,
  loadSettings,
  saveSettings,
} from '../../src/core/storage';
import { ExtensionSettings, ShortcutAction } from '../../src/types';
import {
  SHORTCUT_DEFINITIONS,
  formatShortcutForDisplay,
} from '../../src/core/shortcuts';
import { ShortcutRecorder } from '../../src/ui/shortcut-recorder';

const CHEVRON_RIGHT =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m9 18 6-6-6-6"/></svg>';
const CHEVRON_LEFT =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m15 18-6-6 6-6"/></svg>';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  html?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html !== undefined) node.innerHTML = html;
  return node;
}

/** A card groups related rows under one hairline-divided surface. */
function card(): HTMLElement {
  return el('div', 'pa-ps-card');
}

/**
 * Renders the full settings surface inside the extension popup: the popup
 * swaps to a scrollable settings panel instead of opening a separate tab.
 * Changes are saved as they are made, so there is no save button.
 */
export class PopupSettingsPanel {
  private settings!: ExtensionSettings;
  private recorder = new ShortcutRecorder();
  private recordingButton: HTMLButtonElement | null = null;
  private savedPagesRoot!: HTMLElement;
  private shortcutsRoot!: HTMLElement;
  private statusEl!: HTMLElement;
  private fileInput!: HTMLInputElement;

  constructor(
    private readonly root: HTMLElement,
    private readonly announce: (msg: string) => void,
  ) {}

  /** Loads current settings and paints the panel. Safe to call again to reset. */
  public async mount(): Promise<void> {
    this.dispose();
    this.settings = await loadSettings();
    this.root.replaceChildren();
    this.renderDrawingDefaults();
    this.renderPersistence();
    this.renderShortcuts();
    await this.renderSavedPages();
    this.renderBackup();
  }

  public dispose(): void {
    this.recorder.stop();
    if (this.recordingButton) {
      const btn = this.recordingButton;
      const id = btn.dataset.shortcutId as ShortcutAction | undefined;
      const def = SHORTCUT_DEFINITIONS.find((d) => d.id === id);
      const key = (id && this.settings?.shortcuts[id]) || def?.defaultKey || '';
      btn.classList.remove('recording', 'conflict');
      if (key) btn.textContent = formatShortcutForDisplay(key);
      this.recordingButton = null;
    }
  }

  private persist(): void {
    saveSettings(this.settings).catch(() => {
      this.announce('Could not save settings');
    });
  }

  private section(title: string): HTMLElement {
    const wrap = el('section', 'pa-ps-section');
    const head = el('div', 'flex flex-col gap-0.5');
    head.appendChild(el('h3', 'pa-ps-title', title));
    wrap.appendChild(head);
    return wrap;
  }

  private renderDrawingDefaults(): void {
    const section = this.section('Drawing defaults');
    const box = card();

    box.appendChild(
      this.colorField('Pen colour', this.settings.defaultStrokeColor, (value) => {
        this.settings.defaultStrokeColor = value;
        this.persist();
      }),
    );
    box.appendChild(
      this.rangeField('Pen width', 1, 30, this.settings.defaultStrokeWidth, 'px', (value) => {
        this.settings.defaultStrokeWidth = value;
        this.persist();
      }),
    );
    box.appendChild(
      this.colorField('Highlighter colour', this.settings.defaultHighlighterColor, (value) => {
        this.settings.defaultHighlighterColor = value;
        this.persist();
      }),
    );
    box.appendChild(
      this.rangeField('Highlighter width', 8, 50, this.settings.defaultHighlighterWidth, 'px', (value) => {
        this.settings.defaultHighlighterWidth = value;
        this.persist();
      }),
    );
    box.appendChild(
      this.rangeField('Text note size', 12, 36, this.settings.defaultFontSize, 'px', (value) => {
        this.settings.defaultFontSize = value;
        this.persist();
      }),
    );

    section.appendChild(box);
    this.root.appendChild(section);
  }

  private renderPersistence(): void {
    const section = this.section('Persistence & matching');
    const box = card();

    box.appendChild(
      this.selectField(
        'URL matching',
        this.settings.urlMatchMode,
        [
          ['clean', 'Clean URL — ignores tracking parameters'],
          ['exact', 'Exact URL — keeps everything'],
          ['domain', 'Whole domain — every page on the site'],
        ],
        (value) => {
          this.settings.urlMatchMode = value as ExtensionSettings['urlMatchMode'];
          this.persist();
        },
      ),
    );

    box.appendChild(
      this.selectField(
        'When an anchored element is missing',
        this.settings.orphanedAnchorMode || 'hide',
        [
          ['hide', 'Hide the drawing until it returns'],
          ['dimmed', 'Keep it visible, faded'],
        ],
        (value) => {
          this.settings.orphanedAnchorMode = value as ExtensionSettings['orphanedAnchorMode'];
          this.persist();
        },
      ),
    );

    box.appendChild(
      this.checkField(
        'Smart element anchoring',
        'Follow elements as the page moves, instead of fixed pixels',
        this.settings.domAnchoringEnabled ?? true,
        (checked) => {
          this.settings.domAnchoringEnabled = checked;
          this.persist();
        },
      ),
    );
    box.appendChild(
      this.checkField(
        'Keep toolbar open by default',
        'Otherwise the drawing toolbar starts minimized',
        !!this.settings.isToolbarOpen,
        (checked) => {
          this.settings.isToolbarOpen = checked;
          this.persist();
        },
      ),
    );
    box.appendChild(
      this.checkField(
        'Show floating anchor pill',
        'Quick access pill in the corner of each page',
        this.settings.showFloatingPill !== false,
        (checked) => {
          this.settings.showFloatingPill = checked;
          this.persist();
        },
      ),
    );
    box.appendChild(
      this.checkField(
        'Simplify stroke points',
        'Compress freehand strokes to save memory on busy pages',
        this.settings.strokeSimplification,
        (checked) => {
          this.settings.strokeSimplification = checked;
          this.persist();
        },
      ),
    );

    section.appendChild(box);
    this.root.appendChild(section);
  }

  private renderShortcuts(): void {
    const section = this.section('Keyboard shortcuts');
    const box = card();

    const nav = el('button', 'pa-ps-nav-row');
    nav.type = 'button';
    nav.setAttribute('aria-label', 'Open keyboard shortcut settings');

    const info = el('div', 'pa-ps-row-text');
    info.appendChild(el('span', 'pa-ps-row-title', 'Customize shortcuts'));
    info.appendChild(
      el('span', 'pa-ps-row-desc', `Rebind the ${SHORTCUT_DEFINITIONS.length} shortcuts for tools and actions`),
    );
    nav.appendChild(info);
    nav.appendChild(el('span', 'pa-ps-nav-chevron', CHEVRON_RIGHT));
    nav.addEventListener('click', () => this.openShortcutEditor());

    box.appendChild(nav);
    section.appendChild(box);
    this.root.appendChild(section);
  }

  /**
   * Swaps the panel to the full shortcut list. The list lives one level deep
   * so the default settings view stays short instead of scrolling past 18 rows.
   */
  private openShortcutEditor(): void {
    this.dispose();

    this.root.replaceChildren();
    const section = el('section', 'pa-ps-section');

    const head = el('div', 'pa-ps-subhead');
    const back = el('button', 'pa-ps-back', CHEVRON_LEFT);
    back.type = 'button';
    back.setAttribute('aria-label', 'Back to settings');
    back.addEventListener('click', async () => {
      await this.mount();
      this.root
        .querySelector<HTMLButtonElement>('[aria-label="Open keyboard shortcut settings"]')
        ?.focus();
    });
    head.appendChild(back);
    head.appendChild(el('h3', 'pa-ps-title', 'Keyboard shortcuts'));
    section.appendChild(head);

    this.shortcutsRoot = card();
    this.buildShortcutRows();
    section.appendChild(this.shortcutsRoot);

    const reset = el('button', 'pa-ps-link-btn', 'Reset shortcuts to default');
    reset.type = 'button';
    reset.addEventListener('click', () => {
      this.settings.shortcuts = { ...DEFAULT_SETTINGS.shortcuts };
      this.persist();
      this.buildShortcutRows();
      this.announce('Shortcuts reset to defaults');
    });
    section.appendChild(reset);

    this.root.appendChild(section);
    back.focus();
  }

  private buildShortcutRows(): void {
    this.shortcutsRoot.replaceChildren();

    SHORTCUT_DEFINITIONS.forEach((def) => {
      const row = el('div', 'pa-ps-row');

      const info = el('div', 'pa-ps-row-text');
      info.appendChild(el('div', 'pa-ps-row-title', def.name));
      info.appendChild(el('div', 'pa-ps-row-desc', def.description));
      row.appendChild(info);

      const key = this.settings.shortcuts[def.id] || def.defaultKey;
      const badge = el('button', 'pa-ps-key');
      badge.type = 'button';
      badge.dataset.shortcutId = def.id;
      badge.textContent = formatShortcutForDisplay(key);
      badge.title = 'Click to record a new keystroke (Esc to cancel)';
      badge.setAttribute(
        'aria-label',
        `Rebind ${def.name}. Current shortcut ${formatShortcutForDisplay(key)}`,
      );
      badge.addEventListener('click', (event) => {
        event.stopPropagation();
        this.recordShortcut(def.id, badge);
      });

      row.appendChild(badge);
      this.shortcutsRoot.appendChild(row);
    });
  }

  private recordShortcut(actionId: ShortcutAction, badge: HTMLButtonElement): void {
    this.dispose();

    const def = SHORTCUT_DEFINITIONS.find((d) => d.id === actionId);
    const name = def ? def.name : actionId;

    this.recordingButton = badge;
    badge.dataset.shortcutId = actionId;
    badge.classList.remove('conflict');
    badge.classList.add('recording');
    badge.textContent = 'Press keys…';
    badge.setAttribute('aria-label', `Recording shortcut for ${name}. Press keys, or Esc to cancel.`);
    this.announce(`Recording shortcut for ${name}. Press your keys, or Esc to cancel.`);

    this.recorder.start((result) => {
      if (result.type === 'cancel') {
        this.dispose();
        this.announce('Shortcut recording cancelled');
        return;
      }

      const { combo, conflict } = result;
      this.settings.shortcuts[actionId] = combo;
      this.persist();

      this.recordingButton = null;
      badge.classList.remove('recording');
      badge.textContent = formatShortcutForDisplay(combo);
      badge.setAttribute('aria-label', `Rebind ${name}. Current shortcut ${formatShortcutForDisplay(combo)}`);

      if (conflict) {
        badge.classList.add('conflict');
        badge.title = `Warning: "${combo}" conflicts with ${conflict.browser} (${conflict.action}).`;
        this.announce(`Shortcut set to ${combo}. Warning: conflicts with ${conflict.browser}`);
      } else {
        badge.classList.remove('conflict');
        badge.title = 'Click to record a new keystroke';
        this.announce(`Shortcut for ${name} set to ${combo}`);
      }
    });
  }

  private async renderSavedPages(): Promise<void> {
    const section = this.section('Saved pages');
    this.savedPagesRoot = card();
    section.appendChild(this.savedPagesRoot);
    this.root.appendChild(section);
    await this.refreshSavedPages();
  }

  private async refreshSavedPages(): Promise<void> {
    const pages = await getAllSavedPagesSummary();
    this.savedPagesRoot.replaceChildren();

    if (pages.length === 0) {
      const empty = el('div', 'pa-ps-row');
      empty.appendChild(el('span', 'pa-ps-row-desc', 'Nothing saved yet. Draw on any page and it will appear here.'));
      this.savedPagesRoot.appendChild(empty);
      return;
    }

    pages.forEach((page) => {
      const row = el('div', 'pa-ps-row');

      const info = el('div', 'pa-ps-row-text');
      info.appendChild(
        el('div', 'pa-ps-row-title', page.pageTitle || 'Untitled page'),
      );
      info.appendChild(el('div', 'pa-ps-row-desc', page.url));
      info.appendChild(
        el('div', 'pa-ps-row-desc', `${page.elementCount} element${page.elementCount === 1 ? '' : 's'}`),
      );
      row.appendChild(info);

      const del = el('button', 'pa-ps-delete', 'Delete');
      del.type = 'button';
      del.setAttribute('aria-label', `Delete saved drawings for ${page.pageTitle || page.url}`);
      del.addEventListener('click', async () => {
        if (!confirm(`Remove all drawings for "${page.pageTitle || page.url}"?`)) return;
        await clearPageData(page.url, page.normalizedUrl);
        await this.refreshSavedPages();
        this.announce(`Deleted drawings for ${page.pageTitle || page.url}`);
      });
      row.appendChild(del);

      this.savedPagesRoot.appendChild(row);
    });
  }

  private renderBackup(): void {
    const section = this.section('Backup & restore');
    const box = card();
    const actions = el('div', 'pa-ps-actions');

    const exportBtn = el('button', 'pa-ps-btn', 'Download backup (.json)');
    exportBtn.type = 'button';
    exportBtn.addEventListener('click', async () => {
      const json = await exportAllDataAsJson();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `page-anchor-backup-${Date.now()}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      this.announce('Backup downloaded');
    });
    actions.appendChild(exportBtn);

    this.fileInput = el('input', 'hidden');
    this.fileInput.type = 'file';
    this.fileInput.accept = '.json,application/json';
    this.fileInput.setAttribute('aria-label', 'Choose a JSON backup file to restore');
    this.fileInput.addEventListener('change', () => {
      void this.importBackup();
    });
    actions.appendChild(this.fileInput);

    const importBtn = el('button', 'pa-ps-btn dashed', 'Restore from backup');
    importBtn.type = 'button';
    importBtn.addEventListener('click', () => this.fileInput.click());
    actions.appendChild(importBtn);

    this.statusEl = el('p', 'pa-ps-status');
    this.statusEl.setAttribute('role', 'status');
    this.statusEl.setAttribute('aria-live', 'polite');
    actions.appendChild(this.statusEl);

    box.appendChild(actions);
    section.appendChild(box);
    this.root.appendChild(section);
  }

  private async importBackup(): Promise<void> {
    const file = this.fileInput.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const restored = await importDataFromJson(text);
      if (!restored) {
        this.statusEl.textContent = 'Invalid backup file.';
        return;
      }
      await this.mount();
      this.statusEl.textContent = 'Backup restored.';
      this.announce('Backup restored');
    } catch {
      this.statusEl.textContent = 'Could not read that file.';
    }
  }

  private colorField(label: string, value: string, onChange: (value: string) => void): HTMLElement {
    const row = el('div', 'pa-ps-row');

    const info = el('div', 'pa-ps-row-text');
    info.appendChild(el('span', 'pa-ps-row-title', label));
    const hex = el('span', 'pa-ps-hex', value);
    info.appendChild(hex);
    row.appendChild(info);

    const input = el('input', 'pa-ps-swatch');
    input.type = 'color';
    input.value = value;
    input.setAttribute('aria-label', label);
    input.addEventListener('input', () => {
      hex.textContent = input.value;
      onChange(input.value);
    });
    row.appendChild(input);

    return row;
  }

  private rangeField(
    label: string,
    min: number,
    max: number,
    value: number,
    unit: string,
    onChange: (value: number) => void,
  ): HTMLElement {
    const field = el('div', 'pa-ps-field');

    const head = el('div', 'pa-ps-field-head');
    head.appendChild(el('span', 'pa-ps-row-title', label));
    const readout = el('span', 'pa-ps-readout', `${value}${unit}`);
    head.appendChild(readout);
    field.appendChild(head);

    const input = el('input', 'pa-ps-range');
    input.type = 'range';
    input.min = `${min}`;
    input.max = `${max}`;
    input.value = `${value}`;
    input.setAttribute('aria-label', label);
    input.addEventListener('input', () => {
      readout.textContent = `${input.value}${unit}`;
    });
    input.addEventListener('change', () => onChange(parseInt(input.value, 10)));
    field.appendChild(input);

    return field;
  }

  private checkField(
    label: string,
    hint: string,
    checked: boolean,
    onChange: (checked: boolean) => void,
  ): HTMLElement {
    const row = el('div', 'pa-ps-row');

    const info = el('div', 'pa-ps-row-text');
    info.appendChild(el('span', 'pa-ps-row-title', label));
    info.appendChild(el('span', 'pa-ps-row-desc', hint));
    row.appendChild(info);

    const control = el('div', 'pa-ps-control');
    const switchLabel = el('label', 'pa-ps-switch');
    const input = el('input');
    input.type = 'checkbox';
    input.checked = checked;
    input.setAttribute('aria-label', label);
    input.addEventListener('change', () => onChange(input.checked));

    const track = el('span', 'pa-ps-switch-track');
    track.setAttribute('aria-hidden', 'true');

    switchLabel.appendChild(input);
    switchLabel.appendChild(track);
    control.appendChild(switchLabel);
    row.appendChild(control);

    return row;
  }

  private selectField(
    label: string,
    value: string,
    options: Array<[string, string]>,
    onChange: (value: string) => void,
  ): HTMLElement {
    const field = el('div', 'pa-ps-field');
    field.appendChild(el('span', 'pa-ps-row-title', label));

    const select = el('select', 'pa-ps-select');
    select.setAttribute('aria-label', label);
    options.forEach(([optionValue, optionLabel]) => {
      const option = el('option', undefined, optionLabel);
      option.value = optionValue;
      option.selected = optionValue === value;
      select.appendChild(option);
    });
    select.addEventListener('change', () => onChange(select.value));
    field.appendChild(select);

    return field;
  }
}
