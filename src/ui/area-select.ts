import type { CaptureRect, ExportFormat } from '../export/capture';
import { ICONS, type IconName } from '../icons/svg-icons';
import { setMarkup } from './dom';

/** Drags shorter than this are taken as a stray click, not an area. */
const MIN_SIZE = 4;

const ACTIONS_GAP = 8;

/** A click this soon after a touch lift on the same button is that tap's own click, already handled. */
const TOUCH_CLICK_WINDOW_MS = 800;

export interface AreaSelectHandlers {
  /** Takes the screenshot; the selector is inside the overlay that gets hidden for it. */
  capture(format: ExportFormat, rect: CaptureRect): Promise<Blob>;
  onSave(format: ExportFormat, blob: Blob): void;
  /** Prints the area at `width` CSS pixels; absent where the browser cannot print. */
  onPrint?(blob: Blob, width: number): Promise<void>;
  /** Absent where the page cannot write images to the clipboard. */
  onCopy?(blob: Promise<Blob>): Promise<void>;
  onError(error: unknown): void;
  onClose(): void;
}

/** Full-screen layer where the user drags out part of the visible page, then copies or saves it. */
export class AreaSelector {
  private readonly el: HTMLElement;
  private readonly box: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly actions: HTMLElement;
  private readonly listeners = new AbortController();
  private readonly returnFocus: Element | null;
  private rect: CaptureRect | null = null;
  private dragFrom: { x: number; y: number } | null = null;
  private busy = false;
  private closed = false;
  /** Where the screen sits in the page's layout and how far it is pinch-zoomed; all coordinates inside the layer are screen pixels. */
  private view = { left: 0, top: 0, scale: 1 };

  constructor(
    container: HTMLElement,
    private readonly handlers: AreaSelectHandlers
  ) {
    const root = container.getRootNode() as Document | ShadowRoot;
    this.returnFocus = root.activeElement;

    this.el = document.createElement('div');
    this.el.className = 'pa-area';
    this.el.tabIndex = -1;
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-label', 'Select an area');

    // Buttons as well as keys, since touch screens have no Enter or Esc.
    this.hint = document.createElement('div');
    this.hint.className = 'pa-area-hint';
    const hintText = document.createElement('span');
    hintText.className = 'pa-area-hint-text';
    hintText.setAttribute('aria-live', 'polite');
    hintText.textContent = 'Drag to select an area';
    this.hint.append(
      hintText,
      this.button('selectAll', 'Whole screen', 'area-whole', () => this.selectWholeScreen()),
      this.button('close', 'Cancel', 'area-close', () => this.close())
    );

    this.box = document.createElement('div');
    this.box.className = 'pa-area-box';
    this.box.hidden = true;

    this.actions = document.createElement('div');
    this.actions.className = 'pa-area-actions';
    this.actions.setAttribute('role', 'toolbar');
    this.actions.setAttribute('aria-label', 'Selected area');
    this.actions.hidden = true;
    if (handlers.onCopy) this.actions.append(this.button('copy', 'Copy', 'area-copy', () => this.copy()));
    this.actions.append(
      this.button('saveImage', 'Save PNG', 'area-png', () => this.save('png')),
      this.button('savePdf', 'Save PDF', 'area-pdf', () => this.save('pdf')),
      ...(handlers.onPrint ? [this.button('print', 'Print', 'area-print', () => this.print())] : []),
      this.button('close', '', 'area-cancel', () => this.close(), 'Cancel')
    );

    this.el.append(this.hint, this.box, this.actions);
    container.appendChild(this.el);
    this.fitToScreen();
    this.el.focus();

    const { signal } = this.listeners;
    this.el.addEventListener('pointerdown', (e) => this.startDrag(e), { signal });
    this.el.addEventListener('pointermove', (e) => this.moveDrag(e), { signal });
    this.el.addEventListener('pointerup', (e) => this.endDrag(e), { signal });
    this.el.addEventListener('pointercancel', () => this.cancelDrag(), { signal });
    // The selection is fixed to the screen, so the page must not move under it.
    this.el.addEventListener('wheel', (e) => e.preventDefault(), { passive: false, signal });
    window.addEventListener('keydown', (e) => this.onKey(e), { capture: true, signal });
    window.visualViewport?.addEventListener(
      'resize',
      () => {
        this.cancelDrag();
        this.fitToScreen();
      },
      { signal }
    );
  }

  /** A pinch-zoomed page shows only part of its layout, enlarged; the layer covers exactly that part at normal size, so its controls stay on screen. */
  private fitToScreen(): void {
    const vv = window.visualViewport;
    if (!vv) return;
    this.view = { left: vv.offsetLeft, top: vv.offsetTop, scale: vv.scale };
    Object.assign(this.el.style, {
      left: `${vv.offsetLeft}px`,
      top: `${vv.offsetTop}px`,
      width: `${vv.width * vv.scale}px`,
      height: `${vv.height * vv.scale}px`,
      transform: vv.scale === 1 ? '' : `scale(${1 / vv.scale})`,
    });
  }

  private local(e: PointerEvent): { x: number; y: number } {
    return { x: (e.clientX - this.view.left) * this.view.scale, y: (e.clientY - this.view.top) * this.view.scale };
  }

  /** Converts an area on the layer back to the page's viewport CSS pixels, which the screenshot works in. */
  private toViewport(rect: CaptureRect): CaptureRect {
    const { left, top, scale } = this.view;
    return { x: left + rect.x / scale, y: top + rect.y / scale, width: rect.width / scale, height: rect.height / scale };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.listeners.abort();
    this.el.remove();
    if (this.returnFocus instanceof HTMLElement && this.returnFocus.isConnected) this.returnFocus.focus();
    this.handlers.onClose();
  }

