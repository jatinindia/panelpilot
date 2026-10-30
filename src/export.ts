import { zip, type AsyncZippable } from 'fflate';
import { frameLayout, type Frame } from './frame';
import { toPixelRect } from './geometry';
import type { Crop, Source } from './model';
import type { PlannedFile } from './plan';

export type ExportFormat = 'png' | 'jpeg' | 'webp';

export interface ExportSettings {
  readonly format: ExportFormat;
  /** 0..1, ignored for PNG. */
  readonly quality: number;
  readonly padding: number;
  /** Fills padding and any space the frame adds around the crop. */
  readonly padColor: string;
  readonly frame: Frame;
}

export interface ExportResult {
  readonly blob: Blob;
  readonly fileName: string;
}

const MIME: Readonly<Record<ExportFormat, string>> = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };
const EXTENSION: Readonly<Record<ExportFormat, string>> = { png: 'png', jpeg: 'jpg', webp: 'webp' };

export function extensionFor(format: ExportFormat): string {
  return EXTENSION[format];
}

export async function renderCrop(source: Source, crop: Crop, settings: ExportSettings): Promise<Blob> {
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
  if (addsSpace || settings.format === 'jpeg') {
    ctx.fillStyle = settings.padColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source.bitmap, r.x, r.y, r.w, r.h, layout.dest.x, layout.dest.y, layout.dest.w, layout.dest.h);

  const mime = MIME[settings.format];
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, mime, settings.quality));
  if (!blob) throw new Error(`Could not encode a ${canvas.width}x${canvas.height} crop of "${source.name}" as ${mime}`);
  if (blob.type !== mime) {
    throw new Error(`This browser cannot encode ${settings.format.toUpperCase()} (it produced ${blob.type}). Choose PNG or JPEG instead.`);
  }
  return blob;
}

/** One file downloads as-is; several are bundled into a ZIP. */
export async function buildExport(
  files: readonly PlannedFile<Source>[],
  settings: ExportSettings,
  archiveName: string,
  onProgress: (done: number, total: number) => void,
): Promise<ExportResult> {
  const [only] = files;
  if (files.length === 1 && only) {
    const blob = await renderCrop(only.source, only.crop, settings);
    onProgress(1, 1);
    return { blob, fileName: only.path.split('/').pop() ?? only.path };
  }
  const entries: AsyncZippable = {};
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (!file) continue;
    const blob = await renderCrop(file.source, file.crop, settings);
    // Images are already compressed; storing them is much faster than deflating.
    entries[file.path] = [new Uint8Array(await blob.arrayBuffer()), { level: 0 }];
    onProgress(i + 1, files.length);
  }
  const bytes = await zipAsync(entries);
  return { blob: new Blob([bytes], { type: 'application/zip' }), fileName: archiveName };
}

function zipAsync(entries: AsyncZippable): Promise<Uint8Array<ArrayBuffer>> {
  return new Promise((resolve, reject) => {
    zip(entries, (error, data) => {
      if (error) reject(new Error(`Could not build ZIP of ${Object.keys(entries).length} files: ${error.message}`));
      else resolve(new Uint8Array(data));
    });
  });
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
