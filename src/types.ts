/** Axis-aligned rectangle. Units depend on context (pixels or 0..1 fractions). */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface PixelImage {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

export interface DetectOptions {
  /** 0 = only obvious gutters, 1 = split aggressively. */
  readonly sensitivity: number;
  /** Remove background-colored margins around each panel. */
  readonly trimMargins: boolean;
}

export type DetectionMethod = 'gutters' | 'seams' | 'none';

export interface DetectionResult {
  /** Panels in reading order, in pixel coordinates of the analysed image. */
  readonly panels: readonly Rect[];
  /** 0..1. Zero means nothing was split and the user should review. */
  readonly confidence: number;
  readonly method: DetectionMethod;
}

export type ExportFormat = 'png' | 'jpeg' | 'webp';

/** 'original' keeps each upload's own format when the browser can encode it. */
export type FormatChoice = ExportFormat | 'original';
