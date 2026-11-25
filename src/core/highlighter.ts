import type { Point } from '../types/engine.types';

/** How a highlight mixes with the page: darkening on light backgrounds and lightening on dark ones keeps the text under it untouched. */
export type HighlightBlend = 'multiply' | 'screen';

export const DEFAULT_HIGHLIGHTER_INTENSITY = 50;
const MIN_OPACITY = 0.2;
const MAX_OPACITY = 1;

/** Highlights on dark backgrounds are drawn at this fraction of their strength, so light text on them keeps its contrast. */
export const DARK_BACKGROUND_STRENGTH = 0.5;

/** Even at full intensity the blend keeps text readable, so the whole range is usable. */
export function intensityToOpacity(intensity: number): number {
  const value = Number.isFinite(intensity) ? Math.min(100, Math.max(0, intensity)) : DEFAULT_HIGHLIGHTER_INTENSITY;
  return Math.round((MIN_OPACITY + (MAX_OPACITY - MIN_OPACITY) * (value / 100)) * 1000) / 1000;
}

const MIN_STRAIGHT_LENGTH = 24;
const LEVEL_SNAP_DEGREES = 12;

/**
 * Turns a roughly straight highlighter stroke into a clean two-point bar, levelled when close to horizontal.
 * Returns null for anything that is not a single straight sweep (curves, loops, scribbles), which stays freehand.
 */
export function straightenHighlight(points: readonly Point[]): Point[] | null {
  if (points.length < 2) return null;
  const start = points[0];
  const end = points[points.length - 1];
  const chord = Math.hypot(end.x - start.x, end.y - start.y);
  if (chord < MIN_STRAIGHT_LENGTH) return null;

  let pathLength = 0;
  let maxDeviation = 0;
  const ux = (end.x - start.x) / chord;
  const uy = (end.y - start.y) / chord;
  for (let i = 1; i < points.length; i++) {
    pathLength += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    const deviation = Math.abs((points[i].x - start.x) * uy - (points[i].y - start.y) * ux);
    if (deviation > maxDeviation) maxDeviation = deviation;
  }
  if (pathLength > chord * 1.2) return null;
  if (maxDeviation > Math.max(10, Math.min(40, chord * 0.1))) return null;

  const angle = (Math.atan2(end.y - start.y, end.x - start.x) * 180) / Math.PI;
  const fromHorizontal = Math.min(Math.abs(angle), 180 - Math.abs(angle));
  if (fromHorizontal > LEVEL_SNAP_DEGREES) return [{ x: start.x, y: start.y }, { x: end.x, y: end.y }];

  const ys = points.map((p) => p.y).sort((a, b) => a - b);
  const y = ys[Math.floor(ys.length / 2)];
  return [
    { x: start.x, y },
    { x: end.x, y },
  ];
}

/** A flat-ended bar along a two-point highlight, like the chisel tip of a marker. */
export function fillHighlightBar(ctx: CanvasRenderingContext2D, a: Point, b: Point, width: number): void {
  const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const nx = (-(b.y - a.y) / length) * (width / 2);
  const ny = ((b.x - a.x) / length) * (width / 2);
  ctx.beginPath();
  ctx.moveTo(a.x + nx, a.y + ny);
  ctx.lineTo(b.x + nx, b.y + ny);
  ctx.lineTo(b.x - nx, b.y - ny);
  ctx.lineTo(a.x - nx, a.y - ny);
  ctx.closePath();
  ctx.fill();
}

const DARK_LUMINANCE = 0.2;
const colorCache = new Map<string, [number, number, number, number] | null>();
let probe: CanvasRenderingContext2D | null | undefined;

/** Any CSS colour as RGBA, read back from a canvas so modern colour syntaxes resolve too. */
function parseColor(css: string): [number, number, number, number] | null {
  const cached = colorCache.get(css);
  if (cached !== undefined) return cached;
  let rgba: [number, number, number, number] | null = null;
  const m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)$/i.exec(css);
  if (m) {
    const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    rgba = [+m[1], +m[2], +m[3], a];
  } else {
    if (probe === undefined) {
      try {
        probe = typeof OffscreenCanvas !== 'undefined' ? (new OffscreenCanvas(1, 1).getContext('2d') as unknown as CanvasRenderingContext2D | null) : null;
      } catch {
        probe = null;
      }
    }
    if (probe) {
      probe.clearRect(0, 0, 1, 1);
      probe.fillStyle = '#000';
      probe.fillStyle = css;
      probe.fillRect(0, 0, 1, 1);
      const d = probe.getImageData(0, 0, 1, 1).data;
      rgba = [d[0], d[1], d[2], d[3] / 255];
    }
  }
  if (colorCache.size > 200) colorCache.clear();
  colorCache.set(css, rgba);
  return rgba;
}

function isDark([r, g, b]: [number, number, number, number]): boolean {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b) < DARK_LUMINANCE;
}

function opaqueBackground(el: Element): [number, number, number, number] | null {
  const rgba = parseColor(getComputedStyle(el).backgroundColor);
  return rgba && rgba[3] >= 0.5 ? rgba : null;
}

/** The blend for the page as a whole: its own background, or the browser's default canvas for its colour scheme. */
export function pageBlend(): HighlightBlend {
  for (const el of [document.body, document.documentElement]) {
    const bg = el && opaqueBackground(el);
    if (bg) return isDark(bg) ? 'screen' : 'multiply';
  }
  const scheme = document.documentElement ? getComputedStyle(document.documentElement).colorScheme || '' : '';
  const prefersDark = typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
  const dark = /\bdark\b/.test(scheme) && (!/\blight\b/.test(scheme) || prefersDark);
  return dark ? 'screen' : 'multiply';
}

/** Identifies the page's theme, so unrelated style changes on the root do not force every highlight to be re-sampled. */
export function themeSignature(): string {
  const bg = (el: Element | null) => (el ? getComputedStyle(el).backgroundColor : '');
  return `${bg(document.body)}|${bg(document.documentElement)}|${pageBlend()}`;
}

/** The blend under one viewport point, from the first opaque background painted there; null when off screen. */
export function blendAt(x: number, y: number, isOwn: (el: Element) => boolean): HighlightBlend | null {
  if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) return null;
  if (typeof document.elementsFromPoint !== 'function') return pageBlend();
  for (const el of document.elementsFromPoint(x, y)) {
    if (isOwn(el)) continue;
    if (el === document.body || el === document.documentElement) break;
    if (el instanceof HTMLImageElement || el instanceof HTMLVideoElement || el instanceof HTMLCanvasElement) break;
    const bg = opaqueBackground(el);
    if (bg) return isDark(bg) ? 'screen' : 'multiply';
  }
  return pageBlend();
}

/**
 * The blend for a highlight covering a viewport box, by majority over a grid of points, so text or a thin rule under it
 * does not decide for the whole highlight. Null when the box is entirely off screen.
 */
export function blendForBox(box: { minX: number; minY: number; maxX: number; maxY: number }, isOwn: (el: Element) => boolean): HighlightBlend | null {
  let screen = 0;
  let multiply = 0;
  for (const fy of [0.2, 0.5, 0.8]) {
    for (const fx of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      const blend = blendAt(box.minX + (box.maxX - box.minX) * fx, box.minY + (box.maxY - box.minY) * fy, isOwn);
      if (blend === 'screen') screen++;
      else if (blend === 'multiply') multiply++;
    }
  }
  if (screen + multiply === 0) return null;
  return screen > multiply ? 'screen' : 'multiply';
}
