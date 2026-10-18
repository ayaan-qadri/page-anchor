import {
  DEFAULT_SETTINGS,
  clearPageData,
  exportAllDataAsJson,
  getAllSavedPagesSummary,
  importDataFromJson,
  loadSettings,
  saveSettings,
} from '../../src/core/storage';
import { ExtensionSettings, PageMetadataSummary, ShortcutAction } from '../../src/types';
import {
  SHORTCUT_DEFINITIONS,
  formatShortcutForDisplay,
} from '../../src/core/shortcuts';
import { formatBytes } from '../../src/core/format';
import { ShortcutRecorder } from '../../src/ui/shortcut-recorder';

const CHEVRON_RIGHT =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m9 18 6-6-6-6"/></svg>';
const CHEVRON_LEFT =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m15 18-6-6 6-6"/></svg>';
const CHEVRON_DOWN =
  '<svg class="pointer-events-none absolute right-2.25 top-1/2 -translate-y-1/2 text-brand-muted" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m6 9 6 6 6-6"/></svg>';

/* Tailwind recipes for the settings surface, which is assembled in TypeScript. */
const SECTION = 'pa-ps-section flex flex-col gap-2';
const SECTION_TITLE = 'pa-ps-title text-[11px] font-semibold tracking-[0.08em] uppercase text-brand-faint';
const CARD =
  'pa-ps-card border border-white/[0.07] rounded-xl bg-white/[0.022] overflow-hidden ' +
  '[&>*+*]:border-t [&>*+*]:border-white/6';
const ROW = 'pa-ps-row flex items-center justify-between gap-3 px-3 py-2.5';
const ROW_TEXT = 'pa-ps-row-text flex-[1_1_auto] min-w-0';
const ROW_TITLE = 'pa-ps-row-title block text-xs font-medium text-brand-text';
const ROW_DESC = 'pa-ps-row-desc mt-px text-[10.5px] leading-[1.4] text-brand-faint';
const CONTROL = 'pa-ps-control flex-none flex items-center gap-2';
const FIELD = 'pa-ps-field flex flex-col gap-1.75 px-3 py-2.5';
const FIELD_HEAD = 'pa-ps-field-head flex items-center justify-between gap-2.5';
const FIELD_LABEL = 'pa-ps-row-title text-xs font-medium text-brand-text';
const FIELD_READOUT = 'pa-ps-readout font-mono text-[11px] font-semibold text-brand-accent-soft tabular-nums';
const NAV_ROW =
  'pa-ps-nav-row flex items-center justify-between gap-3 w-full px-3 py-2.75 bg-transparent border-none ' +
  'text-inherit text-left cursor-pointer transition-colors duration-130 hover:bg-white/4';
const NAV_CHEVRON = 'pa-ps-nav-chevron flex-none flex text-brand-faint';
const SUBHEAD = 'pa-ps-subhead flex items-center gap-1.5';
const BACK =
  'pa-ps-back flex items-center justify-center w-6 h-6 -ml-1 border-none rounded-[7px] bg-transparent ' +
  'text-brand-muted cursor-pointer transition-colors duration-130 hover:bg-white/6 hover:text-brand-text';
const LINK_BTN =
  'pa-ps-link-btn self-start text-[11px] font-semibold text-brand-muted underline decoration-white/20 ' +
  'underline-offset-2 cursor-pointer transition-colors duration-130 hover:text-brand-text hover:decoration-white/40';
const SELECT =
  'pa-ps-select w-full appearance-none pl-2.5 pr-7.5 py-1.75 border border-white/10 rounded-lg ' +
  'bg-white/4 text-brand-text text-xs cursor-pointer transition-colors duration-130 hover:border-white/18';
const SWITCH = 'pa-ps-switch relative inline-flex items-center w-8.5 h-5 cursor-pointer';
const SWITCH_INPUT = 'absolute inset-0 w-full h-full m-0 opacity-0 cursor-pointer peer';
const SWITCH_TRACK =
  'pa-ps-switch-track absolute inset-0 rounded-full bg-white/16 transition-colors duration-160 ' +
  "after:content-[''] after:absolute after:top-0.75 after:left-0.75 after:w-3.5 after:h-3.5 after:rounded-full " +
  'after:bg-white after:transition-transform after:duration-160 ' +
  'peer-checked:bg-brand-accent peer-checked:after:translate-x-3.5 ' +
  'peer-focus-visible:outline-2 peer-focus-visible:outline-brand-ring peer-focus-visible:outline-offset-2';
