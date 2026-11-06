import * as THREE from 'three';
import { App, Command } from '../app/app';
import { kbd } from '../app/commands';
import { store } from '../app/platform';
import { Group } from '../core/document';
import { formatArea } from '../core/units';
import { icons } from '../tools/icons';

export const MATERIALS: { name: string; color: string }[] = [
  { name: 'Pine', color: '#e3c58f' },
  { name: 'Oak', color: '#c8a26b' },
  { name: 'Maple', color: '#ecd9b0' },
  { name: 'Cherry', color: '#b5653f' },
  { name: 'Walnut', color: '#6b4a32' },
  { name: 'Plywood', color: '#d9bd8c' },
  { name: 'MDF', color: '#b89b77' },
  { name: 'Steel', color: '#8c949c' },
  { name: 'Aluminum', color: '#c9ced3' },
  { name: 'Black', color: '#2b2d31' },
  { name: 'White', color: '#f6f6f3' },
  { name: 'Red', color: '#c0392b' },
  { name: 'Blue', color: '#2e6db4' },
  { name: 'Green', color: '#4f8a4b' },
  { name: 'Countertop', color: '#9fa3a6' },
  { name: 'Default', color: '#f4f1ea' },
];

const MENU_ORDER = ['File', 'Edit', 'View', 'Draw', 'Tools', 'Add-ons', 'Help'];
const TOOL_MENUS: Record<string, string[]> = {
  Draw: ['line', 'rect', 'circle'],
  Tools: ['select', 'eraser', 'paint', 'pushpull', 'move', 'rotate', 'tape', 'orbit', 'pan', 'zoom'],
};
const TOOLBAR: string[][] = [
  ['select', 'eraser', 'paint'],
  ['line', 'rect', 'circle'],
  ['pushpull', 'move', 'rotate', 'tape'],
  ['orbit', 'pan', 'zoom'],
];

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, children: (Node | string)[] = []): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else e.setAttribute(k, v);
  }
  e.append(...children);
  return e;
}

/** Builds the application chrome around the viewport: menus, toolbar, panels and status bar. */
export class UI {
  private toolbar: HTMLElement;
  private menubar: HTMLElement;
  private info: HTMLElement;
  private outliner: HTMLElement;
  private materials: HTMLElement;
  private hintEl: HTMLElement;
  private vcbLabel: HTMLElement;
  private vcbInput: HTMLInputElement;
  private title: HTMLElement;
  private openMenu: HTMLElement | null = null;
  private crumbs: HTMLElement;

