import type { BoundingBox } from '../types';
import { PdfEncoder } from './pdf';
import { PngEncoder } from './png';

export type ExportFormat = 'png' | 'pdf';

export type ExportErrorCode = 'zoomed' | 'cancelled' | 'tab-inactive' | 'blocked' | 'capture-failed' | 'too-large' | 'unsupported' | 'unexpected';

export class ExportError extends Error {
  constructor(
    readonly code: ExportErrorCode,
    message: string = code
  ) {
    super(message);
    this.name = 'ExportError';
  }
}

/** Gives every failure a cause the user can act on; anything unrecognised is reported as unexpected, never as worth retrying. */
export function toExportError(error: unknown): ExportError {
  if (error instanceof ExportError) return error;
  const message = String(error);
  if (error instanceof RangeError || /out[ _]of[ _]memory|allocation|too large|exceeds the maximum/i.test(message)) return new ExportError('too-large', message);
  return new ExportError('unexpected', message);
}

/** Taller pages are cut off here: past this the capture takes minutes and the file is unwieldy. */
export const MAX_EXPORT_HEIGHT = 40_000;

/** Wider outputs are scaled down to stay inside every browser's canvas size limit. */
export const MAX_OUTPUT_WIDTH = 16_384;

/** iOS Safari refuses canvases above about 16.7 megapixels, the tightest limit of any target browser. */
export const MAX_STRIP_PIXELS = 16_000_000;

/** Keeps the saved file openable on phones; denser screens are scaled down to fit. */
export const MAX_OUTPUT_PIXELS = 200_000_000;

/** Off-screen strips are kept short so each screenshot stays small to pass between extension contexts. */
const REGION_STRIP_HEIGHT = 2048;

export type CaptureImage = ImageBitmap;

export interface CaptureRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PageCaptureDeps {
  /** Screenshots the visible part of the tab. */
  captureViewport(): Promise<CaptureImage>;
  /** Screenshots any area of the page (document CSS pixels) at `scale` without scrolling; only Firefox can. */
  captureRegion?(rect: CaptureRect, scale: number): Promise<CaptureImage>;
  /** Paints drawings for `region` (document CSS pixels) onto `ctx` at `scale` output pixels per CSS pixel. */
  drawAnnotations(ctx: CanvasRenderingContext2D, region: BoundingBox, scale: number): void;
  /** Hides the extension's own UI and returns a function that shows it again. */
  hideOverlay(): () => void;
  /** Called once the page is in its export layout at the top, before the first screenshot. */
  onLayoutReady?(): void;
  /** Called right before each screenshot; the returned function runs right after it. Lets a progress panel step out of the picture. */
  beforeShot?(): () => void;
  /** Called once every screenshot is taken and the page is back as it was; only writing the file remains. */
  onCaptured?(): void;
  /** Shortest gap between visible-area screenshots; waiting it out up front keeps a progress panel hidden only for the shot itself. */
  minShotIntervalMs?: number;
  signal?: AbortSignal;
  onProgress?(fraction: number): void;
}

export interface PageCaptureResult {
  blob: Blob;
  /** True when only the top part of the page was saved. */
  truncated: boolean;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    // Timer fallback: rAF can stall when the tab is throttled.
    const timer = setTimeout(resolve, 120);
    requestAnimationFrame(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/** A screenshot the browser never answers would otherwise leave the save, and its progress panel, stuck for good. */
const SHOT_TIMEOUT_MS = 15_000;

/** Takes screenshots one at a time, at most one per `intervalMs`, with the progress panel out of the way while each is taken. */
class ShotTaker {
  private last = -Infinity;

  constructor(
    private readonly deps: PageCaptureDeps,
    private readonly intervalMs: number
  ) {}

  async take(prepare: () => Promise<void>, shoot: () => Promise<CaptureImage>): Promise<CaptureImage> {
    const wait = this.last + this.intervalMs - performance.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    const restore = this.deps.beforeShot?.();
    try {
      await prepare();
      return await this.guard(shoot());
    } finally {
      this.last = performance.now();
      restore?.();
    }
  }

  /** Ends the wait on cancel or timeout; a screenshot that still arrives afterwards is closed so it is not leaked. */
  private async guard(shot: Promise<CaptureImage>): Promise<CaptureImage> {
    const { signal } = this.deps;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort = () => {};
    const stop = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new ExportError('capture-failed', 'Screenshot timed out')), SHOT_TIMEOUT_MS);
      onAbort = () => reject(new ExportError('cancelled'));
      if (signal?.aborted) onAbort();
      else signal?.addEventListener('abort', onAbort, { once: true });
    });
    try {
      return await Promise.race([shot, stop]);
    } catch (error) {
      shot.then((late) => late.close(), () => {});
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }
}

