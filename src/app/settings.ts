import { store } from './platform';

/** App-wide preferences (not saved in models). Changes apply at once and sync across windows. */
export interface Settings {
  /** Units for new models. */
  units: 'imperial' | 'metric';
  fraction: number;
  mmDecimals: number;
  /** Reopen the last model on launch. */
  restoreSession: boolean;
  showWelcome: boolean;
  /** Two-finger scroll pans (pinch zooms), like Maps. Off: scroll zooms. */
  scrollPans: boolean;
  invertZoom: boolean;
  /** Right-drag orbits instead of panning. */
  rightDragOrbits: boolean;
  /** Windows only: 'system' | 'light' | 'dark'. On a Mac the system setting decides. */
  theme: 'system' | 'light' | 'dark';
}

export const defaultSettings: Settings = {
  units: 'imperial',
  fraction: 16,
  mmDecimals: 0,
  restoreSession: true,
  showWelcome: true,
  scrollPans: false,
  invertZoom: false,
  rightDragOrbits: false,
  theme: 'system',
};

const KEY = 'workbench3d.settings';
const listeners = new Set<(s: Settings) => void>();
let current: Settings = load();

function load(): Settings {
  try {
    return { ...defaultSettings, ...JSON.parse(store.get(KEY) ?? '{}') };
  } catch {
    return { ...defaultSettings };
  }
}

export function settings(): Settings {
  return current;
}

export function updateSettings(patch: Partial<Settings>): void {
  current = { ...current, ...patch };
  store.set(KEY, JSON.stringify(current));
  for (const fn of listeners) fn(current);
}

export function onSettings(fn: (s: Settings) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Another window (the Settings window on a Mac) changed them.
if (typeof window !== 'undefined')
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY) return;
    current = load();
    for (const fn of listeners) fn(current);
  });
