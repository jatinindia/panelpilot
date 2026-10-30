import { describe, expect, it } from 'vitest';
import { contentBounds, expandWithin } from '../src/trim';
import { addNoise, blankImage, paintSolid, paintTexture } from './helpers/synthetic';

describe('contentBounds', () => {
  it('finds the product on a white background', () => {
    const image = blankImage(200, 150, [255, 255, 255]);
    paintTexture(image, { x: 40, y: 30, w: 100, h: 80 }, [120, 90, 60], 3);
    expect(contentBounds(image, 24)).toEqual({ x: 40, y: 30, w: 100, h: 80 });
  });

  it('uses the border color, so coloured backgrounds work', () => {
    const image = blankImage(100, 100, [200, 230, 210]);
    paintSolid(image, { x: 10, y: 60, w: 5, h: 20 }, [20, 20, 20]);
    expect(contentBounds(image, 24)).toEqual({ x: 10, y: 60, w: 5, h: 20 });
  });

  it('ignores compression-like noise and isolated specks', () => {
    const image = blankImage(200, 200, [255, 255, 255]);
    paintSolid(image, { x: 50, y: 50, w: 100, h: 100 }, [30, 60, 90]);
    paintSolid(image, { x: 5, y: 190, w: 1, h: 1 }, [0, 0, 0]);
    addNoise(image, 8, 4);
    expect(contentBounds(image, 24)).toEqual({ x: 50, y: 50, w: 100, h: 100 });
  });

  it('returns null when there is nothing but background', () => {
    expect(contentBounds(blankImage(50, 50, [255, 255, 255]), 24)).toBeNull();
  });
});

describe('expandWithin', () => {
  it('adds the margin but stays inside the limit', () => {
    expect(expandWithin({ x: 10, y: 50, w: 20, h: 20 }, 15, { x: 0, y: 40, w: 100, h: 100 })).toEqual({ x: 0, y: 40, w: 45, h: 45 });
  });
});
