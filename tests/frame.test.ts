import { describe, expect, it } from 'vitest';
import { frameLayout } from '../src/frame';

describe('frameLayout', () => {
  it('keeps the crop size plus padding for the original frame', () => {
    expect(frameLayout({ width: 300, height: 200 }, { kind: 'original' }, 10)).toEqual({
      canvas: { width: 320, height: 220 },
      dest: { x: 10, y: 10, w: 300, h: 200 },
    });
  });

  it('grows the shorter side to reach an aspect ratio, centring the crop', () => {
    expect(frameLayout({ width: 300, height: 200 }, { kind: 'aspect', w: 1, h: 1 }, 0)).toEqual({
      canvas: { width: 300, height: 300 },
      dest: { x: 0, y: 50, w: 300, h: 200 },
    });
  });

  it('applies padding before matching the aspect ratio', () => {
    // 4:5 around 300x200 + 20px padding (340x240): height must be 425.
    expect(frameLayout({ width: 300, height: 200 }, { kind: 'aspect', w: 4, h: 5 }, 20)).toEqual({
      canvas: { width: 340, height: 425 },
      dest: { x: 20, y: 113, w: 300, h: 200 },
    });
  });

  it('scales the crop to fit a fixed canvas inside the padding', () => {
    expect(frameLayout({ width: 400, height: 200 }, { kind: 'fixed', width: 1000, height: 1000 }, 100)).toEqual({
      canvas: { width: 1000, height: 1000 },
      dest: { x: 100, y: 300, w: 800, h: 400 },
    });
  });

  it('never produces an empty destination when padding exceeds a fixed canvas', () => {
    const layout = frameLayout({ width: 400, height: 200 }, { kind: 'fixed', width: 100, height: 100 }, 80);
    expect(layout.canvas).toEqual({ width: 100, height: 100 });
    expect(layout.dest.w).toBeGreaterThanOrEqual(1);
    expect(layout.dest.h).toBeGreaterThanOrEqual(1);
  });
});
