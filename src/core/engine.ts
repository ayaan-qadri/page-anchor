import {
  AnchorElement,
  BoundingBox,
  EngineCallbacks,
  Point,
  ShapeElement,
  StrokeElement,
  TextElement,
  ToolType,
} from '../types/engine.types';
import { OrphanedAnchorMode } from '../types/storage.types';
import { DOMAnchorManager } from './anchor';
import { DARK_BACKGROUND_STRENGTH, blendAt, blendForBox, fillHighlightBar, intensityToOpacity, pageBlend, straightenHighlight, themeSignature, type HighlightBlend } from './highlighter';
import {
  computeBoundingBox,
  FreehandOutline,
  FreehandStrokeRenderOptions,
  getFreehandOutline,
  intersectsBoundingBox,
  isPointNearElement,
  isShapeElement,
  isShapeType,
  renderArrowHead,
  renderFreehandStroke,
  simplifyPointsRDP,
  translateFreehandOutline,
} from './geometry';

export type { EngineCallbacks };

/**
 * Muted selection chrome. Saturated blues shout over the page being annotated;
 * this reads as a quiet overlay that still marks what is selected.
 */
const SELECTION_COLOR = '#8fa6cc';
const SELECTION_BADGE_BG = 'rgba(56, 70, 106, 0.94)';

const ORPHAN_DIM_FACTOR = 0.35;
const REANCHOR_MAX_ELEMENTS = 50;
const TEXT_FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
const TEXT_PADDING = 6;
const TEXT_MIN_WIDTH = 60;
const TEXT_MIN_HEIGHT = 30;

interface EffectiveBBox {
  bbox: BoundingBox;
  deltaX: number;
  deltaY: number;
  isOrphaned: boolean;
  /** The anchored page element is not displayed (collapsed section, inactive tab), so neither is the drawing. */
  isConcealed: boolean;
  /** Visible box of the scrolling pane the drawing lives in; parts outside it are cut off like the pane's content. */
  clip?: BoundingBox;
}

function containsPoint(box: BoundingBox, pt: Point): boolean {
  return pt.x >= box.minX && pt.x <= box.maxX && pt.y >= box.minY && pt.y <= box.maxY;
}

export interface RegionPlacement {
  scrollX: number;
  scrollY: number;
  boxes: Map<AnchorElement, EffectiveBBox>;
}

function strokeRenderOptions(type: StrokeElement['type'], width: number): FreehandStrokeRenderOptions {
  const isHighlighter = type === 'highlighter';
  return {
    size: width,
    thinning: isHighlighter ? 0 : 0.35,
    smoothing: 0.65,
    streamline: 0.55,
    simulatePressure: !isHighlighter,
  };
}

const DEFAULT_HIGHLIGHTER_OPACITY = 0.35;
const HIGHLIGHT_BLENDS: readonly HighlightBlend[] = ['multiply', 'screen'];

/** Highlights sit outside the overlay's shadow host, whose stacking context would otherwise keep them from blending with the page. */
interface HighlightLayer {
  host: HTMLElement;
  base: HTMLCanvasElement;
  active: HTMLCanvasElement;
  baseCtx: CanvasRenderingContext2D | null;
  activeCtx: CanvasRenderingContext2D | null;
}

const HIGHLIGHT_HOST_STYLES: Record<string, string> = {
  position: 'absolute',
  top: '0',
  left: '0',
  width: '0',
  height: '0',
  margin: '0',
  padding: '0',
  overflow: 'visible',
  'z-index': '2147483646',
  display: 'block',
  visibility: 'visible',
  opacity: '1',
  transform: 'none',
  filter: 'none',
  contain: 'none',
  isolation: 'auto',
  'clip-path': 'none',
  'pointer-events': 'none',
};

function baseOpacity(el: AnchorElement): number {
  return el.opacity || (el.type === 'highlighter' ? DEFAULT_HIGHLIGHTER_OPACITY : 1);
}

function textFont(fontSize: number): string {
  return `600 ${fontSize}px ${TEXT_FONT_FAMILY}`;
}

/** Point the anchor lookup falls back to when the bbox centre hits no usable DOM node. */
function anchorHint(el: AnchorElement): Point | undefined {
  if (isShapeElement(el)) return { x: el.startX, y: el.startY };
  if (el.type === 'text') return { x: el.x, y: el.y };
  return el.points[0];
}

function sameBBox(a: BoundingBox, b: BoundingBox): boolean {
  return a.minX === b.minX && a.minY === b.minY && a.maxX === b.maxX && a.maxY === b.maxY;
}

// Committed elements are never mutated (changes produce new objects) because history snapshots share element references.
export class CanvasEngine {
  private baseCanvas: HTMLCanvasElement;
  private baseCtx: CanvasRenderingContext2D | null;
  private activeCanvas: HTMLCanvasElement;
  private activeCtx: CanvasRenderingContext2D | null;
  private container: HTMLElement;

  private elements: AnchorElement[] = [];
  private selectedElements: AnchorElement[] = [];
  private reportedSelection: { list: AnchorElement[]; size: number } = { list: [], size: 0 };
  private isDraggingSelected = false;
  private dragStartPoint: Point | null = null;
  /** Translation applied at render time while dragging; committed to the elements once on drop. */
  private dragOffset: Point = { x: 0, y: 0 };
  private draggedSet: Set<AnchorElement> | null = null;
  private isMarqueeSelecting = false;
  private marqueeStartPoint: Point | null = null;
  private currentMarqueeBBox: BoundingBox | null = null;

  private activeTool: ToolType = 'pen';
  private strokeColor = '#ef4444';
  private strokeWidth = 4;
  private highlighterColor = '#ffea00';
  private highlighterWidth = 20;
  private highlighterOpacity = intensityToOpacity(50);
  private layers: Record<HighlightBlend, HighlightLayer>;
  /** Blend picked for each highlight from the page under it; cleared when the page's theme may have changed. */
  private blendCache = new WeakMap<AnchorElement, HighlightBlend>();
  private pageBlendCache: HighlightBlend | null = null;
  private activeBlend: HighlightBlend = 'multiply';
  private themeObserver: MutationObserver | null = null;
  private darkSchemeQuery: MediaQueryList | null = null;
  private isDestroyed = false;
  private layerPainted: Record<HighlightBlend, boolean> = { multiply: false, screen: false };
  private activeLayerPainted = false;
  private fontSize = 18;
  private isActiveMode = false;
  private strokeSimplification = true;

  private isPointerDown = false;
  private pointerId: number | null = null;
  private currentStrokePoints: Point[] = [];
  private shapeStartPoint: Point | null = null;
  private currentShape: ShapeElement | null = null;

  /** Last position of every finger on the canvas; two fingers, or one on empty space with Select, scroll the page instead of drawing. */
  private touches = new Map<number, { x: number; y: number }>();
  private isPanning = false;
  /** A finger tap with the Text tool opens the editor on lift, so a second finger landing turns it into a scroll instead. */
  private pendingTextPoint: Point | null = null;

  /** True only once a select-drag actually displaced an element. */
  private hasMovedElements = false;

  /**
   * Eraser state. A sweep is a single user action, so its removals are
   * coalesced into one history entry instead of one per pointer event.
   */
  private isErasingGesture = false;
  private eraseChangedPending = false;

