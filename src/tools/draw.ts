import * as THREE from 'three';
import type { App } from '../app/app';
import { AXIS_COLORS, Axis, Inference, alignedAxis } from '../app/inference';
import { COLORS } from '../app/viewport';
import { planeBasis } from '../core/geom';
import { parseLength, parseLengthList } from '../core/units';
import { icons } from './icons';
import { Tool, ToolEvent } from './tool';

/** Arrow keys lock an axis like in other push/pull modelers: → red, ← green, ↑ blue, ↓ unlock. */
export function axisFromKey(e: KeyboardEvent, current: Axis | null): Axis | null | undefined {
  const map: Record<string, Axis> = { ArrowRight: 'x', ArrowLeft: 'y', ArrowUp: 'z' };
  if (e.key === 'ArrowDown') return null;
  const a = map[e.key];
  if (!a) return undefined;
  return current === a ? null : a;
}

export function lineColor(a: THREE.Vector3, b: THREE.Vector3): number {
  const ax = alignedAxis(b.clone().sub(a));
  return ax ? AXIS_COLORS[ax] : COLORS.ink;
}

/** Choose a drawing plane from what's under the cursor: the face, or the ground. */
export function planeFromInference(inf: Inference, lock: Axis | null): THREE.Vector3 {
  if (lock) return new THREE.Vector3(lock === 'x' ? 1 : 0, lock === 'y' ? 1 : 0, lock === 'z' ? 1 : 0);
  if (inf.kind === 'on-face' && inf.normal) return inf.normal.clone().normalize();
  if (inf.group && inf.vertexId !== undefined) {
    // endpoint on a face: use that face's plane if there's exactly one obvious one
    const faces = inf.group.mesh.facesUsingVertex(inf.vertexId);
    if (faces.length === 1) {
      const nm = new THREE.Matrix3().getNormalMatrix(inf.group.worldMatrix());
      return inf.group.mesh.normal(faces[0]).applyMatrix3(nm).normalize();
    }
  }
  return new THREE.Vector3(0, 0, 1);
}

function setMarker(app: App, inf: Inference): void {
  app.showInference(inf);
}

// ---------------------------------------------------------------- Line

export class LineTool implements Tool {
  id = 'line';
  name = 'Line';
  icon = icons.line;
  shortcut = 'L';
  vcbLabel = 'Length';
  hint = 'Click to start a line, click to add points. Close a loop to make a face. Type a length and press Enter. Arrow keys lock an axis.';
  private points: THREE.Vector3[] = [];
  private current: THREE.Vector3 | null = null;
  private lock: Axis | null = null;

  activate(): void {
    this.reset();
  }

  private reset(): void {
    this.points = [];
    this.current = null;
    this.lock = null;
  }

  pointerMove(e: ToolEvent, app: App): void {
    const from = this.points[this.points.length - 1];
    const inf = app.infer(e, { from, lockAxis: from ? this.lock : null });
    setMarker(app, inf);
    this.current = inf.point;
    app.vp.clearOverlay();
    if (from) {
      app.vp.overlayLines([from.x, from.y, from.z, inf.point.x, inf.point.y, inf.point.z], lineColor(from, inf.point), 2.4);
      app.setVCB(app.fmt(from.distanceTo(inf.point)));
    }
  }

  pointerDown(e: ToolEvent, app: App): void {
    const from = this.points[this.points.length - 1];
    const inf = app.infer(e, { from, lockAxis: from ? this.lock : null });
    this.addPoint(inf.point, app);
  }

  private addPoint(p: THREE.Vector3, app: App): void {
    const from = this.points[this.points.length - 1];
    if (!from) {
      this.points.push(p.clone());
      return;
    }
    if (from.distanceTo(p) < 1e-4) return;
    const before = app.context.mesh.faces.size;
    app.doc.transact('Line', () => {
      const mesh = app.context.mesh;
      const a = mesh.vertexAt(app.toLocal(from));
      const b = mesh.vertexAt(app.toLocal(p));
      mesh.addLine(a, b);
    });
    this.lock = null;
    if (app.context.mesh.faces.size > before) {
      this.reset();
      app.vp.clearOverlay();
      app.setVCB('');
      return;
    }
    this.points.push(p.clone());
  }

  doubleClick(_e: ToolEvent, app: App): void {
    this.cancel(app);
  }

