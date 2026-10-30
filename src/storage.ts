/*
 * IndexedDB persistence. Everything stays in this browser profile.
 *   images     source id -> original image Blob (written once per source)
 *   workspace  'current' -> workspace snapshot (rewritten after edits)
 *   templates  template id -> saved layout
 */

const DB_NAME = 'panelpilot';
const DB_VERSION = 1;
const IMAGES = 'images';
const WORKSPACE = 'workspace';
const TEMPLATES = 'templates';
const WORKSPACE_KEY = 'current';

type StoreName = typeof IMAGES | typeof WORKSPACE | typeof TEMPLATES;

let connection: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  connection ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      for (const name of [IMAGES, WORKSPACE, TEMPLATES]) {
        if (!database.objectStoreNames.contains(name)) database.createObjectStore(name);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error(`Could not open browser storage (IndexedDB "${DB_NAME}"): ${request.error?.message ?? 'unknown error'}`));
    request.onblocked = () => reject(new Error('Browser storage is blocked by another open PanelPilot tab; close it and reload'));
  });
  return connection;
}

async function run<T>(store: StoreName, mode: IDBTransactionMode, action: (s: IDBObjectStore) => IDBRequest<T>, what: string): Promise<T> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(store, mode);
    const request = action(tx.objectStore(store));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(new Error(`Could not ${what}: ${tx.error?.message ?? request.error?.message ?? 'unknown error'}`));
    tx.onabort = () => reject(new Error(`Could not ${what}: ${tx.error?.message ?? 'transaction aborted (storage may be full)'}`));
  });
}

export function saveImage(id: string, blob: Blob): Promise<IDBValidKey> {
  return run(IMAGES, 'readwrite', s => s.put(blob, id), `save image ${id} (${blob.size} bytes)`);
}

export async function loadImage(id: string): Promise<Blob | null> {
  const value: unknown = await run(IMAGES, 'readonly', s => s.get(id), `load image ${id}`);
  return value instanceof Blob ? value : null;
}

export function deleteImage(id: string): Promise<undefined> {
  return run(IMAGES, 'readwrite', s => s.delete(id), `delete image ${id}`);
}

export function saveWorkspace(snapshot: object): Promise<IDBValidKey> {
  return run(WORKSPACE, 'readwrite', s => s.put(snapshot, WORKSPACE_KEY), 'save the workspace');
}

export function loadWorkspace(): Promise<unknown> {
  return run(WORKSPACE, 'readonly', s => s.get(WORKSPACE_KEY), 'load the saved workspace');
}

/** Remove the saved workspace and every stored image (templates are kept). */
export async function clearWorkspace(): Promise<void> {
  await run(WORKSPACE, 'readwrite', s => s.clear(), 'clear the saved workspace');
  await run(IMAGES, 'readwrite', s => s.clear(), 'clear stored images');
}

export function saveTemplate(id: string, template: object): Promise<IDBValidKey> {
  return run(TEMPLATES, 'readwrite', s => s.put(template, id), `save layout ${id}`);
}

export function loadTemplates(): Promise<unknown[]> {
  return run(TEMPLATES, 'readonly', s => s.getAll(), 'load saved layouts');
}

export function deleteTemplate(id: string): Promise<undefined> {
  return run(TEMPLATES, 'readwrite', s => s.delete(id), `delete layout ${id}`);
}
