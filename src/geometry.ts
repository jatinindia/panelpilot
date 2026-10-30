import type { Crop, Handle, Point } from './model';
import type { Rect } from './types';

export interface MinSize {
  readonly w: number;
  readonly h: number;
}

export interface Hit {
  readonly id: string;
  readonly handle: Handle | 'move';
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Translate a 0..1 rect, stopping at the image edges. */
export function moveRect(rect: Rect, dx: number, dy: number): Rect {
  return { x: clamp(rect.x + dx, 0, 1 - rect.w), y: clamp(rect.y + dy, 0, 1 - rect.h), w: rect.w, h: rect.h };
}

/** Drag one edge or corner of a 0..1 rect; the opposite edges stay fixed. */
export function resizeRect(rect: Rect, handle: Handle, dx: number, dy: number, min: MinSize): Rect {
  let { x, y, w, h } = rect;
  if (handle.includes('w')) {
    const right = rect.x + rect.w;
    x = clamp(rect.x + dx, 0, right - min.w);
    w = right - x;
  } else if (handle.includes('e')) {
    w = clamp(rect.w + dx, min.w, 1 - rect.x);
  }
  if (handle.includes('n')) {
    const bottom = rect.y + rect.h;
    y = clamp(rect.y + dy, 0, bottom - min.h);
    h = bottom - y;
  } else if (handle.includes('s')) {
    h = clamp(rect.h + dy, min.h, 1 - rect.y);
  }
  return { x, y, w, h };
}

export function rectFromPoints(a: Point, b: Point): Rect {
  const x0 = clamp(Math.min(a.x, b.x), 0, 1);
  const y0 = clamp(Math.min(a.y, b.y), 0, 1);
  const x1 = clamp(Math.max(a.x, b.x), 0, 1);
  const y1 = clamp(Math.max(a.y, b.y), 0, 1);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Integer pixel rect inside the image, at least 1x1. Edges are rounded, not sizes. */
export function toPixelRect(rect: Rect, width: number, height: number): Rect {
  const x0 = clamp(Math.round(rect.x * width), 0, width - 1);
  const y0 = clamp(Math.round(rect.y * height), 0, height - 1);
  const x1 = clamp(Math.round((rect.x + rect.w) * width), x0 + 1, width);
  const y1 = clamp(Math.round((rect.y + rect.h) * height), y0 + 1, height);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * What is under `point`: a handle of the selected crop, the selected crop's
 * body, or the top-most crop containing the point. `radius` is the grab
 * distance in 0..1 units per axis (it differs per axis for non-square images).
 */
export function hitTest(crops: readonly Crop[], point: Point, radius: Point, selectedId: string | null): Hit | null {
  const selected = crops.find(c => c.id === selectedId);
  if (selected) {
    const handle = handleAt(selected.rect, point, radius);
    if (handle) return { id: selected.id, handle };
    if (contains(selected.rect, point)) return { id: selected.id, handle: 'move' };
  }
  for (let i = crops.length - 1; i >= 0; i--) {
    const crop = crops[i];
    if (crop && contains(crop.rect, point)) return { id: crop.id, handle: 'move' };
  }
  return null;
}

function handleAt(rect: Rect, p: Point, radius: Point): Handle | null {
  const nearLeft = Math.abs(p.x - rect.x) <= radius.x;
  const nearRight = Math.abs(p.x - (rect.x + rect.w)) <= radius.x;
  const nearTop = Math.abs(p.y - rect.y) <= radius.y;
  const nearBottom = Math.abs(p.y - (rect.y + rect.h)) <= radius.y;
  const withinX = p.x >= rect.x - radius.x && p.x <= rect.x + rect.w + radius.x;
  const withinY = p.y >= rect.y - radius.y && p.y <= rect.y + rect.h + radius.y;
  if (nearTop && nearLeft) return 'nw';
  if (nearTop && nearRight) return 'ne';
  if (nearBottom && nearLeft) return 'sw';
  if (nearBottom && nearRight) return 'se';
  if (nearTop && withinX) return 'n';
  if (nearBottom && withinX) return 's';
  if (nearLeft && withinY) return 'w';
  if (nearRight && withinY) return 'e';
  return null;
}

function contains(rect: Rect, p: Point): boolean {
  return p.x >= rect.x && p.x <= rect.x + rect.w && p.y >= rect.y && p.y <= rect.y + rect.h;
}
