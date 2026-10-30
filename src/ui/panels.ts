import { displayLabel } from '../crops';
import { toPixelRect } from '../geometry';
import type { Crop, DetectionStatus, Source } from '../model';
import type { AppState } from '../state';
import { cropsOf } from '../state';
import { el, iconButton } from './dom';

export interface SourceListCallbacks {
  readonly activate: (sourceId: string) => void;
  readonly remove: (sourceId: string) => void;
}

export interface CropListCallbacks {
  readonly select: (cropId: string) => void;
  readonly rename: (cropId: string, label: string) => void;
  readonly move: (cropId: string, delta: number) => void;
  readonly duplicate: (cropId: string) => void;
  readonly remove: (cropId: string) => void;
}

export interface StatusBadge {
  readonly text: string;
  readonly tone: 'good' | 'check' | 'bad' | 'busy';
}

export function statusBadge(status: DetectionStatus): StatusBadge {
  switch (status.kind) {
    case 'pending':
      return { text: 'detecting', tone: 'busy' };
    case 'failed':
      return { text: 'error', tone: 'bad' };
    case 'done':
      if (status.confidence >= 0.8) return { text: 'high', tone: 'good' };
      if (status.confidence >= 0.5) return { text: 'medium', tone: 'check' };
      return { text: 'review', tone: 'check' };
  }
}

export function renderSourceList(list: HTMLUListElement, state: AppState, callbacks: SourceListCallbacks): void {
  list.replaceChildren(
    ...state.sources.map(source => {
      const thumb = el('img', '', []);
      thumb.src = source.thumbUrl;
      thumb.alt = '';
      const badge = statusBadge(source.detection);
      const count = cropsOf(state, source.id).length;
      const meta = el('div', 'source-meta', [
        el('span', `badge ${badge.tone}`, [badge.text]),
        source.detection.kind === 'pending' ? '' : `${count} crop${count === 1 ? '' : 's'}`,
      ]);
      const info = el('div', '', [el('div', 'source-name', [source.name]), meta]);
      info.title = `${source.name} - ${source.size.width}x${source.size.height}`;
      const remove = iconButton(`Remove ${source.name}`, '×', 'remove-button');
      remove.addEventListener('click', event => {
        event.stopPropagation();
        callbacks.remove(source.id);
      });
      const item = el('li', source.id === state.activeId ? 'source-item active' : 'source-item', [thumb, info, remove]);
      item.tabIndex = 0;
      item.setAttribute('aria-current', String(source.id === state.activeId));
      item.addEventListener('click', () => callbacks.activate(source.id));
      item.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          callbacks.activate(source.id);
        }
      });
      return item;
    }),
  );
}

// Crops are immutable, so a thumbnail stays valid for as long as its crop object lives.
const thumbnails = new WeakMap<Crop, HTMLCanvasElement>();

function thumbnail(source: Source, crop: Crop): HTMLCanvasElement {
  const cached = thumbnails.get(crop);
  if (cached) return cached;
  const canvas = el('canvas', 'crop-thumb', []);
  canvas.width = 104;
  canvas.height = 88;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const r = toPixelRect(crop.rect, source.size.width, source.size.height);
    const scale = Math.min(canvas.width / r.w, canvas.height / r.h);
    const w = r.w * scale;
    const h = r.h * scale;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source.bitmap, r.x, r.y, r.w, r.h, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
  }
  thumbnails.set(crop, canvas);
  return canvas;
}

export function renderCropList(list: HTMLUListElement, source: Source, crops: readonly Crop[], selectedId: string | null, callbacks: CropListCallbacks): void {
  list.replaceChildren(
    ...crops.map((crop, i) => {
      const px = toPixelRect(crop.rect, source.size.width, source.size.height);
      const name = el('input', 'crop-name', []);
      name.type = 'text';
      name.value = crop.label ?? '';
      name.placeholder = displayLabel({ ...crop, label: null }, i);
      name.setAttribute('aria-label', `Name of crop ${i + 1}`);
      name.addEventListener('change', () => callbacks.rename(crop.id, name.value));
      name.addEventListener('keydown', event => {
        if (event.key === 'Enter') name.blur();
        if (event.key === 'Escape') {
          name.value = crop.label ?? '';
          name.blur();
        }
      });

      const up = iconButton('Move up', '↑', '');
      const down = iconButton('Move down', '↓', '');
      const copy = iconButton('Duplicate', '⧉', '');
      const remove = iconButton('Delete', '✕', 'danger');
      up.disabled = i === 0;
      down.disabled = i === crops.length - 1;
      up.addEventListener('click', () => callbacks.move(crop.id, -1));
      down.addEventListener('click', () => callbacks.move(crop.id, 1));
      copy.addEventListener('click', () => callbacks.duplicate(crop.id));
      remove.addEventListener('click', () => callbacks.remove(crop.id));

      const row = el('li', crop.id === selectedId ? 'crop-row selected' : 'crop-row', [
        thumbnail(source, crop),
        el('div', '', [name, el('div', 'crop-meta', [`${px.w} × ${px.h}`])]),
        el('div', 'crop-actions', [up, down, copy, remove]),
      ]);
      row.addEventListener('click', event => {
        if (!(event.target instanceof HTMLButtonElement)) callbacks.select(crop.id);
      });
      return row;
    }),
  );
  list.querySelector('.crop-row.selected')?.scrollIntoView({ block: 'nearest' });
}
