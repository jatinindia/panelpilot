import { zip, type AsyncZippable } from 'fflate';
import { frameLayout, type Frame } from './frame';
import { toPixelRect } from './geometry';
import type { Crop, Source } from './model';
import { outputFormat } from './naming';
import type { PlannedFile } from './plan';
import type { ExportFormat, FormatChoice } from './types';

export interface ExportSettings {
  readonly format: FormatChoice;
  /** 0..1, ignored for PNG. */
  readonly quality: number;
  readonly padding: number;
  /** Fills padding and any space the frame adds around the crop. */
  readonly padColor: string;
  readonly frame: Frame;
}

export interface RenderedFile {
  /** Relative path, e.g. "Summer Sale/Summer Sale-1.JPG". */
  readonly path: string;
  readonly blob: Blob;
}

const MIME: Readonly<Record<ExportFormat, string>> = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };

/** The extension each source's files get, honouring "Original" format. */
export function extensionFor(source: Source, choice: FormatChoice): string {
  return outputFormat(source.name, source.blob.type, choice).extension;
}

export async function renderCrop(source: Source, crop: Crop, settings: ExportSettings): Promise<Blob> {
  const format = outputFormat(source.name, source.blob.type, settings.format).format;
  const r = toPixelRect(crop.rect, source.size.width, source.size.height);
  const pad = Math.max(0, Math.round(settings.padding));
  const layout = frameLayout({ width: r.w, height: r.h }, settings.frame, pad);
  const canvas = document.createElement('canvas');
  canvas.width = layout.canvas.width;
  canvas.height = layout.canvas.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error(`Could not create a ${canvas.width}x${canvas.height} canvas for "${source.name}"`);
  // JPEG has no alpha: transparent pixels would turn black, so always fill.
  const addsSpace = layout.canvas.width !== r.w || layout.canvas.height !== r.h;
  if (addsSpace || format === 'jpeg') {
    ctx.fillStyle = settings.padColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source.bitmap, r.x, r.y, r.w, r.h, layout.dest.x, layout.dest.y, layout.dest.w, layout.dest.h);

  const mime = MIME[format];
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, mime, settings.quality));
  if (!blob) throw new Error(`Could not encode a ${canvas.width}x${canvas.height} crop of "${source.name}" as ${mime}`);
  if (blob.type !== mime) {
    throw new Error(`This browser cannot encode ${format.toUpperCase()} (it produced ${blob.type}). Choose PNG or JPEG instead.`);
  }
  return blob;
}

export async function renderFiles(
  files: readonly PlannedFile<Source>[],
  settings: ExportSettings,
  onProgress: (done: number, total: number) => void,
): Promise<RenderedFile[]> {
  const rendered: RenderedFile[] = [];
  for (const file of files) {
    rendered.push({ path: file.path, blob: await renderCrop(file.source, file.crop, settings) });
    onProgress(rendered.length, files.length);
  }
  return rendered;
}

export async function zipFiles(files: readonly RenderedFile[]): Promise<Blob> {
  const entries: AsyncZippable = {};
  for (const file of files) {
    // Images are already compressed; storing them is much faster than deflating.
    entries[file.path] = [new Uint8Array(await file.blob.arrayBuffer()), { level: 0 }];
  }
  const bytes = await new Promise<Uint8Array<ArrayBuffer>>((resolve, reject) => {
    zip(entries, (error, data) => {
      if (error) reject(new Error(`Could not build ZIP of ${files.length} files: ${error.message}`));
      else resolve(new Uint8Array(data));
    });
  });
  return new Blob([bytes], { type: 'application/zip' });
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  // Give the browser time to start the download before releasing the blob.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
