import { describe, it, expect, vi } from 'vitest';
import {
  isPointNearElement,
  renderArrowHead,
  renderSmoothSpline,
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

  describe('renderSmoothSpline', () => {
    it('handles empty points array gracefully', () => {
      const ctx = createMockCtx();
      renderSmoothSpline(ctx, []);
      expect(ctx.moveTo).not.toHaveBeenCalled();
      expect(ctx.stroke).not.toHaveBeenCalled();
    });

    it('renders single point as a filled dot', () => {
      const ctx = createMockCtx();
      renderSmoothSpline(ctx, [{ x: 50, y: 60 }]);
      expect(ctx.arc).toHaveBeenCalledWith(50, 60, 2, 0, Math.PI * 2);
      expect(ctx.fill).toHaveBeenCalled();
    });

    it('renders two points as a simple line segment', () => {
      const ctx = createMockCtx();
      renderSmoothSpline(ctx, [
        { x: 10, y: 10 },
        { x: 50, y: 50 },
      ]);
      expect(ctx.moveTo).toHaveBeenCalledWith(10, 10);
      expect(ctx.lineTo).toHaveBeenCalledWith(50, 50);
      expect(ctx.stroke).toHaveBeenCalled();
      expect(ctx.quadraticCurveTo).not.toHaveBeenCalled();
    });

    it('renders three or more points with quadratic bezier smoothing', () => {
      const ctx = createMockCtx();
      const points: Point[] = [
        { x: 0, y: 0 },
        { x: 20, y: 40 },
        { x: 60, y: 80 },
        { x: 100, y: 100 },
      ];
      renderSmoothSpline(ctx, points);
      expect(ctx.moveTo).toHaveBeenCalledWith(0, 0);
      expect(ctx.quadraticCurveTo).toHaveBeenCalled();
      expect(ctx.lineTo).toHaveBeenCalledWith(100, 100);
      expect(ctx.stroke).toHaveBeenCalled();
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
    it('returns false if circle has 0 radius', () => {
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
      expect(isPointNearElement({ x: 10, y: 10 }, circle)).toBe(false);
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
      // Point (50, 50) is the center (unfilled), should NOT hit perimeter
      expect(isPointNearElement({ x: 50, y: 50 }, circle, 6)).toBe(false);
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
