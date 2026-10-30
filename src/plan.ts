import { displayLabel } from './crops';
import type { Crop } from './model';
import { applyTemplate, baseName, safeName, uniqueNames } from './naming';

export interface Named {
  readonly name: string;
}

export interface ExportEntry {
  readonly crop: Crop;
  /** Position of the crop in its source's full list (drives {n} and default labels). */
  readonly index: number;
}

export interface ExportGroup<S extends Named> {
  readonly source: S;
  readonly entries: readonly ExportEntry[];
  /** Number of crops in the source, for zero-padding {n}. */
  readonly total: number;
}

export interface PlannedFile<S extends Named> {
  readonly path: string;
  readonly source: S;
  readonly crop: Crop;
}

/** Decide every output path. Several sources get one folder each, named after the upload. */
export function planFiles<S extends Named>(
  groups: readonly ExportGroup<S>[],
  template: string,
  extensionFor: (source: S) => string,
): PlannedFile<S>[] {
  const folders = uniqueNames(groups.map(g => safeName(baseName(g.source.name)) || 'image'));
  return groups.flatMap((group, g) => {
    const names = uniqueNames(
      group.entries.map(e => applyTemplate(template, { name: group.source.name, n: e.index + 1, total: group.total, label: displayLabel(e.crop, e.index) })),
    );
    const prefix = groups.length > 1 ? `${folders[g] ?? 'image'}/` : '';
    const extension = extensionFor(group.source);
    return group.entries.map((e, i) => ({ path: `${prefix}${names[i] ?? String(i + 1)}.${extension}`, source: group.source, crop: e.crop }));
  });
}

export function archiveName(sources: readonly Named[]): string {
  const [only] = sources;
  return sources.length === 1 && only ? `${safeName(baseName(only.name)) || 'image'} crops.zip` : 'PanelPilot crops.zip';
}
