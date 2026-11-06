import { describe, expect, it } from 'vitest';
import { kbd, menuLabel } from '../src/app/os';
import { buildMenuSpec, toAccelerator } from '../src/app/nativeMenu';

describe('menu labels', () => {
  it('Title Case on a Mac, sentence case on Windows', () => {
    expect(menuLabel('Zoom Extents', 'mac')).toBe('Zoom Extents');
    expect(menuLabel('Zoom Extents', 'windows')).toBe('Zoom extents');
    expect(menuLabel('Export STL (3D Printing)…', 'windows')).toBe('Export STL (3D printing)…');
    expect(menuLabel('About Workbench3D', 'windows')).toBe('About Workbench3D');
    expect(menuLabel('Push/Pull', 'windows')).toBe('Push/pull');
  });
});

describe('shortcut display', () => {
  it('uses Apple glyphs in Apple order', () => {
    expect(kbd('Mod+Shift+Z', 'mac')).toBe('⇧⌘Z');
    expect(kbd('Ctrl+Mod+I', 'mac')).toBe('⌃⌘I');
    expect(kbd('Delete', 'mac')).toBe('⌫');
    expect(kbd('Mod+,', 'mac')).toBe('⌘,');
  });
  it('spells keys out on Windows', () => {
    expect(kbd('Mod+Shift+Z', 'windows')).toBe('Ctrl+Shift+Z');
    expect(kbd('Delete', 'windows')).toBe('Del');
    expect(kbd('F2', 'windows')).toBe('F2');
    expect(kbd('PageDown', 'windows')).toBe('Page Down');
  });
});

describe('native Mac menu', () => {
  it('converts shortcuts and leaves text-field keys unbound', () => {
    expect(toAccelerator('Mod+Shift+Z')).toBe('CmdOrCtrl+Shift+Z');
    expect(toAccelerator('Ctrl+Mod+I')).toBe('Control+CmdOrCtrl+I');
    expect(toAccelerator('L')).toBe('L');
    expect(toAccelerator('Delete')).toBeUndefined();
    expect(toAccelerator('PageDown')).toBeUndefined();
    expect(toAccelerator('Shift+?')).toBe('Shift+/');
  });

  it("follows Apple's menu order with About first and the system items", () => {
    const run = () => {};
    const commands = new Map(
      [
        { id: 'app.settings', label: 'Settings…', menu: 'App', shortcut: 'Mod+,', run },
        { id: 'help.about', label: 'About Workbench3D', menu: 'App', run },
        { id: 'file.new', label: 'New Model', menu: 'File', shortcut: 'Mod+N', run },
        { id: 'file.openRecent', label: 'Open Recent', menu: 'File', run, submenu: () => [] },
        { id: 'file.save', label: 'Save', menu: 'File', shortcut: 'Mod+S', run },
        { id: 'edit.undo', label: 'Undo', menu: 'Edit', shortcut: 'Mod+Z', run },
        { id: 'edit.copy', label: 'Copy', menu: 'Edit', shortcut: 'Mod+C', run },
        { id: 'view.extents', label: 'Zoom Extents', menu: 'View', shortcut: 'Shift+Z', run },
        { id: 'help.help', label: 'Workbench3D Help', menu: 'Help', run },
      ].map((c) => [c.id, c]),
    );
    const tools = new Map([['line', { id: 'line', name: 'Line', shortcut: 'L' }]]);
    const spec = buildMenuSpec({ commands, tools } as never, { Draw: ['line'], Tools: [] });
    expect(spec.map((m) => m.title)).toEqual(['Workbench3D', 'File', 'Edit', 'View', 'Draw', 'Tools', 'Window', 'Help']);
    const app = spec[0].items;
    expect(app[0]).toMatchObject({ type: 'command', id: 'help.about' });
    expect(app[2]).toMatchObject({ type: 'command', id: 'app.settings', accelerator: 'CmdOrCtrl+,' });
    expect(app.some((n) => n.type === 'predefined' && n.item === 'Services')).toBe(true);
    expect(app[app.length - 1]).toMatchObject({ id: 'app.quit', accelerator: 'CmdOrCtrl+Q' });
    // Close Window right after Open Recent
    const file = spec[1].items;
    const ri = file.findIndex((n) => n.type === 'recent');
    expect(file[ri + 2]).toMatchObject({ id: 'app.closeWindow', accelerator: 'CmdOrCtrl+W' });
    // Copy is the system item so it works in text fields
    expect(spec[2].items).toContainEqual({ type: 'predefined', item: 'Copy' });
    expect(spec[6]).toMatchObject({ title: 'Window', role: 'window' });
    expect(spec[3].items.at(-1)).toMatchObject({ type: 'predefined', item: 'Fullscreen' });
  });
});
