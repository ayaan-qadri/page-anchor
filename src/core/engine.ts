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
import {
  computeBoundingBox,
  intersectsBoundingBox,
  isPointNearElement,
  renderArrowHead,
  renderSmoothSpline,
  simplifyPointsRDP,
} from './geometry';

export type { EngineCallbacks };

export class CanvasEngine {
  private baseCanvas: HTMLCanvasElement;
  private baseCtx: CanvasRenderingContext2D;
  private activeCanvas: HTMLCanvasElement;
  private activeCtx: CanvasRenderingContext2D;
  private container: HTMLElement;

  private elements: AnchorElement[] = [];
  private selectedElements: AnchorElement[] = [];
  private isDraggingSelected = false;
  private dragStartPoint: Point | null = null;
  private isMarqueeSelecting = false;
  private marqueeStartPoint: Point | null = null;
  private currentMarqueeBBox: BoundingBox | null = null;

  private activeTool: ToolType = 'pen';
  private strokeColor = '#ef4444';
  private strokeWidth = 4;
  private highlighterColor = '#facc15';
  private highlighterWidth = 20;
  private fontSize = 18;
  private isActiveMode = false;
  private performanceMode = true;

  private isPointerDown = false;
  private pointerId: number | null = null;
  private currentStrokePoints: Point[] = [];
  private shapeStartPoint: Point | null = null;
  private currentShape: ShapeElement | null = null;

  private rafId: number | null = null;
  private scrollRafId: number | null = null;
  private dpr = 1;
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

    this.baseCanvas = document.createElement('canvas');
    this.baseCanvas.className = 'page-anchor-base-canvas';
    this.baseCanvas.setAttribute('aria-hidden', 'true');
    this.baseCanvas.style.position = 'fixed';
    this.baseCanvas.style.top = '0';
    this.baseCanvas.style.left = '0';
    this.baseCanvas.style.width = '100vw';
    this.baseCanvas.style.height = '100vh';
    this.baseCanvas.style.pointerEvents = 'none';
    this.baseCanvas.style.zIndex = '2147483640';

    this.activeCanvas = document.createElement('canvas');
    this.activeCanvas.className = 'page-anchor-active-canvas';
    this.activeCanvas.setAttribute('aria-hidden', 'true');
    this.activeCanvas.style.position = 'fixed';
    this.activeCanvas.style.top = '0';
    this.activeCanvas.style.left = '0';
    this.activeCanvas.style.width = '100vw';
    this.activeCanvas.style.height = '100vh';
    this.activeCanvas.style.pointerEvents = 'none';
    this.activeCanvas.style.zIndex = '2147483641';

    this.container.appendChild(this.baseCanvas);
    this.container.appendChild(this.activeCanvas);

    this.baseCtx = this.baseCanvas.getContext('2d', { alpha: true })!;
    this.activeCtx = this.activeCanvas.getContext('2d', { alpha: true })!;

