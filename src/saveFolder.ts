import type { RenderedFile } from './export';

/*
 * Writing into a folder the user picks (File System Access API).
 * Only Chromium browsers support it; callers check `canSaveToFolder()`.
 */

interface DirectoryPickerOptions {
  readonly id: string;
  readonly mode: 'readwrite';
}

type DirectoryPicker = (options: DirectoryPickerOptions) => Promise<FileSystemDirectoryHandle>;

export interface FolderSaveResult {
  readonly folder: string;
  readonly written: number;
  /** Files that already existed, so the new copy got a " (2)"-style name instead. */
  readonly renamed: readonly string[];
}

export function canSaveToFolder(): boolean {
  return 'showDirectoryPicker' in window;
}

/** Must be called directly from a click handler: browsers require a user gesture. Null if the user cancels. */
export async function pickFolder(): Promise<FileSystemDirectoryHandle | null> {
  const picker = (window as unknown as { readonly showDirectoryPicker: DirectoryPicker }).showDirectoryPicker;
  try {
    // The id makes the browser reopen the picker in the folder used last time.
    return await picker({ id: 'panelpilot-export', mode: 'readwrite' });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return null;
    throw new Error(`Could not open the folder picker: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Write files (paths may contain one subfolder level per source) without overwriting anything already there. */
export async function writeToFolder(root: FileSystemDirectoryHandle, files: readonly RenderedFile[]): Promise<FolderSaveResult> {
  const renamed: string[] = [];
  for (const file of files) {
    const parts = file.path.split('/');
    const name = parts.pop() ?? file.path;
    let dir = root;
    for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: true });
    const target = await freeName(dir, name);
    if (target !== name) renamed.push(`${parts.length > 0 ? `${parts.join('/')}/` : ''}${target}`);
    try {
      const handle = await dir.getFileHandle(target, { create: true });
      const writable = await handle.createWritable();
      await writable.write(file.blob);
      await writable.close();
    } catch (error) {
      throw new Error(`Could not write "${file.path}" to "${root.name}": ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { folder: root.name, written: files.length, renamed };
}

async function freeName(dir: FileSystemDirectoryHandle, name: string): Promise<string> {
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let i = 1; ; i++) {
    const candidate = i === 1 ? name : `${stem} (${i})${ext}`;
    if (!(await exists(dir, candidate))) return candidate;
  }
}

async function exists(dir: FileSystemDirectoryHandle, name: string): Promise<boolean> {
  try {
    await dir.getFileHandle(name);
    return true;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') return false;
    throw error;
  }
}
