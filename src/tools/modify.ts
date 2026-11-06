import * as THREE from 'three';
import type { App } from '../app/app';
import { AXES, AXIS_COLORS, Axis } from '../app/inference';
import { COLORS } from '../app/viewport';
import { closestParamOnLine, planeBasis } from '../core/geom';
import { parseLength } from '../core/units';
import { axisFromKey, lineColor, planeFromInference } from './draw';
import { icons } from './icons';
import { pickEntity } from './select';
import { Tool, ToolEvent } from './tool';

type Live = ReturnType<App['live']>;

// ---------------------------------------------------------------- Push/Pull

export class PushPullTool implements Tool {
  id = 'pushpull';
  name = 'Push/Pull';
  icon = icons.pushpull;
  shortcut = 'P';
  vcbLabel = 'Distance';
  hint = 'Click a face and move to push or pull it, then click again (or drag and release). Type a distance and press Enter. Double-click a face to repeat the last distance.';
  private op: { faceId: number; n: THREE.Vector3; start: THREE.Vector3; live: Live; d: number; down: { x: number; y: number }; verts: Set<string> } | null = null;
  private lastD = 0;
  private lastFace: number | null = null;

  private hoverFace(e: ToolEvent, app: App) {
    const ctx = app.context;
    return app.vp.raycastFaces(e.ray, (g) => g === ctx || !!app.entityFor(g)) ?? null;
  }

  pointerMove(e: ToolEvent, app: App): void {
    if (!this.op) {
      const hit = this.hoverFace(e, app);
      const own = hit && hit.group === app.context ? { groupId: hit.group.id, faceId: hit.faceId } : null;
      if ((own?.faceId ?? null) !== (app.hoverFace?.faceId ?? null)) {
        app.hoverFace = own;
        app.refresh();
      }
      return;
    }
    const op = this.op;
    const inf = app.infer(e, { excludeVerts: op.verts, noFaces: true });
    let d: number;
    if (inf.kind === 'endpoint' || inf.kind === 'midpoint' || inf.kind === 'on-edge') {
      d = inf.point.clone().sub(op.start).dot(op.n);
      app.showInference(inf);
    } else {
      d = closestParamOnLine(op.start, op.n, e.ray.origin, e.ray.direction);
      app.showInference(null);
    }
    this.apply(app, d);
  }

  private apply(app: App, d: number): void {
    const op = this.op!;
    op.d = d;
    op.live.apply(() => app.context.mesh.pushPull(op.faceId, d));
    app.vp.clearOverlay();
    const end = op.start.clone().add(op.n.clone().multiplyScalar(d));
    app.vp.overlayLines([op.start.x, op.start.y, op.start.z, end.x, end.y, end.z], COLORS.muted, 1.4, true);
    app.setVCB(app.fmt(Math.abs(d)));
  }

  pointerDown(e: ToolEvent, app: App): void {
    if (this.op) return this.finish(app);
    const hit = this.hoverFace(e, app);
    if (!hit) return;
    if (hit.group !== app.context) {
      // push/pull works inside the group being edited; double-click a group to open it
      app.toast('That face is inside a group. Double-click the group with the Select tool to edit it.');
      return;
    }
    const face = app.context.mesh.faces.get(hit.faceId)!;
    const verts = new Set(app.context.mesh.faceVertexIds(face).map((v) => `${app.context.id}:${v}`));
    this.op = { faceId: hit.faceId, n: hit.normal.clone(), start: hit.point.clone(), live: app.live('Push/Pull'), d: 0, down: { x: e.x, y: e.y }, verts };
    app.hoverFace = null;
  }

  pointerUp(e: ToolEvent, app: App): void {
    if (this.op && Math.hypot(e.x - this.op.down.x, e.y - this.op.down.y) > 6) this.finish(app);
  }

  private finish(app: App): void {
    const op = this.op!;
    this.op = null;
    app.vp.clearOverlay();
    app.showInference(null);
    if (Math.abs(op.d) < 1e-4) {
      op.live.cancel();
      return;
    }
    op.live.commit();
    this.lastD = op.d;
    this.lastFace = op.faceId;
  }

