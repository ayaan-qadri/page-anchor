import { describe, it, expect, vi } from 'vitest';
import { CanvasEngine } from '../src/core/engine';
import { HistoryManager } from '../src/core/history';
import { AnchorElement, ShapeElement, StrokeElement } from '../src/types/engine.types';

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

  it('isolates snapshots from later changes to the array that was pushed', () => {
    const history = new HistoryManager([]);
    const live = [dummyElement('1')];
    history.pushState(live);

    live.push(dummyElement('2'));
    history.pushState(live);

    const previous = history.undo()!;
    expect(previous.map((el) => el.id)).toEqual(['1']);

    previous.push(dummyElement('x'));
    expect(history.redo()!.map((el) => el.id)).toEqual(['1', '2']);
    expect(history.undo()!.map((el) => el.id)).toEqual(['1']);
  });

  it('shares element objects between snapshots instead of deep-copying them', () => {
    const history = new HistoryManager([]);
    const el1 = dummyElement('1');
    const el2 = dummyElement('2');
    history.pushState([el1]);
    history.pushState([el1, el2]);

    const previous = history.undo()!;
    expect(previous[0]).toBe(el1);
    expect(history.redo()![1]).toBe(el2);
  });

  it('restores the drawings with a single undo after a clear', () => {
    const history = new HistoryManager([]);
    const el1 = dummyElement('1');
    const el2 = dummyElement('2');

    history.pushState([el1, el2]);
    history.pushState([]);

    // Single undo must immediately return the 2 drawings, not an empty state
    const restored = history.undo();
    expect(restored).toHaveLength(2);
    expect(restored![0].id).toBe('1');
    expect(restored![1].id).toBe('2');
  });
});

describe('HistoryManager wired to CanvasEngine (shared element references)', () => {
  function setup() {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const history = new HistoryManager([]);
    const engine = new CanvasEngine(container, {
      onElementsChange: (elements) => history.pushState(elements),
    });
    engine.setDomAnchoringEnabled(false);
    engine.setActiveMode(true);
    const canvas = container.querySelector('.page-anchor-active-canvas') as HTMLCanvasElement;
    const teardown = () => {
      engine.destroy();
      container.remove();
    };
    return { engine, history, canvas, teardown };
  }

  const drag = (canvas: HTMLCanvasElement, from: [number, number], to: [number, number]) => {
    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: from[0], clientY: from[1], button: 0, pointerId: 1 }));
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: to[0], clientY: to[1], pointerId: 1 }));
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: to[0], clientY: to[1], pointerId: 1 }));
  };

  it('undo after a select-drag restores the original position of strokes and shapes', () => {
    const { engine, history, canvas, teardown } = setup();
    vi.stubGlobal('requestAnimationFrame', () => 0);

    engine.setTool('pen');
    drag(canvas, [20, 20], [80, 20]);
    engine.setTool('rect');
    drag(canvas, [200, 200], [260, 260]);
    expect(engine.getElements()).toHaveLength(2);

    const strokeBefore = JSON.parse(JSON.stringify(engine.getElements()[0])) as StrokeElement;
    const rectBefore = JSON.parse(JSON.stringify(engine.getElements()[1])) as ShapeElement;

    engine.selectAll();
    drag(canvas, [230, 230], [330, 280]);

    const moved = engine.getElements();
    expect((moved[1] as ShapeElement).startX).toBe(rectBefore.startX + 100);
    expect((moved[0] as StrokeElement).points[0].x).toBe(strokeBefore.points[0].x + 100);

    const restored = history.undo()!;
    engine.setElements(restored);
    expect(engine.getElements()[0]).toEqual(strokeBefore);
    expect(engine.getElements()[1]).toEqual(rectBefore);

    const redone = history.redo()!;
    engine.setElements(redone);
    expect((engine.getElements()[1] as ShapeElement).startX).toBe(rectBefore.startX + 100);

    vi.unstubAllGlobals();
    teardown();
  });

  it('moveAll and repeated undo/redo never corrupt earlier snapshots', () => {
    const { engine, history, teardown } = setup();
    const rect: ShapeElement = {
      id: 'r',
      type: 'rect',
      startX: 10,
      startY: 10,
      endX: 50,
      endY: 50,
      strokeColor: '#000',
      strokeWidth: 2,
      opacity: 1,
      createdAt: 0,
      bbox: { minX: 5, minY: 5, maxX: 55, maxY: 55 },
    };
    history.reset([rect]);
    engine.setElements([rect]);

    engine.moveAll(5, 0);
    engine.moveAll(5, 0);
    expect((engine.getElements()[0] as ShapeElement).startX).toBe(20);
    expect(rect.startX).toBe(10);

    engine.setElements(history.undo()!);
    expect((engine.getElements()[0] as ShapeElement).startX).toBe(15);
    engine.setElements(history.undo()!);
    expect((engine.getElements()[0] as ShapeElement).startX).toBe(10);
    engine.setElements(history.redo()!);
    engine.setElements(history.redo()!);
    expect((engine.getElements()[0] as ShapeElement).startX).toBe(20);

    teardown();
  });
});
