import {
  AnchorElement,
  BoundingBox,
  Point,
  ShapeElement,
  StrokeElement,
  TextElement,
  ToolType,
} from './types';
import {
  computeBoundingBox,
  intersectsBoundingBox,
  isPointNearElement,
  renderArrowHead,
  renderSmoothSpline,
  simplifyPointsRDP,
} from './geometry';

export interface EngineCallbacks {
  onElementsChange?: (elements: AnchorElement[]) => void;
  onSelectionChange?: (selected: AnchorElement | null) => void;
  onTextCreateRequested?: (pt: Point) => void;
}

export class CanvasEngine {
  private baseCanvas: HTMLCanvasElement;
  private baseCtx: CanvasRenderingContext2D;
  private activeCanvas: HTMLCanvasElement;
  private activeCtx: CanvasRenderingContext2D;
  private container: HTMLElement;

  private elements: AnchorElement[] = [];
  private selectedElement: AnchorElement | null = null;
  private selectedOriginalPos: { x: number; y: number } | null = null;
  private isDraggingSelected = false;
  private dragStartPoint: Point | null = null;

  // Active tool state
  private activeTool: ToolType = 'pen';
  private strokeColor = '#ef4444';
  private strokeWidth = 4;
  private highlighterColor = '#facc15';
  private highlighterWidth = 20;
  private fontSize = 18;
  private isActiveMode = false;

  // Real-time drawing state
  private isPointerDown = false;
  private pointerId: number | null = null;
  private currentStrokePoints: Point[] = [];
  private shapeStartPoint: Point | null = null;
  private currentShape: ShapeElement | null = null;

  // Rendering optimization
  private rafId: number | null = null;
  private scrollRafId: number | null = null;
  private dpr = 1;
  private callbacks: EngineCallbacks;

