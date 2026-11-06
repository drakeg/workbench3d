import * as THREE from 'three';
import type { App } from '../app/app';
import { Group } from '../core/document';
import { parseEdgeKey } from '../core/mesh';
import { icons } from './icons';
import { Tool, ToolEvent } from './tool';

interface Picked {
  kind: 'face' | 'edge' | 'group';
  id: number | string;
  group?: Group;
}

/** Pick what's under the cursor in the current editing context. Clicking outside the context steps out of it. */
export function pickEntity(app: App, e: { x: number; y: number }, allowExit = true): Picked | null {
  const edge = app.pickEdge(e.x, e.y);
  const hit = app.vp.raycastFaces(app.vp.ray(e.x, e.y));
  if (edge && (!hit || app.entityFor(hit.group)?.kind !== 'group')) return { kind: 'edge', id: edge };
  if (!hit) return null;
  let ent = app.entityFor(hit.group);
  while (!ent && allowExit && app.context.parent) {
    app.exitGroup();
    ent = app.entityFor(hit.group);
  }
  if (!ent) return null;
  if (ent.kind === 'raw') return { kind: 'face', id: hit.faceId };
  return { kind: 'group', id: ent.group.id, group: ent.group };
}

function setHover(app: App, p: Picked | null): void {
  const hf = p?.kind === 'face' ? { groupId: app.context.id, faceId: p.id as number } : null;
  const hg = p?.kind === 'group' ? (p.id as number) : null;
  const same = (hf?.faceId ?? null) === (app.hoverFace?.faceId ?? null) && hg === app.hoverGroup;
  if (same) return;
  app.hoverFace = hf;
  app.hoverGroup = hg;
  app.refresh();
}

/** All faces and edges connected to a starting face/edge through shared edges. */
export function connected(app: App, start: Picked): { faces: number[]; edges: string[] } {
  const mesh = app.context.mesh;
  const faces = new Set<number>();
  const edges = new Set<string>();
  const queueE: string[] = [];
  if (start.kind === 'face') {
    const f = mesh.faces.get(start.id as number);
    if (f) {
      faces.add(f.id);
      queueE.push(...mesh.faceEdgeKeys(f));
    }
  } else if (start.kind === 'edge') queueE.push(start.id as string);
  const vertexEdges = new Map<number, string[]>();
  for (const [k, [a, b]] of mesh.allEdges()) {
    (vertexEdges.get(a) ?? vertexEdges.set(a, []).get(a)!).push(k);
    (vertexEdges.get(b) ?? vertexEdges.set(b, []).get(b)!).push(k);
  }
  while (queueE.length) {
    const k = queueE.pop()!;
    if (edges.has(k)) continue;
    edges.add(k);
    for (const f of mesh.facesUsingEdge(k)) {
      if (!faces.has(f.id)) {
        faces.add(f.id);
        queueE.push(...mesh.faceEdgeKeys(f));
      }
    }
    for (const v of parseEdgeKey(k)) for (const k2 of vertexEdges.get(v) ?? []) if (!edges.has(k2)) queueE.push(k2);
  }
  return { faces: [...faces], edges: [...edges] };
}

export class SelectTool implements Tool {
  id = 'select';
  name = 'Select';
  icon = icons.select;
  shortcut = 'Space';
  cursor = 'default';
  hint = 'Click to select. Shift-click to add/remove. Drag left→right to window-select, right→left to cross-select. Double-click a group to edit it.';
  private down: { x: number; y: number } | null = null;
  private dragging = false;
  private box: HTMLDivElement | null = null;
  private clicks: { t: number; x: number; y: number; n: number } = { t: 0, x: 0, y: 0, n: 0 };

  pointerDown(e: ToolEvent): void {
    this.down = { x: e.x, y: e.y };
    this.dragging = false;
  }

