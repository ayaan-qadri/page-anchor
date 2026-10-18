import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CanvasEngine } from '../src/core/engine';
import { StrokeElement, ShapeElement, TextElement } from '../src/types/engine.types';

describe('CanvasEngine: Drawing, Tooling, Shapes, Eraser, & Pointer Engine', () => {
  let container: HTMLElement;
  let engine: CanvasEngine;
  let mockChange: ReturnType<typeof vi.fn>;
  let mockSelection: ReturnType<typeof vi.fn>;
  let mockTextRequest: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);

    mockChange = vi.fn();
    mockSelection = vi.fn();
    mockTextRequest = vi.fn();

    engine = new CanvasEngine(container, {
      onElementsChange: mockChange,
      onSelectionChange: mockSelection,
      onTextCreateRequested: mockTextRequest,
    });
    engine.setActiveMode(true);
  });

  afterEach(() => {
    engine.destroy();
    container.remove();
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

    it('toggles the performance mode (culling + RDP decimation) flag', () => {
      expect(engine.getPerformanceMode()).toBe(true);
      engine.setPerformanceMode(false);
      expect(engine.getPerformanceMode()).toBe(false);
      expect(() => engine.renderBase()).not.toThrow();
      engine.setPerformanceMode(true);
      expect(engine.getPerformanceMode()).toBe(true);
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

      expect(engine.getElements()).toHaveLength(0);
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
      expect(mockSelection).toHaveBeenCalledWith(selected[0], selected);
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

    it('exports canvas snapshot as a data URL', () => {
      const url = engine.exportAsDataUrl();
      expect(url).toMatch(/^data:image\/png;base64/);
    });
  });

  describe('Lifecycle and Teardown', () => {
    it('properly destroys canvases and unbinds on destroy()', () => {
      engine.destroy();
      expect(container.querySelectorAll('canvas')).toHaveLength(0);
    });
  });
});
