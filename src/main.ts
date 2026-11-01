import './styles.css';
import { createAutosave, type SaveStatus } from './autosave';
import { cropsFromPanels, displayLabel, duplicateCrop, moveCropInList, removeCrop, renameCrop, updateCropRect } from './crops';
import { detectInWorker } from './detect/client';
import { clamp, moveRect, toPixelRect } from './geometry';
import { canRedo, canUndo } from './history';
import { analysisPixels, bitmapSize, decodeImage } from './load';
import type { Crop, DetectionStatus, Source } from './model';
import { applyFields, fitRatio, splitRect, type Field } from './precision';
import { sampleCollage } from './sample';
import { parseSnapshot, restoreState, type RestoredImage } from './snapshot';
import {
  activeCrops,
  activeSource,
  addSource,
  applyLayoutToAll,
  commitCrops,
  initialState,
  redoActive,
  removeSource,
  selectCrop,
  setActive,
  setDetected,
  setDetectionStatus,
  setSettings,
  undoActive,
  type AppState,
} from './state';
import { clearWorkspace, deleteImage, loadImage, loadWorkspace, saveImage } from './storage';
import { trimmedRect } from './trimCrop';
import type { Rect } from './types';
import { byId, errorMessage, isTyping, toast } from './ui/dom';
import { createEditor, type Readout, type Tool } from './ui/editor';
import { setupExportDialog } from './ui/exportDialog';
import { renderCropList, renderSourceList, statusBadge } from './ui/panels';
import { setupTemplates } from './ui/templates';

const ui = {
  fileInput: byId('fileInput', HTMLInputElement),
  dropZone: byId('dropZone', HTMLLabelElement),
  dropOverlay: byId('dropOverlay', HTMLDivElement),
  emptySample: byId('emptySample', HTMLButtonElement),
  emptyUpload: byId('emptyUpload', HTMLButtonElement),
  resetButton: byId('resetButton', HTMLButtonElement),
  sourceList: byId('sourceList', HTMLUListElement),
  sourceCount: byId('sourceCount', HTMLSpanElement),
  title: byId('title', HTMLSpanElement),
  docMeta: byId('docMeta', HTMLSpanElement),
  confidencePill: byId('confidencePill', HTMLSpanElement),
  saveStatus: byId('saveStatus', HTMLSpanElement),
  undoButton: byId('undoButton', HTMLButtonElement),
  redoButton: byId('redoButton', HTMLButtonElement),
  themeButton: byId('themeButton', HTMLButtonElement),
  exportButton: byId('exportButton', HTMLButtonElement),
  canvas: byId('editorCanvas', HTMLCanvasElement),
  emptyState: byId('emptyState', HTMLDivElement),
  toolbar: byId('toolbar', HTMLDivElement),
  zoombar: byId('zoombar', HTMLDivElement),
  readout: byId('readout', HTMLDivElement),
  busyOverlay: byId('busyOverlay', HTMLDivElement),
  snapButton: byId('snapButton', HTMLButtonElement),
  addCropButton: byId('addCropButton', HTMLButtonElement),
  zoomIn: byId('zoomIn', HTMLButtonElement),
  zoomOut: byId('zoomOut', HTMLButtonElement),
  zoomFit: byId('zoomFit', HTMLButtonElement),
  zoomLabel: byId('zoomLabel', HTMLSpanElement),
  selectionIndex: byId('selectionIndex', HTMLSpanElement),
  selectionEmpty: byId('selectionEmpty', HTMLParagraphElement),
  selectionBody: byId('selectionBody', HTMLDivElement),
  cropName: byId('cropName', HTMLInputElement),
  cropX: byId('cropX', HTMLInputElement),
  cropY: byId('cropY', HTMLInputElement),
  cropW: byId('cropW', HTMLInputElement),
  cropH: byId('cropH', HTMLInputElement),
  aspectSelect: byId('aspectSelect', HTMLSelectElement),
  duplicateButton: byId('duplicateButton', HTMLButtonElement),
  trimSelectedButton: byId('trimSelectedButton', HTMLButtonElement),
  deleteButton: byId('deleteButton', HTMLButtonElement),
  splitRows: byId('splitRows', HTMLInputElement),
  splitCols: byId('splitCols', HTMLInputElement),
  splitButton: byId('splitButton', HTMLButtonElement),
  cropList: byId('cropList', HTMLUListElement),
  cropCount: byId('cropCount', HTMLSpanElement),
  cropsEmpty: byId('cropsEmpty', HTMLParagraphElement),
  trimMargin: byId('trimMargin', HTMLInputElement),
  trimAllButton: byId('trimAllButton', HTMLButtonElement),
  sensitivity: byId('sensitivity', HTMLInputElement),
  sensitivityValue: byId('sensitivityValue', HTMLOutputElement),
  trimMargins: byId('trimMargins', HTMLInputElement),
  redetectButton: byId('redetectButton', HTMLButtonElement),
  applyAllButton: byId('applyAllButton', HTMLButtonElement),
  exportDialog: byId('exportDialog', HTMLDialogElement),
};