  constructor(private app: App, root: HTMLElement, stage: HTMLElement) {
    this.menubar = h('nav', { class: 'menubar', 'aria-label': 'Main menu' });
    this.title = h('div', { class: 'doc-title' });
    const logo = h('div', { class: 'logo', html: `${icons.board}<span>Workbench<b>3D</b></span>` });
    const topbar = h('header', { class: 'topbar' }, [logo, this.menubar, this.title]);

    this.toolbar = h('aside', { class: 'toolbar', 'aria-label': 'Tools' });
    this.crumbs = h('div', { class: 'crumbs' });
    stage.append(this.crumbs, h('div', { class: 'toasts' }));

    this.info = h('div', { class: 'section-body' });
    this.materials = h('div', { class: 'section-body swatches' });
    this.outliner = h('div', { class: 'section-body outliner' });
    const section = (title: string, body: HTMLElement, open = true) => {
      const d = h('details', open ? { open: '' } : {}, [h('summary', {}, [title]), body]);
      return d;
    };
    const panel = h('aside', { class: 'panel' }, [section('Entity Info', this.info), section('Materials', this.materials), section('Outliner', this.outliner)]);

    this.hintEl = h('div', { class: 'hint' });
    this.vcbLabel = h('label', { for: 'vcb' });
    this.vcbInput = h('input', { id: 'vcb', class: 'vcb', autocomplete: 'off', spellcheck: 'false' });
    const status = h('footer', { class: 'statusbar' }, [this.hintEl, h('div', { class: 'vcb-wrap' }, [this.vcbLabel, this.vcbInput])]);

    root.append(topbar, this.toolbar, stage, panel, status);

    this.vcbInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const text = this.vcbInput.value;
        this.vcbInput.value = '';
        this.vcbInput.blur();
        if (text.trim() && !(app.tool?.vcb?.(text, app) ?? false)) app.toast(`"${text}" isn't a value this tool can use`, 'error');
      } else if (e.key === 'Escape') this.vcbInput.blur();
    });
    this.vcbInput.addEventListener('focus', () => (this.vcbInput.value = app.vcbText));

    document.addEventListener('pointerdown', (e) => {
      if (this.openMenu && !this.menubar.contains(e.target as Node)) this.closeMenu();
    });

    app.on('tool', () => {
      this.renderToolbar();
      this.renderMenus();
    });
    app.on('commands', () => this.renderMenus());
    app.on('selection', () => {
      this.renderInfo();
      this.renderOutliner();
      this.renderMaterials();
    });
    app.on('change', () => {
      this.renderInfo();
      this.renderOutliner();
      this.renderTitle();
    });
    app.on('context', () => {
      this.renderOutliner();
      this.renderCrumbs();
      this.renderInfo();
    });
    app.on('hint', () => (this.hintEl.textContent = app.hint));
    app.on('vcb', () => this.renderVCB());

    this.renderToolbar();
    this.renderMenus();
    this.renderInfo();
    this.renderMaterials();
    this.renderOutliner();
    this.renderTitle();
    this.renderCrumbs();
    this.renderVCB();
  }

  // ---------- menus ----------

  private closeMenu(): void {
    this.openMenu?.classList.remove('open');
    this.openMenu = null;
  }

  renderMenus(): void {
    this.menubar.innerHTML = '';
    const byMenu = new Map<string, Command[]>();
    for (const c of this.app.commands.values()) {
      const m = c.menu ?? 'Tools';
      if (!byMenu.has(m)) byMenu.set(m, []);
      byMenu.get(m)!.push(c);
    }
    const toolMenus = new Map<string, string[]>(Object.entries(TOOL_MENUS));
    // add-on tools go in the Tools menu
    const known = new Set(Object.values(TOOL_MENUS).flat());
    for (const t of this.app.tools.values()) if (!known.has(t.id)) toolMenus.get('Tools')!.push(t.id);

    for (const name of MENU_ORDER) {
      const items: HTMLElement[] = [];
      for (const id of toolMenus.get(name) ?? []) {
        const t = this.app.tools.get(id);
        if (!t) continue;
        const b = h('button', { class: 'menu-item', type: 'button', role: 'menuitem' }, [h('span', {}, [t.name]), h('kbd', {}, [t.shortcut ?? ''])]);
        b.onclick = () => {
          this.closeMenu();
          this.app.setTool(t.id);
        };
        items.push(b);
      }
      for (const c of byMenu.get(name) ?? []) {
        if (c.separatorBefore && items.length) items.push(h('hr'));
        const b = h('button', { class: 'menu-item', type: 'button', role: 'menuitem' }, [h('span', {}, [c.label]), h('kbd', {}, [c.shortcut ? kbd(c.shortcut) : ''])]);
        b.onclick = () => {
          this.closeMenu();
          this.app.runCommand(c.id);
        };
        b.dataset.cmd = c.id;
        items.push(b);
      }
      if (!items.length) continue;
      const list = h('div', { class: 'menu-list', role: 'menu' }, items);
      const btn = h('button', { class: 'menu-btn', type: 'button', 'aria-haspopup': 'true' }, [name]);
      const wrap = h('div', { class: 'menu' }, [btn, list]);
      const open = () => {
        // refresh enabled state when opening
        list.querySelectorAll<HTMLButtonElement>('[data-cmd]').forEach((el) => {
          const c = this.app.commands.get(el.dataset.cmd!);
          el.disabled = !!(c?.enabled && !c.enabled());
        });
        this.closeMenu();
        wrap.classList.add('open');
        this.openMenu = wrap;
      };
      btn.onclick = () => (this.openMenu === wrap ? this.closeMenu() : open());
      btn.onpointerenter = () => {
        if (this.openMenu && this.openMenu !== wrap) open();
      };
      this.menubar.append(wrap);
    }
  }

  // ---------- toolbar ----------

  renderToolbar(): void {
    this.toolbar.innerHTML = '';
    const groups = TOOLBAR.map((g) => [...g]);
    const known = new Set(groups.flat());
    const extra = [...this.app.tools.values()].filter((t) => !known.has(t.id) && t.icon).map((t) => t.id);
    if (extra.length) groups.push(extra);
    for (const g of groups) {
      const div = h('div', { class: 'tool-group' });
      for (const id of g) {
        const t = this.app.tools.get(id);
        if (!t) continue;
        const b = h('button', {
          class: `tool-btn${this.app.tool?.id === id ? ' active' : ''}`,
          type: 'button',
          title: `${t.name}${t.shortcut ? ` (${t.shortcut})` : ''}`,
          'aria-label': t.name,
          html: t.icon ?? `<span>${t.name[0]}</span>`,
        });
        b.onclick = () => this.app.setTool(id);
        div.append(b);
      }
      this.toolbar.append(div);
    }
    const ext = h('button', { class: 'tool-btn', type: 'button', title: 'Zoom Extents (Shift+Z)', 'aria-label': 'Zoom Extents', html: icons.extents });
    ext.onclick = () => this.app.runCommand('view.extents');
    this.toolbar.append(h('div', { class: 'tool-group' }, [ext]));
  }

  // ---------- status ----------

  renderVCB(): void {
    this.vcbLabel.textContent = this.app.vcbLabel;
    if (document.activeElement !== this.vcbInput) {
      this.vcbInput.value = this.app.vcbText || '';
      this.vcbInput.placeholder = this.app.vcbValue;
    }
    this.vcbInput.classList.toggle('typing', !!this.app.vcbText);
  }

  renderTitle(): void {
    this.title.textContent = `${this.app.fileName}${this.app.doc.dirty ? ' •' : ''}`;
    document.title = `${this.app.fileName} – Workbench3D`;
  }

  renderCrumbs(): void {
    this.crumbs.innerHTML = '';
    const path: Group[] = [];
    for (let g: Group | null = this.app.context; g; g = g.parent) path.unshift(g);
    if (path.length < 2) {
      this.crumbs.style.display = 'none';
      return;
    }
    this.crumbs.style.display = 'flex';
    path.forEach((g, i) => {
      const b = h('button', { type: 'button' }, [g.name]);
      b.onclick = () => this.app.enterGroup(g.id);
      if (i) this.crumbs.append(h('span', {}, ['›']));
      this.crumbs.append(b);
    });
    const done = h('button', { type: 'button', class: 'done' }, ['Close group (Esc)']);
    done.onclick = () => this.app.exitGroup();
    this.crumbs.append(done);
  }

  // ---------- entity info ----------

  renderInfo(): void {
    const app = this.app;
    const u = app.doc.units;
    const sel = app.selection;
    const ctx = app.context;
    this.info.innerHTML = '';
    const row = (k: string, v: string | Node) => this.info.append(h('div', { class: 'kv' }, [h('span', {}, [k]), typeof v === 'string' ? h('b', {}, [v]) : v]));

    const groups = app.selectedGroups();
    if (app.selectionEmpty()) {
      let faces = 0;
      let gcount = 0;
      for (const g of app.doc.root.walk()) {
        faces += g.mesh.faces.size;
        if (g !== app.doc.root) gcount++;
      }
      this.info.append(h('p', { class: 'muted' }, ['Nothing selected.']));
      row('Faces', String(faces));
      row('Groups', String(gcount));
      row('Units', u.system === 'imperial' ? `Inches (1/${u.fraction}")` : 'Millimetres');
      return;
    }

    if (groups.length === 1 && !sel.faces.size && !sel.edges.size) {
      const g = groups[0];
      const name = h('input', { value: g.name, 'aria-label': 'Group name' });
      name.onchange = () => {
        const v = name.value.trim() || 'Group';
        app.doc.transact('Rename', () => (app.doc.findGroup(g.id)!.name = v));
      };
      this.info.append(h('div', { class: 'kv stack' }, [h('span', {}, ['Group name']), name]));
      const size = g.localBounds().getSize(new THREE.Vector3());
      // sort as thickness × width × length for cut lists
      const dims = [size.x, size.y, size.z];
      row('R × G × B', dims.map((d) => app.fmt(d)).join(' × '));
      const sorted = [...dims].sort((a, b) => a - b);
      row('T × W × L', sorted.map((d) => app.fmt(d)).join(' × '));
      let area = 0;
      for (const d of g.walk()) for (const f of d.mesh.faces.values()) area += d.mesh.area(f);
      row('Surface area', formatArea(area, u));
      for (const [k, v] of Object.entries(g.attributes)) row(k, String(v));
      const actions = h('div', { class: 'actions' });
      const edit = h('button', { type: 'button' }, ['Edit group']);
      edit.onclick = () => app.enterGroup(g.id);
      const explode = h('button', { type: 'button' }, ['Explode']);
      explode.onclick = () => app.runCommand('edit.explode');
      const hide = h('button', { type: 'button' }, ['Hide']);
      hide.onclick = () => app.runCommand('edit.hide');
      actions.append(edit, explode, hide);
      this.info.append(actions);
      return;
    }

    const parts: string[] = [];
    if (groups.length) parts.push(`${groups.length} group${groups.length > 1 ? 's' : ''}`);
    if (sel.faces.size) parts.push(`${sel.faces.size} face${sel.faces.size > 1 ? 's' : ''}`);
    if (sel.edges.size) parts.push(`${sel.edges.size} edge${sel.edges.size > 1 ? 's' : ''}`);
    this.info.append(h('p', {}, [parts.join(', ')]));
    const m = ctx.worldMatrix();
    if (sel.faces.size) {
      let area = 0;
      for (const id of sel.faces) {
        const f = ctx.mesh.faces.get(id);
        if (f) area += ctx.mesh.area(f);
      }
      row('Area', formatArea(area, u));
    }
    if (sel.edges.size) {
      let len = 0;
      for (const k of sel.edges) {
        const [a, b] = k.split(':').map(Number);
        if (ctx.mesh.verts.has(a) && ctx.mesh.verts.has(b)) len += ctx.mesh.v(a).clone().applyMatrix4(m).distanceTo(ctx.mesh.v(b).clone().applyMatrix4(m));
      }
      row(sel.edges.size === 1 ? 'Length' : 'Total length', app.fmt(len));
    }
    if (sel.faces.size || sel.edges.size) {
      const actions = h('div', { class: 'actions' });
      const grp = h('button', { type: 'button' }, ['Make group']);
      grp.onclick = () => app.runCommand('edit.group');
      actions.append(grp);
      this.info.append(actions);
    }
  }

  // ---------- materials ----------

  renderMaterials(): void {
    this.materials.innerHTML = '';
    for (const m of MATERIALS) {
      const b = h('button', { class: `swatch${this.app.paintColor === m.color ? ' active' : ''}`, type: 'button', title: m.name, style: `--sw:${m.color}` });
      b.onclick = () => {
        this.app.paintColor = m.color;
        if (this.app.tool?.id !== 'paint') this.app.setTool('paint');
        this.renderMaterials();
      };
      this.materials.append(b);
    }
    const custom = h('input', { type: 'color', value: this.app.paintColor, title: 'Custom colour', 'aria-label': 'Custom colour' });
    custom.oninput = () => {
      this.app.paintColor = custom.value;
      if (this.app.tool?.id !== 'paint') this.app.setTool('paint');
    };
    this.materials.append(custom);
  }

  // ---------- outliner ----------

  renderOutliner(): void {
    this.outliner.innerHTML = '';
    const app = this.app;
    const build = (g: Group, depth: number) => {
      for (const c of g.children) {
        const selected = app.selection.groups.has(c.id);
        const editing = app.context === c;
        const eye = h('button', { class: 'eye', type: 'button', title: c.hidden ? 'Show' : 'Hide', html: c.hidden ? '◌' : '●' });
        eye.onclick = (e) => {
          e.stopPropagation();
          app.doc.transact(c.hidden ? 'Show' : 'Hide', () => (app.doc.findGroup(c.id)!.hidden = !c.hidden));
        };
        const label = h('span', { class: 'name' }, [c.name]);
        const item = h('div', { class: `ol-item${selected ? ' selected' : ''}${editing ? ' editing' : ''}${c.hidden ? ' hidden' : ''}`, style: `padding-left:${8 + depth * 14}px` }, [eye, label]);
        item.onclick = () => {
          if (c.parent && app.context !== c.parent) app.enterGroup(c.parent.id);
          app.setSelection({ groups: [c.id] });
        };
        item.ondblclick = () => app.enterGroup(c.id);
        this.outliner.append(item);
        build(c, depth + 1);
      }
    };
    build(app.doc.root, 0);
    if (!app.doc.root.children.length) this.outliner.append(h('p', { class: 'muted' }, ['Groups you make appear here.']));
  }

  /** First-run quick start card. */
  welcome(stage: HTMLElement): void {
    if (store.get('workbench3d.welcomed')) return;
    const card = h('div', {
      class: 'welcome',
      html: `
      <h2>Welcome to Workbench3D</h2>
      <ol>
        <li>Press <kbd>R</kbd> and click twice on the ground to draw a rectangle. Type <kbd>24, 48</kbd> then Enter for exact sizes.</li>
        <li>Press <kbd>P</kbd>, click the rectangle, move up and click to push/pull it into a solid.</li>
        <li>Select it all (<kbd>${kbd('Mod+A')}</kbd>) and make a group (<kbd>${kbd('Mod+G')}</kbd>) so it stays a separate part.</li>
        <li>Orbit with middle-drag or ${navigator.platform.includes('Mac') ? '⌥' : 'Alt'}-drag, pan with right-drag, scroll to zoom.</li>
      </ol>
      <p>Try <b>Add-ons → Insert Lumber</b> or <b>Insert Steel</b> for ready-made parts, and <b>Cut List</b> when you're done.</p>`,
    });
    const ok = h('button', { class: 'primary', type: 'button' }, ['Got it']);
    ok.onclick = () => {
      store.set('workbench3d.welcomed', '1');
      card.remove();
    };
    card.append(ok);
    stage.append(card);
  }
}
