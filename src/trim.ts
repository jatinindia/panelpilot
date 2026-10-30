import type { PixelImage, Rect } from './types';

/**
 * Bounding box of everything that differs from the background, in pixels.
 * The background is the median color of the image border. Rows/columns need
 * at least two differing pixels (and 0.4% of their length) to count, so lone
 * specks and compression noise do not stretch the box. Null if all background.
 */
export function contentBounds(image: PixelImage, tolerance: number): Rect | null {
  const { data, width, height } = image;
  const background = borderMedian(image);
  const rowCounts = new Uint32Array(height);
  const colCounts = new Uint32Array(width);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const diff = Math.max(
        Math.abs((data[i] ?? 0) - background[0]),
        Math.abs((data[i + 1] ?? 0) - background[1]),
        Math.abs((data[i + 2] ?? 0) - background[2]),
      );
      if (diff > tolerance) {
        rowCounts[y] = (rowCounts[y] ?? 0) + 1;
        colCounts[x] = (colCounts[x] ?? 0) + 1;
      }
    }
  }
  const rows = extent(rowCounts, Math.max(2, Math.ceil(width * 0.004)));
  const cols = extent(colCounts, Math.max(2, Math.ceil(height * 0.004)));
  if (!rows || !cols) return null;
  return { x: cols.from, y: rows.from, w: cols.to - cols.from, h: rows.to - rows.from };
}

function extent(counts: Uint32Array, min: number): { readonly from: number; readonly to: number } | null {
  let from = -1;
  let to = -1;
  counts.forEach((count, i) => {
    if (count < min) return;
    if (from < 0) from = i;
    to = i + 1;
  });
  return from < 0 ? null : { from, to };
}

function borderMedian(image: PixelImage): readonly [number, number, number] {
  const { data, width, height } = image;
  const indices: number[] = [];
  for (let x = 0; x < width; x++) indices.push(x, (height - 1) * width + x);
  for (let y = 1; y < height - 1; y++) indices.push(y * width, y * width + width - 1);
  const channel = (c: number): number => {
    const values = Uint8Array.from(indices, i => data[i * 4 + c] ?? 0).sort();
    return values[Math.floor(values.length / 2)] ?? 0;
  };
  return [channel(0), channel(1), channel(2)];
}

/** Grow `rect` by `margin` on every side without leaving `limit`. */
export function expandWithin(rect: Rect, margin: number, limit: Rect): Rect {
  const x0 = Math.max(limit.x, rect.x - margin);
  const y0 = Math.max(limit.y, rect.y - margin);
  const x1 = Math.min(limit.x + limit.w, rect.x + rect.w + margin);
  const y1 = Math.min(limit.y + limit.h, rect.y + rect.h + margin);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