/** Max channel difference from the crop's border color that still counts as background when trimming. */
const TRIM_TOLERANCE = 24;
const THEME_KEY = 'panelpilot-theme';

let state: AppState = initialState({ sensitivity: Number(ui.sensitivity.value) / 100, trimMargins: ui.trimMargins.checked });
let tool: Tool = 'select';
let snap = true;
const newId = (): string => crypto.randomUUID();

const autosave = createAutosave(400, renderSaveStatus);

const templates = setupTemplates({
  currentCrops: () => (state.activeId === null ? null : activeCrops(state)),
  apply: crops => update(s => (s.activeId === null ? s : selectCrop(commitCrops(s, s.activeId, crops), null))),
  newId,
});

function update(fn: (s: AppState) => AppState): void {
  const next = fn(state);
  if (next === state) return;
  const previous = state;
  state = next;
  render(previous);
  if (previous.sources !== next.sources || previous.crops !== next.crops || previous.activeId !== next.activeId || previous.settings !== next.settings) {
    autosave.schedule(next);
  }
}

const editor = createEditor(ui.canvas, {
  getState: () => state,
  options: () => ({ tool, snap, ratio: aspectRatio() }),
  select: id => update(s => selectCrop(s, id)),
  commit: (sourceId, crops) => update(s => commitCrops(s, sourceId, crops)),
  newId,
  onViewChange: scale => {
    ui.zoomLabel.textContent = formatScale(scale);
  },
  onReadout: renderReadout,
});

const exportDialog = setupExportDialog(() => state);

// ---------- Rendering ----------

function render(previous: AppState | null): void {
  const source = activeSource(state);
  const crops = activeCrops(state);
  const history = source ? state.crops.get(source.id) : undefined;

  if (!previous || previous.sources !== state.sources || previous.crops !== state.crops || previous.activeId !== state.activeId) {
    renderSourceList(ui.sourceList, state, {
      activate: id => update(s => setActive(s, id)),
      remove: id => removeSourceById(id),
    });
  }
  const cropsChanged = !previous || activeCrops(previous) !== crops || previous.selectedId !== state.selectedId || previous.activeId !== state.activeId;
  if (source && cropsChanged) {
    renderCropList(ui.cropList, source, crops, state.selectedId, {
      select: id => update(s => selectCrop(s, id)),
      move: (id, delta) => editActive(list => moveCropInList(list, id, delta)),
      duplicate: id => duplicateSelected(id),
      remove: id => editActive(list => removeCrop(list, id)),
    });
  }
  if (!source) ui.cropList.replaceChildren();
  if (cropsChanged) renderSelection(source, crops);

  ui.sourceCount.textContent = String(state.sources.length);
  ui.cropCount.textContent = String(crops.length);
  ui.cropsEmpty.hidden = crops.length > 0;
  ui.cropsEmpty.textContent = source ? 'No crops yet. Press N or use the draw tool (R).' : 'Crops appear here.';

  ui.title.textContent = source ? source.name : 'No image';
  ui.docMeta.textContent = source ? `${source.size.width} × ${source.size.height}` : '';
  ui.emptyState.hidden = source !== null;
  [ui.toolbar, ui.zoombar].forEach(node => (node.hidden = source === null));
  if (!source) ui.readout.hidden = true;
  ui.busyOverlay.hidden = source?.detection.kind !== 'pending';
  renderConfidence(source?.detection ?? null);

  const ready = source !== null && source.detection.kind !== 'pending';
  ui.resetButton.disabled = state.sources.length === 0;
  ui.undoButton.disabled = !history || !canUndo(history);
  ui.redoButton.disabled = !history || !canRedo(history);
  ui.exportButton.disabled = !state.sources.some(s => (state.crops.get(s.id)?.present.length ?? 0) > 0);
  ui.addCropButton.disabled = !ready;
  ui.redetectButton.disabled = !ready;
  ui.applyAllButton.disabled = !ready || state.sources.length < 2 || crops.length === 0;
  ui.trimAllButton.disabled = !ready || crops.length === 0;
  ui.sensitivityValue.value = String(Math.round(state.settings.sensitivity * 100));
  ui.sensitivity.value = ui.sensitivityValue.value;
  ui.trimMargins.checked = state.settings.trimMargins;
  if (previous?.activeId !== state.activeId) ui.zoomLabel.textContent = formatScale(editor.scale());
  templates.refresh();

  editor.render();
}