  keyDown(e: KeyboardEvent, app: App): boolean {
    const a = axisFromKey(e, this.lock);
    if (a === undefined) return false;
    this.lock = a;
    app.setHint(a ? `Locked to the ${a === 'x' ? 'red' : a === 'y' ? 'green' : 'blue'} axis. Press the same arrow again to unlock.` : this.hint);
    return true;
  }

  vcb(text: string, app: App): boolean {
    const from = this.points[this.points.length - 1];
    const len = parseLength(text, app.doc.units);
    if (!from || len === null || !this.current) return false;
    const dir = this.current.clone().sub(from);
    if (dir.lengthSq() < 1e-12) return false;
    this.addPoint(from.clone().add(dir.normalize().multiplyScalar(len)), app);
    return true;
  }

  cancel(app: App): void {
    if (!this.points.length) return app.escapeDefault();
    this.reset();
    app.vp.clearOverlay();
    app.setVCB('');
  }
}

// ---------------------------------------------------------------- Rectangle

export class RectangleTool implements Tool {
  id = 'rect';
  name = 'Rectangle';
  icon = icons.rect;
  shortcut = 'R';
  vcbLabel = 'Dimensions';
  hint = 'Click the first corner, then the opposite corner. Draws on the face under the cursor, or the ground. Type "width, depth" and press Enter.';
  private p0: THREE.Vector3 | null = null;
  private n = new THREE.Vector3(0, 0, 1);
  private u = new THREE.Vector3(1, 0, 0);
  private v = new THREE.Vector3(0, 1, 0);
  private dims = { du: 0, dv: 0 };
  private lock: Axis | null = null;

  activate(): void {
    this.p0 = null;
  }

  private corners(du: number, dv: number): THREE.Vector3[] {
    const p0 = this.p0!;
    const U = this.u.clone().multiplyScalar(du);
    const V = this.v.clone().multiplyScalar(dv);
    return [p0.clone(), p0.clone().add(U), p0.clone().add(U).add(V), p0.clone().add(V)];
  }

  pointerMove(e: ToolEvent, app: App): void {
    if (!this.p0) {
      const inf = app.infer(e);
      setMarker(app, inf);
      return;
    }
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(this.n, this.p0);
    const inf = app.infer(e, { from: this.p0, plane });
    setMarker(app, inf);
    const d = inf.point.clone().sub(this.p0);
    this.dims = { du: d.dot(this.u), dv: d.dot(this.v) };
    this.preview(app);
  }

  private preview(app: App): void {
    app.vp.clearOverlay();
    const c = this.corners(this.dims.du, this.dims.dv);
    const pos: number[] = [];
    for (let i = 0; i < 4; i++) {
      const a = c[i];
      const b = c[(i + 1) % 4];
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
    const square = Math.abs(Math.abs(this.dims.du) - Math.abs(this.dims.dv)) < 1e-6 && Math.abs(this.dims.du) > 0;
    app.vp.overlayLines(pos, square ? 0x0891b2 : COLORS.ink, 2.2);
    app.vp.overlayPolygon(c, COLORS.select, 0.12);
    app.setVCB(`${app.fmt(Math.abs(this.dims.du))}, ${app.fmt(Math.abs(this.dims.dv))}`);
  }

  pointerDown(e: ToolEvent, app: App): void {
    if (!this.p0) {
      const inf = app.infer(e);
      this.p0 = inf.point.clone();
      this.n = planeFromInference(inf, this.lock);
      const b = planeBasis(this.n);
      this.u = b.u;
      this.v = b.v;
      this.dims = { du: 0, dv: 0 };
      return;
    }
    this.commit(app);
  }

  private commit(app: App): void {
    if (!this.p0 || Math.abs(this.dims.du) < 1e-4 || Math.abs(this.dims.dv) < 1e-4) return;
    const pts = this.corners(this.dims.du, this.dims.dv).map((p) => app.toLocal(p));
    app.doc.transact('Rectangle', () => app.context.mesh.addPolygon(pts));
    this.p0 = null;
    app.vp.clearOverlay();
    app.setVCB('');
  }

  keyDown(e: KeyboardEvent, app: App): boolean {
    if (this.p0) return false;
    const a = axisFromKey(e, this.lock);
    if (a === undefined) return false;
    this.lock = a;
    app.setHint(a ? `Drawing perpendicular to the ${a === 'x' ? 'red' : a === 'y' ? 'green' : 'blue'} axis.` : this.hint);
    return true;
  }

  vcb(text: string, app: App): boolean {
    const vals = parseLengthList(text, app.doc.units);
    if (!vals || !this.p0) return false;
    const [w, h = vals[0]] = vals;
    this.dims = { du: (Math.sign(this.dims.du) || 1) * w, dv: (Math.sign(this.dims.dv) || 1) * h };
    this.commit(app);
    return true;
  }

  cancel(app: App): void {
    if (!this.p0) return app.escapeDefault();
    this.p0 = null;
    app.vp.clearOverlay();
  }
}

// ---------------------------------------------------------------- Circle

export class CircleTool implements Tool {
  id = 'circle';
  name = 'Circle';
  icon = icons.circle;
  shortcut = 'C';
  vcbLabel = 'Radius';
  hint = 'Click the centre, then the radius. Type a radius and press Enter, or type "36s" to change the number of sides.';
  segments = 24;
  private c: THREE.Vector3 | null = null;
  private n = new THREE.Vector3(0, 0, 1);
  private u = new THREE.Vector3(1, 0, 0);
  private v = new THREE.Vector3(0, 1, 0);
  private r = 0;
  private angle = 0;
  private lock: Axis | null = null;

