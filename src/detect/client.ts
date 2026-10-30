import type { DetectionResult, DetectOptions, PixelImage } from '../types';
import type { DetectRequest, DetectResponse } from './protocol';

interface Pending {
  readonly resolve: (result: DetectionResult) => void;
  readonly reject: (error: Error) => void;
}

const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
const pending = new Map<number, Pending>();
let sequence = 0;

worker.onmessage = (event: MessageEvent<DetectResponse>) => {
  const response = event.data;
  const entry = pending.get(response.id);
  if (!entry) return;
  pending.delete(response.id);
  if (response.ok) entry.resolve(response.result);
  else entry.reject(new Error(response.message));
};

worker.onerror = event => {
  const error = new Error(`Detection worker crashed: ${event.message} (${event.filename}:${event.lineno})`);
  pending.forEach(entry => entry.reject(error));
  pending.clear();
};

/** Run panel detection off the main thread. The pixel buffer is transferred, not copied. */
export function detectInWorker(image: PixelImage, options: DetectOptions): Promise<DetectionResult> {
  const id = ++sequence;
  const buffer = image.data.buffer;
  if (!(buffer instanceof ArrayBuffer)) throw new Error('Pixel data must be backed by an ArrayBuffer');
  const request: DetectRequest = { id, width: image.width, height: image.height, buffer, options };
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage(request, [buffer]);
  });
}
