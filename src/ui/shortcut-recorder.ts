import { BrowserConflictInfo } from '../types/shortcuts.types';
import { getBrowserShortcutConflict, normalizeKeyEvent } from '../core/shortcuts';

export type ShortcutRecordResult =
  | { type: 'cancel' }
  | { type: 'recorded'; combo: string; conflict: BrowserConflictInfo | null };

type ResultCallback = (result: ShortcutRecordResult) => void;

export class ShortcutRecorder {
  private handler: ((e: KeyboardEvent) => void) | null = null;
  private onResult: ResultCallback | null = null;

  public get isRecording(): boolean {
    return this.handler !== null;
  }

  /** Starts recording; a recording already in progress is cancelled through its own callback first. */
  public start(onResult: ResultCallback): void {
    this.cancel();
    this.onResult = onResult;

    this.handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === 'Escape') {
        this.cancel();
        return;
      }

      const combo = normalizeKeyEvent(e);
      if (!combo) return;

      this.stop();
      onResult({ type: 'recorded', combo, conflict: getBrowserShortcutConflict(combo) });
    };

    window.addEventListener('keydown', this.handler, true);
  }

  /** Stops recording and reports a cancel to the active callback. */
  public cancel(): void {
    const callback = this.onResult;
    if (!this.isRecording) return;
    this.stop();
    callback?.({ type: 'cancel' });
  }

  /** Stops recording silently. */
  public stop(): void {
    if (this.handler) {
      window.removeEventListener('keydown', this.handler, true);
      this.handler = null;
    }
    this.onResult = null;
  }
}