    this.updateDprAndSize();
    this.bindEvents();
  }

  public setDomAnchoringEnabled(enabled: boolean): void {
    this.isDomAnchoringEnabled = enabled;
    this.anchorManager.invalidateCache();
    this.renderBase();
    this.callbacks.onDomAnchoringToggle?.(enabled);
  }

  public getDomAnchoringEnabled(): boolean {
    return this.isDomAnchoringEnabled;
  }

  public setOrphanedAnchorMode(mode: OrphanedAnchorMode): void {
    this.orphanedAnchorMode = mode;
    this.renderBase();
  }

  public getOrphanedAnchorMode(): OrphanedAnchorMode {
    return this.orphanedAnchorMode;
  }

  public getElementEffectiveBBox(el: AnchorElement): {
    bbox: BoundingBox;
    deltaX: number;
    deltaY: number;
    isOrphaned: boolean;
  } {
    let deltaX = 0;
    let deltaY = 0;
    let isOrphaned = false;

    if (this.isDomAnchoringEnabled && el.anchor) {
      const res = this.anchorManager.resolve(el.anchor);
      if (res.status === 'orphaned') {
        isOrphaned = true;
      } else {
        deltaX = res.deltaX;
        deltaY = res.deltaY;
      }
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
    };
  }

  public setTool(tool: ToolType): void {
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

  public setFontSize(size: number): void {
    this.fontSize = size;
  }

  /**
   * Toggles the Zero-Lag optimizations (viewport frustum culling + RDP point
   * decimation). Disabling trades performance for completeness: every element
   * is drawn and raw pointer points are kept.
   */
  public setPerformanceMode(enabled: boolean): void {
    this.performanceMode = enabled;
    this.renderBase();
  }

  public getPerformanceMode(): boolean {
    return this.performanceMode;
  }

  public setActiveMode(active: boolean): void {
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
    // Also drop any in-progress preview so a half-drawn stroke does not linger
    // on the active layer while annotations are hidden.
    if (!visible) this.clearActiveCanvas();
  }

  public getAnnotationsVisible(): boolean {
    return this.baseCanvas.style.display !== 'none';
  }

  public setElements(elements: AnchorElement[]): void {
    this.elements = elements;
    this.selectedElements = [];
    this.renderBase();
  }

  public getElements(): AnchorElement[] {
    return [...this.elements];
  }

  public addElement(element: AnchorElement): void {
    if (this.isDomAnchoringEnabled && !element.anchor) {
      const pt = element.type === 'text' ? { x: element.x, y: element.y } : undefined;
      element.anchor = this.anchorManager.captureAnchor(element.bbox, pt);
    }
    this.elements.push(element);
    this.callbacks.onElementsChange?.(this.elements);
    this.renderBase();
  }

  public removeElement(id: string): void {
    this.elements = this.elements.filter((el) => el.id !== id);
    this.selectedElements = this.selectedElements.filter((el) => el.id !== id);
    this.callbacks.onElementsChange?.(this.elements);
    this.renderBase();
  }

  public clear(): void {
    this.elements = [];
    this.selectedElements = [];
    this.clearActiveCanvas();
    this.callbacks.onElementsChange?.(this.elements);
    this.renderBase();
  }

  /**
   * Selects all elements on the canvas and puts the engine into 'select' mode
   * so all elements can be dragged and moved together in unison.
   */
  public selectAll(): void {
    if (this.elements.length === 0) return;
    this.activeTool = 'select';
    this.updateCursor();
    this.selectedElements = [...this.elements];
    this.callbacks.onSelectionChange?.(this.selectedElements[0] || null, this.selectedElements);
    this.renderBase();
  }

  public clearSelection(): void {
    if (this.selectedElements.length > 0) {
      this.selectedElements = [];
      this.callbacks.onSelectionChange?.(null, []);
      this.renderBase();
    }
  }

  public getSelectedElements(): AnchorElement[] {
    return [...this.selectedElements];
  }

  public getSelectedElement(): AnchorElement | null {
    return this.selectedElements[0] || null;
  }

  public setSelectedElement(el: AnchorElement | null): void {
    this.selectedElements = el ? [el] : [];
    this.callbacks.onSelectionChange?.(el, this.selectedElements);
    this.renderBase();
  }

  /**
   * Translates all elements on the canvas by (dx, dy).
   */
  public moveAll(dx: number, dy: number): void {
    if (this.elements.length === 0 || (dx === 0 && dy === 0)) return;
    for (const el of this.elements) {
      this.moveElement(el, dx, dy);
    }
    this.callbacks.onElementsChange?.(this.elements);
    this.renderBase();
  }

  /**
   * Deletes all currently selected elements.
   */
  public deleteSelected(): void {
    if (this.selectedElements.length === 0) return;
    const selectedIds = new Set(this.selectedElements.map((el) => el.id));
    this.elements = this.elements.filter((el) => !selectedIds.has(el.id));
    this.selectedElements = [];
    this.callbacks.onSelectionChange?.(null, []);
    this.callbacks.onElementsChange?.(this.elements);
    this.renderBase();
  }

  private updateCursor(): void {
    if (!this.isActiveMode) {
      this.activeCanvas.style.cursor = 'default';
      return;
    }
    switch (this.activeTool) {
      case 'select':
        this.activeCanvas.style.cursor = 'default';
        break;
      case 'pen':
      case 'highlighter':
      case 'rect':
      case 'circle':
      case 'line':
      case 'arrow':
      case 'double-arrow':
        this.activeCanvas.style.cursor = 'crosshair';
        break;
      case 'text':
        this.activeCanvas.style.cursor = 'text';
        break;
      case 'eraser':
        this.activeCanvas.style.cursor = 'pointer';
        break;
    }
  }

  private updateDprAndSize(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2.5);

    const w = window.innerWidth;
    const h = window.innerHeight;

    if (this.baseCanvas.width !== w * this.dpr || this.baseCanvas.height !== h * this.dpr) {
      this.baseCanvas.width = Math.round(w * this.dpr);
      this.baseCanvas.height = Math.round(h * this.dpr);
      this.activeCanvas.width = Math.round(w * this.dpr);
      this.activeCanvas.height = Math.round(h * this.dpr);

      this.renderBase();
    }
  }

  private bindEvents(): void {
    const handleResize = () => {
      this.updateDprAndSize();
    };
    window.addEventListener('resize', handleResize, { passive: true });

    const handleScroll = () => {
      if (this.scrollRafId) return;
      this.scrollRafId = requestAnimationFrame(() => {
        this.scrollRafId = null;
        this.renderBase();
      });
    };
    window.addEventListener('scroll', handleScroll, { passive: true });

    this.activeCanvas.addEventListener('pointerdown', this.onPointerDown.bind(this));
    window.addEventListener('pointermove', this.onPointerMove.bind(this));
    window.addEventListener('pointerup', this.onPointerUp.bind(this));
    window.addEventListener('pointercancel', this.onPointerUp.bind(this));
  }

  /**
   * Translates client coordinates to document coordinates.
   */
  private clientToDoc(clientX: number, clientY: number): Point {
    return {
      x: Math.round(clientX + window.scrollX),
      y: Math.round(clientY + window.scrollY),
    };
  }

  private onPointerDown(e: PointerEvent): void {
    if (!this.isActiveMode) return;
    if (e.button !== 0) return;

    this.isPointerDown = true;
    this.pointerId = e.pointerId;
    this.activeCanvas.setPointerCapture(e.pointerId);

    const docPt = this.clientToDoc(e.clientX, e.clientY);

    if (this.activeTool === 'select') {
      const hit = this.hitTest(docPt);
      if (hit) {
        if (e.shiftKey || e.ctrlKey || e.metaKey) {
          const idx = this.selectedElements.findIndex((el) => el.id === hit.id);
          if (idx >= 0) {
            this.selectedElements.splice(idx, 1);
          } else {
            this.selectedElements.push(hit);
          }
        } else if (!this.selectedElements.some((el) => el.id === hit.id)) {
          this.selectedElements = [hit];
        }

        this.isDraggingSelected = true;
        this.dragStartPoint = docPt;
        this.callbacks.onSelectionChange?.(this.selectedElements[0] || null, this.selectedElements);
        this.renderBase();
        return;
      }

      if (this.selectedElements.length > 1 && this.isPointInsideUnionBBox(docPt)) {
        this.isDraggingSelected = true;
        this.dragStartPoint = docPt;
        return;
      }

      this.selectedElements = [];
      this.isMarqueeSelecting = true;
      this.marqueeStartPoint = docPt;
      this.currentMarqueeBBox = null;
      this.callbacks.onSelectionChange?.(null, []);
      this.renderBase();
      return;
    }

    if (this.activeTool === 'text') {
      this.callbacks.onTextCreateRequested?.(docPt);
      return;
    }

    if (this.activeTool === 'eraser') {
      this.eraseAtPoint(docPt);
      return;
    }

    if (this.activeTool === 'pen' || this.activeTool === 'highlighter') {
      this.currentStrokePoints = [docPt];
      this.drawActiveStroke();
      return;
    }

    if (
      this.activeTool === 'rect' ||
      this.activeTool === 'circle' ||
      this.activeTool === 'line' ||
      this.activeTool === 'arrow' ||
      this.activeTool === 'double-arrow'
    ) {
      this.shapeStartPoint = docPt;
      this.currentShape = {
        id: `shape_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        type: this.activeTool,
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
      return;
    }
  }

  private onPointerMove(e: PointerEvent): void {
    if (!this.isPointerDown || !this.isActiveMode) return;
    if (this.pointerId !== null && e.pointerId !== this.pointerId) return;

    const coalesced = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
    const events = (coalesced && coalesced.length > 0 ? coalesced : [e]) as PointerEvent[];

    if (this.activeTool === 'eraser') {
      for (const ev of events) {
        this.eraseAtPoint(this.clientToDoc(ev.clientX, ev.clientY));
      }
      return;
    }

    if (this.activeTool === 'select') {
      const currentDocPt = this.clientToDoc(e.clientX, e.clientY);
      if (this.isDraggingSelected && this.selectedElements.length > 0 && this.dragStartPoint) {
        const dx = currentDocPt.x - this.dragStartPoint.x;
        const dy = currentDocPt.y - this.dragStartPoint.y;
        for (const el of this.selectedElements) {
          this.moveElement(el, dx, dy);
        }
        this.dragStartPoint = currentDocPt;
        this.renderBase();
        return;
      }

      if (this.isMarqueeSelecting && this.marqueeStartPoint) {
        const minX = Math.min(this.marqueeStartPoint.x, currentDocPt.x);
        const minY = Math.min(this.marqueeStartPoint.y, currentDocPt.y);
        const maxX = Math.max(this.marqueeStartPoint.x, currentDocPt.x);
        const maxY = Math.max(this.marqueeStartPoint.y, currentDocPt.y);
        this.currentMarqueeBBox = { minX, minY, maxX, maxY };
        this.drawMarquee();
        return;
      }
      return;
    }

    if (this.activeTool === 'pen' || this.activeTool === 'highlighter') {
      for (const ev of events) {
        this.currentStrokePoints.push(this.clientToDoc(ev.clientX, ev.clientY));
      }
      this.drawActiveStroke();
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
        } else if (this.currentShape.type === 'line' || this.currentShape.type === 'arrow' || this.currentShape.type === 'double-arrow') {
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
      return;
    }
  }

  private onPointerUp(_e: PointerEvent): void {
    if (!this.isPointerDown) return;
    this.isPointerDown = false;
    this.pointerId = null;

    if (this.activeTool === 'select') {
      if (this.isDraggingSelected) {
        this.isDraggingSelected = false;
        this.dragStartPoint = null;
        if (this.isDomAnchoringEnabled) {
          for (const el of this.selectedElements) {
            el.anchor = this.anchorManager.captureAnchor(el.bbox);
          }
        }
        this.callbacks.onElementsChange?.(this.elements);
      }
      if (this.isMarqueeSelecting && this.currentMarqueeBBox) {
        const w = this.currentMarqueeBBox.maxX - this.currentMarqueeBBox.minX;
        const h = this.currentMarqueeBBox.maxY - this.currentMarqueeBBox.minY;
        if (w > 3 || h > 3) {
          this.selectedElements = this.elements.filter((el) => {
            const eff = this.getElementEffectiveBBox(el);
            if (eff.isOrphaned && this.orphanedAnchorMode === 'hide') return false;
            return intersectsBoundingBox(eff.bbox, this.currentMarqueeBBox!);
          });
          this.callbacks.onSelectionChange?.(this.selectedElements[0] || null, this.selectedElements);
        }
        this.isMarqueeSelecting = false;
        this.marqueeStartPoint = null;
        this.currentMarqueeBBox = null;
        this.clearActiveCanvas();
        this.renderBase();
      }
      return;
    }

    if (this.activeTool === 'pen' || this.activeTool === 'highlighter') {
      if (this.currentStrokePoints.length > 0) {
        const isHighlighter = this.activeTool === 'highlighter';
        const simplified = this.performanceMode
          ? simplifyPointsRDP(this.currentStrokePoints, 1.2)
          : this.currentStrokePoints.slice();

        const strokeElem: StrokeElement = {
          id: `stroke_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          type: this.activeTool,
          points: simplified,
          strokeColor: isHighlighter ? this.highlighterColor : this.strokeColor,
          strokeWidth: isHighlighter ? this.highlighterWidth : this.strokeWidth,
          opacity: isHighlighter ? 0.35 : 1.0,
          createdAt: Date.now(),
          bbox: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
        };
        strokeElem.bbox = computeBoundingBox(strokeElem);

        if (this.isDomAnchoringEnabled) {
          strokeElem.anchor = this.anchorManager.captureAnchor(
            strokeElem.bbox,
            strokeElem.points[0]
          );
        }

        this.elements.push(strokeElem);
        this.currentStrokePoints = [];
        this.clearActiveCanvas();
        this.callbacks.onElementsChange?.(this.elements);
        this.renderBase();
      }
      return;
    }

    if (this.currentShape) {
      const dist = Math.hypot(
        this.currentShape.endX - this.currentShape.startX,
        this.currentShape.endY - this.currentShape.startY
      );
      if (dist >= 4) {
        if (this.isDomAnchoringEnabled) {
          this.currentShape.anchor = this.anchorManager.captureAnchor(this.currentShape.bbox, {
            x: this.currentShape.startX,
            y: this.currentShape.startY,
          });
        }
        this.elements.push(this.currentShape);
        this.callbacks.onElementsChange?.(this.elements);
      }
      this.currentShape = null;
      this.shapeStartPoint = null;
      this.clearActiveCanvas();
      this.renderBase();
      return;
    }
  }

  private eraseAtPoint(pt: Point): void {
    const prevCount = this.elements.length;
    this.elements = this.elements.filter((el) => {
      let testPt = pt;
      if (this.isDomAnchoringEnabled && el.anchor) {
        const eff = this.getElementEffectiveBBox(el);
        if (eff.isOrphaned && this.orphanedAnchorMode === 'hide') {
          return true;
        }
        testPt = { x: pt.x - eff.deltaX, y: pt.y - eff.deltaY };
      }
      return !isPointNearElement(testPt, el, 12);
    });
    if (this.elements.length !== prevCount) {
      this.callbacks.onElementsChange?.(this.elements);
      this.renderBase();
    }
  }

  private hitTest(pt: Point): AnchorElement | null {
    for (let i = this.elements.length - 1; i >= 0; i--) {
      const el = this.elements[i];
      let testPt = pt;
      if (this.isDomAnchoringEnabled && el.anchor) {
        const eff = this.getElementEffectiveBBox(el);
        if (eff.isOrphaned && this.orphanedAnchorMode === 'hide') {
          continue;
        }
        testPt = { x: pt.x - eff.deltaX, y: pt.y - eff.deltaY };
      }
      if (isPointNearElement(testPt, el, 8)) {
        return el;
      }
    }
    return null;
  }

  private moveElement(el: AnchorElement, dx: number, dy: number): void {
    if (el.type === 'pen' || el.type === 'highlighter') {
      el.points.forEach((p) => {
        p.x += dx;
        p.y += dy;
      });
    } else if (el.type === 'text') {
      el.x += dx;
      el.y += dy;
    } else if (
      el.type === 'rect' ||
      el.type === 'circle' ||
      el.type === 'line' ||
      el.type === 'arrow' ||
      el.type === 'double-arrow'
    ) {
      el.startX += dx;
      el.startY += dy;
      el.endX += dx;
      el.endY += dy;
    }
    el.bbox = computeBoundingBox(el);
    if (el.anchor) {
      el.anchor.initialRect.left += dx;
      el.anchor.initialRect.top += dy;
    }
  }

  private clearActiveCanvas(): void {
    if (this.activeCtx) {
      this.activeCtx.clearRect(0, 0, this.activeCanvas.width, this.activeCanvas.height);
    }
  }

  /**
   * Real-time preview rendering of the stroke in progress.
   * Only clears and paints the active canvas layer for maximum FPS.
   */
  private drawActiveStroke(): void {
    this.clearActiveCanvas();
    if (this.currentStrokePoints.length === 0 || !this.activeCtx) return;

    const ctx = this.activeCtx;
    ctx.save();
    ctx.scale(this.dpr, this.dpr);
    ctx.translate(-window.scrollX, -window.scrollY);

    const isHighlighter = this.activeTool === 'highlighter';
    ctx.strokeStyle = isHighlighter ? this.highlighterColor : this.strokeColor;
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = isHighlighter ? this.highlighterWidth : this.strokeWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = isHighlighter ? 0.35 : 1.0;

    ctx.beginPath();
    renderSmoothSpline(ctx, this.currentStrokePoints);
    ctx.restore();
  }

  /**
   * Real-time preview rendering of active shape.
   */
  private drawActiveShape(): void {
    this.clearActiveCanvas();
    if (!this.currentShape || !this.activeCtx) return;

    const ctx = this.activeCtx;
    ctx.save();
    ctx.scale(this.dpr, this.dpr);
    ctx.translate(-window.scrollX, -window.scrollY);

    this.renderSingleElement(ctx, this.currentShape);
    ctx.restore();
  }

  /**
   * High performance render of all committed elements with Viewport Frustum Culling.
   */
  public renderBase(): void {
    const ctx = this.baseCtx;
    if (!ctx) return;

    ctx.clearRect(0, 0, this.baseCanvas.width, this.baseCanvas.height);

    ctx.save();
    ctx.scale(this.dpr, this.dpr);
    ctx.translate(-window.scrollX, -window.scrollY);

    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    const viewportBox: BoundingBox = {
      minX: scrollX - 20,
      minY: scrollY - 20,
      maxX: scrollX + window.innerWidth + 20,
      maxY: scrollY + window.innerHeight + 20,
    };

    for (let i = 0; i < this.elements.length; i++) {
      const el = this.elements[i];
      const eff = this.getElementEffectiveBBox(el);

      if (eff.isOrphaned && this.orphanedAnchorMode === 'hide') {
        continue;
      }

      if (this.performanceMode && !intersectsBoundingBox(eff.bbox, viewportBox)) {
        continue;
      }
      this.renderSingleElementWithOffset(ctx, el, eff.deltaX, eff.deltaY, eff.isOrphaned);
    }

    if (this.selectedElements.length > 0) {
      this.renderSelection(ctx);
    }

    ctx.restore();
  }

  private renderSingleElementWithOffset(
    ctx: CanvasRenderingContext2D,
    el: AnchorElement,
    deltaX: number,
    deltaY: number,
    isOrphaned = false
  ): void {
    ctx.save();
    if (deltaX !== 0 || deltaY !== 0) {
      ctx.translate(deltaX, deltaY);
    }
    if (isOrphaned) {
      ctx.globalAlpha = (el.opacity || 1) * 0.35;
    }
    this.renderSingleElement(ctx, el);

    if (isOrphaned) {
      ctx.save();
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.65)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      const b = el.bbox;
      ctx.strokeRect(b.minX - 3, b.minY - 3, b.maxX - b.minX + 6, b.maxY - b.minY + 6);
      ctx.restore();
    }
    ctx.restore();
  }

  private renderSingleElement(ctx: CanvasRenderingContext2D, el: AnchorElement): void {
    ctx.save();
    ctx.globalAlpha = el.opacity || 1;
    ctx.strokeStyle = el.strokeColor;
    ctx.fillStyle = el.strokeColor;
    ctx.lineWidth = el.strokeWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    switch (el.type) {
      case 'pen':
      case 'highlighter': {
        const isHighlighter = el.type === 'highlighter';
        ctx.globalAlpha = isHighlighter ? (el.opacity || 0.35) : (el.opacity || 1.0);
        ctx.beginPath();
        renderSmoothSpline(ctx, el.points);
        break;
      }

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

      case 'line': {
        ctx.beginPath();
        ctx.moveTo(el.startX, el.startY);
        ctx.lineTo(el.endX, el.endY);
        ctx.stroke();
        break;
      }

      case 'arrow': {
        ctx.beginPath();
        ctx.moveTo(el.startX, el.startY);
        ctx.lineTo(el.endX, el.endY);
        ctx.stroke();

        const angle = Math.atan2(el.endY - el.startY, el.endX - el.startX);
        const headSize = Math.max(12, el.strokeWidth * 3.5);
        renderArrowHead(ctx, el.endX, el.endY, angle, headSize);
        break;
      }

      case 'double-arrow': {
        ctx.beginPath();
        ctx.moveTo(el.startX, el.startY);
        ctx.lineTo(el.endX, el.endY);
        ctx.stroke();

        const angle = Math.atan2(el.endY - el.startY, el.endX - el.startX);
        const headSize = Math.max(12, el.strokeWidth * 3.5);
        renderArrowHead(ctx, el.endX, el.endY, angle, headSize);
        renderArrowHead(ctx, el.startX, el.startY, angle + Math.PI, headSize);
        break;
      }

      case 'text': {
        this.renderTextElement(ctx, el);
        break;
      }
    }

    ctx.restore();
  }

  private renderTextElement(ctx: CanvasRenderingContext2D, el: TextElement): void {
    ctx.font = `600 ${el.fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    ctx.textBaseline = 'top';

    const lines = el.text.split('\n');
    const lineHeight = el.fontSize * 1.35;
    const padding = 6;

    let maxWidth = 0;
    for (const line of lines) {
      const met = ctx.measureText(line);
      if (met.width > maxWidth) maxWidth = met.width;
    }
    const boxW = Math.max(maxWidth + padding * 2, el.width || 60);
    const boxH = Math.max(lines.length * lineHeight + padding * 2, el.height || 30);

    // Text sizing is measured lazily here (canvas metrics are only available at
    // draw time). The result is deterministic for a given text/font, so the
    // write-back keeps hit-testing and culling bboxes accurate.
    el.width = boxW;
    el.height = boxH;
    el.bbox = computeBoundingBox(el);

    ctx.save();
    ctx.fillStyle = el.bgColor || 'rgba(15, 23, 42, 0.85)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 1;
    this.roundRect(ctx, el.x, el.y, boxW, boxH, 6);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = el.fontColor || '#ffffff';
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], el.x + padding, el.y + padding + i * lineHeight);
    }
  }

  private isPointInsideUnionBBox(pt: Point): boolean {
    if (this.selectedElements.length === 0) return false;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const el of this.selectedElements) {
      const eff = this.getElementEffectiveBBox(el);
      minX = Math.min(minX, eff.bbox.minX);
      minY = Math.min(minY, eff.bbox.minY);
      maxX = Math.max(maxX, eff.bbox.maxX);
      maxY = Math.max(maxY, eff.bbox.maxY);
    }
    return pt.x >= minX - 8 && pt.x <= maxX + 8 && pt.y >= minY - 8 && pt.y <= maxY + 8;
  }

  private drawMarquee(): void {
    this.clearActiveCanvas();
    if (!this.currentMarqueeBBox || !this.activeCtx) return;

    const ctx = this.activeCtx;
    ctx.save();
    ctx.scale(this.dpr, this.dpr);
    ctx.translate(-window.scrollX, -window.scrollY);

    const b = this.currentMarqueeBBox;
    const w = b.maxX - b.minX;
    const h = b.maxY - b.minY;

    ctx.fillStyle = 'rgba(59, 130, 246, 0.12)';
    ctx.fillRect(b.minX, b.minY, w, h);

    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(b.minX, b.minY, w, h);

    ctx.restore();
  }

  private renderSelection(ctx: CanvasRenderingContext2D): void {
    if (this.selectedElements.length === 1) {
      this.renderSingleSelectionOutline(ctx, this.selectedElements[0]);
      return;
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const el of this.selectedElements) {
      const eff = this.getElementEffectiveBBox(el);
      minX = Math.min(minX, eff.bbox.minX);
      minY = Math.min(minY, eff.bbox.minY);
      maxX = Math.max(maxX, eff.bbox.maxX);
      maxY = Math.max(maxY, eff.bbox.maxY);

      this.renderIndividualItemOutline(ctx, el);
    }

    const pad = 8;
    const unionBBox: BoundingBox = {
      minX: minX - pad,
      minY: minY - pad,
      maxX: maxX + pad,
      maxY: maxY + pad,
    };

    ctx.save();
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);

    const w = unionBBox.maxX - unionBBox.minX;
    const h = unionBBox.maxY - unionBBox.minY;
    ctx.strokeRect(unionBBox.minX, unionBBox.minY, w, h);

    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#3b82f6';
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

    const badgeText = `${this.selectedElements.length} elements selected (drag to move all)`;
    ctx.font = '600 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    const textWidth = ctx.measureText(badgeText).width;
    const badgeW = textWidth + 18;
    const badgeH = 24;
    const badgeX = unionBBox.minX;
    const badgeY = Math.max(unionBBox.minY - badgeH - 6, window.scrollY + 8);

    ctx.fillStyle = 'rgba(30, 64, 175, 0.95)';
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
    ctx.strokeStyle = '#3b82f6';
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
    ctx.strokeStyle = '#3b82f6';
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
    ctx.strokeStyle = 'rgba(59, 130, 246, 0.45)';
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

  /**
   * Exports an annotated snapshot image (Data URL).
   */
  public exportAsDataUrl(): string {
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = this.baseCanvas.width;
    tempCanvas.height = this.baseCanvas.height;
    const tempCtx = tempCanvas.getContext('2d');

    if (tempCtx) {
      tempCtx.drawImage(this.baseCanvas, 0, 0);
    }
    return tempCanvas.toDataURL ? tempCanvas.toDataURL('image/png') : '';
  }

  public destroy(): void {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    if (this.scrollRafId) cancelAnimationFrame(this.scrollRafId);
    this.anchorManager.destroy();
    this.baseCanvas.remove();
    this.activeCanvas.remove();
  }
}
