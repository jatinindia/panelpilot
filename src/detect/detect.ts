import type { DetectionResult, DetectOptions, PixelImage, Rect } from '../types';

/*
 * Recursive XY-cut panel detection.
 *
 * 1. Find "blank" lines: rows/columns whose pixels are (almost) all one color.
 *    Runs of blank lines are bands. Bands touching a rect edge are margins,
 *    interior bands are gutters. Colors of the bands seen across the full
 *    image form the background palette; deeper levels only accept gutters in
 *    those colors, so a solid stripe inside a photo is not mistaken for one.
 * 2. Cut each rect at its gutters (rows first, for reading order) and recurse.
 * 3. If no gutters exist at all, fall back to seams: positions where the mean
 *    color jumps consistently along the whole line (butt-joined photos).
 */

type Axis = 'x' | 'y';
type Rgb = readonly [number, number, number];

interface Params {
  readonly tolerance: number;
  readonly maxOutliers: number;
  readonly seamThreshold: number;
  readonly minPanelX: number;
  readonly minPanelY: number;
  readonly maxDepth: number;
}

interface Band {
  readonly start: number;
  readonly end: number;
  readonly color: Rgb;
  readonly outliers: number;
}

/** A boundary between two segments; start === end for a zero-width cut. */
interface Cut {
  readonly start: number;
  readonly end: number;
  readonly score: number;
}

interface CutOutcome {
  readonly panels: readonly Rect[];
  readonly scores: readonly number[];
}

const AXES_IN_READING_ORDER: readonly Axis[] = ['y', 'x'];
const SEAM_WINDOW = 3;
const SEAM_CHUNKS = 6;
const SEAM_AGREEMENT = 0.75;

export function detectPanels(image: PixelImage, options: DetectOptions): DetectionResult {
  const full: Rect = { x: 0, y: 0, w: image.width, h: image.height };
  const params = paramsFor(image, options.sensitivity);
  const palette = backgroundPalette(image, full, params);

  const byGutters = splitByGutters(image, full, 0, palette, params, options.trimMargins);
  if (byGutters.panels.length > 1) {
    return { panels: byGutters.panels, confidence: Math.min(...byGutters.scores), method: 'gutters' };
  }

  const seamRoot = byGutters.panels[0] ?? full;
  const bySeams = splitBySeams(image, seamRoot, 0, params);
  if (bySeams.panels.length > 1) {
    return { panels: bySeams.panels, confidence: Math.min(...bySeams.scores), method: 'seams' };
  }

  return { panels: [full], confidence: 0, method: 'none' };
}

/**
 * Colors that count as background. Outer margins define it when present;
 * otherwise (e.g. divider lines with no margin) every full-span band counts.
 */
function backgroundPalette(image: PixelImage, full: Rect, params: Params): Rgb[] {
  const bands = AXES_IN_READING_ORDER.flatMap(axis => {
    const [lo, hi] = axisRange(full, axis);
    return findBands(image, full, axis, params).map(b => ({ band: b, margin: b.start === lo || b.end === hi }));
  });
  const margins = bands.filter(b => b.margin);
  return (margins.length > 0 ? margins : bands).map(b => b.band.color);
}

function paramsFor(image: PixelImage, sensitivity: number): Params {
  const s = Math.min(1, Math.max(0, sensitivity));
  return {
    tolerance: 10 + 30 * s,
    maxOutliers: 0.01 + 0.03 * s,
    seamThreshold: 70 - 55 * s,
    minPanelX: Math.max(8, Math.round(image.width * 0.03)),
    minPanelY: Math.max(8, Math.round(image.height * 0.03)),
    maxDepth: 8,
  };
}

