import { CanvasEngine } from '../core/engine';
import { HistoryManager } from '../core/history';
import { AnchorElement, ToolType } from '../types/engine.types';
import { ExtensionSettings } from '../types/storage.types';
import { ShortcutAction } from '../types/shortcuts.types';
import { ToolbarCallbacks } from '../types/ui.types';
import { ICONS, IconName } from '../icons/svg-icons';
import { buildTooltip, markupToNodes, setMarkup } from './dom';
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
  '#64748b',
  '#ffffff',
  '#000000',
];

const VIEWPORT_PADDING = 10;
const TOAST_RESUME_MIN_MS = 1500;

type ToolCategory = 'pen' | 'highlighter' | 'text' | 'shape' | 'none';
type ColorSetting = 'defaultStrokeColor' | 'defaultHighlighterColor';
type SizeSetting = 'defaultStrokeWidth' | 'defaultHighlighterWidth' | 'defaultFontSize';
type PanelControl = 'strokeColor' | 'strokeWidth' | 'hlColor' | 'hlWidth' | 'fontSize' | 'none';

interface ToolInfo {
  category: ToolCategory;
  label: string;
  icon: IconName;
}

const TOOL_INFO: Record<ToolType, ToolInfo> = {
  select: { category: 'none', label: 'Select & Move', icon: 'select' },
  pen: { category: 'pen', label: 'Pen', icon: 'pen' },
  highlighter: { category: 'highlighter', label: 'Highlighter', icon: 'highlighter' },
  text: { category: 'text', label: 'Text Note', icon: 'text' },
  eraser: { category: 'none', label: 'Eraser', icon: 'eraser' },
  rect: { category: 'shape', label: 'Rectangle', icon: 'rect' },
  circle: { category: 'shape', label: 'Circle', icon: 'circle' },
  line: { category: 'shape', label: 'Line', icon: 'line' },
  arrow: { category: 'shape', label: 'Arrow', icon: 'arrow' },
  'double-arrow': { category: 'shape', label: 'Double Arrow', icon: 'doubleArrow' },
};

const SHAPE_TOOLS: ToolType[] = ['rect', 'circle', 'line', 'arrow', 'double-arrow'];

/** What the popover is editing: the defaults of a drawing tool, the current selection, or nothing. */
type StyleTarget = ToolCategory | 'selection';

const GRID_LABELS: Record<StyleTarget, string> = {
  pen: 'Preset pen colors',
  highlighter: 'Preset highlighter colors',
  text: 'Preset text colors',
  shape: 'Preset shape colors',
  selection: 'Preset colors for the selection',
  none: 'Preset pen colors',
};

/** Which popover controls each target shows, with the label each one takes. */
const PANEL_LAYOUT: Record<StyleTarget, Partial<Record<PanelControl, string>>> = {
  pen: { strokeColor: 'Custom pen colour', strokeWidth: 'Width' },
  shape: { strokeColor: 'Custom shape colour', strokeWidth: 'Width' },
  highlighter: { hlColor: 'Custom highlighter colour', hlWidth: 'Width' },
  text: { strokeColor: 'Custom text colour', fontSize: 'Text size' },
  selection: { strokeColor: 'Custom colour for the selection' },
  none: { none: '' },
};

const BUTTON_LABELS: Record<StyleTarget, string> = {
  pen: 'Colour and width',
  shape: 'Colour and width',
  highlighter: 'Colour and width',
  text: 'Colour and size',
  selection: 'Recolour selection',
  none: 'Colour and width',
};

interface PanelEntry {
  root: HTMLElement;
  label?: HTMLElement;
  input?: HTMLInputElement;
  sync?: () => void;
}

interface Menu {
  wrapper: HTMLElement;
  trigger: HTMLButtonElement;
  menu: HTMLElement;
}

interface MenuItemOptions {
  role: 'menuitem' | 'menuitemradio' | 'menuitemcheckbox';
  icon: IconName;
  label: string;
  action?: string;
  tool?: ToolType;
  shortcut?: ShortcutAction;
  withHint?: boolean;
  onSelect: () => void;
}

interface ToastState {
  el: HTMLElement;
  timer: number | null;
  remaining: number;
  startedAt: number;
  hovered: boolean;
  focused: boolean;
}

const toolShortcut = (tool: ToolType): ShortcutAction => `tool-${tool}`;

function childWithClass(parent: Element, className: string): HTMLElement | null {
  for (const child of Array.from(parent.children)) {
    if (child.classList.contains(className)) return child as HTMLElement;
  }
  return null;
}

/** Top edge of `el`, falling back to its inline `top` where layout is unavailable. */
function topOf(el: HTMLElement, fallback: HTMLElement): number {
  const top = el.getBoundingClientRect().top;
  return top !== 0 ? top : parseFloat(fallback.style.top) || 0;
}

/** Shifts a floating element sideways so it stays inside the viewport. */
function clampHorizontally(el: HTMLElement, centered: boolean, padding = VIEWPORT_PADDING): void {
  el.style.transform = '';
  const rect = el.getBoundingClientRect();
  const viewportWidth = window.innerWidth || 1200;
  let shift = 0;
  if (rect.left < padding && rect.left !== 0) shift = padding - rect.left;
  else if (rect.right > viewportWidth - padding) shift = viewportWidth - padding - rect.right;
  if (shift !== 0) {
    el.style.transform = centered ? `translateX(calc(-50% + ${shift}px))` : `translateX(${shift}px)`;
  }
}

export class FloatingToolbar {
  private container: HTMLElement;
  private engine: CanvasEngine;
  private history: HistoryManager;
  private settings: ExtensionSettings;
  private callbacks: ToolbarCallbacks;

  private wrapper: HTMLElement;
  private toolbar: HTMLElement;
  private colorPopover: HTMLElement;
  private colorPreviewBtn: HTMLButtonElement;
  private liveRegion: HTMLElement;
  private clearBtn!: HTMLButtonElement;
  private countBadge!: HTMLElement;
  private visibilityItem!: HTMLButtonElement;
  private shapesTrigger!: HTMLButtonElement;
  private anchorItem!: HTMLButtonElement;
  private panels!: Record<PanelControl, PanelEntry>;
  private menus: Menu[] = [];
  private readonly shortcutOf = new Map<HTMLElement, ShortcutAction>();

  private toast: ToastState | null = null;
  private announceTimer: number | null = null;
  private positionSaveTimer: number | null = null;

  private isOpen = false;
  private returnFocusTo: HTMLElement | null = null;
  private isDragging = false;
  private dragOffset = { x: 0, y: 0 };

