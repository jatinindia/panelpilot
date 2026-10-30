import { describe, expect, it } from 'vitest';
import type { Crop } from '../src/model';
import { archiveName, planFiles } from '../src/plan';

const crop = (id: string, label: string | null): Crop => ({ id, rect: { x: 0, y: 0, w: 1, h: 1 }, label });
const ext = (extension: string) => () => extension;

describe('planFiles', () => {
  it('uses flat names that keep the original file name for a single source', () => {
    const files = planFiles([{ source: { name: 'Summer Sale.JPG' }, entries: [{ crop: crop('a', null), index: 0 }, { crop: crop('b', null), index: 1 }], total: 2 }], '{name}-{n}', ext('JPG'));
    expect(files.map(f => f.path)).toEqual(['Summer Sale-1.JPG', 'Summer Sale-2.JPG']);
    expect(files.map(f => f.crop.id)).toEqual(['a', 'b']);
  });

  it('keeps the original panel index when exporting a subset', () => {
    const files = planFiles([{ source: { name: 'x.png' }, entries: [{ crop: crop('c', null), index: 4 }], total: 9 }], '{n}', ext('jpg'));
    expect(files.map(f => f.path)).toEqual(['5.jpg']);
  });

  it('puts multiple sources in unique folders named after the uploads', () => {
    const group = { source: { name: 'Promo.png' }, entries: [{ crop: crop('a', null), index: 0 }], total: 1 };
    const files = planFiles([group, group], '{name}-{n}', ext('png'));
    expect(files.map(f => f.path)).toEqual(['Promo/Promo-1.png', 'Promo-2/Promo-1.png']);
  });

  it('asks for the extension per source', () => {
    const a = { source: { name: 'a.JPG' }, entries: [{ crop: crop('a', null), index: 0 }], total: 1 };
    const b = { source: { name: 'b.webp' }, entries: [{ crop: crop('b', null), index: 0 }], total: 1 };
    const files = planFiles([a, b], '{name}', s => (s.name.endsWith('JPG') ? 'JPG' : 'webp'));
    expect(files.map(f => f.path)).toEqual(['a/a.JPG', 'b/b.webp']);
  });

  it('de-duplicates names that collide inside a folder', () => {
    const files = planFiles([{ source: { name: 'x.png' }, entries: [{ crop: crop('a', 'Hero'), index: 0 }, { crop: crop('b', 'hero'), index: 1 }], total: 2 }], '{label}', ext('png'));
    expect(files.map(f => f.path)).toEqual(['Hero.png', 'hero-2.png']);
  });

  it('labels unnamed crops by position', () => {
    const files = planFiles([{ source: { name: 'x.png' }, entries: [{ crop: crop('a', null), index: 2 }], total: 3 }], '{label}', ext('png'));
    expect(files.map(f => f.path)).toEqual(['Panel 03.png']);
  });
});

describe('archiveName', () => {
  it('names the zip after a single source, or generically for several', () => {
    expect(archiveName([{ name: 'Promo Pack.png' }])).toBe('Promo Pack crops.zip');
    expect(archiveName([{ name: 'a' }, { name: 'b' }])).toBe('PanelPilot crops.zip');
  });
});
