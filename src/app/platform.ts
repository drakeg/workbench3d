/**
 * File access that works in the browser and in the desktop app (Tauri).
 * In the browser it uses the File System Access API where available (Chrome, Edge),
 * and falls back to download / file input elsewhere (Safari, Firefox).
 */

export interface FileFilter {
  name: string;
  extensions: string[];
}

export const isDesktop = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** An open file we can save back to without asking again. */
export interface FileTarget {
  name: string;
  path?: string; // desktop
  handle?: FileSystemFileHandleLike; // browser
}

interface FileSystemFileHandleLike {
  name: string;
  createWritable(): Promise<{ write(data: BlobPart): Promise<void>; close(): Promise<void> }>;
  getFile(): Promise<File>;
}

type PickerWindow = Window & {
  showSaveFilePicker?: (o: unknown) => Promise<FileSystemFileHandleLike>;
  showOpenFilePicker?: (o: unknown) => Promise<FileSystemFileHandleLike[]>;
};

function pickerTypes(filters: FileFilter[]) {
  return filters.map((f) => ({
    description: f.name,
    accept: { 'application/octet-stream': f.extensions.map((e) => `.${e}`) },
  }));
}

export async function saveFile(
  suggestedName: string,
  data: string | ArrayBuffer,
  filters: FileFilter[],
  target?: FileTarget | null,
): Promise<FileTarget | null> {
  if (isDesktop) {
    const fs = await import('@tauri-apps/plugin-fs');
    let path = target?.path;
    if (!path) {
      const dialog = await import('@tauri-apps/plugin-dialog');
      path = (await dialog.save({ defaultPath: suggestedName, filters })) ?? undefined;
      if (!path) return null;
    }
    if (typeof data === 'string') await fs.writeTextFile(path, data);
    else await fs.writeFile(path, new Uint8Array(data));
    return { name: path.split(/[\\/]/).pop() ?? suggestedName, path };
  }
  const w = window as PickerWindow;
  if (target?.handle || w.showSaveFilePicker) {
    try {
      const handle = target?.handle ?? (await w.showSaveFilePicker!({ suggestedName, types: pickerTypes(filters) }));
      const writable = await handle.createWritable();
      await writable.write(data);
      await writable.close();
      return { name: handle.name, handle };
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') return null;
      // fall through to download (e.g. inside a sandboxed iframe)
    }
  }
  const blob = new Blob([data], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return { name: suggestedName };
}

export async function openFile(filters: FileFilter[]): Promise<{ target: FileTarget; text: string } | null> {
  if (isDesktop) {
    const dialog = await import('@tauri-apps/plugin-dialog');
    const fs = await import('@tauri-apps/plugin-fs');
    const path = await dialog.open({ multiple: false, directory: false, filters });
    if (!path || Array.isArray(path)) return null;
    const text = await fs.readTextFile(path);
    return { target: { name: path.split(/[\\/]/).pop() ?? 'model', path }, text };
  }
  const w = window as PickerWindow;
  if (w.showOpenFilePicker) {
    try {
      const [handle] = await w.showOpenFilePicker({ types: pickerTypes(filters), multiple: false });
      const file = await handle.getFile();
      return { target: { name: handle.name, handle }, text: await file.text() };
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') return null;
    }
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = filters.flatMap((f) => f.extensions.map((e) => `.${e}`)).join(',');
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      resolve({ target: { name: file.name }, text: await file.text() });
    };
    input.click();
  });
}

/** localStorage that never throws (it can be unavailable in some embeds and private modes). */
export const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* ignore quota / privacy errors */
    }
  },
  remove(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};
