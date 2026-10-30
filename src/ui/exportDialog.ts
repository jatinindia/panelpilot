import { buildExport, downloadBlob, extensionFor, type ExportFormat, type ExportSettings } from '../export';
import type { Source } from '../model';
import { applyTemplate } from '../naming';
import { archiveName, planFiles, type ExportGroup } from '../plan';
import { activeSource, cropsOf, type AppState } from '../state';
import { byId, errorMessage, toast } from './dom';

type Scope = 'all' | 'active' | 'selected';

export function setupExportDialog(getState: () => AppState): { readonly open: () => void } {
  const dialog = byId('exportDialog', HTMLDialogElement);
  const format = byId('exportFormat', HTMLSelectElement);
  const quality = byId('exportQuality', HTMLInputElement);
  const qualityField = byId('qualityField', HTMLLabelElement);
  const qualityValue = byId('qualityValue', HTMLOutputElement);
  const padding = byId('exportPadding', HTMLInputElement);
  const padColor = byId('exportPadColor', HTMLInputElement);
  const template = byId('exportTemplate', HTMLInputElement);
  const preview = byId('templatePreview', HTMLElement);
  const summary = byId('exportSummary', HTMLParagraphElement);
  const errorBox = byId('exportError', HTMLParagraphElement);
  const confirm = byId('exportConfirm', HTMLButtonElement);
  const scopeAllLabel = byId('scopeAllLabel', HTMLSpanElement);
  const scopeActiveLabel = byId('scopeActiveLabel', HTMLSpanElement);
  const scopeSelected = byId('scopeSelected', HTMLInputElement);
  const form = byId('exportForm', HTMLFormElement);
  let busy = false;

  function scope(): Scope {
    const value = new FormData(form).get('scope');
    return value === 'active' || value === 'selected' ? value : 'all';
  }

  function settings(): ExportSettings {
    const value = format.value;
    const chosen: ExportFormat = value === 'jpeg' || value === 'webp' ? value : 'png';
    const pad = Number(padding.value);
    return { format: chosen, quality: Number(quality.value) / 100, padding: Number.isFinite(pad) ? Math.max(0, pad) : 0, padColor: padColor.value };
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

  function refresh(): void {
    const state = getState();
    const s = settings();
    qualityField.hidden = s.format === 'png';
    qualityValue.value = quality.value;
    const all = state.sources.reduce((n, src) => n + cropsOf(state, src.id).length, 0);
    const active = activeSource(state);
    scopeAllLabel.textContent = `All sources (${all} crop${all === 1 ? '' : 's'})`;
    scopeActiveLabel.textContent = `This source (${active ? cropsOf(state, active.id).length : 0})`;
    scopeSelected.disabled = state.selectedId === null;
    if (scopeSelected.disabled && scopeSelected.checked) form.querySelector<HTMLInputElement>('input[value="all"]')?.click();

    preview.textContent = `${applyTemplate(template.value, { source: active?.name ?? 'collage.png', n: 1, total: 9, label: 'Panel 01' })}.${extensionFor(s.format)}`;
    const files = planFiles(groups(state), template.value, extensionFor(s.format));
    confirm.disabled = busy || files.length === 0;
    if (!busy) {
      summary.textContent =
        files.length === 0 ? 'Nothing to export.' : files.length === 1 ? 'Downloads 1 image.' : `Downloads a ZIP with ${files.length} images.`;
    }
  }

  async function run(): Promise<void> {
    const state = getState();
    const s = settings();
    const selected = groups(state);
    const files = planFiles(selected, template.value, extensionFor(s.format));
    if (files.length === 0) return;
    busy = true;
    errorBox.hidden = true;
    confirm.disabled = true;
    try {
      const result = await buildExport(files, s, archiveName(selected.map(g => g.source)), (done, total) => {
        summary.textContent = `Rendering ${done} of ${total}…`;
      });
      downloadBlob(result.blob, result.fileName);
      dialog.close();
      toast(`Downloaded ${result.fileName}`, 'info');
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

  return {
    open() {
      errorBox.hidden = true;
      refresh();
      dialog.showModal();
    },
  };
}
