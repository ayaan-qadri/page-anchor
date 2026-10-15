import { AnchorElement, BoundingBox, Point, StrokeElement } from './types';

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
    const stroke = element as StrokeElement;
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

  if (
    element.type === 'rect' ||
    element.type === 'circle' ||
    element.type === 'line' ||
    element.type === 'arrow' ||
    element.type === 'double-arrow'
  ) {
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
  if (points.length <= 2) return points;

  let dmax = 0;
  let index = 0;
  const last = points.length - 1;

  for (let i = 1; i < last; i++) {
    const d = Math.sqrt(distToSegmentSquared(points[i], points[0], points[last]));
    if (d > dmax) {
      index = i;
      dmax = d;
    }
  }

  if (dmax > epsilon) {
    const recResults1 = simplifyPointsRDP(points.slice(0, index + 1), epsilon);
    const recResults2 = simplifyPointsRDP(points.slice(index), epsilon);
    return recResults1.slice(0, recResults1.length - 1).concat(recResults2);
  } else {
    return [points[0], points[last]];
  }
}

/**
 * Checks whether a test point touches or is near an element (for eraser or selection).
 */
export function isPointNearElement(pt: Point, element: AnchorElement, threshold = 8): boolean {
  // Quick AABB rejection
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

    if (element.fillColor) {
      return pt.x >= minX && pt.x <= maxX && pt.y >= minY && pt.y <= maxY;
    }

    // Check 4 edges
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

    if (rx === 0 || ry === 0) return false;

    // Normalized ellipse distance
    const normDist = ((pt.x - cx) / rx) ** 2 + ((pt.y - cy) / ry) ** 2;
    if (element.fillColor) {
      return normDist <= 1.05;
    }
    const outer = normDist;
    const inner = normDist;
    // Approximating boundary ring
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

/**
 * Draws smooth quadratic bezier spline across sampled points.
 */
export function renderSmoothSpline(ctx: CanvasRenderingContext2D, points: Point[]): void {
  if (points.length === 0) return;

  if (points.length === 1) {
    ctx.arc(points[0].x, points[0].y, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  if (points.length === 2) {
    ctx.moveTo(points[0].x, points[0].y);
    ctx.lineTo(points[1].x, points[1].y);
    ctx.stroke();
    return;
  }

  ctx.moveTo(points[0].x, points[0].y);

  for (let i = 1; i < points.length - 1; i++) {
    const p0 = points[i];
    const p1 = points[i + 1];
    const midX = (p0.x + p1.x) / 2;
    const midY = (p0.y + p1.y) / 2;
    ctx.quadraticCurveTo(p0.x, p0.y, midX, midY);
  }

  const last = points[points.length - 1];
  ctx.lineTo(last.x, last.y);
  ctx.stroke();
}

/**
 * Renders an arrow head at (x, y) pointing in angle direction.
 */
export function renderArrowHead(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  size: number
): void {
  const headAngle = Math.PI / 6; // 30 degrees
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
