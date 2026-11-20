import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FloatingToolbar } from '../src/ui/toolbar';
import { CanvasEngine } from '../src/core/engine';
import { HistoryManager } from '../src/core/history';
import { TextEditorOverlay } from '../src/ui/text-editor';
import { DEFAULT_SETTINGS } from '../src/core/storage';
import { formatShortcutForDisplay } from '../src/core/shortcuts';
import type { ExtensionSettings } from '../src/types/storage.types';
import type { ShapeElement, StrokeElement } from '../src/types/engine.types';

function makeCallbacks() {
  return {
    onToggleActive: vi.fn(),
    onClear: vi.fn(),
    onToggleDomAnchoring: vi.fn(),
    onSettingsUpdate: vi.fn(),
    onOpenOptions: vi.fn(),
  };
}

function settingsOf(toolbar: FloatingToolbar): ExtensionSettings {
  return (toolbar as unknown as { settings: ExtensionSettings }).settings;
}

function engineState(engine: CanvasEngine) {
  return engine as unknown as { strokeColor: string; highlighterColor: string; fontSize: number };
}

function penElement(id: string): StrokeElement {
  return {
    id,
    type: 'pen',
    points: [{ x: 10, y: 10 }],
    strokeColor: '#000',
    strokeWidth: 2,
    opacity: 1,
    createdAt: 0,
    bbox: { minX: 10, minY: 10, maxX: 10, maxY: 10 },
  };
}

function rectElement(id: string): ShapeElement {
  return {
    id,
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
  };
}

function settingsWith(patch: Partial<ExtensionSettings>): ExtensionSettings {
  return { ...DEFAULT_SETTINGS, shortcuts: { ...DEFAULT_SETTINGS.shortcuts }, ...patch };
}