  private scrollRafId: number | null = null;
  private resizeRafId: number | null = null;
  private strokeRafId: number | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private textMetricsCache = new Map<string, { width: number; height: number }>();
  private measureCtx: CanvasRenderingContext2D | null | undefined;
  private strokeOutlines = new WeakMap<StrokeElement, FreehandOutline>();
  private dpr = 1;
  private viewportWidth = 0;
  private viewportHeight = 0;
  private callbacks: EngineCallbacks;

  private anchorManager: DOMAnchorManager;
  private isDomAnchoringEnabled = true;
  private orphanedAnchorMode: OrphanedAnchorMode = 'hide';

  constructor(container: HTMLElement, callbacks: EngineCallbacks = {}) {
    this.container = container;
    this.callbacks = callbacks;
    this.anchorManager = new DOMAnchorManager(() => {
      this.renderBase();
    });

    this.baseCanvas = this.createLayer('page-anchor-base-canvas', '2147483640');
    this.activeCanvas = this.createLayer('page-anchor-active-canvas', '2147483641');

    this.container.appendChild(this.baseCanvas);
    this.container.appendChild(this.activeCanvas);

    this.baseCtx = this.baseCanvas.getContext('2d', { alpha: true });
    this.activeCtx = this.activeCanvas.getContext('2d', { alpha: true });

    this.layers = { multiply: this.createHighlightLayer('multiply'), screen: this.createHighlightLayer('screen') };
    this.attachHighlightLayers();
    this.watchTheme();

    this.updateDprAndSize();
    this.bindEvents();
  }

  private createHighlightLayer(blend: HighlightBlend): HighlightLayer {
    const host = document.createElement('page-anchor-highlights');
    host.dataset.blend = blend;
    host.setAttribute('aria-hidden', 'true');
    for (const [property, value] of Object.entries(HIGHLIGHT_HOST_STYLES)) host.style.setProperty(property, value, 'important');
    host.style.setProperty('mix-blend-mode', blend, 'important');
    if (blend === 'screen') host.style.setProperty('opacity', `${DARK_BACKGROUND_STRENGTH}`, 'important');
    const base = this.createLayer('page-anchor-highlight-canvas', '0');
    const active = this.createLayer('page-anchor-highlight-active-canvas', '1');
    for (const canvas of [base, active]) {
      canvas.width = 0;
      canvas.height = 0;
      host.appendChild(canvas);
    }
    return { host, base, active, baseCtx: base.getContext('2d', { alpha: true }), activeCtx: active.getContext('2d', { alpha: true }) };
  }

  /** Highlight layers stay unallocated until a highlight lands on them, so pages without highlights carry no extra canvas memory. */
  private sizeLayer(layer: HighlightLayer): void {
    const { width, height } = this.baseCanvas;
    for (const canvas of [layer.base, layer.active]) {
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
    }
  }

  /** Re-attached on every render, so a page that rewrites its document cannot drop the highlights. */
  private attachHighlightLayers(): void {
    if (this.isDestroyed) return;
    const root = document.documentElement || document.body;
    if (!root) return;
    for (const blend of HIGHLIGHT_BLENDS) {
      if (!this.layers[blend].host.isConnected) root.appendChild(this.layers[blend].host);
    }
  }

  private readonly isOwnNode = (el: Element): boolean => !!el.closest('#page-anchor-host, page-anchor-highlights');

  private themeKey = '';

  private readonly invalidateTheme = (): void => {
    const key = themeSignature();
    if (key === this.themeKey) return;
    this.themeKey = key;
    this.blendCache = new WeakMap();
    this.pageBlendCache = null;
    this.onScroll();
  };

