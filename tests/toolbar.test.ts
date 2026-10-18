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

  it('toggles drawing mode via anchor pill button click', () => {
    const pill = container.querySelector('.pa-anchor-pill') as HTMLButtonElement;
    toolbar.setDrawingMode(false);

    pill.click();
    expect(engine.getActiveMode()).toBe(true);
  });

  it('collapses/expands the toolbar without leaving drawing mode', () => {
    const wrapper = container.querySelector('.pa-toolbar-wrapper') as HTMLElement;
    toolbar.setDrawingMode(true, false);
    expect(engine.getActiveMode()).toBe(true);
    expect(wrapper.style.display).toBe('block');

    toolbar.toggleToolbarVisibility();
    expect(wrapper.style.display).toBe('none');
    // Still in drawing mode — only the bar is hidden
    expect(engine.getActiveMode()).toBe(true);

    toolbar.toggleToolbarVisibility();
    expect(wrapper.style.display).toBe('block');
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

  it('supports keyboard navigation on the drag handle using Arrow keys', () => {
    const dragHandle = container.querySelector('.pa-drag-handle') as HTMLElement;
    const wrapper = container.querySelector('.pa-toolbar-wrapper') as HTMLElement;

    dragHandle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(wrapper.style.left).toBe('20px');

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
});
