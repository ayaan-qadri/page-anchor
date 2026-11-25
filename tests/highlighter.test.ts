import { describe, expect, it } from 'vitest';
import { intensityToOpacity, straightenHighlight } from '../src/core/highlighter';
import type { Point } from '../src/types/engine.types';

function wobble(from: Point, to: Point, amplitude: number, steps = 40): Point[] {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps;
    return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t + Math.sin(t * Math.PI * 6) * amplitude };
  });
}

describe('intensityToOpacity', () => {
  it('spans a visible range and clamps bad values', () => {
    expect(intensityToOpacity(0)).toBe(0.2);
    expect(intensityToOpacity(50)).toBe(0.6);
    expect(intensityToOpacity(100)).toBe(1);
    expect(intensityToOpacity(-10)).toBe(0.2);
    expect(intensityToOpacity(400)).toBe(1);
    expect(intensityToOpacity(Number.NaN)).toBe(0.6);
  });
});

describe('straightenHighlight', () => {
  it('levels a wobbly, roughly horizontal sweep onto one line', () => {
    const result = straightenHighlight(wobble({ x: 100, y: 200 }, { x: 560, y: 210 }, 8));
    expect(result).not.toBeNull();
    const [a, b] = result!;
    expect(a.x).toBe(100);
    expect(b.x).toBe(560);
    expect(a.y).toBe(b.y);
    expect(a.y).toBeGreaterThan(195);
    expect(a.y).toBeLessThan(215);
  });

  it('keeps the angle of a straight diagonal sweep', () => {
    const result = straightenHighlight(wobble({ x: 100, y: 100 }, { x: 300, y: 300 }, 2));
    expect(result).toEqual([
      { x: 100, y: 100 },
      { x: 300, y: 300 },
    ]);
  });

  it('leaves curves, loops, scribbles and short marks freehand', () => {
    const arc = Array.from({ length: 30 }, (_, i) => ({ x: 100 + i * 10, y: 200 - Math.sin((i / 29) * Math.PI) * 80 }));
    expect(straightenHighlight(arc)).toBeNull();

    const loop = Array.from({ length: 40 }, (_, i) => ({ x: 200 + Math.cos((i / 39) * Math.PI * 1.9) * 60, y: 200 + Math.sin((i / 39) * Math.PI * 1.9) * 60 }));
    expect(straightenHighlight(loop)).toBeNull();

    const scribble = [0, 200, 20, 220, 40, 240].map((x, i) => ({ x: 100 + x, y: 100 + (i % 2) * 4 }));
    expect(straightenHighlight(scribble)).toBeNull();

    expect(straightenHighlight([{ x: 0, y: 0 }, { x: 10, y: 1 }])).toBeNull();
    expect(straightenHighlight([{ x: 0, y: 0 }])).toBeNull();
  });
});
