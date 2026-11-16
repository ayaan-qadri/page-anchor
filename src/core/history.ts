import { AnchorElement } from '../types/engine.types';

// Snapshots share element objects instead of deep-copying; safe because the engine replaces an element with a new object whenever it changes.
export class HistoryManager {
  private undoStack: AnchorElement[][] = [];
  private redoStack: AnchorElement[][] = [];
  private maxDepth = 51; // Retains the initial snapshot plus 50 undo steps.

  constructor(initialElements: AnchorElement[] = []) {
    this.undoStack.push(initialElements.slice());
  }

  public pushState(elements: AnchorElement[]): void {
    this.undoStack.push(elements.slice());
    if (this.undoStack.length > this.maxDepth) {
      this.undoStack.shift();
    }
    this.redoStack = [];
  }

  public undo(): AnchorElement[] | null {
    if (!this.canUndo()) return null;

    const current = this.undoStack.pop()!;
    this.redoStack.push(current);

    return this.undoStack[this.undoStack.length - 1].slice();
  }

  public redo(): AnchorElement[] | null {
    if (!this.canRedo()) return null;

    const next = this.redoStack.pop()!;
    this.undoStack.push(next);
    return next.slice();
  }

  public canUndo(): boolean {
    return this.undoStack.length > 1;
  }

  public canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  public reset(elements: AnchorElement[] = []): void {
    this.undoStack = [elements.slice()];
    this.redoStack = [];
  }
}
