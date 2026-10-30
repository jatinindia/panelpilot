import { describe, expect, it } from 'vitest';
import { fitView, imageToScreen, screenToImage, zoomAt } from '../src/view';

describe('fitView', () => {
  it('centres the image and fits it inside the padded viewport', () => {
    const view = fitView({ width: 400, height: 200 }, { width: 520, height: 520 }, 20);
    expect(view.scale).toBe(1.2);
    expect(view.offsetX).toBe(20);
    expect(view.offsetY).toBe(140);
  });
});

describe('zoomAt', () => {
  it('keeps the point under the cursor fixed', () => {
    const view = { scale: 1, offsetX: 10, offsetY: 20 };
    const anchor = { x: 110, y: 70 };
    const before = screenToImage(view, anchor);
    const zoomed = zoomAt(view, 2, anchor, { min: 0.1, max: 8 });
    expect(zoomed.scale).toBe(2);
    expect(screenToImage(zoomed, anchor)).toEqual(before);
  });

  it('clamps the scale', () => {
    expect(zoomAt({ scale: 4, offsetX: 0, offsetY: 0 }, 10, { x: 0, y: 0 }, { min: 0.1, max: 8 }).scale).toBe(8);
  });
});

describe('screenToImage / imageToScreen', () => {
  it('are inverses', () => {
    const view = { scale: 0.5, offsetX: 30, offsetY: -12 };
    expect(imageToScreen(view, screenToImage(view, { x: 77, y: 41 }))).toEqual({ x: 77, y: 41 });
  });
});
