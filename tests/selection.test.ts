import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CanvasEngine } from '../src/core/engine';
import { AnchorElement, StrokeElement, ShapeElement, TextElement } from '../src/core/types';

describe('Selection & Move All Engine: Multi-Select and Batch Manipulation', () => {
  let container: HTMLElement;
  let engine: CanvasEngine;
  let mockChange: ReturnType<typeof vi.fn>;

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

    // Stroke points shifted
    expect(stroke.points[0]).toEqual({ x: 35, y: 50 });
    expect(stroke.points[2]).toEqual({ x: 55, y: 70 });
    expect(stroke.bbox.minX).toBeLessThan(35);
    expect(stroke.bbox.maxX).toBeGreaterThan(55);

    // Rect shifted
    expect(rect.startX).toBe(75);
    expect(rect.startY).toBe(90);
    expect(rect.endX).toBe(125);
    expect(rect.endY).toBe(120);
    expect(rect.bbox.minX).toBe(70);

    // Text shifted
    expect(text.x).toBe(225);
    expect(text.y).toBe(240);

    expect(mockChange).toHaveBeenCalled();
  });

  it('moves all selected elements together when dragged', () => {
    engine.selectAll();
    expect(engine.getSelectedElements()).toHaveLength(3);

    // Simulate pointer down on the selected group
    const canvas = container.querySelector('canvas:last-child') as HTMLCanvasElement;
    expect(canvas).not.toBeNull();

    // Move all selected by simulating a pointer drag
    // Call moveElement directly on all selected
    const selected = engine.getSelectedElements();
    const dx = 50;
    const dy = -20;

    // Direct drag simulation
    (engine as any).selectedElements.forEach((el: AnchorElement) => {
      (engine as any).moveElement(el, dx, dy);
    });

    const elements = engine.getElements();
    const stroke = elements.find((el) => el.id === 'stroke-1') as StrokeElement;
    expect(stroke.points[0]).toEqual({ x: 60, y: -10 });
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
