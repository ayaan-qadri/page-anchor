import { CanvasEngine } from '../core/engine';
import { HistoryManager } from '../core/history';
import { ToolType } from '../types/engine.types';
import { ExtensionSettings } from '../types/storage.types';
import { ToolbarCallbacks } from '../types/ui.types';
import { ICONS } from '../icons/svg-icons';
import { TextEditorOverlay } from './text-editor';
import { formatShortcutForDisplay } from '../core/shortcuts';
import { DEFAULT_SETTINGS, saveSettings } from '../core/storage';

export type { ToolbarCallbacks };

const PRESET_COLORS = [
  '#ef4444',
  '#f97316',
  '#facc15',
  '#22c55e',
  '#06b6d4',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
  '#ffffff',
  '#000000',
];

export class FloatingToolbar {
  private container: HTMLElement;
  private engine: CanvasEngine;
  private history: HistoryManager;
  private textEditor: TextEditorOverlay;
  private settings: ExtensionSettings;
  private callbacks: ToolbarCallbacks;

  private wrapper: HTMLElement;
  private toolbar: HTMLElement;
  private dockPanel: HTMLElement;
  private dockTab: HTMLButtonElement;
  private dockBadge: HTMLElement;
  private dockClose: HTMLButtonElement;
  private colorPopover: HTMLElement;
  private colorPreviewBtn: HTMLElement;

  private isDragging = false;
  private dragOffset = { x: 0, y: 0 };
  private isDocked = false;

  constructor(
    container: HTMLElement,
    engine: CanvasEngine,
    history: HistoryManager,
    textEditor: TextEditorOverlay,
    settings: ExtensionSettings,
    callbacks: ToolbarCallbacks = {}
  ) {
    this.container = container;
    this.engine = engine;
    this.history = history;
    this.textEditor = textEditor;
    this.settings = settings;
    this.callbacks = callbacks;

    this.wrapper = document.createElement('div');
    this.wrapper.className = 'pa-toolbar-wrapper';
    this.wrapper.setAttribute('role', 'region');
    this.wrapper.setAttribute('aria-label', 'Page Anchor drawing toolbar');

    if (this.settings.toolbarPosition) {
      this.wrapper.style.left = `${this.settings.toolbarPosition.x}px`;
      this.wrapper.style.top = `${this.settings.toolbarPosition.y}px`;
    } else {
      this.wrapper.style.top = '24px';
      this.wrapper.style.left = '50%';
      this.wrapper.style.transform = 'translateX(-50%)';
    }

    this.toolbar = document.createElement('div');
    this.toolbar.className = 'pa-toolbar';
    this.toolbar.setAttribute('role', 'toolbar');
    this.toolbar.setAttribute('aria-label', 'Drawing tools');

    const shouldBeOpen = !!this.settings.isToolbarOpen;

    this.colorPopover = document.createElement('div');
    this.colorPopover.className = 'pa-popover';
    this.colorPopover.setAttribute('role', 'dialog');
    this.colorPopover.setAttribute('aria-label', 'Drawing defaults');

    this.colorPreviewBtn = document.createElement('button');
    (this.colorPreviewBtn as HTMLButtonElement).type = 'button';

    this.buildToolbarContent();

    this.dockPanel = document.createElement('div');
    this.dockPanel.className = 'pa-dock';

    this.dockTab = document.createElement('button');
    this.dockTab.type = 'button';
    this.dockTab.className = 'pa-dock-tab';
    this.dockTab.setAttribute('aria-label', 'Open drawing toolbar');
    this.dockTab.setAttribute('aria-expanded', shouldBeOpen ? 'true' : 'false');
    this.dockTab.title = 'Open drawing toolbar';
    this.dockTab.innerHTML = `
      ${ICONS.dragHandle}
      <span class="pa-dock-badge" style="display: none;" aria-label="Active annotations">0</span>
    `;
    this.dockBadge = this.dockTab.querySelector('.pa-dock-badge') as HTMLElement;
    this.dockPanel.appendChild(this.dockTab);

    this.dockClose = document.createElement('button');
    this.dockClose.type = 'button';
    this.dockClose.className = 'pa-dock-close';
    this.dockClose.setAttribute('aria-label', 'Hide toolbar');
    this.dockClose.title = 'Hide toolbar';
    this.dockClose.innerHTML = ICONS.close;
    this.dockPanel.appendChild(this.dockClose);

    this.wrapper.appendChild(this.toolbar);
    this.wrapper.appendChild(this.colorPopover);
    this.wrapper.appendChild(this.dockPanel);
    this.container.appendChild(this.wrapper);

    this.initDragEvents();
    this.bindDockEvents();
    this.applyDrawingDefaults();
    this.updateActiveToolUI();
    this.updateHistoryButtons();
    this.updateBadge();

    if (this.settings.isToolbarHidden) {
      this.hideToolbar(false);
    } else {
      this.setDrawingMode(shouldBeOpen, false);
    }

    if (this.settings.areAnnotationsVisible !== undefined) {
      this.engine.setAnnotationsVisible(this.settings.areAnnotationsVisible);
    }

    window.addEventListener('resize', () => {
      if (this.wrapper.style.display !== 'none') {
        this.ensureVisibleInViewport();
      }
    }, { passive: true });
  }