/** Lets scroll-driven layout, lazy content and the compositor catch up before a screenshot. */
async function settle(): Promise<void> {
  await nextFrame();
  await nextFrame();
  await new Promise((resolve) => setTimeout(resolve, 60));
}

/** Inline style edits that are undone in reverse order. */
class StyleOverrides {
  private readonly undo: (() => void)[] = [];

  set(el: HTMLElement, property: string, value: string): void {
    const previous = el.style.getPropertyValue(property);
    const priority = el.style.getPropertyPriority(property);
    el.style.setProperty(property, value, 'important');
    this.undo.push(() => {
      if (previous) el.style.setProperty(property, previous, priority);
      else el.style.removeProperty(property);
    });
  }

  restore(): void {
    while (this.undo.length) this.undo.pop()!();
  }
}

/** Sticky elements stay where they sit in the page and bottom-half fixed bars (cookie banners) are hidden; returns the top fixed bars, shown in the first screenshot only. */
function prepareLayout(overrides: StyleOverrides, viewHeight: number): HTMLElement[] {
  const topFixed: HTMLElement[] = [];
  for (const el of document.body?.querySelectorAll<HTMLElement>('*') ?? []) {
    const position = getComputedStyle(el).position;
    if (position === 'sticky') {
      // Relative keeps the box in flow and still contains absolutely positioned children; auto offsets cancel the stuck shift.
      overrides.set(el, 'position', 'relative');
      for (const side of ['top', 'right', 'bottom', 'left']) overrides.set(el, side, 'auto');
    } else if (position === 'fixed') {
      if (el.getBoundingClientRect().top >= viewHeight / 2) overrides.set(el, 'visibility', 'hidden');
      else topFixed.push(el);
    }
  }
  return topFixed;
}

function viewportSize(): { width: number; height: number } {
  const root = document.compatMode === 'BackCompat' ? document.body : document.documentElement;
  return { width: root.clientWidth || window.innerWidth, height: root.clientHeight || window.innerHeight };
}

/** Scripts scroll only the layout viewport, so when the visible area is much smaller (pinch zoom, or a phone showing part of a too-wide page) most of the page can never be screenshot. */
function isZoomedIn(viewWidth: number): boolean {
  const vv = window.visualViewport;
  return !!vv && (vv.scale > 1.01 || vv.width < viewWidth - 2 || vv.width < window.innerWidth - 40);
}

interface Layout {
  view: { width: number; height: number };
  docW: number;
  docH: number;
  fullH: number;
}

/** Shared by both capture strategies: the strip canvas and the encoder rows it feeds. */
class StripWriter {
  private readonly canvas = document.createElement('canvas');
  readonly ctx: CanvasRenderingContext2D;
  readonly encoder: PngEncoder | PdfEncoder;

  constructor(
    format: ExportFormat,
    readonly outW: number,
    readonly scale: number,
    private readonly deps: PageCaptureDeps
  ) {
    this.canvas.width = outW;
    this.canvas.height = 1;
    const ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    // Browsers hand out no canvas context when the canvas is bigger than they can allocate.
    if (!ctx) throw new ExportError('too-large', 'Canvas is unavailable');
    this.ctx = ctx;
    this.encoder = format === 'png' ? new PngEncoder(outW) : new PdfEncoder(outW);
  }

  /** Pixel rows of the output covering document rows [y0, y1); rounding is shared so strips never overlap or gap. */
  rows(y0: number, y1: number): { top: number; height: number } {
    const top = Math.round(y0 * this.scale);
    return { top, height: Math.round(y1 * this.scale) - top };
  }

  begin(height: number): void {
    // Growing clears the canvas; it only grows when a mobile address bar hides mid-export.
    if (this.canvas.height < height) this.canvas.height = height;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.fillStyle = '#ffffff';
    this.ctx.fillRect(0, 0, this.outW, height);
  }

  async commit(region: BoundingBox, height: number): Promise<void> {
    this.deps.drawAnnotations(this.ctx, region, this.scale);
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    await this.encoder.addRows(this.ctx.getImageData(0, 0, this.outW, height));
  }

  /** Runs `fill`, returning how many document rows it captured; the canvas is released either way, since mobile browsers otherwise keep it until a later garbage collection. */
  async fill(fill: () => Promise<number>): Promise<number> {
    try {
      return await fill();
    } catch (error) {
      await this.encoder.abort();
      throw error;
    } finally {
      this.canvas.width = 0;
      this.canvas.height = 0;
    }
  }

  async finish(): Promise<Blob> {
    try {
      return await this.encoder.finish();
    } catch (error) {
      await this.encoder.abort();
      throw error;
    }
  }
}

interface Captured {
  writer: StripWriter;
  capturedH: number;
  complete: boolean;
}

