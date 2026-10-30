import { describe, expect, it } from 'vitest';
import { applyFields, fitRatio, rectFromPointsLocked, resizeRectLocked, snapEdges, snapMove, splitRect } from '../src/precision';

const MIN = { w: 0.01, h: 0.01 };
const close = (actual: { x: number; y: number; w: number; h: number }, expected: { x: number; y: number; w: number; h: number }) => {
  expect(actual.x).toBeCloseTo(expected.x, 6);
  expect(actual.y).toBeCloseTo(expected.y, 6);
  expect(actual.w).toBeCloseTo(expected.w, 6);
  expect(actual.h).toBeCloseTo(expected.h, 6);
};

describe('resizeRectLocked', () => {
  const base = { x: 0.2, y: 0.2, w: 0.4, h: 0.2 }; // ratio 2

  it('keeps the ratio and the opposite corner when dragging a corner', () => {
    close(resizeRectLocked(base, 'se', 0.2, 0, MIN, 2), { x: 0.2, y: 0.2, w: 0.6, h: 0.3 });
    close(resizeRectLocked(base, 'nw', -0.1, 0, MIN, 2), { x: 0.1, y: 0.15, w: 0.5, h: 0.25 });
  });

  it('follows whichever axis moved further', () => {
    close(resizeRectLocked(base, 'se', 0, 0.2, MIN, 2), { x: 0.2, y: 0.2, w: 0.8, h: 0.4 });
  });

  it('grows around the centre line when dragging an edge', () => {
    close(resizeRectLocked(base, 'e', 0.2, 0, MIN, 2), { x: 0.2, y: 0.15, w: 0.6, h: 0.3 });
    close(resizeRectLocked(base, 's', 0, 0.1, MIN, 2), { x: 0.1, y: 0.2, w: 0.6, h: 0.3 });
  });

  it('stops at the image bounds without breaking the ratio', () => {
    const r = resizeRectLocked(base, 'se', 5, 5, MIN, 2);
    expect(r.x + r.w).toBeLessThanOrEqual(1 + 1e-9);
    expect(r.y + r.h).toBeLessThanOrEqual(1 + 1e-9);
    expect(r.w / r.h).toBeCloseTo(2, 6);
    close(r, { x: 0.2, y: 0.2, w: 0.8, h: 0.4 });
  });
});

describe('fitRatio', () => {
  it('returns the largest rect of the ratio inside the given rect, centred', () => {
    close(fitRatio({ x: 0, y: 0, w: 0.4, h: 0.2 }, 1), { x: 0.1, y: 0, w: 0.2, h: 0.2 });
    close(fitRatio({ x: 0, y: 0, w: 0.2, h: 0.4 }, 1), { x: 0, y: 0.1, w: 0.2, h: 0.2 });
  });
});

describe('snapping', () => {
  const xs = [0, 0.5, 1];
  const ys = [0, 1];

  it('moves a rect so its nearest edge lands on a target', () => {
    close(snapMove({ x: 0.505, y: 0.3, w: 0.2, h: 0.2 }, xs, ys, 0.01, 0.01), { x: 0.5, y: 0.3, w: 0.2, h: 0.2 });
    close(snapMove({ x: 0.296, y: 0.3, w: 0.2, h: 0.2 }, xs, ys, 0.01, 0.01), { x: 0.3, y: 0.3, w: 0.2, h: 0.2 });
  });

  it('leaves the rect alone when nothing is within the threshold', () => {
    close(snapMove({ x: 0.4, y: 0.4, w: 0.05, h: 0.05 }, xs, ys, 0.01, 0.01), { x: 0.4, y: 0.4, w: 0.05, h: 0.05 });
  });

  it('snaps only the edges being dragged', () => {
    close(snapEdges({ x: 0.1, y: 0.1, w: 0.395, h: 0.5 }, 'e', xs, ys, 0.01, 0.01), { x: 0.1, y: 0.1, w: 0.4, h: 0.5 });
    close(snapEdges({ x: 0.006, y: 0.1, w: 0.3, h: 0.5 }, 'n', xs, ys, 0.01, 0.01), { x: 0.006, y: 0.1, w: 0.3, h: 0.5 });
    close(snapEdges({ x: 0.006, y: 0.1, w: 0.3, h: 0.5 }, 'nw', xs, ys, 0.01, 0.01), { x: 0, y: 0.1, w: 0.306, h: 0.5 });
  });
});

describe('splitRect', () => {
  it('splits into a row-major grid', () => {
    const parts = splitRect({ x: 0, y: 0, w: 1, h: 0.5 }, 2, 2);
    expect(parts).toHaveLength(4);
    close(parts[0]!, { x: 0, y: 0, w: 0.5, h: 0.25 });
    close(parts[1]!, { x: 0.5, y: 0, w: 0.5, h: 0.25 });
    close(parts[2]!, { x: 0, y: 0.25, w: 0.5, h: 0.25 });
  });
});

describe('rectFromPointsLocked', () => {
  it('draws from the start point in the drag direction, using the longer side', () => {
    close(rectFromPointsLocked({ x: 0.5, y: 0.5 }, { x: 0.7, y: 0.55 }, 2), { x: 0.5, y: 0.5, w: 0.2, h: 0.1 });
    close(rectFromPointsLocked({ x: 0.5, y: 0.5 }, { x: 0.45, y: 0.3 }, 1), { x: 0.3, y: 0.3, w: 0.2, h: 0.2 });
  });

  it('shrinks to stay inside the image', () => {
    close(rectFromPointsLocked({ x: 0.9, y: 0.5 }, { x: 1.5, y: 0.6 }, 1), { x: 0.9, y: 0.5, w: 0.1, h: 0.1 });
  });
});

describe('applyFields', () => {
  const image = { width: 1500, height: 1000 };
  const current = { x: 40, y: 510, w: 940, h: 450 };

  it('moves without resizing, stopping where the crop meets the edge', () => {
    expect(applyFields(current, { ...current, x: 2000 }, 'x', null, image)).toEqual({ x: 560, y: 510, w: 940, h: 450 });
    expect(applyFields(current, { ...current, y: -50 }, 'y', null, image)).toEqual({ x: 40, y: 0, w: 940, h: 450 });
  });

  it('resizes up to the image edge', () => {
    expect(applyFields(current, { ...current, w: 5000 }, 'w', null, image)).toEqual({ x: 40, y: 510, w: 1460, h: 450 });
    expect(applyFields(current, { ...current, h: 0 }, 'h', null, image)).toEqual({ x: 40, y: 510, w: 940, h: 1 });
  });

  it('keeps a locked ratio, shrinking both sides together when space runs out', () => {
    expect(applyFields(current, { ...current, w: 300 }, 'w', 1, image)).toEqual({ x: 40, y: 510, w: 300, h: 300 });
    expect(applyFields(current, { ...current, h: 200 }, 'h', 2, image)).toEqual({ x: 40, y: 510, w: 400, h: 200 });
    expect(applyFields(current, { ...current, w: 900 }, 'w', 1, image)).toEqual({ x: 40, y: 510, w: 490, h: 490 });
  });
});