  constructor(container: HTMLElement, callbacks: EngineCallbacks = {}) {
    this.container = container;
    this.callbacks = callbacks;

    // Create Base Canvas
    this.baseCanvas = document.createElement('canvas');
    this.baseCanvas.className = 'page-anchor-base-canvas';
    this.baseCanvas.style.position = 'fixed';
    this.baseCanvas.style.top = '0';
    this.baseCanvas.style.left = '0';
    this.baseCanvas.style.width = '100vw';
    this.baseCanvas.style.height = '100vh';
    this.baseCanvas.style.pointerEvents = 'none';
    this.baseCanvas.style.zIndex = '2147483640';

    // Create Active Canvas
    this.activeCanvas = document.createElement('canvas');
    this.activeCanvas.className = 'page-anchor-active-canvas';
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

  public setTool(tool: ToolType): void {
    this.activeTool = tool;
    this.selectedElement = null;
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

  public setActiveMode(active: boolean): void {
    this.isActiveMode = active;
    if (active) {
      this.activeCanvas.style.pointerEvents = 'auto';
      this.updateCursor();
    } else {
      this.activeCanvas.style.pointerEvents = 'none';
      this.activeCanvas.style.cursor = 'default';
      this.selectedElement = null;
      this.renderBase();
    }
  }

  public getActiveMode(): boolean {
    return this.isActiveMode;
  }

  public setElements(elements: AnchorElement[]): void {
    this.elements = elements;
    this.selectedElement = null;
    this.renderBase();
  }

  public getElements(): AnchorElement[] {
    return [...this.elements];
  }

  public addElement(element: AnchorElement): void {
    this.elements.push(element);
    this.callbacks.onElementsChange?.(this.elements);
    this.renderBase();
  }

  public removeElement(id: string): void {
    this.elements = this.elements.filter((el) => el.id !== id);
    if (this.selectedElement?.id === id) {
      this.selectedElement = null;
    }
    this.callbacks.onElementsChange?.(this.elements);
    this.renderBase();
  }

  public clear(): void {
    this.elements = [];
    this.selectedElement = null;
    this.clearActiveCanvas();
    this.callbacks.onElementsChange?.(this.elements);
    this.renderBase();
  }

  public deleteSelected(): void {
    if (this.selectedElement) {
      this.removeElement(this.selectedElement.id);
    }
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
    // Clamp DPR to max 2.5 to avoid GPU memory starvation on cheap 4K laptops
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

    // Smooth passive scroll listener
    const handleScroll = () => {
      if (this.scrollRafId) return;
      this.scrollRafId = requestAnimationFrame(() => {
        this.scrollRafId = null;
        this.renderBase();
      });
    };
    window.addEventListener('scroll', handleScroll, { passive: true });

    // Pointer events on active canvas
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
    if (e.button !== 0) return; // Only primary button

    this.isPointerDown = true;
    this.pointerId = e.pointerId;
    this.activeCanvas.setPointerCapture(e.pointerId);

    const docPt = this.clientToDoc(e.clientX, e.clientY);

    if (this.activeTool === 'select') {
      // Hit test existing elements from top to bottom
      const hit = this.hitTest(docPt);
      this.selectedElement = hit;
      this.callbacks.onSelectionChange?.(hit);

      if (hit) {
        this.isDraggingSelected = true;
        this.dragStartPoint = docPt;
        if (hit.type === 'text') {
          this.selectedOriginalPos = { x: hit.x, y: hit.y };
        } else if (hit.type === 'rect' || hit.type === 'circle' || hit.type === 'line' || hit.type === 'arrow' || hit.type === 'double-arrow') {
          this.selectedOriginalPos = { x: hit.startX, y: hit.startY };
        }
      }
      this.renderBase();
      return;
    }

    if (this.activeTool === 'text') {
      // Trigger text placement
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

    // Use coalesced events if available for high-fidelity pen input
    const events = (e.getCoalescedEvents ? e.getCoalescedEvents() : [e]) as PointerEvent[];

    if (this.activeTool === 'eraser') {
      for (const ev of events) {
        this.eraseAtPoint(this.clientToDoc(ev.clientX, ev.clientY));
      }
      return;
    }

    if (this.activeTool === 'select' && this.isDraggingSelected && this.selectedElement && this.dragStartPoint) {
      const currentDocPt = this.clientToDoc(e.clientX, e.clientY);
      const dx = currentDocPt.x - this.dragStartPoint.x;
      const dy = currentDocPt.y - this.dragStartPoint.y;
      this.moveElement(this.selectedElement, dx, dy);
      this.dragStartPoint = currentDocPt;
      this.renderBase();
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
      // Support Shift key to constrain proportions / snap angles
      if (e.shiftKey) {
        const dx = docPt.x - this.shapeStartPoint.x;
        const dy = docPt.y - this.shapeStartPoint.y;
        if (this.currentShape.type === 'rect' || this.currentShape.type === 'circle') {
          const maxDim = Math.max(Math.abs(dx), Math.abs(dy));
          docPt.x = this.shapeStartPoint.x + Math.sign(dx || 1) * maxDim;
          docPt.y = this.shapeStartPoint.y + Math.sign(dy || 1) * maxDim;
        } else if (this.currentShape.type === 'line' || this.currentShape.type === 'arrow' || this.currentShape.type === 'double-arrow') {
          // Snap to 0, 45, 90 deg
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

  private onPointerUp(e: PointerEvent): void {
    if (!this.isPointerDown) return;
    this.isPointerDown = false;
    this.pointerId = null;

    if (this.activeTool === 'select') {
      this.isDraggingSelected = false;
      this.dragStartPoint = null;
      this.callbacks.onElementsChange?.(this.elements);
      return;
    }

    if (this.activeTool === 'pen' || this.activeTool === 'highlighter') {
      if (this.currentStrokePoints.length > 0) {
        const isHighlighter = this.activeTool === 'highlighter';
        // Apply RDP decimation for high performance and compact storage
        const simplified = simplifyPointsRDP(this.currentStrokePoints, 1.2);

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

        this.elements.push(strokeElem);
        this.currentStrokePoints = [];
        this.clearActiveCanvas();
        this.callbacks.onElementsChange?.(this.elements);
        this.renderBase();
      }
      return;
    }

    if (this.currentShape) {
      // Don't add accidental zero-pixel clicks
      const dist = Math.hypot(
        this.currentShape.endX - this.currentShape.startX,
        this.currentShape.endY - this.currentShape.startY
      );
      if (dist >= 4) {
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
    this.elements = this.elements.filter((el) => !isPointNearElement(pt, el, 12));
    if (this.elements.length !== prevCount) {
      this.callbacks.onElementsChange?.(this.elements);
      this.renderBase();
    }
  }

  private hitTest(pt: Point): AnchorElement | null {
    // Reverse order: check top-most elements first
    for (let i = this.elements.length - 1; i >= 0; i--) {
      if (isPointNearElement(pt, this.elements[i], 8)) {
        return this.elements[i];
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
  }

  private clearActiveCanvas(): void {
    this.activeCtx.clearRect(0, 0, this.activeCanvas.width, this.activeCanvas.height);
  }

  /**
   * Real-time preview rendering of the stroke in progress.
   * Only clears and paints the active canvas layer for maximum FPS.
   */
  private drawActiveStroke(): void {
    this.clearActiveCanvas();
    if (this.currentStrokePoints.length === 0) return;

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
    if (!this.currentShape) return;

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
    ctx.clearRect(0, 0, this.baseCanvas.width, this.baseCanvas.height);

    ctx.save();
    ctx.scale(this.dpr, this.dpr);
    ctx.translate(-window.scrollX, -window.scrollY);

    // Compute Viewport Bounding Box in document coordinates
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    const viewportBox: BoundingBox = {
      minX: scrollX - 20,
      minY: scrollY - 20,
      maxX: scrollX + window.innerWidth + 20,
      maxY: scrollY + window.innerHeight + 20,
    };

    // Render only visible elements (Zero-Lag Frustum Culling)
    for (let i = 0; i < this.elements.length; i++) {
      const el = this.elements[i];
      if (intersectsBoundingBox(el.bbox, viewportBox)) {
        this.renderSingleElement(ctx, el);
      }
    }

    // Highlight selected element if any
    if (this.selectedElement) {
      this.renderSelectionOutline(ctx, this.selectedElement);
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

    // Save calculated width/height back to element
    el.width = boxW;
    el.height = boxH;
    el.bbox = computeBoundingBox(el);

    // Background pill/card for legibility
    ctx.save();
    ctx.fillStyle = el.bgColor || 'rgba(15, 23, 42, 0.85)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 1;
    this.roundRect(ctx, el.x, el.y, boxW, boxH, 6);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // Render text lines
    ctx.fillStyle = el.fontColor || '#ffffff';
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], el.x + padding, el.y + padding + i * lineHeight);
    }
  }

  private renderSelectionOutline(ctx: CanvasRenderingContext2D, el: AnchorElement): void {
    const pad = 6;
    ctx.save();
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);

    const bbox = el.bbox;
    ctx.strokeRect(
      bbox.minX - pad,
      bbox.minY - pad,
      bbox.maxX - bbox.minX + pad * 2,
      bbox.maxY - bbox.minY + pad * 2
    );

    // Draw corner handles
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
    // Generate a temporary merged canvas
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = this.baseCanvas.width;
    tempCanvas.height = this.baseCanvas.height;
    const tempCtx = tempCanvas.getContext('2d')!;

    // Copy base annotations
    tempCtx.drawImage(this.baseCanvas, 0, 0);
    return tempCanvas.toDataURL('image/png');
  }

  public destroy(): void {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    if (this.scrollRafId) cancelAnimationFrame(this.scrollRafId);
    this.baseCanvas.remove();
    this.activeCanvas.remove();
  }
}