const RANGE =
  'pa-ps-range appearance-none w-full h-1.25 rounded-full bg-white/12 cursor-pointer ' +
  '[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.75 [&::-webkit-slider-thumb]:h-3.75 ' +
  '[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-brand-accent-soft ' +
  '[&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-brand-bg ' +
  '[&::-webkit-slider-thumb]:shadow-[0_1px_4px_rgba(0,0,0,0.5)] [&::-webkit-slider-thumb]:cursor-pointer ' +
  '[&::-moz-range-thumb]:w-3.25 [&::-moz-range-thumb]:h-3.25 [&::-moz-range-thumb]:rounded-full ' +
  '[&::-moz-range-thumb]:bg-brand-accent-soft [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-brand-bg ' +
  '[&::-moz-range-thumb]:cursor-pointer';
const HEX = 'pa-ps-hex font-mono text-[10.5px] text-brand-faint';
const SWATCH =
  'pa-ps-swatch w-7.5 h-7.5 p-0.5 border border-white/12 rounded-lg bg-white/3 cursor-pointer';
const KEY =
  'pa-ps-key flex-none min-w-21.5 px-2.25 py-1.25 rounded-[7px] border border-white/10 bg-white/5 ' +
  'text-brand-accent-soft text-[11px] font-semibold whitespace-nowrap text-center cursor-pointer ' +
  'transition-colors duration-130 hover:bg-white/9 hover:border-white/18 ' +
  'data-[capturing=true]:bg-brand-danger/[0.12] data-[capturing=true]:border-brand-danger ' +
  'data-[capturing=true]:text-brand-danger-soft data-[capturing=true]:animate-pulse ' +
  'data-[conflict=true]:border-brand-warning data-[conflict=true]:text-brand-warning-soft';
const DELETE =
  'pa-ps-delete flex-none px-2.25 py-1.25 rounded-[7px] border border-brand-danger/35 bg-brand-danger/10 ' +
  'text-brand-danger-soft text-[11px] font-semibold cursor-pointer transition-colors duration-130 ' +
  'hover:bg-brand-danger/20 hover:border-brand-danger/50';
const BTN =
  'pa-ps-btn w-full px-3 py-2.25 rounded-[9px] border border-white/10 bg-white/6 text-brand-text ' +
  'text-xs font-semibold cursor-pointer transition-colors duration-130 hover:bg-white/10 hover:border-white/18';
const BTN_DASHED =
  'pa-ps-btn dashed w-full px-3 py-2.25 rounded-[9px] border border-dashed border-white/[0.14] ' +
  'bg-white/3 text-brand-muted text-xs font-semibold cursor-pointer transition-colors duration-130 ' +
  'hover:bg-white/6 hover:text-brand-text';