describe('FloatingToolbar: Dragging, Tool Switching, History & UI Controls', () => {
  let container: HTMLElement;
  let engine: CanvasEngine;
  let history: HistoryManager;
  let textEditor: TextEditorOverlay;
  let toolbar: FloatingToolbar;
  let mockCallbacks: ReturnType<typeof makeCallbacks>;

  const q = <T extends HTMLElement = HTMLButtonElement>(selector: string) => container.querySelector(selector) as T;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);

    mockCallbacks = makeCallbacks();

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
      settingsWith({}),
      mockCallbacks
    );
    toolbar.setDrawingMode(true);
  });

  afterEach(() => {
    toolbar.destroy();
    engine.destroy();
    container.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('switches active drawing tool when tool buttons are clicked', () => {
    const penBtn = q('[data-tool="pen"]');
    const rectBtn = q('[data-tool="rect"]');
    const eraserBtn = q('[data-tool="eraser"]');

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
    engine.setElements([rectElement('sample')]);
    q('[data-action="select-all"]').click();
    expect(engine.getTool()).toBe('select');
  });

  it('toggles drawing mode on and off', () => {
    toolbar.setDrawingMode(false);
    expect(engine.getActiveMode()).toBe(false);

    toolbar.setDrawingMode(true);
    expect(engine.getActiveMode()).toBe(true);
    expect(mockCallbacks.onToggleActive).toHaveBeenCalled();
  });

  it('reports a hide exactly once', () => {
    mockCallbacks.onToggleActive.mockClear();
    toolbar.setDrawingMode(false);
    expect(mockCallbacks.onToggleActive).toHaveBeenCalledTimes(1);
    expect(mockCallbacks.onToggleActive).toHaveBeenCalledWith(false);

    toolbar.setDrawingMode(false);
    expect(mockCallbacks.onToggleActive).toHaveBeenCalledTimes(1);
  });

  it('hides the toolbar entirely and restores it from the extension icon', () => {
    const wrapper = q<HTMLElement>('.pa-toolbar-wrapper');
    toolbar.setDrawingMode(false);
    expect(engine.getActiveMode()).toBe(false);
    expect(wrapper.style.display).toBe('none');

    toolbar.setDrawingMode(true);
    expect(engine.getActiveMode()).toBe(true);
    expect(wrapper.style.display).toBe('block');
  });

  it('restores the toolbar to the position it was dragged to', () => {
    const wrapper = q<HTMLElement>('.pa-toolbar-wrapper');
    settingsOf(toolbar).toolbarPosition = { x: 320, y: 180 };

    toolbar.setDrawingMode(false);
    expect(wrapper.style.display).toBe('none');

    toolbar.setDrawingMode(true);
    expect(wrapper.style.display).toBe('block');
    expect(wrapper.style.left).toBe('320px');
    expect(wrapper.style.top).toBe('180px');
  });

  it('hides the toolbar via the close button on the top corner of the toolbar wrapper', () => {
    const wrapper = q<HTMLElement>('.pa-toolbar-wrapper');
    expect(wrapper.style.display).toBe('block');

    expect(container.querySelector('.pa-menu [data-action="hide"]')).toBeNull();
    expect(container.querySelector('.pa-toolbar [data-action="hide"]')).toBeNull();
    const hideBtn = q('.pa-toolbar-wrapper > [data-action="hide"]');
    expect(hideBtn).not.toBeNull();
    expect(hideBtn.classList.contains('pa-toolbar-close-btn')).toBe(true);

    hideBtn.click();

    expect(wrapper.style.display).toBe('none');
    expect(engine.getActiveMode()).toBe(false);
  });

  it('hides and shows the toolbar when the extension icon is clicked', () => {
    const wrapper = q<HTMLElement>('.pa-toolbar-wrapper');
    expect(wrapper.style.display).toBe('block');

    toolbar.toggleDrawingMode();
    expect(wrapper.style.display).toBe('none');
    expect(engine.getActiveMode()).toBe(false);

    toolbar.toggleDrawingMode();
    expect(wrapper.style.display).toBe('block');
    expect(engine.getActiveMode()).toBe(true);
  });

  it('does not save anything when the toolbar is hidden or shown', () => {
    q('[data-action="hide"]').click();
    toolbar.setDrawingMode(true);
    expect('isToolbarOpen' in settingsOf(toolbar)).toBe(false);
    expect(mockCallbacks.onSettingsUpdate).not.toHaveBeenCalled();
  });

  it('starts hidden', () => {
    const other = document.createElement('div');
    document.body.appendChild(other);
    const otherEngine = new CanvasEngine(other);
    const otherToolbar = new FloatingToolbar(
      other,
      otherEngine,
      new HistoryManager([]),
      new TextEditorOverlay(other),
      settingsWith({})
    );

    const wrapper = other.querySelector('.pa-toolbar-wrapper') as HTMLElement;
    expect(wrapper.style.display).toBe('none');

    otherToolbar.setDrawingMode(true);
    expect(wrapper.style.display).toBe('block');

    otherToolbar.destroy();
    otherEngine.destroy();
    other.remove();
  });

  it('never opens itself when settings load or change', () => {
    const other = document.createElement('div');
    document.body.appendChild(other);
    const otherEngine = new CanvasEngine(other);
    const otherToolbar = new FloatingToolbar(
      other,
      otherEngine,
      new HistoryManager([]),
      new TextEditorOverlay(other),
      settingsWith({})
    );
    const wrapper = other.querySelector('.pa-toolbar-wrapper') as HTMLElement;

    otherToolbar.setSettings(settingsWith({ keepToolbarOpen: true } as Partial<ExtensionSettings>));
    expect(wrapper.style.display).toBe('none');

    otherToolbar.setSettings(settingsWith({ defaultStrokeColor: '#123456' }));
    expect(wrapper.style.display).toBe('none');
    expect(engineState(otherEngine).strokeColor).toBe('#123456');

    otherToolbar.destroy();
    otherEngine.destroy();
    other.remove();
  });

  it('restores the toolbar after hiding it', () => {
    const wrapper = q<HTMLElement>('.pa-toolbar-wrapper');
    q('[data-action="hide"]').click();
    expect(wrapper.style.display).toBe('none');

    toolbar.setDrawingMode(true);
    expect(wrapper.style.display).toBe('block');
    expect(engine.getActiveMode()).toBe(true);
  });

  it('exposes a distinct shortcut label for the double-arrow tool', () => {
    const doubleArrowBtn = q('[data-tool="double-arrow"]');
    expect(doubleArrowBtn).not.toBeNull();
    const shortcutKey = doubleArrowBtn.querySelector('.pa-menu-item-key') as HTMLElement;
    expect(shortcutKey.textContent).toBe(formatShortcutForDisplay(DEFAULT_SETTINGS.shortcuts['tool-double-arrow']));
  });

  it('refreshes every shortcut label, including shape menu keys and tooltips that had none, after settings change', () => {
    toolbar.setSettings(
      settingsWith({ shortcuts: { ...DEFAULT_SETTINGS.shortcuts, 'tool-pen': '', 'tool-rect': 'q' } })
    );
    const penBtn = q('[data-tool="pen"]');
    expect(penBtn.querySelector('.pa-tooltip kbd')).toBeNull();
    expect(penBtn.getAttribute('aria-label')).toBe('Pen');
    expect(q('[data-tool="rect"] .pa-menu-item-key').textContent).toBe('Q');

    toolbar.setSettings(
      settingsWith({ shortcuts: { ...DEFAULT_SETTINGS.shortcuts, 'tool-pen': 'k', 'tool-rect': 'w' } })
    );
    expect(penBtn.querySelector('.pa-tooltip kbd')?.textContent).toBe('K');
    expect(penBtn.getAttribute('aria-label')).toBe('Pen (K)');
    expect(q('[data-tool="rect"] .pa-menu-item-key').textContent).toBe('W');
  });

  it('prints single-key tool shortcuts on the tool buttons and keeps combos in the tooltip only', () => {
    const hint = (tool: string) => q(`.pa-btn[data-tool="${tool}"] .pa-key-hint`);
    expect(hint('pen').textContent).toBe('P');
    expect(hint('pen').getAttribute('aria-hidden')).toBe('true');
    expect(q('[data-tool="pen"]').getAttribute('aria-label')).toBe('Pen (P)');
    expect(q('[data-action="undo"] .pa-key-hint')).toBeNull();

    toolbar.setSettings(settingsWith({ shortcuts: { ...DEFAULT_SETTINGS.shortcuts, 'tool-pen': 'Ctrl+Shift+P', 'tool-eraser': 'x' } }));
    expect(hint('pen').style.display).toBe('none');
    expect(q('[data-tool="pen"] .pa-tooltip kbd')?.textContent).toBe('Ctrl + Shift + P');
    expect(hint('eraser').textContent).toBe('X');

    toolbar.setSettings(settingsWith({ shortcuts: { ...DEFAULT_SETTINGS.shortcuts, 'tool-pen': 'k' } }));
    expect(hint('pen').style.display).toBe('');
    expect(hint('pen').textContent).toBe('K');
  });

  it('groups the shape tools behind a single menu entry', () => {
    const shapesTrigger = q('[data-action="shapes"]');
    expect(shapesTrigger).not.toBeNull();
    expect(shapesTrigger.getAttribute('aria-haspopup')).toBe('menu');

    const rectBtn = q('[data-tool="rect"]');
    rectBtn.click();
    expect(engine.getTool()).toBe('rect');
    expect(rectBtn.classList.contains('active')).toBe(true);
    expect(rectBtn.getAttribute('aria-checked')).toBe('true');
    expect(shapesTrigger.classList.contains('active')).toBe(true);
  });

  it('updates undo and redo buttons availability based on history stack', () => {
    const undoBtn = q('[data-action="undo"]');
    const redoBtn = q('[data-action="redo"]');

    expect(undoBtn.disabled).toBe(true);
    expect(redoBtn.disabled).toBe(true);

    history.pushState([penElement('s1')]);
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
    const wrapper = q<HTMLElement>('.pa-toolbar-wrapper');
    const dragHandle = q<HTMLElement>('.pa-drag-handle');
    dragHandle.setPointerCapture = vi.fn();

    expect(wrapper.style.transform).toBe('translateX(-50%)');

    dragHandle.dispatchEvent(
      new PointerEvent('pointerdown', { button: 0, clientX: 100, clientY: 40, pointerId: 1, bubbles: true })
    );
    dragHandle.dispatchEvent(new PointerEvent('pointermove', { clientX: 140, clientY: 60, pointerId: 1, bubbles: true }));
    expect(wrapper.style.transform).toBe('none');
    expect(wrapper.style.left).toBe('40px');

    dragHandle.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true }));
  });

  it('repositions with the drag handle using Arrow keys', () => {
    const dragHandle = q<HTMLElement>('.pa-drag-handle');
    const wrapper = q<HTMLElement>('.pa-toolbar-wrapper');

    dragHandle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(wrapper.style.left).toBe('20px');
    expect(wrapper.style.transform).toBe('none');

    dragHandle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(wrapper.style.top).toBe('20px');
  });

  it('writes the dragged position to settings so it survives a reload', () => {
    const dragHandle = q<HTMLElement>('.pa-drag-handle');
    dragHandle.setPointerCapture = vi.fn();

    dragHandle.dispatchEvent(
      new PointerEvent('pointerdown', { button: 0, clientX: 100, clientY: 40, pointerId: 1, bubbles: true })
    );
    dragHandle.dispatchEvent(new PointerEvent('pointermove', { clientX: 140, clientY: 60, pointerId: 1, bubbles: true }));
    dragHandle.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true }));

    const wrapper = q<HTMLElement>('.pa-toolbar-wrapper');
    const applied = { x: parseFloat(wrapper.style.left), y: parseFloat(wrapper.style.top) };
    expect(settingsOf(toolbar).toolbarPosition).toEqual(applied);
    expect(applied.x).toBeGreaterThan(0);
    expect(mockCallbacks.onSettingsUpdate).toHaveBeenCalledWith(expect.objectContaining({ toolbarPosition: applied }));
  });

  it('writes the keyboard-nudged position to settings', () => {
    const dragHandle = q<HTMLElement>('.pa-drag-handle');
    const wrapper = q<HTMLElement>('.pa-toolbar-wrapper');
    dragHandle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

    const applied = { x: parseFloat(wrapper.style.left), y: parseFloat(wrapper.style.top) };
    expect(settingsOf(toolbar).toolbarPosition).toEqual(applied);
    expect(mockCallbacks.onSettingsUpdate).toHaveBeenCalledWith(expect.objectContaining({ toolbarPosition: applied }));
  });

  it('clamps an off-screen saved position on resize without changing the saved position', () => {
    const wrapper = q<HTMLElement>('.pa-toolbar-wrapper');
    settingsOf(toolbar).toolbarPosition = { x: 5000, y: 5000 };

    window.dispatchEvent(new Event('resize'));

    expect(parseFloat(wrapper.style.left)).toBeLessThan(window.innerWidth);
    expect(parseFloat(wrapper.style.top)).toBeLessThan(window.innerHeight);
    expect(settingsOf(toolbar).toolbarPosition).toEqual({ x: 5000, y: 5000 });
    expect(mockCallbacks.onSettingsUpdate).not.toHaveBeenCalled();
  });

  it('toggles DOM anchoring mode via action button', () => {
    const anchorBtn = q('[data-action="dom-anchor"]');
    expect(engine.getDomAnchoringEnabled()).toBe(true);

    anchorBtn.click();
    expect(engine.getDomAnchoringEnabled()).toBe(false);
    expect(mockCallbacks.onToggleDomAnchoring).toHaveBeenCalledWith(false);
    expect(anchorBtn.getAttribute('aria-checked')).toBe('false');

    anchorBtn.click();
    expect(engine.getDomAnchoringEnabled()).toBe(true);
    expect(mockCallbacks.onToggleDomAnchoring).toHaveBeenCalledWith(true);
    expect(anchorBtn.getAttribute('aria-checked')).toBe('true');
  });

  it('keeps the Show Drawings label and icon across repeated toggles', () => {
    const item = q('[data-action="visibility"]');
    for (const expected of ['false', 'true', 'false']) {
      item.click();
      expect(item.getAttribute('aria-checked')).toBe(expected);
      expect(item.querySelector('.pa-menu-item-label')?.textContent).toBe('Show Drawings');
      expect(item.querySelector('.pa-menu-item-icon svg')).not.toBeNull();
      expect(item.querySelector('.pa-menu-item-hint')?.textContent).toBe(expected === 'true' ? 'On' : 'Off');
      expect(item.hasAttribute('aria-label')).toBe(false);
    }
  });

  it('resyncs the visibility and anchoring items from settings and the host', () => {
    const visibility = q('[data-action="visibility"]');
    const anchor = q('[data-action="dom-anchor"]');

    toolbar.setSettings(settingsWith({ areAnnotationsVisible: false }));
    expect(visibility.getAttribute('aria-checked')).toBe('false');
    expect(visibility.querySelector('.pa-menu-item-hint')?.textContent).toBe('Off');

    toolbar.updateDomAnchoringUI(false);
    expect(anchor.getAttribute('aria-checked')).toBe('false');
    expect(anchor.querySelector('.pa-menu-item-hint')?.textContent).toBe('Off');
    expect(anchor.querySelector('.pa-menu-item-label')?.textContent).toBe('Smart Anchoring');
  });

  it('triggers the clear callback from its action button', () => {
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
    q('[data-action="clear"]').click();
    expect(mockCallbacks.onClear).toHaveBeenCalled();
  });

  it('includes the drawing count in the clear button name', () => {
    const clearBtn = q('[data-action="clear"]');
    expect(clearBtn.getAttribute('aria-label')).not.toMatch(/drawing/);

    engine.addElement(penElement('a'));
    toolbar.updateBadge();
    expect(clearBtn.getAttribute('aria-label')).toContain('Clear Page, 1 drawing');

    engine.addElement(penElement('b'));
    toolbar.updateBadge();
    expect(clearBtn.getAttribute('aria-label')).toContain('2 drawings');
    expect(q('.pa-count-badge').getAttribute('aria-hidden')).toBe('true');
  });

  it('does not expose a settings action in the drawing toolbar', () => {
    expect(container.querySelector('[data-action="settings"]')).toBeNull();
  });

  it('keeps the drawing defaults in the toolbar popover and persists changes', () => {
    const colorBtn = q('.pa-color-preview-btn');
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

    const penWidth = q<HTMLInputElement>('input[data-setting="defaultStrokeWidth"]');
    penWidth.value = '9';
    penWidth.dispatchEvent(new Event('change', { bubbles: true }));

    expect(settingsOf(toolbar).defaultStrokeWidth).toBe(9);
    expect(mockCallbacks.onSettingsUpdate).toHaveBeenCalled();

    const swatch = q('.pa-color-swatch');
    swatch.click();
    expect(settingsOf(toolbar).defaultStrokeColor).toBe(swatch.dataset.color);
    expect(colorBtn.style.backgroundColor).toBeTruthy();
  });

  it('keeps the popover open while changing a value and closes on an outside press', () => {
    const colorBtn = q('.pa-color-preview-btn');
    colorBtn.click();
    expect(colorBtn.getAttribute('aria-expanded')).toBe('true');

    q('.pa-color-swatch').dispatchEvent(new Event('pointerdown', { bubbles: true, composed: true }));
    expect(colorBtn.getAttribute('aria-expanded')).toBe('true');

    q('input[data-setting="defaultStrokeWidth"]').dispatchEvent(new Event('pointerdown', { bubbles: true, composed: true }));
    expect(colorBtn.getAttribute('aria-expanded')).toBe('true');

    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true, composed: true }));
    expect(colorBtn.getAttribute('aria-expanded')).toBe('false');
  });

  it('resets the drawing defaults back to factory values from the popover', () => {
    const penWidth = q<HTMLInputElement>('input[data-setting="defaultStrokeWidth"]');
    penWidth.value = '9';
    penWidth.dispatchEvent(new Event('change', { bubbles: true }));
    expect(settingsOf(toolbar).defaultStrokeWidth).toBe(9);

    q('.pa-popover-reset').click();

    expect(settingsOf(toolbar).defaultStrokeWidth).toBe(DEFAULT_SETTINGS.defaultStrokeWidth);
    expect(settingsOf(toolbar).defaultFontSize).toBe(DEFAULT_SETTINGS.defaultFontSize);
    expect(penWidth.value).toBe(`${DEFAULT_SETTINGS.defaultStrokeWidth}`);
  });

  it('updates highlighter color when preset swatch is clicked while highlighter tool is active', () => {
    q('[data-tool="highlighter"]').click();
    const colorBtn = q('.pa-color-preview-btn');
    colorBtn.click();

    expect(q('.pa-color-grid').getAttribute('aria-label')).toBe('Preset highlighter colors');

    const swatches = container.querySelectorAll<HTMLButtonElement>('.pa-color-swatch');
    swatches[1].click();

    expect(settingsOf(toolbar).defaultHighlighterColor).toBe(swatches[1].dataset.color);
    expect(engineState(engine).highlighterColor).toBe(swatches[1].dataset.color);
    expect(colorBtn.style.backgroundColor).toBe(swatches[1].dataset.color);
  });

  it('applies the picked highlighter color to strokes drawn with the highlighter', () => {
    q('[data-tool="highlighter"]').click();
    q('.pa-color-preview-btn').click();
    const swatches = container.querySelectorAll<HTMLButtonElement>('.pa-color-swatch');
    swatches[2].click();
    const picked = swatches[2].dataset.color;

    const canvas = q<HTMLCanvasElement>('.page-anchor-active-canvas');
    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 10, clientY: 10, button: 0, pointerId: 1 }));
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 60, clientY: 10, pointerId: 1 }));
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: 60, clientY: 10, pointerId: 1 }));

    const stroke = engine.getElements()[0];
    expect(stroke.type).toBe('highlighter');
    expect(stroke.strokeColor).toBe(picked);
  });

  it('keeps the pen colour unchanged when the highlighter colour is edited', () => {
    const penBefore = settingsOf(toolbar).defaultStrokeColor;

    q('[data-tool="highlighter"]').click();
    q('.pa-color-preview-btn').click();
    container.querySelectorAll<HTMLButtonElement>('.pa-color-swatch')[3].click();

    expect(settingsOf(toolbar).defaultStrokeColor).toBe(penBefore);
    expect(engineState(engine).strokeColor).toBe(penBefore);
  });

  it('clears drawings immediately and displays undo toast without modal confirm', () => {
    const confirmSpy = vi.fn();
    vi.stubGlobal('confirm', confirmSpy);

    engine.addElement(penElement('d1'));
    expect(engine.getElements()).toHaveLength(1);

    q('[data-action="clear"]').click();

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(engine.getElements()).toHaveLength(0);
    expect(mockCallbacks.onClear).toHaveBeenCalled();

    const toast = q<HTMLElement>('.pa-toast');
    expect(toast).not.toBeNull();
    const undoBtn = toast.querySelector('.pa-toast-btn') as HTMLButtonElement;
    expect(undoBtn).not.toBeNull();

    undoBtn.click();
    expect(engine.getElements()).toHaveLength(1);
    expect(engine.getElements()[0].id).toBe('d1');
  });

  it('toast Undo restores exactly the cleared drawings and keeps ones drawn afterwards', () => {
    engine.addElement(penElement('before'));
    q('[data-action="clear"]').click();
    engine.addElement(penElement('after'));
    mockCallbacks.onClear.mockClear();

    q('.pa-toast-btn').click();

    expect(engine.getElements().map((el) => el.id)).toEqual(['after', 'before']);
    expect(mockCallbacks.onClear).toHaveBeenCalled();
    expect(q('[data-action="undo"]').disabled).toBe(false);

    // The restore is its own history step, so one undo returns to the state before it.
    q('[data-action="undo"]').click();
    expect(engine.getElements().map((el) => el.id)).toEqual(['after']);
  });

  it('restores the cleared drawings with a single undo, and redoes the clear', () => {
    engine.addElement(penElement('d1'));

    q('[data-action="clear"]').click();
    expect(engine.getElements()).toHaveLength(0);

    q('[data-action="undo"]').click();
    expect(engine.getElements()).toHaveLength(1);

    q('[data-action="redo"]').click();
    expect(engine.getElements()).toHaveLength(0);
  });

  it('announces toasts through a persistent live region and pauses dismissal while hovered or focused', () => {
    vi.useFakeTimers();
    const region = q<HTMLElement>('.pa-live-region');
    expect(region.getAttribute('aria-live')).toBe('polite');

    toolbar.showToast('Saved', 'Undo', () => {}, 1000);
    const toast = q<HTMLElement>('.pa-toast');
    expect(toast.hasAttribute('role')).toBe(false);
    vi.advanceTimersByTime(60);
    expect(region.textContent).toBe('Saved');

    toast.dispatchEvent(new Event('pointerenter'));
    vi.advanceTimersByTime(5000);
    expect(toast.isConnected).toBe(true);

    toast.dispatchEvent(new Event('pointerleave'));
    const undo = toast.querySelector('.pa-toast-btn') as HTMLButtonElement;
    undo.focus();
    vi.advanceTimersByTime(5000);
    expect(toast.isConnected).toBe(true);

    undo.blur();
    vi.advanceTimersByTime(2000);
    expect(toast.isConnected).toBe(false);
    expect(region.isConnected).toBe(true);
  });

  it('moves the secondary controls into a More menu that can be opened', () => {
    const moreTrigger = q('[data-action="more"]');
    expect(moreTrigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(moreTrigger.getAttribute('aria-expanded')).toBe('false');

    moreTrigger.click();
    expect(moreTrigger.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('.pa-menu.open')).not.toBeNull();

    expect(q('[data-action="select-all"]').textContent).toContain('Select All');
    expect(container.querySelector('[data-action="open-options"]')).not.toBeNull();
  });

  it('opens the options page from the More menu when requested', () => {
    q('[data-action="more"]').click();
    q('[data-action="open-options"]').click();
    expect(mockCallbacks.onOpenOptions).toHaveBeenCalled();
  });

  describe('Keyboard access to menus and the defaults popover', () => {
    it('moves focus into an opened menu and navigates with arrows, Home and End', () => {
      const trigger = q('[data-action="shapes"]');
      trigger.focus();
      trigger.click();

      const items = Array.from(container.querySelectorAll<HTMLElement>('.pa-menu.open [role^="menuitem"]'));
      expect(items.map((i) => i.dataset.tool)).toEqual(['rect', 'circle', 'line', 'arrow', 'double-arrow']);
      expect(document.activeElement).toBe(items[0]);

      const press = (key: string) =>
        document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      press('ArrowDown');
      expect(document.activeElement).toBe(items[1]);
      press('End');
      expect(document.activeElement).toBe(items[4]);
      press('ArrowDown');
      expect(document.activeElement).toBe(items[0]);
      press('ArrowUp');
      expect(document.activeElement).toBe(items[4]);
      press('Home');
      expect(document.activeElement).toBe(items[0]);

      press('Escape');
      expect(trigger.getAttribute('aria-expanded')).toBe('false');
      expect(document.activeElement).toBe(trigger);
    });

    it('opens a menu from the trigger with ArrowUp onto the last item and closes it on Tab', () => {
      const trigger = q('[data-action="more"]');
      trigger.focus();
      trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
      expect(trigger.getAttribute('aria-expanded')).toBe('true');
      expect(document.activeElement).toBe(q('[data-action="open-options"]'));

      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
      expect(trigger.getAttribute('aria-expanded')).toBe('false');
      expect(document.activeElement).toBe(trigger);
    });

    it('closes a menu when focus moves outside it and returns focus to the trigger after a choice', () => {
      const trigger = q('[data-action="shapes"]');
      trigger.click();
      const outside = q('[data-tool="pen"]');
      document.activeElement?.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: outside }));
      expect(trigger.getAttribute('aria-expanded')).toBe('false');

      trigger.click();
      (document.activeElement as HTMLElement).click();
      expect(trigger.getAttribute('aria-expanded')).toBe('false');
      expect(document.activeElement).toBe(trigger);
    });

    it('keeps menu items out of the Tab order', () => {
      container.querySelectorAll<HTMLElement>('.pa-menu-item').forEach((item) => {
        expect(item.tabIndex).toBe(-1);
      });
    });

    it('places the popover right after its trigger, focuses it on open and closes on Escape', () => {
      const colorBtn = q('.pa-color-preview-btn');
      const popover = q<HTMLElement>('.pa-popover');
      expect(colorBtn.nextElementSibling).toBe(popover);

      colorBtn.focus();
      colorBtn.click();
      expect(popover.contains(document.activeElement)).toBe(true);
      expect(document.activeElement?.classList.contains('pa-color-swatch')).toBe(true);

      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(colorBtn.getAttribute('aria-expanded')).toBe('false');
      expect(document.activeElement).toBe(colorBtn);
    });

    it('focuses the first quick-switch button when the active tool has no colour settings', () => {
      q('[data-tool="eraser"]').click();
      q('.pa-color-preview-btn').click();
      expect(document.activeElement?.classList.contains('pa-quick-tool-btn')).toBe(true);
    });
  });

  describe('Focus when the toolbar hides', () => {
    it('returns focus to the element that was focused before the toolbar opened', () => {
      toolbar.setDrawingMode(false);
      const field = document.createElement('input');
      document.body.appendChild(field);
      field.focus();

      toolbar.setDrawingMode(true);
      const closeBtn = q('[data-action="hide"]');
      closeBtn.focus();
      closeBtn.click();

      expect(document.activeElement).toBe(field);
      field.remove();
    });

    it('never leaves focus inside the hidden toolbar when the previous element is gone', () => {
      toolbar.setDrawingMode(false);
      const field = document.createElement('input');
      document.body.appendChild(field);
      field.focus();
      toolbar.setDrawingMode(true);
      field.remove();

      const penBtn = q('[data-tool="pen"]');
      penBtn.focus();
      toolbar.toggleDrawingMode();

      const wrapper = q<HTMLElement>('.pa-toolbar-wrapper');
      expect(wrapper.contains(document.activeElement)).toBe(false);
    });
  });

  describe('destroy', () => {
    it('removes its DOM and the window listeners it added', () => {
      const other = document.createElement('div');
      document.body.appendChild(other);
      const otherEngine = new CanvasEngine(other);
      const otherEditor = new TextEditorOverlay(other);
      const added = vi.spyOn(window, 'addEventListener');
      const otherToolbar = new FloatingToolbar(other, otherEngine, new HistoryManager([]), otherEditor, settingsWith({}));
      const resize = added.mock.calls.find(([type]) => type === 'resize')?.[1];
      const pointerdown = added.mock.calls.find(([type]) => type === 'pointerdown')?.[1];
      expect(resize).toBeTypeOf('function');
      expect(pointerdown).toBeTypeOf('function');

      const removed = vi.spyOn(window, 'removeEventListener');
      otherToolbar.destroy();

      expect(removed).toHaveBeenCalledWith('resize', resize);
      expect(removed).toHaveBeenCalledWith('pointerdown', pointerdown, true);
      expect(other.querySelector('.pa-toolbar-wrapper')).toBeNull();
      expect(other.querySelector('.pa-live-region')).toBeNull();

      otherEngine.destroy();
      other.remove();
    });
  });

  describe('Contextual drawing defaults popover scoped to active tool', () => {
    const groupOf = (setting: string) =>
      q<HTMLInputElement>(`input[data-setting="${setting}"]`).closest<HTMLElement>('.pa-slider-group') as HTMLElement;

    it('shows Text Note in the popover header and only text controls when text tool is selected', () => {
      q('[data-tool="text"]').click();
      q('.pa-color-preview-btn').click();

      const toolName = q<HTMLElement>('.pa-popover-tool-name');
      expect(toolName.textContent).toBe('Text Note');

      expect(groupOf('defaultFontSize').style.display).toBe('flex');
      expect(groupOf('defaultStrokeWidth').style.display).toBe('none');
      expect(groupOf('defaultHighlighterWidth').style.display).toBe('none');
      expect(q('input[data-setting="defaultStrokeColor"]').getAttribute('aria-label')).toBe('Custom text colour');

      const fontSizeSlider = q<HTMLInputElement>('input[data-setting="defaultFontSize"]');
      fontSizeSlider.value = '24';
      fontSizeSlider.dispatchEvent(new Event('change', { bubbles: true }));

      expect(settingsOf(toolbar).defaultFontSize).toBe(24);
      expect(engineState(engine).fontSize).toBe(24);

      const swatches = container.querySelectorAll<HTMLButtonElement>('.pa-color-swatch');
      swatches[2].click();
      expect(settingsOf(toolbar).defaultStrokeColor).toBe(swatches[2].dataset.color);
      expect(engineState(engine).strokeColor).toBe(swatches[2].dataset.color);
    });

    it('shows Pen in the popover header and only pen controls when pen tool is selected', () => {
      q('[data-tool="pen"]').click();
      q('.pa-color-preview-btn').click();

      expect(q<HTMLElement>('.pa-popover-tool-name').textContent).toBe('Pen');
      expect(groupOf('defaultStrokeWidth').style.display).toBe('flex');
      expect(groupOf('defaultFontSize').style.display).toBe('none');
      expect(groupOf('defaultHighlighterWidth').style.display).toBe('none');
    });

    it('shows Highlighter in the popover header and only highlighter controls when highlighter tool is selected', () => {
      q('[data-tool="highlighter"]').click();
      q('.pa-color-preview-btn').click();

      expect(q<HTMLElement>('.pa-popover-tool-name').textContent).toBe('Highlighter');
      expect(groupOf('defaultHighlighterWidth').style.display).toBe('flex');
      expect(groupOf('defaultStrokeWidth').style.display).toBe('none');
      expect(groupOf('defaultFontSize').style.display).toBe('none');
    });

    it('shows shape info in header when a shape tool is active', () => {
      engine.setTool('rect');
      toolbar.updateActiveToolUI();
      q('.pa-color-preview-btn').click();

      expect(q<HTMLElement>('.pa-popover-tool-name').textContent).toBe('Rectangle');
      expect(groupOf('defaultStrokeWidth').style.display).toBe('flex');
      expect(q('input[data-setting="defaultStrokeWidth"]').getAttribute('aria-label')).toBe('Width');
    });

    it('shows empty notice and quick tool switch buttons when eraser tool is selected', () => {
      q('[data-tool="eraser"]').click();
      q('.pa-color-preview-btn').click();

      const toolName = q<HTMLElement>('.pa-popover-tool-name');
      expect(toolName.textContent).toBe('Eraser');

      const nonePanel = q<HTMLElement>('.pa-tool-panel-empty');
      expect(nonePanel.style.display).toBe('flex');

      const grid = q<HTMLElement>('.pa-color-grid');
      expect(grid.style.display).toBe('none');

      nonePanel.querySelector<HTMLButtonElement>('.pa-quick-tool-btn')?.click();

      expect(engine.getTool()).toBe('pen');
      expect(toolName.textContent).toBe('Pen');
      expect(grid.style.display).toBe('grid');
    });

    it('dynamically updates popover header and settings panel when tool is switched while popover is open', () => {
      const colorBtn = q('.pa-color-preview-btn');
      colorBtn.click();
      expect(colorBtn.getAttribute('aria-expanded')).toBe('true');

      const toolName = q<HTMLElement>('.pa-popover-tool-name');
      expect(toolName.textContent).toBe('Pen');

      q('[data-tool="text"]').click();
      expect(toolName.textContent).toBe('Text Note');
      expect(groupOf('defaultFontSize').style.display).toBe('flex');

      q('[data-tool="highlighter"]').click();
      expect(toolName.textContent).toBe('Highlighter');
      expect(groupOf('defaultHighlighterWidth').style.display).toBe('flex');
      expect(groupOf('defaultFontSize').style.display).toBe('none');
    });
  });

  describe('Viewport-Aware Tooltips and Popups', () => {
    it('sets pa-placement-top class when toolbar is near top of viewport', () => {
      const wrapper = q<HTMLElement>('.pa-toolbar-wrapper');
      wrapper.style.top = '20px';
      toolbar.updateViewportPlacement();
      expect(wrapper.classList.contains('pa-placement-top')).toBe(true);

      wrapper.style.top = '120px';
      toolbar.updateViewportPlacement();
      expect(wrapper.classList.contains('pa-placement-top')).toBe(false);
    });

    it('positions tooltips below when near top and adjusts dynamically on hover', () => {
      const wrapper = q<HTMLElement>('.pa-toolbar-wrapper');
      wrapper.style.top = '24px';
      toolbar.updateViewportPlacement();

      const closeBtn = q<HTMLElement>('[data-action="hide"]');
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
      const wrapper = q<HTMLElement>('.pa-toolbar-wrapper');
      wrapper.style.top = `${window.innerHeight - 80}px`;

      const moreTrigger = q('[data-action="more"]');
      moreTrigger.click();

      const moreMenu = q<HTMLElement>('.pa-menu.open');
      expect(moreMenu).not.toBeNull();
      expect(moreMenu.classList.contains('above')).toBe(true);

      toolbar.closeMenus();
      wrapper.style.top = '50px';
      moreTrigger.click();
      expect(q<HTMLElement>('.pa-menu.open').classList.contains('above')).toBe(false);
    });

    it('positions color popover below when room above is constrained', () => {
      q<HTMLElement>('.pa-toolbar-wrapper').style.top = '24px';
      q('.pa-color-preview-btn').click();
      expect(q<HTMLElement>('.pa-popover').classList.contains('below')).toBe(true);
    });

    it('does not set default HTML title attributes on toolbar controls to prevent duplicate browser tooltips', () => {
      container.querySelectorAll('.pa-toolbar-wrapper button, .pa-toolbar-wrapper .pa-drag-handle').forEach((el) => {
        expect(el.getAttribute('title')).toBeNull();
      });
    });

    it('hides a button tooltip once the button is pressed, until the pointer leaves it', () => {
      const clear = q('[data-action="clear"]');
      clear.querySelector('svg')?.dispatchEvent(new Event('pointerdown', { bubbles: true, composed: true }));
      expect(clear.classList.contains('pa-tip-hidden')).toBe(true);

      clear.dispatchEvent(new Event('pointerleave'));
      expect(clear.classList.contains('pa-tip-hidden')).toBe(false);
    });
  });

  describe('Recolouring the selection', () => {
    it('recolours the selected drawings from the popover as one undoable step, leaving the pen colour alone', () => {
      engine.addElement(penElement('a'));
      engine.addElement(rectElement('b'));
      engine.selectAll();
      toolbar.updateActiveToolUI();
      const penBefore = settingsOf(toolbar).defaultStrokeColor;

      q('.pa-color-preview-btn').click();
      expect(q<HTMLElement>('.pa-popover-tool-name').textContent).toBe('2 selected');
      expect(q('.pa-color-preview-btn').getAttribute('aria-label')).toBe('Recolour selection');

      q('.pa-color-swatch[data-color="#3b82f6"]').click();

      expect(engine.getElements().map((el) => el.strokeColor)).toEqual(['#3b82f6', '#3b82f6']);
      expect(settingsOf(toolbar).defaultStrokeColor).toBe(penBefore);
      expect(q('.pa-color-swatch[data-color="#3b82f6"]').getAttribute('aria-pressed')).toBe('true');

      toolbar.undo();
      expect(engine.getElements().map((el) => el.strokeColor)).toEqual(['#000', '#000']);
    });

    it('recolours a highlighter stroke and keeps it translucent', () => {
      engine.addElement({ ...penElement('h'), type: 'highlighter', opacity: 0.35 });
      engine.selectAll();
      toolbar.updateActiveToolUI();

      q('.pa-color-preview-btn').click();
      q('.pa-color-swatch[data-color="#22c55e"]').click();

      const [stroke] = engine.getElements();
      expect(stroke.strokeColor).toBe('#22c55e');
      expect(stroke.opacity).toBe(0.35);
    });

    it('shows an empty colour button for tools without a colour, and a prompt to select drawings with the select tool', () => {
      q('[data-tool="select"]').click();
      const colorBtn = q('.pa-color-preview-btn');
      expect(colorBtn.classList.contains('is-empty')).toBe(true);

      colorBtn.click();
      expect(q('.pa-tool-empty-msg').textContent).toBe('Select drawings to recolour them, or pick a tool.');

      q('[data-tool="pen"]').click();
      expect(colorBtn.classList.contains('is-empty')).toBe(false);
    });
  });

  describe('Shapes button', () => {
    it('shows the icon of the last shape used', () => {
      const trigger = q('[data-action="shapes"]');
      const before = trigger.querySelector('svg')?.outerHTML;

      q('.pa-menu-item[data-tool="circle"]').click();
      const circleIcon = q('.pa-menu-item[data-tool="circle"] .pa-menu-item-icon svg').outerHTML;
      expect(trigger.querySelector('svg')?.outerHTML).toBe(circleIcon);
      expect(trigger.querySelector('svg')?.outerHTML).not.toBe(before);
      expect(trigger.querySelector('.pa-tooltip')).not.toBeNull();

      q('[data-tool="pen"]').click();
      expect(trigger.querySelector('svg')?.outerHTML).toBe(circleIcon);
    });
  });
});