  doubleClick(e: ToolEvent, app: App): void {
    if (this.op || !this.lastD) return;
    const hit = this.hoverFace(e, app);
    if (!hit || hit.group !== app.context) return;
    // follow the face's orientation: ground faces pull up, other faces pull out
    const d = this.lastD;
    app.doc.transact('Push/Pull', () => app.context.mesh.pushPull(hit.faceId, d));
  }

  vcb(text: string, app: App): boolean {
    const v = parseLength(text, app.doc.units);
    if (v === null) return false;
    if (this.op) {
      const op = this.op;
      const defaultSign = op.n.z < -0.99 ? -1 : 1; // ground faces point down; pull them up
      const sign = Math.abs(op.d) > 1e-6 ? Math.sign(op.d) : defaultSign;
      this.apply(app, sign * v);
      this.finish(app);
      return true;
    }
    // retype the last push/pull
    if (this.lastFace !== null && this.lastD && app.doc.undoLabel() === 'Push/Pull') {
      const sign = Math.sign(this.lastD);
      const face = this.lastFace;
      app.doc.undo();
      this.lastD = sign * v;
      app.doc.transact('Push/Pull', () => app.context.mesh.pushPull(face, sign * v));
      return true;
    }
    return false;
  }

  cancel(app: App): void {
    if (!this.op) return app.escapeDefault();
    this.op.live.cancel();
    this.op = null;
    app.vp.clearOverlay();
  }

  deactivate(app: App): void {
    if (this.op) this.cancel(app);
  }
}

// ---------------------------------------------------------------- shared helpers for move/rotate

function ensureSelection(app: App, e: ToolEvent): boolean {
  if (!app.selectionEmpty()) return true;
  const p = pickEntity(app, e, false);
  if (!p) return false;
  if (p.kind === 'face') app.setSelection({ faces: [p.id as number] });
  else if (p.kind === 'edge') app.setSelection({ edges: [p.id as string] });
  else app.setSelection({ groups: [p.id as number] });
  return true;
}

function movingExclusions(app: App): { groups: Set<number>; verts: Set<string> } {
  const groups = new Set<number>();
  for (const g of app.selectedGroups()) for (const d of g.walk()) groups.add(d.id);
  const ctx = app.context;
  const verts = new Set<string>();
  for (const v of ctx.mesh.verticesOf(app.selection.faces, app.selection.edges)) verts.add(`${ctx.id}:${v}`);
  return { groups, verts };
}

/** Apply a context-local transform to the selection, optionally as copies. Returns the new selection. */
function transformSelection(app: App, m: THREE.Matrix4, copy: boolean, copies = 1, step?: (k: number) => THREE.Matrix4) {
  const ctx = app.context;
  const sel = app.selection;
  const out = { faces: new Set<number>(), edges: new Set<string>(), groups: new Set<number>() };
  if (!copy) {
    for (const g of app.selectedGroups()) g.matrix.premultiply(m);
    ctx.mesh.applyMatrix(ctx.mesh.verticesOf(sel.faces, sel.edges), m);
    return null;
  }
  const extracted = ctx.mesh.extract(sel.faces, sel.edges);
  for (let k = 1; k <= copies; k++) {
    const mk = step ? step(k) : m;
    for (const g of app.selectedGroups()) {
      const dup = app.doc.duplicateGroup(g);
      dup.matrix.premultiply(mk);
      out.groups.add(dup.id);
    }
    if (!extracted.isEmpty()) {
      const r = ctx.mesh.merge(extracted, mk);
      r.faces.forEach((f) => out.faces.add(f));
      r.lines.forEach((l) => out.edges.add(l));
    }
  }
  return out;
}

// ---------------------------------------------------------------- Move

export class MoveTool implements Tool {
  id = 'move';
  name = 'Move';
  icon = icons.move;
  shortcut = 'M';
  vcbLabel = 'Distance';
  hint = 'Click a point on the selection (or anything under the cursor), then click where it goes. Tap Ctrl / Option to toggle Copy. After a copy, type "x5" for 5 copies or "/5" to divide.';
  private op: {
    start: THREE.Vector3;
    live: Live;
    delta: THREE.Vector3;
    down: { x: number; y: number };
    excl: ReturnType<typeof movingExclusions>;
    newSel?: { faces: Set<number>; edges: Set<string>; groups: Set<number> } | null;
  } | null = null;
  private lock: Axis | null = null;
  private copy = false;
  private lastCopy: { delta: THREE.Vector3; orig: { faces: number[]; edges: string[]; groups: number[] } } | null = null;

