import { displayLabel } from '../crops';
import { toPixelRect } from '../geometry';
import type { Crop, DetectionStatus, Source } from '../model';
import type { AppState } from '../state';
import { cropsOf } from '../state';
import { el, iconOnlyButton } from './dom';

export interface SourceListCallbacks {
  readonly activate: (sourceId: string) => void;
  readonly remove: (sourceId: string) => void;
}

export interface CropListCallbacks {
  readonly select: (cropId: string) => void;
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
      return { text: 'Detecting', tone: 'busy' };
    case 'failed':
      return { text: 'Detection failed', tone: 'bad' };
    case 'done':
      if (status.confidence >= 0.8) return { text: 'High confidence', tone: 'good' };
      if (status.confidence >= 0.5) return { text: 'Check edges', tone: 'check' };
      return { text: 'Needs review', tone: 'check' };
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
      const dot = el('span', `dot ${badge.tone}`, []);
      dot.title = badge.text;
      const meta = el('div', 'source-meta', [dot, source.detection.kind === 'pending' ? 'Detecting…' : `${count} crop${count === 1 ? '' : 's'}`]);
      const info = el('div', '', [el('div', 'source-name', [source.name]), meta]);
      const remove = iconOnlyButton(`Remove ${source.name}`, 'x', 'remove');
      remove.addEventListener('click', event => {
        event.stopPropagation();
        callbacks.remove(source.id);
      });
      const item = el('li', source.id === state.activeId ? 'source-item active' : 'source-item', [thumb, info, remove]);
      item.title = `${source.name} · ${source.size.width} × ${source.size.height}`;
      item.tabIndex = 0;
      item.setAttribute('aria-current', String(source.id === state.activeId));
      item.addEventListener('click', () => callbacks.activate(source.id));
      item.addEventListener('keydown', event => {
        if (event.target === item && (event.key === 'Enter' || event.key === ' ')) {
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
  canvas.width = 88;
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
      const up = iconOnlyButton('Move up', 'up', '');
      const down = iconOnlyButton('Move down', 'down', '');
      const copy = iconOnlyButton('Duplicate', 'copy', '');
      const remove = iconOnlyButton('Delete', 'trash', 'danger');
      up.disabled = i === 0;
      down.disabled = i === crops.length - 1;
      up.addEventListener('click', () => callbacks.move(crop.id, -1));
      down.addEventListener('click', () => callbacks.move(crop.id, 1));
      copy.addEventListener('click', () => callbacks.duplicate(crop.id));
      remove.addEventListener('click', () => callbacks.remove(crop.id));

      const row = el('li', crop.id === selectedId ? 'crop-row selected' : 'crop-row', [
        thumbnail(source, crop),
        el('div', '', [el('div', 'crop-title', [`${i + 1}. ${displayLabel(crop, i)}`]), el('div', 'crop-meta', [`${px.w} × ${px.h} px`])]),
        el('div', 'crop-actions', [up, down, copy, remove]),
      ]);
      row.addEventListener('click', event => {
        if (!(event.target instanceof Element && event.target.closest('button'))) callbacks.select(crop.id);
      });
      return row;
    }),
  );
  list.querySelector('.crop-row.selected')?.scrollIntoView({ block: 'nearest' });
}