function selectedCrop(): Crop | null {
  return activeCrops(state).find(c => c.id === state.selectedId) ?? null;
}

function renderSelection(source: Source | null, crops: readonly Crop[]): void {
  const crop = selectedCrop();
  const index = crop ? crops.indexOf(crop) : -1;
  ui.selectionEmpty.hidden = crop !== null;
  ui.selectionBody.hidden = crop === null;
  ui.selectionIndex.textContent = crop ? `${index + 1} of ${crops.length}` : '';
  if (!crop || !source) return;
  const px = toPixelRect(crop.rect, source.size.width, source.size.height);
  // Don't overwrite a field the user is typing in.
  const set = (input: HTMLInputElement, value: string): void => {
    if (document.activeElement !== input) input.value = value;
  };
  set(ui.cropName, crop.label ?? '');
  ui.cropName.placeholder = displayLabel({ ...crop, label: null }, index);
  set(ui.cropX, String(px.x));
  set(ui.cropY, String(px.y));
  set(ui.cropW, String(px.w));
  set(ui.cropH, String(px.h));
}

function renderReadout(readout: Readout | null): void {
  ui.readout.hidden = readout === null;
  if (!readout) return;
  ui.readout.textContent = readout.rect
    ? `${readout.rect.x}, ${readout.rect.y}  ·  ${readout.rect.w} × ${readout.rect.h} px`
    : `${readout.x}, ${readout.y} px`;
}

function renderSaveStatus(status: SaveStatus): void {
  ui.saveStatus.hidden = status.kind === 'idle';
  ui.saveStatus.className = status.kind === 'failed' ? 'save-status failed' : 'save-status';
  ui.saveStatus.textContent = status.kind === 'pending' ? 'Saving…' : status.kind === 'saved' ? 'Saved on this device' : 'Not saved';
  ui.saveStatus.title = status.kind === 'failed' ? status.message : '';
}

function reportStorageError(error: unknown): void {
  const message = errorMessage(error);
  renderSaveStatus({ kind: 'failed', message });
  toast(`${message}. Your work is not being saved.`, 'error');
}

function formatScale(scale: number | null): string {
  return scale === null ? '–' : `${Math.round(scale * 100)}%`;
}

function renderConfidence(status: DetectionStatus | null): void {
  ui.confidencePill.hidden = status === null;
  if (!status) return;
  const badge = statusBadge(status);
  ui.confidencePill.className = `chip ${badge.tone}`;
  ui.confidencePill.textContent = badge.text;
  ui.confidencePill.title = status.kind === 'failed' ? status.message : '';
}

// ---------- Tools, theme, tabs ----------

function setTool(next: Tool): void {
  tool = next;
  ui.toolbar.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.tool === next)));
}

/** Locked aspect ratio (pixel width / height), or null when free. */
function aspectRatio(): number | null {
  const [w, h] = ui.aspectSelect.value.split(':').map(Number);
  return w && h ? w / h : null;
}

function effectiveTheme(): 'light' | 'dark' {
  const forced = document.documentElement.dataset.theme;
  if (forced === 'light' || forced === 'dark') return forced;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme: 'light' | 'dark'): void {
  document.documentElement.dataset.theme = theme;
  ui.themeButton.querySelector('use')?.setAttribute('href', theme === 'dark' ? '#i-sun' : '#i-moon');
  editor.render();
}

function loadThemePreference(): void {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark') applyTheme(saved);
    else ui.themeButton.querySelector('use')?.setAttribute('href', effectiveTheme() === 'dark' ? '#i-sun' : '#i-moon');
  } catch (error) {
    toast(`Could not read your theme preference: ${errorMessage(error)}`, 'error');
  }
}