  activate(app: App): void {
    this.copy = false;
    this.lastCopy = null;
    app.setHint(this.hint);
  }

  pointerMove(e: ToolEvent, app: App): void {
    if (!this.op) {
      app.showInference(app.infer(e));
      return;
    }
    const op = this.op;
    const inf = app.infer(e, { from: op.start, lockAxis: this.lock, excludeGroups: op.excl.groups, excludeVerts: op.excl.verts });
    app.showInference(inf);
    this.apply(app, inf.point.clone().sub(op.start));
  }

  private apply(app: App, delta: THREE.Vector3, copies = 1, divide = false): void {
    const op = this.op!;
    op.delta = delta.clone();
    const sel = { faces: [...app.selection.faces], edges: [...app.selection.edges], groups: [...app.selection.groups] };
    let newSel: ReturnType<typeof transformSelection> = null;
    op.live.apply(() => {

      const local = app.dirToLocal(delta);
      const m = new THREE.Matrix4().makeTranslation(local.x, local.y, local.z);
      const step = (k: number) => {
        const f = divide ? k / copies : k;
        return new THREE.Matrix4().makeTranslation(local.x * f, local.y * f, local.z * f);
      };
      newSel = transformSelection(app, m, this.copy, copies, step);
    });
    op.newSel = newSel;
    app.selection = { faces: new Set(sel.faces), edges: new Set(sel.edges), groups: new Set(sel.groups) };
    app.vp.clearOverlay();
    const end = op.start.clone().add(delta);
    app.vp.overlayLines([op.start.x, op.start.y, op.start.z, end.x, end.y, end.z], lineColor(op.start, end), 1.6, true);
    app.setVCB(app.fmt(delta.length()));
  }

  pointerDown(e: ToolEvent, app: App): void {
    if (this.op) return this.finish(app);
    if (!ensureSelection(app, e)) return;
    const excl = movingExclusions(app);
    const inf = app.infer(e);
    this.op = { start: inf.point.clone(), live: app.live(this.copy ? 'Copy' : 'Move'), delta: new THREE.Vector3(), down: { x: e.x, y: e.y }, excl };
  }

  pointerUp(e: ToolEvent, app: App): void {
    if (this.op && Math.hypot(e.x - this.op.down.x, e.y - this.op.down.y) > 6) this.finish(app);
  }

  private finish(app: App): void {
    const op = this.op!;
    this.op = null;
    this.lock = null;
    app.vp.clearOverlay();
    app.showInference(null);
    if (op.delta.length() < 1e-5) return op.live.cancel();
    op.live.commit();
    const ns = op.newSel;
    if (this.copy && ns) {
      const orig = { faces: [...app.selection.faces], edges: [...app.selection.edges], groups: [...app.selection.groups] };
      app.setSelection(ns);
      this.lastCopy = { delta: op.delta.clone(), orig };
    } else this.lastCopy = null;
  }

  keyDown(e: KeyboardEvent, app: App): boolean {
    if (e.key === 'Control' || e.key === 'Alt') {
      this.copy = !this.copy;
      app.setHint(this.copy ? 'Copy mode (+): the original stays put. Tap Ctrl / Option again to move instead.' : this.hint);
      return true;
    }
    const a = axisFromKey(e, this.lock);
    if (a === undefined || !this.op) return false;
    this.lock = a;
    return true;
  }