  constructor(
    container: HTMLElement,
    engine: CanvasEngine,
    history: HistoryManager,
    _textEditor: TextEditorOverlay,
    settings: ExtensionSettings,
    callbacks: ToolbarCallbacks = {}
  ) {
    this.container = container;
    this.engine = engine;
    this.history = history;
    this.settings = { ...settings };
    this.callbacks = callbacks;

    this.wrapper = document.createElement('div');
    this.wrapper.className = 'pa-toolbar-wrapper';
    this.wrapper.setAttribute('role', 'region');
    this.wrapper.setAttribute('aria-label', 'Page Anchor drawing toolbar');
    this.wrapper.style.display = 'none';

    this.toolbar = document.createElement('div');
    this.toolbar.className = 'pa-toolbar';
    this.toolbar.setAttribute('role', 'toolbar');
    this.toolbar.setAttribute('aria-label', 'Drawing tools');

    this.colorPopover = document.createElement('div');
    this.colorPopover.className = 'pa-popover';
    this.colorPopover.setAttribute('role', 'dialog');
    this.colorPopover.setAttribute('aria-label', 'Drawing defaults');

    this.colorPreviewBtn = document.createElement('button');
    this.colorPreviewBtn.type = 'button';

    // Kept outside the wrapper so announcements still work while the toolbar is hidden.
    this.liveRegion = document.createElement('div');
    this.liveRegion.className = 'sr-only pa-live-region';
    this.liveRegion.setAttribute('role', 'status');
    this.liveRegion.setAttribute('aria-live', 'polite');
    this.liveRegion.setAttribute('aria-atomic', 'true');

    this.buildToolbarContent();

    this.wrapper.appendChild(this.toolbar);
    this.wrapper.appendChild(this.buildCornerCloseButton());
    this.container.appendChild(this.wrapper);
    this.container.appendChild(this.liveRegion);

    this.initDragEvents();
    this.initTooltipEvents();
    this.applyDrawingDefaults();
    this.syncDrawingDefaultControls();
    this.updateActiveToolUI();
    this.updateHistoryButtons();
    this.updateBadge();
    this.engine.setAnnotationsVisible(this.settings.areAnnotationsVisible);
    this.renderMenuToggles();

    window.addEventListener('resize', this.handleResize, { passive: true });
    window.addEventListener('pointerdown', this.handleOutsidePointerDown, true);
  }

  /** Safe to call on every settings change; never opens the toolbar, which only the user does. */
  public setSettings(settings: ExtensionSettings): void {
    const pendingPosition = this.positionSaveTimer !== null || this.isDragging;
    this.settings = {
      ...settings,
      toolbarPosition: pendingPosition ? this.settings.toolbarPosition : settings.toolbarPosition,
    };

    this.applyDrawingDefaults();
    this.syncDrawingDefaultControls();
    this.updateTooltips();
    this.engine.setAnnotationsVisible(settings.areAnnotationsVisible);
    this.engine.setOrphanedAnchorMode(settings.orphanedAnchorMode);
    this.engine.setStrokeSimplification(settings.strokeSimplification);
    this.renderMenuToggles();

    if (this.isOpen && !pendingPosition) this.applyRestingPosition();
  }

  /** Removes the toolbar's DOM and every listener it registered outside its own elements. */
  public destroy(): void {
    window.removeEventListener('resize', this.handleResize);
    window.removeEventListener('pointerdown', this.handleOutsidePointerDown, true);
    if (this.positionSaveTimer !== null) {
      clearTimeout(this.positionSaveTimer);
      this.positionSaveTimer = null;
      saveSettings({ toolbarPosition: this.settings.toolbarPosition }).catch(() => {});
    }
    this.dismissToast(true);
    if (this.announceTimer !== null) clearTimeout(this.announceTimer);
    this.announceTimer = null;
    this.wrapper.remove();
    this.liveRegion.remove();
  }

  public updateBadge(): void {
    if (!this.countBadge) return;
    const count = this.engine.getElements().length;
    this.countBadge.textContent = `${count}`;
    this.countBadge.style.display = count > 0 ? 'inline-block' : 'none';
    this.renderShortcutLabel(this.clearBtn);
  }

