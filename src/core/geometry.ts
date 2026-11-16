import { getStroke, StrokeOptions } from 'perfect-freehand';
import { AnchorElement, BoundingBox, Point, ShapeElement, ToolType } from '../types/engine.types';

const SHAPE_TYPES: ReadonlySet<ToolType> = new Set<ToolType>(['rect', 'circle', 'line', 'arrow', 'double-arrow']);

export function isShapeType(type: ToolType): type is ShapeElement['type'] {
  return SHAPE_TYPES.has(type);
}

export function isShapeElement(el: AnchorElement): el is ShapeElement {
  return isShapeType(el.type);
}

/**
 * Fast Axis-Aligned Bounding Box (AABB) intersection check.
 * Crucial for Viewport Frustum Culling on low-end devices.
 */
export function intersectsBoundingBox(a: BoundingBox, b: BoundingBox): boolean {
  return !(
    a.maxX < b.minX ||
    a.minX > b.maxX ||
    a.maxY < b.minY ||
    a.minY > b.maxY
  );
}

export function isPointInBoundingBox(pt: Point, bbox: BoundingBox, padding = 4): boolean {
  return (
    pt.x >= bbox.minX - padding &&
    pt.x <= bbox.maxX + padding &&
    pt.y >= bbox.minY - padding &&
    pt.y <= bbox.maxY + padding
  );
}

/**
 * Computes tight bounding box for any element including stroke padding.
 */
export function computeBoundingBox(element: AnchorElement): BoundingBox {
  const halfWidth = (element.strokeWidth || 2) / 2 + 4;

  if (element.type === 'pen' || element.type === 'highlighter') {
    const stroke = element;
    if (!stroke.points || stroke.points.length === 0) {
      return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    }
    let minX = stroke.points[0].x;
    let maxX = stroke.points[0].x;
    let minY = stroke.points[0].y;
    let maxY = stroke.points[0].y;

    for (let i = 1; i < stroke.points.length; i++) {
      const p = stroke.points[i];
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }

    return {
      minX: minX - halfWidth,
      minY: minY - halfWidth,
      maxX: maxX + halfWidth,
      maxY: maxY + halfWidth,
    };
  }

  if (isShapeElement(element)) {
    const minX = Math.min(element.startX, element.endX) - halfWidth;
    const maxX = Math.max(element.startX, element.endX) + halfWidth;
    const minY = Math.min(element.startY, element.endY) - halfWidth;
    const maxY = Math.max(element.startY, element.endY) + halfWidth;
    return { minX, minY, maxX, maxY };
  }

  if (element.type === 'text') {
    const w = element.width || 120;
    const h = element.height || 36;
    return {
      minX: element.x - 4,
      minY: element.y - 4,
      maxX: element.x + w + 4,
      maxY: element.y + h + 4,
    };
  }

  return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
}

/**
 * Calculates squared perpendicular distance from point P to line segment AB.
 */
export function distToSegmentSquared(p: Point, v: Point, w: Point): number {
  const l2 = (v.x - w.x) * (v.x - w.x) + (v.y - w.y) * (v.y - w.y);
  if (l2 === 0) {
    return (p.x - v.x) * (p.x - v.x) + (p.y - v.y) * (p.y - v.y);
  }
  let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  const projX = v.x + t * (w.x - v.x);
  const projY = v.y + t * (w.y - v.y);
  return (p.x - projX) * (p.x - projX) + (p.y - projY) * (p.y - projY);
}

/**
 * Ramer-Douglas-Peucker (RDP) algorithm to simplify polyline points.
 * Drastically reduces memory and persistence payload size without quality degradation.
 */
export function simplifyPointsRDP(points: Point[], epsilon = 1.2): Point[] {
  const len = points.length;
  if (len <= 2) return points;

  const sqEpsilon = epsilon * epsilon;
  const keep = new Uint8Array(len);
  keep[0] = 1;
  keep[len - 1] = 1;

  const stack: [number, number][] = [[0, len - 1]];

  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    let maxDistSq = 0;
    let maxIndex = 0;

    for (let i = start + 1; i < end; i++) {
      const distSq = distToSegmentSquared(points[i], points[start], points[end]);
      if (distSq > maxDistSq) {
        maxDistSq = distSq;
        maxIndex = i;
      }
    }

    if (maxDistSq > sqEpsilon) {
      keep[maxIndex] = 1;
      if (maxIndex - start > 1) stack.push([start, maxIndex]);
      if (end - maxIndex > 1) stack.push([maxIndex, end]);
    }
  }

  const result: Point[] = [];
  for (let i = 0; i < len; i++) {
    if (keep[i] === 1) result.push(points[i]);
  }
  return result;
}

