import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FloatingToolbar } from '../src/ui/toolbar';
import { CanvasEngine } from '../src/core/engine';
import { HistoryManager } from '../src/core/history';
import { TextEditorOverlay } from '../src/ui/text-editor';
import { DEFAULT_SETTINGS } from '../src/core/storage';
import { formatShortcutForDisplay } from '../src/core/shortcuts';

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
      onToggleDomAnchoring: vi.fn(),
      onSettingsUpdate: vi.fn(),
      onOpenOptions: vi.fn(),
    };

    history = new HistoryManager([]);
    // Mirrors the content script: every engine change is recorded in history.
    engine = new CanvasEngine(container, {
      onElementsChange: (elements) => history.pushState(elements),
    });
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

  it('hides the toolbar entirely and restores it from the extension icon', () => {
    const wrapper = container.querySelector('.pa-toolbar-wrapper') as HTMLElement;
    toolbar.setDrawingMode(false);
    expect(engine.getActiveMode()).toBe(false);
    expect(wrapper.style.display).toBe('none');

    toolbar.setDrawingMode(true);
    expect(engine.getActiveMode()).toBe(true);
    expect(wrapper.style.display).toBe('block');
  });

  it('restores the toolbar to the position it was dragged to', () => {
    const wrapper = container.querySelector('.pa-toolbar-wrapper') as HTMLElement;
    // Pretend the toolbar had been dragged to a known spot.
    (toolbar as any).settings.toolbarPosition = { x: 320, y: 180 };
    wrapper.style.transform = 'none';
    wrapper.style.left = '320px';
    wrapper.style.top = '180px';

    toolbar.setDrawingMode(false, false);
    expect(wrapper.style.display).toBe('none');

    toolbar.setDrawingMode(true, false);
    expect(wrapper.style.display).toBe('block');
    expect(wrapper.style.left).toBe('320px');
    expect(wrapper.style.top).toBe('180px');
  });

  it('hides the toolbar via the close button on the top corner of the toolbar wrapper', () => {
    const wrapper = container.querySelector('.pa-toolbar-wrapper') as HTMLElement;
    toolbar.setDrawingMode(true, false);
    expect(wrapper.style.display).toBe('block');

    expect(container.querySelector('.pa-menu [data-action="hide"]')).toBeNull();
    expect(container.querySelector('.pa-toolbar [data-action="hide"]')).toBeNull();
    const hideBtn = container.querySelector('.pa-toolbar-wrapper > [data-action="hide"]') as HTMLButtonElement;
    expect(hideBtn).not.toBeNull();
    expect(hideBtn.classList.contains('pa-toolbar-close-btn')).toBe(true);

    hideBtn.click();

    expect(wrapper.style.display).toBe('none');
    expect(engine.getActiveMode()).toBe(false);
  });

  it('hides and shows the toolbar when the extension icon is clicked', () => {
    const wrapper = container.querySelector('.pa-toolbar-wrapper') as HTMLElement;
    expect(wrapper.style.display).toBe('block');

    // The extension icon toggles drawing mode, which hides the toolbar.
    toolbar.toggleDrawingMode(false);

    expect(wrapper.style.display).toBe('none');
    expect(engine.getActiveMode()).toBe(false);

    toolbar.toggleDrawingMode(false);
    expect(wrapper.style.display).toBe('block');
    expect(engine.getActiveMode()).toBe(true);
  });

  it('removes the toolbar via the close button', () => {
    const wrapper = container.querySelector('.pa-toolbar-wrapper') as HTMLElement;
    toolbar.setDrawingMode(true, false);
    expect(wrapper.style.display).toBe('block');

    const closeBtn = container.querySelector('[data-action="hide"]') as HTMLButtonElement;
    closeBtn.click();

    expect(wrapper.style.display).toBe('none');
    expect(engine.getActiveMode()).toBe(false);
  });

  it('persists the hidden state so the toolbar does not return on reload', () => {
    const closeBtn = container.querySelector('[data-action="hide"]') as HTMLButtonElement;
    closeBtn.click();
    expect((toolbar as any).settings.isToolbarOpen).toBe(false);

    toolbar.setDrawingMode(true, false);
    expect((toolbar as any).settings.isToolbarOpen).toBe(true);
  });

  it('starts hidden when the saved settings say it was hidden', () => {
    const other = document.createElement('div');
    document.body.appendChild(other);
    const otherEngine = new CanvasEngine(other);
    const otherToolbar = new FloatingToolbar(
      other,
      otherEngine,
      new HistoryManager([]),
      new TextEditorOverlay(other),
      { ...DEFAULT_SETTINGS, isToolbarOpen: false }
    );

    const wrapper = other.querySelector('.pa-toolbar-wrapper') as HTMLElement;
    expect(wrapper.style.display).toBe('none');

    otherToolbar.setDrawingMode(true, false);
    expect(wrapper.style.display).toBe('block');

    otherEngine.destroy();
    other.remove();
  });

  it('restores the toolbar after hiding it', () => {
    const wrapper = container.querySelector('.pa-toolbar-wrapper') as HTMLElement;
    toolbar.setDrawingMode(true, false);

    const closeBtn = container.querySelector('[data-action="hide"]') as HTMLButtonElement;
    closeBtn.click();
    expect(wrapper.style.display).toBe('none');

    toolbar.setDrawingMode(true, false);
    expect(wrapper.style.display).toBe('block');
    expect(engine.getActiveMode()).toBe(true);
  });

  it('exposes a distinct shortcut label for the double-arrow tool', () => {
    const doubleArrowBtn = container.querySelector('[data-tool="double-arrow"]') as HTMLButtonElement;
    expect(doubleArrowBtn).not.toBeNull();
    const shortcutKey = doubleArrowBtn.querySelector('.pa-menu-item-key') as HTMLElement;
    expect(shortcutKey.textContent).toBe(
      formatShortcutForDisplay(DEFAULT_SETTINGS.shortcuts['tool-double-arrow'])
    );
  });

  it('groups the shape tools behind a single menu entry', () => {
    const shapesTrigger = container.querySelector('[data-action="shapes"]') as HTMLButtonElement;
    expect(shapesTrigger).not.toBeNull();
    expect(shapesTrigger.getAttribute('aria-haspopup')).toBe('menu');

    // Shape tools live in the menu but keep working as ordinary tool buttons.
    const rectBtn = container.querySelector('[data-tool="rect"]') as HTMLButtonElement;
    rectBtn.click();
    expect(engine.getTool()).toBe('rect');
    expect(rectBtn.classList.contains('active')).toBe(true);

    // The trigger carries the active state, since the button itself is hidden.
    expect(shapesTrigger.classList.contains('active')).toBe(true);
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

  it('snaps the centering transform on the first drag move', () => {
    const wrapper = container.querySelector('.pa-toolbar-wrapper') as HTMLElement;
    const dragHandle = container.querySelector('.pa-drag-handle') as HTMLElement;
    (dragHandle as any).setPointerCapture = vi.fn();

    // Default resting state centres the toolbar with a transform.
    expect(wrapper.style.transform).toBe('translateX(-50%)');

    dragHandle.dispatchEvent(
      new PointerEvent('pointerdown', { button: 0, clientX: 100, clientY: 40, pointerId: 1, bubbles: true })
    );

    dragHandle.dispatchEvent(
      new PointerEvent('pointermove', { clientX: 140, clientY: 60, pointerId: 1, bubbles: true })
    );
    expect(wrapper.style.transform).toBe('none');
    expect(wrapper.style.left).toBe('40px');

    dragHandle.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true }));
  });

  it('repositions with the drag handle using Arrow keys', () => {
    const dragHandle = container.querySelector('.pa-drag-handle') as HTMLElement;
    const wrapper = container.querySelector('.pa-toolbar-wrapper') as HTMLElement;

    dragHandle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(wrapper.style.left).toBe('20px');
    expect(wrapper.style.transform).toBe('none');

    dragHandle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(wrapper.style.top).toBe('20px');
  });

  it('writes the dragged position to settings so it survives a reload', () => {
    const dragHandle = container.querySelector('.pa-drag-handle') as HTMLElement;
    (dragHandle as any).setPointerCapture = vi.fn();

    dragHandle.dispatchEvent(
      new PointerEvent('pointerdown', { button: 0, clientX: 100, clientY: 40, pointerId: 1, bubbles: true })
    );
    dragHandle.dispatchEvent(
      new PointerEvent('pointermove', { clientX: 140, clientY: 60, pointerId: 1, bubbles: true })
    );
    dragHandle.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true }));

    const wrapper = container.querySelector('.pa-toolbar-wrapper') as HTMLElement;
    const applied = {
      x: parseFloat(wrapper.style.left),
      y: parseFloat(wrapper.style.top),
    };
    expect((toolbar as any).settings.toolbarPosition).toEqual(applied);
    expect(applied.x).toBeGreaterThan(0);
    expect(mockCallbacks.onSettingsUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ toolbarPosition: applied })
    );
  });

  it('writes the keyboard-nudged position to settings', () => {
    const dragHandle = container.querySelector('.pa-drag-handle') as HTMLElement;
    const wrapper = container.querySelector('.pa-toolbar-wrapper') as HTMLElement;
    dragHandle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

    const applied = {
      x: parseFloat(wrapper.style.left),
      y: parseFloat(wrapper.style.top),
    };
    expect((toolbar as any).settings.toolbarPosition).toEqual(applied);
    expect(mockCallbacks.onSettingsUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ toolbarPosition: applied })
    );
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

  it('triggers the clear callback from its action button', () => {
    (globalThis as any).confirm = vi.fn().mockReturnValue(true);

    const clearBtn = container.querySelector('[data-action="clear"]') as HTMLButtonElement;
    clearBtn.click();
    expect(mockCallbacks.onClear).toHaveBeenCalled();
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

  it('updates highlighter color when preset swatch is clicked while highlighter tool is active', () => {
    const hlBtn = container.querySelector('[data-tool="highlighter"]') as HTMLButtonElement;
    hlBtn.click();

    const colorBtn = container.querySelector('.pa-color-preview-btn') as HTMLButtonElement;
    colorBtn.click();

    // The grid should now represent highlighter colors
    const grid = container.querySelector('.pa-color-grid') as HTMLElement;
    expect(grid.getAttribute('aria-label')).toBe('Preset highlighter colors');

    // Pick 2nd swatch (orange #f97316)
    const swatches = container.querySelectorAll<HTMLButtonElement>('.pa-color-swatch');
    swatches[1].click();

    expect((toolbar as any).settings.defaultHighlighterColor).toBe(swatches[1].dataset.color);
    expect((engine as any).highlighterColor).toBe(swatches[1].dataset.color);
    expect(colorBtn.style.backgroundColor).toBe(swatches[1].dataset.color);
  });

  it('applies the picked highlighter color to strokes drawn with the highlighter', () => {
    (container.querySelector('[data-tool="highlighter"]') as HTMLButtonElement).click();
    (container.querySelector('.pa-color-preview-btn') as HTMLButtonElement).click();
    const swatches = container.querySelectorAll<HTMLButtonElement>('.pa-color-swatch');
    swatches[2].click();
    const picked = swatches[2].dataset.color as string;

    const canvas = container.querySelector('.page-anchor-active-canvas') as HTMLCanvasElement;
    canvas.dispatchEvent(
      new PointerEvent('pointerdown', { clientX: 10, clientY: 10, button: 0, pointerId: 1 })
    );
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 60, clientY: 10, pointerId: 1 }));
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: 60, clientY: 10, pointerId: 1 }));

    const stroke = engine.getElements()[0] as any;
    expect(stroke.type).toBe('highlighter');
    expect(stroke.strokeColor).toBe(picked);
  });

  it('keeps the pen colour unchanged when the highlighter colour is edited', () => {
    const penBefore = (toolbar as any).settings.defaultStrokeColor;

    (container.querySelector('[data-tool="highlighter"]') as HTMLButtonElement).click();
    (container.querySelector('.pa-color-preview-btn') as HTMLButtonElement).click();
    const swatches = container.querySelectorAll<HTMLButtonElement>('.pa-color-swatch');
    swatches[3].click();

    expect((toolbar as any).settings.defaultStrokeColor).toBe(penBefore);
    expect((engine as any).strokeColor).toBe(penBefore);
  });

  it('clears drawings immediately and displays undo toast without modal confirm', () => {
    (globalThis as any).confirm = vi.fn();

    // Add a dummy element through the engine so the change is recorded in
    // history, exactly as drawing a stroke would be.
    const dummy: any = {
      id: 'd1', type: 'pen', points: [{ x: 10, y: 10 }],
      strokeColor: '#000', strokeWidth: 2, opacity: 1, createdAt: 0,
      bbox: { minX: 10, minY: 10, maxX: 10, maxY: 10 },
    };
    engine.addElement(dummy);
    expect(engine.getElements()).toHaveLength(1);

    const clearBtn = container.querySelector('[data-action="clear"]') as HTMLButtonElement;
    clearBtn.click();

    expect((globalThis as any).confirm).not.toHaveBeenCalled();
    expect(engine.getElements()).toHaveLength(0);
    expect(mockCallbacks.onClear).toHaveBeenCalled();

    // Verify toast with Undo button was rendered
    const toast = container.querySelector('.pa-toast') as HTMLElement;
    expect(toast).not.toBeNull();
    const undoBtn = toast.querySelector('.pa-toast-btn') as HTMLButtonElement;
    expect(undoBtn).not.toBeNull();

    // Clicking Undo restores the drawings
    undoBtn.click();
    expect(engine.getElements()).toHaveLength(1);
    expect(engine.getElements()[0].id).toBe('d1');
  });

  it('restores the cleared drawings with a single undo, and redoes the clear', () => {
    const dummy: any = {
      id: 'd1', type: 'pen', points: [{ x: 10, y: 10 }],
      strokeColor: '#000', strokeWidth: 2, opacity: 1, createdAt: 0,
      bbox: { minX: 10, minY: 10, maxX: 10, maxY: 10 },
    };
    engine.addElement(dummy);

    (container.querySelector('[data-action="clear"]') as HTMLButtonElement).click();
    expect(engine.getElements()).toHaveLength(0);

    // One undo brings the drawings back — no extra press needed.
    (container.querySelector('[data-action="undo"]') as HTMLButtonElement).click();
    expect(engine.getElements()).toHaveLength(1);

    // And redo re-applies the clear.
    (container.querySelector('[data-action="redo"]') as HTMLButtonElement).click();
    expect(engine.getElements()).toHaveLength(0);
  });

  it('moves the secondary controls into a More menu that can be opened', () => {
    const moreTrigger = container.querySelector('[data-action="more"]') as HTMLButtonElement;
    expect(moreTrigger).not.toBeNull();
    expect(moreTrigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(moreTrigger.getAttribute('aria-expanded')).toBe('false');

    moreTrigger.click();
    expect(moreTrigger.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('.pa-menu.open')).not.toBeNull();

    // The controls are reachable and labelled.
    const selectAll = container.querySelector('[data-action="select-all"]') as HTMLElement;
    expect(selectAll.getAttribute('aria-label')).toContain('Select All');
    expect(container.querySelector('[data-action="open-options"]')).not.toBeNull();
  });

  it('opens the options page from the More menu when requested', () => {
    (container.querySelector('[data-action="more"]') as HTMLButtonElement).click();
    (container.querySelector('[data-action="open-options"]') as HTMLButtonElement).click();
    expect(mockCallbacks.onOpenOptions).toHaveBeenCalled();
  });

  describe('Contextual drawing defaults popover scoped to active tool', () => {
    it('shows Text Note in the popover header and only text controls when text tool is selected', () => {
      const textBtn = container.querySelector('[data-tool="text"]') as HTMLButtonElement;
      textBtn.click();

      const colorBtn = container.querySelector('.pa-color-preview-btn') as HTMLButtonElement;
      colorBtn.click();

      // Header indicates current selected tool
      const toolName = container.querySelector('.pa-popover-tool-name')!;
      expect(toolName.textContent).toBe('Text Note');

      const badge = container.querySelector('.pa-popover-badge')!;
      expect(badge.textContent).toBe('Selected');

      const target = container.querySelector('.pa-color-target')!;
      expect(target.textContent).toBe('Text note colours');

      // Controls visibility: text size and text colour are shown; pen width and highlighter are hidden
      const fontSizeSlider = container.querySelector<HTMLInputElement>('input[data-setting="defaultFontSize"]')!;
      const penWidthSlider = container.querySelector<HTMLInputElement>('input[data-setting="defaultStrokeWidth"]')!;
      const hlWidthSlider = container.querySelector<HTMLInputElement>('input[data-setting="defaultHighlighterWidth"]')!;

      expect(fontSizeSlider.closest<HTMLElement>('.pa-slider-group')!.style.display).toBe('flex');
      expect(penWidthSlider.closest<HTMLElement>('.pa-slider-group')!.style.display).toBe('none');
      expect(hlWidthSlider.closest<HTMLElement>('.pa-slider-group')!.style.display).toBe('none');

      // Changing text font size in popover
      fontSizeSlider.value = '24';
      fontSizeSlider.dispatchEvent(new Event('change', { bubbles: true }));

      expect((toolbar as any).settings.defaultFontSize).toBe(24);
      expect((engine as any).fontSize).toBe(24);

      // Picking color swatch while text tool is active updates text color
      const swatches = container.querySelectorAll<HTMLButtonElement>('.pa-color-swatch');
      swatches[2].click();
      expect((toolbar as any).settings.defaultStrokeColor).toBe(swatches[2].dataset.color);
      expect((engine as any).strokeColor).toBe(swatches[2].dataset.color);
    });

    it('shows Pen in the popover header and only pen controls when pen tool is selected', () => {
      const penBtn = container.querySelector('[data-tool="pen"]') as HTMLButtonElement;
      penBtn.click();

      const colorBtn = container.querySelector('.pa-color-preview-btn') as HTMLButtonElement;
      colorBtn.click();

      const toolName = container.querySelector('.pa-popover-tool-name')!;
      expect(toolName.textContent).toBe('Pen');
      expect(container.querySelector('.pa-popover-badge')!.textContent).toBe('Selected');

      const penWidthSlider = container.querySelector<HTMLInputElement>('input[data-setting="defaultStrokeWidth"]')!;
      const fontSizeSlider = container.querySelector<HTMLInputElement>('input[data-setting="defaultFontSize"]')!;
      const hlWidthSlider = container.querySelector<HTMLInputElement>('input[data-setting="defaultHighlighterWidth"]')!;

      expect(penWidthSlider.closest<HTMLElement>('.pa-slider-group')!.style.display).toBe('flex');
      expect(fontSizeSlider.closest<HTMLElement>('.pa-slider-group')!.style.display).toBe('none');
      expect(hlWidthSlider.closest<HTMLElement>('.pa-slider-group')!.style.display).toBe('none');
    });

    it('shows Highlighter in the popover header and only highlighter controls when highlighter tool is selected', () => {
      const hlBtn = container.querySelector('[data-tool="highlighter"]') as HTMLButtonElement;
      hlBtn.click();

      const colorBtn = container.querySelector('.pa-color-preview-btn') as HTMLButtonElement;
      colorBtn.click();

      const toolName = container.querySelector('.pa-popover-tool-name')!;
      expect(toolName.textContent).toBe('Highlighter');
      expect(container.querySelector('.pa-popover-badge')!.textContent).toBe('Selected');

      const penWidthSlider = container.querySelector<HTMLInputElement>('input[data-setting="defaultStrokeWidth"]')!;
      const fontSizeSlider = container.querySelector<HTMLInputElement>('input[data-setting="defaultFontSize"]')!;
      const hlWidthSlider = container.querySelector<HTMLInputElement>('input[data-setting="defaultHighlighterWidth"]')!;

      expect(hlWidthSlider.closest<HTMLElement>('.pa-slider-group')!.style.display).toBe('flex');
      expect(penWidthSlider.closest<HTMLElement>('.pa-slider-group')!.style.display).toBe('none');
      expect(fontSizeSlider.closest<HTMLElement>('.pa-slider-group')!.style.display).toBe('none');
    });

    it('shows shape info in header when a shape tool is active', () => {
      engine.setTool('rect');
      toolbar.updateActiveToolUI();

      const colorBtn = container.querySelector('.pa-color-preview-btn') as HTMLButtonElement;
      colorBtn.click();

      const toolName = container.querySelector('.pa-popover-tool-name')!;
      expect(toolName.textContent).toBe('Rectangle');
      expect(container.querySelector('.pa-popover-badge')!.textContent).toBe('Selected');

      const penWidthSlider = container.querySelector<HTMLInputElement>('input[data-setting="defaultStrokeWidth"]')!;
      expect(penWidthSlider.closest<HTMLElement>('.pa-slider-group')!.style.display).toBe('flex');
    });

    it('shows empty notice and quick tool switch buttons when eraser tool is selected', () => {
      const eraserBtn = container.querySelector('[data-tool="eraser"]') as HTMLButtonElement;
      eraserBtn.click();

      const colorBtn = container.querySelector('.pa-color-preview-btn') as HTMLButtonElement;
      colorBtn.click();

      const toolName = container.querySelector('.pa-popover-tool-name')!;
      expect(toolName.textContent).toBe('Eraser');

      const nonePanel = container.querySelector<HTMLElement>('.pa-tool-panel-empty')!;
      expect(nonePanel.style.display).toBe('flex');

      // Grid is hidden for tools without color settings
      const grid = container.querySelector<HTMLElement>('.pa-color-grid')!;
      expect(grid.style.display).toBe('none');

      // Clicking quick button switches tool to pen immediately
      const quickPenBtn = nonePanel.querySelector<HTMLButtonElement>('.pa-quick-tool-btn')!;
      quickPenBtn.click();

      expect(engine.getTool()).toBe('pen');
      expect(toolName.textContent).toBe('Pen');
      expect(grid.style.display).toBe('grid');
    });

    it('dynamically updates popover header and settings panel when tool is switched while popover is open', () => {
      const colorBtn = container.querySelector('.pa-color-preview-btn') as HTMLButtonElement;
      colorBtn.click();
      expect(colorBtn.getAttribute('aria-expanded')).toBe('true');

      // Initially pen
      const toolName = container.querySelector('.pa-popover-tool-name')!;
      expect(toolName.textContent).toBe('Pen');

      // Switch to Text while popover is open
      const textBtn = container.querySelector('[data-tool="text"]') as HTMLButtonElement;
      textBtn.click();

      expect(toolName.textContent).toBe('Text Note');
      const fontSizeSlider = container.querySelector<HTMLInputElement>('input[data-setting="defaultFontSize"]')!;
      expect(fontSizeSlider.closest<HTMLElement>('.pa-slider-group')!.style.display).toBe('flex');

      // Switch to Highlighter while popover is open
      const hlBtn = container.querySelector('[data-tool="highlighter"]') as HTMLButtonElement;
      hlBtn.click();

      expect(toolName.textContent).toBe('Highlighter');
      const hlWidthSlider = container.querySelector<HTMLInputElement>('input[data-setting="defaultHighlighterWidth"]')!;
      expect(hlWidthSlider.closest<HTMLElement>('.pa-slider-group')!.style.display).toBe('flex');
      expect(fontSizeSlider.closest<HTMLElement>('.pa-slider-group')!.style.display).toBe('none');
    });
  });

  describe('Viewport-Aware Tooltips and Popups', () => {
    it('sets pa-placement-top class when toolbar is near top of viewport', () => {
      const wrapper = container.querySelector('.pa-toolbar-wrapper') as HTMLElement;
      wrapper.style.top = '20px';
      toolbar.updateViewportPlacement();
      expect(wrapper.classList.contains('pa-placement-top')).toBe(true);

      wrapper.style.top = '120px';
      toolbar.updateViewportPlacement();
      expect(wrapper.classList.contains('pa-placement-top')).toBe(false);
    });

    it('positions tooltips below when near top and adjusts dynamically on hover', () => {
      const wrapper = container.querySelector('.pa-toolbar-wrapper') as HTMLElement;
      wrapper.style.top = '24px';
      toolbar.updateViewportPlacement();

      const closeBtn = container.querySelector('[data-action="hide"]') as HTMLElement;
      const tip = closeBtn.querySelector('.pa-tooltip') as HTMLElement;
      expect(tip).not.toBeNull();

      toolbar.adjustTooltipPosition(closeBtn, tip);
      expect(tip.classList.contains('pa-tooltip-below')).toBe(true);

      wrapper.style.top = '200px';
      toolbar.updateViewportPlacement();
      toolbar.adjustTooltipPosition(closeBtn, tip);
      expect(tip.classList.contains('pa-tooltip-below')).toBe(false);
    });

    it('flips dropdown menus above when room below is limited', () => {
      const wrapper = container.querySelector('.pa-toolbar-wrapper') as HTMLElement;
      wrapper.style.top = `${window.innerHeight - 80}px`;

      const moreTrigger = container.querySelector('[data-action="more"]') as HTMLButtonElement;
      moreTrigger.click();

      const moreMenu = container.querySelector('.pa-menu.open') as HTMLElement;
      expect(moreMenu).not.toBeNull();
      expect(moreMenu.classList.contains('above')).toBe(true);

      toolbar.closeMenus();
      wrapper.style.top = '50px';
      moreTrigger.click();
      const openMenu = container.querySelector('.pa-menu.open') as HTMLElement;
      expect(openMenu.classList.contains('above')).toBe(false);
    });

    it('positions color popover below when room above is constrained', () => {
      const wrapper = container.querySelector('.pa-toolbar-wrapper') as HTMLElement;
      wrapper.style.top = '24px';

      const colorBtn = container.querySelector('.pa-color-preview-btn') as HTMLButtonElement;
      colorBtn.click();

      const popover = container.querySelector('.pa-popover') as HTMLElement;
      expect(popover.classList.contains('below')).toBe(true);
    });

    it('does not set default HTML title attributes on toolbar controls to prevent duplicate browser tooltips', () => {
      const controls = container.querySelectorAll('.pa-toolbar-wrapper button, .pa-toolbar-wrapper .pa-drag-handle');
      controls.forEach((el) => {
        expect(el.getAttribute('title')).toBeNull();
      });
    });
  });
});
