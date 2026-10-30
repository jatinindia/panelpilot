import { detectPanels } from './detect';
import type { DetectRequest, DetectResponse } from './protocol';

interface WorkerScope {
  onmessage: ((event: MessageEvent<DetectRequest>) => void) | null;
  postMessage(message: DetectResponse): void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = event => {
  const { id, width, height, buffer, options } = event.data;
  try {
    const result = detectPanels({ data: new Uint8ClampedArray(buffer), width, height }, options);
    scope.postMessage({ id, ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error);
    scope.postMessage({ id, ok: false, message: `Detection failed for ${width}x${height} image: ${message}` });
  }
};