  pointerMove(e: ToolEvent, app: App): void {
    if (this.down) {
      if (!this.dragging && Math.hypot(e.x - this.down.x, e.y - this.down.y) > 4) {
        this.dragging = true;
        this.box = document.createElement('div');
        this.box.className = 'select-box';
        app.container.append(this.box);
      }
      if (this.dragging && this.box) {
        const x0 = Math.min(this.down.x, e.x);
        const y0 = Math.min(this.down.y, e.y);
        Object.assign(this.box.style, {
          left: `${x0}px`,
          top: `${y0}px`,
          width: `${Math.abs(e.x - this.down.x)}px`,
          height: `${Math.abs(e.y - this.down.y)}px`,
        });
        this.box.classList.toggle('crossing', e.x < this.down.x);
      }
      return;
    }
    setHover(app, pickEntity(app, e, false));
  }

  pointerUp(e: ToolEvent, app: App): void {
    if (!this.down) return;
    const start = this.down;
    this.down = null;
    if (this.dragging) {
      this.dragging = false;
      this.box?.remove();
      this.box = null;
      this.boxSelect(app, start.x, start.y, e.x, e.y, e.shift);
      return;
    }
    // count rapid clicks for double/triple click
    const now = performance.now();
    const c = this.clicks;
    c.n = now - c.t < 400 && Math.hypot(e.x - c.x, e.y - c.y) < 6 ? c.n + 1 : 1;
    Object.assign(c, { t: now, x: e.x, y: e.y });

    const p = pickEntity(app, e);
    if (c.n >= 3 && p && p.kind !== 'group') {
      const { faces, edges } = connected(app, p);
      app.setSelection({ faces, edges });
      return;
    }
    if (c.n === 2) return; // handled by doubleClick
    const sel = app.selection;
    if (!p) {
      const item = app.pickItem(e.x, e.y);
      if (item !== null) {
        if (e.shift) {
          if (app.selectedItems.has(item)) app.selectedItems.delete(item);
          else app.selectedItems.add(item);
          app.setSelection({ ...sel, items: app.selectedItems });
        } else app.setSelection({ items: [item] });
        return;
      }
      if (!e.shift) app.clearSelection();
      return;
    }
    if (!e.shift) {
      app.setSelection(p.kind === 'face' ? { faces: [p.id as number] } : p.kind === 'edge' ? { edges: [p.id as string] } : { groups: [p.id as number] });
      return;
    }
    const set = (p.kind === 'face' ? sel.faces : p.kind === 'edge' ? sel.edges : sel.groups) as Set<number | string>;
    if (set.has(p.id)) set.delete(p.id);
    else set.add(p.id);
    app.setSelection(sel);
  }

  doubleClick(e: ToolEvent, app: App): void {
    const p = pickEntity(app, e, false);
    if (!p) {
      if (app.context.parent) app.exitGroup();
      return;
    }
    if (p.kind === 'group') {
      app.enterGroup(p.id as number);
      return;
    }
    const mesh = app.context.mesh;
    if (p.kind === 'face') {
      const f = mesh.faces.get(p.id as number);
      if (f) app.setSelection({ faces: [f.id], edges: mesh.faceEdgeKeys(f) });
    } else {
      app.setSelection({ edges: [p.id as string], faces: mesh.facesUsingEdge(p.id as string).map((f) => f.id) });
    }
  }

