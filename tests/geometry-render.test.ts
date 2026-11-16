import { describe, it, expect, vi } from 'vitest';
import {
  getFreehandOutline,
  isPointNearElement,
  renderArrowHead,
  renderFreehandStroke,
  translateFreehandOutline,
} from '../src/core/geometry';
import { ShapeElement, TextElement, Point } from '../src/types/engine.types';

describe('Geometry Engine: Render Helpers and Missing Hit-Test Branches', () => {
  const createMockCtx = () => {
    return {
      lineWidth: 4,
      strokeStyle: '#000000',
      fillStyle: '#000000',
      arc: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      quadraticCurveTo: vi.fn(),
      beginPath: vi.fn(),
      closePath: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
  };

  describe('renderFreehandStroke', () => {
    it('handles empty points array gracefully', () => {
      const ctx = createMockCtx();
      renderFreehandStroke(ctx, []);
      expect(ctx.moveTo).not.toHaveBeenCalled();
      expect(ctx.fill).not.toHaveBeenCalled();
    });

    it('renders single point as a filled circular dot', () => {
      const ctx = createMockCtx();
      renderFreehandStroke(ctx, [{ x: 40, y: 50 }], { size: 6 });
      expect(ctx.beginPath).toHaveBeenCalled();
      expect(ctx.arc).toHaveBeenCalledWith(40, 50, 3, 0, Math.PI * 2);
      expect(ctx.fill).toHaveBeenCalled();
    });

    it('renders multiple points as a smooth outline polygon with curves and fill', () => {
      const ctx = createMockCtx();
      const points: Point[] = [
        { x: 10, y: 10 },
        { x: 40, y: 30 },
        { x: 80, y: 20 },
        { x: 120, y: 60 },
      ];
      renderFreehandStroke(ctx, points, {
        size: 4,
        thinning: 0.35,
        smoothing: 0.65,
        streamline: 0.55,
      });
      expect(ctx.beginPath).toHaveBeenCalled();
      expect(ctx.moveTo).toHaveBeenCalled();
      expect(ctx.quadraticCurveTo).toHaveBeenCalled();
      expect(ctx.closePath).toHaveBeenCalled();
      expect(ctx.fill).toHaveBeenCalled();
    });

    it('supports uniform-width highlighter configuration', () => {
      const ctx = createMockCtx();
      const points: Point[] = [
        { x: 20, y: 50 },
        { x: 100, y: 50 },
      ];
      renderFreehandStroke(ctx, points, {
        size: 20,
        thinning: 0,
        simulatePressure: false,
      });
      expect(ctx.beginPath).toHaveBeenCalled();
      expect(ctx.fill).toHaveBeenCalled();
    });
  });

  describe('freehand outline caching helpers', () => {
    const points: Point[] = [
      { x: 10, y: 10 },
      { x: 40, y: 30 },
      { x: 80, y: 20 },
    ];

    it('fills a precomputed outline instead of recomputing it', () => {
      const ctx = createMockCtx();
      const outline = [
        [1, 1],
        [5, 1],
        [5, 5],
      ];
      renderFreehandStroke(ctx, points, { size: 4 }, outline);
      expect(ctx.moveTo).toHaveBeenCalledWith(1, 1);
      expect(ctx.quadraticCurveTo).toHaveBeenCalledTimes(3);
      expect(ctx.fill).toHaveBeenCalledTimes(1);
    });

    it('produces a deterministic outline and translates it exactly', () => {
      const a = getFreehandOutline(points, { size: 4 });
      const b = getFreehandOutline(points, { size: 4 });
      expect(a.length).toBeGreaterThan(0);
      expect(a).toEqual(b);

      const moved = translateFreehandOutline(a, 7, -3);
      expect(moved).toHaveLength(a.length);
      expect(moved[0][0]).toBeCloseTo(a[0][0] + 7);
      expect(moved[0][1]).toBeCloseTo(a[0][1] - 3);
      expect(a[0]).toEqual(b[0]);
    });
  });

  describe('renderArrowHead', () => {
    it('draws a polygon arrow head pointing at specified angle', () => {
      const ctx = createMockCtx();
      renderArrowHead(ctx, 100, 100, 0, 15);
      expect(ctx.beginPath).toHaveBeenCalled();
      expect(ctx.moveTo).toHaveBeenCalledWith(100, 100);
      expect(ctx.lineTo).toHaveBeenCalledTimes(2);
      expect(ctx.closePath).toHaveBeenCalled();
      expect(ctx.fill).toHaveBeenCalled();
    });
  });

  describe('isPointNearElement - Circle & Ellipse', () => {
    it('hit-tests a zero-size circle as a point', () => {
      const circle: ShapeElement = {
        id: 'c1',
        type: 'circle',
        startX: 10,
        startY: 10,
        endX: 10,
        endY: 10,
        strokeColor: '#000',
        strokeWidth: 2,
        opacity: 1,
        createdAt: 0,
        bbox: { minX: 10, minY: 10, maxX: 10, maxY: 10 },
      };
      expect(isPointNearElement({ x: 10, y: 10 }, circle)).toBe(true);
      expect(isPointNearElement({ x: 40, y: 40 }, circle)).toBe(false);
    });

    it('hit-tests a flat ellipse (zero width or height) along its line', () => {
      const flat: ShapeElement = {
        id: 'c-flat',
        type: 'circle',
        startX: 100,
        startY: 50,
        endX: 100,
        endY: 250,
        strokeColor: '#000',
        strokeWidth: 2,
        opacity: 1,
        createdAt: 0,
        bbox: { minX: 95, minY: 45, maxX: 105, maxY: 255 },
      };
      expect(isPointNearElement({ x: 100, y: 150 }, flat)).toBe(true);
      expect(isPointNearElement({ x: 103, y: 60 }, flat)).toBe(true);
      expect(isPointNearElement({ x: 130, y: 150 }, flat)).toBe(false);

      const horizontal: ShapeElement = { ...flat, startX: 50, startY: 100, endX: 250, endY: 100, bbox: { minX: 45, minY: 95, maxX: 255, maxY: 105 } };
      expect(isPointNearElement({ x: 150, y: 100 }, horizontal)).toBe(true);
      expect(isPointNearElement({ x: 150, y: 130 }, horizontal)).toBe(false);
    });

    it('detects point on perimeter of unfilled circle', () => {
      const circle: ShapeElement = {
        id: 'c2',
        type: 'circle',
        startX: 0,
        startY: 0,
        endX: 100,
        endY: 100,
        strokeColor: '#000',
        strokeWidth: 4,
        opacity: 1,
        createdAt: 0,
        bbox: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
      };
      // Center is (50, 50), radius is 50. Point (50, 100) is right on bottom perimeter.
      expect(isPointNearElement({ x: 50, y: 100 }, circle, 6)).toBe(true);
      // The enclosed area belongs to the shape, so it is hit too.
      expect(isPointNearElement({ x: 50, y: 50 }, circle, 6)).toBe(true);
      expect(isPointNearElement({ x: 200, y: 200 }, circle, 6)).toBe(false);
    });

    it('detects point inside filled circle', () => {
      const circle: ShapeElement = {
        id: 'c3',
        type: 'circle',
        startX: 0,
        startY: 0,
        endX: 100,
        endY: 100,
        strokeColor: '#000',
        fillColor: '#ff0000',
        strokeWidth: 2,
        opacity: 1,
        createdAt: 0,
        bbox: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
      };
      // Center (50, 50) is inside filled circle
      expect(isPointNearElement({ x: 50, y: 50 }, circle)).toBe(true);
      expect(isPointNearElement({ x: 150, y: 150 }, circle)).toBe(false);
    });
  });

  describe('isPointNearElement - Filled Rectangles', () => {
    it('detects point anywhere inside filled rectangle', () => {
      const rect: ShapeElement = {
        id: 'r1',
        type: 'rect',
        startX: 50,
        startY: 50,
        endX: 150,
        endY: 150,
        strokeColor: '#000',
        fillColor: 'rgba(255, 0, 0, 0.5)',
        strokeWidth: 2,
        opacity: 1,
        createdAt: 0,
        bbox: { minX: 50, minY: 50, maxX: 150, maxY: 150 },
      };
      expect(isPointNearElement({ x: 100, y: 100 }, rect)).toBe(true);
      expect(isPointNearElement({ x: 40, y: 100 }, rect)).toBe(false);
    });
  });

  describe('isPointNearElement - Text Elements', () => {
    it('detects point within text bounds with specified width/height', () => {
      const text: TextElement = {
        id: 't1',
        type: 'text',
        x: 100,
        y: 100,
        width: 80,
        height: 30,
        text: 'Sample',
        fontSize: 16,
        fontColor: '#000',
        strokeColor: '#000',
        strokeWidth: 1,
        opacity: 1,
        createdAt: 0,
        bbox: { minX: 100, minY: 100, maxX: 180, maxY: 130 },
      };
      expect(isPointNearElement({ x: 140, y: 115 }, text)).toBe(true);
      expect(isPointNearElement({ x: 90, y: 115 }, text)).toBe(false);
      expect(isPointNearElement({ x: 190, y: 115 }, text)).toBe(false);
    });

    it('uses fallback dimensions (120x36) if width/height are undefined', () => {
      const text: TextElement = {
        id: 't2',
        type: 'text',
        x: 50,
        y: 50,
        text: 'Fallback',
        fontSize: 16,
        fontColor: '#000',
        strokeColor: '#000',
        strokeWidth: 1,
        opacity: 1,
        createdAt: 0,
        bbox: { minX: 50, minY: 50, maxX: 170, maxY: 86 },
      };
      expect(isPointNearElement({ x: 100, y: 60 }, text)).toBe(true);
      expect(isPointNearElement({ x: 180, y: 60 }, text)).toBe(false);
    });

    it('returns false for unknown element type', () => {
      const unknownEl = {
        id: 'u1',
        type: 'unknown-type' as any,
        bbox: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      } as any;
      expect(isPointNearElement({ x: 5, y: 5 }, unknownEl)).toBe(false);
    });
  });
});
