import { downloadBlob, extensionFor, renderFiles, zipFiles, type ExportSettings } from '../export';
import type { Frame } from '../frame';
import type { Source } from '../model';
import { applyTemplate } from '../naming';
import { archiveName, planFiles, type ExportGroup, type PlannedFile } from '../plan';
import { canSaveToFolder, pickFolder, writeToFolder } from '../saveFolder';
import { activeSource, cropsOf, type AppState } from '../state';
import type { FormatChoice } from '../types';
import { byId, errorMessage, toast } from './dom';

type Scope = 'all' | 'active' | 'selected';
type Destination = 'folder' | 'download';

export function setupExportDialog(getState: () => AppState): { readonly open: () => void } {
  const dialog = byId('exportDialog', HTMLDialogElement);
  const form = byId('exportForm', HTMLFormElement);
  const quality = byId('exportQuality', HTMLInputElement);
  const qualityField = byId('qualityField', HTMLLabelElement);
  const qualityValue = byId('qualityValue', HTMLOutputElement);
  const frameSelect = byId('exportFrame', HTMLSelectElement);
  const customSizeField = byId('customSizeField', HTMLDivElement);
  const customWidth = byId('exportWidth', HTMLInputElement);
  const customHeight = byId('exportHeight', HTMLInputElement);
  const padding = byId('exportPadding', HTMLInputElement);
  const padColor = byId('exportPadColor', HTMLInputElement);
  const template = byId('exportTemplate', HTMLInputElement);
  const preview = byId('templatePreview', HTMLElement);
  const summary = byId('exportSummary', HTMLSpanElement);
  const errorBox = byId('exportError', HTMLParagraphElement);
  const confirm = byId('exportConfirm', HTMLButtonElement);
  const scopeAllLabel = byId('scopeAllLabel', HTMLSpanElement);
  const scopeActiveLabel = byId('scopeActiveLabel', HTMLSpanElement);
  const scopeSelected = byId('scopeSelected', HTMLInputElement);
  const folderOption = byId('destFolderOption', HTMLLabelElement);
  const folderUnsupported = byId('folderUnsupported', HTMLSpanElement);
  const folderSupported = canSaveToFolder();
  let busy = false;

  if (!folderSupported) {
    folderOption.querySelector('input')?.setAttribute('disabled', '');
    folderUnsupported.hidden = false;
  }

  function radio(name: string): string {
    const value = new FormData(form).get(name);
    return typeof value === 'string' ? value : '';
  }

  function scope(): Scope {
    const value = radio('scope');
    return value === 'active' || value === 'selected' ? value : 'all';
  }

  function destination(): Destination {
    return radio('destination') === 'folder' && folderSupported ? 'folder' : 'download';
  }

  function formatChoice(): FormatChoice {
    const value = radio('format');
    return value === 'png' || value === 'jpeg' || value === 'webp' ? value : 'original';
  }

  function frame(): Frame {
    switch (frameSelect.value) {
      case 'square':
        return { kind: 'aspect', w: 1, h: 1 };
      case 'portrait':
        return { kind: 'aspect', w: 4, h: 5 };
      case '2000':
        return { kind: 'fixed', width: 2000, height: 2000 };
      case '1080':
        return { kind: 'fixed', width: 1080, height: 1080 };
      case '1080x1350':
        return { kind: 'fixed', width: 1080, height: 1350 };
      case 'custom':
        return { kind: 'fixed', width: pixels(customWidth), height: pixels(customHeight) };
      default:
        return { kind: 'original' };
    }
  }

  function pixels(input: HTMLInputElement): number {
    const value = Math.round(Number(input.value));
    return Number.isFinite(value) ? Math.min(10000, Math.max(1, value)) : 1;
  }

  function settings(): ExportSettings {
    const pad = Number(padding.value);
    return { format: formatChoice(), quality: Number(quality.value) / 100, padding: Number.isFinite(pad) ? Math.max(0, pad) : 0, padColor: padColor.value, frame: frame() };
  }

  function groups(state: AppState): ExportGroup<Source>[] {
    const toGroup = (source: Source): ExportGroup<Source> => {
      const crops = cropsOf(state, source.id);
      return { source, entries: crops.map((crop, index) => ({ crop, index })), total: crops.length };
    };
    const active = activeSource(state);
    switch (scope()) {
      case 'all':
        return state.sources.map(toGroup).filter(g => g.entries.length > 0);
      case 'active':
        return active ? [toGroup(active)].filter(g => g.entries.length > 0) : [];
      case 'selected': {
        if (!active) return [];
        const crops = cropsOf(state, active.id);
        const index = crops.findIndex(c => c.id === state.selectedId);
        const crop = crops[index];
        return crop ? [{ source: active, entries: [{ crop, index }], total: crops.length }] : [];
      }
    }
  }

  function plan(state: AppState): PlannedFile<Source>[] {
    const choice = formatChoice();
    return planFiles(groups(state), template.value, source => extensionFor(source, choice));
  }

  function refresh(): void {
    const state = getState();
    qualityField.hidden = formatChoice() === 'png';
    qualityValue.value = quality.value;
    customSizeField.hidden = frameSelect.value !== 'custom';
    const all = state.sources.reduce((n, src) => n + cropsOf(state, src.id).length, 0);
    const active = activeSource(state);
    scopeAllLabel.textContent = `All images · ${all}`;
    scopeActiveLabel.textContent = `This image · ${active ? cropsOf(state, active.id).length : 0}`;
    scopeSelected.disabled = state.selectedId === null;
    if (scopeSelected.disabled && scopeSelected.checked) form.querySelector<HTMLInputElement>('input[name="scope"][value="all"]')?.click();

    const files = plan(state);
    preview.textContent = files[0]?.path.split('/').pop() ?? `${applyTemplate(template.value, { name: active?.name ?? 'Image.jpg', n: 1, total: 1, label: 'Panel 01' })}.jpg`;
    confirm.disabled = busy || files.length === 0;
    confirm.textContent = destination() === 'folder' ? 'Choose folder & save' : files.length > 1 ? 'Download ZIP' : 'Download';
    if (!busy) {
      summary.textContent =
        files.length === 0
          ? 'Nothing to export'
          : destination() === 'folder'
            ? `${files.length} file${files.length === 1 ? '' : 's'} into a folder you pick`
            : files.length === 1
              ? '1 file'
              : `${files.length} files in a ZIP`;
    }
  }

  async function run(): Promise<void> {
    const state = getState();
    const selected = groups(state);
    const files = plan(state);
    if (files.length === 0) return;
    const target = destination();
    // The folder picker needs the click's user activation, so it opens before any rendering.
    const folder = target === 'folder' ? await pickFolder() : null;
    if (target === 'folder' && !folder) return;

    busy = true;
    errorBox.hidden = true;
    confirm.disabled = true;
    try {
      const rendered = await renderFiles(files, settings(), (done, total) => {
        summary.textContent = `Rendering ${done} of ${total}…`;
      });
      if (folder) {
        summary.textContent = 'Writing files…';
        const result = await writeToFolder(folder, rendered);
        const renamedNote = result.renamed.length > 0 ? ` ${result.renamed.length} name${result.renamed.length === 1 ? ' was' : 's were'} taken, so a numbered copy was saved instead of overwriting.` : '';
        toast(`Saved ${result.written} file${result.written === 1 ? '' : 's'} to "${result.folder}".${renamedNote}`, 'info');
      } else {
        const [only] = rendered;
        if (rendered.length === 1 && only) downloadBlob(only.blob, only.path.split('/').pop() ?? only.path);
        else downloadBlob(await zipFiles(rendered), archiveName(selected.map(g => g.source)));
        toast(`Downloaded ${rendered.length} file${rendered.length === 1 ? '' : 's'}${rendered.length > 1 ? ' as a ZIP' : ''}.`, 'info');
      }
      dialog.close();
    } catch (error) {
      errorBox.textContent = errorMessage(error);
      errorBox.hidden = false;
    } finally {
      busy = false;
      refresh();
    }
  }

  form.addEventListener('input', refresh);
  form.addEventListener('change', refresh);
  confirm.addEventListener('click', () => void run());
  dialog.addEventListener('cancel', event => {
    if (busy) event.preventDefault();
  });
  form.addEventListener('submit', event => {
    if (busy) event.preventDefault();
  });

  return {
    open() {
      errorBox.hidden = true;
      refresh();
      dialog.showModal();
    },
  };
}
