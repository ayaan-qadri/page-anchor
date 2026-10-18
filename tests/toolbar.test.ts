import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FloatingToolbar } from '../src/ui/toolbar';
import { CanvasEngine } from '../src/core/engine';
import { HistoryManager } from '../src/core/history';
import { TextEditorOverlay } from '../src/ui/text-editor';
import { DEFAULT_SETTINGS } from '../src/core/storage';

describe('FloatingToolbar: Dragging, Tool Switching, History & UI Controls', () => {
  let container: HTMLElement;
  let engine: CanvasEngine;
  let history: HistoryManager;
  let textEditor: TextEditorOverlay;
  let toolbar: FloatingToolbar;
  let mockCallbacks: any;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);

    mockCallbacks = {
      onToggleActive: vi.fn(),
      onClear: vi.fn(),
      onExport: vi.fn(),
      onToggleDomAnchoring: vi.fn(),
      onSettingsUpdate: vi.fn(),
    };

    engine = new CanvasEngine(container);
    history = new HistoryManager([]);
    textEditor = new TextEditorOverlay(container);
    toolbar = new FloatingToolbar(
      container,
      engine,
      history,
      textEditor,
      { ...DEFAULT_SETTINGS, isToolbarOpen: true },
      mockCallbacks
    );
  });

  afterEach(() => {
    engine.destroy();
    container.remove();
  });

  it('switches active drawing tool when tool buttons are clicked', () => {
    const penBtn = container.querySelector('[data-tool="pen"]') as HTMLButtonElement;
    const rectBtn = container.querySelector('[data-tool="rect"]') as HTMLButtonElement;
    const eraserBtn = container.querySelector('[data-tool="eraser"]') as HTMLButtonElement;

    rectBtn.click();
    expect(engine.getTool()).toBe('rect');
    expect(rectBtn.classList.contains('active')).toBe(true);

    penBtn.click();
    expect(engine.getTool()).toBe('pen');
    expect(penBtn.classList.contains('active')).toBe(true);
    expect(rectBtn.classList.contains('active')).toBe(false);

    eraserBtn.click();
    expect(engine.getTool()).toBe('eraser');
  });

  it('selects all elements via Select All action button when elements exist', () => {
    engine.setElements([
      {
        id: 'sample',
        type: 'rect',
        startX: 0,
        startY: 0,
        endX: 50,
        endY: 50,
        strokeColor: '#000',
        strokeWidth: 2,
        opacity: 1,
        createdAt: 0,
        bbox: { minX: 0, minY: 0, maxX: 50, maxY: 50 },
      },
    ]);

    const selectAllBtn = container.querySelector('[data-action="select-all"]') as HTMLButtonElement;
    selectAllBtn.click();
    expect(engine.getTool()).toBe('select');
  });

  it('toggles drawing mode on and off', () => {
    toolbar.setDrawingMode(false);
    expect(engine.getActiveMode()).toBe(false);

    toolbar.setDrawingMode(true);
    expect(engine.getActiveMode()).toBe(true);
    expect(mockCallbacks.onToggleActive).toHaveBeenCalled();
  });

  it('opens the toolbar from the left-edge dock tab', () => {
    const wrapper = container.querySelector('.pa-toolbar-wrapper') as HTMLElement;
    toolbar.setDrawingMode(false);
    expect(engine.getActiveMode()).toBe(false);
    expect(wrapper.classList.contains('docked')).toBe(true);

    const dockTab = container.querySelector('.pa-dock-tab') as HTMLButtonElement;
    expect(dockTab).not.toBeNull();
    dockTab.click();

    expect(engine.getActiveMode()).toBe(true);
    expect(wrapper.classList.contains('docked')).toBe(false);
  });

  it('docks to the left edge and restores the position it was docked from', () => {
    const wrapper = container.querySelector('.pa-toolbar-wrapper') as HTMLElement;
    // Pretend the toolbar had been dragged to a known spot.
    (toolbar as any).settings.toolbarPosition = { x: 320, y: 180 };
    wrapper.style.transform = 'none';
    wrapper.style.left = '320px';
    wrapper.style.top = '180px';

    toolbar.setDrawingMode(false, false);
    expect(wrapper.classList.contains('docked')).toBe(true);
    expect(wrapper.style.left).toBe('0px');

    toolbar.setDrawingMode(true, false);
    expect(wrapper.classList.contains('docked')).toBe(false);
    expect(wrapper.style.left).toBe('320px');
    expect(wrapper.style.top).toBe('180px');
  });

  it('docks the toolbar to the left edge via the dock button', () => {
    const wrapper = container.querySelector('.pa-toolbar-wrapper') as HTMLElement;
    expect(wrapper.classList.contains('docked')).toBe(false);

    const dockBtn = container.querySelector('[data-action="dock"]') as HTMLButtonElement;
    expect(dockBtn).not.toBeNull();
    dockBtn.click();

    expect(wrapper.classList.contains('docked')).toBe(true);
    expect(wrapper.style.left).toBe('0px');
    expect(engine.getActiveMode()).toBe(false);

    const dockTab = container.querySelector('.pa-dock-tab') as HTMLButtonElement;
    dockTab.click();
    expect(wrapper.classList.contains('docked')).toBe(false);
    expect(engine.getActiveMode()).toBe(true);
  });

  it('removes the toolbar and its dock via the close button', () => {
    const wrapper = container.querySelector('.pa-toolbar-wrapper') as HTMLElement;
    toolbar.setDrawingMode(true, false);
    expect(wrapper.style.display).toBe('block');

    const closeBtn = container.querySelector('[data-action="hide"]') as HTMLButtonElement;
    closeBtn.click();

    expect(wrapper.style.display).toBe('none');
    expect(wrapper.classList.contains('docked')).toBe(false);
    expect(engine.getActiveMode()).toBe(false);
  });

  it('removes the dock via the dock close button and can reopen afterwards', () => {
    const wrapper = container.querySelector('.pa-toolbar-wrapper') as HTMLElement;
    toolbar.setDrawingMode(false, false);
    expect(wrapper.classList.contains('docked')).toBe(true);

    const dockClose = container.querySelector('.pa-dock-close') as HTMLButtonElement;
    dockClose.click();
    expect(wrapper.style.display).toBe('none');
    expect(wrapper.classList.contains('docked')).toBe(false);

    toolbar.setDrawingMode(true, false);
    expect(wrapper.style.display).toBe('block');
  });

  it('persists the hidden state so the dock does not return on reload', () => {
    const closeBtn = container.querySelector('[data-action="hide"]') as HTMLButtonElement;
    closeBtn.click();
    expect((toolbar as any).settings.isToolbarHidden).toBe(true);
    expect((toolbar as any).settings.isToolbarOpen).toBe(false);

    toolbar.setDrawingMode(true, false);
    expect((toolbar as any).settings.isToolbarHidden).toBe(false);
  });

  it('starts hidden (no dock) when the saved settings say it was hidden', () => {
    const other = document.createElement('div');
    document.body.appendChild(other);
    const otherEngine = new CanvasEngine(other);
    const otherToolbar = new FloatingToolbar(
      other,
      otherEngine,
      new HistoryManager([]),
      new TextEditorOverlay(other),
      { ...DEFAULT_SETTINGS, isToolbarHidden: true }
    );

    const wrapper = other.querySelector('.pa-toolbar-wrapper') as HTMLElement;
    expect(wrapper.style.display).toBe('none');
    expect(wrapper.classList.contains('docked')).toBe(false);

    otherToolbar.setDrawingMode(true, false);
    expect(wrapper.style.display).toBe('block');

    otherEngine.destroy();
    other.remove();
  });

  it('reopens the docked toolbar from the dock tab after hiding and restoring', () => {
    const wrapper = container.querySelector('.pa-toolbar-wrapper') as HTMLElement;
    toolbar.setDrawingMode(false, false);
    expect(wrapper.classList.contains('docked')).toBe(true);

    const closeBtn = container.querySelector('[data-action="hide"]') as HTMLButtonElement;
    closeBtn.click();
    expect(wrapper.style.display).toBe('none');

    toolbar.setDrawingMode(true, false);
    expect(wrapper.style.display).toBe('block');
    expect(wrapper.classList.contains('docked')).toBe(false);
    expect(engine.getActiveMode()).toBe(true);
  });

  it('exposes a distinct shortcut label for the double-arrow tool', () => {
    const doubleArrowBtn = container.querySelector('[data-tool="double-arrow"]') as HTMLButtonElement;
    expect(doubleArrowBtn).not.toBeNull();
    expect(doubleArrowBtn.dataset.shortcut).toBe('tool-double-arrow');
  });

  it('updates undo and redo buttons availability based on history stack', () => {
    const undoBtn = container.querySelector('[data-action="undo"]') as HTMLButtonElement;
    const redoBtn = container.querySelector('[data-action="redo"]') as HTMLButtonElement;

    expect(undoBtn.disabled).toBe(true);
    expect(redoBtn.disabled).toBe(true);

    history.pushState([
      {
        id: 's1',
        type: 'pen',
        points: [{ x: 10, y: 10 }],
        strokeColor: '#000',
        strokeWidth: 2,
        opacity: 1,
        createdAt: 0,
        bbox: { minX: 10, minY: 10, maxX: 10, maxY: 10 },
      },
    ]);
    toolbar.updateHistoryButtons();

    expect(undoBtn.disabled).toBe(false);
    expect(redoBtn.disabled).toBe(true);

    undoBtn.click();
    toolbar.updateHistoryButtons();
    expect(redoBtn.disabled).toBe(false);

    redoBtn.click();
    toolbar.updateHistoryButtons();
    expect(redoBtn.disabled).toBe(true);
  });

  it('suppresses the transform transition while dragging so the first move does not flick', () => {
    const wrapper = container.querySelector('.pa-toolbar-wrapper') as HTMLElement;
    const dragHandle = container.querySelector('.pa-drag-handle') as HTMLElement;
    (dragHandle as any).setPointerCapture = vi.fn();

    // Default resting state centres the toolbar with a transform.
    expect(wrapper.style.transform).toBe('translateX(-50%)');
    expect(wrapper.classList.contains('pa-repositioning')).toBe(false);

    dragHandle.dispatchEvent(
      new PointerEvent('pointerdown', { button: 0, clientX: 100, clientY: 40, pointerId: 1, bubbles: true })
    );
    expect(wrapper.classList.contains('pa-repositioning')).toBe(true);

    dragHandle.dispatchEvent(
      new PointerEvent('pointermove', { clientX: 140, clientY: 60, pointerId: 1, bubbles: true })
    );
    expect(wrapper.style.transform).toBe('none');
    expect(wrapper.style.left).toBe('40px');

    dragHandle.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true }));
    expect(wrapper.classList.contains('pa-repositioning')).toBe(false);
  });

  it('suppresses the transform transition when repositioning with the keyboard', () => {
    const dragHandle = container.querySelector('.pa-drag-handle') as HTMLElement;
    const wrapper = container.querySelector('.pa-toolbar-wrapper') as HTMLElement;

    dragHandle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(wrapper.style.left).toBe('20px');
    expect(wrapper.style.transform).toBe('none');
    expect(wrapper.classList.contains('pa-repositioning')).toBe(true);

    dragHandle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(wrapper.style.top).toBe('20px');
  });

  it('toggles DOM anchoring mode via action button', () => {
    const anchorBtn = container.querySelector('[data-action="dom-anchor"]') as HTMLButtonElement;
    expect(engine.getDomAnchoringEnabled()).toBe(true);

    anchorBtn.click();
    expect(engine.getDomAnchoringEnabled()).toBe(false);
    expect(mockCallbacks.onToggleDomAnchoring).toHaveBeenCalledWith(false);

    anchorBtn.click();
    expect(engine.getDomAnchoringEnabled()).toBe(true);
    expect(mockCallbacks.onToggleDomAnchoring).toHaveBeenCalledWith(true);
  });

  it('triggers clear and export callbacks from action buttons', () => {
    (globalThis as any).confirm = vi.fn().mockReturnValue(true);

    const clearBtn = container.querySelector('[data-action="clear"]') as HTMLButtonElement;
    clearBtn.click();
    expect(mockCallbacks.onClear).toHaveBeenCalled();

    const exportBtn = container.querySelector('[data-action="export"]') as HTMLButtonElement;
    exportBtn.click();
    expect(mockCallbacks.onExport).toHaveBeenCalled();
  });

  it('does not expose a settings action in the drawing toolbar', () => {
    expect(container.querySelector('[data-action="settings"]')).toBeNull();
  });

  it('keeps the drawing defaults in the toolbar popover and persists changes', () => {
    const colorBtn = container.querySelector('.pa-color-preview-btn') as HTMLButtonElement;
    colorBtn.click();
    expect(colorBtn.getAttribute('aria-expanded')).toBe('true');

    for (const setting of [
      'defaultStrokeColor',
      'defaultStrokeWidth',
      'defaultHighlighterColor',
      'defaultHighlighterWidth',
      'defaultFontSize',
    ]) {
      expect(container.querySelector(`[data-setting="${setting}"]`)).not.toBeNull();
    }

    const penWidth = container.querySelector<HTMLInputElement>('input[data-setting="defaultStrokeWidth"]')!;
    penWidth.value = '9';
    penWidth.dispatchEvent(new Event('change', { bubbles: true }));

    expect((toolbar as any).settings.defaultStrokeWidth).toBe(9);
    expect(mockCallbacks.onSettingsUpdate).toHaveBeenCalled();

    const swatch = container.querySelector<HTMLButtonElement>('.pa-color-swatch')!;
    swatch.click();
    expect((toolbar as any).settings.defaultStrokeColor).toBe(swatch.dataset.color);
    expect(colorBtn.style.backgroundColor).toBeTruthy();
  });

  it('keeps the popover open while changing a value and closes on an outside press', () => {
    const colorBtn = container.querySelector('.pa-color-preview-btn') as HTMLButtonElement;
    colorBtn.click();
    expect(colorBtn.getAttribute('aria-expanded')).toBe('true');

    const swatch = container.querySelector<HTMLButtonElement>('.pa-color-swatch')!;
    swatch.dispatchEvent(new Event('pointerdown', { bubbles: true, composed: true }));
    expect(colorBtn.getAttribute('aria-expanded')).toBe('true');

    const slider = container.querySelector<HTMLInputElement>('input[data-setting="defaultStrokeWidth"]')!;
    slider.dispatchEvent(new Event('pointerdown', { bubbles: true, composed: true }));
    expect(colorBtn.getAttribute('aria-expanded')).toBe('true');

    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true, composed: true }));
    expect(colorBtn.getAttribute('aria-expanded')).toBe('false');
  });

  it('resets the drawing defaults back to factory values from the popover', () => {
    const penWidth = container.querySelector<HTMLInputElement>('input[data-setting="defaultStrokeWidth"]')!;
    penWidth.value = '9';
    penWidth.dispatchEvent(new Event('change', { bubbles: true }));
    expect((toolbar as any).settings.defaultStrokeWidth).toBe(9);

    const reset = container.querySelector<HTMLButtonElement>('.pa-popover-reset')!;
    reset.click();

    expect((toolbar as any).settings.defaultStrokeWidth).toBe(DEFAULT_SETTINGS.defaultStrokeWidth);
    expect((toolbar as any).settings.defaultFontSize).toBe(DEFAULT_SETTINGS.defaultFontSize);
    expect(penWidth.value).toBe(`${DEFAULT_SETTINGS.defaultStrokeWidth}`);
  });
});