  /** Sites switch between light and dark by changing a class, attribute or style on the root, or by following the system setting. */
  private watchTheme(): void {
    this.themeKey = themeSignature();
    if (typeof MutationObserver !== 'undefined') {
      this.themeObserver = new MutationObserver(this.invalidateTheme);
      for (const el of [document.documentElement, document.body]) {
        if (el) this.themeObserver.observe(el, { attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-color-mode', 'data-mode'] });
      }
    }
    if (typeof matchMedia === 'function') {
      this.darkSchemeQuery = matchMedia('(prefers-color-scheme: dark)');
      this.darkSchemeQuery.addEventListener?.('change', this.invalidateTheme);
    }
  }

  private currentPageBlend(): HighlightBlend {
    this.pageBlendCache ??= pageBlend();
    return this.pageBlendCache;
  }

  /** Blend for a highlight, sampled where it sits on screen; one off screen uses the page's own blend until it scrolls into view. */
  private blendFor(el: AnchorElement, eff: EffectiveBBox): HighlightBlend {
    const cached = this.blendCache.get(el);
    if (cached) return cached;
    const { minX, minY, maxX, maxY } = eff.bbox;
    const sx = window.scrollX;
    const sy = window.scrollY;
    const sampled = blendForBox({ minX: minX - sx, minY: minY - sy, maxX: maxX - sx, maxY: maxY - sy }, this.isOwnNode);
    if (!sampled) return this.currentPageBlend();
    this.blendCache.set(el, sampled);
    return sampled;
  }

  /** Hides the highlight layers for a screenshot; returns the function that shows them again. */
  public hideHighlights(): () => void {
    for (const blend of HIGHLIGHT_BLENDS) this.layers[blend].host.style.setProperty('visibility', 'hidden', 'important');
    return () => {
      for (const blend of HIGHLIGHT_BLENDS) this.layers[blend].host.style.setProperty('visibility', 'visible', 'important');
    };
  }

  private createLayer(className: string, zIndex: string): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.className = className;
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.position = 'fixed';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.pointerEvents = 'none';
    // Without this, touch screens turn a pen stroke into a page scroll or a swipe back to the previous page.
    canvas.style.touchAction = 'none';
    canvas.style.zIndex = zIndex;
    return canvas;
  }

  public setDomAnchoringEnabled(enabled: boolean): void {
    this.isDomAnchoringEnabled = enabled;
    this.anchorManager.invalidateCache();
    this.pruneHiddenSelection();
    this.renderBase();
    this.callbacks.onDomAnchoringToggle?.(enabled);
  }

  public getDomAnchoringEnabled(): boolean {
    return this.isDomAnchoringEnabled;
  }

  public setOrphanedAnchorMode(mode: OrphanedAnchorMode): void {
    this.orphanedAnchorMode = mode;
    this.pruneHiddenSelection();
    this.renderBase();
  }

  public getOrphanedAnchorMode(): OrphanedAnchorMode {
    return this.orphanedAnchorMode;
  }

  public getElementEffectiveBBox(el: AnchorElement): EffectiveBBox {
    let deltaX = 0;
    let deltaY = 0;
    let isOrphaned = false;
    let isConcealed = false;
    let clip: BoundingBox | undefined;

    if (this.isDomAnchoringEnabled && el.anchor) {
      const res = this.anchorManager.resolve(el.anchor);
      if (res.status === 'orphaned') {
        isOrphaned = true;
      } else {
        isConcealed = res.status === 'hidden';
        deltaX = res.deltaX;
        deltaY = res.deltaY;
        clip = res.clip;
      }
    }
    if (this.draggedSet?.has(el)) {
      deltaX += this.dragOffset.x;
      deltaY += this.dragOffset.y;
    }

    return {
      bbox: {
        minX: el.bbox.minX + deltaX,
        minY: el.bbox.minY + deltaY,
        maxX: el.bbox.maxX + deltaX,
        maxY: el.bbox.maxY + deltaY,
      },
      deltaX,
      deltaY,
      isOrphaned,
      isConcealed,
      ...(clip ? { clip } : {}),
    };
  }

  private isHidden(eff: EffectiveBBox): boolean {
    if (eff.isConcealed) return true;
    if (eff.clip && !intersectsBoundingBox(eff.bbox, eff.clip)) return true;
    return eff.isOrphaned && this.orphanedAnchorMode === 'hide';
  }

  private isRendered(el: AnchorElement): boolean {
    return !this.isHidden(this.getElementEffectiveBBox(el));
  }

  private pruneHiddenSelection(): void {
    this.selectedElements = this.selectedElements.filter((el) => this.isRendered(el));
  }

  public setTool(tool: ToolType): void {
    this.resetGesture(true);
    this.activeTool = tool;
    if (tool !== 'select') {
      this.selectedElements = [];
    }
    this.updateCursor();
    this.renderBase();
  }

  public getTool(): ToolType {
    return this.activeTool;
  }

  public setStrokeColor(color: string): void {
    this.strokeColor = color;
  }

  public setStrokeWidth(width: number): void {
    this.strokeWidth = width;
  }

  public setHighlighterColor(color: string): void {
    this.highlighterColor = color;
  }

  public setHighlighterWidth(width: number): void {
    this.highlighterWidth = width;
  }

  public setHighlighterIntensity(percent: number): void {
    this.highlighterOpacity = intensityToOpacity(percent);
  }

  public setFontSize(size: number): void {
    this.fontSize = size;
  }

  /**
   * Toggles RDP point decimation for committed freehand strokes. Disabling
   * keeps raw pointer points, trading memory/storage for full stroke fidelity.
   * Viewport frustum culling is always on and is not affected by this flag.
   */
  public setStrokeSimplification(enabled: boolean): void {
    this.strokeSimplification = enabled;
    this.renderBase();
  }

  public getStrokeSimplification(): boolean {
    return this.strokeSimplification;
  }

  public setActiveMode(active: boolean): void {
    this.resetGesture(true);
    this.isActiveMode = active;
    if (active) {
      this.activeCanvas.style.pointerEvents = 'auto';
      this.updateCursor();
    } else {
      this.activeCanvas.style.pointerEvents = 'none';
      this.activeCanvas.style.cursor = 'default';
      this.selectedElements = [];
      this.renderBase();
    }
  }

  public getActiveMode(): boolean {
    return this.isActiveMode;
  }

  public setAnnotationsVisible(visible: boolean): void {
    this.baseCanvas.style.display = visible ? 'block' : 'none';
    for (const blend of HIGHLIGHT_BLENDS) this.layers[blend].base.style.display = visible ? 'block' : 'none';
    // Also drop any in-progress preview so a half-drawn stroke does not linger
    // on the active layer while annotations are hidden.
    if (!visible) this.clearActiveCanvas();
  }

  public getAnnotationsVisible(): boolean {
    return this.baseCanvas.style.display !== 'none';
  }

  public setElements(elements: AnchorElement[]): void {
    // Replacing the page (undo, redo, navigation) supersedes any half-finished gesture.
    this.resetGesture(false);
    this.elements = elements.map((el) => this.withMeasuredText(el));
    this.selectedElements = [];
    this.renderBase();
  }

  public getElements(): AnchorElement[] {
    return [...this.elements];
  }

  /** True while a pointer gesture (stroke, shape, drag, erase, marquee) is in progress. */
  public isInteracting(): boolean {
    return this.isPointerDown;
  }

  public addElement(element: AnchorElement): void {
    let el = this.withMeasuredText(element);
    if (this.isDomAnchoringEnabled && !el.anchor) {
      el = { ...el, anchor: this.anchorManager.captureAnchor(el.bbox, anchorHint(el)) };
    }
    this.elements.push(el);
    this.emitChange();
    this.renderBase();
  }

  public clear(): void {
    this.resetGesture(false);
    this.elements = [];
    this.selectedElements = [];
    this.emitChange();
    this.renderBase();
  }

  /** Selects every rendered element (hidden orphans excluded) and switches to the select tool. */
  public selectAll(): void {
    const visible = this.elements.filter((el) => this.isRendered(el));
    if (visible.length === 0) return;
    this.resetGesture(true);
    this.activeTool = 'select';
    this.updateCursor();
    this.selectedElements = visible;
    this.renderBase();
  }

  public clearSelection(): void {
    if (this.selectedElements.length > 0) {
      this.selectedElements = [];
      this.renderBase();
    }
  }

  public getSelectedElements(): AnchorElement[] {
    return [...this.selectedElements];
  }

  public moveAll(dx: number, dy: number): void {
    if (this.elements.length === 0 || (dx === 0 && dy === 0)) return;
    const replacements = new Map<AnchorElement, AnchorElement>();
    for (const el of this.elements) {
      replacements.set(el, this.movedElement(el, dx, dy));
    }
    this.replaceElements(replacements);
    this.emitChange();
    this.renderBase();
  }

  /** Recolours the selected drawings as one undoable change. Returns false when nothing is selected. */
  public recolorSelected(color: string): boolean {
    if (this.selectedElements.length === 0) return false;
    const replacements = new Map<AnchorElement, AnchorElement>();
    for (const el of this.selectedElements) {
      if (el.strokeColor === color && (el.type !== 'text' || el.fontColor === color)) continue;
      const recolored: AnchorElement = el.type === 'text' ? { ...el, strokeColor: color, fontColor: color } : { ...el, strokeColor: color };
      if (el.type === 'pen' || el.type === 'highlighter') {
        const outline = this.strokeOutlines.get(el);
        if (outline) this.strokeOutlines.set(recolored as StrokeElement, outline);
      }
      replacements.set(el, recolored);
    }
    if (replacements.size === 0) return true;
    this.replaceElements(replacements);
    this.emitChange();
    this.renderBase();
    return true;
  }

  public deleteSelected(): void {
    if (this.selectedElements.length === 0) return;
    const selected = new Set(this.selectedElements);
    this.elements = this.elements.filter((el) => !selected.has(el));
    this.selectedElements = [];
    this.emitChange();
    this.renderBase();
  }

  private emitChange(): void {
    this.callbacks.onElementsChange?.(this.elements);
  }

  private updateCursor(): void {
    if (!this.isActiveMode) {
      this.activeCanvas.style.cursor = 'default';
      return;
    }
    const tool = this.activeTool;
    if (tool === 'pen' || tool === 'highlighter' || isShapeType(tool)) {
      this.activeCanvas.style.cursor = 'crosshair';
    } else if (tool === 'text') {
      this.activeCanvas.style.cursor = 'text';
    } else if (tool === 'eraser') {
      this.activeCanvas.style.cursor = 'pointer';
    } else {
      this.activeCanvas.style.cursor = 'default';
    }
  }

  private updateDprAndSize(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2.5);

    // The root's client box excludes page scrollbars, so the overlay never covers (and blocks) them.
    const root = document.compatMode === 'BackCompat' ? document.body : document.documentElement;
    const w = Math.min(root?.clientWidth || window.innerWidth, window.innerWidth);
    const h = Math.min(root?.clientHeight || window.innerHeight, window.innerHeight);
    this.viewportWidth = w;
    this.viewportHeight = h;

    const canvases = [this.baseCanvas, this.activeCanvas];
    for (const canvas of [...canvases, ...HIGHLIGHT_BLENDS.flatMap((b) => [this.layers[b].base, this.layers[b].active])]) {
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }

    const pixelW = Math.round(w * this.dpr);
    const pixelH = Math.round(h * this.dpr);
    if (this.baseCanvas.width !== pixelW || this.baseCanvas.height !== pixelH) {
      for (const canvas of canvases) {
        canvas.width = pixelW;
        canvas.height = pixelH;
      }

      this.renderBase();
    }
  }

