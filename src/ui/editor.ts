import { displayLabel, updateCropRect } from '../crops';
import { clamp, hitTest, moveRect, rectFromPoints, resizeRect, toPixelRect, type Hit } from '../geometry';
import type { Crop, Handle, Point, Size, Source } from '../model';
import { rectFromPointsLocked, resizeRectLocked, snapEdges, snapMove } from '../precision';
import { activeCrops, activeSource, type AppState } from '../state';
import type { Rect } from '../types';
import { fitView, panBy, screenToImage, zoomAt, type View } from '../view';
import { isTyping } from './dom';

export type Tool = 'select' | 'draw';

export interface EditorOptions {
  readonly tool: Tool;
  readonly snap: boolean;
  /** Locked aspect ratio as pixel width / height, or null for free. */
  readonly ratio: number | null;
}

/** What the pointer is over, in source pixels, for the on-canvas readout. */
export interface Readout {
  readonly x: number;
  readonly y: number;
  /** The crop being drawn or edited, if any. */
  readonly rect: Rect | null;
}

export interface EditorCallbacks {
  readonly getState: () => AppState;
  readonly options: () => EditorOptions;
  readonly select: (cropId: string | null) => void;
  readonly commit: (sourceId: string, crops: readonly Crop[]) => void;
  readonly newId: () => string;
  readonly onViewChange: (scale: number | null) => void;
  readonly onReadout: (readout: Readout | null) => void;
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
      readonly pointer: Point;
    }
  | { readonly kind: 'draw'; readonly pointerId: number; readonly sourceId: string; readonly start: Point; readonly rect: Rect; readonly pointer: Point };

