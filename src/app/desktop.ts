import type { App } from './app';
import { recentFiles } from './commands';
import { installNativeMenu } from './nativeMenu';
import { isDesktopApp, isMac } from './os';
import { dialog } from '../ui/dialogs';

/**
 * Desktop-app behaviour that a browser tab can't have:
 *  - Mac: the native menu bar, a separate Settings window (⌘,), the document title.
 *  - Both: asking to save on close/quit only when there are unsaved changes, and
 *    opening .wb3d files from Finder / Explorer (double-click, "Open With", drag to the Dock).
 */

export async function setupDesktop(app: App, toolMenus: Record<string, string[]>): Promise<void> {
  if (!isDesktopApp) return;
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  const { invoke } = await import('@tauri-apps/api/core');
  const { listen } = await import('@tauri-apps/api/event');
  const win = getCurrentWindow();

  // ---- unsaved changes: ask once, Mac/Windows wording
  let closing = false;
  const confirmClose = async (): Promise<boolean> => {
    if (!app.doc.dirty) return true;
    const name = app.fileName.replace(/\.wb3d$/i, '');
    const choice = await dialog(
      isMac ? `Do you want to save the changes you made to “${name}”?` : `Save changes to ${name}?`,
      `<p>${isMac ? 'Your changes will be lost if you don’t save them.' : 'If you don’t save, your changes will be lost.'}</p>`,
      isMac ? ['Don’t Save', 'Cancel', 'Save…'] : ['Don’t save', 'Cancel', 'Save'],
    );
    if (!choice || choice === 'Cancel') return false;
    if (choice.startsWith('Save')) {
      await app.saveCurrent();
      return !app.doc.dirty; // the save dialog may have been cancelled
    }
    return true;
  };
  const closeWindow = async () => {
    if (closing) return;
    closing = true;
    try {
      if (await confirmClose()) {
        app.doc.dirty = false;
        await win.destroy();
      }
    } finally {
      closing = false;
    }
  };
  const quit = async () => {
    if (await confirmClose()) {
      app.doc.dirty = false;
      await invoke('exit_app');
    }
  };
  await win.onCloseRequested(async (e) => {
    if (!app.doc.dirty) return;
    e.preventDefault();
    await closeWindow();
  });
  // Quit from the Dock, the app menu, or logging out
  await listen('quit-requested', () => quit());

  // ---- files opened from Finder / Explorer
  const openAll = async (paths: string[]) => {
    const wb = paths.filter((p) => /\.wb3d$/i.test(p));
    if (wb[0]) await app.openFilePath(wb[0]);
  };
  await listen<string[]>('open-files', (e) => openAll(e.payload));
  try {
    await openAll(await invoke<string[]>('take_opened_files'));
  } catch {
    /* older shell without the command */
  }

  // ---- window title names the document; the Mac shows the edited dot itself
  const syncTitle = () => {
    win.setTitle(isMac ? app.fileName.replace(/\.wb3d$/i, '') : `${app.fileName.replace(/\.wb3d$/i, '')}${app.doc.dirty ? ' •' : ''} - Workbench3D`).catch(() => {});
  };
  app.on('change', syncTitle);
  syncTitle();

  // ---- Settings: its own window on a Mac
  if (isMac) {
    app.on('settings', async () => {
      const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
      const existing = await WebviewWindow.getByLabel('settings');
      if (existing) return existing.setFocus();
      new WebviewWindow('settings', {
        url: 'index.html?view=settings',
        title: 'General',
        width: 600,
        height: 440,
        resizable: false,
        minimizable: false,
        maximizable: false,
      });
    });
    document.documentElement.classList.add('native-menu');
    await installNativeMenu(app, toolMenus, {
      quit,
      closeWindow,
      recent: () => {
        const items: { label: string; run: () => void; enabled?: boolean; separatorBefore?: boolean }[] = recentFiles().map((r) => ({ label: r.name, run: () => app.openFilePath(r.path) }));
        items.push({
          label: 'Clear Menu',
          enabled: items.length > 0,
          separatorBefore: items.length > 0,
          run: () => {
            localStorage.setItem('workbench3d.recent', '[]');
            app.emit('commands');
          },
        });
        return items;
      },
    });
  }
}

/** Open .wb3d files dropped on the window (browser and desktop). */
export function enableFileDrop(app: App, target: HTMLElement): void {
  const isFileDrag = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes('Files');
  target.addEventListener('dragover', (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    target.classList.add('drop-target');
  });
  target.addEventListener('dragleave', () => target.classList.remove('drop-target'));
  target.addEventListener('drop', async (e) => {
    target.classList.remove('drop-target');
    if (!isFileDrag(e)) return;
    e.preventDefault();
    const file = [...(e.dataTransfer?.files ?? [])].find((f) => /\.wb3d$/i.test(f.name));
    if (!file) {
      app.toast('Drop a Workbench3D model (.wb3d) to open it.', 'error');
      return;
    }
    await app.openFileText(await file.text(), file.name);
  });
}
