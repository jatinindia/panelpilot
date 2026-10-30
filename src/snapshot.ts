import { createHistory, type History } from './history';
import type { Crop, DetectionStatus, Size, Source } from './model';
import type { AppState } from './state';
import type { DetectionMethod, DetectOptions, Rect } from './types';

/*
 * Serializable forms of the workspace and of saved layouts, plus strict
 * parsers for reading them back from storage (data may come from an older
 * or corrupted save, so nothing is trusted).
 */

const SNAPSHOT_VERSION = 1;

export interface StoredSource {
  readonly id: string;
  readonly name: string;
  readonly size: Size;
  readonly detection: DetectionStatus;
}

export interface StoredCrops {
  readonly sourceId: string;
  readonly crops: readonly Crop[];
}

export interface WorkspaceSnapshot {
  readonly version: number;
  readonly sources: readonly StoredSource[];
  readonly crops: readonly StoredCrops[];
  readonly activeId: string | null;
  readonly settings: DetectOptions;
}

export interface RestoredImage {
  readonly bitmap: ImageBitmap;
  readonly thumbUrl: string;
  readonly blob: Blob;
}

export interface TemplateCrop {
  readonly rect: Rect;
  readonly label: string | null;
}

export interface LayoutTemplate {
  readonly id: string;
  readonly name: string;
  readonly createdAt: number;
  readonly crops: readonly TemplateCrop[];
}

export function toSnapshot(state: AppState): WorkspaceSnapshot {
  return {
    version: SNAPSHOT_VERSION,
    sources: state.sources.map(s => ({ id: s.id, name: s.name, size: s.size, detection: s.detection })),
    crops: state.sources.map(s => ({ sourceId: s.id, crops: state.crops.get(s.id)?.present ?? [] })),
    activeId: state.activeId,
    settings: state.settings,
  };
}

/** Rebuild app state. Sources whose image could not be loaded are dropped; undo history starts fresh. */
export function restoreState(snapshot: WorkspaceSnapshot, images: ReadonlyMap<string, RestoredImage>): AppState {
  const sources: Source[] = snapshot.sources.flatMap(s => {
    const image = images.get(s.id);
    return image ? [{ ...s, ...image }] : [];
  });
  const crops = new Map<string, History<readonly Crop[]>>(
    sources.map(s => [s.id, createHistory(snapshot.crops.find(c => c.sourceId === s.id)?.crops ?? [])]),
  );
  const activeId = sources.some(s => s.id === snapshot.activeId) ? snapshot.activeId : (sources[0]?.id ?? null);
  return { sources, crops, activeId, selectedId: null, settings: snapshot.settings };
}

export function templateFromCrops(name: string, crops: readonly Crop[], id: string, createdAt: number): LayoutTemplate {
  return { id, name: name.trim(), createdAt, crops: crops.map(c => ({ rect: c.rect, label: c.label })) };
}

export function cropsFromTemplate(template: LayoutTemplate, nextId: () => string): Crop[] {
  return template.crops.map(c => ({ id: nextId(), rect: c.rect, label: c.label }));
}

// ---------- Parsing ----------

export function parseSnapshot(value: unknown): WorkspaceSnapshot {
  const v = object(value, 'workspace');
  if (!('version' in v) || v.version !== SNAPSHOT_VERSION) {
    throw new Error(`Unsupported saved workspace version ${'version' in v ? String(v.version) : '(missing)'}; expected ${SNAPSHOT_VERSION}`);
  }
  return {
    version: SNAPSHOT_VERSION,
    sources: array(field(v, 'sources'), 'sources').map(parseSource),
    crops: array(field(v, 'crops'), 'crops').map(parseStoredCrops),
    activeId: nullableString(field(v, 'activeId'), 'activeId'),
    settings: parseSettings(field(v, 'settings')),
  };
}

export function parseTemplate(value: unknown): LayoutTemplate {
  const v = object(value, 'layout');
  return {
    id: string(field(v, 'id'), 'layout id'),
    name: string(field(v, 'name'), 'layout name'),
    createdAt: number(field(v, 'createdAt'), 'layout createdAt'),
    crops: array(field(v, 'crops'), 'layout crops').map(c => {
      const o = object(c, 'layout crop');
      return { rect: parseRect(field(o, 'rect')), label: nullableString(field(o, 'label'), 'crop label') };
    }),
  };
}

function parseSource(value: unknown): StoredSource {
  const v = object(value, 'source');
  const size = object(field(v, 'size'), 'source size');
  return {
    id: string(field(v, 'id'), 'source id'),
    name: string(field(v, 'name'), 'source name'),
    size: { width: number(field(size, 'width'), 'source width'), height: number(field(size, 'height'), 'source height') },
    detection: parseDetection(field(v, 'detection')),
  };
}

function parseDetection(value: unknown): DetectionStatus {
  const v = object(value, 'detection');
  const kind = field(v, 'kind');
  if (kind === 'pending') return { kind };
  if (kind === 'failed') return { kind, message: string(field(v, 'message'), 'detection message') };
  if (kind === 'done') return { kind, confidence: number(field(v, 'confidence'), 'confidence'), method: parseMethod(field(v, 'method')) };
  throw new Error(`Invalid detection kind: ${JSON.stringify(kind)}`);
}

function parseMethod(value: unknown): DetectionMethod {
  if (value === 'gutters' || value === 'seams' || value === 'none') return value;
  throw new Error(`Invalid detection method: ${JSON.stringify(value)}`);
}

function parseStoredCrops(value: unknown): StoredCrops {
  const v = object(value, 'crop list');
  return { sourceId: string(field(v, 'sourceId'), 'crop list sourceId'), crops: array(field(v, 'crops'), 'crops').map(parseCrop) };
}

function parseCrop(value: unknown): Crop {
  const v = object(value, 'crop');
  return { id: string(field(v, 'id'), 'crop id'), rect: parseRect(field(v, 'rect')), label: nullableString(field(v, 'label'), 'crop label') };
}

function parseRect(value: unknown): Rect {
  const v = object(value, 'rect');
  return { x: number(field(v, 'x'), 'rect x'), y: number(field(v, 'y'), 'rect y'), w: number(field(v, 'w'), 'rect w'), h: number(field(v, 'h'), 'rect h') };
}

function parseSettings(value: unknown): DetectOptions {
  const v = object(value, 'settings');
  const trim = field(v, 'trimMargins');
  if (typeof trim !== 'boolean') throw new Error(`Invalid settings trimMargins: ${JSON.stringify(trim)}`);
  return { sensitivity: number(field(v, 'sensitivity'), 'settings sensitivity'), trimMargins: trim };
}

function object(value: unknown, what: string): object {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`Invalid ${what}: expected an object, got ${JSON.stringify(value)}`);
  return value;
}

function field(v: object, key: string): unknown {
  return key in v ? (v as { readonly [k: string]: unknown })[key] : undefined;
}

function array(value: unknown, what: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`Invalid ${what}: expected an array`);
  return value;
}

function string(value: unknown, what: string): string {
  if (typeof value !== 'string') throw new Error(`Invalid ${what}: expected a string, got ${JSON.stringify(value)}`);
  return value;
}

function nullableString(value: unknown, what: string): string | null {
  return value === null ? null : string(value, what);
}

function number(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Invalid ${what}: expected a number, got ${JSON.stringify(value)}`);
  return value;
}
