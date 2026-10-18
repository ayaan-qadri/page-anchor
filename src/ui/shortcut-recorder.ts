import { BrowserConflictInfo } from '../types/shortcuts.types';
import { getBrowserShortcutConflict, normalizeKeyEvent } from '../core/shortcuts';

export type ShortcutRecordResult =
  | { type: 'cancel' }
  | { type: 'recorded'; combo: string; conflict: BrowserConflictInfo | null };

export class ShortcutRecorder {
  private handler: ((e: KeyboardEvent) => void) | null = null;

  public get isRecording(): boolean {
    return this.handler !== null;
  }

  public start(onResult: (result: ShortcutRecordResult) => void): void {
    this.stop();

    this.handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === 'Escape') {
        this.stop();
        onResult({ type: 'cancel' });
        return;
      }

      const combo = normalizeKeyEvent(e);
      if (!combo) return;

      this.stop();
      onResult({ type: 'recorded', combo, conflict: getBrowserShortcutConflict(combo) });
    };

    window.addEventListener('keydown', this.handler, true);
  }

  public stop(): void {
    if (this.handler) {
      window.removeEventListener('keydown', this.handler, true);
      this.handler = null;
    }
  }
}
