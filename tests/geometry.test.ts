import { describe, expect, it } from 'vitest';
import { hitTest, moveRect, rectFromPoints, resizeRect, toPixelRect } from '../src/geometry';
import type { Crop } from '../src/model';

const MIN = { w: 0.05, h: 0.05 };

function crop(id: string, x: number, y: number, w: number, h: number): Crop {
  return { id, rect: { x, y, w, h }, label: null };
}

describe('moveRect', () => {
  it('translates within bounds', () => {
    expect(moveRect({ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, 0.1, 0.2)).toEqual({ x: 0.2, y: 0.30000000000000004, w: 0.2, h: 0.2 });
  });

  it('stops at the image edge without shrinking', () => {
    expect(moveRect({ x: 0.7, y: 0.1, w: 0.2, h: 0.2 }, 0.5, -0.5)).toEqual({ x: 0.8, y: 0, w: 0.2, h: 0.2 });
  });
});

describe('resizeRect', () => {
  const base = { x: 0.2, y: 0.2, w: 0.4, h: 0.4 };

  it('moves only the dragged edge', () => {
    expect(resizeRect(base, 'e', 0.1, 0.3, MIN)).toEqual({ x: 0.2, y: 0.2, w: 0.5, h: 0.4 });
  });

  it('moves the top-left corner and keeps the opposite corner fixed', () => {
    const r = resizeRect(base, 'nw', -0.1, -0.1, MIN);
    expect(r.x).toBeCloseTo(0.1);
    expect(r.y).toBeCloseTo(0.1);
    expect(r.x + r.w).toBeCloseTo(0.6);
    expect(r.y + r.h).toBeCloseTo(0.6);
  });

  it('never goes below the minimum size when dragged past the opposite edge', () => {
    const r = resizeRect(base, 'w', 0.9, 0, MIN);
    expect(r.w).toBeCloseTo(0.05);
    expect(r.x + r.w).toBeCloseTo(0.6);
  });

  it('clamps to the image bounds', () => {
    expect(resizeRect(base, 'se', 1, 1, MIN)).toEqual({ x: 0.2, y: 0.2, w: 0.8, h: 0.8 });
  });
});

describe('rectFromPoints', () => {
  it('normalises drag direction and clamps to bounds', () => {
    expect(rectFromPoints({ x: 0.5, y: 0.6 }, { x: -0.2, y: 0.1 })).toEqual({ x: 0, y: 0.1, w: 0.5, h: 0.5 });
  });
});

describe('toPixelRect', () => {
  it('rounds edges, not sizes, so adjacent crops share a boundary and stay in bounds', () => {
    expect(toPixelRect({ x: 1 / 3, y: 0, w: 2 / 3, h: 1 }, 100, 50)).toEqual({ x: 33, y: 0, w: 67, h: 50 });
  });

  it('never returns an empty rect', () => {
    expect(toPixelRect({ x: 0.999, y: 0.999, w: 0.0001, h: 0.0001 }, 10, 10)).toEqual({ x: 9, y: 9, w: 1, h: 1 });
  });
});

describe('hitTest', () => {
  const crops = [crop('a', 0.1, 0.1, 0.5, 0.5), crop('b', 0.4, 0.4, 0.5, 0.5)];
  const radius = { x: 0.02, y: 0.02 };

  it('returns null outside every crop', () => {
    expect(hitTest(crops, { x: 0.95, y: 0.05 }, radius, null)).toBeNull();
  });

  it('picks the top-most (last) crop where crops overlap', () => {
    expect(hitTest(crops, { x: 0.5, y: 0.5 }, radius, null)).toEqual({ id: 'b', handle: 'move' });
  });

  it('prefers the selected crop where crops overlap', () => {
    expect(hitTest(crops, { x: 0.5, y: 0.5 }, radius, 'a')).toEqual({ id: 'a', handle: 'move' });
  });

  it('finds corner and edge handles of the selected crop, including just outside it', () => {
    expect(hitTest(crops, { x: 0.09, y: 0.09 }, radius, 'a')).toEqual({ id: 'a', handle: 'nw' });
    expect(hitTest(crops, { x: 0.35, y: 0.605 }, radius, 'a')).toEqual({ id: 'a', handle: 's' });
  });

  it('does not offer handles on unselected crops', () => {
    expect(hitTest(crops, { x: 0.09, y: 0.09 }, radius, 'b')).toBeNull();
  });
});