  vcb(text: string, app: App): boolean {
    const arr = text.trim().match(/^(?:[x*](\d+)|(\d+)[x*]|\/(\d+))$/i);
    if (arr && !this.op && this.lastCopy && app.doc.undoLabel() === 'Copy') {
      const n = parseInt(arr[1] ?? arr[2] ?? arr[3], 10);
      if (!n || n < 1) return false;
      const divide = !!arr[3];
      const { delta, orig } = this.lastCopy;
      app.doc.undo();
      app.setSelection(orig);
      this.copy = true;
      const live = app.live('Copy');
      this.op = { start: new THREE.Vector3(), live, delta, down: { x: 0, y: 0 }, excl: { groups: new Set(), verts: new Set() } };
      this.apply(app, delta, n, divide);
      this.finish(app);
      return true;
    }
    const v = parseLength(text, app.doc.units);
    if (v === null || !this.op) return false;
    const dir = this.op.delta.lengthSq() > 1e-12 ? this.op.delta.clone().normalize() : this.lock ? AXES[this.lock].clone() : null;
    if (!dir) return false;
    this.apply(app, dir.multiplyScalar(v));
    this.finish(app);
    return true;
  }

  cancel(app: App): void {
    if (!this.op) return app.escapeDefault();
    this.op.live.cancel();
    this.op = null;
    this.lock = null;
    app.vp.clearOverlay();
  }

  deactivate(app: App): void {
    if (this.op) this.cancel(app);
  }
}

// ---------------------------------------------------------------- Rotate

export class RotateTool implements Tool {
  id = 'rotate';
  name = 'Rotate';
  icon = icons.rotate;
  shortcut = 'Q';
  vcbLabel = 'Angle';
  hint = 'Click the centre of rotation (on a face to rotate in its plane), click a reference point, then click to set the angle. Type degrees and press Enter. Arrow keys pick the axis.';
  private stage = 0;
  private center = new THREE.Vector3();
  private n = new THREE.Vector3(0, 0, 1);
  private ref = new THREE.Vector3(1, 0, 0);
  private angle = 0;
  private live: Live | null = null;
  private lock: Axis | null = null;
  private copy = false;

  activate(): void {
    this.stage = 0;
    this.copy = false;
  }

