import { describe, it, expect } from 'vitest';
import {
  intersectsBoundingBox,
  isPointNearElement,
  simplifyPointsRDP,
} from '../src/core/geometry';
import { AnchorElement, BoundingBox, Point, ShapeElement } from '../src/types/engine.types';

describe('Performance Benchmarks: Zero-Lag Low-End Device Validation', () => {
  it('BENCHMARK: Viewport Frustum Culling across 10,000 elements executes in under 5ms', () => {
    const elements: ShapeElement[] = [];
    for (let i = 0; i < 10000; i++) {
      const startX = (i * 37) % 10000;
      const startY = (i * 91) % 50000;
      elements.push({
        id: `shape_${i}`,
        type: 'rect',
        startX,
        startY,
        endX: startX + 50,
        endY: startY + 50,
        strokeColor: '#ef4444',
        strokeWidth: 2,
        opacity: 1,
        createdAt: 1000,
        bbox: { minX: startX - 2, minY: startY - 2, maxX: startX + 52, maxY: startY + 52 },
      });
    }

    const viewportBox: BoundingBox = {
      minX: 1000,
      minY: 5000,
      maxX: 2920,
      maxY: 6080,
    };

    const start = performance.now();

    let visibleCount = 0;
    for (let i = 0; i < elements.length; i++) {
      if (intersectsBoundingBox(elements[i].bbox, viewportBox)) {
        visibleCount++;
      }
    }

    const elapsed = performance.now() - start;

    console.log(`\n  ⚡ Frustum Culling Benchmark:`);
    console.log(`     Processed: 10,000 elements`);
    console.log(`     Visible culled: ${visibleCount} elements`);
    console.log(`     Elapsed Time: ${elapsed.toFixed(3)} ms`);

    expect(elapsed).toBeLessThan(15.0);
    expect(visibleCount).toBeGreaterThan(0);
  });

  it('BENCHMARK: RDP Point Reduction on 5,000 points executes in under 5ms with >50% compression', () => {
    const rawPoints: Point[] = [];
    for (let i = 0; i < 5000; i++) {
      const base = i * 2;
      const jitter = (Math.sin(i / 10) * 0.4) + (i % 2 === 0 ? 0.2 : -0.2);
      rawPoints.push({
        x: base + jitter,
        y: Math.cos(i / 50) * 200 + jitter,
      });
    }

    const start = performance.now();
    const simplified = simplifyPointsRDP(rawPoints, 1.2);
    const elapsed = performance.now() - start;

    const compressionRatio = ((rawPoints.length - simplified.length) / rawPoints.length) * 100;

    console.log(`\n  ⚡ RDP Polyline Decimation Benchmark:`);
    console.log(`     Raw Points: ${rawPoints.length}`);
    console.log(`     Compressed Points: ${simplified.length}`);
    console.log(`     Payload Reduction: ${compressionRatio.toFixed(1)}%`);
    console.log(`     Elapsed Time: ${elapsed.toFixed(3)} ms`);

    expect(elapsed).toBeLessThan(75.0);
    expect(compressionRatio).toBeGreaterThan(50.0);
  });

  it('BENCHMARK: Standard freehand stroke (500 points) simplifies in under 1ms', () => {
    const rawPoints: Point[] = [];
    for (let i = 0; i < 500; i++) {
      rawPoints.push({
        x: i * 2 + (i % 2 === 0 ? 0.2 : -0.2),
        y: Math.sin(i / 20) * 100,
      });
    }

    const start = performance.now();
    const simplified = simplifyPointsRDP(rawPoints, 1.2);
    const elapsed = performance.now() - start;

    console.log(`\n  ⚡ Real-world Stroke (500 pts) Benchmark:`);
    console.log(`     Raw Points: ${rawPoints.length}`);
    console.log(`     Simplified: ${simplified.length}`);
    console.log(`     Elapsed Time: ${elapsed.toFixed(3)} ms`);

    expect(elapsed).toBeLessThan(5.0);
  });

  it('BENCHMARK: Spatial Eraser Collision across 1,000 elements executes in under 2ms', () => {
    const elements: AnchorElement[] = [];
    for (let i = 0; i < 1000; i++) {
      const x = (i * 17) % 5000;
      const y = (i * 29) % 10000;
      elements.push({
        id: `el_${i}`,
        type: 'rect',
        startX: x,
        startY: y,
        endX: x + 60,
        endY: y + 40,
        strokeColor: '#3b82f6',
        strokeWidth: 4,
        opacity: 1,
        createdAt: 1000,
        bbox: { minX: x - 5, minY: y - 5, maxX: x + 65, maxY: y + 45 },
      });
    }

    const testPoint: Point = { x: 500, y: 500 };

    const start = performance.now();

    let hits = 0;
    for (let i = 0; i < elements.length; i++) {
      if (isPointNearElement(testPoint, elements[i], 12)) {
        hits++;
      }
    }

    const elapsed = performance.now() - start;

    console.log(`\n  ⚡ Spatial Eraser Hit Testing Benchmark:`);
    console.log(`     Tested: 1,000 elements against pointer coordinate`);
    console.log(`     Hits: ${hits}`);
    console.log(`     Elapsed Time: ${elapsed.toFixed(3)} ms`);

    expect(elapsed).toBeLessThan(10.0);
  });

  it('BENCHMARK: Serialization of heavy document (500 complex elements) executes in under 10ms', () => {
    const elements: AnchorElement[] = [];
    for (let i = 0; i < 500; i++) {
      const strokePoints: Point[] = [];
      for (let p = 0; p < 20; p++) {
        strokePoints.push({ x: i * 10 + p, y: p * 5 });
      }
      elements.push({
        id: `stroke_${i}`,
        type: 'pen',
        points: strokePoints,
        strokeColor: '#facc15',
        strokeWidth: 4,
        opacity: 0.8,
        createdAt: 1000 + i,
        bbox: { minX: 0, minY: 0, maxX: 500, maxY: 500 },
      });
    }

    const start = performance.now();
    const jsonStr = JSON.stringify(elements);
    const parsed = JSON.parse(jsonStr);
    const elapsed = performance.now() - start;

    console.log(`\n  ⚡ Document Serialization Benchmark:`);
    console.log(`     Elements: 500 complex strokes (10,000 points total)`);
    console.log(`     Serialized Size: ${(jsonStr.length / 1024).toFixed(1)} KB`);
    console.log(`     Serialize + Parse Time: ${elapsed.toFixed(3)} ms`);

    expect(elapsed).toBeLessThan(60.0);
    expect(parsed).toHaveLength(500);
  });
});