function splitByGutters(
  image: PixelImage,
  rect: Rect,
  depth: number,
  palette: readonly Rgb[],
  params: Params,
  trim: boolean,
): CutOutcome {
  const r = trim ? trimRect(image, rect, palette, params) : rect;
  if (r.w <= 0 || r.h <= 0) return { panels: [], scores: [] };
  if (depth >= params.maxDepth) return { panels: [r], scores: [] };

  for (const axis of AXES_IN_READING_ORDER) {
    const [lo, hi] = axisRange(r, axis);
    const gutters = findBands(image, r, axis, params)
      .filter(b => b.start > lo && b.end < hi && inPalette(b.color, palette, params.tolerance))
      .map(b => (trim ? gutterCut(b, params) : centredCut(b, params)));
    const cuts = selectCuts(gutters, lo, hi, minPanel(axis, params));
    if (cuts.length === 0) continue;
    const children = segments(r, axis, cuts).map(s => splitByGutters(image, s, depth + 1, palette, params, trim));
    return {
      panels: children.flatMap(c => c.panels),
      scores: [...cuts.map(c => c.score), ...children.flatMap(c => c.scores)],
    };
  }
  return { panels: [r], scores: [] };
}

function splitBySeams(image: PixelImage, rect: Rect, depth: number, params: Params): CutOutcome {
  if (depth >= params.maxDepth) return { panels: [rect], scores: [] };
  for (const axis of AXES_IN_READING_ORDER) {
    const [lo, hi] = axisRange(rect, axis);
    const cuts = selectCuts(findSeams(image, rect, axis, params), lo, hi, minPanel(axis, params));
    if (cuts.length === 0) continue;
    const children = segments(rect, axis, cuts).map(s => splitBySeams(image, s, depth + 1, params));
    return {
      panels: children.flatMap(c => c.panels),
      scores: [...cuts.map(c => c.score), ...children.flatMap(c => c.scores)],
    };
  }
  return { panels: [rect], scores: [] };
}

/** Cut that drops the whole gutter (panels exclude it). */
function gutterCut(band: Band, params: Params): Cut {
  return { start: band.start, end: band.end, score: gutterScore(band, params) };
}

/** Zero-width cut through the middle of the gutter (panels keep half each). */
function centredCut(band: Band, params: Params): Cut {
  const center = Math.floor((band.start + band.end) / 2);
  return { start: center, end: center, score: gutterScore(band, params) };
}

function gutterScore(band: Band, params: Params): number {
  return 1 - 0.5 * Math.min(1, band.outliers / params.maxOutliers);
}

/** Greedily keep cuts that leave at least `min` pixels on both sides. */
function selectCuts(candidates: readonly Cut[], lo: number, hi: number, min: number): Cut[] {
  const accepted: Cut[] = [];
  let previousEnd = lo;
  for (const cut of candidates) {
    if (cut.start - previousEnd >= min && hi - cut.end >= min) {
      accepted.push(cut);
      previousEnd = cut.end;
    }
  }
  return accepted;
}

function segments(rect: Rect, axis: Axis, cuts: readonly Cut[]): Rect[] {
  const [lo, hi] = axisRange(rect, axis);
  const bounds = [lo, ...cuts.flatMap(c => [c.start, c.end]), hi];
  const result: Rect[] = [];
  for (let i = 0; i < bounds.length; i += 2) {
    const from = bounds[i] ?? lo;
    const to = bounds[i + 1] ?? hi;
    result.push(axis === 'x' ? { x: from, y: rect.y, w: to - from, h: rect.h } : { x: rect.x, y: from, w: rect.w, h: to - from });
  }
  return result;
}

function trimRect(image: PixelImage, rect: Rect, palette: readonly Rgb[], params: Params): Rect {
  let r = rect;
  // Trimming one axis can expose new margins on the other, so repeat until stable.
  for (let pass = 0; pass < 4; pass++) {
    const before = r;
    for (const axis of AXES_IN_READING_ORDER) {
      if (r.w <= 0 || r.h <= 0) return r;
      const [lo, hi] = axisRange(r, axis);
      const leading = marginLength(image, r, axis, lo, 1, palette, params);
      const trailing = leading === hi - lo ? 0 : marginLength(image, r, axis, hi - 1, -1, palette, params);
      const from = lo + leading;
      const size = Math.max(0, hi - trailing - from);
      r = axis === 'x' ? { x: from, y: r.y, w: size, h: r.h } : { x: r.x, y: from, w: r.w, h: size };
    }
    if (r.x === before.x && r.y === before.y && r.w === before.w && r.h === before.h) break;
  }
  return r;
}