  private readonly onResize = (): void => {
    if (this.resizeRafId !== null) return;
    this.resizeRafId = requestAnimationFrame(() => {
      this.resizeRafId = null;
      this.updateDprAndSize();
    });
  };

  private readonly onScroll = (): void => {
    if (this.scrollRafId !== null) return;
    this.scrollRafId = requestAnimationFrame(() => {
      this.scrollRafId = null;
      this.renderBase();
    });
  };

  private bindEvents(): void {
    window.addEventListener('resize', this.onResize, { passive: true });
    // Capturing on the document also catches scrolling panes, whose anchored drawings move with their content.
    document.addEventListener('scroll', this.onScroll, { capture: true, passive: true });
    this.activeCanvas.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);

    // Window resize misses a scrollbar appearing when the page grows; the root's box changes then.
    if (typeof ResizeObserver !== 'undefined' && document.documentElement) {
      this.resizeObserver = new ResizeObserver(this.onResize);
      this.resizeObserver.observe(document.documentElement);
    }
  }

  private clientToDoc(clientX: number, clientY: number, pressure?: number): Point {
    return {
      x: clientX + window.scrollX,
      y: clientY + window.scrollY,
      ...(pressure !== undefined && pressure > 0 ? { pressure } : {}),
    };
  }

  /** `commitPending` reports edits already applied mid-gesture (drag, erase sweep) so they are saved and undoable rather than lost. */
  private resetGesture(commitPending: boolean): void {
    if (commitPending) {
      this.commitDrag();
      this.commitErase();
    }
    this.hasMovedElements = false;
    this.isErasingGesture = false;
    this.eraseChangedPending = false;

    if (this.pointerId !== null && this.activeCanvas.hasPointerCapture?.(this.pointerId)) {
      this.activeCanvas.releasePointerCapture(this.pointerId);
    }
    this.isPointerDown = false;
    this.pointerId = null;
    this.isPanning = false;
    this.touches.clear();
    this.pendingTextPoint = null;

    this.currentStrokePoints = [];
    this.shapeStartPoint = null;
    this.currentShape = null;
    this.isDraggingSelected = false;
    this.dragStartPoint = null;
    this.dragOffset = { x: 0, y: 0 };
    this.draggedSet = null;
    this.isMarqueeSelecting = false;
    this.marqueeStartPoint = null;
    this.currentMarqueeBBox = null;

    if (this.strokeRafId !== null) {
      cancelAnimationFrame(this.strokeRafId);
      this.strokeRafId = null;
    }
    this.clearActiveCanvas();
  }

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (!this.isActiveMode) return;
    if (e.button !== 0) return;
    if (e.pointerType === 'touch' && this.beginTouch(e)) return;
    if (this.isPointerDown) {
      // A second finger or pen must not hijack the gesture already in progress.
      if (e.pointerId !== this.pointerId) return;
      // Same pointer pressed again: its pointerup was lost, so start afresh.
      this.resetGesture(true);
    }

    this.isPointerDown = true;
    this.pointerId = e.pointerId;
    this.activeCanvas.setPointerCapture?.(e.pointerId);

    const docPt = this.clientToDoc(e.clientX, e.clientY);
    const tool = this.activeTool;

    if (tool === 'select') {
      this.beginSelectGesture(docPt, e.shiftKey || e.ctrlKey || e.metaKey);
      return;
    }

    if (tool === 'text') {
      if (e.pointerType === 'touch') this.pendingTextPoint = docPt;
      else this.callbacks.onTextCreateRequested?.(docPt);
      return;
    }

    if (tool === 'eraser') {
      this.isErasingGesture = true;
      this.eraseChangedPending = false;
      this.eraseAtPoints([docPt]);
      return;
    }

    if (tool === 'pen' || tool === 'highlighter') {
      if (tool === 'highlighter') this.activeBlend = blendAt(e.clientX, e.clientY, this.isOwnNode) ?? this.currentPageBlend();
      this.currentStrokePoints = [this.clientToDoc(e.clientX, e.clientY, e.pressure)];
      this.scheduleActiveStrokeDraw();
      return;
    }

    if (isShapeType(tool)) {
      this.shapeStartPoint = docPt;
      this.currentShape = {
        id: `shape_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        type: tool,
        bbox: { minX: docPt.x, minY: docPt.y, maxX: docPt.x, maxY: docPt.y },
        strokeColor: this.strokeColor,
        strokeWidth: this.strokeWidth,
        opacity: 1,
        createdAt: Date.now(),
        startX: docPt.x,
        startY: docPt.y,
        endX: docPt.x,
        endY: docPt.y,
      };
    }
  };

  private beginSelectGesture(docPt: Point, toggle: boolean): void {
    const hit = this.hitTest(docPt);
    if (hit) {
      if (toggle) {
        const idx = this.selectedElements.indexOf(hit);
        if (idx >= 0) {
          this.selectedElements.splice(idx, 1);
        } else {
          this.selectedElements.push(hit);
        }
      } else if (!this.selectedElements.includes(hit)) {
        this.selectedElements = [hit];
      }

      this.isDraggingSelected = true;
      this.hasMovedElements = false;
      this.dragStartPoint = docPt;
      this.renderBase();
      return;
    }

    if (this.selectedElements.length > 1 && this.isPointInsideUnionBBox(docPt)) {
      this.isDraggingSelected = true;
      this.hasMovedElements = false;
      this.dragStartPoint = docPt;
      return;
    }

    this.selectedElements = [];
    this.isMarqueeSelecting = true;
    this.marqueeStartPoint = docPt;
    this.currentMarqueeBBox = null;
    this.renderBase();
  }

  /** Returns true when the finger scrolls the page rather than starting a drawing gesture. */
  private beginTouch(e: PointerEvent): boolean {
    if (!this.isPointerDown && !this.isPanning) this.touches.clear();
    this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.isPanning) return true;

    if (this.touches.size > 1) {
      // The first finger's half-made gesture is dropped, so a two-finger scroll leaves no stray mark.
      const fingers = new Map(this.touches);
      this.resetGesture(true);
      this.touches = fingers;
      this.isPanning = true;
      return true;
    }

    if (this.activeTool !== 'select') return false;
    const docPt = this.clientToDoc(e.clientX, e.clientY);
    const onSelection = this.selectedElements.length > 1 && this.isPointInsideUnionBBox(docPt);
    if (this.hitTest(docPt) || onSelection) return false;
    if (this.selectedElements.length > 0) {
      this.selectedElements = [];
      this.renderBase();
    }
    this.isPanning = true;
    return true;
  }

  private panBy(e: PointerEvent): void {
    const last = this.touches.get(e.pointerId);
    if (!last) return;
    this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    // Each finger moves the page by its share, so two fingers moving together scroll as far as they travel.
    const share = this.touches.size;
    window.scrollBy(-(e.clientX - last.x) / share, -(e.clientY - last.y) / share);
  }

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (this.isPanning && this.isActiveMode) {
      this.panBy(e);
      return;
    }
    if (this.touches.has(e.pointerId)) this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!this.isPointerDown || !this.isActiveMode) return;
    if (e.pointerId !== this.pointerId) return;

    const coalesced = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
    const events = coalesced.length > 0 ? coalesced : [e];

    if (this.activeTool === 'eraser') {
      this.eraseAtPoints(events.map((ev) => this.clientToDoc(ev.clientX, ev.clientY)));
      return;
    }

    if (this.activeTool === 'select') {
      this.continueSelectGesture(this.clientToDoc(e.clientX, e.clientY));
      return;
    }

    if (this.activeTool === 'pen' || this.activeTool === 'highlighter') {
      for (const ev of events) {
        const pt = this.clientToDoc(ev.clientX, ev.clientY, ev.pressure);
        const last = this.currentStrokePoints[this.currentStrokePoints.length - 1];
        if (!last || Math.hypot(pt.x - last.x, pt.y - last.y) >= 1) {
          this.currentStrokePoints.push(pt);
        }
      }
      this.scheduleActiveStrokeDraw();
      return;
    }

    if (this.shapeStartPoint && this.currentShape) {
      const docPt = this.clientToDoc(e.clientX, e.clientY);
      if (e.shiftKey) {
        const dx = docPt.x - this.shapeStartPoint.x;
        const dy = docPt.y - this.shapeStartPoint.y;
        if (this.currentShape.type === 'rect' || this.currentShape.type === 'circle') {
          const maxDim = Math.max(Math.abs(dx), Math.abs(dy));
          docPt.x = this.shapeStartPoint.x + Math.sign(dx || 1) * maxDim;
          docPt.y = this.shapeStartPoint.y + Math.sign(dy || 1) * maxDim;
        } else {
          const angle = Math.atan2(dy, dx);
          const snap = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
          const len = Math.hypot(dx, dy);
          docPt.x = Math.round(this.shapeStartPoint.x + len * Math.cos(snap));
          docPt.y = Math.round(this.shapeStartPoint.y + len * Math.sin(snap));
        }
      }
      this.currentShape.endX = docPt.x;
      this.currentShape.endY = docPt.y;
      this.currentShape.bbox = computeBoundingBox(this.currentShape);
      this.drawActiveShape();
    }
  };

  private continueSelectGesture(docPt: Point): void {
    if (this.isDraggingSelected && this.selectedElements.length > 0 && this.dragStartPoint) {
      this.draggedSet ??= new Set(this.selectedElements);
      this.dragOffset = { x: docPt.x - this.dragStartPoint.x, y: docPt.y - this.dragStartPoint.y };
      this.hasMovedElements = this.dragOffset.x !== 0 || this.dragOffset.y !== 0;
      this.renderBase();
      return;
    }

    if (this.isMarqueeSelecting && this.marqueeStartPoint) {
      this.currentMarqueeBBox = {
        minX: Math.min(this.marqueeStartPoint.x, docPt.x),
        minY: Math.min(this.marqueeStartPoint.y, docPt.y),
        maxX: Math.max(this.marqueeStartPoint.x, docPt.x),
        maxY: Math.max(this.marqueeStartPoint.y, docPt.y),
      };
      this.drawMarquee();
    }
  }

  private readonly onPointerUp = (e: PointerEvent): void => {
    this.touches.delete(e.pointerId);
    if (this.isPanning) {
      if (this.touches.size === 0) this.isPanning = false;
      return;
    }
    if (!this.isPointerDown || e.pointerId !== this.pointerId) return;

    const tool = this.activeTool;
    if (tool === 'text') {
      const pt = this.pendingTextPoint;
      this.resetGesture(true);
      if (pt && e.type === 'pointerup') this.callbacks.onTextCreateRequested?.(pt);
      return;
    }
    if (tool === 'select') {
      this.finishMarquee();
    } else if (tool === 'pen' || tool === 'highlighter') {
      this.commitStroke(tool);
    } else {
      this.commitShape();
    }
    this.resetGesture(true);
  };

  private finishMarquee(): void {
    const box = this.currentMarqueeBBox;
    if (!this.isMarqueeSelecting || !box) return;
    if (box.maxX - box.minX > 3 || box.maxY - box.minY > 3) {
      this.selectedElements = this.elements.filter((el) => {
        const eff = this.getElementEffectiveBBox(el);
        return !this.isHidden(eff) && intersectsBoundingBox(eff.bbox, box);
      });
    }
    this.clearActiveCanvas();
    this.renderBase();
  }

  /** Applies a finished drag once. Small selections are re-anchored to whatever they were dropped on; large ones keep their anchors, which stays correct and avoids thousands of DOM lookups. */
  private commitDrag(): void {
    const { x, y } = this.dragOffset;
    this.dragOffset = { x: 0, y: 0 };
    this.draggedSet = null;
    if (!this.hasMovedElements) return;
    this.hasMovedElements = false;

    const reanchor = this.isDomAnchoringEnabled && this.selectedElements.length <= REANCHOR_MAX_ELEMENTS;
    const replacements = new Map<AnchorElement, AnchorElement>();
    for (const el of this.selectedElements) {
      if (!reanchor) {
        replacements.set(el, this.movedElement(el, x, y));
        continue;
      }
      // Bake the live anchor offset into the stored coordinates, or the element would jump back by it once re-anchored.
      const { deltaX, deltaY } = this.getElementEffectiveBBox(el);
      const placed = this.movedElement(el, x + deltaX, y + deltaY);
      placed.anchor = this.anchorManager.captureAnchor(placed.bbox, anchorHint(placed));
      replacements.set(el, placed);
    }
    this.replaceElements(replacements);
    this.emitChange();
    this.renderBase();
  }

  private commitStroke(type: StrokeElement['type']): void {
    const raw = this.currentStrokePoints;
    if (raw.length === 0) return;

    const isHighlighter = type === 'highlighter';
    const width = isHighlighter ? this.highlighterWidth : this.strokeWidth;
    const straight = isHighlighter ? straightenHighlight(raw) : null;
    const points = straight ?? (this.strokeSimplification ? simplifyPointsRDP(raw, 0.7) : raw.slice());

    const stroke: StrokeElement = {
      id: `stroke_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      type,
      points,
      strokeColor: isHighlighter ? this.highlighterColor : this.strokeColor,
      strokeWidth: width,
      opacity: isHighlighter ? this.highlighterOpacity : 1.0,
      createdAt: Date.now(),
      bbox: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    };
    stroke.bbox = computeBoundingBox(stroke);

    if (this.isDomAnchoringEnabled) {
      stroke.anchor = this.anchorManager.captureAnchor(stroke.bbox, points[0]);
    }

    // The preview was traced from the raw points; reusing that outline stops the stroke reshaping on lift.
    if (raw.length > 1 && !straight) {
      this.strokeOutlines.set(stroke, getFreehandOutline(raw, strokeRenderOptions(type, width)));
    }

    this.elements.push(stroke);
    this.clearActiveCanvas();
    this.emitChange();
    this.renderBase();
  }

  private commitShape(): void {
    const shape = this.currentShape;
    if (!shape) return;
    const dist = Math.hypot(shape.endX - shape.startX, shape.endY - shape.startY);
    if (dist >= 4) {
      if (this.isDomAnchoringEnabled) {
        shape.anchor = this.anchorManager.captureAnchor(shape.bbox, anchorHint(shape));
      }
      this.elements.push(shape);
      this.emitChange();
    }
    this.clearActiveCanvas();
    this.renderBase();
  }

  private eraseAtPoints(points: Point[]): void {
    const prevCount = this.elements.length;
    this.elements = this.elements.filter((el) => {
      const local = this.toElementSpace(el);
      if (!local) return true;
      return !points.some((pt) => (!local.clip || containsPoint(local.clip, pt)) && isPointNearElement({ x: pt.x - local.x, y: pt.y - local.y }, el, 12));
    });
    if (this.elements.length !== prevCount) {
      const remaining = new Set(this.elements);
      this.selectedElements = this.selectedElements.filter((el) => remaining.has(el));
      this.eraseChangedPending = true;
      this.renderBase();
    }
  }

  /**
   * Ends an eraser sweep. The removals are reported once, so a single sweep
   * costs one undo step instead of one per pointer event.
   */
  private commitErase(): void {
    this.isErasingGesture = false;
    if (!this.eraseChangedPending) return;
    this.eraseChangedPending = false;
    this.emitChange();
  }

  /** Live anchor offset (and pane clip) of a rendered element, or null when it is hidden. */
  private toElementSpace(el: AnchorElement): (Point & { clip?: BoundingBox }) | null {
    const eff = this.getElementEffectiveBBox(el);
    if (this.isHidden(eff)) return null;
    return { x: eff.deltaX, y: eff.deltaY, clip: eff.clip };
  }

  private hitTest(pt: Point): AnchorElement | null {
    for (let i = this.elements.length - 1; i >= 0; i--) {
      const el = this.elements[i];
      const offset = this.toElementSpace(el);
      if (offset && (!offset.clip || containsPoint(offset.clip, pt)) && isPointNearElement({ x: pt.x - offset.x, y: pt.y - offset.y }, el, 8)) {
        return el;
      }
    }
    return null;
  }

  /** Returns a moved copy; committed elements are never mutated. */
  private movedElement(el: AnchorElement, dx: number, dy: number): AnchorElement {
    let moved: AnchorElement;
    if (isShapeElement(el)) {
      moved = { ...el, startX: el.startX + dx, startY: el.startY + dy, endX: el.endX + dx, endY: el.endY + dy };
    } else if (el.type === 'text') {
      moved = { ...el, x: el.x + dx, y: el.y + dy };
    } else {
      const stroke: StrokeElement = { ...el, points: el.points.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })) };
      const outline = this.strokeOutlines.get(el);
      if (outline) this.strokeOutlines.set(stroke, translateFreehandOutline(outline, dx, dy));
      moved = stroke;
    }
    moved.bbox = computeBoundingBox(moved);
    return moved;
  }

  private replaceElements(replacements: Map<AnchorElement, AnchorElement>): void {
    this.elements = this.elements.map((el) => replacements.get(el) ?? el);
    this.selectedElements = this.selectedElements.map((el) => replacements.get(el) ?? el);
  }

  private withMeasuredText(el: AnchorElement): AnchorElement {
    if (el.type !== 'text') return el;
    const { width, height } = this.measureTextBox(el.text, el.fontSize);
    const measured: TextElement = { ...el, width, height };
    measured.bbox = computeBoundingBox(measured);
    if (el.width === width && el.height === height && sameBBox(el.bbox, measured.bbox)) return el;
    return measured;
  }

  private measureTextBox(text: string, fontSize: number): { width: number; height: number } {
    const cacheKey = `${fontSize}\u0000${text}`;
    const cached = this.textMetricsCache.get(cacheKey);
    if (cached) return cached;

    if (this.measureCtx === undefined) {
      this.measureCtx = document.createElement('canvas').getContext('2d');
    }
    const lines = text.split('\n');
    let maxWidth = 0;
    if (this.measureCtx) {
      this.measureCtx.font = textFont(fontSize);
      for (const line of lines) {
        maxWidth = Math.max(maxWidth, this.measureCtx.measureText(line).width);
      }
    } else {
      // No 2D context (e.g. a headless DOM): estimate from an average glyph width.
      maxWidth = Math.max(...lines.map((line) => line.length)) * fontSize * 0.6;
    }

    const box = {
      width: Math.max(maxWidth + TEXT_PADDING * 2, TEXT_MIN_WIDTH),
      height: Math.max(lines.length * fontSize * 1.35 + TEXT_PADDING * 2, TEXT_MIN_HEIGHT),
    };
    if (this.textMetricsCache.size > 500) this.textMetricsCache.clear();
    this.textMetricsCache.set(cacheKey, box);
    return box;
  }

  private clearActiveCanvas(): void {
    this.activeCtx?.clearRect(0, 0, this.activeCanvas.width, this.activeCanvas.height);
    if (!this.activeLayerPainted) return;
    this.activeLayerPainted = false;
    for (const blend of HIGHLIGHT_BLENDS) {
      const { active, activeCtx } = this.layers[blend];
      activeCtx?.clearRect(0, 0, active.width, active.height);
    }
  }

  /** Saves `ctx` and maps document coordinates onto the viewport-fixed canvas; pair with `ctx.restore()`. */
  private beginDocTransform(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.scale(this.dpr, this.dpr);
    ctx.translate(-window.scrollX, -window.scrollY);
  }

  /** perfect-freehand reprocesses the whole stroke, so redraw at most once per frame. */
  private scheduleActiveStrokeDraw(): void {
    if (this.strokeRafId !== null) return;
    this.strokeRafId = requestAnimationFrame(() => {
      this.strokeRafId = null;
      this.drawActiveStroke();
    });
  }

  private drawActiveStroke(): void {
    this.clearActiveCanvas();
    const ctx = this.activeCtx;
    if (this.currentStrokePoints.length === 0 || !ctx) return;
    if (this.activeTool !== 'pen' && this.activeTool !== 'highlighter') return;

    if (this.activeTool === 'highlighter') {
      const layerCtx = this.layers[this.activeBlend].activeCtx;
      if (!layerCtx) return;
      this.sizeLayer(this.layers[this.activeBlend]);
      this.activeLayerPainted = true;
      this.beginDocTransform(layerCtx);
      layerCtx.fillStyle = this.highlighterColor;
      layerCtx.globalAlpha = this.highlighterOpacity;
      const straight = straightenHighlight(this.currentStrokePoints);
      if (straight) fillHighlightBar(layerCtx, straight[0], straight[1], this.highlighterWidth);
      else renderFreehandStroke(layerCtx, this.currentStrokePoints, strokeRenderOptions('highlighter', this.highlighterWidth));
      layerCtx.restore();
      return;
    }

    this.beginDocTransform(ctx);
    ctx.fillStyle = this.strokeColor;
    renderFreehandStroke(ctx, this.currentStrokePoints, strokeRenderOptions(this.activeTool, this.strokeWidth));
    ctx.restore();
  }

  private drawActiveShape(): void {
    this.clearActiveCanvas();
    const ctx = this.activeCtx;
    if (!this.currentShape || !ctx) return;

    this.beginDocTransform(ctx);
    this.renderSingleElement(ctx, this.currentShape);
    ctx.restore();
  }

  public renderBase(): void {
    const ctx = this.baseCtx;
    if (!ctx) return;

    ctx.clearRect(0, 0, this.baseCanvas.width, this.baseCanvas.height);
    this.attachHighlightLayers();
    const highlightCtxs: Partial<Record<HighlightBlend, CanvasRenderingContext2D>> = {};
    const highlightCtx = (blend: HighlightBlend): CanvasRenderingContext2D | null => {
      const existing = highlightCtxs[blend];
      if (existing) return existing;
      const { base, baseCtx } = this.layers[blend];
      if (!baseCtx) return null;
      this.sizeLayer(this.layers[blend]);
      baseCtx.clearRect(0, 0, base.width, base.height);
      this.beginDocTransform(baseCtx);
      highlightCtxs[blend] = baseCtx;
      return baseCtx;
    };
    this.anchorManager.syncScroll();
    this.beginDocTransform(ctx);

    const viewportBox: BoundingBox = {
      minX: window.scrollX - 20,
      minY: window.scrollY - 20,
      maxX: window.scrollX + this.viewportWidth + 20,
      maxY: window.scrollY + this.viewportHeight + 20,
    };

    for (const el of this.elements) {
      const eff = this.getElementEffectiveBBox(el);
      if (this.isHidden(eff)) continue;
      // Viewport frustum culling is always on: an element whose effective
      // bounding box misses the padded viewport cannot be visible.
      if (!intersectsBoundingBox(eff.bbox, viewportBox)) continue;
      const target = el.type === 'highlighter' ? (highlightCtx(this.blendFor(el, eff)) ?? ctx) : ctx;
      this.renderSingleElementWithOffset(target, el, eff);
    }

    this.renderSelection(ctx, viewportBox);
    ctx.restore();
    // A layer is only cleared when it was drawn on, so pages without highlights pay nothing for them.
    for (const blend of HIGHLIGHT_BLENDS) {
      const used = highlightCtxs[blend];
      const layer = this.layers[blend];
      if (used) used.restore();
      else if (this.layerPainted[blend]) layer.baseCtx?.clearRect(0, 0, layer.base.width, layer.base.height);
      this.layerPainted[blend] = !!used;
    }
    this.reportSelectionChange();
  }

  /** Where every drawing sits right now; an export takes it before scrolling so drawings on fixed elements stay put. */
  public measurePlacement(): RegionPlacement {
    this.anchorManager.syncScroll();
    return {
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      boxes: new Map(this.elements.map((el) => [el, this.getElementEffectiveBBox(el)])),
    };
  }

  /** Draws the visible drawings inside `region` (document CSS pixels) onto `ctx`, whose origin is the region's top-left at `scale` pixels per CSS pixel. */
  public renderRegion(ctx: CanvasRenderingContext2D, region: BoundingBox, scale: number, baseline?: RegionPlacement): void {
    if (!this.getAnnotationsVisible()) return;
    this.anchorManager.syncScroll();
    const padded: BoundingBox = {
      minX: region.minX - 20,
      minY: region.minY - 20,
      maxX: region.maxX + 20,
      maxY: region.maxY + 20,
    };
    const scrolledX = baseline ? window.scrollX - baseline.scrollX : 0;
    const scrolledY = baseline ? window.scrollY - baseline.scrollY : 0;
    ctx.save();
    ctx.setTransform(scale, 0, 0, scale, -region.minX * scale, -region.minY * scale);
    const visible: Array<[AnchorElement, EffectiveBBox]> = [];
    for (const el of this.elements) {
      let eff = this.getElementEffectiveBBox(el);
      const before = baseline?.boxes.get(el);
      // A drawing that moved exactly as far as the page scrolled is attached to a fixed element; keep it where it was, or it repeats in every strip.
      if (before && (scrolledX || scrolledY) && Math.abs(eff.bbox.minX - before.bbox.minX - scrolledX) < 1 && Math.abs(eff.bbox.minY - before.bbox.minY - scrolledY) < 1) {
        eff = before;
      }
      if (this.isHidden(eff) || !intersectsBoundingBox(eff.bbox, padded)) continue;
      visible.push([el, eff]);
    }
    // Highlights go under the other drawings, as they do on screen.
    for (const [el, eff] of visible) {
      if (el.type !== 'highlighter') continue;
      ctx.save();
      const blend = this.blendFor(el, this.getElementEffectiveBBox(el));
      ctx.globalCompositeOperation = blend;
      this.renderSingleElementWithOffset(ctx, el, eff, blend === 'screen' ? DARK_BACKGROUND_STRENGTH : 1);
      ctx.restore();
    }
    for (const [el, eff] of visible) {
      if (el.type !== 'highlighter') this.renderSingleElementWithOffset(ctx, el, eff);
    }
    ctx.restore();
  }

  private reportSelectionChange(): void {
    const { list, size } = this.reportedSelection;
    if (list === this.selectedElements && size === list.length) return;
    this.reportedSelection = { list: this.selectedElements, size: this.selectedElements.length };
    this.callbacks.onSelectionChange?.();
  }

  private renderSingleElementWithOffset(ctx: CanvasRenderingContext2D, el: AnchorElement, eff: EffectiveBBox, alphaScale = 1): void {
    ctx.save();
    if (eff.clip) {
      ctx.beginPath();
      ctx.rect(eff.clip.minX, eff.clip.minY, eff.clip.maxX - eff.clip.minX, eff.clip.maxY - eff.clip.minY);
      ctx.clip();
    }
    if (eff.deltaX !== 0 || eff.deltaY !== 0) {
      ctx.translate(eff.deltaX, eff.deltaY);
    }
    this.renderSingleElement(ctx, el, (eff.isOrphaned ? ORPHAN_DIM_FACTOR : 1) * alphaScale);

    if (eff.isOrphaned) {
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.65)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      const b = el.bbox;
      ctx.strokeRect(b.minX - 3, b.minY - 3, b.maxX - b.minX + 6, b.maxY - b.minY + 6);
    }
    ctx.restore();
  }

  private renderSingleElement(ctx: CanvasRenderingContext2D, el: AnchorElement, alphaFactor = 1): void {
    ctx.save();
    ctx.globalAlpha = baseOpacity(el) * alphaFactor;
    ctx.strokeStyle = el.strokeColor;
    ctx.fillStyle = el.strokeColor;
    ctx.lineWidth = el.strokeWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    switch (el.type) {
      case 'pen':
      case 'highlighter':
        this.renderStroke(ctx, el);
        break;

      case 'rect': {
        const x = Math.min(el.startX, el.endX);
        const y = Math.min(el.startY, el.endY);
        const w = Math.abs(el.endX - el.startX);
        const h = Math.abs(el.endY - el.startY);

        ctx.beginPath();
        ctx.rect(x, y, w, h);
        if (el.fillColor) {
          ctx.fillStyle = el.fillColor;
          ctx.fill();
        }
        ctx.stroke();
        break;
      }

      case 'circle': {
        const cx = (el.startX + el.endX) / 2;
        const cy = (el.startY + el.endY) / 2;
        const rx = Math.abs(el.endX - el.startX) / 2;
        const ry = Math.abs(el.endY - el.startY) / 2;

        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        if (el.fillColor) {
          ctx.fillStyle = el.fillColor;
          ctx.fill();
        }
        ctx.stroke();
        break;
      }

      case 'line':
      case 'arrow':
      case 'double-arrow': {
        ctx.beginPath();
        ctx.moveTo(el.startX, el.startY);
        ctx.lineTo(el.endX, el.endY);
        ctx.stroke();

        if (el.type !== 'line') {
          const angle = Math.atan2(el.endY - el.startY, el.endX - el.startX);
          const headSize = Math.max(12, el.strokeWidth * 3.5);
          renderArrowHead(ctx, el.endX, el.endY, angle, headSize);
          if (el.type === 'double-arrow') {
            renderArrowHead(ctx, el.startX, el.startY, angle + Math.PI, headSize);
          }
        }
        break;
      }

      case 'text':
        this.renderTextElement(ctx, el);
        break;
    }

    ctx.restore();
  }

  private renderStroke(ctx: CanvasRenderingContext2D, el: StrokeElement): void {
    if (el.type === 'highlighter' && el.points.length === 2) {
      fillHighlightBar(ctx, el.points[0], el.points[1], el.strokeWidth);
      return;
    }
    const options = strokeRenderOptions(el.type, el.strokeWidth);
    if (el.points.length < 2) {
      renderFreehandStroke(ctx, el.points, options);
      return;
    }
    let outline = this.strokeOutlines.get(el);
    if (!outline) {
      outline = getFreehandOutline(el.points, options);
      this.strokeOutlines.set(el, outline);
    }
    renderFreehandStroke(ctx, el.points, options, outline);
  }

  private renderTextElement(ctx: CanvasRenderingContext2D, el: TextElement): void {
    const lines = el.text.split('\n');
    const lineHeight = el.fontSize * 1.35;
    const boxW = el.width ?? TEXT_MIN_WIDTH;
    const boxH = el.height ?? TEXT_MIN_HEIGHT;

    ctx.save();
    ctx.fillStyle = el.bgColor || 'rgba(15, 23, 42, 0.85)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 1;
    this.roundRect(ctx, el.x, el.y, boxW, boxH, 6);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    ctx.font = textFont(el.fontSize);
    ctx.textBaseline = 'top';
    ctx.fillStyle = el.fontColor || '#ffffff';
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], el.x + TEXT_PADDING, el.y + TEXT_PADDING + i * lineHeight);
    }
  }

  /** Effective bounds covering every rendered element in `elements`, or null if none is rendered. */
  private unionBBox(elements: AnchorElement[]): BoundingBox | null {
    let union: BoundingBox | null = null;
    for (const el of elements) {
      const eff = this.getElementEffectiveBBox(el);
      if (this.isHidden(eff)) continue;
      union = union
        ? {
            minX: Math.min(union.minX, eff.bbox.minX),
            minY: Math.min(union.minY, eff.bbox.minY),
            maxX: Math.max(union.maxX, eff.bbox.maxX),
            maxY: Math.max(union.maxY, eff.bbox.maxY),
          }
        : eff.bbox;
    }
    return union;
  }

  private isPointInsideUnionBBox(pt: Point): boolean {
    const union = this.unionBBox(this.selectedElements);
    if (!union) return false;
    return pt.x >= union.minX - 8 && pt.x <= union.maxX + 8 && pt.y >= union.minY - 8 && pt.y <= union.maxY + 8;
  }

  private drawMarquee(): void {
    this.clearActiveCanvas();
    const ctx = this.activeCtx;
    if (!this.currentMarqueeBBox || !ctx) return;

    this.beginDocTransform(ctx);

    const b = this.currentMarqueeBBox;
    const w = b.maxX - b.minX;
    const h = b.maxY - b.minY;

    ctx.fillStyle = 'rgba(143, 166, 204, 0.14)';
    ctx.fillRect(b.minX, b.minY, w, h);

    ctx.strokeStyle = SELECTION_COLOR;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(b.minX, b.minY, w, h);

    ctx.restore();
  }

  private renderSelection(ctx: CanvasRenderingContext2D, viewportBox: BoundingBox): void {
    const visible = this.selectedElements.filter((el) => this.isRendered(el));
    if (visible.length === 0) return;
    if (visible.length === 1) {
      this.renderSingleSelectionOutline(ctx, visible[0]);
      return;
    }

    for (const el of visible) {
      if (intersectsBoundingBox(this.getElementEffectiveBBox(el).bbox, viewportBox)) this.renderIndividualItemOutline(ctx, el);
    }

    const union = this.unionBBox(visible);
    if (!union) return;
    const pad = 8;
    const unionBBox: BoundingBox = {
      minX: union.minX - pad,
      minY: union.minY - pad,
      maxX: union.maxX + pad,
      maxY: union.maxY + pad,
    };

    ctx.save();
    ctx.strokeStyle = SELECTION_COLOR;
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);

    const w = unionBBox.maxX - unionBBox.minX;
    const h = unionBBox.maxY - unionBBox.minY;
    ctx.strokeRect(unionBBox.minX, unionBBox.minY, w, h);

    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = SELECTION_COLOR;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([]);
    const corners = [
      { x: unionBBox.minX, y: unionBBox.minY },
      { x: unionBBox.maxX, y: unionBBox.minY },
      { x: unionBBox.minX, y: unionBBox.maxY },
      { x: unionBBox.maxX, y: unionBBox.maxY },
    ];
    for (const c of corners) {
      ctx.fillRect(c.x - 4, c.y - 4, 8, 8);
      ctx.strokeRect(c.x - 4, c.y - 4, 8, 8);
    }

    const badgeText = `${visible.length} elements selected (drag to move all)`;
    ctx.font = textFont(12);
    const textWidth = ctx.measureText(badgeText).width;
    const badgeW = textWidth + 18;
    const badgeH = 24;
    const badgeX = unionBBox.minX;
    const badgeY = Math.max(unionBBox.minY - badgeH - 6, window.scrollY + 8);

    ctx.fillStyle = SELECTION_BADGE_BG;
    this.roundRect(ctx, badgeX, badgeY, badgeW, badgeH, 6);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'middle';
    ctx.fillText(badgeText, badgeX + 9, badgeY + badgeH / 2);

    ctx.restore();
  }

  private renderSingleSelectionOutline(ctx: CanvasRenderingContext2D, el: AnchorElement): void {
    const pad = 6;
    ctx.save();
    ctx.strokeStyle = SELECTION_COLOR;
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);

    const bbox = this.getElementEffectiveBBox(el).bbox;
    ctx.strokeRect(
      bbox.minX - pad,
      bbox.minY - pad,
      bbox.maxX - bbox.minX + pad * 2,
      bbox.maxY - bbox.minY + pad * 2
    );

    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = SELECTION_COLOR;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([]);
    const corners = [
      { x: bbox.minX - pad, y: bbox.minY - pad },
      { x: bbox.maxX + pad, y: bbox.minY - pad },
      { x: bbox.minX - pad, y: bbox.maxY + pad },
      { x: bbox.maxX + pad, y: bbox.maxY + pad },
    ];
    for (const c of corners) {
      ctx.fillRect(c.x - 3, c.y - 3, 6, 6);
      ctx.strokeRect(c.x - 3, c.y - 3, 6, 6);
    }
    ctx.restore();
  }

  private renderIndividualItemOutline(ctx: CanvasRenderingContext2D, el: AnchorElement): void {
    const pad = 3;
    ctx.save();
    ctx.strokeStyle = 'rgba(143, 166, 204, 0.45)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    const b = this.getElementEffectiveBBox(el).bbox;
    ctx.strokeRect(b.minX - pad, b.minY - pad, b.maxX - b.minX + pad * 2, b.maxY - b.minY + pad * 2);
    ctx.restore();
  }

  private roundRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number
  ): void {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /** Fully detaches the engine so a replacement instance can take over the page. */
  public destroy(): void {
    this.resetGesture(false);
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('scroll', this.onScroll, { capture: true });
    this.activeCanvas.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;

    if (this.scrollRafId !== null) cancelAnimationFrame(this.scrollRafId);
    if (this.resizeRafId !== null) cancelAnimationFrame(this.resizeRafId);
    this.scrollRafId = null;
    this.resizeRafId = null;

    this.anchorManager.destroy();
    this.textMetricsCache.clear();
    this.elements = [];
    this.selectedElements = [];
    this.callbacks = {};
    this.baseCanvas.remove();
    this.activeCanvas.remove();
    this.isDestroyed = true;
    this.themeObserver?.disconnect();
    this.darkSchemeQuery?.removeEventListener?.('change', this.invalidateTheme);
    for (const blend of HIGHLIGHT_BLENDS) this.layers[blend].host.remove();
  }
}