// Room for the floating toolbar and zoom bar around a fitted image.
const PADDING = 64;
const HANDLE_GRAB_PX = 9;
const HANDLE_SIZE_PX = 8;
const SNAP_PX = 6;
const MIN_DRAW_PX = 6;
const MIN_CROP_SOURCE_PX = 4;
const SCALE_LIMITS = { min: 0.02, max: 32 };
const LOUPE_PX = 148;

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
    // Small screens get proportionally less padding so the image stays large.
    const padding = Math.min(PADDING, Math.round(Math.min(viewport.width, viewport.height) * 0.08));
    const view = fitView(source.size, viewport, padding);
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

    const accent = cssColor('--accent');
    const view = viewFor(source);
    const iw = source.size.width * view.scale;
    const ih = source.size.height * view.scale;
    const toScreen = (r: Rect): Rect => ({ x: view.offsetX + r.x * iw, y: view.offsetY + r.y * ih, w: r.w * iw, h: r.h * ih });

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.shadowColor = 'rgba(0, 0, 0, 0.25)';
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 8;
    ctx.fillStyle = '#fff';
    ctx.fillRect(view.offsetX, view.offsetY, iw, ih);
    ctx.shadowColor = 'transparent';
    ctx.imageSmoothingEnabled = view.scale < 3;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source.bitmap, view.offsetX, view.offsetY, iw, ih);

    const crops = shownCrops(state);

    // Dim everything that will not be exported.
    maskCtx.setTransform(1, 0, 0, 1, 0, 0);
    maskCtx.clearRect(0, 0, mask.width, mask.height);
    maskCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    maskCtx.fillStyle = 'rgba(10, 10, 16, 0.55)';
    maskCtx.fillRect(view.offsetX, view.offsetY, iw, ih);
    crops.forEach(c => {
      const s = toScreen(c.rect);
      maskCtx.clearRect(s.x, s.y, s.w, s.h);
    });
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(mask, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    crops.forEach((crop, i) => drawCrop(toScreen(crop.rect), crop, i, crop.id === state.selectedId, accent));
    const selected = crops.find(c => c.id === state.selectedId);
    if (selected) drawHandles(toScreen(selected.rect), accent);
    if (drag?.kind === 'draw') {
      const s = toScreen(drag.rect);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.fillRect(s.x, s.y, s.w, s.h);
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2;
      ctx.strokeRect(s.x, s.y, s.w, s.h);
      ctx.setLineDash([]);
    }
    if (drag && drag.kind !== 'pan') drawLoupe(source, view, drag, accent);
  }

  function drawCrop(s: Rect, crop: Crop, index: number, selected: boolean, accent: string): void {
    // Dark under-stroke + light stroke keeps outlines visible on any image.
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.strokeRect(s.x, s.y, s.w, s.h);
    ctx.lineWidth = selected ? 2 : 1.25;
    ctx.strokeStyle = selected ? accent : 'rgba(255, 255, 255, 0.9)';
    ctx.strokeRect(s.x, s.y, s.w, s.h);

    ctx.font = '600 11.5px system-ui, -apple-system, sans-serif';
    ctx.textBaseline = 'middle';
    const full = `${index + 1}  ${displayLabel(crop, index)}`;
    const text = ctx.measureText(full).width + 16 <= s.w - 12 ? full : String(index + 1);
    const width = ctx.measureText(text).width + 14;
    if (width > s.w - 4 || 22 > s.h - 4) return;
    ctx.fillStyle = selected ? accent : 'rgba(20, 20, 26, 0.78)';
    ctx.beginPath();
    ctx.roundRect(s.x + 6, s.y + 6, width, 20, 10);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(text, s.x + 13, s.y + 16.5);
  }

  function drawHandles(s: Rect, accent: string): void {
    const xs = [s.x, s.x + s.w / 2, s.x + s.w];
    const ys = [s.y, s.y + s.h / 2, s.y + s.h];
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.5;
    ys.forEach((y, row) =>
      xs.forEach((x, col) => {
        if (row === 1 && col === 1) return;
        ctx.beginPath();
        ctx.roundRect(x - HANDLE_SIZE_PX / 2, y - HANDLE_SIZE_PX / 2, HANDLE_SIZE_PX, HANDLE_SIZE_PX, 2);
        ctx.fill();
        ctx.stroke();
      }),
    );
  }

  /** Magnified view around the point being placed, so edges can be set to the exact pixel. */
  function drawLoupe(source: Source, view: View, active: Exclude<Drag, { kind: 'pan' }>, accent: string): void {
    const focus = loupeFocus(active);
    const fx = focus.x * source.size.width;
    const fy = focus.y * source.size.height;
    const zoom = clamp(view.scale * 4, 8, 24);
    const span = LOUPE_PX / zoom;
    const screenFocus = { x: view.offsetX + fx * view.scale, y: view.offsetY + fy * view.scale };
    const left = screenFocus.x < LOUPE_PX + 40 && screenFocus.y < LOUPE_PX + 60 ? viewport.width - LOUPE_PX - 16 : 16;
    const top = 16;

    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
    ctx.shadowBlur = 18;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.roundRect(left, top, LOUPE_PX, LOUPE_PX, 12);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.clip();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(source.bitmap, fx - span / 2, fy - span / 2, span, span, left, top, LOUPE_PX, LOUPE_PX);
    // The crop's edges at loupe scale.
    const r = active.rect;
    const lx = (x: number): number => left + (x * source.size.width - (fx - span / 2)) * zoom;
    const ly = (y: number): number => top + (y * source.size.height - (fy - span / 2)) * zoom;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.strokeRect(lx(r.x), ly(r.y), (r.w * source.size.width) * zoom, (r.h * source.size.height) * zoom);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(left + LOUPE_PX / 2, top);
    ctx.lineTo(left + LOUPE_PX / 2, top + LOUPE_PX);
    ctx.moveTo(left, top + LOUPE_PX / 2);
    ctx.lineTo(left + LOUPE_PX, top + LOUPE_PX / 2);
    ctx.stroke();
    ctx.restore();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(left, top, LOUPE_PX, LOUPE_PX, 12);
    ctx.stroke();
    const px = toPixelRect(r, source.size.width, source.size.height);
    const label = `${Math.round(fx)}, ${Math.round(fy)}  ·  ${px.w} × ${px.h}`;
    ctx.font = '600 11px ui-monospace, Menlo, monospace';
    const width = ctx.measureText(label).width + 16;
    ctx.fillStyle = 'rgba(20, 20, 26, 0.85)';
    ctx.beginPath();
    ctx.roundRect(left + (LOUPE_PX - width) / 2, top + LOUPE_PX + 8, width, 22, 11);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, left + (LOUPE_PX - width) / 2 + 8, top + LOUPE_PX + 19.5);
  }

  function loupeFocus(active: Exclude<Drag, { kind: 'pan' }>): Point {
    if (active.kind === 'draw' || active.handle === 'move') return active.pointer;
    const r = active.rect;
    const h = active.handle;
    return {
      x: h.includes('w') ? r.x : h.includes('e') ? r.x + r.w : r.x + r.w / 2,
      y: h.includes('n') ? r.y : h.includes('s') ? r.y + r.h : r.y + r.h / 2,
    };
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

  /** Snap targets: image borders plus every other crop's edges. */
  function snapTargets(state: AppState, exceptId: string | null): { readonly xs: number[]; readonly ys: number[] } {
    const others = activeCrops(state).filter(c => c.id !== exceptId);
    return {
      xs: [0, 1, ...others.flatMap(c => [c.rect.x, c.rect.x + c.rect.w])],
      ys: [0, 1, ...others.flatMap(c => [c.rect.y, c.rect.y + c.rect.h])],
    };
  }

  function snapThreshold(source: Source): Point {
    const scale = viewFor(source).scale;
    return { x: SNAP_PX / scale / source.size.width, y: SNAP_PX / scale / source.size.height };
  }

  function snapPoint(p: Point, xs: readonly number[], ys: readonly number[], threshold: Point): Point {
    const nearest = (v: number, targets: readonly number[], t: number): number =>
      targets.reduce((best, target) => (Math.abs(target - v) < Math.abs(best - v) && Math.abs(target - v) <= t ? target : best), v);
    return { x: nearest(p.x, xs, threshold.x), y: nearest(p.y, ys, threshold.y) };
  }

  /** Locked ratio converted to 0..1 units of this image. */
  function normalizedRatio(source: Source): number | null {
    const ratio = callbacks.options().ratio;
    return ratio === null ? null : (ratio * source.size.height) / source.size.width;
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
    const hit = callbacks.options().tool === 'draw' || event.altKey ? null : hitAt(state, source, screen);
    canvas.style.cursor = hit ? CURSORS[hit.handle] : 'crosshair';
  }

  function reportPointer(source: Source, point: Point, rect: Rect | null): void {
    callbacks.onReadout({
      x: Math.round(clamp(point.x, 0, 1) * source.size.width),
      y: Math.round(clamp(point.y, 0, 1) * source.size.height),
      rect: rect ? toPixelRect(rect, source.size.width, source.size.height) : null,
    });
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

    // The draw tool (or Alt) always draws, so new crops can start on top of existing ones.
    const forceDraw = callbacks.options().tool === 'draw' || event.altKey;
    const hit = wantsPan || forceDraw ? null : hitAt(state, source, screen);
    if (hit) {
      const crop = activeCrops(state).find(c => c.id === hit.id);
      if (!crop) return;
      callbacks.select(hit.id);
      drag = { kind: 'edit', pointerId: event.pointerId, sourceId: source.id, id: hit.id, handle: hit.handle, start: point, original: crop.rect, rect: crop.rect, pointer: point };
    } else if (!wantsPan) {
      const { xs, ys } = snapTargets(state, null);
      const useSnap = callbacks.options().snap && !(event.metaKey || event.ctrlKey);
      const start = useSnap ? snapPoint(point, xs, ys, snapThreshold(source)) : point;
      drag = { kind: 'draw', pointerId: event.pointerId, sourceId: source.id, start, rect: rectFromPoints(start, start), pointer: start };
    } else {
      drag = { kind: 'pan', pointerId: event.pointerId, start: screen, origin: viewFor(source) };
    }
    updateCursor(event);
    render();
  });

  canvas.addEventListener('pointermove', event => {
    const state = callbacks.getState();
    const source = activeSource(state);
    if (!source) return;
    const screen = screenPoint(event);
    const point = imagePoint(source, screen);
    if (!drag || event.pointerId !== drag.pointerId) {
      updateCursor(event);
      reportPointer(source, point, null);
      return;
    }
    if (drag.kind === 'pan') {
      setView(source.id, panBy(drag.origin, screen.x - drag.start.x, screen.y - drag.start.y));
      return;
    }
    const options = callbacks.options();
    const useSnap = options.snap && !(event.metaKey || event.ctrlKey);
    const ratio = normalizedRatio(source);
    const threshold = snapThreshold(source);
    if (drag.kind === 'draw') {
      const { xs, ys } = snapTargets(state, null);
      const target = useSnap && ratio === null ? snapPoint(point, xs, ys, threshold) : point;
      const rect = ratio === null ? rectFromPoints(drag.start, target) : rectFromPointsLocked(drag.start, target, ratio);
      drag = { ...drag, rect, pointer: target };
    } else {
      const { xs, ys } = snapTargets(state, drag.id);
      const dx = point.x - drag.start.x;
      const dy = point.y - drag.start.y;
      const min = { w: MIN_CROP_SOURCE_PX / source.size.width, h: MIN_CROP_SOURCE_PX / source.size.height };
      let rect: Rect;
      if (drag.handle === 'move') {
        const moved = moveRect(drag.original, dx, dy);
        rect = useSnap ? snapMove(moved, xs, ys, threshold.x, threshold.y) : moved;
      } else if (ratio !== null) {
        rect = resizeRectLocked(drag.original, drag.handle, dx, dy, min, ratio);
      } else {
        const resized = resizeRect(drag.original, drag.handle, dx, dy, min);
        rect = useSnap ? snapEdges(resized, drag.handle, xs, ys, threshold.x, threshold.y) : resized;
      }
      drag = { ...drag, rect, pointer: point };
    }
    reportPointer(source, drag.pointer, drag.rect);
    render();
  });

  canvas.addEventListener('pointerleave', () => {
    if (!drag) callbacks.onReadout(null);
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
  // Measure now as well: the first observer callback only comes with the next rendered frame.
  resize();

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

function cssColor(name: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (!value) throw new Error(`CSS variable ${name} is not defined`);
  return value;
}

function requireContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D context is not available in this browser');
  return context;
}
