import { describe, expect, it } from 'vitest';
import type { Crop, Source } from '../src/model';
import {
  activeCrops,
  addSource,
  applyLayoutToAll,
  commitCrops,
  initialState,
  redoActive,
  removeSource,
  selectCrop,
  setActive,
  setDetected,
  undoActive,
} from '../src/state';

function source(id: string): Source {
  return {
    id,
    name: `${id}.png`,
    size: { width: 100, height: 100 },
    bitmap: {} as ImageBitmap,
    thumbUrl: `blob:${id}`,
    detection: { kind: 'pending' },
  };
}

const crop = (id: string, x: number): Crop => ({ id, rect: { x, y: 0, w: 0.1, h: 0.1 }, label: null });

function ids(prefix: string): () => string {
  let n = 0;
  return () => `${prefix}${++n}`;
}

const settings = { sensitivity: 0.5, trimMargins: true };

describe('state', () => {
  it('activates a newly added source', () => {
    const s = addSource(addSource(initialState(settings), source('a')), source('b'));
    expect(s.activeId).toBe('b');
    expect(s.sources.map(x => x.id)).toEqual(['a', 'b']);
  });

  it('stores detection results as a fresh history and selects nothing', () => {
    const s = setDetected(addSource(initialState(settings), source('a')), 'a', [crop('c1', 0)], { kind: 'done', confidence: 1, method: 'gutters' });
    expect(activeCrops(s).map(c => c.id)).toEqual(['c1']);
    expect(s.sources[0]?.detection.kind).toBe('done');
    expect(undoActive(s)).toEqual(s);
  });

  it('commits edits with undo and redo, dropping a selection that no longer exists', () => {
    let s = setDetected(addSource(initialState(settings), source('a')), 'a', [crop('c1', 0)], { kind: 'done', confidence: 1, method: 'gutters' });
    s = commitCrops(s, 'a', [crop('c1', 0), crop('c2', 0.5)]);
    s = selectCrop(s, 'c2');
    s = undoActive(s);
    expect(activeCrops(s).map(c => c.id)).toEqual(['c1']);
    expect(s.selectedId).toBeNull();
    s = redoActive(s);
    expect(activeCrops(s).map(c => c.id)).toEqual(['c1', 'c2']);
  });

  it('removing the active source activates a neighbour', () => {
    let s = addSource(addSource(addSource(initialState(settings), source('a')), source('b')), source('c'));
    s = setActive(s, 'b');
    s = removeSource(s, 'b');
    expect(s.activeId).toBe('c');
    expect(s.crops.has('b')).toBe(false);
    s = removeSource(removeSource(s, 'c'), 'a');
    expect(s.activeId).toBeNull();
  });

  it('switching source clears the crop selection', () => {
    let s = addSource(addSource(initialState(settings), source('a')), source('b'));
    s = selectCrop(s, 'x');
    expect(setActive(s, 'a').selectedId).toBeNull();
  });

  it('applies the active layout to every other source as an undoable edit', () => {
    let s = addSource(addSource(initialState(settings), source('a')), source('b'));
    s = setDetected(s, 'a', [crop('a1', 0), crop('a2', 0.5)], { kind: 'done', confidence: 1, method: 'gutters' });
    s = setDetected(s, 'b', [crop('b1', 0.3)], { kind: 'done', confidence: 0, method: 'none' });
    s = setActive(s, 'a');
    s = applyLayoutToAll(s, ids('n'));
    const bCrops = s.crops.get('b')?.present ?? [];
    expect(bCrops.map(c => c.id)).toEqual(['n1', 'n2']);
    expect(bCrops.map(c => c.rect.x)).toEqual([0, 0.5]);
    s = setActive(s, 'b');
    expect(activeCrops(undoActive(s)).map(c => c.id)).toEqual(['b1']);
  });
});
