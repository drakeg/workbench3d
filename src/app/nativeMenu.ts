import type { App, Command } from './app';
import { menuLabel } from './os';
import type { MenuItem as TauriMenuItem, Submenu as TauriSubmenu } from '@tauri-apps/api/menu';

/**
 * The macOS menu bar for the desktop app, in Apple's order:
 * Workbench3D, File, Edit, View, Draw, Tools, Add-ons, Window, Help.
 *
 * `buildMenuSpec` is pure (unit tested); `installNativeMenu` turns it into a real
 * menu with Tauri and keeps labels and enabled states in step with the app.
 */

export type MenuNode =
  | { type: 'command'; id: string; label: string; accelerator?: string }
  | { type: 'tool'; id: string; label: string; accelerator?: string }
  | { type: 'separator' }
  | { type: 'predefined'; item: 'Services' | 'Hide' | 'HideOthers' | 'ShowAll' | 'Minimize' | 'Maximize' | 'BringAllToFront' | 'Fullscreen' | 'Cut' | 'Copy' | 'Paste' | 'SelectAll'; text?: string }
  | { type: 'recent' };

export interface MenuSpec {
  title: string;
  role?: 'window' | 'help';
  items: MenuNode[];
}

/** "Mod+Shift+Z" -> "CmdOrCtrl+Shift+Z". Keys that would fire from inside text fields stay unbound. */
export function toAccelerator(shortcut?: string): string | undefined {
  if (!shortcut) return undefined;
  const parts = shortcut.split('+');
  const key = parts.pop()!;
  // Delete and paging keys are handled by the page itself; binding them would steal them from text fields
  if (/^(delete|backspace|pageup|pagedown|enter|escape)$/i.test(key)) return undefined;
  const mods = parts.map((p) => (p === 'Mod' ? 'CmdOrCtrl' : p === 'Ctrl' ? 'Control' : p === 'Alt' ? 'Option' : p));
  const k = key === '?' ? '/' : key.length === 1 ? key.toUpperCase() : key;
  if (key === '?' && !mods.includes('Shift')) mods.push('Shift');
  return [...mods, k].join('+');
}

// Edit items the system handles in text fields; we pick them up again as copy/cut/paste events.
const PREDEFINED_EDIT: Record<string, MenuNode> = {
  'edit.cut': { type: 'predefined', item: 'Cut' },
  'edit.copy': { type: 'predefined', item: 'Copy' },
  'edit.paste': { type: 'predefined', item: 'Paste' },
  'edit.selectAll': { type: 'predefined', item: 'SelectAll' },
};

export function buildMenuSpec(app: Pick<App, 'commands' | 'tools'>, toolMenus: Record<string, string[]>): MenuSpec[] {
  const byMenu = new Map<string, Command[]>();
  for (const c of app.commands.values()) {
    const m = c.menu ?? 'Tools';
    if (!byMenu.has(m)) byMenu.set(m, []);
    byMenu.get(m)!.push(c);
  }
  const cmdNodes = (menu: string, skip: string[] = []): MenuNode[] => {
    const out: MenuNode[] = [];
    for (const c of byMenu.get(menu) ?? []) {
      if (skip.includes(c.id)) continue;
      if (c.separatorBefore && out.length) out.push({ type: 'separator' });
      if (c.submenu) {
        if (c.id === 'file.openRecent') out.push({ type: 'recent' });
        continue;
      }
      out.push(PREDEFINED_EDIT[c.id] ?? { type: 'command', id: c.id, label: c.label, accelerator: toAccelerator(c.shortcut) });
    }
    return out;
  };
  const toolNodes = (menu: string): MenuNode[] =>
    (toolMenus[menu] ?? [])
      .map((id) => app.tools.get(id))
      .filter((t): t is NonNullable<typeof t> => !!t)
      .map((t) => ({ type: 'tool' as const, id: t.id, label: t.name, accelerator: toAccelerator(t.shortcut) }));

  const appCmds = cmdNodes('App').filter((n) => n.type === 'command');
  const about = appCmds.filter((n) => n.type === 'command' && n.id === 'help.about');
  const rest = appCmds.filter((n) => !(n.type === 'command' && n.id === 'help.about'));
  const appMenu: MenuNode[] = [
    ...about,
    { type: 'separator' },
    ...rest, // Settings… and anything an add-on puts in the app menu
    { type: 'separator' },
    { type: 'predefined', item: 'Services' },
    { type: 'separator' },
    { type: 'predefined', item: 'Hide', text: 'Hide Workbench3D' },
    { type: 'predefined', item: 'HideOthers' },
    { type: 'predefined', item: 'ShowAll' },
    { type: 'separator' },
    { type: 'command', id: 'app.quit', label: 'Quit Workbench3D', accelerator: 'CmdOrCtrl+Q' },
  ];

  // New, Open, Open Recent, then Close Window, Save, Duplicate, exports
  const file = cmdNodes('File');
  const ri = file.findIndex((n) => n.type === 'recent');
  file.splice(ri + 1, 0, { type: 'separator' }, { type: 'command', id: 'app.closeWindow', label: 'Close Window', accelerator: 'CmdOrCtrl+W' });

  const known = new Set(Object.values(toolMenus).flat());
  const extraTools = [...app.tools.values()].filter((t) => !known.has(t.id)).map((t) => ({ type: 'tool' as const, id: t.id, label: t.name, accelerator: toAccelerator(t.shortcut) }));

  return [
    { title: 'Workbench3D', items: appMenu },
    { title: 'File', items: file },
    { title: 'Edit', items: cmdNodes('Edit') },
    { title: 'View', items: [...cmdNodes('View'), { type: 'separator' }, { type: 'predefined', item: 'Fullscreen', text: 'Enter Full Screen' }] },
    { title: 'Draw', items: toolNodes('Draw') },
    { title: 'Tools', items: [...toolNodes('Tools'), ...extraTools, ...(byMenu.has('Tools') ? [{ type: 'separator' } as MenuNode, ...cmdNodes('Tools')] : [])] },
    ...(byMenu.has('Add-ons') ? [{ title: 'Add-ons', items: cmdNodes('Add-ons') }] : []),
    {
      title: 'Window',
      role: 'window',
      items: [
        { type: 'predefined', item: 'Minimize' },
        { type: 'predefined', item: 'Maximize', text: 'Zoom' },
        { type: 'separator' },
        { type: 'predefined', item: 'BringAllToFront' },
      ],
    },
    { title: 'Help', role: 'help', items: cmdNodes('Help') },
  ];
}

