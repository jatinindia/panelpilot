import { toSnapshot } from './snapshot';
import type { AppState } from './state';
import { saveWorkspace } from './storage';

export type SaveStatus =
  | { readonly kind: 'idle' }
  | { readonly kind: 'pending' }
  | { readonly kind: 'saved' }
  | { readonly kind: 'failed'; readonly message: string };

export interface Autosave {
  /** Save `state` after a short quiet period; later calls replace earlier ones. */
  readonly schedule: (state: AppState) => void;
  readonly status: () => SaveStatus;
}

export function createAutosave(delayMs: number, onStatus: (status: SaveStatus) => void): Autosave {
  let status: SaveStatus = { kind: 'idle' };
  let timer = 0;
  let latest: AppState | null = null;
  // Writes run one at a time so an older snapshot can never land after a newer one.
  let chain: Promise<void> = Promise.resolve();

  const set = (next: SaveStatus): void => {
    status = next;
    onStatus(next);
  };

  const flush = (): void => {
    const state = latest;
    if (!state) return;
    latest = null;
    chain = chain.then(() =>
      saveWorkspace(toSnapshot(state)).then(
        () => {
          if (latest === null) set({ kind: 'saved' });
        },
        (error: unknown) => set({ kind: 'failed', message: error instanceof Error ? error.message : String(error) }),
      ),
    );
  };

  return {
    schedule(state) {
      latest = state;
      set({ kind: 'pending' });
      window.clearTimeout(timer);
      timer = window.setTimeout(flush, delayMs);
    },
    status: () => status,
  };
}