function selectTab(name: string): void {
  document.querySelectorAll<HTMLButtonElement>('.tabs [role="tab"]').forEach(tab => {
    const selected = tab.id === `tab-${name}`;
    tab.setAttribute('aria-selected', String(selected));
    const pane = document.getElementById(tab.getAttribute('aria-controls') ?? '');
    if (pane) pane.hidden = !selected;
  });
}

// ---------- Editing helpers ----------

function editActive(fn: (crops: readonly Crop[]) => readonly Crop[]): void {
  update(s => (s.activeId === null ? s : commitCrops(s, s.activeId, fn(activeCrops(s)))));
}

function editSelectedRect(fn: (rect: Rect, source: Source) => Rect): void {
  const source = activeSource(state);
  const crop = selectedCrop();
  if (!source || !crop) return;
  const rect = fn(crop.rect, source);
  editActive(list => updateCropRect(list, crop.id, rect));
}

function duplicateSelected(id: string): void {
  const copyId = newId();
  update(s => (s.activeId === null ? s : selectCrop(commitCrops(s, s.activeId, duplicateCrop(activeCrops(s), id, copyId)), copyId)));
}

function addCentredCrop(): void {
  const source = activeSource(state);
  if (!source) return;
  const ratio = aspectRatio();
  const base = { x: 0.3, y: 0.3, w: 0.4, h: 0.4 };
  const rect = ratio === null ? base : fitRatio(base, (ratio * source.size.height) / source.size.width);
  const crop: Crop = { id: newId(), rect, label: null };
  update(s => (s.activeId === null ? s : selectCrop(commitCrops(s, s.activeId, [...activeCrops(s), crop]), crop.id)));
}

/** Apply the edited X/Y/W/H field (source pixels) to the selected crop. */
function applyNumericField(changed: Field): void {
  editSelectedRect((rect, source) => {
    const { width: W, height: H } = source.size;
    const current = toPixelRect(rect, W, H);
    const read = (input: HTMLInputElement): number => Number(input.value);
    const fields = { x: read(ui.cropX), y: read(ui.cropY), w: read(ui.cropW), h: read(ui.cropH) };
    const next = applyFields(current, fields, changed, aspectRatio(), source.size);
    return { x: next.x / W, y: next.y / H, w: next.w / W, h: next.h / H };
  });
  // The crop may not change (e.g. clamped to the same place); show the real values again.
  renderSelection(activeSource(state), activeCrops(state));
}

function nudgeSelected(dxPx: number, dyPx: number): void {
  editSelectedRect((rect, source) => moveRect(rect, dxPx / source.size.width, dyPx / source.size.height));
}

/** Resize from the top-left corner by whole pixels, honouring the aspect lock. */
function growSelected(dwPx: number, dhPx: number): void {
  editSelectedRect((rect, source) => {
    const { width: W, height: H } = source.size;
    const current = toPixelRect(rect, W, H);
    const changed: Field = dwPx !== 0 ? 'w' : 'h';
    const next = applyFields(current, { ...current, w: current.w + dwPx, h: current.h + dhPx }, changed, aspectRatio(), source.size);
    return { x: next.x / W, y: next.y / H, w: next.w / W, h: next.h / H };
  });
}

function splitSelected(): void {
  const crop = selectedCrop();
  if (!crop) return;
  const rows = clamp(Math.round(Number(ui.splitRows.value)) || 1, 1, 20);
  const cols = clamp(Math.round(Number(ui.splitCols.value)) || 1, 1, 20);
  if (rows * cols < 2) return;
  const parts: Crop[] = splitRect(crop.rect, rows, cols).map(rect => ({ id: newId(), rect, label: null }));
  update(s => {
    if (s.activeId === null) return s;
    const list = activeCrops(s);
    const at = list.findIndex(c => c.id === crop.id);
    return selectCrop(commitCrops(s, s.activeId, [...list.slice(0, at), ...parts, ...list.slice(at + 1)]), parts[0]?.id ?? null);
  });
  toast(`Split into ${parts.length} crops.`, 'info');
}

function cycleSelection(delta: number): void {
  const crops = activeCrops(state);
  if (crops.length === 0) return;
  const at = crops.findIndex(c => c.id === state.selectedId);
  const next = crops[(at + delta + crops.length) % crops.length] ?? crops[0];
  if (next) update(s => selectCrop(s, next.id));
}

