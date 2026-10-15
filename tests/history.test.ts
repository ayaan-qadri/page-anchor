import { describe, it, expect } from 'vitest';
import { HistoryManager } from '../src/core/history';
import { AnchorElement } from '../src/types/engine.types';

describe('HistoryManager: Undo & Redo Reliability', () => {
  const dummyElement = (id: string): AnchorElement => ({
    id,
    type: 'pen',
    strokeColor: '#000',
    strokeWidth: 2,
    opacity: 1,
    createdAt: Date.now(),
    points: [{ x: 0, y: 0 }],
    bbox: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
  });

  it('initializes correctly with initial state and reports canUndo / canRedo', () => {
    const history = new HistoryManager([]);
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(false);

    history.pushState([dummyElement('1')]);
    expect(history.canUndo()).toBe(true);
    expect(history.canRedo()).toBe(false);
  });

  it('performs undo and redo sequentially', () => {
    const history = new HistoryManager([]);
    const el1 = dummyElement('1');
    const el2 = dummyElement('2');

    history.pushState([el1]);
    history.pushState([el1, el2]);

    const state1 = history.undo();
    expect(state1).toHaveLength(1);
    expect(state1![0].id).toBe('1');
    expect(history.canRedo()).toBe(true);

    const state0 = history.undo();
    expect(state0).toHaveLength(0);
    expect(history.canUndo()).toBe(false);

    const redone1 = history.redo();
    expect(redone1).toHaveLength(1);
    expect(redone1![0].id).toBe('1');

    const redone2 = history.redo();
    expect(redone2).toHaveLength(2);
    expect(history.canRedo()).toBe(false);
  });

  it('clears redo stack upon pushing a new state after undoing', () => {
    const history = new HistoryManager([]);
    history.pushState([dummyElement('1')]);
    history.pushState([dummyElement('1'), dummyElement('2')]);

    history.undo();
    expect(history.canRedo()).toBe(true);

    history.pushState([dummyElement('1'), dummyElement('3')]);
    expect(history.canRedo()).toBe(false);
    expect(history.redo()).toBeNull();
  });

  it('caps memory depth at 50 to prevent memory leaks on heavy drawing sessions', () => {
    const history = new HistoryManager([]);

    for (let i = 1; i <= 70; i++) {
      history.pushState([dummyElement(`${i}`)]);
    }

    let undoCount = 0;
    while (history.canUndo()) {
      history.undo();
      undoCount++;
    }

    expect(undoCount).toBe(50);
  });

  it('deep clones state objects to prevent accidental mutations by reference', () => {
    const history = new HistoryManager([]);
    const element = dummyElement('mutable');
    history.pushState([element]);

    element.strokeColor = '#ff0000';

    history.pushState([element, dummyElement('another')]);
    const previous = history.undo();

    expect(previous![0].strokeColor).toBe('#000');
  });
});