  public setSettings(settings: ExtensionSettings): void {
    this.settings = settings;
    this.applyDrawingDefaults();
    this.syncDrawingDefaultControls();
    this.updateTooltips();
    if (settings.areAnnotationsVisible !== undefined) {
      this.engine.setAnnotationsVisible(settings.areAnnotationsVisible);
    }
    if (settings.orphanedAnchorMode !== undefined) {
      this.engine.setOrphanedAnchorMode(settings.orphanedAnchorMode);
    }
    if (settings.strokeSimplification !== undefined) {
      this.engine.setStrokeSimplification(settings.strokeSimplification);
    }
    if (settings.isToolbarHidden) {
      this.hideToolbar(false);
    } else {
      this.setDrawingMode(!!settings.isToolbarOpen, false);
    }
  }

  public updateBadge(): void {
    const count = this.engine.getElements().length;
    if (!this.dockBadge) return;
    if (count > 0) {
      this.dockBadge.textContent = `${count}`;
      this.dockBadge.style.display = 'inline-block';
    } else {
      this.dockBadge.style.display = 'none';
    }
  }

  public updateHistoryButtons(): void {
    const undoBtn = this.toolbar.querySelector('[data-action="undo"]') as HTMLButtonElement;
    const redoBtn = this.toolbar.querySelector('[data-action="redo"]') as HTMLButtonElement;
    if (undoBtn) {
      const canUndo = this.history.canUndo();
      undoBtn.disabled = !canUndo;
      undoBtn.setAttribute('aria-disabled', canUndo ? 'false' : 'true');
    }
    if (redoBtn) {
      const canRedo = this.history.canRedo();
      redoBtn.disabled = !canRedo;
      redoBtn.setAttribute('aria-disabled', canRedo ? 'false' : 'true');
    }
  }

  public setDrawingMode(active: boolean, persist = true): void {
    this.engine.setActiveMode(active);
    if (active) {
      this.expandToolbar();
    } else {
      this.dockToolbar();
    }
    if (persist) {
      this.settings.isToolbarOpen = active;
      saveSettings({ isToolbarOpen: active, isToolbarHidden: false }).catch(() => {});
    }
    this.callbacks.onToggleActive?.(active);
  }

  /**
   * Removes the toolbar entirely, dock tab included. Unlike docking, nothing
   * stays on the page — use the extension icon or a shortcut to bring it back.
   */
  public hideToolbar(persist = true): void {
    this.engine.setActiveMode(false);
    this.isDocked = false;
    this.settings.isToolbarHidden = true;
    this.wrapper.classList.remove('docked');
    this.wrapper.style.display = 'none';
    this.colorPopover.classList.remove('open');
    this.colorPreviewBtn.setAttribute('aria-expanded', 'false');
    if (persist) {
      this.settings.isToolbarOpen = false;
      saveSettings({ isToolbarOpen: false, isToolbarHidden: true }).catch(() => {});
    }
    this.updateDockUI();
    this.callbacks.onToggleActive?.(false);
  }

  private showWrapper(): void {
    this.settings.isToolbarHidden = false;
    this.wrapper.style.display = 'block';
  }

  /** Collapses the toolbar into the left-edge dock tab. */
  private dockToolbar(): void {
    this.colorPopover.classList.remove('open');
    this.colorPreviewBtn.setAttribute('aria-expanded', 'false');
    this.showWrapper();

    if (this.isDocked) {
      this.updateDockUI();
      return;
    }

    const rect = this.wrapper.getBoundingClientRect();
    let top = rect.top;
    if (!top && this.settings.toolbarPosition) top = this.settings.toolbarPosition.y;
    if (!Number.isFinite(top) || top <= 0) top = 24;

    this.isDocked = true;
    this.wrapper.classList.add('docked');
    this.wrapper.style.transform = 'none';
    this.wrapper.style.left = '0px';
    this.wrapper.style.top = `${this.clampDockTop(top)}px`;
    this.updateDockUI();
  }