function trimCrops(ids: ReadonlySet<string>): void {
  const source = activeSource(state);
  if (!source) return;
  const margin = Math.max(0, Number(ui.trimMargin.value) || 0);
  let trimmed = 0;
  let empty = 0;
  try {
    const next = activeCrops(state).map(crop => {
      if (!ids.has(crop.id)) return crop;
      const rect = trimmedRect(source, crop, margin, TRIM_TOLERANCE);
      if (!rect) {
        empty++;
        return crop;
      }
      trimmed++;
      return { ...crop, rect };
    });
    if (trimmed > 0) update(s => commitCrops(s, source.id, next));
  } catch (error) {
    toast(`Trim failed: ${errorMessage(error)}`, 'error');
    return;
  }
  const skipped = empty > 0 ? ` ${empty} crop${empty === 1 ? ' is' : 's are'} only background and ${empty === 1 ? 'was' : 'were'} left as is.` : '';
  toast(`Trimmed ${trimmed} crop${trimmed === 1 ? '' : 's'}.${skipped}`, 'info');
}

// ---------- Sources and detection ----------

async function detectCrops(source: Source): Promise<{ readonly crops: readonly Crop[]; readonly status: DetectionStatus }> {
  const pixels = analysisPixels(source.bitmap);
  const result = await detectInWorker(pixels, state.settings);
  return {
    crops: cropsFromPanels(result.panels, { width: pixels.width, height: pixels.height }, newId),
    status: { kind: 'done', confidence: result.confidence, method: result.method },
  };
}

async function detectNew(source: Source): Promise<void> {
  try {
    const { crops, status } = await detectCrops(source);
    update(s => setDetected(s, source.id, crops, status));
  } catch (error) {
    const message = errorMessage(error);
    update(s => setDetected(s, source.id, [{ id: newId(), rect: { x: 0, y: 0, w: 1, h: 1 }, label: null }], { kind: 'failed', message }));
    toast(`Detection failed for ${source.name}: ${message}`, 'error');
  }
}

async function redetectActive(): Promise<void> {
  const source = activeSource(state);
  if (!source) return;
  const previous = source.detection;
  update(s => setDetectionStatus(s, source.id, { kind: 'pending' }));
  try {
    const { crops, status } = await detectCrops(source);
    update(s => setDetectionStatus(selectCrop(commitCrops(s, source.id, crops), null), source.id, status));
    toast(`Found ${crops.length} crop${crops.length === 1 ? '' : 's'}. Undo restores the previous crops.`, 'info');
  } catch (error) {
    update(s => setDetectionStatus(s, source.id, previous));
    toast(`Re-detect failed for ${source.name}: ${errorMessage(error)}`, 'error');
  }
}

