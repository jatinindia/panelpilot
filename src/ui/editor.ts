import { displayLabel, updateCropRect } from '../crops';
import { hitTest, moveRect, rectFromPoints, resizeRect, type Hit } from '../geometry';
import type { Crop, Handle, Point, Size, Source } from '../model';
import { activeCrops, activeSource, type AppState } from '../state';
import type { Rect } from '../types';
import { fitView, panBy, screenToImage, zoomAt, type View } from '../view';
import { isTyping } from './dom';

export interface EditorCallbacks {
  readonly getState: () => AppState;
  readonly select: (cropId: string | null) => void;
  readonly commit: (sourceId: string, crops: readonly Crop[]) => void;
  readonly newId: () => string;
  readonly onViewChange: (scale: number | null) => void;
}

export interface Editor {
  readonly render: () => void;
  readonly fit: () => void;
  readonly zoomBy: (factor: number) => void;
  readonly forget: (sourceId: string) => void;
  /** Current zoom (screen px per image px) of the active source. */
  readonly scale: () => number | null;
}

type Drag =
  | { readonly kind: 'pan'; readonly pointerId: number; readonly start: Point; readonly origin: View }
  | {
      readonly kind: 'edit';
      readonly pointerId: number;
      readonly sourceId: string;
      readonly id: string;
      readonly handle: Handle | 'move';
      readonly start: Point;
      readonly original: Rect;
      readonly rect: Rect;
    }
  | { readonly kind: 'draw'; readonly pointerId: number; readonly sourceId: string; readonly start: Point; readonly rect: Rect };

const PADDING = 24;
const HANDLE_GRAB_PX = 9;
const HANDLE_SIZE_PX = 8;
const MIN_DRAW_PX = 6;
const MIN_CROP_SOURCE_PX = 4;
const SCALE_LIMITS = { min: 0.02, max: 16 };
const ACCENT = '#2fa772';

const CURSORS: Readonly<Record<Handle | 'move', string>> = {
  n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize',
  ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize', move: 'move',
};

