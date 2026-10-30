import type { PixelImage, Rect } from '../../src/types';

export type Rgb = readonly [number, number, number];

export function blankImage(width: number, height: number, color: Rgb): PixelImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = color[0];
    data[i * 4 + 1] = color[1];
    data[i * 4 + 2] = color[2];
    data[i * 4 + 3] = 255;
  }
  return { data, width, height };
}

// Deterministic textured fill so that no row or column inside the panel is uniform.
export function paintTexture(image: PixelImage, rect: Rect, base: Rgb, seed: number): void {
  let state = seed >>> 0 || 1;
  const next = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      const i = (y * image.width + x) * 4;
      const swing = (next() - 0.5) * 140;
      image.data[i] = base[0] + swing;
      image.data[i + 1] = base[1] + swing;
      image.data[i + 2] = base[2] + swing;
      image.data[i + 3] = 255;
    }
  }
}

export function paintSolid(image: PixelImage, rect: Rect, color: Rgb): void {
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      const i = (y * image.width + x) * 4;
      image.data[i] = color[0];
      image.data[i + 1] = color[1];
      image.data[i + 2] = color[2];
      image.data[i + 3] = 255;
    }
  }
}

// Mild per-pixel noise everywhere, imitating JPEG artifacts in gutters.
export function addNoise(image: PixelImage, amplitude: number, seed: number): void {
  let state = seed >>> 0 || 1;
  for (let i = 0; i < image.width * image.height; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const delta = Math.round(((state / 0x100000000) - 0.5) * 2 * amplitude);
    for (let c = 0; c < 3; c++) {
      const idx = i * 4 + c;
      image.data[idx] = (image.data[idx] ?? 0) + delta;
    }
  }
}