/** Number of background-colored blank lines starting at `first` and walking by `step` (+1 or -1). */
function marginLength(image: PixelImage, rect: Rect, axis: Axis, first: number, step: number, palette: readonly Rgb[], params: Params): number {
  const [lo, hi] = axisRange(rect, axis);
  const [spanLo, spanHi] = axisRange(rect, other(axis));
  let color: Rgb | null = null;
  let count = 0;
  for (let pos = first; pos >= lo && pos < hi; pos += step) {
    const line = analyseLine(image, axis, pos, spanLo, spanHi, params);
    if (!line.blank) break;
    if (color === null) {
      if (!inPalette(line.color, palette, params.tolerance)) break;
      color = line.color;
    } else if (colorDistance(line.color, color) > params.tolerance) {
      break;
    }
    count++;
  }
  return count;
}

/**
 * Bands of consecutive blank lines perpendicular to `axis` ('x' = columns).
 * A color change starts a new band, so a uniform panel edge never merges
 * into the gutter next to it.
 */
function findBands(image: PixelImage, rect: Rect, axis: Axis, params: Params): Band[] {
  const [lo, hi] = axisRange(rect, axis);
  const [spanLo, spanHi] = axisRange(rect, other(axis));
  const bands: Band[] = [];
  for (let pos = lo; pos < hi; pos++) {
    const line = analyseLine(image, axis, pos, spanLo, spanHi, params);
    if (!line.blank) continue;
    const last = bands[bands.length - 1];
    if (last && last.end === pos && colorDistance(line.color, last.color) <= params.tolerance) {
      bands[bands.length - 1] = { start: last.start, end: pos + 1, color: last.color, outliers: Math.max(last.outliers, line.outliers) };
    } else {
      bands.push({ start: pos, end: pos + 1, color: line.color, outliers: line.outliers });
    }
  }
  return bands;
}

/**
 * Whether a line is (almost) one color. `outliers` is the fraction of pixels
 * that differ from the line's median color; lines that are clearly not blank
 * stop early and report 1.
 */
function analyseLine(
  image: PixelImage,
  axis: Axis,
  pos: number,
  from: number,
  to: number,
  params: Params,
): { readonly blank: boolean; readonly color: Rgb; readonly outliers: number } {
  const span = to - from;
  if (span <= 0) return { blank: false, color: [0, 0, 0], outliers: 1 };
  const refCount = Math.min(span, 63);
  const rs = new Uint8Array(refCount);
  const gs = new Uint8Array(refCount);
  const bs = new Uint8Array(refCount);
  for (let k = 0; k < refCount; k++) {
    const i = pixelIndex(image, axis, pos, from + Math.floor(((k + 0.5) * span) / refCount));
    rs[k] = image.data[i] ?? 0;
    gs[k] = image.data[i + 1] ?? 0;
    bs[k] = image.data[i + 2] ?? 0;
  }
  const color: Rgb = [median(rs), median(gs), median(bs)];
  const step = Math.max(1, Math.floor(span / 512));
  const total = Math.ceil(span / step);
  const allowed = Math.floor(params.maxOutliers * total);
  let outliers = 0;
  for (let along = from; along < to; along += step) {
    const i = pixelIndex(image, axis, pos, along);
    const diff = Math.max(
      Math.abs((image.data[i] ?? 0) - color[0]),
      Math.abs((image.data[i + 1] ?? 0) - color[1]),
      Math.abs((image.data[i + 2] ?? 0) - color[2]),
    );
    if (diff > params.tolerance && ++outliers > allowed) return { blank: false, color, outliers: 1 };
  }
  return { blank: true, color, outliers: outliers / total };
}

/**
 * Seams between lines `pos - 1` and `pos`: the mean color of a few lines on
 * each side differs strongly in most chunks along the line.
 */