/** Build the real menu and keep it updated. Only call inside the desktop app on a Mac. */
export async function installNativeMenu(app: App, toolMenus: Record<string, string[]>, handlers: { quit: () => void; closeWindow: () => void; recent: () => { label: string; run: () => void; enabled?: boolean; separatorBefore?: boolean }[] }): Promise<void> {
  const { Menu, Submenu, MenuItem, PredefinedMenuItem } = await import('@tauri-apps/api/menu');
  const items = new Map<string, TauriMenuItem>();
  let recentMenu: TauriSubmenu | null = null;

  const make = async (n: MenuNode) => {
    if (n.type === 'separator') return PredefinedMenuItem.new({ item: 'Separator' });
    if (n.type === 'predefined') return PredefinedMenuItem.new({ item: n.item, text: n.text });
    if (n.type === 'recent') {
      recentMenu = await Submenu.new({ text: 'Open Recent', items: [] });
      return recentMenu;
    }
    const isTool = n.type === 'tool';
    const item = await MenuItem.new({
      id: `${n.type}:${n.id}`,
      text: menuLabel(n.label),
      accelerator: n.accelerator,
      action: () => {
        if (isTool) return app.setTool(n.id);
        if (n.id === 'app.quit') return handlers.quit();
        if (n.id === 'app.closeWindow') return handlers.closeWindow();
        // inside a text field, undo/redo edit the text, not the model
        const active = document.activeElement as HTMLElement | null;
        if (active && /INPUT|TEXTAREA/.test(active.tagName) && (n.id === 'edit.undo' || n.id === 'edit.redo')) {
          document.execCommand(n.id === 'edit.undo' ? 'undo' : 'redo');
          return;
        }
        app.runCommand(n.id);
      },
    });
    if (!isTool) items.set(n.id, item);
    return item;
  };

  const submenus = [];
  for (const spec of buildMenuSpec(app, toolMenus)) {
    const children = [];
    for (const n of spec.items) children.push(await make(n));
    const sub = await Submenu.new({ text: spec.title, items: children });
    if (spec.role === 'window') await sub.setAsWindowsMenuForNSApp();
    if (spec.role === 'help') await sub.setAsHelpMenuForNSApp();
    submenus.push(sub);
  }
  const menu = await Menu.new({ items: submenus });
  await menu.setAsAppMenu();

  // keep enabled states, state-following labels and Open Recent current
  let pending = 0;
  const refresh = () => {
    clearTimeout(pending);
    pending = window.setTimeout(async () => {
      for (const [id, item] of items) {
        const c = app.commands.get(id);
        if (!c) continue;
        await item.setEnabled(!c.enabled || c.enabled());
        if (c.dynamicLabel) await item.setText(menuLabel(c.dynamicLabel()));
      }
      const rm = recentMenu as TauriSubmenu | null;
      if (rm) {
        for (let i = (await rm.items()).length - 1; i >= 0; i--) await rm.removeAt(i);
        for (const r of handlers.recent()) {
          if (r.separatorBefore) await rm.append(await PredefinedMenuItem.new({ item: 'Separator' }));
          await rm.append(await MenuItem.new({ text: r.label, enabled: r.enabled !== false, action: r.run }));
        }
      }
    }, 120);
  };
  for (const ev of ['selection', 'change', 'context', 'tool', 'commands'] as const) app.on(ev, refresh);
  refresh();
}