  private boxSelect(app: App, x0: number, y0: number, x1: number, y1: number, add: boolean): void {
    const window = x1 > x0;
    const r = { l: Math.min(x0, x1), r: Math.max(x0, x1), t: Math.min(y0, y1), b: Math.max(y0, y1) };
    const inside = (s: { x: number; y: number }) => s.x >= r.l && s.x <= r.r && s.y >= r.t && s.y <= r.b;
    const test = (pts: THREE.Vector3[]) => {
      const ss = pts.map((p) => app.vp.project(p));
      return window ? ss.every(inside) : ss.some(inside);
    };
    const ctx = app.context;
    const m = ctx.worldMatrix();
    const W = (id: number) => ctx.mesh.v(id).clone().applyMatrix4(m);
    const sel = add ? app.selection : { faces: new Set<number>(), edges: new Set<string>(), groups: new Set<number>() };
    for (const f of ctx.mesh.faces.values()) if (test(ctx.mesh.faceVertexIds(f).map(W))) sel.faces.add(f.id);
    for (const [k, [a, b]] of ctx.mesh.allEdges()) if (test([W(a), W(b)])) sel.edges.add(k);
    for (const g of ctx.children) {
      if (g.hidden) continue;
      const b = g.localBounds();
      if (b.isEmpty()) continue;
      const gm = g.worldMatrix();
      const corners: THREE.Vector3[] = [];
      for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) corners.push(new THREE.Vector3(x, y, z).applyMatrix4(gm));
      if (test(corners)) sel.groups.add(g.id);
    }
    app.setSelection(sel);
  }

  cancel(app: App): void {
    app.escapeDefault();
  }

  deactivate(): void {
    this.box?.remove();
    this.box = null;
    this.down = null;
  }
}

export class EraserTool implements Tool {
  id = 'eraser';
  name = 'Eraser';
  icon = icons.eraser;
  shortcut = 'E';
  cursor = 'cell';
  hint = 'Click or drag over edges and groups to erase them. Erasing an edge removes the faces it bounds.';
  private down = false;
  private edges = new Set<string>();
  private groups = new Set<number>();

  private collect(e: ToolEvent, app: App): void {
    const p = pickEntity(app, e, false);
    if (p?.kind === 'edge') this.edges.add(p.id as string);
    else if (p?.kind === 'group') this.groups.add(p.id as number);
    app.selection.edges = new Set(this.edges);
    app.selection.groups = new Set(this.groups);
    app.refresh();
  }

  pointerDown(e: ToolEvent, app: App): void {
    this.down = true;
    this.edges.clear();
    this.groups.clear();
    app.clearSelection(false);
    this.collect(e, app);
  }

  pointerMove(e: ToolEvent, app: App): void {
    if (this.down) this.collect(e, app);
    else setHover(app, pickEntity(app, e, false));
  }

  pointerUp(_e: ToolEvent, app: App): void {
    if (!this.down) return;
    this.down = false;
    const edges = [...this.edges];
    const groups = [...this.groups];
    app.clearSelection(false);
    if (!edges.length && !groups.length) return app.refresh();
    app.doc.transact('Erase', () => {
      const ctx = app.context;
      ctx.mesh.erase([], edges);
      for (const id of groups) {
        const g = ctx.children.find((c) => c.id === id);
        if (g) ctx.remove(g);
      }
    });
  }
}

export class PaintTool implements Tool {
  id = 'paint';
  name = 'Paint';
  icon = icons.paint;
  shortcut = 'B';
  cursor = 'copy';
  hint = 'Click a face to paint it, or a group to paint all of it. Shift-click a face to pick up its colour. Choose colours in the Materials panel.';

  pointerMove(e: ToolEvent, app: App): void {
    setHover(app, pickEntity(app, e, false));
  }

  pointerDown(e: ToolEvent, app: App): void {
    const p = pickEntity(app, e, false);
    if (!p) return;
    if (e.shift && p.kind === 'face') {
      const f = app.context.mesh.faces.get(p.id as number);
      if (f?.color) {
        app.paintColor = f.color;
        app.emit('selection');
      }
      return;
    }
    const color = app.paintColor;
    // painting a selected face paints the whole selection
    const sel = app.selection;
    app.doc.transact('Paint', () => {
      const ctx = app.context;
      if (p.kind === 'face') {
        const ids = sel.faces.has(p.id as number) ? [...sel.faces] : [p.id as number];
        for (const id of ids) {
          const f = ctx.mesh.faces.get(id);
          if (f) f.color = color;
        }
      } else if (p.kind === 'group') {
        const ids = sel.groups.has(p.id as number) ? [...sel.groups] : [p.id as number];
        for (const id of ids) {
          const g = ctx.children.find((c) => c.id === id);
          if (g) for (const d of g.walk()) for (const f of d.mesh.faces.values()) f.color = color;
        }
      }
    });
  }
}
