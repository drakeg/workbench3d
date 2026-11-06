import { exportOBJ, exportSTL } from '../core/export';
import { App, isMac } from './app';
import { FileTarget, openFile, saveFile, store } from './platform';
import { dialog, form } from '../ui/dialogs';
import { AddOnManager } from '../plugins/api';

const MODEL_FILTER = [{ name: 'Workbench3D model', extensions: ['wb3d'] }];
export const AUTOSAVE_KEY = 'workbench3d.autosave';

export function registerCommands(app: App, addOns: AddOnManager): void {
  let target: FileTarget | null = null;
  const baseName = () => app.fileName.replace(/\.wb3d$/i, '');
  const setName = (n: string) => {
    app.fileName = n;
    app.emit('change');
  };

  const confirmDiscard = async () => {
    if (!app.doc.dirty) return true;
    const r = await dialog('Unsaved changes', '<p>Your model has unsaved changes. Discard them?</p>', ['Cancel', 'Discard']);
    return r === 'Discard';
  };

  const save = async (as: boolean) => {
    const t = await saveFile(`${baseName()}.wb3d`, JSON.stringify(app.doc.toJSON(), null, 1), MODEL_FILTER, as ? null : target);
    if (!t) return;
    target = t.handle || t.path ? t : null;
    app.doc.dirty = false;
    setName(t.name);
    app.toast(`Saved ${t.name}`);
  };

  const cmds: Parameters<App['registerCommand']>[0][] = [
    // ----- File
    {
      id: 'file.new',
      label: 'New',
      menu: 'File',
      shortcut: 'Mod+N',
      run: async () => {
        if (!(await confirmDiscard())) return;
        app.doc.clear();
        app.contextId = 0;
        target = null;
        setName('Untitled');
        store.remove(AUTOSAVE_KEY);
        app.vp.setStandardView('iso', app.modelBounds());
      },
    },
    {
      id: 'file.open',
      label: 'Open…',
      menu: 'File',
      shortcut: 'Mod+O',
      run: async () => {
        if (!(await confirmDiscard())) return;
        const r = await openFile(MODEL_FILTER);
        if (!r) return;
        app.doc.load(r.text);
        app.contextId = 0;
        target = r.target.handle || r.target.path ? r.target : null;
        setName(r.target.name);
        app.vp.zoomExtents(app.modelBounds());
      },
    },
    { id: 'file.save', label: 'Save', menu: 'File', shortcut: 'Mod+S', run: () => save(false) },
    { id: 'file.saveAs', label: 'Save As…', menu: 'File', shortcut: 'Mod+Shift+S', run: () => save(true) },
    {
      id: 'file.exportSTL',
      label: 'Export STL (3D printing)…',
      menu: 'File',
      separatorBefore: true,
      run: async () => {
        const v = await form(
          'Export STL',
          [
            {
              name: 'unit',
              label: 'File units',
              type: 'select',
              value: 'mm',
              options: [
                { value: 'mm', label: 'Millimetres (most slicers)' },
                { value: 'in', label: 'Inches' },
              ],
            },
          ],
          app.doc.units,
          'Export',
        );
        if (!v) return;
        await saveFile(`${baseName()}.stl`, exportSTL(app.doc.root, v.unit as 'mm' | 'in'), [{ name: 'STL', extensions: ['stl'] }]);
      },
    },
    {
      id: 'file.exportOBJ',
      label: 'Export OBJ…',
      menu: 'File',
      run: () => saveFile(`${baseName()}.obj`, exportOBJ(app.doc.root, app.doc.units.system === 'metric' ? 'mm' : 'in'), [{ name: 'OBJ', extensions: ['obj'] }]).then(() => {}),
    },
    {
      id: 'file.exportPNG',
      label: 'Export Image (PNG)…',
      menu: 'File',
      run: async () => {
        const data = app.vp.screenshot();
        const bin = atob(data.split(',')[1]);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        await saveFile(`${baseName()}.png`, bytes.buffer, [{ name: 'PNG image', extensions: ['png'] }]);
      },
    },
    // ----- Edit
    { id: 'edit.undo', label: 'Undo', menu: 'Edit', shortcut: 'Mod+Z', run: () => app.doc.undo(), enabled: () => app.doc.canUndo() },
    { id: 'edit.redo', label: 'Redo', menu: 'Edit', shortcut: isMac ? 'Mod+Shift+Z' : 'Mod+Y', run: () => app.doc.redo(), enabled: () => app.doc.canRedo() },
    {
      id: 'edit.selectAll',
      label: 'Select All',
      menu: 'Edit',
      shortcut: 'Mod+A',
      separatorBefore: true,
      run: () => {
        const ctx = app.context;
        app.setSelection({ faces: ctx.mesh.faces.keys(), edges: ctx.mesh.allEdges().keys(), groups: ctx.children.filter((c) => !c.hidden).map((c) => c.id) });
      },
    },
    { id: 'edit.selectNone', label: 'Select None', menu: 'Edit', shortcut: 'Mod+Shift+A', run: () => app.clearSelection() },
    {
      id: 'edit.delete',
      label: 'Delete',
      menu: 'Edit',
      shortcut: 'Delete',
      enabled: () => !app.selectionEmpty(),
      run: () => {
        const sel = app.selection;
        const groups = app.selectedGroups();
        app.doc.transact('Delete', () => {
          app.context.mesh.erase(sel.faces, sel.edges);
          for (const g of groups) g.parent?.remove(g);
        });
        app.clearSelection();
      },
    },
    {
      id: 'edit.group',
      label: 'Make Group',
      menu: 'Edit',
      shortcut: 'Mod+G',
      separatorBefore: true,
      enabled: () => !app.selectionEmpty(),
      run: () => {
        const sel = app.selection;
        const mesh = app.context.mesh;
        // grouping faces brings their edges along; grouping just edges brings faces they bound
        const faces = new Set(sel.faces);
        const edges = new Set(sel.edges);
        for (const id of faces) {
          const f = mesh.faces.get(id);
          if (f) for (const k of mesh.faceEdgeKeys(f)) edges.add(k);
        }
        const groups = app.selectedGroups();
        const g = app.doc.transact('Make Group', () => app.doc.makeGroup(app.context, [...faces], [...edges].filter((k) => mesh.lines.has(k)), groups));
        app.setSelection({ groups: [g.id] });
      },
    },
    {
      id: 'edit.explode',
      label: 'Explode Group',
      menu: 'Edit',
      enabled: () => app.selection.groups.size > 0,
      run: () => {
        const groups = app.selectedGroups();
        const sel = { faces: [] as number[], edges: [] as string[], groups: [] as number[] };
        app.doc.transact('Explode', () => {
          for (const g of groups) {
            const r = app.doc.explode(g);
            sel.faces.push(...r.faces);
            sel.edges.push(...r.lines);
            sel.groups.push(...r.groups.map((x) => x.id));
          }
        });
        app.setSelection(sel);
      },
    },
    {
      id: 'edit.editGroup',
      label: 'Edit Group',
      menu: 'Edit',
      enabled: () => app.selection.groups.size === 1,
      run: () => app.enterGroup([...app.selection.groups][0]),
    },
    { id: 'edit.closeGroup', label: 'Close Group', menu: 'Edit', enabled: () => app.context !== app.doc.root, run: () => app.exitGroup() },
    {
      id: 'edit.hide',
      label: 'Hide',
      menu: 'Edit',
      separatorBefore: true,
      enabled: () => app.selection.groups.size > 0,
      run: () => {
        const ids = [...app.selection.groups];
        app.doc.transact('Hide', () => ids.forEach((id) => app.doc.findGroup(id) && (app.doc.findGroup(id)!.hidden = true)));
        app.clearSelection();
      },
    },
    {
      id: 'edit.unhideAll',
      label: 'Unhide All',
      menu: 'Edit',
      run: () => app.doc.transact('Unhide All', () => [...app.doc.root.walk()].forEach((g) => (g.hidden = false))),
    },
    // ----- View
    { id: 'view.extents', label: 'Zoom Extents', menu: 'View', shortcut: 'Shift+Z', run: () => app.vp.zoomExtents(app.modelBounds()) },
    ...(['iso', 'top', 'front', 'right', 'back', 'left', 'bottom'] as const).map((v, i) => ({
      id: `view.${v}`,
      label: `${v === 'iso' ? 'Iso' : v[0].toUpperCase() + v.slice(1)} View`,
      menu: 'View',
      separatorBefore: i === 0,
      shortcut: i < 6 ? `Mod+${i + 1}` : undefined,
      run: () => app.vp.setStandardView(v, app.modelBounds()),
    })),
    {
      id: 'view.perspective',
      label: 'Toggle Perspective / Parallel',
      menu: 'View',
      separatorBefore: true,
      run: () => {
        app.vp.perspective = !app.vp.perspective;
        app.vp.requestRender();
        app.toast(app.vp.perspective ? 'Perspective' : 'Parallel projection');
      },
    },
    {
      id: 'view.xray',
      label: 'Toggle X-Ray',
      menu: 'View',
      shortcut: 'Shift+X',
      run: () => {
        app.xray = !app.xray;
        app.refresh();
      },
    },
    { id: 'view.grid', label: 'Toggle Grid', menu: 'View', run: () => app.vp.setGridVisible(!app.vp.showGrid) },
    // ----- Window / settings
    {
      id: 'model.units',
      label: 'Units…',
      menu: 'View',
      separatorBefore: true,
      run: async () => {
        const v = await form(
          'Model units',
          [
            {
              name: 'system',
              label: 'Units',
              type: 'select',
              value: app.doc.units.system,
              options: [
                { value: 'imperial', label: 'Feet & inches' },
                { value: 'metric', label: 'Metric (mm)' },
              ],
            },
            {
              name: 'fraction',
              label: 'Imperial precision',
              type: 'select',
              value: String(app.doc.units.fraction),
              options: [2, 4, 8, 16, 32, 64].map((d) => ({ value: String(d), label: `1/${d}"` })),
            },
            {
              name: 'mmDecimals',
              label: 'Metric precision',
              type: 'select',
              value: String(app.doc.units.mmDecimals),
              options: [
                { value: '0', label: '1 mm' },
                { value: '1', label: '0.1 mm' },
                { value: '2', label: '0.01 mm' },
              ],
            },
          ],
          app.doc.units,
          'Apply',
        );
        if (!v) return;
        app.doc.transact('Units', () => {
          app.doc.units = { system: v.system as 'imperial' | 'metric', fraction: parseInt(String(v.fraction), 10), mmDecimals: parseInt(String(v.mmDecimals), 10) };
        });
        app.emit('selection');
      },
    },
    // ----- Add-ons
    {
      id: 'addons.manage',
      label: 'Add-on Manager…',
      menu: 'Add-ons',
      run: () => addOnManagerDialog(app, addOns),
    },
    // ----- Help
    { id: 'help.shortcuts', label: 'Keyboard Shortcuts', menu: 'Help', shortcut: 'Shift+?', run: () => shortcutsDialog(app) },
    {
      id: 'help.about',
      label: 'About Workbench3D',
      menu: 'Help',
      run: () =>
        dialog(
          'Workbench3D',
          `<p><b>Workbench3D ${__APP_VERSION__}</b>: an open-source push/pull 3D modeler for woodworking, welding and fabrication, home and RV interior design.</p>
           <p>MIT licensed. Contributions and add-ons are welcome.</p>
           <p><a href="https://github.com/drakeg/workbench3d" target="_blank" rel="noopener">github.com/drakeg/workbench3d</a></p>`,
        ),
    },
  ];
  for (const c of cmds) app.registerCommand(c);

  // keep an autosave so a closed tab or crash doesn't lose work
  let timer = 0;
  app.on('change', () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => store.set(AUTOSAVE_KEY, JSON.stringify({ name: app.fileName, doc: app.doc.toJSON() })), 800);
  });
}

