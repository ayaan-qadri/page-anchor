import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { CanvasEngine } from '../src/core/engine';
import { AnchorElement, StrokeElement, ShapeElement, TextElement } from '../src/types/engine.types';

describe('Selection & Move All Engine: Multi-Select and Batch Manipulation', () => {
  let container: HTMLElement;
  let engine: CanvasEngine;
  let mockChange: Mock<(elements: AnchorElement[]) => void>;

  const sampleStroke: StrokeElement = {
    id: 'stroke-1',
    type: 'pen',
    points: [{ x: 10, y: 10 }, { x: 20, y: 20 }, { x: 30, y: 30 }],
    strokeColor: '#ef4444',
    strokeWidth: 4,
    opacity: 1,
    createdAt: 1000,
    bbox: { minX: 10, minY: 10, maxX: 30, maxY: 30 },
  };

  const sampleRect: ShapeElement = {
    id: 'shape-rect-1',
    type: 'rect',
    startX: 50,
    startY: 50,
    endX: 100,
    endY: 80,
    strokeColor: '#3b82f6',
    strokeWidth: 2,
    opacity: 1,
    createdAt: 1001,
    bbox: { minX: 50, minY: 50, maxX: 100, maxY: 80 },
  };

  const sampleText: TextElement = {
    id: 'text-1',
    type: 'text',
    x: 200,
    y: 200,
    text: 'Annotated Note',
    fontSize: 16,
    fontColor: '#ffffff',
    strokeColor: '#ffffff',
    strokeWidth: 1,
    opacity: 1,
    createdAt: 1002,
    bbox: { minX: 200, minY: 200, maxX: 300, maxY: 230 },
  };

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    mockChange = vi.fn();
    engine = new CanvasEngine(container, {
      onElementsChange: mockChange,
    });
    engine.setActiveMode(true);
    engine.setElements([
      JSON.parse(JSON.stringify(sampleStroke)),
      JSON.parse(JSON.stringify(sampleRect)),
      JSON.parse(JSON.stringify(sampleText)),
    ]);
  });

  it('selectAll selects all elements on page and switches to select tool', () => {
    expect(engine.getSelectedElements()).toHaveLength(0);
    engine.selectAll();

    const selected = engine.getSelectedElements();
    expect(selected).toHaveLength(3);
    expect(engine.getTool()).toBe('select');
    expect(selected.map((el) => el.id)).toEqual(['stroke-1', 'shape-rect-1', 'text-1']);
  });

  it('moveAll shifts all elements across the page by (dx, dy) in unison', () => {
    engine.moveAll(25, 40);

    const elements = engine.getElements();
    const stroke = elements.find((el) => el.id === 'stroke-1') as StrokeElement;
    const rect = elements.find((el) => el.id === 'shape-rect-1') as ShapeElement;
    const text = elements.find((el) => el.id === 'text-1') as TextElement;

    expect(stroke.points[0]).toEqual({ x: 35, y: 50 });
    expect(stroke.points[2]).toEqual({ x: 55, y: 70 });
    expect(stroke.bbox.minX).toBeLessThan(35);
    expect(stroke.bbox.maxX).toBeGreaterThan(55);

    expect(rect.startX).toBe(75);
    expect(rect.startY).toBe(90);
    expect(rect.endX).toBe(125);
    expect(rect.endY).toBe(120);
    expect(rect.bbox.minX).toBe(70);

    expect(text.x).toBe(225);
    expect(text.y).toBe(240);

    expect(mockChange).toHaveBeenCalled();
  });

  it('keeps elements untouched mid-drag and applies the whole move once on drop', () => {
    engine.selectAll();
    engine.setDomAnchoringEnabled(false);
    const canvas = container.querySelector('.page-anchor-active-canvas') as HTMLCanvasElement;
    const before = engine.getElements();

    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 75, clientY: 65, button: 0, pointerId: 1 }));
    for (let i = 1; i <= 10; i++) {
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: 75 + i * 3, clientY: 65, pointerId: 1 }));
    }
    const mid = engine.getElements();
    expect(mid.every((el, i) => el === before[i])).toBe(true);
    expect(engine.getElementEffectiveBBox(mid[1]).bbox.minX).toBe(before[1].bbox.minX + 30);

    window.dispatchEvent(new PointerEvent('pointerup', { clientX: 105, clientY: 65, pointerId: 1 }));
    expect((engine.getElements()[1] as ShapeElement).startX).toBe(sampleRect.startX + 30);
    expect(mockChange).toHaveBeenCalledTimes(1);
  });

  it('moves all selected elements together when dragged', () => {
    engine.selectAll();
    expect(engine.getSelectedElements()).toHaveLength(3);

    const canvas = container.querySelector('.page-anchor-active-canvas') as HTMLCanvasElement;
    expect(canvas).not.toBeNull();
    engine.setDomAnchoringEnabled(false);
    const before = engine.getElements();

    // Press inside the rectangle, then drag everything by (50, -20).
    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 75, clientY: 65, button: 0, pointerId: 1 }));
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 125, clientY: 45, pointerId: 1 }));
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: 125, clientY: 45, pointerId: 1 }));

    const elements = engine.getElements();
    const stroke = elements.find((el) => el.id === 'stroke-1') as StrokeElement;
    const rect = elements.find((el) => el.id === 'shape-rect-1') as ShapeElement;
    const text = elements.find((el) => el.id === 'text-1') as TextElement;
    expect(stroke.points[0]).toEqual({ x: 60, y: -10 });
    expect(rect.startX).toBe(100);
    expect(text.y).toBe(180);
    expect(mockChange).toHaveBeenCalledTimes(1);

    // Moving produces new objects; the pre-drag elements are untouched.
    expect((before[0] as StrokeElement).points[0]).toEqual({ x: 10, y: 10 });
    expect(before[0]).not.toBe(stroke);
    expect(engine.getSelectedElements().map((el) => el.id)).toEqual(['stroke-1', 'shape-rect-1', 'text-1']);
    expect(engine.getSelectedElements()[0]).toBe(stroke);
  });

  it('moveAll does not mutate the element objects it was given', () => {
    const before = engine.getElements();
    engine.moveAll(10, 10);
    expect((before[1] as ShapeElement).startX).toBe(50);
    expect((engine.getElements()[1] as ShapeElement).startX).toBe(60);
  });

  it('selectAll skips orphaned elements hidden by the orphan mode', () => {
    const orphan: ShapeElement = {
      ...sampleRect,
      id: 'orphan-rect',
      anchor: { selector: '#definitely-missing-node', initialRect: { left: 0, top: 0, width: 10, height: 10 } },
    };
    engine.setElements([JSON.parse(JSON.stringify(sampleStroke)), orphan]);

    engine.setOrphanedAnchorMode('hide');
    engine.selectAll();
    expect(engine.getSelectedElements().map((el) => el.id)).toEqual(['stroke-1']);

    engine.setOrphanedAnchorMode('dimmed');
    engine.selectAll();
    expect(engine.getSelectedElements().map((el) => el.id)).toEqual(['stroke-1', 'orphan-rect']);

    // Switching back to hide drops the now-invisible orphan from the selection.
    engine.setOrphanedAnchorMode('hide');
    expect(engine.getSelectedElements().map((el) => el.id)).toEqual(['stroke-1']);
  });

  it('selectAll is a no-op when every element is a hidden orphan', () => {
    const orphan: ShapeElement = {
      ...sampleRect,
      anchor: { selector: '#definitely-missing-node', initialRect: { left: 0, top: 0, width: 10, height: 10 } },
    };
    engine.setElements([orphan]);
    engine.setTool('pen');
    engine.selectAll();
    expect(engine.getSelectedElements()).toHaveLength(0);
    expect(engine.getTool()).toBe('pen');
  });

  it('deleteSelected removes all selected elements in one batch', () => {
    engine.selectAll();
    expect(engine.getElements()).toHaveLength(3);

    engine.deleteSelected();
    expect(engine.getElements()).toHaveLength(0);
    expect(engine.getSelectedElements()).toHaveLength(0);
    expect(mockChange).toHaveBeenCalledWith([]);
  });

  it('clearSelection deselects elements without deleting them', () => {
    engine.selectAll();
    expect(engine.getSelectedElements()).toHaveLength(3);

    engine.clearSelection();
    expect(engine.getSelectedElements()).toHaveLength(0);
    expect(engine.getElements()).toHaveLength(3);
  });
});
