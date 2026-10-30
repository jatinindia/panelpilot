import type { Size } from './model';
import type { PixelImage } from './types';

/** Longest side of the downscaled copy used for detection. */
const ANALYSIS_MAX_SIDE = 1600;

export async function decodeImage(blob: Blob, name: string): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(blob);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read "${name}" (${blob.type || 'unknown type'}, ${blob.size} bytes): ${reason}`);
  }
}

export function bitmapSize(bitmap: ImageBitmap): Size {
  return { width: bitmap.width, height: bitmap.height };
}

export function analysisPixels(bitmap: ImageBitmap): PixelImage {
  const scale = Math.min(1, ANALYSIS_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error(`Could not create a ${width}x${height} canvas for analysis`);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);
  return { data, width, height };
}
