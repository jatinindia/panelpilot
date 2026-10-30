import './styles.css';
import { cropsFromPanels, duplicateCrop, moveCropInList, removeCrop, renameCrop, updateCropRect } from './crops';
import { detectInWorker } from './detect/client';
import { moveRect } from './geometry';
import { canRedo, canUndo } from './history';
import { analysisPixels, bitmapSize, decodeImage } from './load';
import type { Crop, DetectionStatus, Source } from './model';
import { sampleCollage } from './sample';
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
import { byId, errorMessage, isTyping, toast } from './ui/dom';
import { createEditor } from './ui/editor';
import { setupExportDialog } from './ui/exportDialog';
import { renderCropList, renderSourceList, statusBadge } from './ui/panels';

const ui = {
  fileInput: byId('fileInput', HTMLInputElement),
  dropZone: byId('dropZone', HTMLLabelElement),
  dropOverlay: byId('dropOverlay', HTMLDivElement),
  sampleButton: byId('sampleButton', HTMLButtonElement),
  resetButton: byId('resetButton', HTMLButtonElement),
  sourceList: byId('sourceList', HTMLUListElement),
  sourceCount: byId('sourceCount', HTMLSpanElement),
  sourcesEmpty: byId('sourcesEmpty', HTMLParagraphElement),
  title: byId('title', HTMLHeadingElement),
  confidencePill: byId('confidencePill', HTMLSpanElement),
  undoButton: byId('undoButton', HTMLButtonElement),
  redoButton: byId('redoButton', HTMLButtonElement),
  exportButton: byId('exportButton', HTMLButtonElement),
  zoomIn: byId('zoomIn', HTMLButtonElement),
  zoomOut: byId('zoomOut', HTMLButtonElement),
  zoomFit: byId('zoomFit', HTMLButtonElement),
  zoomLabel: byId('zoomLabel', HTMLSpanElement),
  canvas: byId('editorCanvas', HTMLCanvasElement),
  emptyState: byId('emptyState', HTMLDivElement),
  emptyUpload: byId('emptyUpload', HTMLButtonElement),
  busyOverlay: byId('busyOverlay', HTMLDivElement),
  editorFooter: byId('editorFooter', HTMLDivElement),
  cropList: byId('cropList', HTMLUListElement),
  cropCount: byId('cropCount', HTMLSpanElement),
  cropsEmpty: byId('cropsEmpty', HTMLParagraphElement),
  addCropButton: byId('addCropButton', HTMLButtonElement),
  sensitivity: byId('sensitivity', HTMLInputElement),
  sensitivityValue: byId('sensitivityValue', HTMLOutputElement),
  trimMargins: byId('trimMargins', HTMLInputElement),
  redetectButton: byId('redetectButton', HTMLButtonElement),
  applyAllButton: byId('applyAllButton', HTMLButtonElement),
};

let state: AppState = initialState({ sensitivity: Number(ui.sensitivity.value) / 100, trimMargins: ui.trimMargins.checked });
const newId = (): string => crypto.randomUUID();

function update(fn: (s: AppState) => AppState): void {
  const next = fn(state);
  if (next === state) return;
  const previous = state;
  state = next;
  render(previous);
}

const editor = createEditor(ui.canvas, {
  getState: () => state,
  select: id => update(s => selectCrop(s, id)),
  commit: (sourceId, crops) => update(s => commitCrops(s, sourceId, crops)),
  newId,
  onViewChange: scale => {
    ui.zoomLabel.textContent = formatScale(scale);
  },
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
      rename: (id, label) => editActive(list => renameCrop(list, id, label)),
      move: (id, delta) => editActive(list => moveCropInList(list, id, delta)),
      duplicate: id => duplicateSelected(id),
      remove: id => editActive(list => removeCrop(list, id)),
    });
  }
  if (!source) ui.cropList.replaceChildren();

  ui.sourceCount.textContent = String(state.sources.length);
  ui.sourcesEmpty.hidden = state.sources.length > 0;
  ui.cropCount.textContent = String(crops.length);
  ui.cropsEmpty.hidden = crops.length > 0;
  ui.cropsEmpty.textContent = source ? 'No crops. Draw one on the image or press Add crop.' : 'Detected crops appear here.';

  ui.title.textContent = source ? source.name : 'Start with a collage';
  ui.emptyState.hidden = source !== null;
  ui.busyOverlay.hidden = source?.detection.kind !== 'pending';
  renderConfidence(source?.detection ?? null);
  ui.editorFooter.textContent = source ? `${source.size.width} × ${source.size.height} px · ${crops.length} crop${crops.length === 1 ? '' : 's'}` : 'No image loaded';

  const hasSource = source !== null;
  const ready = hasSource && source.detection.kind !== 'pending';
  ui.resetButton.disabled = state.sources.length === 0;
  ui.undoButton.disabled = !history || !canUndo(history);
  ui.redoButton.disabled = !history || !canRedo(history);
  ui.exportButton.disabled = !state.sources.some(s => (state.crops.get(s.id)?.present.length ?? 0) > 0);
  [ui.zoomIn, ui.zoomOut, ui.zoomFit].forEach(b => (b.disabled = !hasSource));
  ui.addCropButton.disabled = !ready;
  ui.redetectButton.disabled = !ready;
  ui.applyAllButton.disabled = !ready || state.sources.length < 2 || crops.length === 0;
  ui.sensitivityValue.value = String(Math.round(state.settings.sensitivity * 100));
  if (previous?.activeId !== state.activeId) ui.zoomLabel.textContent = formatScale(editor.scale());

  editor.render();
}

