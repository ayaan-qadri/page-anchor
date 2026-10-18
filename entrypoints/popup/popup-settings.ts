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

/** Creates a typed element with optional class list and initial innerHTML. */
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

const ROW =
  'flex items-center justify-between gap-3 p-3 bg-white/[0.03] border border-white/[0.07] rounded-[10px]';
const LABEL = 'text-[12px] font-semibold text-brand-text';
const HINT = 'text-[11px] text-brand-faint leading-snug';
const SELECT =
  'w-full bg-white/[0.04] border border-white/[0.09] hover:border-white/[0.16] text-brand-text text-[12px] px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-brand-ring [&>option]:bg-brand-surface [&>option]:text-brand-text';
const RANGE = 'w-full accent-brand-accent cursor-pointer';
const CHECKBOX = 'w-4 h-4 accent-brand-accent cursor-pointer shrink-0';
const BADGE_IDLE = 'border-white/[0.1] text-brand-accent-soft bg-white/[0.05] hover:bg-white/[0.08]';

/**
 * Renders the full settings surface inside the extension popup, mirroring the
 * Form Secretary pattern: the popup swaps to a scrollable settings panel
 * instead of opening a separate tab. Changes are saved as they are made.
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

  /** Cancels any in-flight shortcut recording and restores the idle badge state. */
  public dispose(): void {
    this.recorder.stop();
    if (this.recordingButton) {
      const btn = this.recordingButton;
      const id = btn.dataset.shortcutId as ShortcutAction | undefined;
      const def = SHORTCUT_DEFINITIONS.find((d) => d.id === id);
      const key = (id && this.settings?.shortcuts[id]) || def?.defaultKey || '';
      btn.classList.remove(
        'recording',
        'border-brand-danger',
        'text-brand-danger-soft',
        'animate-pulse',
        'border-amber-500',
        'text-amber-400',
      );
      btn.classList.add(...BADGE_IDLE.split(' '));
      if (key) btn.textContent = formatShortcutForDisplay(key);
      this.recordingButton = null;
    }
  }

  private persist(): void {
    saveSettings(this.settings).catch(() => {
      this.announce('Could not save settings');
    });
  }

  /** Builds a titled section shell that callers append controls to. */
  private section(title: string, subtitle?: string): HTMLElement {
    const wrap = el('section', 'pa-ps-section flex flex-col gap-2.5');
    const head = el('div', 'flex flex-col gap-0.5');
    head.appendChild(
      el('h3', 'text-[11px] font-semibold uppercase tracking-[0.08em] text-brand-faint', title),
    );
    if (subtitle) head.appendChild(el('p', HINT, subtitle));
    wrap.appendChild(head);
    return wrap;
  }

  private renderDrawingDefaults(): void {
    const section = this.section('Drawing defaults');

    section.appendChild(
      this.colorField('Pen colour', this.settings.defaultStrokeColor, (value) => {
        this.settings.defaultStrokeColor = value;
        this.persist();
      }),
    );
    section.appendChild(
      this.rangeField('Pen width', 1, 30, this.settings.defaultStrokeWidth, 'px', (value) => {
        this.settings.defaultStrokeWidth = value;
        this.persist();
      }),
    );
    section.appendChild(
      this.colorField('Highlighter colour', this.settings.defaultHighlighterColor, (value) => {
        this.settings.defaultHighlighterColor = value;
        this.persist();
      }),
    );
    section.appendChild(
      this.rangeField('Highlighter width', 8, 50, this.settings.defaultHighlighterWidth, 'px', (value) => {
        this.settings.defaultHighlighterWidth = value;
        this.persist();
      }),
    );
    section.appendChild(
      this.rangeField('Text note size', 12, 36, this.settings.defaultFontSize, 'px', (value) => {
        this.settings.defaultFontSize = value;
        this.persist();
      }),
    );

    this.root.appendChild(section);
  }

  private renderPersistence(): void {
    const section = this.section('Persistence & matching');

    section.appendChild(
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

    section.appendChild(
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

    section.appendChild(
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
    section.appendChild(
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
    section.appendChild(
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
    section.appendChild(
      this.checkField(
        'Zero-lag performance mode',
        'Frustum culling and stroke smoothing on busy pages',
        this.settings.performanceMode,
        (checked) => {
          this.settings.performanceMode = checked;
          this.persist();
        },
      ),
    );

    this.root.appendChild(section);
  }

  private renderShortcuts(): void {
    const section = this.section('Keyboard shortcuts', 'Click a key to rebind. Press Esc to cancel.');

    this.shortcutsRoot = el('div', 'flex flex-col gap-1.5');
    this.buildShortcutRows();
    section.appendChild(this.shortcutsRoot);

    const reset = el(
      'button',
      'self-start text-[11px] font-semibold text-brand-muted hover:text-brand-text underline decoration-white/20 hover:decoration-white/40 transition-colors cursor-pointer',
      'Reset shortcuts to default',
    );
    reset.type = 'button';
    reset.addEventListener('click', () => {
      this.settings.shortcuts = { ...DEFAULT_SETTINGS.shortcuts };
      this.persist();
      this.buildShortcutRows();
      this.announce('Shortcuts reset to defaults');
    });
    section.appendChild(reset);

    this.root.appendChild(section);
  }

  private buildShortcutRows(): void {
    this.shortcutsRoot.replaceChildren();

    SHORTCUT_DEFINITIONS.forEach((def) => {
      const row = el(
        'div',
        'flex items-center justify-between gap-3 py-2 px-2.5 bg-white/[0.03] border border-white/[0.07] rounded-lg',
      );

      const info = el('div', 'flex flex-col gap-0.5 min-w-0');
      info.appendChild(el('div', 'text-[12px] font-medium text-brand-text truncate', def.name));
      info.appendChild(el('div', 'text-[10px] text-brand-faint truncate', def.description));
      row.appendChild(info);

      const key = this.settings.shortcuts[def.id] || def.defaultKey;
      const badge = el(
        'button',
        `pa-ps-key shrink-0 min-w-[84px] px-2.5 py-1 rounded-md border text-[11px] font-mono font-semibold text-center transition-colors cursor-pointer ${BADGE_IDLE}`,
      );
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
    badge.classList.remove('border-white/[0.1]', 'text-brand-accent-soft', 'bg-white/[0.05]', 'hover:bg-white/[0.08]');
    badge.classList.add('recording', 'border-brand-danger', 'text-brand-danger-soft', 'animate-pulse');
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
      badge.classList.remove('recording', 'border-brand-danger', 'text-brand-danger-soft', 'animate-pulse');
      badge.textContent = formatShortcutForDisplay(combo);
      badge.setAttribute('aria-label', `Rebind ${name}. Current shortcut ${formatShortcutForDisplay(combo)}`);

      if (conflict) {
        badge.classList.remove(...BADGE_IDLE.split(' '));
        badge.classList.add('border-amber-500', 'text-amber-400');
        badge.title = `Warning: "${combo}" conflicts with ${conflict.browser} (${conflict.action}).`;
        this.announce(`Shortcut set to ${combo}. Warning: conflicts with ${conflict.browser}`);
      } else {
        badge.classList.add(...BADGE_IDLE.split(' '));
        badge.title = 'Click to record a new keystroke';
        this.announce(`Shortcut for ${name} set to ${combo}`);
      }
    });
  }

  private async renderSavedPages(): Promise<void> {
    const section = this.section('Saved pages');
    this.savedPagesRoot = el('div', 'flex flex-col gap-1.5');
    section.appendChild(this.savedPagesRoot);
    this.root.appendChild(section);
    await this.refreshSavedPages();
  }

  private async refreshSavedPages(): Promise<void> {
    const pages = await getAllSavedPagesSummary();
    this.savedPagesRoot.replaceChildren();

    if (pages.length === 0) {
      this.savedPagesRoot.appendChild(
        el('p', HINT, 'Nothing saved yet. Draw on any page and it will appear here.'),
      );
      return;
    }

    pages.forEach((page) => {
      const row = el(
        'div',
        'flex items-center justify-between gap-2.5 p-2.5 bg-white/[0.03] border border-white/[0.07] rounded-lg',
      );

      const info = el('div', 'flex flex-col gap-0.5 min-w-0');
      info.appendChild(
        el('div', 'text-[12px] font-medium text-brand-text truncate', page.pageTitle || 'Untitled page'),
      );
      info.appendChild(el('div', 'text-[10px] text-brand-faint truncate', page.url));
      info.appendChild(
        el('div', 'text-[10px] text-brand-faint', `${page.elementCount} element${page.elementCount === 1 ? '' : 's'}`),
      );
      row.appendChild(info);

      const del = el(
        'button',
        'shrink-0 px-2 py-1 rounded-md border border-brand-danger/35 bg-brand-danger/10 text-brand-danger-soft text-[11px] font-semibold cursor-pointer hover:bg-brand-danger/20 transition-colors',
        'Delete',
      );
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

    const exportBtn = el(
      'button',
      'w-full px-3 py-2 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.09] text-[12px] font-semibold text-brand-text transition-colors cursor-pointer',
      'Download backup (.json)',
    );
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
    section.appendChild(exportBtn);

    this.fileInput = el('input', 'hidden');
    this.fileInput.type = 'file';
    this.fileInput.accept = '.json,application/json';
    this.fileInput.setAttribute('aria-label', 'Choose a JSON backup file to restore');
    this.fileInput.addEventListener('change', () => {
      void this.importBackup();
    });
    section.appendChild(this.fileInput);

    const importBtn = el(
      'button',
      'w-full px-3 py-2 rounded-lg bg-white/[0.03] hover:bg-white/[0.06] border border-dashed border-white/[0.14] text-[12px] font-semibold text-brand-muted transition-colors cursor-pointer',
      'Restore from backup',
    );
    importBtn.type = 'button';
    importBtn.addEventListener('click', () => this.fileInput.click());
    section.appendChild(importBtn);

    this.statusEl = el('p', 'text-[11px] text-brand-accent-soft min-h-[14px]');
    this.statusEl.setAttribute('role', 'status');
    this.statusEl.setAttribute('aria-live', 'polite');
    section.appendChild(this.statusEl);

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

    const info = el('div', 'flex flex-col gap-0.5');
    info.appendChild(el('span', LABEL, label));
    const hex = el('span', 'font-mono text-[11px] text-brand-faint', value);
    info.appendChild(hex);
    row.appendChild(info);

    const input = el(
      'input',
      'w-8 h-8 p-0.5 rounded-lg border border-white/[0.12] bg-white/[0.03] cursor-pointer',
    );
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
    const wrap = el('div', 'flex flex-col gap-2');

    const head = el('div', 'flex items-center justify-between');
    head.appendChild(el('span', LABEL, label));
    const readout = el('span', 'font-mono text-[11px] text-brand-accent-soft', `${value}${unit}`);
    head.appendChild(readout);
    wrap.appendChild(head);

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
    wrap.appendChild(input);

    return wrap;
  }

  private checkField(
    label: string,
    hint: string,
    checked: boolean,
    onChange: (checked: boolean) => void,
  ): HTMLElement {
    const row = el('label', `${ROW} cursor-pointer`);

    const info = el('div', 'flex flex-col gap-0.5 pr-2');
    info.appendChild(el('span', LABEL, label));
    info.appendChild(el('span', HINT, hint));
    row.appendChild(info);

    const input = el('input', CHECKBOX);
    input.type = 'checkbox';
    input.checked = checked;
    input.setAttribute('aria-label', label);
    input.addEventListener('change', () => onChange(input.checked));
    row.appendChild(input);

    return row;
  }

  private selectField(
    label: string,
    value: string,
    options: Array<[string, string]>,
    onChange: (value: string) => void,
  ): HTMLElement {
    const wrap = el('div', 'flex flex-col gap-1.5');
    wrap.appendChild(el('span', LABEL, label));

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

    return wrap;
  }
}
