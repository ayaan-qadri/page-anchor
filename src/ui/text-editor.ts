import { Point, TextElement } from '../types/engine.types';
import { computeBoundingBox } from '../core/geometry';

export interface TextEditorOptions {
  fontSize: number;
  fontColor: string;
  bgColor?: string;
}

export class TextEditorOverlay {
  private container: HTMLElement;
  private currentWrapper: HTMLElement | null = null;
  private onCommitCallback: ((element: TextElement) => void) | null = null;
  private onCancelCallback: (() => void) | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  public open(
    pt: Point,
    options: TextEditorOptions,
    onCommit: (element: TextElement) => void,
    onCancel?: () => void
  ): void {
    this.close();

    this.onCommitCallback = onCommit;
    this.onCancelCallback = onCancel || null;

    const wrapper = document.createElement('div');
    wrapper.className = 'pa-text-input-wrapper';
    wrapper.setAttribute('role', 'region');
    wrapper.setAttribute('aria-label', 'Annotation text input editor');
    // `pt` is in document coordinates and this overlay lives inside the
    // absolutely-positioned `#page-anchor-host`, so it must use doc coords
    // directly. Subtracting scroll here would offset it on scrolled pages.
    wrapper.style.left = `${pt.x}px`;
    wrapper.style.top = `${pt.y}px`;

    const textarea = document.createElement('textarea');
    textarea.className = 'pa-text-textarea';
    textarea.placeholder = 'Type note... (Enter to save, Esc to cancel)';
    textarea.setAttribute('aria-label', 'Annotation text note');
    textarea.setAttribute('aria-description', 'Type note. Press Enter to save, Escape to cancel.');
    textarea.style.fontSize = `${options.fontSize}px`;
    textarea.style.color = options.fontColor;

    wrapper.appendChild(textarea);
    this.container.appendChild(wrapper);
    this.currentWrapper = wrapper;

    setTimeout(() => {
      textarea.focus();
    }, 10);

    let isClosed = false;
    const commit = () => {
      if (isClosed) return;
      isClosed = true;
      const text = textarea.value.trim();
      if (text.length > 0) {
        const textElement: TextElement = {
          id: `text_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          type: 'text',
          x: pt.x,
          y: pt.y,
          text,
          fontSize: options.fontSize,
          fontColor: options.fontColor,
          bgColor: options.bgColor || 'rgba(15, 23, 42, 0.88)',
          strokeColor: options.fontColor,
          strokeWidth: 1,
          opacity: 1,
          createdAt: Date.now(),
          bbox: { minX: pt.x, minY: pt.y, maxX: pt.x + 120, maxY: pt.y + 40 },
        };
        textElement.bbox = computeBoundingBox(textElement);
        this.onCommitCallback?.(textElement);
      } else {
        this.onCancelCallback?.();
      }
      this.close();
    };

    textarea.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        commit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        if (!isClosed) {
          isClosed = true;
          this.onCancelCallback?.();
        }
        this.close();
      }
    });

    textarea.addEventListener('blur', () => {
      commit();
    });
  }

  public close(): void {
    this.onCommitCallback = null;
    this.onCancelCallback = null;
    if (this.currentWrapper) {
      this.currentWrapper.remove();
      this.currentWrapper = null;
    }
  }
}