const ACTIONS = 'pa-ps-actions flex flex-col gap-2 p-3';
const STATUS = 'pa-ps-status min-h-3.5 text-[11px] text-brand-accent-soft';

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
  return el('div', CARD);
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
  private savedPagesStatus!: HTMLElement;
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
      delete btn.dataset.capturing;
      delete btn.dataset.conflict;
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
    const wrap = el('section', SECTION);
    const head = el('div', 'flex flex-col gap-0.5');
    head.appendChild(el('h3', SECTION_TITLE, title));
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
        'Otherwise the drawing toolbar starts docked to the left edge',
        !!this.settings.isToolbarOpen,
        (checked) => {
          this.settings.isToolbarOpen = checked;
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

    const nav = el('button', NAV_ROW);
    nav.type = 'button';
    nav.setAttribute('aria-label', 'Open keyboard shortcut settings');

    const info = el('div', ROW_TEXT);
    info.appendChild(el('span', ROW_TITLE, 'Customize shortcuts'));
    info.appendChild(
      el('span', ROW_DESC, `Rebind the ${SHORTCUT_DEFINITIONS.length} shortcuts for tools and actions`),
    );
    nav.appendChild(info);
    nav.appendChild(el('span', NAV_CHEVRON, CHEVRON_RIGHT));
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
    const section = el('section', SECTION);

    const head = el('div', SUBHEAD);
    const back = el('button', BACK, CHEVRON_LEFT);
    back.type = 'button';
    back.setAttribute('aria-label', 'Back to settings');
    back.addEventListener('click', async () => {
      await this.mount();
      this.root
        .querySelector<HTMLButtonElement>('[aria-label="Open keyboard shortcut settings"]')
        ?.focus();
    });
    head.appendChild(back);
    head.appendChild(el('h3', SECTION_TITLE, 'Keyboard shortcuts'));
    section.appendChild(head);

    this.shortcutsRoot = card();
    this.buildShortcutRows();
    section.appendChild(this.shortcutsRoot);

    const reset = el('button', LINK_BTN, 'Reset shortcuts to default');
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
      const row = el('div', ROW);

      const info = el('div', ROW_TEXT);
      info.appendChild(el('div', ROW_TITLE, def.name));
      info.appendChild(el('div', ROW_DESC, def.description));
      row.appendChild(info);

      const key = this.settings.shortcuts[def.id] || def.defaultKey;
      const badge = el('button', KEY);
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
    delete badge.dataset.conflict;
    badge.dataset.capturing = 'true';
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
      delete badge.dataset.capturing;
      badge.textContent = formatShortcutForDisplay(combo);
      badge.setAttribute('aria-label', `Rebind ${name}. Current shortcut ${formatShortcutForDisplay(combo)}`);

      if (conflict) {
        badge.dataset.conflict = 'true';
        badge.title = `Warning: "${combo}" conflicts with ${conflict.browser} (${conflict.action}).`;
        this.announce(`Shortcut set to ${combo}. Warning: conflicts with ${conflict.browser}`);
      } else {
        delete badge.dataset.conflict;
        badge.title = 'Click to record a new keystroke';
        this.announce(`Shortcut for ${name} set to ${combo}`);
      }
    });
  }

  private async renderSavedPages(): Promise<void> {
    const section = this.section('Saved pages');
    const box = card();

    const nav = el('button', NAV_ROW);
    nav.type = 'button';
    nav.setAttribute('aria-label', 'Open saved pages');

    const info = el('div', ROW_TEXT);
    info.appendChild(el('span', ROW_TITLE, 'Manage saved pages'));
    const summary = el('span', ROW_DESC, 'Loading…');
    info.appendChild(summary);
    nav.appendChild(info);
    nav.appendChild(el('span', NAV_CHEVRON, CHEVRON_RIGHT));
    nav.addEventListener('click', () => void this.openSavedPagesList());

    box.appendChild(nav);
    section.appendChild(box);
    this.root.appendChild(section);

    summary.textContent = this.describeSavedPages(await getAllSavedPagesSummary());
  }

  private describeSavedPages(pages: PageMetadataSummary[]): string {
    if (pages.length === 0) return 'Nothing saved yet';
    const total = pages.reduce((sum, page) => sum + (page.bytes ?? 0), 0);
    return `${pages.length} page${pages.length === 1 ? '' : 's'} · ${formatBytes(total)} stored`;
  }

  private describeSavedPage(page: PageMetadataSummary): string {
    const elements = `${page.elementCount} element${page.elementCount === 1 ? '' : 's'}`;
    return `${elements} · ${formatBytes(page.bytes ?? 0)}`;
  }

  private async openSavedPagesList(): Promise<void> {
    this.dispose();

    this.root.replaceChildren();
    const section = el('section', SECTION);

    const head = el('div', SUBHEAD);
    const back = el('button', BACK, CHEVRON_LEFT);
    back.type = 'button';
    back.setAttribute('aria-label', 'Back to settings');
    back.addEventListener('click', async () => {
      await this.mount();
      this.root.querySelector<HTMLButtonElement>('[aria-label="Open saved pages"]')?.focus();
    });
    head.appendChild(back);
    head.appendChild(el('h3', SECTION_TITLE, 'Saved pages'));
    section.appendChild(head);

    this.savedPagesRoot = card();
    section.appendChild(this.savedPagesRoot);

    this.savedPagesStatus = el('p', STATUS);
    this.savedPagesStatus.setAttribute('role', 'status');
    this.savedPagesStatus.setAttribute('aria-live', 'polite');
    section.appendChild(this.savedPagesStatus);

    this.root.appendChild(section);

    await this.refreshSavedPages();
    back.focus();
  }

  private async refreshSavedPages(): Promise<void> {
    const pages = await getAllSavedPagesSummary();
    this.savedPagesRoot.replaceChildren();

    if (pages.length === 0) {
      const empty = el('div', ROW);
      empty.appendChild(el('span', ROW_DESC, 'Nothing saved yet. Draw on any page and it will appear here.'));
      this.savedPagesRoot.appendChild(empty);
      this.savedPagesStatus.textContent = '';
      return;
    }

    pages.forEach((page) => {
      const row = el('div', ROW);

      const info = el('div', ROW_TEXT);
      info.appendChild(
        el('div', ROW_TITLE, page.pageTitle || 'Untitled page'),
      );
      info.appendChild(el('div', ROW_DESC, page.url));
      info.appendChild(el('div', ROW_DESC, this.describeSavedPage(page)));
      row.appendChild(info);

      const del = el('button', DELETE, 'Delete');
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

    const total = pages.reduce((sum, page) => sum + (page.bytes ?? 0), 0);
    this.savedPagesStatus.textContent = `${pages.length} page${pages.length === 1 ? '' : 's'} · ${formatBytes(total)} stored in this browser`;
  }

  private renderBackup(): void {
    const section = this.section('Backup & restore');
    const box = card();
    const actions = el('div', ACTIONS);

    const exportBtn = el('button', BTN, 'Download backup (.json)');
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

    const importBtn = el('button', BTN_DASHED, 'Restore from backup');
    importBtn.type = 'button';
    importBtn.addEventListener('click', () => this.fileInput.click());
    actions.appendChild(importBtn);

    this.statusEl = el('p', STATUS);
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
    const row = el('div', ROW);

    const info = el('div', ROW_TEXT);
    info.appendChild(el('span', ROW_TITLE, label));
    const hex = el('span', HEX, value);
    info.appendChild(hex);
    row.appendChild(info);

    const input = el('input', SWATCH);
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
    const field = el('div', FIELD);

    const head = el('div', FIELD_HEAD);
    head.appendChild(el('span', FIELD_LABEL, label));
    const readout = el('span', FIELD_READOUT, `${value}${unit}`);
    head.appendChild(readout);
    field.appendChild(head);

    const input = el('input', RANGE);
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
    const row = el('div', ROW);

    const info = el('div', ROW_TEXT);
    info.appendChild(el('span', ROW_TITLE, label));
    info.appendChild(el('span', ROW_DESC, hint));
    row.appendChild(info);

    const control = el('div', CONTROL);
    const switchLabel = el('label', SWITCH);
    const input = el('input', SWITCH_INPUT);
    input.type = 'checkbox';
    input.checked = checked;
    input.setAttribute('aria-label', label);
    input.addEventListener('change', () => onChange(input.checked));

    const track = el('span', SWITCH_TRACK);
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
    const field = el('div', FIELD);
    field.appendChild(el('span', FIELD_LABEL, label));

    const wrap = el('div', 'relative');
    const select = el('select', SELECT);
    select.setAttribute('aria-label', label);
    options.forEach(([optionValue, optionLabel]) => {
      const option = el('option', undefined, optionLabel);
      option.value = optionValue;
      option.selected = optionValue === value;
      select.appendChild(option);
    });
    select.addEventListener('change', () => onChange(select.value));
    wrap.appendChild(select);
    wrap.insertAdjacentHTML('beforeend', CHEVRON_DOWN);
    field.appendChild(wrap);

    return field;
  }
}
