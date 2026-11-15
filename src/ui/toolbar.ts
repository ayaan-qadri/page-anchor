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
  private dockPanel: HTMLElement;
  private dockTab: HTMLButtonElement;
  private dockBadge: HTMLElement;
  private dockClose: HTMLButtonElement;
  private colorPopover: HTMLElement;
  private colorPreviewBtn: HTMLElement;
  private toastElement: HTMLElement | null = null;
  private toastTimer: number | null = null;
  private menuWrappers: HTMLElement[] = [];

  private isDragging = false;
  private dragOffset = { x: 0, y: 0 };
  private isDocked = false;
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

    this.dockPanel = document.createElement('div');
    this.dockPanel.className = 'pa-dock';

    this.dockTab = document.createElement('button');
    this.dockTab.type = 'button';
    this.dockTab.className = 'pa-dock-tab';
    this.dockTab.setAttribute('aria-label', 'Open drawing toolbar');
    this.dockTab.setAttribute('aria-expanded', shouldBeOpen ? 'true' : 'false');
    this.dockTab.title = 'Open drawing toolbar';
    const dockBadge = document.createElement('span');
    dockBadge.className = 'pa-dock-badge';
    dockBadge.style.display = 'none';
    dockBadge.setAttribute('aria-label', 'Active annotations');
    dockBadge.textContent = '0';
    setMarkup(this.dockTab, ICONS.dragHandle);
    this.dockTab.appendChild(dockBadge);
    this.dockBadge = this.dockTab.querySelector('.pa-dock-badge') as HTMLElement;
    this.dockPanel.appendChild(this.dockTab);

    this.dockClose = document.createElement('button');
    this.dockClose.type = 'button';
    this.dockClose.className = 'pa-dock-close';
    this.dockClose.setAttribute('aria-label', 'Hide toolbar');
    this.dockClose.title = 'Hide toolbar';
    setMarkup(this.dockClose, ICONS.close);
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

    // Names the tool the swatches below will change, so the grid is never
    // ambiguous about what it is about to recolour.
    const target = document.createElement('div');
    target.className = 'pa-color-target';
    target.setAttribute('aria-live', 'polite');
    body.appendChild(target);

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

  /** Keeps the color preview button and preset swatches in step with the active tool's colour. */
  public refreshColorControls(): void {
    const isHl = this.isHighlighterActive();
    const activeColor = isHl ? this.settings.defaultHighlighterColor : this.settings.defaultStrokeColor;
    this.colorPreviewBtn.style.backgroundColor = activeColor;
    this.colorPreviewBtn.title = isHl ? 'Highlighter defaults' : 'Drawing defaults';
    this.colorPreviewBtn.setAttribute('aria-label', isHl ? 'Highlighter defaults' : 'Drawing defaults');

    const target = this.colorPopover.querySelector('.pa-color-target');
    if (target) {
      target.textContent = isHl ? 'Highlighter colours' : 'Pen colours';
    }

    const grid = this.colorPopover.querySelector('.pa-color-grid');
    if (grid) {
      grid.setAttribute('aria-label', isHl ? 'Preset highlighter colors' : 'Preset pen colors');
    }

    this.colorPopover.querySelectorAll<HTMLButtonElement>('.pa-color-swatch').forEach((swatch) => {
      const isActive = swatch.dataset.color === activeColor;
      swatch.classList.toggle('active', isActive);
      swatch.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
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

  private bindDockEvents(): void {
    this.dockTab.addEventListener('click', () => {
      this.setDrawingMode(true, true);
    });
    this.dockClose.addEventListener('click', () => {
      this.hideToolbar();
    });
  }
}