  private points(): THREE.Vector3[] {
    const out: THREE.Vector3[] = [];
    for (let i = 0; i < this.segments; i++) {
      const t = this.angle + (i / this.segments) * Math.PI * 2;
      out.push(this.c!.clone().add(this.u.clone().multiplyScalar(Math.cos(t) * this.r)).add(this.v.clone().multiplyScalar(Math.sin(t) * this.r)));
    }
    return out;
  }

  pointerMove(e: ToolEvent, app: App): void {
    if (!this.c) {
      setMarker(app, app.infer(e));
      app.setVCB(`${this.segments} sides`, 'Sides');
      return;
    }
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(this.n, this.c);
    const inf = app.infer(e, { from: this.c, plane });
    setMarker(app, inf);
    const d = inf.point.clone().sub(this.c);
    this.r = d.length();
    this.angle = Math.atan2(d.dot(this.v), d.dot(this.u));
    this.preview(app);
  }

  private preview(app: App): void {
    app.vp.clearOverlay();
    if (this.r < 1e-6) return;
    const pts = this.points();
    const pos: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
    app.vp.overlayLines(pos, COLORS.ink, 2.2);
    const c = this.c!;
    app.vp.overlayLines([c.x, c.y, c.z, pts[0].x, pts[0].y, pts[0].z], COLORS.muted, 1.4, true);
    app.setVCB(app.fmt(this.r), 'Radius');
  }

  pointerDown(e: ToolEvent, app: App): void {
    if (!this.c) {
      const inf = app.infer(e);
      this.c = inf.point.clone();
      this.n = planeFromInference(inf, this.lock);
      const b = planeBasis(this.n);
      this.u = b.u;
      this.v = b.v;
      this.r = 0;
      return;
    }
    this.commit(app);
  }

  private commit(app: App): void {
    if (!this.c || this.r < 1e-4) return;
    const pts = this.points().map((p) => app.toLocal(p));
    app.doc.transact('Circle', () => app.context.mesh.addPolygon(pts));
    this.c = null;
    app.vp.clearOverlay();
    app.setVCB('');
  }

  keyDown(e: KeyboardEvent, app: App): boolean {
    if (this.c) return false;
    const a = axisFromKey(e, this.lock);
    if (a === undefined) return false;
    this.lock = a;
    return !!app;
  }

  vcb(text: string, app: App): boolean {
    const sides = text.trim().match(/^(\d+)\s*s$/i);
    if (sides) {
      this.segments = Math.max(3, Math.min(360, parseInt(sides[1], 10)));
      app.setVCB(`${this.segments} sides`, 'Sides');
      if (this.c) this.preview(app);
      return true;
    }
    const r = parseLength(text, app.doc.units);
    if (r === null || !this.c || r <= 0) return false;
    this.r = r;
    this.commit(app);
    return true;
  }

  cancel(app: App): void {
    if (!this.c) return app.escapeDefault();
    this.c = null;
    app.vp.clearOverlay();
  }
}
