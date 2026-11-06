import { App } from '../app/app';
import { kbd } from '../app/commands';
import { isMac, isWindows, menuLabel } from '../app/os';
import { Settings, settings, updateSettings } from '../app/settings';

/**
 * Settings, laid out the way each OS does it:
 *  - Mac: a separate window (⌘,) with a tab per topic, grouped rows, labels as statements.
 *  - Windows: one page of cards with group headers, like Windows Settings.
 * Changes apply at once: there is no Save or Cancel.
 */

type Row =
  | { kind: 'toggle'; key: keyof Settings; label: string; help?: string }
  | { kind: 'choice'; key: keyof Settings; label: string; options: { value: string; label: string }[]; help?: string; number?: boolean };

interface Group {
  id: string;
  title: string;
  icon: string; // a small inline glyph for the Mac tab / Windows card
  rows: Row[];
}

function groups(): Group[] {
  const list: Group[] = [
    {
      id: 'general',
      title: 'General',
      icon: '⚙︎',
      rows: [
        {
          kind: 'choice',
          key: 'units',
          label: 'Units for new models',
          options: [
            { value: 'imperial', label: 'Feet and inches' },
            { value: 'metric', label: 'Millimetres' },
          ],
        },
        {
          kind: 'choice',
          key: 'fraction',
          label: 'Show inches to the nearest',
          number: true,
          options: [8, 16, 32, 64].map((d) => ({ value: String(d), label: `1/${d}"` })),
        },
        { kind: 'toggle', key: 'restoreSession', label: 'Reopen the last model when Workbench3D starts' },
        { kind: 'toggle', key: 'showWelcome', label: 'Show the quick-start tips' },
      ],
    },
    {
      id: 'navigation',
      title: 'Navigation',
      icon: '⟲',
      rows: [
        {
          kind: 'toggle',
          key: 'scrollPans',
          label: 'Two-finger scroll pans the view',
          help: 'Pinch to zoom. Turn this off to make scrolling zoom, like a mouse wheel.',
        },
        { kind: 'toggle', key: 'invertZoom', label: 'Reverse the zoom direction' },
        { kind: 'toggle', key: 'rightDragOrbits', label: 'Right-drag orbits instead of panning', help: 'Shift + right-drag still pans.' },
      ],
    },
  ];
  // Apple advises against an app-only appearance setting; Windows Settings offers one.
  if (isWindows)
    list.unshift({
      id: 'appearance',
      title: 'Appearance',
      icon: '◐',
      rows: [
        {
          kind: 'choice',
          key: 'theme',
          label: 'App theme',
          options: [
            { value: 'system', label: 'Use system setting' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ],
        },
      ],
    });
  return list;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function control(row: Row): HTMLElement {
  const s = settings();
  if (row.kind === 'toggle') {
    const input = el('input', 'switch');
    input.type = 'checkbox';
    input.setAttribute('role', 'switch');
    input.checked = !!s[row.key];
    input.setAttribute('aria-label', row.label);
    input.onchange = () => updateSettings({ [row.key]: input.checked } as Partial<Settings>);
    return input;
  }
  const sel = el('select');
  sel.setAttribute('aria-label', row.label);
  for (const o of row.options) {
    const opt = el('option', '', o.label);
    opt.value = o.value;
    sel.append(opt);
  }
  sel.value = String(s[row.key]);
  sel.onchange = () => updateSettings({ [row.key]: row.number ? Number(sel.value) : sel.value } as Partial<Settings>);
  return sel;
}

function shortcutsList(app: App): HTMLElement {
  const table = el('table', 'shortcuts');
  const add = (name: string, keys: string) => {
    const tr = el('tr');
    tr.append(el('td', '', menuLabel(name)), el('td', 'keys', keys));
    table.append(tr);
  };
  for (const t of app.tools.values()) if (t.shortcut) add(t.name, kbd(t.shortcut));
  for (const c of app.commands.values()) if (c.shortcut) add(c.label.replace('…', ''), kbd(c.shortcut));
  return table;
}

/** Render settings into a container. `tab` picks the Mac tab to show first. */
export function renderSettings(container: HTMLElement, app: App | null, startTab?: string): void {
  container.innerHTML = '';
  container.classList.add('settings', isMac ? 'settings-mac' : 'settings-cards');
  const all = groups();
  if (app) all.push({ id: 'shortcuts', title: 'Shortcuts', icon: '⌨︎', rows: [] });

  const body = el('div', 'settings-body');
  const renderGroup = (g: Group, target: HTMLElement) => {
    if (g.id === 'shortcuts' && app) {
      target.append(shortcutsList(app));
      return;
    }
    for (const r of g.rows) {
      const row = el('div', 'setting-row');
      const text = el('div', 'setting-text');
      text.append(el('div', 'setting-label', menuLabel(r.label)));
      if (r.help) text.append(el('div', 'setting-help', r.help));
      row.append(text, control(r));
      target.append(row);
    }
  };

  if (isMac) {
    // a tab per topic; the window title follows the tab
    const tabs = el('div', 'settings-tabs');
    tabs.setAttribute('role', 'tablist');
    const show = (id: string) => {
      body.innerHTML = '';
      const g = all.find((x) => x.id === id) ?? all[0];
      for (const b of tabs.querySelectorAll('button')) b.classList.toggle('active', b.dataset.id === g.id);
      const form = el('div', 'settings-form');
      renderGroup(g, form);
      body.append(form);
      document.title = g.title;
      try {
        localStorage.setItem('workbench3d.settingsTab', g.id);
      } catch {
        /* ignore */
      }
    };
    for (const g of all) {
      const b = el('button');
      b.type = 'button';
      b.dataset.id = g.id;
      b.setAttribute('role', 'tab');
      b.append(el('span', 'tab-icon', g.icon), el('span', '', g.title));
      b.onclick = () => show(g.id);
      tabs.append(b);
    }
    container.append(tabs, body);
    let last = startTab;
    try {
      last ??= localStorage.getItem('workbench3d.settingsTab') ?? undefined;
    } catch {
      /* ignore */
    }
    show(last ?? all[0].id);
  } else {
    // Windows Settings: a title, then group headers with a card per setting
    container.append(el('h1', 'settings-title', 'Settings'));
    for (const g of all) {
      body.append(el('h2', 'settings-group', menuLabel(g.title)));
      const cards = el('div', g.id === 'shortcuts' ? 'settings-card wide' : 'settings-cards-group');
      if (g.id === 'shortcuts') renderGroup(g, cards);
      else
        for (const r of g.rows) {
          const card = el('div', 'settings-card');
          card.append(el('span', 'card-icon', g.icon));
          const text = el('div', 'setting-text');
          text.append(el('div', 'setting-label', menuLabel(r.label)));
          if (r.help) text.append(el('div', 'setting-help', r.help));
          card.append(text, control(r));
          cards.append(card);
        }
      body.append(cards);
    }
    const about = el('div', 'settings-card');
    about.append(el('span', 'card-icon', 'ⓘ'));
    const t = el('div', 'setting-text');
    t.append(el('div', 'setting-label', 'Workbench3D'), el('div', 'setting-help', `Version ${__APP_VERSION__} · MIT License`));
    about.append(t);
    body.append(el('h2', 'settings-group', 'About'), about);
    container.append(body);
  }
}
