import { clamp } from './geometry';
import type { Point, Size } from './model';

/** Maps image pixels to screen (CSS) pixels: screen = offset + image * scale. */
export interface View {
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

export interface ScaleLimits {
  readonly min: number;
  readonly max: number;
}

export function fitView(image: Size, viewport: Size, padding: number): View {
  const scale = Math.max(
    0.01,
    Math.min((viewport.width - padding * 2) / image.width, (viewport.height - padding * 2) / image.height),
  );
  return {
    scale,
    offsetX: (viewport.width - image.width * scale) / 2,
    offsetY: (viewport.height - image.height * scale) / 2,
  };
}

/** Zoom by `factor`, keeping the image point under `anchor` fixed on screen. */
export function zoomAt(view: View, factor: number, anchor: Point, limits: ScaleLimits): View {
  const scale = clamp(view.scale * factor, limits.min, limits.max);
  const target = screenToImage(view, anchor);
  return { scale, offsetX: anchor.x - target.x * scale, offsetY: anchor.y - target.y * scale };
}

export function panBy(view: View, dx: number, dy: number): View {
  return { scale: view.scale, offsetX: view.offsetX + dx, offsetY: view.offsetY + dy };
}

export function screenToImage(view: View, p: Point): Point {
  return { x: (p.x - view.offsetX) / view.scale, y: (p.y - view.offsetY) / view.scale };
}

export function imageToScreen(view: View, p: Point): Point {
  return { x: view.offsetX + p.x * view.scale, y: view.offsetY + p.y * view.scale };
}
