import { describe, expect, it } from 'vitest';
import type { Crop, Source } from '../src/model';
import { cropsFromTemplate, parseSnapshot, parseTemplate, restoreState, templateFromCrops, toSnapshot } from '../src/snapshot';
import { addSource, commitCrops, initialState, selectCrop, setDetected } from '../src/state';

function source(id: string): Source {
  return {
    id,
    name: `${id}.png`,
    size: { width: 100, height: 50 },
    bitmap: {} as ImageBitmap,
    thumbUrl: `blob:${id}`,
    blob: new Blob(),
    detection: { kind: 'pending' },
  };
}

const crop = (id: string, label: string | null): Crop => ({ id, rect: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 }, label });

function ids(prefix: string): () => string {
  let n = 0;
  return () => `${prefix}${++n}`;
}

describe('workspace snapshot', () => {
  const settings = { sensitivity: 0.7, trimMargins: false };
  let state = addSource(addSource(initialState(settings), source('a')), source('b'));
  state = setDetected(state, 'a', [crop('a1', 'Hero')], { kind: 'done', confidence: 0.9, method: 'gutters' });
  state = commitCrops(state, 'a', [crop('a1', 'Hero'), crop('a2', null)]);
  state = selectCrop(state, 'a2');

  it('round-trips through JSON and restores sources that still have images', () => {
    const snapshot = parseSnapshot(JSON.parse(JSON.stringify(toSnapshot(state))));
    const images = new Map([['a', { bitmap: {} as ImageBitmap, thumbUrl: 'blob:new-a', blob: new Blob() }]]);
    const restored = restoreState(snapshot, images);

    expect(restored.settings).toEqual(settings);
    expect(restored.sources.map(s => s.id)).toEqual(['a']);
    expect(restored.sources[0]?.thumbUrl).toBe('blob:new-a');
    expect(restored.sources[0]?.detection).toEqual({ kind: 'done', confidence: 0.9, method: 'gutters' });
    expect(restored.crops.get('a')?.present).toEqual([crop('a1', 'Hero'), crop('a2', null)]);
    expect(restored.crops.get('a')?.past).toEqual([]);
    expect(restored.activeId).toBe('a');
    expect(restored.selectedId).toBeNull();
  });

  it('rejects data that does not match the schema', () => {
    expect(() => parseSnapshot({ version: 99 })).toThrow(/version/);
    expect(() => parseSnapshot({ version: 1, sources: [{ id: 3 }], settings, activeId: null })).toThrow(/source/);
    expect(() => parseSnapshot('nope')).toThrow();
  });
});

describe('layout templates', () => {
  it('stores geometry and labels, and creates fresh crops from them', () => {
    const template = templateFromCrops('  4-up grid ', [crop('x', 'Hero'), crop('y', null)], 't1', 1234);
    expect(template).toEqual({ id: 't1', name: '4-up grid', createdAt: 1234, crops: [{ rect: crop('x', null).rect, label: 'Hero' }, { rect: crop('y', null).rect, label: null }] });
    expect(parseTemplate(JSON.parse(JSON.stringify(template)))).toEqual(template);
    expect(cropsFromTemplate(template, ids('n')).map(c => [c.id, c.label])).toEqual([['n1', 'Hero'], ['n2', null]]);
  });

  it('rejects malformed templates', () => {
    expect(() => parseTemplate({ id: 't', name: 'x', createdAt: 1, crops: [{ rect: { x: 'a' } }] })).toThrow(/rect/);
  });
});