function kbd(s: string): string {
  return s
    .replace('Mod', isMac ? '⌘' : 'Ctrl')
    .replace('Shift', isMac ? '⇧' : 'Shift')
    .replace('Alt', isMac ? '⌥' : 'Alt')
    .replace(/\+/g, isMac ? '' : '+');
}
export { kbd };

function shortcutsDialog(app: App): void {
  const rows: string[] = [];
  for (const t of app.tools.values()) if (t.shortcut) rows.push(`<tr><td>${t.name}</td><td><kbd>${t.shortcut}</kbd></td></tr>`);
  for (const c of app.commands.values()) if (c.shortcut) rows.push(`<tr><td>${c.label.replace('…', '')}</td><td><kbd>${kbd(c.shortcut)}</kbd></td></tr>`);
  const nav = [
    ['Orbit', isMac ? 'Middle-drag, or ⌥-drag' : 'Middle-drag, or Alt-drag'],
    ['Pan', isMac ? 'Right-drag, ⇧+middle-drag, or ⌥⇧-drag' : 'Right-drag, Shift+middle-drag, or Alt+Shift-drag'],
    ['Zoom', 'Scroll wheel / pinch'],
    ['Lock axis while drawing', '→ red, ← green, ↑ blue, ↓ unlock'],
    ['Copy while moving / rotating', isMac ? 'Tap ⌥ (Option)' : 'Tap Ctrl'],
    ['Exact value', 'Just type it (e.g. 24, 48 or 3/4) then Enter'],
  ];
  for (const [a, b] of nav) rows.push(`<tr><td>${a}</td><td>${b}</td></tr>`);
  dialog('Keyboard shortcuts', `<table class="shortcuts">${rows.join('')}</table>`, ['Close'], true);
}

