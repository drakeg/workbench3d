/**
 * Which operating system we're on, and the small conventions that differ between them:
 * how shortcuts are written, how menu labels are cased, which keys mean what.
 *
 * Add `?platform=mac` or `?platform=windows` to the URL to preview another OS's
 * conventions in the browser (used by the end-to-end tests too).
 */
export type OS = 'mac' | 'windows' | 'linux';

function detect(): OS {
  if (typeof navigator === 'undefined') return 'linux';
  try {
    const forced = new URLSearchParams(location.search).get('platform');
    if (forced === 'mac' || forced === 'windows' || forced === 'linux') return forced;
  } catch {
    /* no location (tests) */
  }
  const s = `${navigator.platform || ''} ${navigator.userAgent}`;
  if (/Mac|iPhone|iPad/.test(s)) return 'mac';
  if (/Win/.test(s)) return 'windows';
  return 'linux';
}

export const os: OS = detect();
export const isMac = os === 'mac';
export const isWindows = os === 'windows';
export const isDesktopApp = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** Words that keep their capitals in Windows sentence case. */
const KEEP = /^(Workbench3D|STL|OBJ|PNG|CSV|3D|2D|PR|X|Y|Z|I)$/;

/**
 * Mac menus use Title Case ("Zoom Extents"); Windows uses sentence case ("Zoom extents").
 * Labels are written in Title Case and converted here.
 */
export function menuLabel(label: string, target: OS = os): string {
  if (target !== 'windows') return label;
  let first = true;
  return label.replace(/[A-Za-z0-9]+/g, (w) => {
    if (first) {
      first = false;
      return w;
    }
    if (KEEP.test(w) || /[0-9]/.test(w) || w === w.toUpperCase()) return w;
    return w[0].toLowerCase() + w.slice(1);
  });
}

const MAC_KEYS: Record<string, string> = {
  delete: '⌫',
  backspace: '⌫',
  enter: '↩',
  escape: '⎋',
  space: 'Space',
  pageup: '⇞',
  pagedown: '⇟',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
  ',': ',',
};
const WIN_KEYS: Record<string, string> = {
  delete: 'Del',
  backspace: 'Backspace',
  pageup: 'Page Up',
  pagedown: 'Page Down',
  space: 'Space',
  escape: 'Esc',
};

/** Show a shortcut like "Mod+Shift+Z" the way this OS writes it: ⇧⌘Z or Ctrl+Shift+Z. */
export function kbd(shortcut: string, target: OS = os): string {
  const parts = shortcut.split('+');
  let key = parts.pop()!;
  if (key === '' && shortcut.endsWith('+')) key = '+';
  const mods = new Set(parts.map((p) => p.toLowerCase()));
  const lk = key.toLowerCase();
  if (target === 'mac') {
    // Apple's order: Control, Option, Shift, Command
    let out = '';
    if (mods.has('ctrl')) out += '⌃';
    if (mods.has('alt')) out += '⌥';
    if (mods.has('shift')) out += '⇧';
    if (mods.has('mod')) out += '⌘';
    return out + (MAC_KEYS[lk] ?? (key.length === 1 ? key.toUpperCase() : key));
  }
  const names: string[] = [];
  if (mods.has('mod') || mods.has('ctrl')) names.push('Ctrl');
  if (mods.has('alt')) names.push('Alt');
  if (mods.has('shift')) names.push('Shift');
  names.push(WIN_KEYS[lk] ?? (key.length === 1 ? key.toUpperCase() : key));
  return names.join('+');
}

/** Tooltip text: "Push/Pull (P)" on every OS. */
export function withShortcut(name: string, shortcut?: string): string {
  return shortcut ? `${name} (${kbd(shortcut)})` : name;
}
