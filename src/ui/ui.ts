import * as THREE from 'three';
import { App, Command } from '../app/app';
import { kbd } from '../app/commands';
import { store } from '../app/platform';
import { Group } from '../core/document';
import { formatArea } from '../core/units';
import { icons } from '../tools/icons';
import { pickEntity } from '../tools/select';

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
  Draw: ['line', 'arc', 'rect', 'circle', 'polygon'],
  Tools: ['select', 'eraser', 'paint', 'pushpull', 'offset', 'move', 'rotate', 'scale', 'tape', 'dimension', 'section', 'orbit', 'pan', 'zoom'],
};
const TOOLBAR: string[][] = [
  ['select', 'eraser', 'paint'],
  ['line', 'arc', 'rect', 'circle', 'polygon'],
  ['pushpull', 'offset', 'move', 'rotate', 'scale'],
  ['tape', 'dimension', 'section'],
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
  private tagsEl!: HTMLElement;
  private scenesEl!: HTMLElement;
  private componentsEl!: HTMLElement;
  private sceneTabs!: HTMLElement;

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
    this.tagsEl = h('div', { class: 'section-body tags' });
    this.scenesEl = h('div', { class: 'section-body scenes' });
    this.componentsEl = h('div', { class: 'section-body components' });
    const panel = h('aside', { class: 'panel' }, [
      section('Entity Info', this.info),
      section('Materials', this.materials),
      section('Components', this.componentsEl, false),
      section('Tags', this.tagsEl, false),
      section('Scenes', this.scenesEl, false),
      section('Outliner', this.outliner),
    ]);
    this.sceneTabs = h('div', { class: 'scene-tabs' });
    stage.append(this.sceneTabs);

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
      if (this.ctxMenu && !this.ctxMenu.contains(e.target as Node)) this.closeContextMenu();
    });
    app.contextMenu = (x, y) => this.showContextMenu(x, y);

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
      this.renderTags();
      this.renderScenes();
      this.renderComponents();
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
    this.renderTags();
    this.renderScenes();
    this.renderComponents();
  }

  // ---------- tags ----------

  renderTags(): void {
    const app = this.app;
    const el = this.tagsEl;
    el.innerHTML = '';
    const counts = new Map<string, number>();
    for (const g of app.doc.root.walk()) if (g.tag) counts.set(g.tag, (counts.get(g.tag) ?? 0) + 1);
    for (const t of app.doc.tags) {
      const eye = h('button', { class: 'eye', type: 'button', title: t.visible ? 'Hide tag' : 'Show tag', html: t.visible ? '●' : '◌' });
      eye.onclick = () => app.doc.transact(t.visible ? 'Hide Tag' : 'Show Tag', () => (app.doc.tags.find((x) => x.name === t.name)!.visible = !t.visible));
      const del = h('button', { class: 'mini', type: 'button', title: 'Delete tag (parts become untagged)' }, ['×']);
      del.onclick = () =>
        app.doc.transact('Delete Tag', () => {
          app.doc.tags = app.doc.tags.filter((x) => x.name !== t.name);
          for (const g of app.doc.root.walk()) if (g.tag === t.name) g.tag = '';
        });
      el.append(h('div', { class: `ol-item${t.visible ? '' : ' hidden'}` }, [eye, h('span', { class: 'name' }, [t.name]), h('small', { class: 'muted' }, [String(counts.get(t.name) ?? 0)]), del]));
    }
    const add = h('button', { type: 'button', class: 'add' }, ['+ Add tag']);
    add.onclick = async () => {
      const name = await this.askName('New tag', 'Tag name', `Tag ${app.doc.tags.length + 1}`);
      if (!name || app.doc.tags.some((t) => t.name === name)) return;
      const groups = app.selectedGroups().map((g) => g.id);
      app.doc.transact('Add Tag', () => {
        app.doc.tags.push({ name, visible: true });
        // tag whatever is selected
        for (const id of groups) app.doc.findGroup(id)!.tag = name;
      });
    };
    if (!app.doc.tags.length) el.append(h('p', { class: 'muted' }, ['Tags show and hide groups of parts, like "Framing", "Cabinets" or "Electrical".']));
    el.append(h('div', { class: 'actions' }, [add]));
  }

  private async askName(title: string, label: string, value: string): Promise<string | null> {
    const { form } = await import('./dialogs');
    const v = await form(title, [{ name: 'n', label, type: 'text', value }], this.app.doc.units);
    const n = v ? String(v.n).trim() : '';
    return n || null;
  }

  // ---------- scenes ----------

  renderScenes(): void {
    const app = this.app;
    this.scenesEl.innerHTML = '';
    this.sceneTabs.innerHTML = '';
    app.doc.scenes.forEach((sc, i) => {
      const go = h('span', { class: 'name' }, [sc.name]);
      const item = h('div', { class: `ol-item${i === app.activeScene ? ' selected' : ''}` }, [go]);
      item.onclick = () => {
        app.goToScene(i);
        this.renderScenes();
      };
      const ren = h('button', { class: 'mini', type: 'button', title: 'Rename' }, ['✎']);
      ren.onclick = async (e) => {
        e.stopPropagation();
        const n = await this.askName('Rename scene', 'Name', sc.name);
        if (n) app.doc.transact('Rename Scene', () => (app.doc.scenes[i].name = n));
      };
      const del = h('button', { class: 'mini', type: 'button', title: 'Delete scene' }, ['×']);
      del.onclick = (e) => {
        e.stopPropagation();
        app.doc.transact('Delete Scene', () => app.doc.scenes.splice(i, 1));
        if (app.activeScene >= app.doc.scenes.length) app.activeScene = app.doc.scenes.length - 1;
      };
      item.append(ren, del);
      this.scenesEl.append(item);
      const tab = h('button', { type: 'button', class: i === app.activeScene ? 'active' : '' }, [sc.name]);
      tab.onclick = () => {
        app.goToScene(i);
        this.renderScenes();
      };
      this.sceneTabs.append(tab);
    });
    this.sceneTabs.style.display = app.doc.scenes.length ? 'flex' : 'none';
    const add = h('button', { type: 'button', class: 'add' }, ['+ Add scene']);
    add.onclick = () => app.runCommand('scene.add');
    const upd = h('button', { type: 'button' }, ['Update']);
    upd.onclick = () => app.runCommand('scene.update');
    if (!app.doc.scenes.length) this.scenesEl.append(h('p', { class: 'muted' }, ['Scenes save a camera view plus which tags are visible, like "Floor plan" or "Kitchen wall".']));
    this.scenesEl.append(h('div', { class: 'actions' }, [add, ...(app.activeScene >= 0 ? [upd] : [])]));
  }

  // ---------- components ----------

  renderComponents(): void {
    const app = this.app;
    const el = this.componentsEl;
    el.innerHTML = '';
    for (const c of app.doc.components) {
      const n = app.doc.instances(c.id).length;
      const place = h('button', { class: 'mini', type: 'button', title: 'Place another copy' }, ['+']);
      place.onclick = (e) => {
        e.stopPropagation();
        const src = app.doc.instances(c.id)[0];
        if (!src) return;
        const b = app.modelBounds();
        const copy = app.doc.transact('Place Component', () => {
          const d = app.doc.duplicateGroup(src);
          // put it beside the model, at ground level
          const wb = d.worldBounds();
          d.matrix.premultiply(new THREE.Matrix4().makeTranslation(b.max.x + 6 - wb.min.x, 0, -wb.min.z));
          d.parent?.remove(d);
          app.context.add(d);
          return d;
        });
        app.setSelection({ groups: [copy.id] });
        app.setTool('move');
      };
      const item = h('div', { class: 'ol-item' }, [h('span', { class: 'comp-icon', html: '◆' }), h('span', { class: 'name', title: c.description ?? '' }, [c.name]), h('small', { class: 'muted' }, [`×${n}`]), place]);
      item.onclick = () => {
        // select every instance in the current context
        const ids = app.context.children.filter((g) => g.componentId === c.id).map((g) => g.id);
        app.setSelection({ groups: ids });
      };
      el.append(item);
    }
    if (!app.doc.components.length) el.append(h('p', { class: 'muted' }, ['Components are reusable parts: edit one and every copy updates. Select something and press G.']));
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

  // ---------- right-click menu ----------

  private ctxMenu: HTMLElement | null = null;

  private closeContextMenu(): void {
    this.ctxMenu?.remove();
    this.ctxMenu = null;
  }

  showContextMenu(clientX: number, clientY: number): void {
    const app = this.app;
    this.closeContextMenu();
    const r = app.vp.dom.getBoundingClientRect();
    const p = pickEntity(app, { x: clientX - r.left, y: clientY - r.top }, true);
    // right-clicking something outside the selection selects it, like most apps
    if (p) {
      const sel = app.selection;
      const inSel = p.kind === 'face' ? sel.faces.has(p.id as number) : p.kind === 'edge' ? sel.edges.has(p.id as string) : sel.groups.has(p.id as number);
      if (!inSel) app.setSelection(p.kind === 'face' ? { faces: [p.id as number] } : p.kind === 'edge' ? { edges: [p.id as string] } : { groups: [p.id as number] });
    }
    const items: HTMLElement[] = [];
    let lastMenu = '';
    for (const c of app.commands.values()) {
      if (!c.context || (c.enabled && !c.enabled())) continue;
      if (lastMenu && c.menu !== lastMenu) items.push(h('hr'));
      lastMenu = c.menu ?? '';
      const b = h('button', { class: 'menu-item', type: 'button', role: 'menuitem' }, [h('span', {}, [c.label]), h('kbd', {}, [c.shortcut ? kbd(c.shortcut) : ''])]);
      b.onclick = () => {
        this.closeContextMenu();
        app.runCommand(c.id);
      };
      items.push(b);
    }
    if (!items.length) return;
    const menu = h('div', { class: 'menu-list context-menu', role: 'menu' }, items);
    document.body.append(menu);
    const mw = menu.offsetWidth;
    const mh = menu.offsetHeight;
    menu.style.left = `${Math.min(clientX, window.innerWidth - mw - 6)}px`;
    menu.style.top = `${Math.min(clientY, window.innerHeight - mh - 6)}px`;
    this.ctxMenu = menu;
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
      const def = app.doc.component(g.componentId);
      if (def) row('Component', `${def.name} (${app.doc.instances(def.id).length} in model)`);
      const tagSel = h('select', { 'aria-label': 'Tag' });
      tagSel.append(h('option', { value: '' }, ['Untagged']));
      for (const t of app.doc.tags) tagSel.append(h('option', { value: t.name }, [t.name]));
      tagSel.append(h('option', { value: '__new' }, ['New tag…']));
      tagSel.value = g.tag;
      tagSel.onchange = async () => {
        let v = tagSel.value;
        if (v === '__new') {
          const n = await this.askName('New tag', 'Tag name', `Tag ${app.doc.tags.length + 1}`);
          if (!n) return this.renderInfo();
          v = n;
        }
        app.doc.transact('Tag', () => {
          if (v && !app.doc.tags.some((t) => t.name === v)) app.doc.tags.push({ name: v, visible: true });
          app.doc.findGroup(g.id)!.tag = v;
        });
      };
      this.info.append(h('div', { class: 'kv stack' }, [h('span', {}, ['Tag']), tagSel]));
      const actions = h('div', { class: 'actions' });
      const edit = h('button', { type: 'button' }, ['Edit group']);
      edit.onclick = () => app.enterGroup(g.id);
      const explode = h('button', { type: 'button' }, ['Explode']);
      explode.onclick = () => app.runCommand('edit.explode');
      const hide = h('button', { type: 'button' }, ['Hide']);
      hide.onclick = () => app.runCommand('edit.hide');
      actions.append(edit, explode, hide);
      if (def && app.doc.instances(def.id).length > 1) {
        const uniq = h('button', { type: 'button' }, ['Make unique']);
        uniq.onclick = () => app.runCommand('edit.makeUnique');
        actions.append(uniq);
      } else if (!def) {
        const comp = h('button', { type: 'button' }, ['Make component']);
        comp.onclick = () => app.runCommand('edit.component');
        actions.append(comp);
      }
      this.info.append(actions);
      return;
    }

    if (app.selectedItems.size && !groups.length && !sel.faces.size && !sel.edges.size) {
      const ids = app.selectedItems;
      const n = (arr: { id: number }[]) => arr.filter((x) => ids.has(x.id)).length;
      const g2 = n(app.doc.guides);
      const d2 = n(app.doc.dimensions);
      const s2 = n(app.doc.sections);
      const bits = [g2 && `${g2} guide${g2 > 1 ? 's' : ''}`, d2 && `${d2} dimension${d2 > 1 ? 's' : ''}`, s2 && `${s2} section plane${s2 > 1 ? 's' : ''}`].filter(Boolean);
      this.info.append(h('p', {}, [bits.join(', ')]));
      const del = h('button', { type: 'button' }, ['Delete']);
      del.onclick = () => app.runCommand('edit.delete');
      const actions = h('div', { class: 'actions' }, [del]);
      if (s2) {
        const act = h('button', { type: 'button' }, ['Toggle cut']);
        act.onclick = () => app.runCommand('view.sectionCut');
        actions.append(act);
      }
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
        const label = h('span', { class: 'name' }, [c.componentId != null ? '◆ ' : '', c.name]);
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
