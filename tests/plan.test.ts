import { describe, expect, it } from 'vitest';
import type { Crop } from '../src/model';
import { archiveName, planFiles } from '../src/plan';

const crop = (id: string, label: string | null): Crop => ({ id, rect: { x: 0, y: 0, w: 1, h: 1 }, label });

describe('planFiles', () => {
  it('uses flat names for a single source', () => {
    const files = planFiles([{ source: { name: 'Summer.jpg' }, entries: [{ crop: crop('a', null), index: 0 }, { crop: crop('b', null), index: 1 }], total: 2 }], '{source}-{n}', 'png');
    expect(files.map(f => f.path)).toEqual(['summer-01.png', 'summer-02.png']);
    expect(files.map(f => f.crop.id)).toEqual(['a', 'b']);
  });

  it('keeps the original panel index when exporting a subset', () => {
    const files = planFiles([{ source: { name: 'x.png' }, entries: [{ crop: crop('c', null), index: 4 }], total: 9 }], '{n}', 'jpg');
    expect(files.map(f => f.path)).toEqual(['05.jpg']);
  });

  it('puts multiple sources in unique folders', () => {
    const group = { source: { name: 'promo.png' }, entries: [{ crop: crop('a', null), index: 0 }], total: 1 };
    const files = planFiles([group, group], '{source}-{n}', 'png');
    expect(files.map(f => f.path)).toEqual(['promo/promo-01.png', 'promo-2/promo-01.png']);
  });

  it('de-duplicates names that collide inside a folder', () => {
    const files = planFiles([{ source: { name: 'x.png' }, entries: [{ crop: crop('a', 'Hero'), index: 0 }, { crop: crop('b', 'hero'), index: 1 }], total: 2 }], '{label}', 'png');
    expect(files.map(f => f.path)).toEqual(['hero.png', 'hero-2.png']);
  });

  it('labels unnamed crops by position', () => {
    const files = planFiles([{ source: { name: 'x.png' }, entries: [{ crop: crop('a', null), index: 2 }], total: 3 }], '{label}', 'png');
    expect(files.map(f => f.path)).toEqual(['panel-03.png']);
  });
});

describe('archiveName', () => {
  it('names the zip after a single source, or generically for several', () => {
    expect(archiveName([{ name: 'Promo Pack.png' }])).toBe('promo-pack-crops.zip');
    expect(archiveName([{ name: 'a' }, { name: 'b' }])).toBe('panelpilot-crops.zip');
  });
});