async function addFiles(files: readonly File[]): Promise<void> {
  const images = files.filter(f => f.type.startsWith('image/'));
  const skipped = files.filter(f => !f.type.startsWith('image/'));
  if (skipped.length > 0) toast(`Skipped ${skipped.length} non-image file${skipped.length === 1 ? '' : 's'}: ${skipped.map(f => f.name).join(', ')}`, 'error');
  for (const file of images) {
    try {
      const bitmap = await decodeImage(file, file.name);
      const source: Source = {
        id: newId(),
        name: file.name || 'Pasted image.png',
        size: bitmapSize(bitmap),
        bitmap,
        thumbUrl: URL.createObjectURL(file),
        blob: file,
        detection: { kind: 'pending' },
      };
      // Store the image before the snapshot that references it can be written.
      await saveImage(source.id, file).catch(reportStorageError);
      update(s => addSource(s, source));
      void detectNew(source);
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  }
}

function releaseSource(source: Source): void {
  URL.revokeObjectURL(source.thumbUrl);
  source.bitmap.close();
  editor.forget(source.id);
}

function removeSourceById(id: string): void {
  const source = state.sources.find(s => s.id === id);
  if (!source) return;
  update(s => removeSource(s, id));
  releaseSource(source);
  deleteImage(id).catch(reportStorageError);
}

function resetWorkspace(): void {
  if (state.sources.length === 0) return;
  if (!window.confirm(`Remove all ${state.sources.length} image(s) and their crops? This cannot be undone.`)) return;
  const sources = state.sources;
  update(s => initialState(s.settings));
  sources.forEach(releaseSource);
  ui.fileInput.value = '';
  clearWorkspace().catch(reportStorageError);
}

/** Bring back the workspace saved on this device, unless the user already started a new one. */
async function restoreWorkspace(): Promise<void> {
  const raw = await loadWorkspace();
  if (raw === undefined) return;
  const snapshot = parseSnapshot(raw);
  const images = new Map<string, RestoredImage>();
  const problems: string[] = [];
  for (const stored of snapshot.sources) {
    try {
      const blob = await loadImage(stored.id);
      if (!blob) throw new Error('image is missing from browser storage');
      images.set(stored.id, { bitmap: await decodeImage(blob, stored.name), blob, thumbUrl: URL.createObjectURL(blob) });
    } catch (error) {
      problems.push(`${stored.name} (${errorMessage(error)})`);
    }
  }
  const restored = restoreState(snapshot, images);
  if (state.sources.length > 0) {
    restored.sources.forEach(s => {
      URL.revokeObjectURL(s.thumbUrl);
      s.bitmap.close();
    });
    toast('New images were added before the previous session loaded, so it was not restored.', 'info');
    return;
  }
  update(() => restored);
  restored.sources.filter(s => s.detection.kind === 'pending').forEach(s => void detectNew(s));
  if (problems.length > 0) toast(`Could not restore ${problems.length} image${problems.length === 1 ? '' : 's'}: ${problems.join('; ')}`, 'error');
}

function loadSample(): void {
  sampleCollage().then(
    file => addFiles([file]),
    (error: unknown) => toast(errorMessage(error), 'error'),
  );
}

// ---------- Input wiring ----------

ui.fileInput.addEventListener('change', () => {
  void addFiles(Array.from(ui.fileInput.files ?? []));
  ui.fileInput.value = '';
});
ui.emptyUpload.addEventListener('click', () => ui.fileInput.click());
ui.dropZone.addEventListener('keydown', event => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    ui.fileInput.click();
  }
});
ui.emptySample.addEventListener('click', loadSample);
ui.resetButton.addEventListener('click', resetWorkspace);

// Drag and drop anywhere in the window. A counter avoids flicker from child elements.
let dragDepth = 0;
const hasFiles = (event: DragEvent): boolean => Array.from(event.dataTransfer?.types ?? []).includes('Files');
window.addEventListener('dragenter', event => {
  if (!hasFiles(event)) return;
  event.preventDefault();
  dragDepth++;
  ui.dropOverlay.hidden = false;
});
window.addEventListener('dragover', event => {
  if (hasFiles(event)) event.preventDefault();
});
window.addEventListener('dragleave', event => {
  if (!hasFiles(event)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) ui.dropOverlay.hidden = true;
});
window.addEventListener('drop', event => {
  if (!hasFiles(event)) return;
  event.preventDefault();
  dragDepth = 0;
  ui.dropOverlay.hidden = true;
  void addFiles(Array.from(event.dataTransfer?.files ?? []));
});

window.addEventListener('paste', event => {
  const files = Array.from(event.clipboardData?.files ?? []).filter(f => f.type.startsWith('image/'));
  if (files.length === 0 || (event.target instanceof HTMLInputElement && event.target.type === 'text')) return;
  event.preventDefault();
  void addFiles(files);
});

ui.undoButton.addEventListener('click', () => update(undoActive));
ui.redoButton.addEventListener('click', () => update(redoActive));
ui.exportButton.addEventListener('click', () => exportDialog.open());
ui.themeButton.addEventListener('click', () => {
  const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch (error) {
    toast(`Could not remember your theme choice: ${errorMessage(error)}`, 'error');
  }
});
ui.zoomIn.addEventListener('click', () => editor.zoomBy(1.25));
ui.zoomOut.addEventListener('click', () => editor.zoomBy(0.8));
ui.zoomFit.addEventListener('click', () => editor.fit());
ui.toolbar.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach(button =>
  button.addEventListener('click', () => setTool(button.dataset.tool === 'draw' ? 'draw' : 'select')),
);
ui.snapButton.addEventListener('click', () => {
  snap = !snap;
  ui.snapButton.setAttribute('aria-pressed', String(snap));
});
ui.addCropButton.addEventListener('click', addCentredCrop);

