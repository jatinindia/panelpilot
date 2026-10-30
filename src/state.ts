import { cloneCrops } from './crops';
import { createHistory, pushHistory, redo, undo, type History } from './history';
import type { Crop, DetectionStatus, Source } from './model';
import type { DetectOptions } from './types';

const HISTORY_LIMIT = 100;

export interface AppState {
  readonly sources: readonly Source[];
  /** Crop list with undo history, per source id. */
  readonly crops: ReadonlyMap<string, History<readonly Crop[]>>;
  readonly activeId: string | null;
  readonly selectedId: string | null;
  readonly settings: DetectOptions;
}

export function initialState(settings: DetectOptions): AppState {
  return { sources: [], crops: new Map(), activeId: null, selectedId: null, settings };
}

export function activeSource(state: AppState): Source | null {
  return state.sources.find(s => s.id === state.activeId) ?? null;
}

export function activeCrops(state: AppState): readonly Crop[] {
  return state.activeId === null ? [] : cropsOf(state, state.activeId);
}

export function cropsOf(state: AppState, sourceId: string): readonly Crop[] {
  return state.crops.get(sourceId)?.present ?? [];
}

export function addSource(state: AppState, source: Source): AppState {
  return {
    ...state,
    sources: [...state.sources, source],
    crops: withEntry(state.crops, source.id, createHistory<readonly Crop[]>([])),
    activeId: source.id,
    selectedId: null,
  };
}

export function removeSource(state: AppState, id: string): AppState {
  const index = state.sources.findIndex(s => s.id === id);
  if (index < 0) return state;
  const sources = state.sources.filter(s => s.id !== id);
  const crops = new Map(state.crops);
  crops.delete(id);
  const wasActive = state.activeId === id;
  const neighbour = sources[Math.min(index, sources.length - 1)] ?? null;
  return {
    ...state,
    sources,
    crops,
    activeId: wasActive ? (neighbour?.id ?? null) : state.activeId,
    selectedId: wasActive ? null : state.selectedId,
  };
}

export function setActive(state: AppState, id: string): AppState {
  if (state.activeId === id) return state;
  return { ...state, activeId: id, selectedId: null };
}

export function selectCrop(state: AppState, cropId: string | null): AppState {
  return state.selectedId === cropId ? state : { ...state, selectedId: cropId };
}

export function setSettings(state: AppState, settings: DetectOptions): AppState {
  return { ...state, settings };
}

export function setDetectionStatus(state: AppState, sourceId: string, detection: DetectionStatus): AppState {
  return { ...state, sources: state.sources.map(s => (s.id === sourceId ? { ...s, detection } : s)) };
}

/** First detection of a source: replaces its crops without an undo step. */
export function setDetected(state: AppState, sourceId: string, crops: readonly Crop[], detection: DetectionStatus): AppState {
  if (!state.crops.has(sourceId)) return state;
  const next = setDetectionStatus(state, sourceId, detection);
  return { ...next, crops: withEntry(next.crops, sourceId, createHistory(crops)) };
}

/** A user edit: recorded in the source's undo history. */
export function commitCrops(state: AppState, sourceId: string, crops: readonly Crop[]): AppState {
  const history = state.crops.get(sourceId);
  if (!history || history.present === crops) return state;
  return withValidSelection({ ...state, crops: withEntry(state.crops, sourceId, pushHistory(history, crops, HISTORY_LIMIT)) });
}

export function undoActive(state: AppState): AppState {
  return mapActiveHistory(state, undo);
}

export function redoActive(state: AppState): AppState {
  return mapActiveHistory(state, redo);
}

export function applyLayoutToAll(state: AppState, nextId: () => string): AppState {
  if (state.activeId === null) return state;
  const layout = activeCrops(state);
  return state.sources
    .filter(s => s.id !== state.activeId)
    .reduce((acc, s) => commitCrops(acc, s.id, cloneCrops(layout, nextId)), state);
}

function mapActiveHistory(state: AppState, fn: (h: History<readonly Crop[]>) => History<readonly Crop[]>): AppState {
  if (state.activeId === null) return state;
  const history = state.crops.get(state.activeId);
  if (!history) return state;
  const next = fn(history);
  if (next === history) return state;
  return withValidSelection({ ...state, crops: withEntry(state.crops, state.activeId, next) });
}

function withValidSelection(state: AppState): AppState {
  if (state.selectedId === null || activeCrops(state).some(c => c.id === state.selectedId)) return state;
  return { ...state, selectedId: null };
}

function withEntry<K, V>(map: ReadonlyMap<K, V>, key: K, value: V): ReadonlyMap<K, V> {
  const next = new Map(map);
  next.set(key, value);
  return next;
}