describe('FloatingToolbar: two-finger scroll hint on touch screens', () => {
  let container: HTMLElement;
  let engine: CanvasEngine;
  let toolbar: FloatingToolbar | null = null;

  const hint = () => container.querySelector<HTMLElement>('.pa-toast');

  function open(touch: boolean, patch: Partial<ExtensionSettings> = {}): FloatingToolbar {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: touch && query === '(pointer: coarse)' }));
    toolbar = new FloatingToolbar(container, engine, new HistoryManager([]), new TextEditorOverlay(container), settingsWith(patch), makeCallbacks());
    toolbar.setDrawingMode(true);
    vi.advanceTimersByTime(500);
    return toolbar;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div');
    document.body.appendChild(container);
    engine = new CanvasEngine(container);
  });

  afterEach(() => {
    toolbar?.destroy();
    toolbar = null;
    engine.destroy();
    container.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('tells touch users to scroll with two fingers when the toolbar opens', () => {
    open(true);
    expect(hint()?.textContent).toContain('Use two fingers to scroll');
    expect(hint()?.querySelector('.pa-toast-btn')?.textContent).toBe("Don't show again");
  });

  it('never shows the hint with a mouse', () => {
    open(false);
    expect(hint()).toBeNull();
  });

  it('stops showing the hint once the user asks', () => {
    const bar = open(true);
    hint()!.querySelector<HTMLButtonElement>('.pa-toast-btn')!.click();
    expect(settingsOf(bar).scrollHintDismissed).toBe(true);

    bar.setDrawingMode(false);
    container.querySelectorAll('.pa-toast').forEach((el) => el.remove());
    bar.setDrawingMode(true);
    vi.advanceTimersByTime(500);
    expect(hint()).toBeNull();
  });

  it('respects a saved choice', () => {
    open(true, { scrollHintDismissed: true });
    expect(hint()).toBeNull();
  });

  it('stays hidden when the saved choice arrives just after the toolbar opens', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(pointer: coarse)' }));
    toolbar = new FloatingToolbar(container, engine, new HistoryManager([]), new TextEditorOverlay(container), settingsWith({}), makeCallbacks());
    toolbar.setDrawingMode(true);
    toolbar.setSettings(settingsWith({ scrollHintDismissed: true }));
    vi.advanceTimersByTime(500);
    expect(hint()).toBeNull();
  });

  it('waits for the next opening instead of replacing a message that is already showing', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(pointer: coarse)' }));
    const bar = new FloatingToolbar(container, engine, new HistoryManager([]), new TextEditorOverlay(container), settingsWith({}), makeCallbacks());
    toolbar = bar;
    bar.setDrawingMode(true);
    bar.showToast('Something more important', 'Act', () => {}, 10000);
    vi.advanceTimersByTime(500);
    expect(hint()?.textContent).toContain('Something more important');

    bar.setDrawingMode(false);
    container.querySelectorAll('.pa-toast').forEach((el) => el.remove());
    vi.advanceTimersByTime(10000);
    bar.setDrawingMode(true);
    vi.advanceTimersByTime(500);
    expect(hint()?.textContent).toContain('Use two fingers to scroll');
  });

  it('closes a showing hint once the saved choice arrives', () => {
    const bar = open(true);
    expect(hint()).not.toBeNull();
    bar.setSettings(settingsWith({ scrollHintDismissed: true }));
    expect(hint()).toBeNull();
  });
});
