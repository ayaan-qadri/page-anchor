import { CanvasEngine } from '../core/engine';
import { HistoryManager } from '../core/history';
import { ExtensionSettings, ToolType } from '../core/types';
import { ICONS } from '../icons/svg-icons';
import { SettingsModal } from './settings-modal';
import { TextEditorOverlay } from './text-editor';
import { formatShortcutForDisplay } from '../core/shortcuts';
import { saveSettings } from '../core/storage';

export interface ToolbarCallbacks {
  onToggleActive?: (active: boolean) => void;
  onClear?: () => void;
  onExport?: () => void;
  onSettingsUpdate?: (settings: ExtensionSettings) => void;
}

const PRESET_COLORS = [
  '#ef4444', // Red
  '#f97316', // Orange
  '#facc15', // Yellow
  '#22c55e', // Green
  '#06b6d4', // Cyan
  '#3b82f6', // Blue
  '#8b5cf6', // Purple
  '#ec4899', // Pink
  '#ffffff', // White
  '#000000', // Black
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
  private pillButton: HTMLElement;
  private colorPopover: HTMLElement;
  private colorPreviewBtn: HTMLElement;
  private strokeSlider: HTMLInputElement;
  private strokeSizeLabel: HTMLElement;

  private isDragging = false;
  private dragOffset = { x: 0, y: 0 };
  private isMinimized = false;

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

    // Create wrapper
    this.wrapper = document.createElement('div');
    this.wrapper.className = 'pa-toolbar-wrapper';

    // Set initial position (top center or saved)
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

    // Pill mode button (when minimized or inactive)
    this.pillButton = document.createElement('div');
    this.pillButton.className = 'pa-anchor-pill';
    this.pillButton.innerHTML = `
      ${ICONS.anchor}
      <span class="pa-pill-label">Page Anchor</span>
      <span class="pa-pill-badge" style="display: none;">0</span>
    `;
    this.container.appendChild(this.pillButton);

    // Color popover
    this.colorPopover = document.createElement('div');
    this.colorPopover.className = 'pa-popover';

    // Stroke slider refs
    this.strokeSlider = document.createElement('input');
    this.strokeSizeLabel = document.createElement('span');
    this.colorPreviewBtn = document.createElement('div');

    this.buildToolbarContent();
    this.wrapper.appendChild(this.toolbar);
    this.wrapper.appendChild(this.colorPopover);
    this.container.appendChild(this.wrapper);

    this.initDragEvents();
    this.bindPillEvents();
    this.updateActiveToolUI();
    this.updateHistoryButtons();
    this.updateBadge();

    // Respect persisted open/minimized state (default: false/minimized so it never intrudes on page load!)
    const shouldBeOpen = !!this.settings.isToolbarOpen;
    this.setDrawingMode(shouldBeOpen, false);

    // Apply drawing visibility preference
    if (this.settings.areAnnotationsVisible !== undefined) {
      this.engine.setAnnotationsVisible(this.settings.areAnnotationsVisible);
    }

    // Apply pill visibility preference
    if (this.settings.showFloatingPill === false) {
      this.pillButton.style.display = 'none';
    }
  }

  public setSettings(settings: ExtensionSettings): void {
    this.settings = settings;
    this.updateTooltips();
    if (settings.showFloatingPill !== undefined) {
      this.pillButton.style.display = settings.showFloatingPill ? 'flex' : 'none';
    }
    if (settings.areAnnotationsVisible !== undefined) {
      this.engine.setAnnotationsVisible(settings.areAnnotationsVisible);
    }
  }

  public updateBadge(): void {
    const count = this.engine.getElements().length;
    const badge = this.pillButton.querySelector('.pa-pill-badge') as HTMLElement;
    if (badge) {
      if (count > 0) {
        badge.textContent = `${count}`;
        badge.style.display = 'inline-block';
      } else {
        badge.style.display = 'none';
      }
    }
  }

  public updateHistoryButtons(): void {
    const undoBtn = this.toolbar.querySelector('[data-action="undo"]') as HTMLButtonElement;
    const redoBtn = this.toolbar.querySelector('[data-action="redo"]') as HTMLButtonElement;
    if (undoBtn) undoBtn.disabled = !this.history.canUndo();
    if (redoBtn) redoBtn.disabled = !this.history.canRedo();
  }

  public setDrawingMode(active: boolean, persist = true): void {
    this.engine.setActiveMode(active);
    if (active) {
      this.wrapper.style.display = 'block';
      this.pillButton.classList.add('active');
    } else {
      this.wrapper.style.display = 'none';
      this.pillButton.classList.remove('active');
      this.colorPopover.classList.remove('open');
    }
    if (persist) {
      this.settings.isToolbarOpen = active;
      saveSettings({ isToolbarOpen: active }).catch(() => {});
    }
    this.callbacks.onToggleActive?.(active);
  }

  public toggleDrawingMode(persist = true): void {
    const newState = !this.engine.getActiveMode();
    this.setDrawingMode(newState, persist);
  }

  private buildToolbarContent(): void {
    // 1. Drag Handle
    const dragHandle = document.createElement('div');
    dragHandle.className = 'pa-drag-handle';
    dragHandle.title = 'Drag Toolbar';
    dragHandle.innerHTML = ICONS.dragHandle;
    this.toolbar.appendChild(dragHandle);

    // 2. Select tool
    this.toolbar.appendChild(this.createToolButton('select', 'Select & Move', 'tool-select', ICONS.select));

    // 2b. Select All Elements to Move
    this.toolbar.appendChild(
      this.createActionButton(
        'select-all',
        'Select All to Move (Ctrl+A)',
        'action-select-all',
        ICONS.selectAll,
        () => {
          this.engine.selectAll();
          this.updateActiveToolUI();
        }
      )
    );

    // 3. Separator
    this.toolbar.appendChild(this.createSeparator());

    // 4. Freehand Pen
    this.toolbar.appendChild(this.createToolButton('pen', 'Pen', 'tool-pen', ICONS.pen));

    // 5. Highlighter
    this.toolbar.appendChild(this.createToolButton('highlighter', 'Highlighter', 'tool-highlighter', ICONS.highlighter));

    // 6. Shapes: Rect, Circle, Line, Arrow, Double Arrow
    this.toolbar.appendChild(this.createToolButton('rect', 'Rectangle', 'tool-rect', ICONS.rect));
    this.toolbar.appendChild(this.createToolButton('circle', 'Circle', 'tool-circle', ICONS.circle));
    this.toolbar.appendChild(this.createToolButton('line', 'Line', 'tool-line', ICONS.line));
    this.toolbar.appendChild(this.createToolButton('arrow', 'Arrow', 'tool-arrow', ICONS.arrow));
    this.toolbar.appendChild(this.createToolButton('double-arrow', 'Double Arrow', 'tool-line', ICONS.doubleArrow));

    // 7. Text Tool
    this.toolbar.appendChild(this.createToolButton('text', 'Text Note', 'tool-text', ICONS.text));

    // 8. Eraser Tool
    this.toolbar.appendChild(this.createToolButton('eraser', 'Eraser', 'tool-eraser', ICONS.eraser));

    // 9. Separator
    this.toolbar.appendChild(this.createSeparator());

    // 10. Color & Stroke Style Trigger
    this.colorPreviewBtn.className = 'pa-color-preview-btn';
    this.colorPreviewBtn.style.backgroundColor = this.settings.defaultStrokeColor;
    this.colorPreviewBtn.title = 'Colors & Stroke Size';
    this.colorPreviewBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.colorPopover.classList.toggle('open');
    });
    this.toolbar.appendChild(this.colorPreviewBtn);

    this.buildColorPopover();

    // 11. Separator
    this.toolbar.appendChild(this.createSeparator());

    // 12. Undo & Redo
    const undoBtn = this.createActionButton('undo', 'Undo', 'action-undo', ICONS.undo, () => {
      const prev = this.history.undo();
      if (prev !== null) {
        this.engine.setElements(prev);
        this.updateHistoryButtons();
        this.updateBadge();
        this.callbacks.onClear?.(); // Triggers auto-save
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

    // 13. Clear All
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

    // 14. Export PNG
    const exportBtn = this.createActionButton('export', 'Export Snapshot', 'action-export', ICONS.download, () => {
      this.callbacks.onExport?.();
    });
    this.toolbar.appendChild(exportBtn);

    // 15. Settings
    const settingsBtn = this.createActionButton('settings', 'Shortcuts & Settings', 'action-toggle-toolbar', ICONS.settings, () => {
      const modal = new SettingsModal(this.container, this.settings, {
        onSave: (newSettings) => {
          this.setSettings(newSettings);
          this.callbacks.onSettingsUpdate?.(newSettings);
        },
      });
      modal.open();
    });
    this.toolbar.appendChild(settingsBtn);

    // 16. Toggle Annotations Visibility (Eye)
    const eyeBtn = this.createActionButton(
      'visibility',
      this.engine.getAnnotationsVisible() ? 'Hide Drawings' : 'Show Drawings',
      'action-toggle-toolbar',
      this.engine.getAnnotationsVisible() ? ICONS.eye : ICONS.eyeOff,
      () => {
        const next = !this.engine.getAnnotationsVisible();
        this.engine.setAnnotationsVisible(next);
        this.settings.areAnnotationsVisible = next;
        saveSettings({ areAnnotationsVisible: next }).catch(() => {});
        eyeBtn.innerHTML = `${next ? ICONS.eye : ICONS.eyeOff}<span class="pa-tooltip">${next ? 'Hide Drawings' : 'Show Drawings'}</span>`;
      }
    );
    this.toolbar.appendChild(eyeBtn);

    // 17. Minimize to Pill
    const minBtn = this.createActionButton('minimize', 'Minimize (Alt+D to toggle)', 'toggle-active', ICONS.minimize, () => {
      this.setDrawingMode(false, true);
    });
    this.toolbar.appendChild(minBtn);
  }

  private buildColorPopover(): void {
    // Color Swatches Grid
    const grid = document.createElement('div');
    grid.className = 'pa-color-grid';

    PRESET_COLORS.forEach((color) => {
      const swatch = document.createElement('div');
      swatch.className = `pa-color-swatch ${color === this.settings.defaultStrokeColor ? 'active' : ''}`;
      swatch.style.backgroundColor = color;
      swatch.addEventListener('click', () => {
        this.applyColor(color);
        grid.querySelectorAll('.pa-color-swatch').forEach((s) => s.classList.remove('active'));
        swatch.classList.add('active');
      });
      grid.appendChild(swatch);
    });
    this.colorPopover.appendChild(grid);

    // Native Color Picker Input
    const customRow = document.createElement('div');
    customRow.style.display = 'flex';
    customRow.style.alignItems = 'center';
    customRow.style.justifyContent = 'space-between';
    customRow.style.fontSize = '12px';
    customRow.style.color = '#94a3b8';

    const customLabel = document.createElement('span');
    customLabel.textContent = 'Custom Color';

    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.value = this.settings.defaultStrokeColor;
    colorInput.style.cursor = 'pointer';
    colorInput.style.border = 'none';
    colorInput.style.background = 'none';
    colorInput.style.width = '28px';
    colorInput.style.height = '28px';

    colorInput.addEventListener('input', () => {
      this.applyColor(colorInput.value);
    });

    customRow.appendChild(customLabel);
    customRow.appendChild(colorInput);
    this.colorPopover.appendChild(customRow);

    // Stroke Size Slider
    const sliderGroup = document.createElement('div');
    sliderGroup.className = 'pa-slider-group';

    const sliderHeader = document.createElement('div');
    sliderHeader.className = 'pa-slider-label';
    sliderHeader.innerHTML = `<span>Stroke Width</span>`;
    this.strokeSizeLabel.textContent = `${this.settings.defaultStrokeWidth}px`;
    sliderHeader.appendChild(this.strokeSizeLabel);

    this.strokeSlider.type = 'range';
    this.strokeSlider.className = 'pa-slider';
    this.strokeSlider.min = '1';
    this.strokeSlider.max = '36';
    this.strokeSlider.value = `${this.settings.defaultStrokeWidth}`;

    this.strokeSlider.addEventListener('input', () => {
      const val = parseInt(this.strokeSlider.value, 10);
      this.strokeSizeLabel.textContent = `${val}px`;
      this.engine.setStrokeWidth(val);
      this.engine.setHighlighterWidth(val * 3);
    });

    sliderGroup.appendChild(sliderHeader);
    sliderGroup.appendChild(this.strokeSlider);
    this.colorPopover.appendChild(sliderGroup);

    // Close on outside click
    window.addEventListener('click', (e) => {
      if (!this.wrapper.contains(e.target as Node)) {
        this.colorPopover.classList.remove('open');
      }
    });
  }

  private applyColor(color: string): void {
    this.engine.setStrokeColor(color);
    this.colorPreviewBtn.style.backgroundColor = color;
  }

  private createToolButton(
    tool: ToolType,
    name: string,
    shortcutId: string,
    iconSvg: string
  ): HTMLElement {
    const btn = document.createElement('button');
    btn.className = `pa-btn ${this.engine.getTool() === tool ? 'active' : ''}`;
    btn.dataset.tool = tool;
    btn.dataset.shortcut = shortcutId;
    btn.innerHTML = `${iconSvg}<span class="pa-tooltip">${name} <kbd>${this.getShortcutDisplay(shortcutId)}</kbd></span>`;

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
    btn.className = 'pa-btn';
    btn.dataset.action = actionName;
    btn.dataset.shortcut = shortcutId;
    btn.innerHTML = `${iconSvg}<span class="pa-tooltip">${title} <kbd>${this.getShortcutDisplay(shortcutId)}</kbd></span>`;

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick();
    });

    return btn;
  }

  private createSeparator(): HTMLElement {
    const sep = document.createElement('div');
    sep.className = 'pa-separator';
    return sep;
  }

  private getShortcutDisplay(actionId: string): string {
    const key = (this.settings.shortcuts as any)[actionId];
    return formatShortcutForDisplay(key || '');
  }

  public updateActiveToolUI(): void {
    const current = this.engine.getTool();
    this.toolbar.querySelectorAll('[data-tool]').forEach((el) => {
      const btn = el as HTMLElement;
      if (btn.dataset.tool === current) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }

  public updateTooltips(): void {
    this.toolbar.querySelectorAll('[data-shortcut]').forEach((el) => {
      const btn = el as HTMLElement;
      const shortcutId = btn.dataset.shortcut;
      const kbd = btn.querySelector('kbd');
      if (kbd && shortcutId) {
        kbd.textContent = this.getShortcutDisplay(shortcutId);
      }
    });
  }

  private initDragEvents(): void {
    const dragHandle = this.toolbar.querySelector('.pa-drag-handle') as HTMLElement;
    if (!dragHandle) return;

    dragHandle.addEventListener('pointerdown', (e: PointerEvent) => {
      if (e.button !== 0) return;
      this.isDragging = true;
      const rect = this.wrapper.getBoundingClientRect();
      this.dragOffset.x = e.clientX - rect.left;
      this.dragOffset.y = e.clientY - rect.top;
      this.wrapper.style.transform = 'none'; // Clear center transform
      dragHandle.setPointerCapture(e.pointerId);
      e.preventDefault();
    });

    dragHandle.addEventListener('pointermove', (e: PointerEvent) => {
      if (!this.isDragging) return;
      const newX = Math.max(10, Math.min(window.innerWidth - this.wrapper.offsetWidth - 10, e.clientX - this.dragOffset.x));
      const newY = Math.max(10, Math.min(window.innerHeight - this.wrapper.offsetHeight - 10, e.clientY - this.dragOffset.y));
      this.wrapper.style.left = `${newX}px`;
      this.wrapper.style.top = `${newY}px`;
    });

    const stopDrag = () => {
      if (this.isDragging) {
        this.isDragging = false;
        // Remember position
        const rect = this.wrapper.getBoundingClientRect();
        this.settings.toolbarPosition = { x: rect.left, y: rect.top };
        this.callbacks.onSettingsUpdate?.(this.settings);
      }
    };

    dragHandle.addEventListener('pointerup', stopDrag);
    dragHandle.addEventListener('pointercancel', stopDrag);
  }

  private bindPillEvents(): void {
    this.pillButton.addEventListener('click', () => {
      this.toggleDrawingMode(true);
    });
  }
}