function outputScale(native: number, layout: Layout): number {
  const { docW, docH, view } = layout;
  return Math.min(
    native,
    MAX_OUTPUT_WIDTH / docW,
    Math.sqrt(MAX_STRIP_PIXELS / (docW * Math.max(view.height, window.innerHeight))),
    Math.sqrt(MAX_OUTPUT_PIXELS / (docW * docH))
  );
}

/** Firefox renders any area of the page on request, so the page never scrolls through and mobile address bars never resize the view. */
async function captureByRegion(format: ExportFormat, layout: Layout, deps: PageCaptureDeps, check: () => void): Promise<Captured> {
  const { docW, docH } = layout;
  const scale = outputScale(window.devicePixelRatio || 1, layout);
  const writer = new StripWriter(format, Math.max(1, Math.round(docW * scale)), scale, deps);
  const stripCss = Math.max(1, Math.min(REGION_STRIP_HEIGHT, Math.floor(MAX_STRIP_PIXELS / (writer.outW * scale))));
  const shots = new ShotTaker(deps, 0);

  const capturedH = await writer.fill(async () => {
    for (let y0 = 0; y0 < docH; y0 += stripCss) {
      const y1 = Math.min(docH, y0 + stripCss);
      const { height } = writer.rows(y0, y1);
      writer.begin(height);
      const shot = await shots.take(nextFrame, () => deps.captureRegion!({ x: 0, y: y0, width: docW, height: y1 - y0 }, scale));
      try {
        writer.ctx.drawImage(shot, 0, 0, shot.width, shot.height, 0, 0, writer.outW, height);
      } finally {
        shot.close();
      }
      await writer.commit({ minX: 0, minY: y0, maxX: docW, maxY: y1 }, height);
      deps.onProgress?.(y1 / docH);
      check();
    }
    return docH;
  });
  return { writer, capturedH, complete: true };
}

/** What a screenshot covers, in document CSS pixels: the visual viewport plus any classic scrollbars along its edges. */
function visibleArea(): { left: number; top: number; width: number; shotWidth: number; barBottom: number } {
  const root = document.documentElement;
  const vv = window.visualViewport;
  const width = vv?.width ?? root.clientWidth;
  // Phones showing a page wider than the screen report an enlarged innerWidth; only a gap this small is a real scrollbar.
  const bar = (gap: number) => (gap > 0 && gap <= 40 ? gap : 0);
  const sane = window.innerWidth - width <= 40;
  return {
    left: vv?.pageLeft ?? window.scrollX,
    top: vv?.pageTop ?? window.scrollY,
    width,
    // innerWidth is exact where sane; visualViewport.width carries sub-pixel rounding at fractional device scales.
    shotWidth: sane ? window.innerWidth : width,
    barBottom: bar(window.innerHeight - root.clientHeight),
  };
}

/** Everywhere else: scroll tile by tile and screenshot the visible area each time. */
async function captureByScrolling(
  format: ExportFormat,
  layout: Layout,
  deps: PageCaptureDeps,
  check: () => void,
  hideAfterFirst: () => void
): Promise<Captured> {
  const { docH } = layout;
  let { docW } = layout;
  const area = visibleArea();
  let complete = true;
  if (docW > area.width + 1) {
    // Some phones cannot scroll the window all the way across a page wider than the screen; keep only what can be reached.
    window.scrollTo(1e9, 0);
    const reach = visibleArea();
    window.scrollTo(0, 0);
    await settle();
    check();
    const reachable = reach.left + reach.width;
    if (reachable < docW - 1) {
      docW = reachable;
      complete = false;
    }
  }

  const shots = new ShotTaker(deps, deps.minShotIntervalMs ?? 0);
  // Read just before each screenshot and compared just after: if it moved, the user scrolled mid-shot and the tile would not line up.
  let seen = visibleArea();
  const shoot = async () => {
    const shot = await deps.captureViewport();
    const now = visibleArea();
    if (Math.abs(now.left - seen.left) > 1 || Math.abs(now.top - seen.top) > 1) {
      shot.close();
      throw new ExportError('cancelled', 'The page scrolled during a screenshot');
    }
    return shot;
  };
  const first = await shots.take(async () => {
    await settle();
    check();
    seen = visibleArea();
  }, shoot);
  const captureScale = first.width / area.shotWidth;
  if (!(captureScale > 0)) {
    first.close();
    throw new ExportError('capture-failed', 'Empty screenshot');
  }
  let pending: CaptureImage | null = first;
  const scale = outputScale(captureScale, { ...layout, docW });
  let writer: StripWriter;
  try {
    writer = new StripWriter(format, Math.max(1, Math.round(docW * scale)), scale, deps);
  } catch (error) {
    first.close();
    throw error;
  }

  const capturedH = await writer.fill(async () => {
    try {
      const step = area.width;
      const columns = Math.ceil(docW / step);
      let firstShown = false;
      let y0 = 0;

      // Screenshots are whole device pixels, so strips can be fractional in CSS pixels; a sliver under one pixel is done.
      while (docH - y0 >= 1) {
        let stripCss = 0;
        let height = 0;

        for (let column = 0; column < columns; column++) {
          const x0 = column * step;
          if (!pending) {
            if (!firstShown) {
              hideAfterFirst();
              firstShown = true;
            }
            pending = await shots.take(async () => {
              window.scrollTo(x0, y0);
              await settle();
              check();
              seen = visibleArea();
            }, shoot);
          }
          const shot: CaptureImage = pending;
          pending = null;
          try {
            const offsetX = x0 - seen.left;
            const offsetY = y0 - seen.top;
            if (column === 0) {
              // Measured from each screenshot, because a mobile address bar can grow or shrink the visible area while scrolling.
              const barBottom = docW > seen.width + 1 ? seen.barBottom : 0;
              const visibleH = shot.height / captureScale - barBottom - offsetY;
              // The window cannot scroll this far, typically because the page scrolls an inner element instead.
              if (visibleH < 1) return y0;
              stripCss = Math.min(visibleH, docH - y0);
              ({ height } = writer.rows(y0, y0 + stripCss));
              writer.begin(height);
            }
            const tileW = Math.min(step, docW - x0);
            const left = Math.round(x0 * scale);
            writer.ctx.drawImage(
              shot,
              offsetX * captureScale,
              offsetY * captureScale,
              tileW * captureScale,
              stripCss * captureScale,
              left,
              0,
              Math.round((x0 + tileW) * scale) - left,
              height
            );
          } finally {
            shot.close();
          }
        }

        await writer.commit({ minX: 0, minY: y0, maxX: docW, maxY: y0 + stripCss }, height);
        y0 += stripCss;
        deps.onProgress?.(y0 / docH);
        check();
      }
      return docH;
    } finally {
      pending?.close();
    }
  });
  return { writer, capturedH, complete };
}

