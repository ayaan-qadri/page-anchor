import { describe, it, expect } from 'vitest';
import {
  computeBoundingBox,
  distToSegmentSquared,
  intersectsBoundingBox,
  isPointInBoundingBox,
  isPointNearElement,
  simplifyPointsRDP,
} from '../src/core/geometry';
import { AnchorElement, BoundingBox, Point, StrokeElement, ShapeElement, TextElement } from '../src/types/engine.types';

describe('Geometry Engine: Bounding Box & Frustum Culling', () => {
  it('correctly detects intersecting bounding boxes for viewport frustum culling', () => {
    const viewport: BoundingBox = { minX: 0, minY: 0, maxX: 1920, maxY: 1080 };

    const inside: BoundingBox = { minX: 100, minY: 100, maxX: 300, maxY: 300 };
    expect(intersectsBoundingBox(inside, viewport)).toBe(true);

    const overlapping: BoundingBox = { minX: -50, minY: -50, maxX: 50, maxY: 50 };
    expect(intersectsBoundingBox(overlapping, viewport)).toBe(true);

    const below: BoundingBox = { minX: 100, minY: 1200, maxX: 300, maxY: 1400 };
    expect(intersectsBoundingBox(below, viewport)).toBe(false);

    const toRight: BoundingBox = { minX: 2000, minY: 100, maxX: 2200, maxY: 300 };
    expect(intersectsBoundingBox(toRight, viewport)).toBe(false);

    const touching: BoundingBox = { minX: 1920, minY: 0, maxX: 2000, maxY: 100 };
    expect(intersectsBoundingBox(touching, viewport)).toBe(true);
  });

  it('computes accurate bounding box for freehand stroke', () => {
    const stroke: StrokeElement = {
      id: 'test-1',
      type: 'pen',
      strokeColor: '#ef4444',
      strokeWidth: 4,
      opacity: 1,
      createdAt: 1000,
      points: [
        { x: 10, y: 20 },
        { x: 50, y: 80 },
        { x: 30, y: 120 },
      ],
      bbox: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    };

    const bbox = computeBoundingBox(stroke);
    expect(bbox.minX).toBe(4);
    expect(bbox.maxX).toBe(56);
    expect(bbox.minY).toBe(14);
    expect(bbox.maxY).toBe(126);
  });

  it('computes accurate bounding box for inverted drag shapes (dragged up & left)', () => {
    const rect: ShapeElement = {
      id: 'test-rect',
      type: 'rect',
      startX: 300,
      startY: 400,
      endX: 100,
      endY: 200,
      strokeColor: '#000000',
      strokeWidth: 4,
      opacity: 1,
      createdAt: 1000,
      bbox: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    };

    const bbox = computeBoundingBox(rect);
    expect(bbox.minX).toBe(94);
    expect(bbox.maxX).toBe(306);
    expect(bbox.minY).toBe(194);
    expect(bbox.maxY).toBe(406);
  });

  it('computes accurate bounding box for text element', () => {
    const text: TextElement = {
      id: 'test-text',
      type: 'text',
      x: 100,
      y: 150,
      text: 'Hello World',
      fontSize: 16,
      fontColor: '#ffffff',
      width: 140,
      height: 40,
      strokeColor: '#ffffff',
      strokeWidth: 1,
      opacity: 1,
      createdAt: 1000,
      bbox: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    };

    const bbox = computeBoundingBox(text);
    expect(bbox.minX).toBe(96);
    expect(bbox.minY).toBe(146);
    expect(bbox.maxX).toBe(244);
    expect(bbox.maxY).toBe(194);
  });
});

describe('Geometry Engine: Point-to-Element Hit Testing', () => {
  it('correctly tests distance from point to segment', () => {
    const v: Point = { x: 0, y: 0 };
    const w: Point = { x: 10, y: 0 };

    expect(distToSegmentSquared({ x: 5, y: 0 }, v, w)).toBe(0);
    expect(distToSegmentSquared({ x: 5, y: 3 }, v, w)).toBe(9);
    expect(distToSegmentSquared({ x: 14, y: 0 }, v, w)).toBe(16);
    expect(distToSegmentSquared({ x: -3, y: 4 }, v, w)).toBe(25);
  });

  it('detects hits on freehand strokes accurately and rejects non-hits quickly', () => {
    const stroke: StrokeElement = {
      id: 's1',
      type: 'pen',
      strokeColor: '#3b82f6',
      strokeWidth: 6,
      opacity: 1,
      createdAt: 1000,
      points: [
        { x: 100, y: 100 },
        { x: 200, y: 100 },
        { x: 200, y: 200 },
      ],
      bbox: { minX: 93, minY: 93, maxX: 207, maxY: 207 },
    };

    expect(isPointNearElement({ x: 150, y: 102 }, stroke)).toBe(true);
    expect(isPointNearElement({ x: 201, y: 150 }, stroke)).toBe(true);
    expect(isPointNearElement({ x: 150, y: 150 }, stroke)).toBe(false);
    expect(isPointNearElement({ x: 500, y: 500 }, stroke)).toBe(false);
  });

  it('detects hits on rectangle boundaries and filled rectangles', () => {
    const rectOutlined: ShapeElement = {
      id: 'r1',
      type: 'rect',
      startX: 50,
      startY: 50,
      endX: 150,
      endY: 150,
      strokeColor: '#000',
      strokeWidth: 2,
      opacity: 1,
      createdAt: 1000,
      bbox: { minX: 45, minY: 45, maxX: 155, maxY: 155 },
    };

    expect(isPointNearElement({ x: 100, y: 51 }, rectOutlined)).toBe(true);
    expect(isPointNearElement({ x: 100, y: 100 }, rectOutlined)).toBe(false);

    const rectFilled: ShapeElement = { ...rectOutlined, fillColor: 'rgba(255,0,0,0.5)' };
    expect(isPointNearElement({ x: 100, y: 100 }, rectFilled)).toBe(true);
  });
});

describe('Geometry Engine: Ramer-Douglas-Peucker (RDP) Point Simplification', () => {
  it('handles edge cases with 0, 1, or 2 points', () => {
    expect(simplifyPointsRDP([])).toEqual([]);
    expect(simplifyPointsRDP([{ x: 10, y: 10 }])).toEqual([{ x: 10, y: 10 }]);
    expect(
      simplifyPointsRDP([
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ])
    ).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ]);
  });

  it('compresses 100 collinear points down to exactly 2 endpoints', () => {
    const straightLine: Point[] = [];
    for (let i = 0; i < 100; i++) {
      straightLine.push({ x: i * 5, y: i * 5 });
    }

    const simplified = simplifyPointsRDP(straightLine, 1.0);
    expect(simplified.length).toBe(2);
    expect(simplified[0]).toEqual({ x: 0, y: 0 });
    expect(simplified[1]).toEqual({ x: 495, y: 495 });
  });

  it('preserves sharp corners while filtering micro-noise', () => {
    const path: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0.1 },
      { x: 20, y: -0.1 },
      { x: 30, y: 0.2 },
      { x: 50, y: 0 },
      { x: 50, y: 50 },
      { x: 100, y: 50 },
    ];

    const simplified = simplifyPointsRDP(path, 1.0);
    expect(simplified.length).toBeLessThan(path.length);
    expect(simplified.some((p) => p.x === 50 && p.y === 0)).toBe(true);
    expect(simplified.some((p) => p.x === 50 && p.y === 50)).toBe(true);
  });
});