  private protractor(app: App, cur?: THREE.Vector3): void {
    app.vp.clearOverlay();
    const r = app.vp.worldPerPixel(this.center) * 46;
    const { u, v } = planeBasis(this.n);
    const pos: number[] = [];
    const N = 48;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const b = ((i + 1) / N) * Math.PI * 2;
      const pa = this.center.clone().add(u.clone().multiplyScalar(Math.cos(a) * r)).add(v.clone().multiplyScalar(Math.sin(a) * r));
      const pb = this.center.clone().add(u.clone().multiplyScalar(Math.cos(b) * r)).add(v.clone().multiplyScalar(Math.sin(b) * r));
      pos.push(pa.x, pa.y, pa.z, pb.x, pb.y, pb.z);
    }
    const ax = (['x', 'y', 'z'] as Axis[]).find((k) => Math.abs(AXES[k].dot(this.n)) > 0.999);
    app.vp.overlayLines(pos, ax ? AXIS_COLORS[ax] : COLORS.select, 1.8);
    if (this.stage >= 1) {
      const e = this.center.clone().add(this.ref.clone().multiplyScalar(r * 1.6));
      app.vp.overlayLines([this.center.x, this.center.y, this.center.z, e.x, e.y, e.z], COLORS.muted, 1.4, true);
    }
    if (cur) {
      app.vp.overlayLines([this.center.x, this.center.y, this.center.z, cur.x, cur.y, cur.z], COLORS.ink, 1.4, true);
    }
  }

  pointerMove(e: ToolEvent, app: App): void {
    if (this.stage === 0) {
      const inf = app.infer(e);
      app.showInference(inf);
      this.center = inf.point.clone();
      this.n = planeFromInference(inf, this.lock);
      this.protractor(app);
      return;
    }
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(this.n, this.center);
    const excl = this.stage === 2 ? movingExclusions(app) : undefined;
    const inf = app.infer(e, { from: this.center, plane, excludeGroups: excl?.groups, excludeVerts: excl?.verts });
    app.showInference(inf);
    const dir = inf.point.clone().sub(this.center);
    dir.sub(this.n.clone().multiplyScalar(dir.dot(this.n)));
    if (dir.lengthSq() < 1e-12) return;
    dir.normalize();
    if (this.stage === 1) {
      this.ref = dir;
      this.protractor(app, inf.point);
      return;
    }
    let a = Math.atan2(this.n.dot(this.ref.clone().cross(dir)), this.ref.dot(dir));
    const deg = THREE.MathUtils.radToDeg(a);
    const snap = Math.round(deg / 15) * 15;
    if (Math.abs(deg - snap) < 2.5) a = THREE.MathUtils.degToRad(snap);
    this.apply(app, a);
    this.protractor(app, inf.point);
  }

  private apply(app: App, a: number, copies = 1): void {
    this.angle = a;
    const sel = { faces: [...app.selection.faces], edges: [...app.selection.edges], groups: [...app.selection.groups] };
    this.live!.apply(() => {

      const world = (k: number) =>
        new THREE.Matrix4()
          .makeTranslation(this.center.x, this.center.y, this.center.z)
          .multiply(new THREE.Matrix4().makeRotationAxis(this.n, a * k))
          .multiply(new THREE.Matrix4().makeTranslation(-this.center.x, -this.center.y, -this.center.z));
      const ctxW = app.context.worldMatrix();
      const toLocal = (k: number) => ctxW.clone().invert().multiply(world(k)).multiply(ctxW);
      transformSelection(app, toLocal(1), this.copy, copies, toLocal);
    });
    app.selection = { faces: new Set(sel.faces), edges: new Set(sel.edges), groups: new Set(sel.groups) };
    app.setVCB(`${THREE.MathUtils.radToDeg(a).toFixed(1)}°`);
  }

  pointerDown(e: ToolEvent, app: App): void {
    if (this.stage === 0) {
      if (!ensureSelection(app, e)) return;
      this.stage = 1;
      return;
    }
    if (this.stage === 1) {
      this.stage = 2;
      this.live = app.live(this.copy ? 'Rotate Copy' : 'Rotate');
      return;
    }
    this.finish(app);
  }

  private finish(app: App): void {
    if (Math.abs(this.angle) < 1e-6) this.live?.cancel();
    else this.live?.commit();
    this.live = null;
    this.stage = 0;
    this.angle = 0;
    this.lock = null;
    app.vp.clearOverlay();
  }

  keyDown(e: KeyboardEvent, app: App): boolean {
    if (e.key === 'Control' || e.key === 'Alt') {
      this.copy = !this.copy;
      app.setHint(this.copy ? 'Rotate copy (+): the original stays put.' : this.hint);
      return true;
    }
    const a = axisFromKey(e, this.lock);
    if (a === undefined || this.stage !== 0) return false;
    this.lock = a;
    return true;
  }

  vcb(text: string, app: App): boolean {
    const m = text.trim().match(/^(-?[\d.]+)\s*°?$/);
    if (!m || this.stage !== 2) return false;
    const deg = parseFloat(m[1]);
    const sign = this.angle < 0 ? -1 : 1;
    this.apply(app, THREE.MathUtils.degToRad(deg) * sign);
    this.finish(app);
    return true;
  }

  cancel(app: App): void {
    if (this.stage === 0) return app.escapeDefault();
    this.live?.cancel();
    this.live = null;
    this.stage = 0;
    app.vp.clearOverlay();
  }

  deactivate(app: App): void {
    if (this.stage) this.cancel(app);
  }
}

// ---------------------------------------------------------------- camera tools

export const OrbitTool: Tool = {
  id: 'orbit',
  name: 'Orbit',
  icon: icons.orbit,
  shortcut: 'O',
  navigation: 'orbit',
  cursor: 'grab',
  hint: 'Drag to orbit. Also: middle-drag, or Option/Alt-drag on a trackpad.',
};

export const PanTool: Tool = {
  id: 'pan',
  name: 'Pan',
  icon: icons.pan,
  shortcut: 'H',
  navigation: 'pan',
  cursor: 'move',
  hint: 'Drag to pan. Also: right-drag, Shift+middle-drag, or Option/Alt+Shift-drag.',
};

export const ZoomTool: Tool = {
  id: 'zoom',
  name: 'Zoom',
  icon: icons.zoom,
  shortcut: 'Z',
  navigation: 'zoom',
  cursor: 'zoom-in',
  hint: 'Drag up/down to zoom. Scroll or pinch to zoom toward the cursor. Shift+Z zooms to fit the model.',
};
