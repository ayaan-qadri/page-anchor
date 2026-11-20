import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { HistoryManager } from '../src/core/history';
import { createDOMAnchor } from '../src/core/anchor';
import { CanvasEngine } from '../src/core/engine';
import { AnchorElement, Point, StrokeElement, ShapeElement, TextElement } from '../src/types/engine.types';

describe('CanvasEngine: Drawing, Tooling, Shapes, Eraser, & Pointer Engine', () => {
  let container: HTMLElement;
  let engine: CanvasEngine;
  let mockChange: Mock<(elements: AnchorElement[]) => void>;
  let mockTextRequest: Mock<(pt: Point) => void>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);

    mockChange = vi.fn();
    mockTextRequest = vi.fn();

    engine = new CanvasEngine(container, {
      onElementsChange: mockChange,
      onTextCreateRequested: mockTextRequest,
    });
    engine.setActiveMode(true);
  });

  afterEach(() => {
    engine.destroy();
    container.remove();
  });

  it('claims touch gestures on its canvases so a pen stroke on a phone never scrolls or swipes back', () => {
    const canvases = [...container.querySelectorAll('canvas')];
    expect(canvases).toHaveLength(2);
    expect(canvases.every((c) => c.style.touchAction === 'none')).toBe(true);
  });

  it('keeps a drawing attached to a fixed element at its starting place in an export, while others follow the page', () => {
    const pinned = { id: 'pinned', type: 'rect', bbox: { minX: 10, minY: 10, maxX: 50, maxY: 50 } } as unknown as AnchorElement;
    const normal = { id: 'normal', type: 'rect', bbox: { minX: 10, minY: 900, maxX: 50, maxY: 950 } } as unknown as AnchorElement;
    (engine as unknown as { elements: AnchorElement[] }).elements = [pinned, normal];
    let scrollY = 0;
    const scrollSpy = vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => scrollY);
    // The pinned drawing's anchor is a fixed element, so its document position grows with the scroll.
    vi.spyOn(engine, 'getElementEffectiveBBox').mockImplementation((el) => {
      const dy = el === pinned ? scrollY : 0;
      const b = el.bbox;
      return { bbox: { minX: b.minX, minY: b.minY + dy, maxX: b.maxX, maxY: b.maxY + dy }, deltaX: 0, deltaY: dy, isOrphaned: false, isConcealed: false };
    });
    const drawn = vi.spyOn(engine as unknown as { renderSingleElementWithOffset: (...a: unknown[]) => void }, 'renderSingleElementWithOffset').mockImplementation(() => {});
    const ctx = { save: vi.fn(), restore: vi.fn(), setTransform: vi.fn() } as unknown as CanvasRenderingContext2D;

    const baseline = engine.measurePlacement();
    scrollY = 800;
    engine.renderRegion(ctx, { minX: 0, minY: 800, maxX: 1000, maxY: 1600 }, 1, baseline);
    expect(drawn.mock.calls.map((c) => (c[1] as AnchorElement).id)).toEqual(['normal']);

    drawn.mockClear();
    engine.renderRegion(ctx, { minX: 0, minY: 0, maxX: 1000, maxY: 800 }, 1, baseline);
    expect(drawn.mock.calls.map((c) => (c[1] as AnchorElement).id)).toEqual(['pinned']);
    scrollSpy.mockRestore();
  });

  describe('Tool Configuration and Styles', () => {
    it('updates tools, stroke widths, colors, font sizes, and annotation visibility', () => {
      engine.setTool('rect');
      expect(engine.getTool()).toBe('rect');

      engine.setStrokeColor('#10b981');
      engine.setStrokeWidth(8);
      engine.setHighlighterColor('#f59e0b');
      engine.setHighlighterWidth(32);
      engine.setFontSize(24);

      expect(engine.getAnnotationsVisible()).toBe(true);
      engine.setAnnotationsVisible(false);
      expect(engine.getAnnotationsVisible()).toBe(false);
      engine.setAnnotationsVisible(true);
      expect(engine.getAnnotationsVisible()).toBe(true);
    });

    it('toggles the stroke simplification flag', () => {
      expect(engine.getStrokeSimplification()).toBe(true);
      engine.setStrokeSimplification(false);
      expect(engine.getStrokeSimplification()).toBe(false);
      expect(() => engine.renderBase()).not.toThrow();
      engine.setStrokeSimplification(true);
      expect(engine.getStrokeSimplification()).toBe(true);
    });

    it('sets appropriate cursor styling on active canvas for each tool', () => {
      const activeCanvas = container.querySelector('.page-anchor-active-canvas') as HTMLCanvasElement;

      engine.setTool('select');
      expect(activeCanvas.style.cursor).toBe('default');

      engine.setTool('pen');
      expect(activeCanvas.style.cursor).toBe('crosshair');

      engine.setTool('text');
      expect(activeCanvas.style.cursor).toBe('text');

      engine.setTool('eraser');
      expect(activeCanvas.style.cursor).toBe('pointer');

      engine.setActiveMode(false);
      expect(activeCanvas.style.cursor).toBe('default');
    });
  });

  describe('Freehand Pen & Highlighter Drawing', () => {
    it('creates and commits a simplified pen stroke on pointer drag', () => {
      engine.setTool('pen');
      engine.setStrokeColor('#3b82f6');
      engine.setStrokeWidth(5);

      const activeCanvas = container.querySelector('.page-anchor-active-canvas') as HTMLCanvasElement;

      activeCanvas.dispatchEvent(
        new PointerEvent('pointerdown', { clientX: 10, clientY: 10, button: 0, pointerId: 1 })
      );
      window.dispatchEvent(
        new PointerEvent('pointermove', { clientX: 20, clientY: 20, pointerId: 1 })
      );
      window.dispatchEvent(
        new PointerEvent('pointermove', { clientX: 30, clientY: 30, pointerId: 1 })
      );
      window.dispatchEvent(
        new PointerEvent('pointerup', { clientX: 30, clientY: 30, pointerId: 1 })
      );

      const elements = engine.getElements();
      expect(elements).toHaveLength(1);
      const stroke = elements[0] as StrokeElement;
      expect(stroke.type).toBe('pen');
      expect(stroke.strokeColor).toBe('#3b82f6');
      expect(stroke.strokeWidth).toBe(5);
      expect(stroke.opacity).toBe(1.0);
      expect(stroke.points.length).toBeGreaterThanOrEqual(2);
      expect(mockChange).toHaveBeenCalledWith(elements);
    });

    it('creates a semi-transparent highlighter stroke on pointer drag', () => {
      engine.setTool('highlighter');
      engine.setHighlighterColor('#fbbf24');
      engine.setHighlighterWidth(25);

      const activeCanvas = container.querySelector('.page-anchor-active-canvas') as HTMLCanvasElement;

      activeCanvas.dispatchEvent(
        new PointerEvent('pointerdown', { clientX: 50, clientY: 50, button: 0, pointerId: 1 })
      );
      window.dispatchEvent(
        new PointerEvent('pointermove', { clientX: 100, clientY: 50, pointerId: 1 })
      );
      window.dispatchEvent(
        new PointerEvent('pointerup', { clientX: 100, clientY: 50, pointerId: 1 })
      );

      const elements = engine.getElements();
      expect(elements).toHaveLength(1);
      const highlighter = elements[0] as StrokeElement;
      expect(highlighter.type).toBe('highlighter');
      expect(highlighter.strokeColor).toBe('#fbbf24');
      expect(highlighter.strokeWidth).toBe(25);
      expect(highlighter.opacity).toBe(0.35);
    });
  });

  describe('Shape Tools & Shift Constraints', () => {
    it('creates rectangles on drag and discards tiny gestures (<4px)', () => {
      engine.setTool('rect');
      const activeCanvas = container.querySelector('.page-anchor-active-canvas') as HTMLCanvasElement;

      activeCanvas.dispatchEvent(
        new PointerEvent('pointerdown', { clientX: 10, clientY: 10, button: 0, pointerId: 1 })
      );
      window.dispatchEvent(
        new PointerEvent('pointermove', { clientX: 11, clientY: 11, pointerId: 1 })
      );
      window.dispatchEvent(
        new PointerEvent('pointerup', { clientX: 11, clientY: 11, pointerId: 1 })
      );
      expect(engine.getElements()).toHaveLength(0);

      activeCanvas.dispatchEvent(
        new PointerEvent('pointerdown', { clientX: 20, clientY: 20, button: 0, pointerId: 2 })
      );
      window.dispatchEvent(
        new PointerEvent('pointermove', { clientX: 120, clientY: 70, pointerId: 2 })
      );
      window.dispatchEvent(
        new PointerEvent('pointerup', { clientX: 120, clientY: 70, pointerId: 2 })
      );

      expect(engine.getElements()).toHaveLength(1);
      const rect = engine.getElements()[0] as ShapeElement;
      expect(rect.type).toBe('rect');
      expect(rect.startX).toBe(20);
      expect(rect.startY).toBe(20);
      expect(rect.endX).toBe(120);
      expect(rect.endY).toBe(70);
    });

    it('constrains rectangle to a perfect 1:1 square when Shift key is held', () => {
      engine.setTool('rect');
      const activeCanvas = container.querySelector('.page-anchor-active-canvas') as HTMLCanvasElement;

      activeCanvas.dispatchEvent(
        new PointerEvent('pointerdown', { clientX: 100, clientY: 100, button: 0, pointerId: 1 })
      );
      window.dispatchEvent(
        new PointerEvent('pointermove', { clientX: 200, clientY: 150, shiftKey: true, pointerId: 1 })
      );
      window.dispatchEvent(
        new PointerEvent('pointerup', { clientX: 200, clientY: 150, pointerId: 1 })
      );

      const rect = engine.getElements()[0] as ShapeElement;
      const width = Math.abs(rect.endX - rect.startX);
      const height = Math.abs(rect.endY - rect.startY);
      expect(width).toBe(height);
    });

    it('creates circles, lines, arrows, and double arrows', () => {
      const activeCanvas = container.querySelector('.page-anchor-active-canvas') as HTMLCanvasElement;

      const tools: ('circle' | 'line' | 'arrow' | 'double-arrow')[] = [
        'circle',
        'line',
        'arrow',
        'double-arrow',
      ];

      tools.forEach((tool, i) => {
        engine.setTool(tool);
        activeCanvas.dispatchEvent(
          new PointerEvent('pointerdown', { clientX: 10 + i * 20, clientY: 10, button: 0, pointerId: i + 1 })
        );
        window.dispatchEvent(
          new PointerEvent('pointermove', { clientX: 50 + i * 20, clientY: 50, pointerId: i + 1 })
        );
        window.dispatchEvent(
          new PointerEvent('pointerup', { clientX: 50 + i * 20, clientY: 50, pointerId: i + 1 })
        );
      });

      expect(engine.getElements()).toHaveLength(4);
      expect(engine.getElements().map((el) => el.type)).toEqual([
        'circle',
        'line',
        'arrow',
        'double-arrow',
      ]);
    });

    it('snaps lines and arrows to 45 degree angle increments with Shift key', () => {
      engine.setTool('line');
      const activeCanvas = container.querySelector('.page-anchor-active-canvas') as HTMLCanvasElement;

      activeCanvas.dispatchEvent(
        new PointerEvent('pointerdown', { clientX: 0, clientY: 0, button: 0, pointerId: 1 })
      );
      window.dispatchEvent(
        new PointerEvent('pointermove', { clientX: 100, clientY: 85, shiftKey: true, pointerId: 1 })
      );
      window.dispatchEvent(
        new PointerEvent('pointerup', { clientX: 100, clientY: 85, pointerId: 1 })
      );

      const line = engine.getElements()[0] as ShapeElement;
      expect(Math.abs(line.endX - line.endY)).toBeLessThanOrEqual(2);
    });
  });

  describe('Text Tool Request and Eraser Tool', () => {
    it('triggers onTextCreateRequested callback when text tool is used', () => {
      engine.setTool('text');
      const activeCanvas = container.querySelector('.page-anchor-active-canvas') as HTMLCanvasElement;

      activeCanvas.dispatchEvent(
        new PointerEvent('pointerdown', { clientX: 150, clientY: 250, button: 0, pointerId: 1 })
      );

      expect(mockTextRequest).toHaveBeenCalledWith({ x: 150, y: 250 });
    });

    it('erases elements when dragged over with eraser tool', () => {
      const stroke: StrokeElement = {
        id: 'stroke-1',
        type: 'pen',
        points: [{ x: 50, y: 50 }, { x: 60, y: 60 }],
        strokeColor: '#000',
        strokeWidth: 4,
        opacity: 1,
        createdAt: 0,
        bbox: { minX: 50, minY: 50, maxX: 60, maxY: 60 },
      };
      engine.setElements([stroke]);
      expect(engine.getElements()).toHaveLength(1);

      engine.setTool('eraser');
      const activeCanvas = container.querySelector('.page-anchor-active-canvas') as HTMLCanvasElement;

      activeCanvas.dispatchEvent(
        new PointerEvent('pointerdown', { clientX: 55, clientY: 55, button: 0, pointerId: 1 })
      );

      // The stroke is gone from the canvas immediately...
      expect(engine.getElements()).toHaveLength(0);
      // ...but the change is reported once the sweep ends, so the whole sweep
      // costs a single undo step.
      expect(mockChange).not.toHaveBeenCalled();

      window.dispatchEvent(
        new PointerEvent('pointerup', { clientX: 55, clientY: 55, pointerId: 1 })
      );

      expect(mockChange).toHaveBeenCalledTimes(1);
      expect(mockChange).toHaveBeenCalledWith([]);
    });
  });

  describe('Marquee Selection & Multi-Item Interactions', () => {
    it('selects elements within marquee rectangle drag', () => {
      const rect1: ShapeElement = {
        id: 'r1',
        type: 'rect',
        startX: 20,
        startY: 20,
        endX: 40,
        endY: 40,
        strokeColor: '#000',
        strokeWidth: 2,
        opacity: 1,
        createdAt: 0,
        bbox: { minX: 20, minY: 20, maxX: 40, maxY: 40 },
      };
      const rect2: ShapeElement = {
        id: 'r2',
        type: 'rect',
        startX: 200,
        startY: 200,
        endX: 250,
        endY: 250,
        strokeColor: '#000',
        strokeWidth: 2,
        opacity: 1,
        createdAt: 0,
        bbox: { minX: 200, minY: 200, maxX: 250, maxY: 250 },
      };

      engine.setElements([rect1, rect2]);
      engine.setTool('select');

      const activeCanvas = container.querySelector('.page-anchor-active-canvas') as HTMLCanvasElement;

      activeCanvas.dispatchEvent(
        new PointerEvent('pointerdown', { clientX: 10, clientY: 10, button: 0, pointerId: 1 })
      );
      window.dispatchEvent(
        new PointerEvent('pointermove', { clientX: 60, clientY: 60, pointerId: 1 })
      );
      window.dispatchEvent(
        new PointerEvent('pointerup', { clientX: 60, clientY: 60, pointerId: 1 })
      );

      const selected = engine.getSelectedElements();
      expect(selected).toHaveLength(1);
      expect(selected[0].id).toBe('r1');
    });

    it('clears selection when clicking empty space', () => {
      engine.selectAll();
      expect(engine.getSelectedElements().length).toBeGreaterThanOrEqual(0);

      engine.setTool('select');
      const activeCanvas = container.querySelector('.page-anchor-active-canvas') as HTMLCanvasElement;

      activeCanvas.dispatchEvent(
        new PointerEvent('pointerdown', { clientX: 999, clientY: 999, button: 0, pointerId: 1 })
      );
      window.dispatchEvent(
        new PointerEvent('pointerup', { clientX: 999, clientY: 999, pointerId: 1 })
      );

      expect(engine.getSelectedElements()).toHaveLength(0);
    });

    it('selects a shape by clicking inside it, not only on its outline', () => {
      const rect: ShapeElement = {
        id: 'r1',
        type: 'rect',
        startX: 20,
        startY: 20,
        endX: 120,
        endY: 120,
        strokeColor: '#000',
        strokeWidth: 2,
        opacity: 1,
        createdAt: 0,
        bbox: { minX: 15, minY: 15, maxX: 125, maxY: 125 },
      };
      engine.setElements([rect]);
      engine.setTool('select');

      const activeCanvas = container.querySelector('.page-anchor-active-canvas') as HTMLCanvasElement;
      activeCanvas.dispatchEvent(
        new PointerEvent('pointerdown', { clientX: 70, clientY: 70, button: 0, pointerId: 1 })
      );
      window.dispatchEvent(
        new PointerEvent('pointerup', { clientX: 70, clientY: 70, pointerId: 1 })
      );

      expect(engine.getSelectedElements().map((el) => el.id)).toEqual(['r1']);
    });

    it('does not record an undo step for a click that only selects an element', () => {
      const rect: ShapeElement = {
        id: 'r1',
        type: 'rect',
        startX: 20,
        startY: 20,
        endX: 120,
        endY: 120,
        strokeColor: '#000',
        strokeWidth: 2,
        opacity: 1,
        createdAt: 0,
        bbox: { minX: 15, minY: 15, maxX: 125, maxY: 125 },
      };
      engine.setElements([rect]);
      engine.setTool('select');
      mockChange.mockClear();

      const activeCanvas = container.querySelector('.page-anchor-active-canvas') as HTMLCanvasElement;
      activeCanvas.dispatchEvent(
        new PointerEvent('pointerdown', { clientX: 70, clientY: 70, button: 0, pointerId: 1 })
      );
      window.dispatchEvent(
        new PointerEvent('pointerup', { clientX: 70, clientY: 70, pointerId: 1 })
      );

      // Selecting is not an edit, so nothing was reported as changed.
      expect(mockChange).not.toHaveBeenCalled();
    });
  });

  describe('DOM Anchoring & Orphaned Anchor Modes', () => {
    it('configures DOM anchoring and orphaned modes (hide vs dimmed)', () => {
      expect(engine.getDomAnchoringEnabled()).toBe(true);
      engine.setDomAnchoringEnabled(false);
      expect(engine.getDomAnchoringEnabled()).toBe(false);

      expect(engine.getOrphanedAnchorMode()).toBe('hide');
      engine.setOrphanedAnchorMode('dimmed');
      expect(engine.getOrphanedAnchorMode()).toBe('dimmed');
    });

    it('renders text annotations with custom background and font properties', () => {
      const text: TextElement = {
        id: 'txt-1',
        type: 'text',
        x: 50,
        y: 50,
        text: 'Multi\nLine\nAnnotation',
        fontSize: 16,
        fontColor: '#ffffff',
        bgColor: '#1e293b',
        strokeColor: '#ffffff',
        strokeWidth: 1,
        opacity: 1,
        createdAt: 0,
        bbox: { minX: 50, minY: 50, maxX: 150, maxY: 110 },
      };

      engine.setElements([text]);
      expect(() => engine.renderBase()).not.toThrow();
    });
  });

  describe('Lifecycle and Teardown', () => {
    it('properly destroys canvases and unbinds on destroy()', () => {
      engine.destroy();
      expect(container.querySelectorAll('canvas')).toHaveLength(0);
    });
  });

  describe('Review regressions', () => {
    const canvasOf = () => container.querySelector('.page-anchor-active-canvas') as HTMLCanvasElement;
    const down = (x: number, y: number, pointerId = 1) =>
      canvasOf().dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, button: 0, pointerId }));
    const move = (x: number, y: number, pointerId = 1) =>
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, pointerId }));
    const up = (x: number, y: number, pointerId = 1) =>
      window.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y, pointerId }));

    const rectAt = (id: string, x: number, y: number, extra: Partial<ShapeElement> = {}): ShapeElement => ({
      id,
      type: 'rect',
      startX: x,
      startY: y,
      endX: x + 60,
      endY: y + 40,
      strokeColor: '#000',
      strokeWidth: 2,
      opacity: 1,
      createdAt: 0,
      bbox: { minX: x - 5, minY: y - 5, maxX: x + 65, maxY: y + 45 },
      ...extra,
    });

    const peek = <T,>(key: string): T => (engine as unknown as Record<string, T>)[key];

    afterEach(() => {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });

    it('keeps an anchored element where it was dropped instead of jumping back by the anchor offset', () => {
      const target = document.createElement('div');
      target.id = 'drop-anchor-target';
      let top = 200;
      target.getBoundingClientRect = () =>
        ({ left: 100, top, width: 400, height: 50, right: 500, bottom: top + 50, x: 100, y: top, toJSON: () => ({}) }) as DOMRect;
      document.body.appendChild(target);

      const rect = rectAt('anchored', 120, 210, { anchor: createDOMAnchor(target) });
      engine.setElements([rect]);
      top = 280;
      engine.setDomAnchoringEnabled(true);

      const effBefore = engine.getElementEffectiveBBox(engine.getElements()[0]).bbox;
      expect(effBefore.minY).toBe(rect.bbox.minY + 80);

      engine.setTool('select');
      down(150, 300);
      move(170, 305);
      up(170, 305);

      const after = engine.getElements()[0];
      const effAfter = engine.getElementEffectiveBBox(after).bbox;
      expect(effAfter.minX).toBe(effBefore.minX + 20);
      expect(effAfter.minY).toBe(effBefore.minY + 5);
      expect(mockChange).toHaveBeenCalledTimes(1);
      target.remove();
    });

    it('ignores a second pointer while a stroke is in progress', () => {
      vi.stubGlobal('requestAnimationFrame', () => 1);
      engine.setTool('pen');
      down(10, 10, 1);
      down(400, 400, 2);
      move(410, 410, 2);
      up(410, 410, 2);
      expect(engine.getElements()).toHaveLength(0);

      move(40, 10, 1);
      up(40, 10, 1);

      const strokes = engine.getElements() as StrokeElement[];
      expect(strokes).toHaveLength(1);
      expect(strokes[0].points.every((p) => p.x <= 40 && p.y === 10)).toBe(true);
    });

    it('recovers when the same pointer is pressed again after a lost pointerup', () => {
      engine.setTool('rect');
      down(10, 10);
      down(100, 100);
      move(200, 200);
      up(200, 200);
      const rects = engine.getElements() as ShapeElement[];
      expect(rects).toHaveLength(1);
      expect(rects[0].startX).toBe(100);
    });

    it('switching tool mid-stroke discards the half-drawn stroke and its gesture state', () => {
      engine.setTool('pen');
      down(10, 10);
      move(50, 50);
      engine.setTool('rect');
      move(80, 80);
      up(80, 80);
      expect(engine.getElements()).toHaveLength(0);
      expect(peek<unknown[]>('currentStrokePoints')).toHaveLength(0);
      expect(peek<boolean>('isPointerDown')).toBe(false);
    });

    it('switching tool mid-shape does not commit the shape on the next pointerup', () => {
      engine.setTool('rect');
      down(10, 10);
      move(120, 120);
      engine.setTool('circle');
      up(120, 120);
      expect(engine.getElements()).toHaveLength(0);
      expect(peek<unknown>('currentShape')).toBeNull();
    });

    it('setElements and setActiveMode(false) mid-gesture reset the gesture', () => {
      engine.setTool('rect');
      down(10, 10);
      move(120, 120);
      engine.setElements([]);
      up(120, 120);
      expect(engine.getElements()).toHaveLength(0);

      engine.setTool('pen');
      down(10, 10);
      move(60, 60);
      engine.setActiveMode(false);
      engine.setActiveMode(true);
      up(60, 60);
      expect(engine.getElements()).toHaveLength(0);
      expect(mockChange).not.toHaveBeenCalled();
    });

    it('switching tool mid-drag still records the move', () => {
      engine.setElements([rectAt('r', 100, 100)]);
      engine.setDomAnchoringEnabled(false);
      engine.setTool('select');
      down(120, 120);
      move(150, 120);
      engine.setTool('pen');
      expect(mockChange).toHaveBeenCalledTimes(1);
      expect((engine.getElements()[0] as ShapeElement).startX).toBe(130);
      up(150, 120);
      expect(mockChange).toHaveBeenCalledTimes(1);
    });

    it('a click on empty space in select mode leaves no marquee state behind', () => {
      engine.setTool('select');
      down(900, 700);
      up(900, 700);
      expect(peek<boolean>('isMarqueeSelecting')).toBe(false);
      expect(peek<unknown>('marqueeStartPoint')).toBeNull();
    });

    it('elements in history snapshots are never mutated by a drag', () => {
      const history = new HistoryManager([]);
      const rect = rectAt('r', 100, 100);
      history.reset([rect]);
      engine.setElements([rect]);
      engine.setDomAnchoringEnabled(false);
      engine.setTool('select');
      down(120, 120);
      move(160, 140);
      up(160, 140);
      expect((engine.getElements()[0] as ShapeElement).startX).toBe(140);
      expect(rect.startX).toBe(100);
      expect(rect.bbox.minX).toBe(95);
    });

    it('measures text boxes when elements are loaded, without mutating the input', () => {
      const text: TextElement = {
        id: 't-long',
        type: 'text',
        x: 50,
        y: 5000,
        text: 'A long note far below the fold\nsecond line',
        fontSize: 20,
        fontColor: '#fff',
        strokeColor: '#fff',
        strokeWidth: 1,
        opacity: 1,
        createdAt: 0,
        bbox: { minX: 46, minY: 4996, maxX: 174, maxY: 5040 },
      };
      engine.setElements([text]);
      const loaded = engine.getElements()[0] as TextElement;
      expect(loaded.width).toBeGreaterThan(120);
      expect(loaded.height).toBeGreaterThan(36);
      expect(loaded.bbox.maxX).toBe(loaded.x + loaded.width! + 4);
      expect(loaded.bbox.maxY).toBe(loaded.y + loaded.height! + 4);
      expect(text.width).toBeUndefined();
      expect(text.bbox.maxX).toBe(174);
    });

    it('measures text added through addElement', () => {
      const text: TextElement = {
        id: 't-new',
        type: 'text',
        x: 10,
        y: 10,
        text: 'Hello there, this is a fairly long annotation',
        fontSize: 18,
        fontColor: '#fff',
        strokeColor: '#fff',
        strokeWidth: 1,
        opacity: 1,
        createdAt: 0,
        bbox: { minX: 6, minY: 6, maxX: 134, maxY: 50 },
      };
      engine.setDomAnchoringEnabled(false);
      engine.addElement(text);
      const added = engine.getElements()[0] as TextElement;
      expect(added.width).toBeGreaterThan(120);
      expect(added.bbox.maxX).toBe(10 + added.width! + 4);
    });

    it('sizes the canvases to the root client box so page scrollbars stay uncovered', () => {
      engine.destroy();
      Object.defineProperty(document.documentElement, 'clientWidth', { value: 1009, configurable: true });
      Object.defineProperty(document.documentElement, 'clientHeight', { value: 700, configurable: true });
      engine = new CanvasEngine(container, { onElementsChange: mockChange });
      const base = container.querySelector('.page-anchor-base-canvas') as HTMLCanvasElement;
      expect(base.style.width).toBe('1009px');
      expect(base.style.height).toBe('700px');
      expect(canvasOf().style.width).toBe('1009px');
      expect(base.width).toBe(Math.round(1009 * Math.min(window.devicePixelRatio || 1, 2.5)));
      delete (document.documentElement as unknown as Record<string, unknown>).clientWidth;
      delete (document.documentElement as unknown as Record<string, unknown>).clientHeight;
    });

    it('destroy() removes every window listener it added', () => {
      engine.destroy();
      const added: [string, unknown][] = [];
      const removed: [string, unknown][] = [];
      const realAdd = window.addEventListener.bind(window);
      const realRemove = window.removeEventListener.bind(window);
      vi.spyOn(window, 'addEventListener').mockImplementation(((type: string, fn: EventListenerOrEventListenerObject, opts?: AddEventListenerOptions) => {
        added.push([type, fn]);
        realAdd(type, fn, opts);
      }) as typeof window.addEventListener);
      vi.spyOn(window, 'removeEventListener').mockImplementation(((type: string, fn: EventListenerOrEventListenerObject) => {
        removed.push([type, fn]);
        realRemove(type, fn);
      }) as typeof window.removeEventListener);

      engine = new CanvasEngine(container, { onElementsChange: mockChange });
      // Only the engine's own handlers; the anchor manager tears down its listeners separately.
      const own: [string, unknown][] = [
        ['resize', peek('onResize')],
        ['pointermove', peek('onPointerMove')],
        ['pointerup', peek('onPointerUp')],
        ['pointercancel', peek('onPointerUp')],
      ];
      engine.destroy();

      for (const [type, fn] of own) {
        expect(added.some(([t, f]) => t === type && f === fn), `added ${type}`).toBe(true);
        expect(removed.some(([t, f]) => t === type && f === fn), `removed ${type}`).toBe(true);
      }
      expect(container.querySelectorAll('canvas')).toHaveLength(0);
    });

    it('re-renders when a scrolling pane scrolls and stops after destroy()', async () => {
      const pane = document.createElement('div');
      document.body.appendChild(pane);
      const render = vi.spyOn(engine, 'renderBase');
      pane.dispatchEvent(new Event('scroll'));
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      expect(render).toHaveBeenCalled();

      engine.destroy();
      render.mockClear();
      pane.dispatchEvent(new Event('scroll'));
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      expect(render).not.toHaveBeenCalled();
      pane.remove();
    });

    it('destroy() stops reacting to pointer events', () => {
      engine.setTool('rect');
      const canvas = canvasOf();
      engine.destroy();
      canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 10, clientY: 10, button: 0, pointerId: 1 }));
      move(100, 100);
      up(100, 100);
      expect(mockChange).not.toHaveBeenCalled();
    });

    it('an eraser tap removes only the hit element and reports once', () => {
      engine.setElements([rectAt('a', 10, 10), rectAt('b', 300, 300)]);
      engine.selectAll();
      engine.setTool('eraser');
      down(40, 30);
      up(40, 30);
      expect(engine.getElements().map((el: AnchorElement) => el.id)).toEqual(['b']);
      expect(mockChange).toHaveBeenCalledTimes(1);
    });
  });

  describe('Orphan dimming renders through to the canvas', () => {
    interface DrawCall {
      op: 'fill' | 'stroke';
      alpha: number;
    }

    function installRecordingContext(calls: DrawCall[]) {
      const makeCtx = () => {
        const stack: number[] = [];
        const state: Record<string | symbol, unknown> = { globalAlpha: 1 };
        const noop = () => {};
        return new Proxy(state, {
          get(target, prop) {
            if (prop === 'save') return () => stack.push(target.globalAlpha as number);
            if (prop === 'restore') return () => { target.globalAlpha = stack.pop() ?? 1; };
            if (prop === 'fill' || prop === 'stroke') return () => calls.push({ op: prop, alpha: target.globalAlpha as number });
            if (prop === 'measureText') return (t: string) => ({ width: t.length * 8 });
            if (prop in target) return target[prop];
            return noop;
          },
          set(target, prop, value) {
            target[prop] = value;
            return true;
          },
        }) as unknown as CanvasRenderingContext2D;
      };
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => makeCtx()) as unknown as HTMLCanvasElement['getContext']);
    }

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('draws orphaned elements at reduced alpha in dimmed mode and not at all in hide mode', () => {
      const calls: DrawCall[] = [];
      installRecordingContext(calls);
      engine.destroy();
      engine = new CanvasEngine(container, { onElementsChange: mockChange });

      const orphan: ShapeElement = {
        id: 'orphan',
        type: 'rect',
        startX: 20,
        startY: 20,
        endX: 120,
        endY: 80,
        strokeColor: '#000',
        strokeWidth: 2,
        opacity: 1,
        createdAt: 0,
        bbox: { minX: 15, minY: 15, maxX: 125, maxY: 85 },
        anchor: { selector: '#nowhere-to-be-found', initialRect: { left: 0, top: 0, width: 10, height: 10 } },
      };
      engine.setElements([orphan]);

      calls.length = 0;
      engine.setOrphanedAnchorMode('hide');
      expect(calls).toHaveLength(0);

      calls.length = 0;
      engine.setOrphanedAnchorMode('dimmed');
      const shapeStroke = calls.find((c) => c.op === 'stroke');
      expect(shapeStroke).toBeDefined();
      expect(shapeStroke!.alpha).toBeCloseTo(0.35);
    });

    it('dims an orphaned highlighter relative to its own opacity', () => {
      const calls: DrawCall[] = [];
      installRecordingContext(calls);
      engine.destroy();
      engine = new CanvasEngine(container, { onElementsChange: mockChange });
      engine.setOrphanedAnchorMode('dimmed');

      const highlighter: StrokeElement = {
        id: 'hl',
        type: 'highlighter',
        points: [{ x: 20, y: 20 }, { x: 120, y: 20 }],
        strokeColor: '#ff0',
        strokeWidth: 20,
        opacity: 0.35,
        createdAt: 0,
        bbox: { minX: 6, minY: 6, maxX: 134, maxY: 34 },
        anchor: { selector: '#nowhere-to-be-found', initialRect: { left: 0, top: 0, width: 10, height: 10 } },
      };
      calls.length = 0;
      engine.setElements([highlighter]);
      const fill = calls.find((c) => c.op === 'fill');
      expect(fill).toBeDefined();
      expect(fill!.alpha).toBeCloseTo(0.35 * 0.35);
    });
  });
});