function addOnManagerDialog(app: App, addOns: AddOnManager): void {
  const wrap = document.createElement('div');
  const render = () => {
    const saved = new Set(addOns.saved().map((s) => s.id));
    const rows = [...addOns.loaded.values()]
      .map(
        ({ addOn, builtin }) => `<tr>
          <td><b>${esc(addOn.name)}</b> <small>${esc(addOn.version ?? '')}</small><br><small>${esc(addOn.description ?? '')}</small></td>
          <td>${builtin ? '<span class="tag">built-in</span>' : saved.has(addOn.id) ? `<button data-remove="${esc(addOn.id)}">Remove</button>` : ''}</td>
        </tr>`,
      )
      .join('');
    wrap.innerHTML = `
      <p>Add-ons add tools and commands. They're plain JavaScript modules: see <code>docs/ADDONS.md</code> in the project for how to write one.</p>
      <p class="warn">Add-ons run with full access to the app and your model. Only load code you trust.</p>
      <table class="addons">${rows}</table>
      <p><button class="primary" data-load>Load add-on file…</button></p>`;
    wrap.querySelector<HTMLButtonElement>('[data-load]')!.onclick = async () => {
      const r = await openFile([{ name: 'JavaScript add-on', extensions: ['js', 'mjs'] }]);
      if (!r) return;
      try {
        const added = await addOns.install(r.text);
        app.toast(`Loaded ${added.map((a) => a.name).join(', ')}`);
        render();
      } catch (e) {
        app.toast(`Couldn't load add-on: ${(e as Error).message}`, 'error');
      }
    };
    wrap.querySelectorAll<HTMLButtonElement>('[data-remove]').forEach((b) => {
      b.onclick = () => {
        addOns.uninstall(b.dataset.remove!);
        app.toast('Removed. It will be gone after the app restarts.');
        render();
      };
    });
  };
  render();
  dialog('Add-on Manager', wrap, ['Close'], true);
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function restoreAutosave(app: App): boolean {
  const raw = store.get(AUTOSAVE_KEY);
  if (!raw) return false;
  try {
    const { name, doc } = JSON.parse(raw);
    if (!doc?.root || (doc.root.mesh.faces.length === 0 && doc.root.children.length === 0 && doc.root.mesh.lines.length === 0)) return false;
    app.doc.load(JSON.stringify(doc));
    app.doc.dirty = true;
    app.fileName = name ?? 'Untitled';
    return true;
  } catch {
    return false;
  }
}

