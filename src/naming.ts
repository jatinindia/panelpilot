import type { ExportFormat, FormatChoice } from './types';

export interface TemplateTokens {
  /** Original upload file name, e.g. "Summer Sale.JPG". */
  readonly name: string;
  /** 1-based panel index. */
  readonly n: number;
  readonly total: number;
  readonly label: string;
}

export interface OutputFormat {
  readonly format: ExportFormat;
  readonly extension: string;
}

const STANDARD_EXTENSION: Readonly<Record<ExportFormat, string>> = { png: 'png', jpeg: 'jpg', webp: 'webp' };
const EXTENSIONS: Readonly<Record<ExportFormat, readonly string[]>> = { png: ['png'], jpeg: ['jpg', 'jpeg'], webp: ['webp'] };

export function baseName(fileName: string): string {
  return fileName.replace(/\.[^./]+$/, '');
}

function extensionOf(fileName: string): string {
  return /\.([^./]+)$/.exec(fileName)?.[1] ?? '';
}

/** Keeps the name as typed (case, spaces, unicode); removes only what filesystems reject. */
export function safeName(text: string): string {
  return text
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
}

/** Render a file-name template with {name}, {n} and {label}. Unknown tokens render empty. */
export function applyTemplate(template: string, tokens: TemplateTokens): string {
  const index = String(tokens.n).padStart(String(tokens.total).length, '0');
  const rendered = template
    .replace(/\{name\}/g, baseName(tokens.name))
    .replace(/\{n\}/g, index)
    .replace(/\{label\}/g, tokens.label)
    .replace(/\{[^}]*\}/g, '');
  return safeName(rendered) || index;
}

/** Which format to encode an upload's crops in, and the extension to write. */
export function outputFormat(fileName: string, mimeType: string, choice: FormatChoice): OutputFormat {
  const original = encodableFormat(mimeType);
  const format = choice === 'original' ? (original ?? 'png') : choice;
  const ext = extensionOf(fileName);
  const keepsSpelling = format === original && EXTENSIONS[format].includes(ext.toLowerCase());
  return { format, extension: keepsSpelling ? ext : STANDARD_EXTENSION[format] };
}

function encodableFormat(mimeType: string): ExportFormat | null {
  if (mimeType === 'image/jpeg') return 'jpeg';
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  return null;
}

/** Suffix duplicates with -2, -3, ... (case-insensitive, since most filesystems are). */
export function uniqueNames(names: readonly string[]): string[] {
  const used = new Set<string>();
  return names.map(name => {
    let candidate = name;
    for (let i = 2; used.has(candidate.toLowerCase()); i++) candidate = `${name}-${i}`;
    used.add(candidate.toLowerCase());
    return candidate;
  });
}
