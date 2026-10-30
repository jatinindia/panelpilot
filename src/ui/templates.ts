import type { Crop } from '../model';
import { cropsFromTemplate, parseTemplate, templateFromCrops, type LayoutTemplate } from '../snapshot';
import { deleteTemplate, loadTemplates, saveTemplate } from '../storage';
import { byId, el, errorMessage, toast } from './dom';

export interface TemplateCallbacks {
  /** Crops of the active source, or null when there is no active source. */
  readonly currentCrops: () => readonly Crop[] | null;
  /** Replace the active source's crops (as an undoable edit). */
  readonly apply: (crops: readonly Crop[]) => void;
  readonly newId: () => string;
}

export interface Templates {
  /** Re-evaluate which buttons are usable after the app state changed. */
  readonly refresh: () => void;
}

export function setupTemplates(callbacks: TemplateCallbacks): Templates {
  const select = byId('templateSelect', HTMLSelectElement);
  const applyButton = byId('templateApplyButton', HTMLButtonElement);
  const deleteButton = byId('templateDeleteButton', HTMLButtonElement);
  const nameInput = byId('templateName', HTMLInputElement);
  const saveButton = byId('templateSaveButton', HTMLButtonElement);
  let templates: readonly LayoutTemplate[] = [];

  function selected(): LayoutTemplate | null {
    return templates.find(t => t.id === select.value) ?? null;
  }

  function refresh(): void {
    const crops = callbacks.currentCrops();
    applyButton.disabled = crops === null || selected() === null;
    deleteButton.disabled = selected() === null;
    saveButton.disabled = crops === null || crops.length === 0 || nameInput.value.trim() === '';
  }

  function renderOptions(selectId: string | null): void {
    const options = templates.map(t => {
      const option = el('option', '', [`${t.name} (${t.crops.length})`]);
      option.value = t.id;
      return option;
    });
    const placeholder = el('option', '', [templates.length === 0 ? 'No saved layouts yet' : 'Choose a layout']);
    placeholder.value = '';
    select.replaceChildren(placeholder, ...options);
    select.value = selectId ?? '';
    refresh();
  }

  async function load(): Promise<void> {
    const raw = await loadTemplates();
    const parsed: LayoutTemplate[] = [];
    raw.forEach(value => {
      try {
        parsed.push(parseTemplate(value));
      } catch (error) {
        toast(`Ignored an unreadable saved layout: ${errorMessage(error)}`, 'error');
      }
    });
    templates = parsed.sort((a, b) => a.name.localeCompare(b.name));
    renderOptions(null);
  }

  saveButton.addEventListener('click', () => {
    const crops = callbacks.currentCrops();
    const name = nameInput.value.trim();
    if (!crops || crops.length === 0 || name === '') return;
    const existing = templates.find(t => t.name.toLowerCase() === name.toLowerCase());
    if (existing && !window.confirm(`Replace the saved layout "${existing.name}"?`)) return;
    const template = templateFromCrops(name, crops, existing?.id ?? callbacks.newId(), Date.now());
    saveTemplate(template.id, template).then(
      () => {
        templates = [...templates.filter(t => t.id !== template.id), template].sort((a, b) => a.name.localeCompare(b.name));
        nameInput.value = '';
        renderOptions(template.id);
        toast(`Saved layout "${template.name}" with ${template.crops.length} crop${template.crops.length === 1 ? '' : 's'}.`, 'info');
      },
      (error: unknown) => toast(errorMessage(error), 'error'),
    );
  });

  applyButton.addEventListener('click', () => {
    const template = selected();
    if (!template) return;
    callbacks.apply(cropsFromTemplate(template, callbacks.newId));
    toast(`Applied "${template.name}". Undo restores the previous crops.`, 'info');
  });

  deleteButton.addEventListener('click', () => {
    const template = selected();
    if (!template || !window.confirm(`Delete the saved layout "${template.name}"?`)) return;
    deleteTemplate(template.id).then(
      () => {
        templates = templates.filter(t => t.id !== template.id);
        renderOptions(null);
      },
      (error: unknown) => toast(errorMessage(error), 'error'),
    );
  });

  select.addEventListener('change', refresh);
  nameInput.addEventListener('input', refresh);
  nameInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') saveButton.click();
  });

  load().catch((error: unknown) => toast(`Could not load saved layouts: ${errorMessage(error)}`, 'error'));
  return { refresh };
}
