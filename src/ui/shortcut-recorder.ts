import { BrowserConflictInfo } from '../types/shortcuts.types';
import { getBrowserShortcutConflict, normalizeKeyEvent } from '../core/shortcuts';

export type ShortcutRecordResult =
  | { type: 'cancel' }
  | { type: 'recorded'; combo: string; conflict: BrowserConflictInfo | null };

/**
 * Owns the one-shot window keydown capture used to rebind a shortcut, so the
 * in-page modal, the popup panel and the options page all record keystrokes the
 * same way. Callers keep their own markup and styling.
 */
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
