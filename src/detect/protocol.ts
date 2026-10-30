import type { DetectionResult, DetectOptions } from '../types';

export interface DetectRequest {
  readonly id: number;
  readonly width: number;
  readonly height: number;
  readonly buffer: ArrayBuffer;
  readonly options: DetectOptions;
}

export type DetectResponse =
  | { readonly id: number; readonly ok: true; readonly result: DetectionResult }
  | { readonly id: number; readonly ok: false; readonly message: string };