  /** Restores the toolbar to the position it was docked from. */
  private expandToolbar(): void {
    this.showWrapper();

    if (!this.isDocked) {
      this.updateDockUI();
      this.ensureVisibleInViewport();
      return;
    }

    this.isDocked = false;
    this.wrapper.classList.remove('docked');

    if (this.settings.toolbarPosition) {
      this.wrapper.style.transform = 'none';
      this.wrapper.style.left = `${this.settings.toolbarPosition.x}px`;
      this.wrapper.style.top = `${this.settings.toolbarPosition.y}px`;
    } else {
      this.wrapper.style.transform = 'translateX(-50%)';
      this.wrapper.style.left = '50%';
      this.wrapper.style.top = '24px';
    }

    this.updateDockUI();
    this.ensureVisibleInViewport();
  }

  private clampDockTop(top: number): number {
    const height = this.dockTab?.offsetHeight || 44;
    return Math.max(10, Math.min(Math.max(10, window.innerHeight - height - 10), top));
  }

  private updateDockUI(): void {
    this.wrapper.classList.toggle('docked', this.isDocked);
    this.dockTab.setAttribute('aria-expanded', this.isDocked ? 'false' : 'true');
    this.dockTab.setAttribute('aria-label', this.isDocked ? 'Open drawing toolbar' : 'Collapse drawing toolbar');
    const dragHandle = this.toolbar.querySelector('.pa-drag-handle') as HTMLElement | null;
    dragHandle?.setAttribute('aria-expanded', this.isDocked ? 'false' : 'true');
  }

  public ensureVisibleInViewport(): void {
    if (!this.wrapper || this.wrapper.style.display === 'none') return;
    if (this.isDocked) return;
    if (!this.settings.toolbarPosition) return;

    const rect = this.wrapper.getBoundingClientRect();
    const w = rect.width || 440;
    const h = rect.height || 50;
    const padding = 10;

    const maxX = Math.max(padding, window.innerWidth - w - padding);
    const maxY = Math.max(padding, window.innerHeight - h - padding);

    const curLeft = parseFloat(this.wrapper.style.left) || rect.left;
    const curTop = parseFloat(this.wrapper.style.top) || rect.top;

    const clampX = Math.max(padding, Math.min(maxX, curLeft));
    const clampY = Math.max(padding, Math.min(maxY, curTop));

    if (curLeft !== clampX || curTop !== clampY) {
      this.wrapper.style.transform = 'none';
      this.wrapper.style.left = `${clampX}px`;
      this.wrapper.style.top = `${clampY}px`;
      this.settings.toolbarPosition = { x: clampX, y: clampY };
    }
  }

  public toggleDrawingMode(persist = true): void {
    const newState = !this.engine.getActiveMode();
    this.setDrawingMode(newState, persist);
  }

  /**
   * Docks the toolbar to the left edge, or restores it to the position it was
   * docked from. The dock tab is the collapsed representation of the toolbar,
   * so collapsing also parks drawing mode until the toolbar is restored.
   */
  public toggleToolbarVisibility(): void {
    this.toggleDrawingMode();
  }

