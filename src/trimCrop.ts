import { toPixelRect } from './geometry';
import type { Crop, Source } from './model';
import { contentBounds, expandWithin } from './trim';
import type { Rect } from './types';

/** Crops larger than this are analysed at reduced size (accurate to about one source pixel per scale step). */
const ANALYSIS_MAX_SIDE = 1200;

/** The crop shrunk to its content plus `marginPx`, in 0..1 units; null if the crop is all background. */
export function trimmedRect(source: Source, crop: Crop, marginPx: number, tolerance: number): Rect | null {
  const r = toPixelRect(crop.rect, source.size.width, source.size.height);
  const scale = Math.min(1, ANALYSIS_MAX_SIDE / Math.max(r.w, r.h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(r.w * scale));
  canvas.height = Math.max(1, Math.round(r.h * scale));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error(`Could not create a ${canvas.width}x${canvas.height} canvas to trim a crop of "${source.name}"`);
  ctx.drawImage(source.bitmap, r.x, r.y, r.w, r.h, 0, 0, canvas.width, canvas.height);
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const bounds = contentBounds({ data, width: canvas.width, height: canvas.height }, tolerance);
  if (!bounds) return null;
  const sx = r.w / canvas.width;
  const sy = r.h / canvas.height;
  const inSource = { x: r.x + bounds.x * sx, y: r.y + bounds.y * sy, w: bounds.w * sx, h: bounds.h * sy };
  const px = expandWithin(inSource, marginPx, r);
  return { x: px.x / source.size.width, y: px.y / source.size.height, w: px.w / source.size.width, h: px.h / source.size.height };
}
