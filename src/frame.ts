import type { Size } from './model';
import type { Rect } from './types';

/** Output frame for an exported crop. */
export type Frame =
  | { readonly kind: 'original' }
  /** Smallest canvas with this aspect ratio that holds the crop plus padding. */
  | { readonly kind: 'aspect'; readonly w: number; readonly h: number }
  /** Exact pixel size; the crop is scaled to fit inside the padding. */
  | { readonly kind: 'fixed'; readonly width: number; readonly height: number };

export interface FrameLayout {
  readonly canvas: Size;
  /** Where the crop is drawn on the canvas. */
  readonly dest: Rect;
}

export function frameLayout(crop: Size, frame: Frame, padding: number): FrameLayout {
  switch (frame.kind) {
    case 'original':
      return { canvas: { width: crop.width + padding * 2, height: crop.height + padding * 2 }, dest: { x: padding, y: padding, w: crop.width, h: crop.height } };
    case 'aspect': {
      const innerW = crop.width + padding * 2;
      const innerH = crop.height + padding * 2;
      const ratio = frame.w / frame.h;
      const canvas = innerW / innerH > ratio ? { width: innerW, height: Math.round(innerW / ratio) } : { width: Math.round(innerH * ratio), height: innerH };
      return { canvas, dest: centred(canvas, crop.width, crop.height) };
    }
    case 'fixed': {
      const canvas = { width: frame.width, height: frame.height };
      const availW = Math.max(1, frame.width - padding * 2);
      const availH = Math.max(1, frame.height - padding * 2);
      const scale = Math.min(availW / crop.width, availH / crop.height);
      return { canvas, dest: centred(canvas, Math.max(1, Math.round(crop.width * scale)), Math.max(1, Math.round(crop.height * scale))) };
    }
  }
}

function centred(canvas: Size, w: number, h: number): Rect {
  return { x: Math.round((canvas.width - w) / 2), y: Math.round((canvas.height - h) / 2), w, h };
}