export function createEditor(canvas: HTMLCanvasElement, callbacks: EditorCallbacks): Editor {
  const ctx = requireContext(canvas);
  const mask = document.createElement('canvas');
  const maskCtx = requireContext(mask);
  const views = new Map<string, { readonly view: View; readonly fitted: boolean }>();
  let viewport: Size = { width: 0, height: 0 };
  let drag: Drag | null = null;
  let spaceHeld = false;
  let frame = 0;

  function viewFor(source: Source): View {
    const entry = views.get(source.id);
    if (entry && !entry.fitted) return entry.view;
    const view = fitView(source.size, viewport, PADDING);
    views.set(source.id, { view, fitted: true });
    return view;
  }

  function setView(sourceId: string, view: View): void {
    views.set(sourceId, { view, fitted: false });
    callbacks.onViewChange(view.scale);
    render();
  }

  function render(): void {
    if (frame === 0) frame = requestAnimationFrame(draw);
  }

  function resize(): void {
    const box = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    viewport = { width: box.width, height: box.height };
    canvas.width = mask.width = Math.max(1, Math.round(box.width * dpr));
    canvas.height = mask.height = Math.max(1, Math.round(box.height * dpr));
    const source = activeSource(callbacks.getState());
    callbacks.onViewChange(source ? viewFor(source).scale : null);
    render();
  }

  /** Crops as currently shown, including an in-progress drag that is not committed yet. */
  function shownCrops(state: AppState): readonly Crop[] {
    const crops = activeCrops(state);
    return drag?.kind === 'edit' ? updateCropRect(crops, drag.id, drag.rect) : crops;
  }

  function draw(): void {
    frame = 0;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const state = callbacks.getState();
    const source = activeSource(state);
    if (!source) return;

    const view = viewFor(source);
    const iw = source.size.width * view.scale;
    const ih = source.size.height * view.scale;
    const toScreen = (r: Rect): Rect => ({ x: view.offsetX + r.x * iw, y: view.offsetY + r.y * ih, w: r.w * iw, h: r.h * ih });

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = view.scale < 3;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source.bitmap, view.offsetX, view.offsetY, iw, ih);

    const crops = shownCrops(state);

    // Dim everything that will not be exported.
    maskCtx.setTransform(1, 0, 0, 1, 0, 0);
    maskCtx.clearRect(0, 0, mask.width, mask.height);
    maskCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    maskCtx.fillStyle = 'rgba(18, 26, 22, 0.5)';
    maskCtx.fillRect(view.offsetX, view.offsetY, iw, ih);
    crops.forEach(c => {
      const s = toScreen(c.rect);
      maskCtx.clearRect(s.x, s.y, s.w, s.h);
    });
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(mask, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    crops.forEach((crop, i) => drawCrop(toScreen(crop.rect), crop, i, crop.id === state.selectedId));
    const selected = crops.find(c => c.id === state.selectedId);
    if (selected) drawHandles(toScreen(selected.rect));
    if (drag?.kind === 'draw') {
      const s = toScreen(drag.rect);
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 2;
      ctx.strokeRect(s.x, s.y, s.w, s.h);
      ctx.setLineDash([]);
    }
  }

  function drawCrop(s: Rect, crop: Crop, index: number, selected: boolean): void {
    // Dark under-stroke + light stroke keeps outlines visible on any image.
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(18, 26, 22, 0.55)';
    ctx.strokeRect(s.x, s.y, s.w, s.h);
    ctx.lineWidth = selected ? 2 : 1.5;
    ctx.strokeStyle = selected ? ACCENT : 'rgba(255, 255, 255, 0.95)';
    ctx.strokeRect(s.x, s.y, s.w, s.h);

    ctx.font = '600 12px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    const full = `${index + 1}  ${displayLabel(crop, index)}`;
    const text = ctx.measureText(full).width + 16 <= s.w - 12 ? full : String(index + 1);
    const width = ctx.measureText(text).width + 14;
    if (width > s.w - 4 || 22 > s.h - 4) return;
    ctx.fillStyle = selected ? ACCENT : 'rgba(31, 36, 34, 0.85)';
    ctx.beginPath();
    ctx.roundRect(s.x + 6, s.y + 6, width, 22, 6);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(text, s.x + 13, s.y + 17);
  }

  function drawHandles(s: Rect): void {
    const xs = [s.x, s.x + s.w / 2, s.x + s.w];
    const ys = [s.y, s.y + s.h / 2, s.y + s.h];
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 1.5;
    ys.forEach((y, row) =>
      xs.forEach((x, col) => {
        if (row === 1 && col === 1) return;
        ctx.fillRect(x - HANDLE_SIZE_PX / 2, y - HANDLE_SIZE_PX / 2, HANDLE_SIZE_PX, HANDLE_SIZE_PX);
        ctx.strokeRect(x - HANDLE_SIZE_PX / 2, y - HANDLE_SIZE_PX / 2, HANDLE_SIZE_PX, HANDLE_SIZE_PX);
      }),
    );
  }

  function screenPoint(event: PointerEvent | WheelEvent): Point {
    const box = canvas.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  }

  /** Pointer position in 0..1 image fractions (may fall outside 0..1). */
  function imagePoint(source: Source, screen: Point): Point {
    const p = screenToImage(viewFor(source), screen);
    return { x: p.x / source.size.width, y: p.y / source.size.height };
  }

  function hitAt(state: AppState, source: Source, screen: Point): Hit | null {
    const scale = viewFor(source).scale;
    const radius = { x: HANDLE_GRAB_PX / scale / source.size.width, y: HANDLE_GRAB_PX / scale / source.size.height };
    return hitTest(activeCrops(state), imagePoint(source, screen), radius, state.selectedId);
  }

  function updateCursor(event: PointerEvent): void {
    const state = callbacks.getState();
    const source = activeSource(state);
    if (!source) {
      canvas.style.cursor = 'default';
      return;
    }
    if (drag?.kind === 'pan') {
      canvas.style.cursor = 'grabbing';
      return;
    }
    if (spaceHeld) {
      canvas.style.cursor = 'grab';
      return;
    }
    const screen = screenPoint(event);
    const hit = hitAt(state, source, screen);
    canvas.style.cursor = hit ? CURSORS[hit.handle] : 'crosshair';
  }

  canvas.addEventListener('pointerdown', event => {
    const state = callbacks.getState();
    const source = activeSource(state);
    if (!source || drag) return;
    const screen = screenPoint(event);
    const point = imagePoint(source, screen);
    const wantsPan = event.button === 1 || (event.button === 0 && spaceHeld);
    if (event.button !== 0 && !wantsPan) return;
    canvas.setPointerCapture(event.pointerId);

    // Alt/Option forces drawing, so new crops can start on top of existing ones.
    const hit = wantsPan || event.altKey ? null : hitAt(state, source, screen);
    if (hit) {
      const crop = activeCrops(state).find(c => c.id === hit.id);
      if (!crop) return;
      callbacks.select(hit.id);
      drag = { kind: 'edit', pointerId: event.pointerId, sourceId: source.id, id: hit.id, handle: hit.handle, start: point, original: crop.rect, rect: crop.rect };
    } else if (!wantsPan) {
      drag = { kind: 'draw', pointerId: event.pointerId, sourceId: source.id, start: point, rect: rectFromPoints(point, point) };
    } else {
      drag = { kind: 'pan', pointerId: event.pointerId, start: screen, origin: viewFor(source) };
    }
    updateCursor(event);
  });

  canvas.addEventListener('pointermove', event => {
    const source = activeSource(callbacks.getState());
    if (!drag || !source || event.pointerId !== drag.pointerId) {
      updateCursor(event);
      return;
    }
    const screen = screenPoint(event);
    if (drag.kind === 'pan') {
      setView(source.id, panBy(drag.origin, screen.x - drag.start.x, screen.y - drag.start.y));
      return;
    }
    const point = imagePoint(source, screen);
    if (drag.kind === 'draw') {
      drag = { ...drag, rect: rectFromPoints(drag.start, point) };
    } else {
      const dx = point.x - drag.start.x;
      const dy = point.y - drag.start.y;
      const min = { w: MIN_CROP_SOURCE_PX / source.size.width, h: MIN_CROP_SOURCE_PX / source.size.height };
      const rect = drag.handle === 'move' ? moveRect(drag.original, dx, dy) : resizeRect(drag.original, drag.handle, dx, dy, min);
      drag = { ...drag, rect };
    }
    render();
  });

  function finishDrag(event: PointerEvent): void {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const finished = drag;
    drag = null;
    const state = callbacks.getState();
    const source = finished.kind === 'pan' ? null : state.sources.find(s => s.id === finished.sourceId);
    if (source && finished.kind === 'edit' && finished.rect !== finished.original) {
      callbacks.commit(source.id, updateCropRect(activeCrops(state), finished.id, finished.rect));
    }
    if (source && finished.kind === 'draw') {
      const scale = viewFor(source).scale;
      const big = finished.rect.w * source.size.width * scale >= MIN_DRAW_PX && finished.rect.h * source.size.height * scale >= MIN_DRAW_PX;
      if (big) {
        const crop: Crop = { id: callbacks.newId(), rect: finished.rect, label: null };
        callbacks.commit(source.id, [...activeCrops(state), crop]);
        callbacks.select(crop.id);
      } else {
        callbacks.select(null);
      }
    }
    render();
    updateCursor(event);
  }

  function cancelDrag(event: PointerEvent): void {
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag = null;
    render();
    updateCursor(event);
  }

  canvas.addEventListener('pointerup', finishDrag);
  canvas.addEventListener('pointercancel', cancelDrag);

  canvas.addEventListener(
    'wheel',
    event => {
      const source = activeSource(callbacks.getState());
      if (!source) return;
      event.preventDefault();
      const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : 1;
      const view = viewFor(source);
      if (event.ctrlKey || event.metaKey) {
        // Cap the step so a mouse-wheel notch (~100) zooms ~35%, while small pinch deltas stay smooth.
        const delta = Math.max(-30, Math.min(30, event.deltaY * unit));
        setView(source.id, zoomAt(view, Math.exp(-delta * 0.01), screenPoint(event), SCALE_LIMITS));
      } else {
        setView(source.id, panBy(view, -event.deltaX * unit, -event.deltaY * unit));
      }
    },
    { passive: false },
  );

  window.addEventListener('keydown', event => {
    if (event.code === 'Space' && !isTyping(event) && !(event.target instanceof HTMLButtonElement)) {
      spaceHeld = true;
      if (activeSource(callbacks.getState())) event.preventDefault();
      canvas.style.cursor = 'grab';
    }
  });
  window.addEventListener('keyup', event => {
    if (event.code === 'Space') {
      spaceHeld = false;
      canvas.style.cursor = 'default';
    }
  });

  new ResizeObserver(resize).observe(canvas);

  return {
    render,
    fit() {
      const source = activeSource(callbacks.getState());
      if (!source) return;
      views.delete(source.id);
      callbacks.onViewChange(viewFor(source).scale);
      render();
    },
    zoomBy(factor) {
      const source = activeSource(callbacks.getState());
      if (!source) return;
      setView(source.id, zoomAt(viewFor(source), factor, { x: viewport.width / 2, y: viewport.height / 2 }, SCALE_LIMITS));
    },
    forget(sourceId) {
      views.delete(sourceId);
    },
    scale() {
      const source = activeSource(callbacks.getState());
      return source && viewport.width > 0 ? viewFor(source).scale : null;
    },
  };
}

function requireContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D context is not available in this browser');
  return context;
}