function formatScale(scale: number | null): string {
  return scale === null ? '–' : `${Math.round(scale * 100)}%`;
}

function renderConfidence(status: DetectionStatus | null): void {
  if (!status) {
    ui.confidencePill.hidden = true;
    return;
  }
  const badge = statusBadge(status);
  const text: Readonly<Record<string, string>> = {
    detecting: 'Detecting…',
    error: 'Detection failed',
    high: 'High confidence',
    medium: 'Medium confidence - check edges',
    review: 'Needs review',
  };
  ui.confidencePill.hidden = false;
  ui.confidencePill.className = `pill ${badge.tone}`;
  ui.confidencePill.textContent = text[badge.text] ?? badge.text;
  ui.confidencePill.title = status.kind === 'failed' ? status.message : '';
}

// ---------- Editing helpers ----------

function editActive(fn: (crops: readonly Crop[]) => readonly Crop[]): void {
  update(s => (s.activeId === null ? s : commitCrops(s, s.activeId, fn(activeCrops(s)))));
}

function duplicateSelected(id: string): void {
  const copyId = newId();
  update(s => (s.activeId === null ? s : selectCrop(commitCrops(s, s.activeId, duplicateCrop(activeCrops(s), id, copyId)), copyId)));
}

function nudgeSelected(dxPx: number, dyPx: number): void {
  const source = activeSource(state);
  const crop = activeCrops(state).find(c => c.id === state.selectedId);
  if (!source || !crop) return;
  const rect = moveRect(crop.rect, dxPx / source.size.width, dyPx / source.size.height);
  editActive(list => updateCropRect(list, crop.id, rect));
}

function addCentredCrop(): void {
  const crop: Crop = { id: newId(), rect: { x: 0.3, y: 0.3, w: 0.4, h: 0.4 }, label: null };
  update(s => (s.activeId === null ? s : selectCrop(commitCrops(s, s.activeId, [...activeCrops(s), crop]), crop.id)));
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
        name: file.name || 'pasted-image.png',
        size: bitmapSize(bitmap),
        bitmap,
        thumbUrl: URL.createObjectURL(file),
        detection: { kind: 'pending' },
      };
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
}

function resetWorkspace(): void {
  if (state.sources.length === 0) return;
  if (!window.confirm(`Remove all ${state.sources.length} source(s) and their crops? This cannot be undone.`)) return;
  const sources = state.sources;
  update(s => initialState(s.settings));
  sources.forEach(releaseSource);
  ui.fileInput.value = '';
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
ui.sampleButton.addEventListener('click', () => {
  sampleCollage().then(
    file => addFiles([file]),
    (error: unknown) => toast(errorMessage(error), 'error'),
  );
});
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
ui.zoomIn.addEventListener('click', () => editor.zoomBy(1.25));
ui.zoomOut.addEventListener('click', () => editor.zoomBy(0.8));
ui.zoomFit.addEventListener('click', () => editor.fit());
ui.addCropButton.addEventListener('click', addCentredCrop);
ui.redetectButton.addEventListener('click', () => void redetectActive());
ui.applyAllButton.addEventListener('click', () => {
  const others = state.sources.length - 1;
  update(s => applyLayoutToAll(s, newId));
  toast(`Copied this layout to ${others} other source${others === 1 ? '' : 's'}. Undo works per source.`, 'info');
});
ui.sensitivity.addEventListener('input', () => {
  update(s => setSettings(s, { ...s.settings, sensitivity: Number(ui.sensitivity.value) / 100 }));
});
ui.trimMargins.addEventListener('change', () => {
  update(s => setSettings(s, { ...s.settings, trimMargins: ui.trimMargins.checked }));
});

window.addEventListener('keydown', event => {
  if (isTyping(event) || byId('exportDialog', HTMLDialogElement).open) return;
  const mod = event.metaKey || event.ctrlKey;
  const key = event.key.toLowerCase();
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
    const step = event.shiftKey ? 10 : 1;
    const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
    const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
    nudgeSelected(dx, dy);
  } else if (event.key === 'Escape') {
    update(s => selectCrop(s, null));
  } else if (event.key === '0') {
    editor.fit();
  } else if (event.key === '+' || event.key === '=') {
    editor.zoomBy(1.25);
  } else if (event.key === '-') {
    editor.zoomBy(0.8);
  }
});

window.addEventListener('beforeunload', event => {
  if (state.sources.length > 0) event.preventDefault();
});

render(null);
