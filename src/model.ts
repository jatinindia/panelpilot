import type { DetectionMethod, Rect } from './types';

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

/** A crop region. `rect` is in 0..1 fractions of the source image. */
export interface Crop {
  readonly id: string;
  readonly rect: Rect;
  /** User-given name; null means "Panel NN" by position. */
  readonly label: string | null;
}

export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export type DetectionStatus =
  | { readonly kind: 'pending' }
  | { readonly kind: 'done'; readonly confidence: number; readonly method: DetectionMethod }
  | { readonly kind: 'failed'; readonly message: string };

export interface Source {
  readonly id: string;
  readonly name: string;
  readonly size: Size;
  readonly bitmap: ImageBitmap;
  /** Object URL for the sidebar thumbnail; revoked when the source is removed. */
  readonly thumbUrl: string;
  readonly detection: DetectionStatus;
}
