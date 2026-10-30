import { describe, expect, it } from 'vitest';
import { detectPanels } from '../src/detect/detect';
import type { DetectOptions, Rect } from '../src/types';
import { addNoise, blankImage, paintSolid, paintTexture } from './helpers/synthetic';

const DEFAULT: DetectOptions = { sensitivity: 0.5, trimMargins: true };
const WHITE = [255, 255, 255] as const;

function expectRectsClose(actual: readonly Rect[], expected: readonly Rect[], tolerance: number): void {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((rect, i) => {
    const got = actual[i];
    expect(got, `panel ${i}`).toBeDefined();
    if (!got) return;
    expect(Math.abs(got.x - rect.x), `panel ${i} x`).toBeLessThanOrEqual(tolerance);
    expect(Math.abs(got.y - rect.y), `panel ${i} y`).toBeLessThanOrEqual(tolerance);
    expect(Math.abs(got.w - rect.w), `panel ${i} w`).toBeLessThanOrEqual(tolerance);
    expect(Math.abs(got.h - rect.h), `panel ${i} h`).toBeLessThanOrEqual(tolerance);
  });
}

describe('detectPanels', () => {
  it('splits three columns on a white background and trims outer margins', () => {
    const image = blankImage(300, 200, WHITE);
    const panels: Rect[] = [
      { x: 10, y: 10, w: 85, h: 180 },
      { x: 107, y: 10, w: 85, h: 180 },
      { x: 204, y: 10, w: 86, h: 180 },
    ];
    panels.forEach((p, i) => paintTexture(image, p, [120, 160, 140], i + 1));

    const result = detectPanels(image, DEFAULT);

    expectRectsClose(result.panels, panels, 0);
    expect(result.method).toBe('gutters');
    expect(result.confidence).toBeGreaterThan(0.8);
  });

  it('keeps outer margins when trimming is disabled', () => {
    const image = blankImage(300, 200, WHITE);
    paintTexture(image, { x: 10, y: 10, w: 130, h: 180 }, [120, 120, 120], 1);
    paintTexture(image, { x: 160, y: 10, w: 130, h: 180 }, [120, 120, 120], 2);

    const result = detectPanels(image, { sensitivity: 0.5, trimMargins: false });

    expectRectsClose(result.panels, [
      { x: 0, y: 0, w: 150, h: 200 },
      { x: 150, y: 0, w: 150, h: 200 },
    ], 0);
  });

  it('handles a dark background grid and returns panels in reading order', () => {
    const image = blankImage(320, 220, [30, 30, 36]);
    const panels: Rect[] = [];
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 3; col++) {
        panels.push({ x: 8 + col * 104, y: 8 + row * 106, w: 96, h: 98 });
      }
    }
    panels.forEach((p, i) => paintTexture(image, p, [170, 150, 130], i + 7));

    const result = detectPanels(image, DEFAULT);

    expectRectsClose(result.panels, panels, 0);
  });

  it('handles nested layouts (one tall panel beside two stacked panels)', () => {
    const image = blankImage(300, 200, [240, 236, 228]);
    const panels: Rect[] = [
      { x: 6, y: 6, w: 140, h: 188 },
      { x: 156, y: 6, w: 138, h: 88 },
      { x: 156, y: 104, w: 138, h: 90 },
    ];
    panels.forEach((p, i) => paintTexture(image, p, [100, 120, 160], i + 3));

    const result = detectPanels(image, DEFAULT);

    expectRectsClose(result.panels, panels, 0);
  });

  it('splits rows and then the columns inside each row (sample layout)', () => {
    const image = blankImage(1500, 1000, WHITE);
    const panels: Rect[] = [
      { x: 40, y: 40, w: 460, h: 450 },
      { x: 520, y: 40, w: 460, h: 450 },
      { x: 1000, y: 40, w: 460, h: 450 },
      { x: 40, y: 510, w: 940, h: 450 },
      { x: 1000, y: 510, w: 460, h: 450 },
    ];
    panels.forEach((p, i) => paintTexture(image, p, [150, 170, 160], i + 31));

    const result = detectPanels(image, DEFAULT);

    expectRectsClose(result.panels, panels, 0);
  });

  it('does not merge a uniform panel edge into the neighbouring gutter', () => {
    const image = blankImage(300, 200, WHITE);
    const left = { x: 10, y: 10, w: 135, h: 180 };
    const right = { x: 155, y: 10, w: 135, h: 180 };
    paintTexture(image, left, [120, 160, 140], 1);
    paintTexture(image, right, [120, 160, 140], 2);
    paintSolid(image, { x: 115, y: 10, w: 30, h: 180 }, [40, 60, 200]);

    const result = detectPanels(image, DEFAULT);

    expectRectsClose(result.panels, [left, right], 0);
  });

  it('finds many narrow panels in a strip', () => {
    const image = blankImage(420, 100, WHITE);
    const panels: Rect[] = Array.from({ length: 8 }, (_, i) => ({ x: 4 + i * 52, y: 4, w: 48, h: 92 }));
    panels.forEach((p, i) => paintTexture(image, p, [90, 140, 200], i + 11));

    const result = detectPanels(image, DEFAULT);

    expectRectsClose(result.panels, panels, 0);
  });

  it('tolerates compression-like noise in the gutters', () => {
    const image = blankImage(300, 200, WHITE);
    const panels: Rect[] = [
      { x: 10, y: 10, w: 135, h: 180 },
      { x: 155, y: 10, w: 135, h: 180 },
    ];
    panels.forEach((p, i) => paintTexture(image, p, [120, 160, 140], i + 21));
    addNoise(image, 6, 99);

    const result = detectPanels(image, DEFAULT);

    expectRectsClose(result.panels, panels, 1);
  });

  it('splits on thin divider lines when there are no margins', () => {
    const image = blankImage(200, 100, [0, 0, 0]);
    paintTexture(image, { x: 0, y: 0, w: 99, h: 100 }, [160, 160, 160], 1);
    paintTexture(image, { x: 101, y: 0, w: 99, h: 100 }, [160, 160, 160], 2);

    const result = detectPanels(image, DEFAULT);

    expectRectsClose(result.panels, [
      { x: 0, y: 0, w: 99, h: 100 },
      { x: 101, y: 0, w: 99, h: 100 },
    ], 0);
  });

  it('does not cut through a solid band inside a panel when it differs from the gutter color', () => {
    const image = blankImage(300, 200, WHITE);
    const left = { x: 10, y: 10, w: 135, h: 180 };
    const right = { x: 155, y: 10, w: 135, h: 180 };
    paintTexture(image, left, [120, 160, 140], 1);
    paintTexture(image, right, [120, 160, 140], 2);
    paintSolid(image, { x: 155, y: 90, w: 135, h: 12 }, [200, 40, 40]);

    const result = detectPanels(image, DEFAULT);

    expectRectsClose(result.panels, [left, right], 0);
  });

  it('splits butt-joined photos at a strong seam with reduced confidence', () => {
    const image = blankImage(200, 120, WHITE);
    paintTexture(image, { x: 0, y: 0, w: 100, h: 120 }, [60, 60, 70], 1);
    paintTexture(image, { x: 100, y: 0, w: 100, h: 120 }, [200, 200, 190], 2);

    const result = detectPanels(image, DEFAULT);

    expectRectsClose(result.panels, [
      { x: 0, y: 0, w: 100, h: 120 },
      { x: 100, y: 0, w: 100, h: 120 },
    ], 1);
    expect(result.method).toBe('seams');
    expect(result.confidence).toBeLessThan(0.8);
  });

  it('returns the whole image with zero confidence when there is nothing to split', () => {
    const image = blankImage(160, 120, WHITE);
    paintTexture(image, { x: 0, y: 0, w: 160, h: 120 }, [128, 128, 128], 5);

    const result = detectPanels(image, DEFAULT);

    expect(result.panels).toEqual([{ x: 0, y: 0, w: 160, h: 120 }]);
    expect(result.method).toBe('none');
    expect(result.confidence).toBe(0);
  });

  it('returns the whole image for a completely blank input', () => {
    const image = blankImage(50, 40, WHITE);

    const result = detectPanels(image, DEFAULT);

    expect(result.panels).toEqual([{ x: 0, y: 0, w: 50, h: 40 }]);
    expect(result.method).toBe('none');
  });

  it('never reads outside the image (1px tall input)', () => {
    const image = blankImage(30, 1, WHITE);

    expect(() => detectPanels(image, DEFAULT)).not.toThrow();
  });

  it('low sensitivity ignores a faint seam that high sensitivity splits', () => {
    const image = blankImage(200, 120, WHITE);
    paintTexture(image, { x: 0, y: 0, w: 100, h: 120 }, [120, 120, 120], 1);
    paintTexture(image, { x: 100, y: 0, w: 100, h: 120 }, [150, 150, 150], 2);

    const low = detectPanels(image, { sensitivity: 0, trimMargins: true });
    const high = detectPanels(image, { sensitivity: 1, trimMargins: true });

    expect(low.panels).toHaveLength(1);
    expect(high.panels).toHaveLength(2);
  });
});
