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
  private commitPending: (() => void) | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  public open(
    pt: Point,
    options: TextEditorOptions,
    onCommit: (element: TextElement) => void,
    onCancel?: () => void
  ): void {
    this.commitPending?.();
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
    textarea.placeholder = 'Type a note';
    textarea.rows = 1;
    textarea.setAttribute('aria-label', 'Annotation text note');
    textarea.setAttribute('aria-description', 'Press Enter to save, Shift+Enter for a new line, Escape to cancel.');
    textarea.style.fontSize = `${options.fontSize}px`;
    textarea.style.color = options.fontColor;

    const hint = document.createElement('div');
    hint.className = 'pa-text-hint';
    hint.setAttribute('aria-hidden', 'true');
    hint.textContent = 'Enter to save · Shift+Enter new line · Esc to cancel';

    wrapper.appendChild(textarea);
    wrapper.appendChild(hint);
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
          bgColor: options.bgColor || 'rgba(17, 20, 31, 0.94)',
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
    this.commitPending = commit;

    textarea.addEventListener('keydown', (e: KeyboardEvent) => {
      // Keys pressed while an IME is composing belong to the composition, not the editor.
      if (e.isComposing || e.keyCode === 229) return;
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

  public isOpen(): boolean {
    return this.currentWrapper !== null;
  }

  public close(): void {
    this.commitPending = null;
    this.onCommitCallback = null;
    this.onCancelCallback = null;
    if (this.currentWrapper) {
      this.currentWrapper.remove();
      this.currentWrapper = null;
    }
  }
}