ui.cropName.addEventListener('change', () => {
  const crop = selectedCrop();
  if (crop) editActive(list => renameCrop(list, crop.id, ui.cropName.value));
});
([['x', ui.cropX], ['y', ui.cropY], ['w', ui.cropW], ['h', ui.cropH]] as const).forEach(([key, input]) => {
  input.addEventListener('change', () => applyNumericField(key));
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') input.blur();
  });
});
ui.cropName.addEventListener('keydown', event => {
  if (event.key === 'Enter') ui.cropName.blur();
});
ui.aspectSelect.addEventListener('change', () => {
  const ratio = aspectRatio();
  if (ratio !== null) editSelectedRect((rect, source) => fitRatio(rect, (ratio * source.size.height) / source.size.width));
});
ui.duplicateButton.addEventListener('click', () => {
  if (state.selectedId) duplicateSelected(state.selectedId);
});
ui.trimSelectedButton.addEventListener('click', () => {
  if (state.selectedId) trimCrops(new Set([state.selectedId]));
});
ui.deleteButton.addEventListener('click', () => {
  const id = state.selectedId;
  if (id) editActive(list => removeCrop(list, id));
});
ui.splitButton.addEventListener('click', splitSelected);
ui.trimAllButton.addEventListener('click', () => trimCrops(new Set(activeCrops(state).map(c => c.id))));
ui.redetectButton.addEventListener('click', () => void redetectActive());
ui.applyAllButton.addEventListener('click', () => {
  const others = state.sources.length - 1;
  update(s => applyLayoutToAll(s, newId));
  toast(`Copied this layout to ${others} other image${others === 1 ? '' : 's'}. Undo works per image.`, 'info');
});
ui.sensitivity.addEventListener('input', () => {
  update(s => setSettings(s, { ...s.settings, sensitivity: Number(ui.sensitivity.value) / 100 }));
});
ui.trimMargins.addEventListener('change', () => {
  update(s => setSettings(s, { ...s.settings, trimMargins: ui.trimMargins.checked }));
});
document.querySelectorAll<HTMLButtonElement>('.tabs [role="tab"]').forEach(tab =>
  tab.addEventListener('click', () => selectTab(tab.id.replace('tab-', ''))),
);

window.addEventListener('keydown', event => {
  if (isTyping(event) || ui.exportDialog.open) return;
  const mod = event.metaKey || event.ctrlKey;
  const key = event.key.toLowerCase();
  const step = event.shiftKey ? 10 : 1;
  if (mod && key === 'z') {
    event.preventDefault();
    update(event.shiftKey ? redoActive : undoActive);
  } else if (mod && key === 'y') {
    event.preventDefault();
    update(redoActive);
  } else if (mod && key === 'd') {
    event.preventDefault();
    if (state.selectedId) duplicateSelected(state.selectedId);
  } else if (mod) {
    return;
  } else if ((event.key === 'Delete' || event.key === 'Backspace') && state.selectedId) {
    event.preventDefault();
    const id = state.selectedId;
    editActive(list => removeCrop(list, id));
  } else if (event.key.startsWith('Arrow') && state.selectedId) {
    event.preventDefault();
    const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
    const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
    if (event.altKey) growSelected(dx, dy);
    else nudgeSelected(dx, dy);
  } else if (event.key === 'Tab' && activeSource(state) && !(event.target instanceof HTMLButtonElement)) {
    event.preventDefault();
    cycleSelection(event.shiftKey ? -1 : 1);
  } else if (event.key === 'Escape') {
    update(s => selectCrop(s, null));
  } else if (key === 'v') {
    setTool('select');
  } else if (key === 'r') {
    setTool('draw');
  } else if (key === 'n' && activeSource(state)) {
    addCentredCrop();
  } else if (event.key === '0') {
    editor.fit();
  } else if (event.key === '+' || event.key === '=') {
    editor.zoomBy(1.25);
  } else if (event.key === '-') {
    editor.zoomBy(0.8);
  }
});

window.addEventListener('beforeunload', event => {
  const saved = autosave.status().kind;
  if (state.sources.length > 0 && (saved === 'pending' || saved === 'failed')) event.preventDefault();
});

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch((error: unknown) => toast(`Offline mode is unavailable: ${errorMessage(error)}`, 'error'));
}

loadThemePreference();
render(null);
restoreWorkspace().catch((error: unknown) => toast(`Could not restore your previous session: ${errorMessage(error)}`, 'error'));
