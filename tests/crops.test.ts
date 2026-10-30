import { describe, expect, it } from 'vitest';
import { cloneCrops, cropsFromPanels, displayLabel, duplicateCrop, moveCropInList, removeCrop, renameCrop, updateCropRect } from '../src/crops';
import type { Crop } from '../src/model';

function ids(prefix: string): () => string {
  let n = 0;
  return () => `${prefix}${++n}`;
}

const list: readonly Crop[] = [
  { id: 'a', rect: { x: 0, y: 0, w: 0.5, h: 1 }, label: null },
  { id: 'b', rect: { x: 0.5, y: 0, w: 0.5, h: 1 }, label: 'Hero' },
  { id: 'c', rect: { x: 0.2, y: 0.2, w: 0.1, h: 0.1 }, label: null },
];

describe('cropsFromPanels', () => {
  it('normalises pixel panels to fractions of the analysed image', () => {
    const crops = cropsFromPanels([{ x: 10, y: 0, w: 40, h: 50 }], { width: 100, height: 50 }, ids('p'));
    expect(crops).toEqual([{ id: 'p1', rect: { x: 0.1, y: 0, w: 0.4, h: 1 }, label: null }]);
  });
});

describe('displayLabel', () => {
  it('uses the custom label or a numbered default', () => {
    expect(displayLabel(list[0]!, 0)).toBe('Panel 01');
    expect(displayLabel(list[1]!, 1)).toBe('Hero');
  });
});

describe('list operations', () => {
  it('moves a crop up and down without mutating the input', () => {
    const snapshot = structuredClone(list);
    expect(moveCropInList(list, 'b', -1).map(c => c.id)).toEqual(['b', 'a', 'c']);
    expect(moveCropInList(list, 'b', 1).map(c => c.id)).toEqual(['a', 'c', 'b']);
    expect(moveCropInList(list, 'a', -1)).toBe(list);
    expect(list).toEqual(snapshot);
  });

  it('duplicates right after the original with an offset that stays in bounds', () => {
    const out = duplicateCrop(list, 'b', 'b2');
    expect(out.map(c => c.id)).toEqual(['a', 'b', 'b2', 'c']);
    const copy = out[2]!;
    expect(copy.rect.x + copy.rect.w).toBeLessThanOrEqual(1);
    expect(copy.label).toBe('Hero copy');
  });

  it('removes, renames and updates', () => {
    expect(removeCrop(list, 'a').map(c => c.id)).toEqual(['b', 'c']);
    expect(renameCrop(list, 'a', '  Front  ')[0]!.label).toBe('Front');
    expect(renameCrop(list, 'b', '   ')[1]!.label).toBeNull();
    expect(updateCropRect(list, 'c', { x: 0, y: 0, w: 1, h: 1 })[2]!.rect).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it('clones a layout with fresh ids', () => {
    const out = cloneCrops(list, ids('n'));
    expect(out.map(c => c.id)).toEqual(['n1', 'n2', 'n3']);
    expect(out.map(c => c.rect)).toEqual(list.map(c => c.rect));
  });
});
