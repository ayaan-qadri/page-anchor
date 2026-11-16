import { describe, it, expect } from 'vitest';
import { MAX_DELETED_IDS, mergeDeletedIds, mergePageElements, sameElements } from '../src/core/merge';
import type { AnchorElement } from '../src/types/engine.types';

const el = (id: string, x = 0): AnchorElement => ({
  id,
  type: 'rect',
  startX: x,
  startY: 0,
  endX: x + 10,
  endY: 10,
  strokeColor: '#000',
  strokeWidth: 2,
  opacity: 1,
  createdAt: 1,
  bbox: { minX: x, minY: 0, maxX: x + 10, maxY: 10 },
});

const ids = (els: AnchorElement[]) => els.map((e) => e.id);

describe('mergePageElements', () => {
  it('keeps drawings added by both tabs', () => {
    const a = el('a');
    const base = [a];
    expect(ids(mergePageElements(base, [a, el('local')], [a, el('remote')]))).toEqual(['a', 'remote', 'local']);
  });

  it('keeps a deletion made in this tab', () => {
    const a = el('a');
    const b = el('b');
    expect(ids(mergePageElements([a, b], [b], [a, b, el('remote')]))).toEqual(['b', 'remote']);
  });

  it('keeps a deletion another tab recorded', () => {
    const a = el('a');
    const b = el('b');
    expect(ids(mergePageElements([a, b], [a, b, el('local')], [b], ['a']))).toEqual(['b', 'local']);
  });

  it('restores a drawing that is missing only because two tabs saved at once', () => {
    const a = el('a');
    expect(ids(mergePageElements([a], [a], [el('other-tab')]))).toEqual(['other-tab', 'a']);
  });

  it('treats a removed page as deleted, keeping only work done here since', () => {
    const a = el('a');
    const fresh = el('fresh');
    expect(ids(mergePageElements([a], [a, fresh], null))).toEqual(['fresh']);
  });

  it('prefers this tab when it changed an element, otherwise takes the stored version', () => {
    const a = el('a');
    const b = el('b');
    const movedA = el('a', 50);
    const remoteB = el('b', 70);
    const merged = mergePageElements([a, b], [movedA, b], [el('a', 90), remoteB]);
    expect(merged[0]).toBe(movedA);
    expect(merged[1]).toBe(remoteB);
  });

  it('keeps an element this tab changed even if another tab deleted it', () => {
    const a = el('a');
    const movedA = el('a', 40);
    expect(mergePageElements([a], [movedA], [])).toEqual([movedA]);
  });

  it('returns the stored page unchanged when this tab has no edits', () => {
    const a = el('a');
    const remote = [el('a', 5), el('z')];
    const merged = mergePageElements([a], [a], remote);
    expect(sameElements(merged, remote)).toBe(true);
  });

  it('a cleared page in this tab removes only what it had seen', () => {
    const a = el('a');
    expect(ids(mergePageElements([a], [], [a, el('new-remote')]))).toEqual(['new-remote']);
  });
});

describe('mergeDeletedIds', () => {
  it('adds what this tab deleted to what storage recorded', () => {
    const a = el('a');
    const b = el('b');
    expect(mergeDeletedIds([a, b], [b], ['x'])).toEqual(['x', 'a']);
  });

  it('keeps only the newest ids', () => {
    const recorded = Array.from({ length: MAX_DELETED_IDS }, (_, i) => `old${i}`);
    const out = mergeDeletedIds([el('gone')], [], recorded);
    expect(out).toHaveLength(MAX_DELETED_IDS);
    expect(out[out.length - 1]).toBe('gone');
    expect(out[0]).toBe('old1');
  });
});