export function isPointNearElement(pt: Point, element: AnchorElement, threshold = 8): boolean {
  if (!isPointInBoundingBox(pt, element.bbox, threshold)) {
    return false;
  }

  const effThreshold = Math.max(threshold, (element.strokeWidth || 2) / 2 + 4);
  const effThreshSq = effThreshold * effThreshold;

  if (element.type === 'pen' || element.type === 'highlighter') {
    const pts = element.points;
    if (pts.length === 1) {
      const d2 = (pt.x - pts[0].x) ** 2 + (pt.y - pts[0].y) ** 2;
      return d2 <= effThreshSq;
    }
    for (let i = 0; i < pts.length - 1; i++) {
      if (distToSegmentSquared(pt, pts[i], pts[i + 1]) <= effThreshSq) {
        return true;
      }
    }
    return false;
  }

  if (element.type === 'line' || element.type === 'arrow' || element.type === 'double-arrow') {
    const v = { x: element.startX, y: element.startY };
    const w = { x: element.endX, y: element.endY };
    return distToSegmentSquared(pt, v, w) <= effThreshSq;
  }

  if (element.type === 'rect') {
    const minX = Math.min(element.startX, element.endX);
    const maxX = Math.max(element.startX, element.endX);
    const minY = Math.min(element.startY, element.endY);
    const maxY = Math.max(element.startY, element.endY);

    // The interior counts as part of the shape. A rectangle is a region the
    // user drew around something, so clicking inside it should select it
    // rather than falling through to whatever is behind.
    if (pt.x >= minX && pt.x <= maxX && pt.y >= minY && pt.y <= maxY) {
      return true;
    }

    const top = distToSegmentSquared(pt, { x: minX, y: minY }, { x: maxX, y: minY });
    const bottom = distToSegmentSquared(pt, { x: minX, y: maxY }, { x: maxX, y: maxY });
    const left = distToSegmentSquared(pt, { x: minX, y: minY }, { x: minX, y: maxY });
    const right = distToSegmentSquared(pt, { x: maxX, y: minY }, { x: maxX, y: maxY });

    return Math.min(top, bottom, left, right) <= effThreshSq;
  }

  if (element.type === 'circle') {
    const cx = (element.startX + element.endX) / 2;
    const cy = (element.startY + element.endY) / 2;
    const rx = Math.abs(element.endX - element.startX) / 2;
    const ry = Math.abs(element.endY - element.startY) / 2;

    // A flat ellipse renders as a line, so hit-test it as one.
    if (rx === 0 || ry === 0) {
      const v = { x: element.startX, y: element.startY };
      const w = { x: element.endX, y: element.endY };
      return distToSegmentSquared(pt, v, w) <= effThreshSq;
    }

    const normDist = ((pt.x - cx) / rx) ** 2 + ((pt.y - cy) / ry) ** 2;
    // As with rectangles, the enclosed area belongs to the shape.
    if (normDist <= 1.05) {
      return true;
    }
    const avgR = (rx + ry) / 2;
    const distToCenter = Math.sqrt((pt.x - cx) ** 2 + (pt.y - cy) ** 2);
    return Math.abs(distToCenter - avgR) <= effThreshold;
  }

  if (element.type === 'text') {
    const w = element.width || 120;
    const h = element.height || 36;
    return (
      pt.x >= element.x &&
      pt.x <= element.x + w &&
      pt.y >= element.y &&
      pt.y <= element.y + h
    );
  }

  return false;
}

export interface FreehandStrokeRenderOptions {
  size?: number;
  thinning?: number;
  smoothing?: number;
  streamline?: number;
  simulatePressure?: boolean;
}

/** Polygon outline of a freehand stroke, as produced by perfect-freehand. */
export type FreehandOutline = number[][];

export function getFreehandOutline(points: Point[], options?: FreehandStrokeRenderOptions): FreehandOutline {
  const strokeInput = points.map((p) => [p.x, p.y, p.pressure ?? 0.5]);
  const strokeOptions: StrokeOptions = {
    size: options?.size ?? 4,
    thinning: options?.thinning ?? 0.35,
    smoothing: options?.smoothing ?? 0.65,
    streamline: options?.streamline ?? 0.55,
    simulatePressure: options?.simulatePressure ?? true,
    start: { cap: true, taper: 0 },
    end: { cap: true, taper: 0 },
  };
  return getStroke(strokeInput, strokeOptions);
}

export function translateFreehandOutline(outline: FreehandOutline, dx: number, dy: number): FreehandOutline {
  return outline.map(([x, y]) => [x + dx, y + dy]);
}

export function fillFreehandOutline(ctx: CanvasRenderingContext2D, outline: FreehandOutline): void {
  if (outline.length === 0) return;
  ctx.beginPath();
  ctx.moveTo(outline[0][0], outline[0][1]);
  for (let i = 0; i < outline.length; i++) {
    const [x0, y0] = outline[i];
    const [x1, y1] = outline[(i + 1) % outline.length];
    ctx.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
  }
  ctx.closePath();
  ctx.fill();
}

/** A precomputed `outline` skips the perfect-freehand pass. */
export function renderFreehandStroke(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  options?: FreehandStrokeRenderOptions,
  outline?: FreehandOutline
): void {
  if (!points || points.length === 0) return;

  const size = options?.size ?? ctx.lineWidth ?? 4;

  if (points.length === 1) {
    ctx.beginPath();
    ctx.arc(points[0].x, points[0].y, size / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  fillFreehandOutline(ctx, outline ?? getFreehandOutline(points, { ...options, size }));
}

export function renderArrowHead(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  size: number
): void {
  const headAngle = Math.PI / 6;
  const x1 = x - size * Math.cos(angle - headAngle);
  const y1 = y - size * Math.sin(angle - headAngle);
  const x2 = x - size * Math.cos(angle + headAngle);
  const y2 = y - size * Math.sin(angle + headAngle);

  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.closePath();
  ctx.fillStyle = ctx.strokeStyle;
  ctx.fill();
}
