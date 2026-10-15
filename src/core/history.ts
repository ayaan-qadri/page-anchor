import { AnchorElement } from './types';

export class HistoryManager {
  private undoStack: AnchorElement[][] = [];
  private redoStack: AnchorElement[][] = [];
  private maxDepth = 50;

  constructor(initialElements: AnchorElement[] = []) {
    this.undoStack.push(this.clone(initialElements));
  }

  public pushState(elements: AnchorElement[]): void {
    this.undoStack.push(this.clone(elements));
    if (this.undoStack.length > this.maxDepth) {
      this.undoStack.shift();
    }
    // Any new action clears redo stack
    this.redoStack = [];
  }

  public undo(): AnchorElement[] | null {
    if (!this.canUndo()) return null;

    const current = this.undoStack.pop()!;
    this.redoStack.push(current);

    const previous = this.undoStack[this.undoStack.length - 1];
    return this.clone(previous);
  }

  public redo(): AnchorElement[] | null {
    if (!this.canRedo()) return null;

    const next = this.redoStack.pop()!;
    this.undoStack.push(next);
    return this.clone(next);
  }

  public canUndo(): boolean {
    return this.undoStack.length > 1;
  }

  public canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  public reset(elements: AnchorElement[] = []): void {
    this.undoStack = [this.clone(elements)];
    this.redoStack = [];
  }

  private clone(elements: AnchorElement[]): AnchorElement[] {
    // Fast deep clone of plain data objects
    return JSON.parse(JSON.stringify(elements));
  }
}