  private buildToolbarContent(): void {
    const dragHandle = document.createElement('div');
    dragHandle.className = 'pa-drag-handle';
    dragHandle.setAttribute('role', 'button');
    dragHandle.setAttribute('tabindex', '0');
    dragHandle.setAttribute('aria-expanded', 'true');
    dragHandle.setAttribute('aria-label', 'Move toolbar position. Drag or use arrow keys.');
    dragHandle.title = 'Move toolbar position (Arrow keys or drag)';
    dragHandle.innerHTML = ICONS.dragHandle;
    this.toolbar.appendChild(dragHandle);

    this.toolbar.appendChild(this.createToolButton('select', 'Select & Move', 'tool-select', ICONS.select));

    this.toolbar.appendChild(
      this.createActionButton(
        'select-all',
        'Select All to Move',
        'action-select-all',
        ICONS.selectAll,
        () => {
          this.engine.selectAll();
          this.updateActiveToolUI();
        }
      )
    );

    this.toolbar.appendChild(this.createSeparator());

    this.toolbar.appendChild(this.createToolButton('pen', 'Pen', 'tool-pen', ICONS.pen));
    this.toolbar.appendChild(this.createToolButton('highlighter', 'Highlighter', 'tool-highlighter', ICONS.highlighter));

    this.toolbar.appendChild(this.createToolButton('rect', 'Rectangle', 'tool-rect', ICONS.rect));
    this.toolbar.appendChild(this.createToolButton('circle', 'Circle', 'tool-circle', ICONS.circle));
    this.toolbar.appendChild(this.createToolButton('line', 'Line', 'tool-line', ICONS.line));
    this.toolbar.appendChild(this.createToolButton('arrow', 'Arrow', 'tool-arrow', ICONS.arrow));
    this.toolbar.appendChild(this.createToolButton('double-arrow', 'Double Arrow', 'tool-double-arrow', ICONS.doubleArrow));

    this.toolbar.appendChild(this.createToolButton('text', 'Text Note', 'tool-text', ICONS.text));
    this.toolbar.appendChild(this.createToolButton('eraser', 'Eraser', 'tool-eraser', ICONS.eraser));

    this.toolbar.appendChild(this.createSeparator());

    this.colorPreviewBtn.className = 'pa-color-preview-btn';
    this.colorPreviewBtn.style.backgroundColor = this.settings.defaultStrokeColor;
    this.colorPreviewBtn.title = 'Drawing defaults';
    this.colorPreviewBtn.setAttribute('aria-label', 'Drawing defaults');
    this.colorPreviewBtn.setAttribute('aria-haspopup', 'dialog');
    this.colorPreviewBtn.setAttribute('aria-expanded', 'false');
    this.colorPreviewBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleColorPopover();
    });
    this.toolbar.appendChild(this.colorPreviewBtn);

    this.buildColorPopover();

    this.toolbar.appendChild(this.createSeparator());

    const undoBtn = this.createActionButton('undo', 'Undo', 'action-undo', ICONS.undo, () => {
      const prev = this.history.undo();
      if (prev !== null) {
        this.engine.setElements(prev);
        this.updateHistoryButtons();
        this.updateBadge();
        this.callbacks.onClear?.();
      }
    });
    this.toolbar.appendChild(undoBtn);

    const redoBtn = this.createActionButton('redo', 'Redo', 'action-redo', ICONS.redo, () => {
      const next = this.history.redo();
      if (next !== null) {
        this.engine.setElements(next);
        this.updateHistoryButtons();
        this.updateBadge();
        this.callbacks.onClear?.();
      }
    });
    this.toolbar.appendChild(redoBtn);

    const clearBtn = this.createActionButton('clear', 'Clear Page', 'action-clear', ICONS.trash, () => {
      if (confirm('Clear all drawings on this page?')) {
        this.history.pushState([]);
        this.engine.clear();
        this.updateHistoryButtons();
        this.updateBadge();
        this.callbacks.onClear?.();
      }
    });
    this.toolbar.appendChild(clearBtn);

    const exportBtn = this.createActionButton('export', 'Export drawings (PNG)', 'action-export', ICONS.download, () => {
      this.callbacks.onExport?.();
    });
    this.toolbar.appendChild(exportBtn);

    const isVisible = this.engine.getAnnotationsVisible();
    const eyeBtn = this.createActionButton(
      'visibility',
      isVisible ? 'Hide Drawings' : 'Show Drawings',
      '',
      isVisible ? ICONS.eye : ICONS.eyeOff,
      () => {
        const next = !this.engine.getAnnotationsVisible();
        this.engine.setAnnotationsVisible(next);
        this.settings.areAnnotationsVisible = next;
        saveSettings({ areAnnotationsVisible: next }).catch(() => {});
        eyeBtn.setAttribute('aria-pressed', next ? 'true' : 'false');
        const eyeLabel = next ? 'Hide Drawings' : 'Show Drawings';
        eyeBtn.dataset.label = eyeLabel;
        eyeBtn.setAttribute('aria-label', eyeLabel);
        eyeBtn.innerHTML = `${next ? ICONS.eye : ICONS.eyeOff}<span class="pa-tooltip" aria-hidden="true">${eyeLabel}</span>`;
      }
    );
    eyeBtn.setAttribute('aria-pressed', isVisible ? 'true' : 'false');
    this.toolbar.appendChild(eyeBtn);

    const isAnchoring = this.engine.getDomAnchoringEnabled();
    const anchorBtn = this.createActionButton(
      'dom-anchor',
      isAnchoring ? 'Smart Anchoring: ON (Follows moving items)' : 'Smart Anchoring: OFF (Fixed position)',
      '',
      ICONS.anchor,
      () => {
        const next = !this.engine.getDomAnchoringEnabled();
        this.engine.setDomAnchoringEnabled(next);
        this.callbacks.onToggleDomAnchoring?.(next);
        const label = next ? 'Smart Anchoring: ON (Follows moving items)' : 'Smart Anchoring: OFF (Fixed position)';
        anchorBtn.dataset.label = label;
        anchorBtn.setAttribute('aria-pressed', next ? 'true' : 'false');
        anchorBtn.setAttribute('aria-label', label);
        anchorBtn.classList.toggle('active', next);
        anchorBtn.innerHTML = `${ICONS.anchor}<span class="pa-tooltip" aria-hidden="true">${label}</span>`;
      }
    );
    anchorBtn.setAttribute('aria-pressed', isAnchoring ? 'true' : 'false');
    anchorBtn.classList.toggle('active', isAnchoring);
    this.toolbar.appendChild(anchorBtn);

    const dockBtn = this.createActionButton('dock', 'Dock to Left Edge', '', ICONS.minimize, () => {
      this.setDrawingMode(false);
    });
    this.toolbar.appendChild(dockBtn);

    const closeBtn = this.createActionButton('hide', 'Hide Toolbar', '', ICONS.close, () => {
      this.hideToolbar();
    });
    this.toolbar.appendChild(closeBtn);
  }

  public updateDomAnchoringUI(enabled: boolean): void {
    const btn = this.toolbar.querySelector('[data-action="dom-anchor"]') as HTMLButtonElement | null;
    if (btn) {
      const label = enabled ? 'Smart Anchoring: ON (Follows moving items)' : 'Smart Anchoring: OFF (Fixed position)';
      btn.dataset.label = label;
      btn.setAttribute('aria-pressed', enabled ? 'true' : 'false');
      btn.setAttribute('aria-label', label);
      btn.classList.toggle('active', enabled);
      btn.innerHTML = `${ICONS.anchor}<span class="pa-tooltip" aria-hidden="true">${label}</span>`;
    }
  }

  private toggleColorPopover(): void {
    const isOpen = this.colorPopover.classList.toggle('open');
    this.colorPreviewBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    if (isOpen) this.positionColorPopover();
  }

  /** Flips the popover below the toolbar when there is not enough room above. */
  private positionColorPopover(): void {
    const roomAbove = this.wrapper.getBoundingClientRect().top;
    const height = this.colorPopover.offsetHeight;
    this.colorPopover.classList.toggle('below', roomAbove < height + 16);
  }

  private buildColorPopover(): void {
    const body = document.createElement('div');
    body.className = 'pa-popover-body';

    const grid = document.createElement('div');
    grid.className = 'pa-color-grid';
    grid.setAttribute('role', 'group');
    grid.setAttribute('aria-label', 'Preset pen colors');

    PRESET_COLORS.forEach((color) => {
      const swatch = document.createElement('button');
      swatch.type = 'button';
      const isActive = color === this.settings.defaultStrokeColor;
      swatch.className = `pa-color-swatch ${isActive ? 'active' : ''}`;
      swatch.style.backgroundColor = color;
      swatch.dataset.color = color;
      swatch.setAttribute('aria-label', `Color ${color}`);
      swatch.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      swatch.addEventListener('click', () => {
        this.updateDrawingDefaults({ defaultStrokeColor: color });
      });
      grid.appendChild(swatch);
    });
    body.appendChild(grid);

    body.appendChild(
      this.buildColorRow('Pen colour', 'defaultStrokeColor', this.settings.defaultStrokeColor)
    );
    body.appendChild(
      this.buildSliderField('Pen width', 'defaultStrokeWidth', 1, 30, this.settings.defaultStrokeWidth)
    );

    body.appendChild(this.buildPopoverDivider());

    body.appendChild(
      this.buildColorRow('Highlighter colour', 'defaultHighlighterColor', this.settings.defaultHighlighterColor)
    );
    body.appendChild(
      this.buildSliderField('Highlighter width', 'defaultHighlighterWidth', 8, 50, this.settings.defaultHighlighterWidth)
    );

    body.appendChild(this.buildPopoverDivider());

    body.appendChild(
      this.buildSliderField('Text note size', 'defaultFontSize', 12, 36, this.settings.defaultFontSize)
    );

    const footer = document.createElement('div');
    footer.className = 'pa-popover-footer';
    footer.appendChild(this.buildResetButton());

    this.colorPopover.appendChild(body);
    this.colorPopover.appendChild(footer);

    // Close only on a press that starts outside the toolbar. `composedPath()`
    // is required because events from inside the shadow root are retargeted to
    // the host at the window, which would make a `contains(target)` check fail
    // for every in-popover interaction. Listening on `pointerdown` (not `click`)
    // keeps the popover open when a slider drag ends outside of it.
    window.addEventListener(
      'pointerdown',
      (e) => {
        if (!e.composedPath().includes(this.wrapper)) {
          this.closeColorPopover();
        }
      },
      true
    );
  }

  private closeColorPopover(): void {
    this.colorPopover.classList.remove('open');
    this.colorPreviewBtn.setAttribute('aria-expanded', 'false');
  }

  /** A label + native color input pair inside the popover. */
  private buildColorRow(
    label: string,
    setting: 'defaultStrokeColor' | 'defaultHighlighterColor',
    value: string
  ): HTMLElement {
    const row = document.createElement('div');
    row.className = 'pa-popover-row';

    const name = document.createElement('span');
    name.className = 'pa-popover-label';
    name.textContent = label;

    const input = document.createElement('input');
    input.type = 'color';
    input.className = 'pa-popover-color';
    input.dataset.setting = setting;
    input.value = value;
    input.setAttribute('aria-label', label);
    input.addEventListener('input', () => {
      if (setting === 'defaultStrokeColor') {
        this.engine.setStrokeColor(input.value);
        this.colorPreviewBtn.style.backgroundColor = input.value;
      } else {
        this.engine.setHighlighterColor(input.value);
      }
    });
    input.addEventListener('change', () => {
      this.updateDrawingDefaults({ [setting]: input.value } as Partial<ExtensionSettings>);
    });

    row.appendChild(name);
    row.appendChild(input);
    return row;
  }

  /** A labelled slider with a live pixel readout inside the popover. */
  private buildSliderField(
    label: string,
    setting: 'defaultStrokeWidth' | 'defaultHighlighterWidth' | 'defaultFontSize',
    min: number,
    max: number,
    value: number
  ): HTMLElement {
    const group = document.createElement('div');
    group.className = 'pa-slider-group';

    const header = document.createElement('div');
    header.className = 'pa-slider-label';
    const name = document.createElement('span');
    name.textContent = label;
    const readout = document.createElement('span');
    readout.className = 'pa-slider-readout';
    readout.textContent = `${value}px`;
    header.appendChild(name);
    header.appendChild(readout);

    const input = document.createElement('input');
    input.type = 'range';
    input.className = 'pa-slider';
    input.dataset.setting = setting;
    input.min = `${min}`;
    input.max = `${max}`;
    input.value = `${value}`;
    input.setAttribute('aria-label', label);
    input.setAttribute('aria-valuemin', `${min}`);
    input.setAttribute('aria-valuemax', `${max}`);
    input.setAttribute('aria-valuenow', `${value}`);
    input.setAttribute('aria-valuetext', `${value} pixels`);

    const apply = (commit: boolean) => {
      const val = parseInt(input.value, 10);
      readout.textContent = `${val}px`;
      input.setAttribute('aria-valuenow', `${val}`);
      input.setAttribute('aria-valuetext', `${val} pixels`);
      if (setting === 'defaultStrokeWidth') this.engine.setStrokeWidth(val);
      else if (setting === 'defaultHighlighterWidth') this.engine.setHighlighterWidth(val);
      else this.engine.setFontSize(val);
      if (commit) this.updateDrawingDefaults({ [setting]: val } as Partial<ExtensionSettings>);
    };

    input.addEventListener('input', () => apply(false));
    input.addEventListener('change', () => apply(true));

    group.appendChild(header);
    group.appendChild(input);
    return group;
  }

  private buildPopoverDivider(): HTMLElement {
    const divider = document.createElement('div');
    divider.className = 'pa-popover-divider';
    divider.setAttribute('aria-hidden', 'true');
    return divider;
  }

  /** A button that restores every drawing default to its factory value. */
  private buildResetButton(): HTMLElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pa-popover-reset';
    button.textContent = 'Reset to defaults';
    button.setAttribute('aria-label', 'Reset drawing defaults to factory values');
    button.addEventListener('click', () => this.resetDrawingDefaults());
    return button;
  }

  /** Restores the five drawing defaults and repaints the popover controls. */
  private resetDrawingDefaults(): void {
    this.updateDrawingDefaults({
      defaultStrokeColor: DEFAULT_SETTINGS.defaultStrokeColor,
      defaultStrokeWidth: DEFAULT_SETTINGS.defaultStrokeWidth,
      defaultHighlighterColor: DEFAULT_SETTINGS.defaultHighlighterColor,
      defaultHighlighterWidth: DEFAULT_SETTINGS.defaultHighlighterWidth,
      defaultFontSize: DEFAULT_SETTINGS.defaultFontSize,
    });
    this.syncDrawingDefaultControls();
  }

  /** Pushes the stored drawing defaults into the engine. */
  private applyDrawingDefaults(): void {
    this.engine.setStrokeColor(this.settings.defaultStrokeColor);
    this.engine.setStrokeWidth(this.settings.defaultStrokeWidth);
    this.engine.setHighlighterColor(this.settings.defaultHighlighterColor);
    this.engine.setHighlighterWidth(this.settings.defaultHighlighterWidth);
    this.engine.setFontSize(this.settings.defaultFontSize);
  }

  /**
   * Applies a change made from the toolbar: updates the engine immediately,
   * notifies the host, and persists it so it carries across pages and sessions.
   */
  private updateDrawingDefaults(patch: Partial<ExtensionSettings>): void {
    Object.assign(this.settings, patch);
    this.applyDrawingDefaults();
    this.refreshPenColorControls();
    this.callbacks.onSettingsUpdate?.(this.settings);
    saveSettings(patch).catch(() => {});
  }

  /** Repaints the popover controls from `this.settings` (no rebinding). */
  private syncDrawingDefaultControls(): void {
    this.colorPopover.querySelectorAll<HTMLInputElement>('input[data-setting]').forEach((input) => {
      const key = input.dataset.setting as keyof ExtensionSettings;
      const value = this.settings[key];
      if (typeof value === 'number') {
        input.value = `${value}`;
        input.setAttribute('aria-valuenow', `${value}`);
        input.setAttribute('aria-valuetext', `${value} pixels`);
        const readout = input.closest('.pa-slider-group')?.querySelector<HTMLElement>('.pa-slider-readout');
        if (readout) readout.textContent = `${value}px`;
      } else if (typeof value === 'string') {
        input.value = value;
      }
    });
    this.refreshPenColorControls();
  }

  /** Keeps the pen preview button and preset swatches in step with the pen colour. */
  private refreshPenColorControls(): void {
    const pen = this.settings.defaultStrokeColor;
    this.colorPreviewBtn.style.backgroundColor = pen;
    this.colorPopover.querySelectorAll<HTMLButtonElement>('.pa-color-swatch').forEach((swatch) => {
      const isActive = swatch.dataset.color === pen;
      swatch.classList.toggle('active', isActive);
      swatch.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
  }

  private createToolButton(
    tool: ToolType,
    name: string,
    shortcutId: string,
    iconSvg: string
  ): HTMLButtonElement {
    const btn = document.createElement('button');
    const isActive = this.engine.getTool() === tool;
    btn.type = 'button';
    btn.className = `pa-btn ${isActive ? 'active' : ''}`;
    btn.dataset.tool = tool;
    btn.dataset.shortcut = shortcutId;
    const shortcutText = this.getShortcutDisplay(shortcutId);
    btn.dataset.label = name;
    btn.setAttribute('aria-label', `${name}${shortcutText ? ` (${shortcutText})` : ''}`);
    btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    const kbd = shortcutText ? ` <kbd>${shortcutText}</kbd>` : '';
    btn.innerHTML = `${iconSvg}<span class="pa-tooltip" aria-hidden="true">${name}${kbd}</span>`;

    btn.addEventListener('click', () => {
      this.engine.setTool(tool);
      this.updateActiveToolUI();
    });

    return btn;
  }

  private createActionButton(
    actionName: string,
    title: string,
    shortcutId: string,
    iconSvg: string,
    onClick: () => void
  ): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pa-btn';
    btn.dataset.action = actionName;
    btn.dataset.shortcut = shortcutId;
    const shortcutText = this.getShortcutDisplay(shortcutId);
    btn.dataset.label = title;
    btn.setAttribute('aria-label', `${title}${shortcutText ? ` (${shortcutText})` : ''}`);
    const kbd = shortcutText ? ` <kbd>${shortcutText}</kbd>` : '';
    btn.innerHTML = `${iconSvg}<span class="pa-tooltip" aria-hidden="true">${title}${kbd}</span>`;

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick();
    });

    return btn;
  }

  private createSeparator(): HTMLElement {
    const sep = document.createElement('div');
    sep.className = 'pa-separator';
    sep.setAttribute('aria-hidden', 'true');
    return sep;
  }

  private getShortcutDisplay(actionId: string): string {
    const key = (this.settings.shortcuts as any)[actionId];
    return key ? formatShortcutForDisplay(key) : '';
  }

  public updateActiveToolUI(): void {
    const current = this.engine.getTool();
    this.toolbar.querySelectorAll('[data-tool]').forEach((el) => {
      const btn = el as HTMLButtonElement;
      const isActive = btn.dataset.tool === current;
      if (isActive) {
        btn.classList.add('active');
        btn.setAttribute('aria-pressed', 'true');
      } else {
        btn.classList.remove('active');
        btn.setAttribute('aria-pressed', 'false');
      }
    });
  }

  public updateTooltips(): void {
    this.toolbar.querySelectorAll('[data-shortcut]').forEach((el) => {
      const btn = el as HTMLButtonElement;
      const shortcutId = btn.dataset.shortcut;
      if (shortcutId === undefined) return;
      const text = this.getShortcutDisplay(shortcutId);
      const kbd = btn.querySelector('kbd');
      if (kbd) {
        kbd.textContent = text;
        kbd.style.display = text ? '' : 'none';
      }
      const label = btn.dataset.label || btn.dataset.tool || btn.dataset.action || '';
      btn.setAttribute('aria-label', `${label}${text ? ` (${text})` : ''}`);
    });
  }

  private initDragEvents(): void {
    const dragHandle = this.toolbar.querySelector('.pa-drag-handle') as HTMLElement;
    if (!dragHandle) return;

    let startX = 0;
    let startY = 0;
    let moved = false;

    dragHandle.addEventListener('pointerdown', (e: PointerEvent) => {
      if (e.button !== 0) return;
      this.isDragging = true;
      moved = false;
      // Snap instead of animating the centering transform away (first-drag flick).
      this.wrapper.classList.add('pa-repositioning');
      startX = e.clientX;
      startY = e.clientY;
      const rect = this.wrapper.getBoundingClientRect();
      this.dragOffset.x = e.clientX - rect.left;
      this.dragOffset.y = e.clientY - rect.top;
      dragHandle.setPointerCapture(e.pointerId);
    });

    dragHandle.addEventListener('pointermove', (e: PointerEvent) => {
      if (!this.isDragging) return;
      if (!moved && Math.abs(e.clientX - startX) <= 4 && Math.abs(e.clientY - startY) <= 4) return;
      if (!moved) {
        moved = true;
        this.wrapper.style.transform = 'none';
      }
      const newX = Math.max(10, Math.min(window.innerWidth - this.wrapper.offsetWidth - 10, e.clientX - this.dragOffset.x));
      const newY = Math.max(10, Math.min(window.innerHeight - this.wrapper.offsetHeight - 10, e.clientY - this.dragOffset.y));
      this.wrapper.style.left = `${newX}px`;
      this.wrapper.style.top = `${newY}px`;
    });

    const finishDrag = (commit: boolean) => {
      if (!this.isDragging) return;
      this.isDragging = false;
      this.wrapper.classList.remove('pa-repositioning');
      if (!commit || !moved) return;
      const rect = this.wrapper.getBoundingClientRect();
      this.settings.toolbarPosition = { x: rect.left, y: rect.top };
      this.callbacks.onSettingsUpdate?.(this.settings);
    };

    dragHandle.addEventListener('pointerup', () => finishDrag(true));
    dragHandle.addEventListener('pointercancel', () => finishDrag(false));

    // Keyboard alternative for repositioning (WCAG 2.5.7).
    dragHandle.addEventListener('keydown', (e: KeyboardEvent) => {
      let nextMoved = false;
      const rect = this.wrapper.getBoundingClientRect();
      let newX = rect.left;
      let newY = rect.top;
      const step = 20;

      if (e.key === 'ArrowUp') {
        newY = Math.max(10, newY - step);
        nextMoved = true;
      } else if (e.key === 'ArrowDown') {
        newY = Math.min(window.innerHeight - this.wrapper.offsetHeight - 10, newY + step);
        nextMoved = true;
      } else if (e.key === 'ArrowLeft') {
        newX = Math.max(10, newX - step);
        nextMoved = true;
      } else if (e.key === 'ArrowRight') {
        newX = Math.min(window.innerWidth - this.wrapper.offsetWidth - 10, newX + step);
        nextMoved = true;
      }

      if (nextMoved) {
        e.preventDefault();
        // Same snap-not-animate requirement as dragging.
        this.wrapper.classList.add('pa-repositioning');
        this.wrapper.style.transform = 'none';
        this.wrapper.style.left = `${newX}px`;
        this.wrapper.style.top = `${newY}px`;
        this.settings.toolbarPosition = { x: newX, y: newY };
        this.callbacks.onSettingsUpdate?.(this.settings);
        requestAnimationFrame(() => this.wrapper.classList.remove('pa-repositioning'));
      }
    });
  }

  private bindDockEvents(): void {
    this.dockTab.addEventListener('click', () => {
      this.setDrawingMode(true, true);
    });
    this.dockClose.addEventListener('click', () => {
      this.hideToolbar();
    });
  }
}
