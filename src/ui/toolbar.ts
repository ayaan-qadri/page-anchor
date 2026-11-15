import { CanvasEngine } from '../core/engine';
import { HistoryManager } from '../core/history';
import { ToolType } from '../types/engine.types';
import { ExtensionSettings } from '../types/storage.types';
import { ToolbarCallbacks } from '../types/ui.types';
import { ICONS } from '../icons/svg-icons';
import { setIconWithTooltip, setMarkup } from './dom';
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
  private colorPopover: HTMLElement;
  private colorPreviewBtn: HTMLElement;
  private countBadge!: HTMLElement;
  private toastElement: HTMLElement | null = null;
  private toastTimer: number | null = null;
  private menuWrappers: HTMLElement[] = [];
  private strokeColorRow!: HTMLElement;
  private strokeWidthGroup!: HTMLElement;
  private hlColorRow!: HTMLElement;
  private hlWidthGroup!: HTMLElement;
  private fontSizeGroup!: HTMLElement;
  private nonePanel!: HTMLElement;

  private isDragging = false;
  private dragOffset = { x: 0, y: 0 };
  private positionSaveTimer: number | null = null;

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

    this.wrapper.appendChild(this.toolbar);
    this.wrapper.appendChild(this.colorPopover);
    this.container.appendChild(this.wrapper);

    this.initDragEvents();
    this.applyDrawingDefaults();
    this.updateActiveToolUI();
    this.updateHistoryButtons();
    this.updateBadge();

    if (shouldBeOpen) {
      this.setDrawingMode(true, false);
    } else {
      this.hideToolbar(false);
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
    if (settings.isToolbarOpen) {
      this.setDrawingMode(true, false);
    } else {
      this.hideToolbar(false);
    }
  }

  public updateBadge(): void {
    const count = this.engine.getElements().length;
    if (!this.countBadge) return;
    if (count > 0) {
      this.countBadge.textContent = `${count}`;
      this.countBadge.style.display = 'inline-block';
    } else {
      this.countBadge.style.display = 'none';
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
      this.showToolbar();
    } else {
      this.hideToolbar();
    }
    this.settings.isToolbarOpen = active;
    if (persist) {
      saveSettings({ isToolbarOpen: active }).catch(() => {});
    }
    this.callbacks.onToggleActive?.(active);
  }

  /**
   * Removes the toolbar from the page. Use the extension icon or a shortcut
   * to bring it back.
   */
  public hideToolbar(persist = true): void {
    this.engine.setActiveMode(false);
    this.wrapper.style.display = 'none';
    this.colorPopover.classList.remove('open');
    this.colorPreviewBtn.setAttribute('aria-expanded', 'false');
    this.settings.isToolbarOpen = false;
    if (persist) {
      saveSettings({ isToolbarOpen: false }).catch(() => {});
    }
    this.callbacks.onToggleActive?.(false);
  }

  /** Shows the toolbar at its resting position. */
  private showToolbar(): void {
    this.wrapper.style.display = 'block';

    if (this.settings.toolbarPosition) {
      this.wrapper.style.transform = 'none';
      this.wrapper.style.left = `${this.settings.toolbarPosition.x}px`;
      this.wrapper.style.top = `${this.settings.toolbarPosition.y}px`;
    } else {
      this.wrapper.style.transform = 'translateX(-50%)';
      this.wrapper.style.left = '50%';
      this.wrapper.style.top = '24px';
    }

    this.ensureVisibleInViewport();
  }

  public ensureVisibleInViewport(): void {
    if (!this.wrapper || this.wrapper.style.display === 'none') return;
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
      this.persistToolbarPosition({ x: clampX, y: clampY });
    }
  }

  private persistToolbarPosition(position: { x: number; y: number }): void {
    this.settings.toolbarPosition = position;
    this.callbacks.onSettingsUpdate?.(this.settings);
    if (this.positionSaveTimer !== null) clearTimeout(this.positionSaveTimer);
    this.positionSaveTimer = window.setTimeout(() => {
      this.positionSaveTimer = null;
      saveSettings({ toolbarPosition: this.settings.toolbarPosition }).catch(() => {});
    }, 200);
  }

  public toggleDrawingMode(persist = true): void {
    const newState = !this.engine.getActiveMode();
    this.setDrawingMode(newState, persist);
  }

  /**
   * Shows the toolbar if it is hidden, and hides it if it is showing.
   */
  public toggleToolbarVisibility(): void {
    this.toggleDrawingMode();
  }

  private buildToolbarContent(): void {
    const dragHandle = document.createElement('div');
    dragHandle.className = 'pa-drag-handle';
    dragHandle.setAttribute('role', 'button');
    dragHandle.setAttribute('tabindex', '0');
    dragHandle.setAttribute('aria-label', 'Move toolbar position. Drag or use arrow keys.');
    dragHandle.title = 'Move toolbar position (Arrow keys or drag)';
    setMarkup(dragHandle, ICONS.dragHandle);
    this.toolbar.appendChild(dragHandle);

    this.toolbar.appendChild(this.createToolButton('select', 'Select & Move', 'tool-select', ICONS.select));

    this.toolbar.appendChild(this.createSeparator());

    // Primary drawing tools stay on the bar. Everything less common lives in
    // menus so the toolbar reads as a short list instead of a wall of icons.
    this.toolbar.appendChild(this.createToolButton('pen', 'Pen', 'tool-pen', ICONS.pen));
    this.toolbar.appendChild(this.createToolButton('highlighter', 'Highlighter', 'tool-highlighter', ICONS.highlighter));
    this.toolbar.appendChild(this.createToolButton('text', 'Text Note', 'tool-text', ICONS.text));
    this.toolbar.appendChild(this.createToolButton('eraser', 'Eraser', 'tool-eraser', ICONS.eraser));

    this.toolbar.appendChild(this.buildShapesMenu());

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
      this.undo();
    });
    this.toolbar.appendChild(undoBtn);

    const redoBtn = this.createActionButton('redo', 'Redo', 'action-redo', ICONS.redo, () => {
      this.redo();
    });
    this.toolbar.appendChild(redoBtn);

    const clearBtn = this.createActionButton('clear', 'Clear Page', 'action-clear', ICONS.trash, () => {
      this.clearPageWithToast();
    });
    this.toolbar.appendChild(clearBtn);

    // The count of drawings on this page, shown on the clear button so the
    // user can tell what it would remove.
    const countBadge = document.createElement('span');
    countBadge.className = 'pa-count-badge';
    countBadge.style.display = 'none';
    countBadge.setAttribute('aria-label', 'Active annotations');
    countBadge.textContent = '0';
    clearBtn.appendChild(countBadge);
    this.countBadge = countBadge;

    this.toolbar.appendChild(this.buildMoreMenu());
  }

  /**
   * A menu of the five shape tools. They keep their own keyboard shortcuts,
   * so the menu is a convenience rather than the only route to them.
   */
  private buildShapesMenu(): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'pa-menu-anchor';

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'pa-btn pa-menu-trigger';
    trigger.dataset.action = 'shapes';
    trigger.setAttribute('aria-haspopup', 'menu');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-label', 'Shape tools');
    trigger.title = 'Shape tools';
    setMarkup(trigger, ICONS.shapes);
    wrapper.appendChild(trigger);

    const menu = document.createElement('div');
    menu.className = 'pa-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'Shape tools');

    const shapes: Array<[ToolType, string, string, string]> = [
      ['rect', 'Rectangle', 'tool-rect', ICONS.rect],
      ['circle', 'Circle', 'tool-circle', ICONS.circle],
      ['line', 'Line', 'tool-line', ICONS.line],
      ['arrow', 'Arrow', 'tool-arrow', ICONS.arrow],
      ['double-arrow', 'Double Arrow', 'tool-double-arrow', ICONS.doubleArrow],
    ];

    for (const [tool, name, shortcutId, icon] of shapes) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'pa-menu-item';
      item.dataset.tool = tool;
      item.setAttribute('role', 'menuitemradio');
      item.setAttribute('aria-checked', 'false');
      setMarkup(item, icon);
      const label = document.createElement('span');
      label.className = 'pa-menu-item-label';
      label.textContent = name;
      item.appendChild(label);
      const kbd = document.createElement('kbd');
      kbd.className = 'pa-menu-item-key';
      kbd.textContent = this.getShortcutDisplay(shortcutId);
      item.appendChild(kbd);
      item.addEventListener('click', () => {
        this.engine.setTool(tool);
        this.updateActiveToolUI();
        this.closeMenus();
      });
      menu.appendChild(item);
    }

    wrapper.appendChild(menu);
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleMenu(wrapper, menu, trigger);
    });

    this.menuWrappers.push(wrapper);
    return wrapper;
  }

  /**
   * A menu of the secondary controls: select-all, drawing visibility, smart
   * anchoring, and toolbar placement.
   */
  private buildMoreMenu(): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'pa-menu-anchor';

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'pa-btn pa-menu-trigger';
    trigger.dataset.action = 'more';
    trigger.setAttribute('aria-haspopup', 'menu');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-label', 'More options');
    trigger.title = 'More options';
    setMarkup(trigger, ICONS.more);
    wrapper.appendChild(trigger);

    const menu = document.createElement('div');
    menu.className = 'pa-menu pa-menu-right';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'More options');

    const selectAllItem = document.createElement('button');
    selectAllItem.type = 'button';
    selectAllItem.className = 'pa-menu-item';
    selectAllItem.dataset.action = 'select-all';
    selectAllItem.setAttribute('role', 'menuitem');
    selectAllItem.setAttribute('aria-label', 'Select All to Move');
    setMarkup(selectAllItem, ICONS.selectAll);
    const selectAllLabel = document.createElement('span');
    selectAllLabel.className = 'pa-menu-item-label';
    selectAllLabel.textContent = 'Select All to Move';
    selectAllItem.appendChild(selectAllLabel);
    selectAllItem.addEventListener('click', () => {
      this.engine.selectAll();
      this.updateActiveToolUI();
      this.closeMenus();
    });
    menu.appendChild(selectAllItem);

    const isVisible = this.engine.getAnnotationsVisible();
    const eyeBtn = document.createElement('button');
    eyeBtn.type = 'button';
    eyeBtn.className = 'pa-menu-item';
    eyeBtn.dataset.action = 'visibility';
    eyeBtn.setAttribute('role', 'menuitemcheckbox');
    eyeBtn.setAttribute('aria-checked', isVisible ? 'true' : 'false');
    eyeBtn.setAttribute('aria-label', isVisible ? 'Hide Drawings' : 'Show Drawings');
    setMarkup(eyeBtn, isVisible ? ICONS.eye : ICONS.eyeOff);
    const eyeLabel = document.createElement('span');
    eyeLabel.className = 'pa-menu-item-label';
    eyeLabel.textContent = isVisible ? 'Hide Drawings' : 'Show Drawings';
    eyeBtn.appendChild(eyeLabel);
    eyeBtn.addEventListener('click', () => {
      const next = !this.engine.getAnnotationsVisible();
      this.engine.setAnnotationsVisible(next);
      this.settings.areAnnotationsVisible = next;
      saveSettings({ areAnnotationsVisible: next }).catch(() => {});
      eyeBtn.setAttribute('aria-checked', next ? 'true' : 'false');
      eyeLabel.textContent = next ? 'Hide Drawings' : 'Show Drawings';
      setMarkup(eyeBtn, next ? ICONS.eye : ICONS.eyeOff);
      this.closeMenus();
    });
    menu.appendChild(eyeBtn);

    const isAnchoring = this.engine.getDomAnchoringEnabled();
    const anchorBtn = document.createElement('button');
    anchorBtn.type = 'button';
    anchorBtn.className = 'pa-menu-item';
    anchorBtn.dataset.action = 'dom-anchor';
    anchorBtn.setAttribute('role', 'menuitemcheckbox');
    anchorBtn.setAttribute('aria-checked', isAnchoring ? 'true' : 'false');
    anchorBtn.setAttribute('aria-label', isAnchoring ? 'Smart Anchoring: On' : 'Smart Anchoring: Off');
    setMarkup(anchorBtn, ICONS.anchor);
    const anchorLabel = document.createElement('span');
    anchorLabel.className = 'pa-menu-item-label';
    anchorLabel.textContent = isAnchoring ? 'Smart Anchoring: On' : 'Smart Anchoring: Off';
    anchorBtn.appendChild(anchorLabel);
    anchorBtn.addEventListener('click', () => {
      const next = !this.engine.getDomAnchoringEnabled();
      this.engine.setDomAnchoringEnabled(next);
      this.callbacks.onToggleDomAnchoring?.(next);
      anchorBtn.setAttribute('aria-checked', next ? 'true' : 'false');
      anchorLabel.textContent = next ? 'Smart Anchoring: On' : 'Smart Anchoring: Off';
      this.closeMenus();
    });
    menu.appendChild(anchorBtn);

    const settingsItem = document.createElement('button');
    settingsItem.type = 'button';
    settingsItem.className = 'pa-menu-item';
    settingsItem.dataset.action = 'open-options';
    settingsItem.setAttribute('role', 'menuitem');
    settingsItem.setAttribute('aria-label', 'Settings & Backup');
    setMarkup(settingsItem, ICONS.settings);
    const settingsLabel = document.createElement('span');
    settingsLabel.className = 'pa-menu-item-label';
    settingsLabel.textContent = 'Settings & Backup';
    settingsItem.appendChild(settingsLabel);
    settingsItem.addEventListener('click', () => {
      this.closeMenus();
      this.callbacks.onOpenOptions?.();
    });
    menu.appendChild(settingsItem);

    const closeItem = document.createElement('button');
    closeItem.type = 'button';
    closeItem.className = 'pa-menu-item';
    closeItem.dataset.action = 'hide';
    closeItem.setAttribute('role', 'menuitem');
    closeItem.setAttribute('aria-label', 'Hide Toolbar');
    setMarkup(closeItem, ICONS.close);
    const closeLabel = document.createElement('span');
    closeLabel.className = 'pa-menu-item-label';
    closeLabel.textContent = 'Hide Toolbar';
    closeItem.appendChild(closeLabel);
    const closeHint = document.createElement('span');
    closeHint.className = 'pa-menu-item-hint';
    closeHint.textContent = 'removes the tab';
    closeItem.appendChild(closeHint);
    closeItem.addEventListener('click', () => {
      this.closeMenus();
      this.hideToolbar();
    });
    menu.appendChild(closeItem);

    wrapper.appendChild(menu);
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleMenu(wrapper, menu, trigger);
    });

    this.menuWrappers.push(wrapper);
    return wrapper;
  }

  private toggleMenu(wrapper: HTMLElement, menu: HTMLElement, trigger: HTMLElement): void {
    const isOpen = wrapper.classList.contains('open');
    this.closeMenus();
    if (isOpen) return;
    wrapper.classList.add('open');
    menu.classList.add('open');
    trigger.setAttribute('aria-expanded', 'true');
  }

  /** Closes every open toolbar menu. */
  public closeMenus(): void {
    for (const wrapper of this.menuWrappers) {
      wrapper.classList.remove('open');
      wrapper.querySelector('.pa-menu')?.classList.remove('open');
      wrapper.querySelector('.pa-menu-trigger')?.setAttribute('aria-expanded', 'false');
    }
  }

  public updateDomAnchoringUI(enabled: boolean): void {
    const btn = this.toolbar.querySelector('[data-action="dom-anchor"]') as HTMLButtonElement | null;
    if (btn) {
      btn.setAttribute('aria-checked', enabled ? 'true' : 'false');
      const label = btn.querySelector('.pa-menu-item-label');
      if (label) label.textContent = enabled ? 'Smart Anchoring: On' : 'Smart Anchoring: Off';
    }
  }

  public isHighlighterActive(): boolean {
    return this.engine.getTool() === 'highlighter';
  }

  public showToast(
    message: string,
    actionLabel?: string,
    onAction?: () => void,
    durationMs = 4500
  ): void {
    if (this.toastElement) {
      this.toastElement.remove();
      this.toastElement = null;
    }
    if (this.toastTimer) {
      clearTimeout(this.toastTimer);
      this.toastTimer = null;
    }

    const toast = document.createElement('div');
    toast.className = 'pa-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');

    const text = document.createElement('span');
    text.className = 'pa-toast-text';
    text.textContent = message;
    toast.appendChild(text);

    const dismiss = () => {
      toast.classList.add('pa-toast-hiding');
      setTimeout(() => {
        if (toast.parentNode) toast.remove();
        if (this.toastElement === toast) this.toastElement = null;
      }, 180);
    };

    if (actionLabel && onAction) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pa-toast-btn';
      btn.textContent = actionLabel;
      btn.setAttribute('aria-label', actionLabel);
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        onAction();
        dismiss();
      });
      toast.appendChild(btn);
    }

    this.wrapper.appendChild(toast);
    this.toastElement = toast;

    this.toastTimer = window.setTimeout(() => {
      dismiss();
    }, durationMs);
  }

  public clearPageWithToast(): void {
    const hadElements = this.engine.getElements().length > 0;

    // `engine.clear()` reports the change, which the host records in the undo
    // history. One undo therefore steps straight back to the cleared page.
    this.engine.clear();
    this.updateHistoryButtons();
    this.updateBadge();
    this.callbacks.onClear?.();

    if (hadElements) {
      this.showToast('Page drawings cleared', 'Undo', () => this.undo());
    }
  }

  /** Reverts the most recent change, restoring the previous page state. */
  public undo(): void {
    const prev = this.history.undo();
    if (prev === null) return;
    this.engine.setElements(prev);
    this.updateHistoryButtons();
    this.updateBadge();
    this.callbacks.onClear?.();
  }

  /** Re-applies the most recently undone change. */
  public redo(): void {
    const next = this.history.redo();
    if (next === null) return;
    this.engine.setElements(next);
    this.updateHistoryButtons();
    this.updateBadge();
    this.callbacks.onClear?.();
  }

  private toggleColorPopover(): void {
    const isOpen = this.colorPopover.classList.toggle('open');
    this.colorPreviewBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    if (isOpen) {
      this.refreshColorControls();
      this.positionColorPopover();
    }
  }

  /** Flips the popover below the toolbar when there is not enough room above. */
  private positionColorPopover(): void {
    const roomAbove = this.wrapper.getBoundingClientRect().top;
    const height = this.colorPopover.offsetHeight;
    this.colorPopover.classList.toggle('below', roomAbove < height + 16);
  }

  private buildColorPopover(): void {
    const header = document.createElement('div');
    header.className = 'pa-popover-header';

    const headerRow = document.createElement('div');
    headerRow.className = 'pa-popover-header-row';

    const toolInfo = document.createElement('div');
    toolInfo.className = 'pa-popover-tool-info';

    const toolIcon = document.createElement('span');
    toolIcon.className = 'pa-popover-tool-icon';
    toolIcon.setAttribute('aria-hidden', 'true');

    const toolName = document.createElement('span');
    toolName.className = 'pa-popover-tool-name';

    toolInfo.appendChild(toolIcon);
    toolInfo.appendChild(toolName);

    const badge = document.createElement('span');
    badge.className = 'pa-popover-badge';
    badge.textContent = 'Selected';

    headerRow.appendChild(toolInfo);
    headerRow.appendChild(badge);
    header.appendChild(headerRow);

    // Names the tool the swatches below will change, so the grid is never
    // ambiguous about what it is about to recolour.
    const target = document.createElement('div');
    target.className = 'pa-color-target';
    target.setAttribute('aria-live', 'polite');
    header.appendChild(target);

    this.colorPopover.appendChild(header);

    const body = document.createElement('div');
    body.className = 'pa-popover-body';

    const grid = document.createElement('div');
    grid.className = 'pa-color-grid';
    grid.setAttribute('role', 'group');
    const isHl = this.isHighlighterActive();
    const activeColor = isHl ? this.settings.defaultHighlighterColor : this.settings.defaultStrokeColor;
    grid.setAttribute('aria-label', isHl ? 'Preset highlighter colors' : 'Preset pen colors');

    PRESET_COLORS.forEach((color) => {
      const swatch = document.createElement('button');
      swatch.type = 'button';
      const isActive = color === activeColor;
      swatch.className = `pa-color-swatch ${isActive ? 'active' : ''}`;
      swatch.style.backgroundColor = color;
      swatch.dataset.color = color;
      swatch.setAttribute('aria-label', `Color ${color}`);
      swatch.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      swatch.addEventListener('click', () => {
        if (this.isHighlighterActive()) {
          this.updateDrawingDefaults({ defaultHighlighterColor: color });
        } else {
          this.updateDrawingDefaults({ defaultStrokeColor: color });
        }
      });
      grid.appendChild(swatch);
    });
    body.appendChild(grid);

    // 1. Stroke colour (used for Pen, Shapes, and Text note)
    this.strokeColorRow = this.buildColorRow(
      'Pen colour',
      'defaultStrokeColor',
      this.settings.defaultStrokeColor
    );
    body.appendChild(this.strokeColorRow);

    // 2. Stroke width (used for Pen and Shapes)
    this.strokeWidthGroup = this.buildSliderField(
      'Pen width',
      'defaultStrokeWidth',
      1,
      30,
      this.settings.defaultStrokeWidth
    );
    body.appendChild(this.strokeWidthGroup);

    // 3. Highlighter colour
    this.hlColorRow = this.buildColorRow(
      'Highlighter colour',
      'defaultHighlighterColor',
      this.settings.defaultHighlighterColor
    );
    body.appendChild(this.hlColorRow);

    // 4. Highlighter width
    this.hlWidthGroup = this.buildSliderField(
      'Highlighter width',
      'defaultHighlighterWidth',
      8,
      50,
      this.settings.defaultHighlighterWidth
    );
    body.appendChild(this.hlWidthGroup);

    // 5. Text note size (used for Text note)
    this.fontSizeGroup = this.buildSliderField(
      'Text note size',
      'defaultFontSize',
      12,
      36,
      this.settings.defaultFontSize
    );
    body.appendChild(this.fontSizeGroup);

    // 6. None panel (for tools without stroke settings: eraser and select)
    this.nonePanel = document.createElement('div');
    this.nonePanel.className = 'pa-tool-panel-empty';

    const emptyMsg = document.createElement('p');
    emptyMsg.className = 'pa-tool-empty-msg';
    emptyMsg.textContent = 'This tool has no drawing color or width settings.';
    this.nonePanel.appendChild(emptyMsg);

    const switchPrompt = document.createElement('p');
    switchPrompt.className = 'pa-tool-switch-prompt';
    switchPrompt.textContent = 'Configure defaults for:';
    this.nonePanel.appendChild(switchPrompt);

    const quickTools = document.createElement('div');
    quickTools.className = 'pa-quick-tools';
    const switchableTools: Array<{ tool: ToolType; label: string; icon: string }> = [
      { tool: 'pen', label: 'Pen', icon: ICONS.pen },
      { tool: 'highlighter', label: 'Highlighter', icon: ICONS.highlighter },
      { tool: 'text', label: 'Text', icon: ICONS.text },
    ];
    switchableTools.forEach(({ tool, label, icon }) => {
      const qBtn = document.createElement('button');
      qBtn.type = 'button';
      qBtn.className = 'pa-quick-tool-btn';
      qBtn.setAttribute('aria-label', `Configure ${label} defaults`);
      setMarkup(qBtn, icon);
      const span = document.createElement('span');
      span.textContent = label;
      qBtn.appendChild(span);
      qBtn.addEventListener('click', () => {
        this.engine.setTool(tool);
        this.updateActiveToolUI();
      });
      quickTools.appendChild(qBtn);
    });
    this.nonePanel.appendChild(quickTools);
    body.appendChild(this.nonePanel);

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
          this.closeMenus();
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
        if (!this.isHighlighterActive()) {
          this.colorPreviewBtn.style.backgroundColor = input.value;
        }
      } else {
        this.engine.setHighlighterColor(input.value);
        if (this.isHighlighterActive()) {
          this.colorPreviewBtn.style.backgroundColor = input.value;
        }
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

  private getActiveToolInfo(): {
    category: 'pen' | 'highlighter' | 'text' | 'shape' | 'none';
    label: string;
    targetText: string;
    icon: string;
    color: string;
  } {
    const current = this.engine.getTool();
    switch (current) {
      case 'highlighter':
        return {
          category: 'highlighter',
          label: 'Highlighter',
          targetText: 'Highlighter colours',
          icon: ICONS.highlighter,
          color: this.settings.defaultHighlighterColor,
        };
      case 'text':
        return {
          category: 'text',
          label: 'Text Note',
          targetText: 'Text note colours',
          icon: ICONS.text,
          color: this.settings.defaultStrokeColor,
        };
      case 'rect':
        return {
          category: 'shape',
          label: 'Rectangle',
          targetText: 'Rectangle colours',
          icon: ICONS.rect,
          color: this.settings.defaultStrokeColor,
        };
      case 'circle':
        return {
          category: 'shape',
          label: 'Circle',
          targetText: 'Circle colours',
          icon: ICONS.circle,
          color: this.settings.defaultStrokeColor,
        };
      case 'line':
        return {
          category: 'shape',
          label: 'Line',
          targetText: 'Line colours',
          icon: ICONS.line,
          color: this.settings.defaultStrokeColor,
        };
      case 'arrow':
        return {
          category: 'shape',
          label: 'Arrow',
          targetText: 'Arrow colours',
          icon: ICONS.arrow,
          color: this.settings.defaultStrokeColor,
        };
      case 'double-arrow':
        return {
          category: 'shape',
          label: 'Double Arrow',
          targetText: 'Double Arrow colours',
          icon: ICONS.doubleArrow,
          color: this.settings.defaultStrokeColor,
        };
      case 'select':
        return {
          category: 'none',
          label: 'Select & Move',
          targetText: 'Select & Move tool',
          icon: ICONS.select,
          color: this.settings.defaultStrokeColor,
        };
      case 'eraser':
        return {
          category: 'none',
          label: 'Eraser',
          targetText: 'Eraser tool',
          icon: ICONS.eraser,
          color: this.settings.defaultStrokeColor,
        };
      case 'pen':
      default:
        return {
          category: 'pen',
          label: 'Pen',
          targetText: 'Pen colours',
          icon: ICONS.pen,
          color: this.settings.defaultStrokeColor,
        };
    }
  }

  /** Keeps the color preview button, popover header, and panel in step with the active tool. */
  public refreshColorControls(): void {
    const info = this.getActiveToolInfo();
    const isHl = info.category === 'highlighter';
    const isNone = info.category === 'none';

    this.colorPreviewBtn.style.backgroundColor = info.color;
    const titleText = isHl
      ? 'Highlighter defaults'
      : info.category === 'pen'
      ? 'Drawing defaults'
      : `${info.label} defaults`;
    this.colorPreviewBtn.title = titleText;
    this.colorPreviewBtn.setAttribute('aria-label', titleText);
    this.colorPopover.setAttribute('aria-label', `${info.label} defaults`);

    // Update Header
    const toolIcon = this.colorPopover.querySelector('.pa-popover-tool-icon');
    if (toolIcon) {
      setMarkup(toolIcon as HTMLElement, info.icon);
    }
    const toolName = this.colorPopover.querySelector('.pa-popover-tool-name');
    if (toolName) {
      toolName.textContent = info.label;
    }

    const target = this.colorPopover.querySelector('.pa-color-target') as HTMLElement | null;
    if (target) {
      target.textContent = info.targetText;
      target.style.display = isNone ? 'none' : 'block';
    }

    const grid = this.colorPopover.querySelector('.pa-color-grid') as HTMLElement | null;
    if (grid) {
      grid.style.display = isNone ? 'none' : 'grid';
      grid.setAttribute(
        'aria-label',
        isHl
          ? 'Preset highlighter colors'
          : info.category === 'text'
          ? 'Preset text colors'
          : info.category === 'shape'
          ? 'Preset shape colors'
          : 'Preset pen colors'
      );
    }

    // Toggle controls visibility & dynamic labels based on active tool category
    if (this.strokeColorRow) {
      const strokeColorLabel = this.strokeColorRow.querySelector<HTMLElement>('.pa-popover-label');
      const strokeWidthLabel = this.strokeWidthGroup.querySelector<HTMLElement>('.pa-slider-label span:first-child');

      if (info.category === 'pen') {
        this.strokeColorRow.style.display = 'flex';
        if (strokeColorLabel) strokeColorLabel.textContent = 'Pen colour';
        this.strokeWidthGroup.style.display = 'flex';
        if (strokeWidthLabel) strokeWidthLabel.textContent = 'Pen width';
        this.hlColorRow.style.display = 'none';
        this.hlWidthGroup.style.display = 'none';
        this.fontSizeGroup.style.display = 'none';
        this.nonePanel.style.display = 'none';
      } else if (info.category === 'shape') {
        this.strokeColorRow.style.display = 'flex';
        if (strokeColorLabel) strokeColorLabel.textContent = 'Stroke colour';
        this.strokeWidthGroup.style.display = 'flex';
        if (strokeWidthLabel) strokeWidthLabel.textContent = 'Stroke width';
        this.hlColorRow.style.display = 'none';
        this.hlWidthGroup.style.display = 'none';
        this.fontSizeGroup.style.display = 'none';
        this.nonePanel.style.display = 'none';
      } else if (info.category === 'highlighter') {
        this.strokeColorRow.style.display = 'none';
        this.strokeWidthGroup.style.display = 'none';
        this.hlColorRow.style.display = 'flex';
        this.hlWidthGroup.style.display = 'flex';
        this.fontSizeGroup.style.display = 'none';
        this.nonePanel.style.display = 'none';
      } else if (info.category === 'text') {
        this.strokeColorRow.style.display = 'flex';
        if (strokeColorLabel) strokeColorLabel.textContent = 'Text colour';
        this.strokeWidthGroup.style.display = 'none';
        this.hlColorRow.style.display = 'none';
        this.hlWidthGroup.style.display = 'none';
        this.fontSizeGroup.style.display = 'flex';
        this.nonePanel.style.display = 'none';
      } else {
        // none (eraser, select)
        this.strokeColorRow.style.display = 'none';
        this.strokeWidthGroup.style.display = 'none';
        this.hlColorRow.style.display = 'none';
        this.hlWidthGroup.style.display = 'none';
        this.fontSizeGroup.style.display = 'none';
        this.nonePanel.style.display = 'flex';
      }
    }

    if (isNone) {
      const emptyMsg = this.colorPopover.querySelector('.pa-tool-empty-msg');
      if (emptyMsg) {
        emptyMsg.textContent = `${info.label} has no drawing color or width settings.`;
      }
    }

    this.colorPopover.querySelectorAll<HTMLButtonElement>('.pa-color-swatch').forEach((swatch) => {
      const isActive = swatch.dataset.color === info.color;
      swatch.classList.toggle('active', isActive);
      swatch.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });

    if (this.colorPopover.classList.contains('open')) {
      this.positionColorPopover();
    }
  }

  private refreshPenColorControls(): void {
    this.refreshColorControls();
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
    setIconWithTooltip(btn, iconSvg, name, shortcutText);

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
    setIconWithTooltip(btn, iconSvg, title, shortcutText);

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
      if (btn.getAttribute('role') === 'menuitemradio') {
        btn.setAttribute('aria-checked', isActive ? 'true' : 'false');
      }
    });

    // The shape tools live in a menu, so their trigger carries the active
    // state instead of the individual buttons being visible on the bar.
    const shapeTools: ToolType[] = ['rect', 'circle', 'line', 'arrow', 'double-arrow'];
    const shapeTrigger = this.toolbar.querySelector('[data-action="shapes"]') as HTMLElement | null;
    if (shapeTrigger) {
      const isShapeActive = shapeTools.includes(current);
      shapeTrigger.classList.toggle('active', isShapeActive);
      shapeTrigger.setAttribute('aria-pressed', isShapeActive ? 'true' : 'false');
    }

    this.refreshColorControls();
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
    let lastX = 0;
    let lastY = 0;

    dragHandle.addEventListener('pointerdown', (e: PointerEvent) => {
      if (e.button !== 0) return;
      this.isDragging = true;
      moved = false;
      startX = e.clientX;
      startY = e.clientY;
      const rect = this.wrapper.getBoundingClientRect();
      lastX = rect.left;
      lastY = rect.top;
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
      lastX = newX;
      lastY = newY;
      this.wrapper.style.left = `${newX}px`;
      this.wrapper.style.top = `${newY}px`;
    });

    const finishDrag = (commit: boolean) => {
      if (!this.isDragging) return;
      this.isDragging = false;
      if (!commit || !moved) return;
      this.persistToolbarPosition({ x: lastX, y: lastY });
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
        this.wrapper.style.transform = 'none';
        this.wrapper.style.left = `${newX}px`;
        this.wrapper.style.top = `${newY}px`;
        this.persistToolbarPosition({ x: newX, y: newY });
      }
    });
  }
}