  private button(icon: IconName, label: string, action: string, onClick: () => void, ariaLabel?: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pa-area-btn';
    btn.dataset.action = action;
    if (ariaLabel) btn.setAttribute('aria-label', ariaLabel);
    const iconEl = document.createElement('span');
    iconEl.setAttribute('aria-hidden', 'true');
    setMarkup(iconEl, ICONS[icon]);
    btn.appendChild(iconEl);
    if (label) btn.append(label);
    // Touch acts on lift: right after a fast drag the browser can spend the tap stopping a fling and never send the click.
    let touchedAt = -Infinity;
    btn.addEventListener('pointerup', (e) => {
      if (e.pointerType !== 'touch') return;
      const r = btn.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return;
      touchedAt = performance.now();
      onClick();
    });
    btn.addEventListener('click', () => {
      if (performance.now() - touchedAt > TOUCH_CLICK_WINDOW_MS) onClick();
    });
    return btn;
  }

  private onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.close();
    } else if (e.key === 'Enter' && !this.rect && !this.busy) {
      e.preventDefault();
      e.stopPropagation();
      this.selectWholeScreen();
    }
  }

  private selectWholeScreen(): void {
    this.select({ x: 0, y: 0, width: this.el.clientWidth, height: this.el.clientHeight });
  }

  private startDrag(e: PointerEvent): void {
    if (this.busy || e.button !== 0 || this.actions.contains(e.target as Node) || this.hint.contains(e.target as Node)) return;
    e.preventDefault();
    this.el.setPointerCapture?.(e.pointerId);
    this.dragFrom = this.local(e);
    this.rect = null;
    this.actions.hidden = true;
    this.draw({ ...this.dragFrom, width: 0, height: 0 });
  }

  private moveDrag(e: PointerEvent): void {
    if (!this.dragFrom) return;
    this.draw(this.dragRect(e));
  }

  private endDrag(e: PointerEvent): void {
    if (!this.dragFrom) return;
    const rect = this.dragRect(e);
    this.dragFrom = null;
    if (rect.width < MIN_SIZE || rect.height < MIN_SIZE) {
      this.cancelDrag();
      return;
    }
    this.select(rect);
  }

  private cancelDrag(): void {
    this.dragFrom = null;
    this.rect = null;
    this.box.hidden = true;
    this.actions.hidden = true;
    this.el.classList.remove('pa-area-selecting');
  }

  private dragRect(e: PointerEvent): CaptureRect {
    const maxX = this.el.clientWidth;
    const maxY = this.el.clientHeight;
    const point = this.local(e);
    const x = Math.min(Math.max(point.x, 0), maxX);
    const y = Math.min(Math.max(point.y, 0), maxY);
    const from = this.dragFrom!;
    return { x: Math.min(from.x, x), y: Math.min(from.y, y), width: Math.abs(x - from.x), height: Math.abs(y - from.y) };
  }

  private draw(rect: CaptureRect): void {
    this.el.classList.add('pa-area-selecting');
    this.box.hidden = false;
    Object.assign(this.box.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` });
  }

  private select(rect: CaptureRect): void {
    this.rect = rect;
    this.draw(rect);
    this.actions.hidden = false;
    this.placeActions(rect);
    this.actions.querySelector('button')?.focus();
  }

  /** Below the area if it fits, else above it, else inside its bottom edge; always on screen. */
  private placeActions(rect: CaptureRect): void {
    // Measured at the left edge, where nothing squeezes the row into wrapping more than it must.
    Object.assign(this.actions.style, { left: '0px', top: '0px' });
    const { offsetWidth: w, offsetHeight: h } = this.actions;
    const viewW = this.el.clientWidth;
    const viewH = this.el.clientHeight;
    const below = rect.y + rect.height + ACTIONS_GAP;
    const above = rect.y - ACTIONS_GAP - h;
    const top = below + h <= viewH ? below : above >= 0 ? above : Math.max(0, rect.y + rect.height - h - ACTIONS_GAP);
    const left = Math.min(Math.max(ACTIONS_GAP, rect.x + rect.width - w), viewW - w - ACTIONS_GAP);
    Object.assign(this.actions.style, { left: `${Math.max(0, left)}px`, top: `${top}px` });
  }

  /** Each action shoots the area fresh, so it matches the page as it is now. */
  private start(format: ExportFormat, act: (blob: Promise<Blob>) => Promise<void>): void {
    if (!this.rect || this.busy) return;
    this.busy = true;
    act(this.handlers.capture(format, this.toViewport(this.rect)))
      .catch((error: unknown) => {
        if (!this.closed) this.handlers.onError(error);
      })
      .finally(() => this.close());
  }

  private save(format: ExportFormat): void {
    this.start(format, async (blob) => {
      const ready = await blob;
      if (!this.closed) this.handlers.onSave(format, ready);
    });
  }

  private print(): void {
    if (!this.rect) return;
    const { width } = this.toViewport(this.rect);
    this.start('png', async (blob) => {
      const ready = await blob;
      if (!this.closed) await this.handlers.onPrint!(ready, width);
    });
  }

  /** The clipboard write starts inside the click, while the browser still counts it as the user's action. */
  private copy(): void {
    this.start('png', (blob) => this.handlers.onCopy!(blob));
  }
}
