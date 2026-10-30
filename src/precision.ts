import { clamp, type MinSize } from './geometry';
import type { Handle } from './model';
import type { Rect } from './types';

/*
 * Precise-editing helpers. All rects are in 0..1 image fractions, and
 * `ratio` is width/height in those units (callers convert from pixels:
 * ratio = pixelRatio * imageHeight / imageWidth).
 */

/** Resize while keeping `ratio`. Corners keep the opposite corner fixed; edges grow around the centre line. */
export function resizeRectLocked(rect: Rect, handle: Handle, dx: number, dy: number, min: MinSize, ratio: number): Rect {
  const minW = Math.max(min.w, min.h * ratio);
  if (handle.length === 2) {
    const east = handle.includes('e');
    const south = handle.includes('s');
    const anchorX = east ? rect.x : rect.x + rect.w;
    const anchorY = south ? rect.y : rect.y + rect.h;
    const proposedW = east ? rect.w + dx : rect.w - dx;
    const proposedH = south ? rect.h + dy : rect.h - dy;
    const maxW = Math.min(east ? 1 - anchorX : anchorX, (south ? 1 - anchorY : anchorY) * ratio);
    const w = clamp(Math.max(proposedW, proposedH * ratio), minW, maxW);
    const h = w / ratio;
    return { x: east ? anchorX : anchorX - w, y: south ? anchorY : anchorY - h, w, h };
  }
  if (handle === 'e' || handle === 'w') {
    const cy = rect.y + rect.h / 2;
    const anchorX = handle === 'e' ? rect.x : rect.x + rect.w;
    const maxW = Math.min(handle === 'e' ? 1 - anchorX : anchorX, 2 * Math.min(cy, 1 - cy) * ratio);
    const w = clamp(handle === 'e' ? rect.w + dx : rect.w - dx, minW, maxW);
    const h = w / ratio;
    return { x: handle === 'e' ? anchorX : anchorX - w, y: cy - h / 2, w, h };
  }
  const cx = rect.x + rect.w / 2;
  const anchorY = handle === 's' ? rect.y : rect.y + rect.h;
  const maxH = Math.min(handle === 's' ? 1 - anchorY : anchorY, (2 * Math.min(cx, 1 - cx)) / ratio);
  const h = clamp(handle === 's' ? rect.h + dy : rect.h - dy, minW / ratio, maxH);
  const w = h * ratio;
  return { x: cx - w / 2, y: handle === 's' ? anchorY : anchorY - h, w, h };
}

/** Largest rect with `ratio` that fits inside `rect`, centred in it. */
export function fitRatio(rect: Rect, ratio: number): Rect {
  const w = Math.min(rect.w, rect.h * ratio);
  const h = w / ratio;
  return { x: rect.x + (rect.w - w) / 2, y: rect.y + (rect.h - h) / 2, w, h };
}

/** Shift a rect so whichever of its edges is closest to a target (within threshold) lands on it. */
export function snapMove(rect: Rect, xs: readonly number[], ys: readonly number[], thresholdX: number, thresholdY: number): Rect {
  const dx = bestShift([rect.x, rect.x + rect.w], xs, thresholdX);
  const dy = bestShift([rect.y, rect.y + rect.h], ys, thresholdY);
  return { x: clamp(rect.x + dx, 0, 1 - rect.w), y: clamp(rect.y + dy, 0, 1 - rect.h), w: rect.w, h: rect.h };
}

/** Snap only the edges that `handle` moves; the opposite edges stay put. */
export function snapEdges(rect: Rect, handle: Handle, xs: readonly number[], ys: readonly number[], thresholdX: number, thresholdY: number): Rect {
  let left = rect.x;
  let right = rect.x + rect.w;
  let top = rect.y;
  let bottom = rect.y + rect.h;
  if (handle.includes('w')) left += bestShift([left], xs, thresholdX);
  if (handle.includes('e')) right += bestShift([right], xs, thresholdX);
  if (handle.includes('n')) top += bestShift([top], ys, thresholdY);
  if (handle.includes('s')) bottom += bestShift([bottom], ys, thresholdY);
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/** Split a rect into an evenly sized rows x cols grid, row by row. */
export function splitRect(rect: Rect, rows: number, cols: number): Rect[] {
  const w = rect.w / cols;
  const h = rect.h / rows;
  return Array.from({ length: rows * cols }, (_, i) => ({ x: rect.x + (i % cols) * w, y: rect.y + Math.floor(i / cols) * h, w, h }));
}

function bestShift(edges: readonly number[], targets: readonly number[], threshold: number): number {
  let best = 0;
  let bestDistance = threshold;
  for (const edge of edges) {
    for (const target of targets) {
      const distance = Math.abs(target - edge);
      if (distance <= bestDistance) {
        bestDistance = distance;
        best = target - edge;
      }
    }
  }
  return best;
}

/** Rect dragged from `a` towards `b` with a fixed ratio, sized by the longer drag axis and kept inside the image. */
export function rectFromPointsLocked(a: { readonly x: number; readonly y: number }, b: { readonly x: number; readonly y: number }, ratio: number): Rect {
  const right = b.x >= a.x;
  const down = b.y >= a.y;
  const maxW = Math.min(right ? 1 - a.x : a.x, (down ? 1 - a.y : a.y) * ratio);
  const w = clamp(Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y) * ratio), 0, Math.max(0, maxW));
  const h = w / ratio;
  return { x: right ? a.x : a.x - w, y: down ? a.y : a.y - h, w, h };
}

export type Field = 'x' | 'y' | 'w' | 'h';

/**
 * Apply one edited X/Y/W/H field (source pixels). Moving keeps the size and
 * stops at the image edge; resizing stops at the edge; a locked `ratio`
 * (pixel width / height) shrinks both sides together when space runs out.
 */
export function applyFields(current: Rect, fields: Rect, changed: Field, ratio: number | null, image: { readonly width: number; readonly height: number }): Rect {
  const round = (v: number): number => Math.round(Number.isFinite(v) ? v : 0);
  const { x, y, w, h } = current;
  switch (changed) {
    case 'x':
      return { x: clamp(round(fields.x), 0, image.width - w), y, w, h };
    case 'y':
      return { x, y: clamp(round(fields.y), 0, image.height - h), w, h };
    case 'w': {
      const max = ratio === null ? image.width - x : Math.floor(Math.min(image.width - x, (image.height - y) * ratio));
      const width = clamp(round(fields.w), 1, max);
      return { x, y, w: width, h: ratio === null ? h : Math.max(1, Math.round(width / ratio)) };
    }
    case 'h': {
      const max = ratio === null ? image.height - y : Math.floor(Math.min(image.height - y, (image.width - x) / ratio));
      const height = clamp(round(fields.h), 1, max);
      return { x, y, w: ratio === null ? w : Math.max(1, Math.round(height * ratio)), h: height };
    }
  }
}
