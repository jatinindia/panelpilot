import { moveRect } from './geometry';
import type { Crop, Size } from './model';
import type { Rect } from './types';

const DUPLICATE_OFFSET = 0.02;

export function cropsFromPanels(panels: readonly Rect[], analysed: Size, nextId: () => string): Crop[] {
  return panels.map(p => ({
    id: nextId(),
    rect: { x: p.x / analysed.width, y: p.y / analysed.height, w: p.w / analysed.width, h: p.h / analysed.height },
    label: null,
  }));
}

export function displayLabel(crop: Crop, index: number): string {
  return crop.label ?? `Panel ${String(index + 1).padStart(2, '0')}`;
}

export function moveCropInList(crops: readonly Crop[], id: string, delta: number): readonly Crop[] {
  const from = crops.findIndex(c => c.id === id);
  const to = from + delta;
  const crop = crops[from];
  if (from < 0 || to < 0 || to >= crops.length || !crop) return crops;
  const rest = crops.filter(c => c.id !== id);
  return [...rest.slice(0, to), crop, ...rest.slice(to)];
}

export function duplicateCrop(crops: readonly Crop[], id: string, newId: string): readonly Crop[] {
  const index = crops.findIndex(c => c.id === id);
  const original = crops[index];
  if (!original) return crops;
  const copy: Crop = {
    id: newId,
    rect: moveRect(original.rect, DUPLICATE_OFFSET, DUPLICATE_OFFSET),
    label: original.label === null ? null : `${original.label} copy`,
  };
  return [...crops.slice(0, index + 1), copy, ...crops.slice(index + 1)];
}

export function removeCrop(crops: readonly Crop[], id: string): readonly Crop[] {
  return crops.filter(c => c.id !== id);
}

export function renameCrop(crops: readonly Crop[], id: string, label: string): readonly Crop[] {
  const trimmed = label.trim();
  return crops.map(c => (c.id === id ? { ...c, label: trimmed === '' ? null : trimmed } : c));
}

export function updateCropRect(crops: readonly Crop[], id: string, rect: Rect): readonly Crop[] {
  return crops.map(c => (c.id === id ? { ...c, rect } : c));
}

/** Copy a layout (e.g. to another collage that uses the same template). */
export function cloneCrops(crops: readonly Crop[], nextId: () => string): Crop[] {
  return crops.map(c => ({ ...c, id: nextId() }));
}
