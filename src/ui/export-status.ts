import type { ExportKind } from '../export/capture';
import { isTouchFirst } from './dom';

const TITLE: Record<ExportKind, string> = { png: 'Saving page as PNG image', pdf: 'Saving page as PDF', print: 'Preparing page to print' };

/** Progress panel shown while a page is saved: what is being saved, how far it is, and which actions stop it. */
export class ExportStatus {
  private readonly el: HTMLElement;
  private readonly title: HTMLElement;
  private readonly percent: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly stopBtn: HTMLButtonElement;

  constructor(root: Node, kind: ExportKind, onStop: () => void) {
    this.el = document.createElement('div');
    this.el.className = 'pa-export-status';
    this.el.setAttribute('role', 'status');
    this.el.setAttribute('aria-live', 'polite');

    const head = document.createElement('div');
    head.className = 'pa-export-status-head';
    this.title = document.createElement('span');
    this.title.className = 'pa-export-status-title';
    this.title.textContent = TITLE[kind];
    this.percent = document.createElement('span');
    this.percent.className = 'pa-export-status-percent';
    this.percent.textContent = '0%';
    head.append(this.title, this.percent);

    this.bar = document.createElement('div');
    this.bar.className = 'pa-export-status-bar';
    this.bar.setAttribute('role', 'progressbar');
    this.bar.setAttribute('aria-label', 'Progress');
    this.bar.setAttribute('aria-valuemin', '0');
    this.bar.setAttribute('aria-valuemax', '100');
    this.bar.setAttribute('aria-valuenow', '0');
    this.fill = document.createElement('div');
    this.fill.className = 'pa-export-status-fill';
    this.bar.appendChild(this.fill);

    const foot = document.createElement('div');
    foot.className = 'pa-export-status-foot';
    this.hint = document.createElement('span');
    this.hint.className = 'pa-export-status-hint';
    const stops = kind === 'print' ? 'stops printing' : 'stops saving';
    this.hint.textContent = isTouchFirst() ? `Touching the page or switching tabs ${stops}.` : `Scrolling, clicking, pressing a key or switching tabs ${stops}.`;
    this.stopBtn = document.createElement('button');
    this.stopBtn.type = 'button';
    this.stopBtn.className = 'pa-export-status-stop';
    this.stopBtn.textContent = 'Stop';
    this.stopBtn.addEventListener('click', onStop);
    foot.append(this.hint, this.stopBtn);

    this.el.append(head, this.bar, foot);
    root.appendChild(this.el);
  }

  setProgress(fraction: number): void {
    const value = Math.max(0, Math.min(100, Math.round(fraction * 100)));
    this.percent.textContent = `${value}%`;
    this.fill.style.width = `${value}%`;
    this.bar.setAttribute('aria-valuenow', String(value));
  }

  /** The page is the user's again and nothing stops the save any more; only the file is still being written. */
  setFinishing(): void {
    this.setProgress(1);
    this.title.textContent = 'Finishing…';
    this.percent.textContent = '';
    this.hint.remove();
    this.stopBtn.remove();
  }

  /** Steps out of the picture for one screenshot; call the returned function to come back. */
  hide(): () => void {
    this.el.classList.add('pa-export-status-hidden');
    return () => this.el.classList.remove('pa-export-status-hidden');
  }

  destroy(): void {
    this.el.remove();
  }
}