  public updateHistoryButtons(): void {
    const undoBtn = this.toolbar.querySelector<HTMLButtonElement>('[data-action="undo"]');
    const redoBtn = this.toolbar.querySelector<HTMLButtonElement>('[data-action="redo"]');
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

  public setDrawingMode(active: boolean): void {
    if (active === this.isOpen) return;
    if (!active) {
      this.hideToolbar();
      return;
    }
    this.rememberFocusOrigin();
    this.isOpen = true;
    this.engine.setActiveMode(true);
    this.wrapper.style.display = 'block';
    this.applyRestingPosition();
    this.callbacks.onToggleActive?.(true);
  }

  public toggleDrawingMode(): void {
    this.setDrawingMode(!this.isOpen);
  }

  /** Removes the toolbar from the page. Use the extension icon or a shortcut to bring it back. */
  private hideToolbar(): void {
    if (!this.isOpen) return;
    this.moveFocusOutOfToolbar();
    this.isOpen = false;
    this.closeColorPopover();
    this.closeMenus();
    this.engine.setActiveMode(false);
    this.wrapper.style.display = 'none';
    this.callbacks.onToggleActive?.(false);
  }

  private activeElement(): Element | null {
    const root = this.wrapper.getRootNode();
    return root instanceof ShadowRoot ? root.activeElement : this.wrapper.ownerDocument.activeElement;
  }

  private hasFocusWithin(el: HTMLElement): boolean {
    const active = this.activeElement();
    return !!active && el.contains(active);
  }

  private rememberFocusOrigin(): void {
    const prev = document.activeElement;
    const root = this.wrapper.getRootNode();
    const isOwnHost = root instanceof ShadowRoot && prev === root.host;
    this.returnFocusTo = prev instanceof HTMLElement && prev !== document.body && !isOwnHost ? prev : null;
  }

  /** Hands focus back to where it was before the toolbar opened, so it never sits on a hidden control. */
  private moveFocusOutOfToolbar(): void {
    const active = this.activeElement();
    if (!(active instanceof HTMLElement) || !this.wrapper.contains(active)) return;
    const target = this.returnFocusTo;
    this.returnFocusTo = null;
    if (target?.isConnected) target.focus({ preventScroll: true });
    if (this.activeElement() === active) active.blur();
  }

  private readonly handleResize = (): void => {
    if (this.isOpen && !this.isDragging) this.applyRestingPosition();
  };

  private readonly handleOutsidePointerDown = (e: Event): void => {
    // composedPath() sees through the shadow root; pointerdown (not click) keeps the popover open when a slider drag ends outside it.
    if (e.composedPath().includes(this.wrapper)) return;
    this.closeColorPopover();
    this.closeMenus();
  };

  /** Places the toolbar at the saved position, clamped into the viewport without changing what is saved. */
  private applyRestingPosition(): void {
    const pos = this.settings.toolbarPosition;
    if (pos) {
      const { x, y } = this.clampToViewport(pos.x, pos.y);
      this.wrapper.style.transform = 'none';
      this.wrapper.style.left = `${x}px`;
      this.wrapper.style.top = `${y}px`;
    } else {
      this.wrapper.style.transform = 'translateX(-50%)';
      this.wrapper.style.left = '50%';
      this.wrapper.style.top = '24px';
    }
    this.updateViewportPlacement();
  }

  private clampToViewport(x: number, y: number): { x: number; y: number } {
    const rect = this.wrapper.getBoundingClientRect();
    const w = rect.width || 440;
    const h = rect.height || 50;
    const maxX = Math.max(VIEWPORT_PADDING, window.innerWidth - w - VIEWPORT_PADDING);
    const maxY = Math.max(VIEWPORT_PADDING, window.innerHeight - h - VIEWPORT_PADDING);
    return {
      x: Math.max(VIEWPORT_PADDING, Math.min(maxX, x)),
      y: Math.max(VIEWPORT_PADDING, Math.min(maxY, y)),
    };
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

  private buildToolbarContent(): void {
    const dragHandle = document.createElement('div');
    dragHandle.className = 'pa-drag-handle';
    dragHandle.setAttribute('role', 'button');
    dragHandle.setAttribute('tabindex', '0');
    dragHandle.setAttribute('aria-label', 'Move toolbar position. Drag or use arrow keys.');
    setMarkup(dragHandle, ICONS.dragHandle);
    dragHandle.appendChild(buildTooltip('Move toolbar', 'Arrow keys'));
    this.toolbar.appendChild(dragHandle);

    this.toolbar.appendChild(this.createToolButton('select'));
    this.toolbar.appendChild(this.createSeparator());

    // Primary drawing tools stay on the bar; less common ones live in menus.
    this.toolbar.appendChild(this.createToolButton('pen'));
    this.toolbar.appendChild(this.createToolButton('highlighter'));
    this.toolbar.appendChild(this.createToolButton('text'));
    this.toolbar.appendChild(this.createToolButton('eraser'));
    this.toolbar.appendChild(this.buildShapesMenu());
    this.toolbar.appendChild(this.createSeparator());

    this.colorPreviewBtn.className = 'pa-color-preview-btn';
    this.colorPreviewBtn.setAttribute('aria-haspopup', 'dialog');
    this.colorPreviewBtn.setAttribute('aria-expanded', 'false');
    this.colorPreviewBtn.appendChild(buildTooltip('Drawing defaults'));
    this.colorPreviewBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleColorPopover();
    });
    this.toolbar.appendChild(this.colorPreviewBtn);
    this.buildColorPopover();
    // Directly after its trigger so Tab moves from the button into the popover.
    this.toolbar.appendChild(this.colorPopover);

    this.toolbar.appendChild(this.createSeparator());
    this.toolbar.appendChild(this.createActionButton('undo', 'Undo', 'undo', 'action-undo', () => this.undo()));
    this.toolbar.appendChild(this.createActionButton('redo', 'Redo', 'redo', 'action-redo', () => this.redo()));

    this.clearBtn = this.createActionButton('clear', 'Clear Page', 'trash', 'action-clear', () =>
      this.clearPageWithToast()
    );
    const countBadge = document.createElement('span');
    countBadge.className = 'pa-count-badge';
    countBadge.setAttribute('aria-hidden', 'true');
    countBadge.style.display = 'none';
    this.clearBtn.appendChild(countBadge);
    this.countBadge = countBadge;
    this.toolbar.appendChild(this.clearBtn);

    this.toolbar.appendChild(this.buildMoreMenu());
  }

  /** The five shape tools. They keep their own shortcuts, so the menu is a convenience rather than the only route. */
  private buildShapesMenu(): HTMLElement {
    const items = SHAPE_TOOLS.map((tool) =>
      this.createMenuItem({
        role: 'menuitemradio',
        icon: TOOL_INFO[tool].icon,
        label: TOOL_INFO[tool].label,
        tool,
        shortcut: toolShortcut(tool),
        onSelect: () => {
          this.engine.setTool(tool);
          this.updateActiveToolUI();
        },
      })
    );
    const menu = this.buildMenu('shapes', 'Shape tools', 'shapes', false, items);
    this.shapesTrigger = menu.querySelector<HTMLButtonElement>('.pa-menu-trigger')!;
    return menu;
  }

  private buildMoreMenu(): HTMLElement {
    this.visibilityItem = this.createMenuItem({
      role: 'menuitemcheckbox',
      icon: 'eye',
      label: 'Show Drawings',
      action: 'visibility',
      withHint: true,
      onSelect: () => {
        const next = !this.engine.getAnnotationsVisible();
        this.engine.setAnnotationsVisible(next);
        this.settings.areAnnotationsVisible = next;
        saveSettings({ areAnnotationsVisible: next }).catch(() => {});
        this.renderMenuToggles();
      },
    });

    this.anchorItem = this.createMenuItem({
      role: 'menuitemcheckbox',
      icon: 'anchor',
      label: 'Smart Anchoring',
      action: 'dom-anchor',
      withHint: true,
      onSelect: () => {
        const next = !this.engine.getDomAnchoringEnabled();
        this.engine.setDomAnchoringEnabled(next);
        this.callbacks.onToggleDomAnchoring?.(next);
        this.renderMenuToggles();
      },
    });

    const items = [
      this.createMenuItem({
        role: 'menuitem',
        icon: 'selectAll',
        label: 'Select All to Move',
        action: 'select-all',
        onSelect: () => {
          this.engine.selectAll();
          this.updateActiveToolUI();
        },
      }),
      this.visibilityItem,
      this.anchorItem,
      this.createMenuItem({
        role: 'menuitem',
        icon: 'saveImage',
        label: 'Save as PNG',
        action: 'export-png',
        onSelect: () => this.callbacks.onExport?.('png'),
      }),
      this.createMenuItem({
        role: 'menuitem',
        icon: 'savePdf',
        label: 'Save as PDF',
        action: 'export-pdf',
        onSelect: () => this.callbacks.onExport?.('pdf'),
      }),
      this.createMenuItem({
        role: 'menuitem',
        icon: 'settings',
        label: 'Settings & Backup',
        action: 'open-options',
        onSelect: () => this.callbacks.onOpenOptions?.(),
      }),
    ];
    return this.buildMenu('more', 'More options', 'more', true, items);
  }