function findSeams(image: PixelImage, rect: Rect, axis: Axis, params: Params): Cut[] {
  const [lo, hi] = axisRange(rect, axis);
  const [spanLo, spanHi] = axisRange(rect, other(axis));
  const span = spanHi - spanLo;
  const chunks = Math.min(SEAM_CHUNKS, span);
  const lines = hi - lo;
  if (chunks <= 0 || lines < SEAM_WINDOW * 2) return [];

  // Per line, per chunk, per channel: mean value.
  const means = new Float64Array(lines * chunks * 3);
  for (let l = 0; l < lines; l++) {
    for (let c = 0; c < chunks; c++) {
      const cFrom = spanLo + Math.floor((c * span) / chunks);
      const cTo = spanLo + Math.floor(((c + 1) * span) / chunks);
      let r = 0;
      let g = 0;
      let b = 0;
      for (let along = cFrom; along < cTo; along++) {
        const i = pixelIndex(image, axis, lo + l, along);
        r += image.data[i] ?? 0;
        g += image.data[i + 1] ?? 0;
        b += image.data[i + 2] ?? 0;
      }
      const n = Math.max(1, cTo - cFrom);
      const o = (l * chunks + c) * 3;
      means[o] = r / n;
      means[o + 1] = g / n;
      means[o + 2] = b / n;
    }
  }

  const windowMean = (fromLine: number, chunk: number, channel: number): number => {
    let sum = 0;
    for (let l = fromLine; l < fromLine + SEAM_WINDOW; l++) sum += means[(l * chunks + chunk) * 3 + channel] ?? 0;
    return sum / SEAM_WINDOW;
  };

  const firing: { readonly pos: number; readonly jump: number }[] = [];
  for (let l = SEAM_WINDOW; l <= lines - SEAM_WINDOW; l++) {
    let agreeing = 0;
    let jumpSum = 0;
    for (let c = 0; c < chunks; c++) {
      let diff = 0;
      for (let ch = 0; ch < 3; ch++) diff = Math.max(diff, Math.abs(windowMean(l - SEAM_WINDOW, c, ch) - windowMean(l, c, ch)));
      if (diff > params.seamThreshold) agreeing++;
      jumpSum += diff;
    }
    if (agreeing / chunks >= SEAM_AGREEMENT) firing.push({ pos: lo + l, jump: jumpSum / chunks });
  }

  // Neighbouring positions fire together; keep the strongest of each run.
  const seams: Cut[] = [];
  let best: { readonly pos: number; readonly jump: number } | null = null;
  for (let i = 0; i < firing.length; i++) {
    const current = firing[i];
    if (!current) continue;
    if (best && current.pos - (firing[i - 1]?.pos ?? current.pos) > 1) {
      seams.push(seamCut(best.pos, best.jump, params));
      best = null;
    }
    if (!best || current.jump > best.jump) best = current;
  }
  if (best) seams.push(seamCut(best.pos, best.jump, params));
  return seams;
}

function seamCut(pos: number, jump: number, params: Params): Cut {
  const strength = Math.min(1, (jump - params.seamThreshold) / params.seamThreshold);
  return { start: pos, end: pos, score: 0.4 + 0.3 * strength };
}

function pixelIndex(image: PixelImage, axis: Axis, pos: number, along: number): number {
  return axis === 'x' ? (along * image.width + pos) * 4 : (pos * image.width + along) * 4;
}

function axisRange(rect: Rect, axis: Axis): readonly [number, number] {
  return axis === 'x' ? [rect.x, rect.x + rect.w] : [rect.y, rect.y + rect.h];
}

function other(axis: Axis): Axis {
  return axis === 'x' ? 'y' : 'x';
}

function minPanel(axis: Axis, params: Params): number {
  return axis === 'x' ? params.minPanelX : params.minPanelY;
}

function inPalette(color: Rgb, palette: readonly Rgb[], tolerance: number): boolean {
  if (palette.length === 0) return true;
  return palette.some(p => colorDistance(p, color) <= tolerance);
}

function colorDistance(a: Rgb, b: Rgb): number {
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
}

/** Median of a scratch buffer (sorted in place; callers own the buffer). */
function median(values: Uint8Array): number {
  values.sort();
  return values[Math.floor(values.length / 2)] ?? 0;
}