/** Memory stays bounded by one strip, so page height is limited only by MAX_EXPORT_HEIGHT. */
export async function capturePage(format: ExportFormat, deps: PageCaptureDeps): Promise<PageCaptureResult> {
  const { signal } = deps;
  const check = () => {
    if (signal?.aborted) throw new ExportError('cancelled');
  };

  const view = viewportSize();
  if (!deps.captureRegion && isZoomedIn(view.width)) throw new ExportError('zoomed');
  if (typeof CompressionStream === 'undefined') throw new ExportError('unsupported');

  const scroller = document.scrollingElement ?? document.documentElement;
  const docW = Math.max(scroller.scrollWidth, view.width);
  const fullH = Math.max(scroller.scrollHeight, view.height);
  const layout: Layout = { view, docW, fullH, docH: Math.min(fullH, MAX_EXPORT_HEIGHT) };

  const startX = window.scrollX;
  const startY = window.scrollY;
  const overrides = new StyleOverrides();
  const showOverlay = deps.hideOverlay();

  let captured: Captured;
  try {
    overrides.set(document.documentElement, 'scroll-behavior', 'auto');
    if (document.body) overrides.set(document.body, 'scroll-behavior', 'auto');
    const topFixed = prepareLayout(overrides, view.height);
    // Fixed headers then sit at the top of the page in every capture strategy.
    window.scrollTo(0, 0);
    await settle();
    check();
    deps.onLayoutReady?.();

    captured = deps.captureRegion
      ? await captureByRegion(format, layout, deps, check)
      : await captureByScrolling(format, layout, deps, check, () => topFixed.forEach((el) => overrides.set(el, 'visibility', 'hidden')));
  } finally {
    overrides.restore();
    window.scrollTo(startX, startY);
    showOverlay();
  }
  // Only the rows already captured are needed from here, so the page goes back to the user before the file is written.
  deps.onCaptured?.();
  const blob = await captured.writer.finish();
  return { blob, truncated: !captured.complete || captured.capturedH < fullH };
}

/** Decodes the data URL the background returns without fetch(), which page CSP can block in content scripts. */
export async function decodeCapture(dataUrl: string): Promise<CaptureImage> {
  const comma = dataUrl.indexOf(',');
  const mime = /^data:([^;,]+)/.exec(dataUrl)?.[1] ?? 'image/png';
  const binary = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return createImageBitmap(new Blob([bytes], { type: mime }));
}

export function exportFileName(format: ExportFormat, title: string, url: string, now = new Date()): string {
  let base = title.replace(/[\\/:*?"<>|\p{Cc}]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 80).trim();
  if (!base) {
    try {
      base = new URL(url).hostname;
    } catch {}
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `${base || 'page'} ${stamp}.${format}`;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  (document.body ?? document.documentElement).appendChild(link);
  link.click();
  link.remove();
  // Revoked late: some browsers start reading the blob only after click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