  private createMenuItem(opts: MenuItemOptions): HTMLButtonElement {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'pa-menu-item';
    item.tabIndex = -1;
    item.setAttribute('role', opts.role);
    if (opts.action) item.dataset.action = opts.action;
    if (opts.tool) item.dataset.tool = opts.tool;
    if (opts.role !== 'menuitem') item.setAttribute('aria-checked', 'false');

    const icon = document.createElement('span');
    icon.className = 'pa-menu-item-icon';
    icon.setAttribute('aria-hidden', 'true');
    setMarkup(icon, ICONS[opts.icon]);
    item.appendChild(icon);

    const label = document.createElement('span');
    label.className = 'pa-menu-item-label';
    label.textContent = opts.label;
    item.appendChild(label);

    if (opts.withHint) {
      const hint = document.createElement('span');
      hint.className = 'pa-menu-item-hint';
      hint.setAttribute('aria-hidden', 'true');
      item.appendChild(hint);
    }

    if (opts.shortcut) {
      const kbd = document.createElement('kbd');
      kbd.className = 'pa-menu-item-key';
      item.appendChild(kbd);
      this.registerShortcut(item, opts.shortcut);
    }

    item.addEventListener('click', opts.onSelect);
    return item;
  }

  private buildMenu(
    action: string,
    label: string,
    icon: IconName,
    alignRight: boolean,
    items: HTMLButtonElement[]
  ): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'pa-menu-anchor';

    const trigger = document.createElement('button');
    trigger.className = 'pa-btn pa-menu-trigger';
    trigger.dataset.action = action;
    trigger.setAttribute('aria-haspopup', 'menu');
    trigger.setAttribute('aria-expanded', 'false');
    this.decorateButton(trigger, label, icon);

