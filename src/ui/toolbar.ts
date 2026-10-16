import { CanvasEngine } from '../core/engine';
import { HistoryManager } from '../core/history';
import { ToolType } from '../types/engine.types';
import { ExtensionSettings } from '../types/storage.types';
import { ToolbarCallbacks } from '../types/ui.types';
import { ICONS } from '../icons/svg-icons';
import { SettingsModal } from './settings-modal';
import { TextEditorOverlay } from './text-editor';
import { formatShortcutForDisplay } from '../core/shortcuts';
import { saveSettings } from '../core/storage';

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

    this.pillButton = document.createElement('button');
    (this.pillButton as HTMLButtonElement).type = 'button';
    this.pillButton.className = 'pa-anchor-pill';
    this.pillButton.setAttribute('aria-label', 'Toggle Page Anchor toolbar');
    this.pillButton.setAttribute('aria-expanded', shouldBeOpen ? 'true' : 'false');
    this.pillButton.innerHTML = `
      ${ICONS.anchor}
      <span class="pa-pill-label">Page Anchor</span>
      <span class="pa-pill-badge" style="display: none;" aria-label="Active annotations">0</span>
    `;
    this.container.appendChild(this.pillButton);

    this.colorPopover = document.createElement('div');
    this.colorPopover.className = 'pa-popover';
    this.colorPopover.setAttribute('role', 'dialog');
    this.colorPopover.setAttribute('aria-label', 'Stroke color and width settings');

    this.strokeSlider = document.createElement('input');
    this.strokeSizeLabel = document.createElement('span');
    this.colorPreviewBtn = document.createElement('button');
    (this.colorPreviewBtn as HTMLButtonElement).type = 'button';

    this.buildToolbarContent();
    this.wrapper.appendChild(this.toolbar);
    this.wrapper.appendChild(this.colorPopover);
    this.container.appendChild(this.wrapper);

    this.initDragEvents();
    this.bindPillEvents();
    this.updateActiveToolUI();
    this.updateHistoryButtons();
    this.updateBadge();

    this.setDrawingMode(shouldBeOpen, false);

    if (this.settings.areAnnotationsVisible !== undefined) {
      this.engine.setAnnotationsVisible(this.settings.areAnnotationsVisible);
    }

    if (this.settings.showFloatingPill === false) {
      this.pillButton.style.display = 'none';
    }

    window.addEventListener('resize', () => {
      if (this.wrapper.style.display !== 'none') {
        this.ensureVisibleInViewport();
      }
    }, { passive: true });
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
    if (settings.orphanedAnchorMode !== undefined) {
      this.engine.setOrphanedAnchorMode(settings.orphanedAnchorMode);
    }
    if (settings.performanceMode !== undefined) {
      this.engine.setPerformanceMode(settings.performanceMode);
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
      this.wrapper.style.display = 'block';
      this.pillButton.classList.add('active');
      this.pillButton.setAttribute('aria-expanded', 'true');
      this.ensureVisibleInViewport();
    } else {
      this.wrapper.style.display = 'none';
      this.pillButton.classList.remove('active');
      this.pillButton.setAttribute('aria-expanded', 'false');
      this.colorPopover.classList.remove('open');
      this.colorPreviewBtn.setAttribute('aria-expanded', 'false');
    }
    if (persist) {
      this.settings.isToolbarOpen = active;
      saveSettings({ isToolbarOpen: active }).catch(() => {});
    }
    this.callbacks.onToggleActive?.(active);
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
      this.settings.toolbarPosition = { x: clampX, y: clampY };
    }
  }

  public toggleDrawingMode(persist = true): void {
    const newState = !this.engine.getActiveMode();
    this.setDrawingMode(newState, persist);
  }

  /**
   * Collapses or expands the floating toolbar while keeping drawing mode (and
   * the active tool) intact. Distinct from `toggleDrawingMode`, which enters or
   * leaves drawing mode entirely.
   */
  public toggleToolbarVisibility(): void {
    const isHidden = this.wrapper.style.display === 'none';

    if (!isHidden) {
      this.wrapper.style.display = 'none';
      this.pillButton.classList.remove('active');
      this.pillButton.setAttribute('aria-expanded', 'false');
      this.colorPopover.classList.remove('open');
      this.colorPreviewBtn.setAttribute('aria-expanded', 'false');
      return;
    }

    if (this.engine.getActiveMode()) {
      this.wrapper.style.display = 'block';
      this.pillButton.classList.add('active');
      this.pillButton.setAttribute('aria-expanded', 'true');
      this.ensureVisibleInViewport();
    } else {
      this.setDrawingMode(true);
    }
  }

  private buildToolbarContent(): void {
    const dragHandle = document.createElement('div');
    dragHandle.className = 'pa-drag-handle';
    dragHandle.setAttribute('role', 'button');
    dragHandle.setAttribute('tabindex', '0');
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
    this.colorPreviewBtn.title = 'Colors & Stroke Size';
    this.colorPreviewBtn.setAttribute('aria-label', 'Stroke color and width settings');
    this.colorPreviewBtn.setAttribute('aria-haspopup', 'dialog');
    this.colorPreviewBtn.setAttribute('aria-expanded', 'false');
    this.colorPreviewBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = this.colorPopover.classList.toggle('open');
      this.colorPreviewBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
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

    const exportBtn = this.createActionButton('export', 'Export Snapshot', 'action-export', ICONS.download, () => {
      this.callbacks.onExport?.();
    });
    this.toolbar.appendChild(exportBtn);

    const settingsBtn = this.createActionButton('settings', 'Shortcuts & Settings', '', ICONS.settings, () => {
      const modal = new SettingsModal(this.container, this.settings, {
        onSave: (newSettings) => {
          this.setSettings(newSettings);
          this.callbacks.onSettingsUpdate?.(newSettings);
        },
      });
      modal.open();
    });
    this.toolbar.appendChild(settingsBtn);

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
      isAnchoring ? ICONS.pin : ICONS.pinOff,
      () => {
        const next = !this.engine.getDomAnchoringEnabled();
        this.engine.setDomAnchoringEnabled(next);
        this.callbacks.onToggleDomAnchoring?.(next);
        const label = next ? 'Smart Anchoring: ON (Follows moving items)' : 'Smart Anchoring: OFF (Fixed position)';
        anchorBtn.dataset.label = label;
        anchorBtn.setAttribute('aria-pressed', next ? 'true' : 'false');
        anchorBtn.setAttribute('aria-label', label);
        anchorBtn.innerHTML = `${next ? ICONS.pin : ICONS.pinOff}<span class="pa-tooltip" aria-hidden="true">${label}</span>`;
      }
    );
    anchorBtn.setAttribute('aria-pressed', isAnchoring ? 'true' : 'false');
    this.toolbar.appendChild(anchorBtn);

    const minBtn = this.createActionButton('minimize', 'Minimize Toolbar', 'toggle-active', ICONS.minimize, () => {
      this.setDrawingMode(false, true);
    });
    this.toolbar.appendChild(minBtn);
  }

  public updateDomAnchoringUI(enabled: boolean): void {
    const btn = this.toolbar.querySelector('[data-action="dom-anchor"]') as HTMLButtonElement | null;
    if (btn) {
      const label = enabled ? 'Smart Anchoring: ON (Follows moving items)' : 'Smart Anchoring: OFF (Fixed position)';
      btn.dataset.label = label;
      btn.setAttribute('aria-pressed', enabled ? 'true' : 'false');
      btn.setAttribute('aria-label', label);
      btn.innerHTML = `${enabled ? ICONS.pin : ICONS.pinOff}<span class="pa-tooltip" aria-hidden="true">${label}</span>`;
    }
  }

  private buildColorPopover(): void {
    const grid = document.createElement('div');
    grid.className = 'pa-color-grid';
    grid.setAttribute('role', 'group');
    grid.setAttribute('aria-label', 'Preset stroke colors');

    PRESET_COLORS.forEach((color) => {
      const swatch = document.createElement('button');
      swatch.type = 'button';
      const isActive = color === this.settings.defaultStrokeColor;
      swatch.className = `pa-color-swatch ${isActive ? 'active' : ''}`;
      swatch.style.backgroundColor = color;
      swatch.setAttribute('aria-label', `Color ${color}`);
      swatch.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      swatch.addEventListener('click', () => {
        this.applyColor(color);
        grid.querySelectorAll('.pa-color-swatch').forEach((s) => {
          s.classList.remove('active');
          s.setAttribute('aria-pressed', 'false');
        });
        swatch.classList.add('active');
        swatch.setAttribute('aria-pressed', 'true');
      });
      grid.appendChild(swatch);
    });
    this.colorPopover.appendChild(grid);

    const customRow = document.createElement('div');
    customRow.style.display = 'flex';
    customRow.style.alignItems = 'center';
    customRow.style.justifyContent = 'space-between';
    customRow.style.fontSize = '12px';
    customRow.style.color = '#94a3b8';

    const customLabel = document.createElement('label');
    customLabel.htmlFor = 'pa-custom-color-picker';
    customLabel.textContent = 'Custom Color';

    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.id = 'pa-custom-color-picker';
    colorInput.value = this.settings.defaultStrokeColor;
    colorInput.setAttribute('aria-label', 'Custom Color Picker');
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
    this.strokeSlider.setAttribute('aria-label', 'Stroke width in pixels');
    this.strokeSlider.setAttribute('aria-valuemin', '1');
    this.strokeSlider.setAttribute('aria-valuemax', '36');
    this.strokeSlider.setAttribute('aria-valuenow', `${this.settings.defaultStrokeWidth}`);
    this.strokeSlider.setAttribute('aria-valuetext', `${this.settings.defaultStrokeWidth} pixels`);

    this.strokeSlider.addEventListener('input', () => {
      const val = parseInt(this.strokeSlider.value, 10);
      this.strokeSizeLabel.textContent = `${val}px`;
      this.strokeSlider.setAttribute('aria-valuenow', `${val}`);
      this.strokeSlider.setAttribute('aria-valuetext', `${val} pixels`);
      this.engine.setStrokeWidth(val);
      this.engine.setHighlighterWidth(val * 3);
    });

    sliderGroup.appendChild(sliderHeader);
    sliderGroup.appendChild(this.strokeSlider);
    this.colorPopover.appendChild(sliderGroup);

    window.addEventListener('click', (e) => {
      if (!this.wrapper.contains(e.target as Node)) {
        this.colorPopover.classList.remove('open');
        this.colorPreviewBtn.setAttribute('aria-expanded', 'false');
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

    dragHandle.addEventListener('pointerdown', (e: PointerEvent) => {
      if (e.button !== 0) return;
      this.isDragging = true;
      const rect = this.wrapper.getBoundingClientRect();
      this.dragOffset.x = e.clientX - rect.left;
      this.dragOffset.y = e.clientY - rect.top;
      this.wrapper.style.transform = 'none';
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
        const rect = this.wrapper.getBoundingClientRect();
        this.settings.toolbarPosition = { x: rect.left, y: rect.top };
        this.callbacks.onSettingsUpdate?.(this.settings);
      }
    };

    dragHandle.addEventListener('pointerup', stopDrag);
    dragHandle.addEventListener('pointercancel', stopDrag);

    // Keyboard navigation alternative for dragging (WCAG 2.5.7)
    dragHandle.addEventListener('keydown', (e: KeyboardEvent) => {
      let moved = false;
      const rect = this.wrapper.getBoundingClientRect();
      let newX = rect.left;
      let newY = rect.top;
      const step = 20;

      if (e.key === 'ArrowUp') {
        newY = Math.max(10, newY - step);
        moved = true;
      } else if (e.key === 'ArrowDown') {
        newY = Math.min(window.innerHeight - this.wrapper.offsetHeight - 10, newY + step);
        moved = true;
      } else if (e.key === 'ArrowLeft') {
        newX = Math.max(10, newX - step);
        moved = true;
      } else if (e.key === 'ArrowRight') {
        newX = Math.min(window.innerWidth - this.wrapper.offsetWidth - 10, newX + step);
        moved = true;
      }

      if (moved) {
        e.preventDefault();
        this.wrapper.style.transform = 'none';
        this.wrapper.style.left = `${newX}px`;
        this.wrapper.style.top = `${newY}px`;
        this.settings.toolbarPosition = { x: newX, y: newY };
        this.callbacks.onSettingsUpdate?.(this.settings);
      }
    });
  }

  private bindPillEvents(): void {
    this.pillButton.addEventListener('click', () => {
      this.toggleDrawingMode(true);
    });
  }
}