    const menu = document.createElement('div');
    menu.className = alignRight ? 'pa-menu pa-menu-right' : 'pa-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', label);

    const entry: Menu = { wrapper, trigger, menu };
    for (const item of items) {
      item.addEventListener('click', () => this.closeMenu(entry, this.hasFocusWithin(menu)));
      menu.appendChild(item);
    }

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      if (wrapper.classList.contains('open')) this.closeMenu(entry);
      else this.openMenu(entry, 'first');
    });
    trigger.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      e.stopPropagation();
      this.openMenu(entry, e.key === 'ArrowDown' ? 'first' : 'last');
    });
    menu.addEventListener('keydown', (e) => this.handleMenuKeydown(entry, e));
    wrapper.addEventListener('focusout', (e) => {
      if (e.relatedTarget instanceof Node && !wrapper.contains(e.relatedTarget)) this.closeMenu(entry);
    });

    wrapper.appendChild(trigger);
    wrapper.appendChild(menu);
    this.menus.push(entry);
    return wrapper;
  }

  private menuItems(entry: Menu): HTMLElement[] {
    return Array.from(entry.menu.querySelectorAll<HTMLElement>('[role^="menuitem"]'));
  }

  private handleMenuKeydown(entry: Menu, e: KeyboardEvent): void {
    if (e.key === 'Tab') {
      // Focus the trigger first so the browser's own Tab step continues from there.
      this.closeMenu(entry, true);
      return;
    }
    const items = this.menuItems(entry);
    const current = e.target instanceof HTMLElement ? items.indexOf(e.target) : -1;
    let next: number;
    switch (e.key) {
      case 'ArrowDown':
        next = (current + 1) % items.length;
        break;
      case 'ArrowUp':
        next = (current - 1 + items.length) % items.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = items.length - 1;
        break;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        this.closeMenu(entry, true);
        return;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
    items[next]?.focus();
  }

  private openMenu(entry: Menu, focus: 'first' | 'last'): void {
    this.closeColorPopover();
    this.closeMenus();
    entry.wrapper.classList.add('open');
    entry.menu.classList.add('open');
    entry.trigger.setAttribute('aria-expanded', 'true');
    this.positionMenu(entry);
    const items = this.menuItems(entry);
    items[focus === 'first' ? 0 : items.length - 1]?.focus();
  }

  private closeMenu(entry: Menu, restoreFocus = false): void {
    entry.wrapper.classList.remove('open');
    entry.menu.classList.remove('open', 'above');
    entry.menu.style.maxHeight = '';
    entry.menu.style.transform = '';
    entry.trigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus) entry.trigger.focus();
  }

  public closeMenus(): void {
    for (const entry of this.menus) this.closeMenu(entry);
  }

  /** Opens `el` on its preferred side of the anchor, flips it when the other side has more room, caps its height and keeps it on screen. */
  private placeFloating(
    el: HTMLElement,
    anchor: HTMLElement,
    opts: { preferred: 'above' | 'below'; flipClass: string; fallbackSize: number; minHeight: number; centered: boolean }
  ): void {
    const top = topOf(anchor, this.wrapper);
    const anchorHeight = anchor.offsetHeight || 32;
    const size = el.offsetHeight || opts.fallbackSize;
    const viewportHeight = window.innerHeight || 800;
    const room = {
      above: top - VIEWPORT_PADDING,
      below: viewportHeight - (top + anchorHeight) - VIEWPORT_PADDING,
    };
    const other = opts.preferred === 'above' ? 'below' : 'above';
    const flip = room[opts.preferred] < size && room[other] > room[opts.preferred];
    el.classList.toggle(opts.flipClass, flip);

    const available = room[flip ? other : opts.preferred];
    el.style.maxHeight = available > 0 && available < size ? `${Math.max(opts.minHeight, available)}px` : '';
    clampHorizontally(el, opts.centered);
  }

  private positionMenu(entry: Menu): void {
    this.placeFloating(entry.menu, entry.wrapper, {
      preferred: 'below',
      flipClass: 'above',
      fallbackSize: 220,
      minHeight: 120,
      centered: !entry.menu.classList.contains('pa-menu-right'),
    });
  }

  private positionColorPopover(): void {
    this.placeFloating(this.colorPopover, this.wrapper, {
      preferred: 'above',
      flipClass: 'below',
      fallbackSize: 320,
      minHeight: 160,
      centered: true,
    });
  }

  /** Renders the checked state of the More menu toggles from the engine, or from an explicit override. */
  private renderMenuToggles(override: { visible?: boolean; anchoring?: boolean } = {}): void {
    const visible = override.visible ?? this.engine.getAnnotationsVisible();
    const anchoring = override.anchoring ?? this.engine.getDomAnchoringEnabled();
    this.renderToggleItem(this.visibilityItem, visible, visible ? 'eye' : 'eyeOff');
    this.renderToggleItem(this.anchorItem, anchoring, 'anchor');
  }

  private renderToggleItem(item: HTMLButtonElement, on: boolean, icon: IconName): void {
    item.setAttribute('aria-checked', on ? 'true' : 'false');
    const iconSlot = childWithClass(item, 'pa-menu-item-icon');
    if (iconSlot) setMarkup(iconSlot, ICONS[icon]);
    const hint = childWithClass(item, 'pa-menu-item-hint');
    if (hint) hint.textContent = on ? 'On' : 'Off';
  }

  public updateDomAnchoringUI(enabled: boolean): void {
    this.renderMenuToggles({ anchoring: enabled });
  }

  public isHighlighterActive(): boolean {
    return this.engine.getTool() === 'highlighter';
  }

  /** Announces through the persistent live region; clearing first makes a repeated message announce again. */
  private announce(message: string): void {
    this.liveRegion.textContent = '';
    if (this.announceTimer !== null) clearTimeout(this.announceTimer);
    this.announceTimer = window.setTimeout(() => {
      this.announceTimer = null;
      this.liveRegion.textContent = message;
    }, 50);
  }

  public showToast(message: string, actionLabel?: string, onAction?: () => void, durationMs = 4500): void {
    this.dismissToast(true);

    const el = document.createElement('div');
    el.className = 'pa-toast';

    const text = document.createElement('span');
    text.className = 'pa-toast-text';
    text.textContent = message;
    el.appendChild(text);

    const state: ToastState = { el, timer: null, remaining: durationMs, startedAt: 0, hovered: false, focused: false };
    const pause = () => {
      if (state.timer === null) return;
      clearTimeout(state.timer);
      state.timer = null;
      state.remaining = Math.max(TOAST_RESUME_MIN_MS, state.remaining - (Date.now() - state.startedAt));
    };
    const resume = () => {
      if (state.timer !== null || state.hovered || state.focused || this.toast !== state) return;
      state.startedAt = Date.now();
      state.timer = window.setTimeout(() => this.dismissToast(), state.remaining);
    };

    el.addEventListener('pointerenter', () => {
      state.hovered = true;
      pause();
    });
    el.addEventListener('pointerleave', () => {
      state.hovered = false;
      resume();
    });
    el.addEventListener('focusin', () => {
      state.focused = true;
      pause();
    });
    el.addEventListener('focusout', (e) => {
      if (e.relatedTarget instanceof Node && el.contains(e.relatedTarget)) return;
      state.focused = false;
      resume();
    });
    el.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      this.dismissToast();
    });

    if (actionLabel && onAction) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pa-toast-btn';
      btn.textContent = actionLabel;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        onAction();
        this.dismissToast();
      });
      el.appendChild(btn);
    }

    const top = parseFloat(this.wrapper.style.top) || this.wrapper.getBoundingClientRect().top || 0;
    const roomBelow = (window.innerHeight || 800) - (top + (this.wrapper.offsetHeight || 44));
    el.classList.toggle('above', roomBelow < 48);

    this.wrapper.appendChild(el);
    this.toast = state;
    resume();
    this.announce(message);
  }

  private dismissToast(immediate = false): void {
    const state = this.toast;
    if (!state) return;
    this.toast = null;
    if (state.timer !== null) clearTimeout(state.timer);
    if (this.hasFocusWithin(state.el) && this.isOpen) this.clearBtn.focus();
    if (immediate) {
      state.el.remove();
      return;
    }
    state.el.classList.add('pa-toast-hiding');
    window.setTimeout(() => state.el.remove(), 180);
  }

  public clearPageWithToast(): void {
    const cleared = this.engine.getElements();

    // engine.clear() reports the change, which the host records in history, so one undo restores the page.
    this.engine.clear();
    this.updateHistoryButtons();
    this.updateBadge();
    this.callbacks.onClear?.();

    if (cleared.length > 0) {
      this.showToast('Page drawings cleared', 'Undo', () => this.restoreCleared(cleared));
    }
  }

  /** Brings back exactly the drawings a clear removed, keeping anything drawn since. */
  private restoreCleared(cleared: AnchorElement[]): void {
    const current = this.engine.getElements();
    const present = new Set(current.map((el) => el.id));
    const restored = [...current, ...cleared.filter((el) => !present.has(el.id))];
    this.engine.setElements(restored);
    this.history.pushState([...restored]);
    this.updateHistoryButtons();
    this.updateBadge();
    this.callbacks.onClear?.();
  }

  public undo(): void {
    const prev = this.history.undo();
    if (prev === null) return;
    this.engine.setElements(prev);
    this.updateHistoryButtons();
    this.updateBadge();
    this.callbacks.onClear?.();
  }

  public redo(): void {
    const next = this.history.redo();
    if (next === null) return;
    this.engine.setElements(next);
    this.updateHistoryButtons();
    this.updateBadge();
    this.callbacks.onClear?.();
  }

  private toggleColorPopover(): void {
    if (this.colorPopover.classList.contains('open')) this.closeColorPopover();
    else this.openColorPopover();
  }

  private openColorPopover(): void {
    this.closeMenus();
    this.colorPopover.classList.add('open');
    this.colorPreviewBtn.setAttribute('aria-expanded', 'true');
    this.refreshColorControls();
    const body = this.colorPopover.querySelector<HTMLElement>('.pa-popover-body');
    (body && this.firstVisibleControl(body))?.focus();
  }

  private closeColorPopover(restoreFocus = false): void {
    this.colorPopover.classList.remove('open');
    this.colorPopover.style.transform = '';
    this.colorPreviewBtn.setAttribute('aria-expanded', 'false');
    if (restoreFocus) this.colorPreviewBtn.focus();
  }

  private firstVisibleControl(root: HTMLElement): HTMLElement | null {
    const isShown = (el: HTMLElement): boolean => {
      for (let node: HTMLElement | null = el; node && node !== root; node = node.parentElement) {
        if (node.style.display === 'none') return false;
      }
      return true;
    };
    return Array.from(root.querySelectorAll<HTMLElement>('button, input')).find(isShown) ?? null;
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

    headerRow.appendChild(toolInfo);
    headerRow.appendChild(this.buildResetButton());
    header.appendChild(headerRow);

    this.colorPopover.appendChild(header);

    const body = document.createElement('div');
    body.className = 'pa-popover-body';

    const grid = document.createElement('div');
    grid.className = 'pa-color-grid';
    grid.setAttribute('role', 'group');
    for (const color of PRESET_COLORS) {
      const swatch = document.createElement('button');
      swatch.type = 'button';
      swatch.className = 'pa-color-swatch';
      swatch.style.backgroundColor = color;
      swatch.dataset.color = color;
      swatch.setAttribute('aria-label', `Color ${color}`);
      swatch.addEventListener('click', () => this.applyColor(color));
      grid.appendChild(swatch);
    }
    body.appendChild(grid);

    this.panels = {
      strokeColor: this.buildCustomColorSwatch('defaultStrokeColor'),
      strokeWidth: this.buildSliderField('defaultStrokeWidth', 1, 30),
      hlColor: this.buildCustomColorSwatch('defaultHighlighterColor'),
      hlWidth: this.buildSliderField('defaultHighlighterWidth', 8, 50),
      fontSize: this.buildSliderField('defaultFontSize', 12, 36),
      none: { root: this.buildNonePanel() },
    };
    grid.appendChild(this.panels.strokeColor.root);
    grid.appendChild(this.panels.hlColor.root);
    for (const key of ['strokeWidth', 'hlWidth', 'fontSize', 'none'] as const) body.appendChild(this.panels[key].root);

    this.colorPopover.appendChild(body);

    this.colorPopover.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      this.closeColorPopover(true);
    });
    this.colorPopover.addEventListener('focusout', (e) => {
      const next = e.relatedTarget;
      // Switching tools from the toolbar keeps the popover open so it can follow the active tool.
      if (next instanceof Node && !this.wrapper.contains(next)) {
        this.closeColorPopover();
      }
    });
  }

  /** Shown for tools without stroke settings (eraser, select), with shortcuts to tools that have them. */
  private buildNonePanel(): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'pa-tool-panel-empty';

    const emptyMsg = document.createElement('p');
    emptyMsg.className = 'pa-tool-empty-msg';
    panel.appendChild(emptyMsg);


    const quickTools = document.createElement('div');
    quickTools.className = 'pa-quick-tools';
    const switchable: Array<{ tool: ToolType; label: string }> = [
      { tool: 'pen', label: 'Pen' },
      { tool: 'highlighter', label: 'Highlighter' },
      { tool: 'text', label: 'Text' },
    ];
    for (const { tool, label } of switchable) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pa-quick-tool-btn';
      btn.setAttribute('aria-label', `Switch to ${label}`);
      setMarkup(btn, ICONS[TOOL_INFO[tool].icon]);
      const span = document.createElement('span');
      span.textContent = label;
      btn.appendChild(span);
      btn.addEventListener('click', () => {
        this.engine.setTool(tool);
        this.updateActiveToolUI();
      });
      quickTools.appendChild(btn);
    }
    panel.appendChild(quickTools);
    return panel;
  }

  /** The last swatch in the grid, which opens the browser's colour picker for any other colour. */
  private buildCustomColorSwatch(setting: ColorSetting): PanelEntry {
    const swatch = document.createElement('label');
    swatch.className = 'pa-color-swatch pa-color-custom';

    const input = document.createElement('input');
    input.type = 'color';
    input.className = 'pa-popover-color';
    input.dataset.setting = setting;
    input.setAttribute('aria-label', 'Custom colour');
    input.addEventListener('input', () => {
      if (this.styleTarget() === 'selection') return;
      if (setting === 'defaultHighlighterColor') this.engine.setHighlighterColor(input.value);
      else this.engine.setStrokeColor(input.value);
      this.colorPreviewBtn.style.backgroundColor = input.value;
    });
    input.addEventListener('change', () => this.applyColor(input.value));

    swatch.appendChild(input);
    return {
      root: swatch,
      input,
      sync: () => {
        input.value = this.settings[setting];
      },
    };
  }

  /** A labelled slider with a live pixel readout inside the popover. */
  private buildSliderField(setting: SizeSetting, min: number, max: number): PanelEntry {
    const group = document.createElement('div');
    group.className = 'pa-slider-group';

    const header = document.createElement('div');
    header.className = 'pa-slider-label';
    const name = document.createElement('span');
    const readout = document.createElement('span');
    readout.className = 'pa-slider-readout';
    header.appendChild(name);
    header.appendChild(readout);

    const input = document.createElement('input');
    input.type = 'range';
    input.className = 'pa-slider';
    input.dataset.setting = setting;
    input.min = `${min}`;
    input.max = `${max}`;

    const show = (val: number) => {
      input.value = `${val}`;
      readout.textContent = `${val}px`;
      input.setAttribute('aria-valuetext', `${val} pixels`);
    };

    const apply = (commit: boolean) => {
      const val = parseInt(input.value, 10);
      show(val);
      if (setting === 'defaultStrokeWidth') this.engine.setStrokeWidth(val);
      else if (setting === 'defaultHighlighterWidth') this.engine.setHighlighterWidth(val);
      else this.engine.setFontSize(val);
      if (commit) {
        const patch: Partial<ExtensionSettings> = {};
        patch[setting] = val;
        this.updateDrawingDefaults(patch);
      }
    };

    input.addEventListener('input', () => apply(false));
    input.addEventListener('change', () => apply(true));

    group.appendChild(header);
    group.appendChild(input);
    return { root: group, label: name, input, sync: () => show(this.settings[setting]) };
  }

  /** A button that restores every drawing default to its factory value. */
  private buildResetButton(): HTMLElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pa-popover-reset';
    button.textContent = 'Reset';
    button.setAttribute('aria-label', 'Reset colours and sizes to defaults');
    button.addEventListener('click', () =>
      this.updateDrawingDefaults({
        defaultStrokeColor: DEFAULT_SETTINGS.defaultStrokeColor,
        defaultStrokeWidth: DEFAULT_SETTINGS.defaultStrokeWidth,
        defaultHighlighterColor: DEFAULT_SETTINGS.defaultHighlighterColor,
        defaultHighlighterWidth: DEFAULT_SETTINGS.defaultHighlighterWidth,
        defaultFontSize: DEFAULT_SETTINGS.defaultFontSize,
      })
    );
    return button;
  }

  private applyDrawingDefaults(): void {
    this.engine.setStrokeColor(this.settings.defaultStrokeColor);
    this.engine.setStrokeWidth(this.settings.defaultStrokeWidth);
    this.engine.setHighlighterColor(this.settings.defaultHighlighterColor);
    this.engine.setHighlighterWidth(this.settings.defaultHighlighterWidth);
    this.engine.setFontSize(this.settings.defaultFontSize);
  }

  /** Applies a change made from the toolbar to the engine, the host, and storage. */
  private updateDrawingDefaults(patch: Partial<ExtensionSettings>): void {
    Object.assign(this.settings, patch);
    this.applyDrawingDefaults();
    this.syncDrawingDefaultControls();
    this.callbacks.onSettingsUpdate?.(this.settings);
    saveSettings(patch).catch(() => {});
  }

  private syncDrawingDefaultControls(): void {
    for (const entry of Object.values(this.panels)) entry.sync?.();
    this.refreshColorControls();
  }

  /** With the select tool and drawings selected, colours apply to them instead of to a tool's defaults. */
  private styleTarget(): StyleTarget {
    const tool = this.engine.getTool();
    if (tool === 'select' && this.engine.getSelectedElements().length > 0) return 'selection';
    return TOOL_INFO[tool].category;
  }

  private applyColor(color: string): void {
    const target = this.styleTarget();
    if (target === 'selection') {
      this.engine.recolorSelected(color);
      this.refreshColorControls();
      return;
    }
    this.updateDrawingDefaults(target === 'highlighter' ? { defaultHighlighterColor: color } : { defaultStrokeColor: color });
  }

  /** The colour the selection shares, or null when it mixes colours. */
  private selectionColor(): string | null {
    const colors = new Set(this.engine.getSelectedElements().map((el) => el.strokeColor.toLowerCase()));
    return colors.size === 1 ? [...colors][0] : null;
  }

  /** Keeps the color preview button, popover header, and panel in step with the active tool or selection. */
  public refreshColorControls(): void {
    const target = this.styleTarget();
    const tool = this.engine.getTool();
    const info = TOOL_INFO[tool];
    const isNone = target === 'none';
    const color =
      target === 'selection'
        ? this.selectionColor()
        : target === 'highlighter'
          ? this.settings.defaultHighlighterColor
          : this.settings.defaultStrokeColor;

    this.colorPreviewBtn.style.backgroundColor = isNone ? '' : (color ?? '');
    this.colorPreviewBtn.classList.toggle('is-empty', isNone);
    this.colorPreviewBtn.classList.toggle('is-mixed', !isNone && color === null);
    const title = BUTTON_LABELS[target];
    this.colorPreviewBtn.setAttribute('aria-label', title);
    const tip = childWithClass(this.colorPreviewBtn, 'pa-tooltip');
    if (tip) tip.textContent = title;

    const isSelection = target === 'selection';
    this.colorPopover.setAttribute('aria-label', isSelection ? 'Selection colour' : `${info.label} settings`);

    const toolIcon = this.colorPopover.querySelector<HTMLElement>('.pa-popover-tool-icon');
    if (toolIcon) setMarkup(toolIcon, ICONS[isSelection ? 'selectAll' : info.icon]);
    const toolName = this.colorPopover.querySelector('.pa-popover-tool-name');
    if (toolName) toolName.textContent = isSelection ? `${this.engine.getSelectedElements().length} selected` : info.label;

    const reset = this.colorPopover.querySelector<HTMLElement>('.pa-popover-reset');
    if (reset) reset.style.display = isNone || isSelection ? 'none' : '';

    const grid = this.colorPopover.querySelector<HTMLElement>('.pa-color-grid');
    if (grid) {
      grid.style.display = isNone ? 'none' : 'grid';
      grid.setAttribute('aria-label', GRID_LABELS[target]);
    }

    const layout = PANEL_LAYOUT[target];
    for (const [key, entry] of Object.entries(this.panels) as Array<[PanelControl, PanelEntry]>) {
      const label = layout[key];
      const shown = entry.root.classList.contains('pa-color-swatch') ? 'block' : 'flex';
      entry.root.style.display = label === undefined ? 'none' : shown;
      if (!label) continue;
      if (entry.label) entry.label.textContent = label;
      entry.input?.setAttribute('aria-label', label);
    }
    if (isSelection && color && this.panels.strokeColor.input) this.panels.strokeColor.input.value = color;

    const emptyMsg = this.colorPopover.querySelector('.pa-tool-empty-msg');
    if (emptyMsg) {
      emptyMsg.textContent =
        tool === 'select' ? 'Select drawings to recolour them, or pick a tool.' : 'Pick a tool to set its colour and width.';
    }

    this.colorPopover.querySelectorAll<HTMLButtonElement>('button.pa-color-swatch').forEach((swatch) => {
      const isActive = !!color && swatch.dataset.color === color.toLowerCase();
      swatch.classList.toggle('active', isActive);
      swatch.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });

    if (this.colorPopover.classList.contains('open')) this.positionColorPopover();
  }

  /** Shared setup for toolbar buttons: icon, tooltip, and an accessible name that includes the shortcut. */
  private decorateButton(btn: HTMLButtonElement, label: string, icon: IconName, shortcut?: ShortcutAction): void {
    btn.type = 'button';
    btn.dataset.label = label;
    setMarkup(btn, ICONS[icon]);
    if (shortcut) {
      this.registerShortcut(btn, shortcut);
    } else {
      btn.appendChild(buildTooltip(label));
      btn.setAttribute('aria-label', label);
    }
  }

  private createToolButton(tool: ToolType): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = 'pa-btn';
    btn.dataset.tool = tool;
    btn.setAttribute('aria-pressed', 'false');
    this.decorateButton(btn, TOOL_INFO[tool].label, TOOL_INFO[tool].icon, toolShortcut(tool));
    btn.addEventListener('click', () => {
      this.engine.setTool(tool);
      this.updateActiveToolUI();
    });
    return btn;
  }

  private createActionButton(
    action: string,
    label: string,
    icon: IconName,
    shortcut: ShortcutAction,
    onClick: () => void
  ): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = 'pa-btn';
    btn.dataset.action = action;
    this.decorateButton(btn, label, icon, shortcut);
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick();
    });
    return btn;
  }

  private buildCornerCloseButton(): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = 'pa-toolbar-close-btn';
    btn.dataset.action = 'hide';
    this.decorateButton(btn, 'Hide Toolbar', 'close', 'action-toggle-toolbar');
    btn.addEventListener('pointerdown', (e) => e.stopPropagation());
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.hideToolbar();
    });
    return btn;
  }

  private createSeparator(): HTMLElement {
    const sep = document.createElement('div');
    sep.className = 'pa-separator';
    sep.setAttribute('aria-hidden', 'true');
    return sep;
  }

  private getShortcutDisplay(action: ShortcutAction): string {
    const combo = this.settings.shortcuts[action];
    return combo ? formatShortcutForDisplay(combo) : '';
  }

  private registerShortcut(el: HTMLElement, shortcut: ShortcutAction): void {
    el.dataset.shortcut = shortcut;
    this.shortcutOf.set(el, shortcut);
    this.renderShortcutLabel(el);
  }

  /** Writes the current shortcut into a menu item's key label, or into a button's tooltip and accessible name. */
  private renderShortcutLabel(el: HTMLElement): void {
    const shortcut = this.shortcutOf.get(el);
    const keys = shortcut ? this.getShortcutDisplay(shortcut) : '';

    const menuKey = childWithClass(el, 'pa-menu-item-key');
    if (menuKey) {
      menuKey.textContent = keys;
      menuKey.style.display = keys ? '' : 'none';
      return;
    }

    const label = el.dataset.label ?? '';
    const fresh = buildTooltip(label, keys);
    const tip = childWithClass(el, 'pa-tooltip');
    // Refill in place so placement classes from adjustTooltipPosition survive.
    if (tip) tip.replaceChildren(...Array.from(fresh.childNodes));
    else el.appendChild(fresh);

    // Tool keys are printed on the button itself; combos like Ctrl + Z are too long and stay in the tooltip.
    if (el.dataset.tool) {
      const singleKey = keys && !keys.includes(' + ') ? keys : '';
      let hint = childWithClass(el, 'pa-key-hint');
      if (singleKey && !hint) {
        hint = document.createElement('span');
        hint.className = 'pa-key-hint';
        hint.setAttribute('aria-hidden', 'true');
        el.appendChild(hint);
      }
      if (hint) {
        hint.textContent = singleKey;
        hint.style.display = singleKey ? '' : 'none';
      }
      el.classList.toggle('has-key-hint', !!singleKey);
    }

    const count = el === this.clearBtn ? this.engine.getElements().length : 0;
    const countText = count > 0 ? `, ${count} drawing${count === 1 ? '' : 's'}` : '';
    el.setAttribute('aria-label', `${label}${countText}${keys ? ` (${keys})` : ''}`);
  }

  public updateTooltips(): void {
    for (const el of this.shortcutOf.keys()) this.renderShortcutLabel(el);
  }

  public updateActiveToolUI(): void {
    const current = this.engine.getTool();
    this.toolbar.querySelectorAll<HTMLElement>('[data-tool]').forEach((btn) => {
      const isActive = btn.dataset.tool === current;
      btn.classList.toggle('active', isActive);
      if (btn.getAttribute('role') === 'menuitemradio') {
        btn.setAttribute('aria-checked', isActive ? 'true' : 'false');
      } else {
        btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      }
    });

    // Shape tools live in a menu, so their trigger carries the active state on the bar.
    const isShapeActive = SHAPE_TOOLS.includes(current);
    this.shapesTrigger.classList.toggle('active', isShapeActive);
    this.shapesTrigger.setAttribute('aria-pressed', isShapeActive ? 'true' : 'false');
    // The trigger shows the last shape used, so the bar always says which shape a press will draw.
    if (isShapeActive) {
      const [icon] = markupToNodes(ICONS[TOOL_INFO[current].icon]);
      const svg = this.shapesTrigger.querySelector('svg');
      if (icon && svg) svg.replaceWith(icon);
    }

    this.refreshColorControls();
  }

  private initDragEvents(): void {
    const dragHandle = this.toolbar.querySelector<HTMLElement>('.pa-drag-handle');
    if (!dragHandle) return;

    let startX = 0;
    let startY = 0;
    let moved = false;
    let last = { x: 0, y: 0 };

    dragHandle.addEventListener('pointerdown', (e: PointerEvent) => {
      if (e.button !== 0) return;
      this.isDragging = true;
      moved = false;
      startX = e.clientX;
      startY = e.clientY;
      const rect = this.wrapper.getBoundingClientRect();
      last = { x: rect.left, y: rect.top };
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
      last = this.clampToViewport(e.clientX - this.dragOffset.x, e.clientY - this.dragOffset.y);
      this.wrapper.style.left = `${last.x}px`;
      this.wrapper.style.top = `${last.y}px`;
      this.updateViewportPlacement();
    });

    const finishDrag = (commit: boolean) => {
      if (!this.isDragging) return;
      this.isDragging = false;
      if (commit && moved) this.persistToolbarPosition(last);
    };

    dragHandle.addEventListener('pointerup', () => finishDrag(true));
    dragHandle.addEventListener('pointercancel', () => finishDrag(false));

    // Keyboard alternative for repositioning (WCAG 2.5.7).
    const step = 20;
    const nudges: Record<string, { dx: number; dy: number }> = {
      ArrowUp: { dx: 0, dy: -step },
      ArrowDown: { dx: 0, dy: step },
      ArrowLeft: { dx: -step, dy: 0 },
      ArrowRight: { dx: step, dy: 0 },
    };
    dragHandle.addEventListener('keydown', (e: KeyboardEvent) => {
      const nudge = nudges[e.key];
      if (!nudge) return;
      e.preventDefault();
      const rect = this.wrapper.getBoundingClientRect();
      const next = this.clampToViewport(rect.left + nudge.dx, rect.top + nudge.dy);
      this.wrapper.style.transform = 'none';
      this.wrapper.style.left = `${next.x}px`;
      this.wrapper.style.top = `${next.y}px`;
      this.persistToolbarPosition(next);
      this.updateViewportPlacement();
    });
  }

  public updateViewportPlacement(): void {
    if (this.wrapper.style.display === 'none') return;
    this.wrapper.classList.toggle('pa-placement-top', topOf(this.wrapper, this.wrapper) < 48);

    if (this.colorPopover.classList.contains('open')) this.positionColorPopover();
    for (const entry of this.menus) {
      if (entry.wrapper.classList.contains('open')) this.positionMenu(entry);
    }
  }

  private initTooltipEvents(): void {
    const handleTooltipTarget = (el: EventTarget | null) => {
      if (!(el instanceof HTMLElement)) return;
      const target = el.closest<HTMLElement>('.pa-btn, .pa-toolbar-close-btn, .pa-drag-handle, .pa-color-preview-btn');
      if (!target) return;
      const tip = childWithClass(target, 'pa-tooltip');
      if (tip) this.adjustTooltipPosition(target, tip);
    };
    this.wrapper.addEventListener('pointerenter', (e) => handleTooltipTarget(e.target), true);
    this.wrapper.addEventListener('focusin', (e) => handleTooltipTarget(e.target), true);
    // A pressed button has done its job; its tooltip would only cover the menu, popover or toast it opened.
    this.wrapper.addEventListener('pointerdown', (e) => {
      if (e.target instanceof Element) e.target.closest('.pa-btn, .pa-color-preview-btn')?.classList.add('pa-tip-hidden');
    });
    this.wrapper.addEventListener(
      'pointerleave',
      (e) => {
        if (e.target instanceof Element) e.target.classList.remove('pa-tip-hidden');
      },
      true
    );
  }

  public adjustTooltipPosition(btn: HTMLElement, tip: HTMLElement): void {
    const isNearTop = topOf(btn, this.wrapper) < 48 || this.wrapper.classList.contains('pa-placement-top');
    tip.classList.toggle('pa-tooltip-below', isNearTop);
    tip.style.left = '';
    tip.style.right = '';
    clampHorizontally(tip, !btn.classList.contains('pa-toolbar-close-btn'), 8);
  }
}
