import * as THREE from 'three';
import type { App } from '../app/app';
import { Axis } from '../app/inference';
import { closestParamOnLine, planeBasis } from '../core/geom';
import { parseLength } from '../core/units';
import { CircleTool, axisFromKey, lineColor, planeFromInference } from './draw';
import { icons } from './icons';
import { pickEntity } from './select';
import { Tool, ToolEvent } from './tool';

type Live = ReturnType<App['live']>;
const v3 = (p: THREE.Vector3): [number, number, number] => [p.x, p.y, p.z];

function segs(points: THREE.Vector3[], closed = false): number[] {
  const out: number[] = [];
  for (let i = 0; i < points.length - (closed ? 0 : 1); i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    out.push(a.x, a.y, a.z, b.x, b.y, b.z);
  }
  return out;
}

/** Add a chain of points as connected edges in the current context (faces close/split as with the Line tool). */
function addChain(app: App, pts: THREE.Vector3[]): void {
  const mesh = app.context.mesh;
  const ids = pts.map((p) => mesh.vertexAt(app.toLocal(p)));
  for (let i = 0; i < ids.length - 1; i++) mesh.addLine(ids[i], ids[i + 1]);
}

// ---------------------------------------------------------------- Arc

export class ArcTool implements Tool {
  id = 'arc';
  name = 'Arc';
  icon = icons.arc;
  shortcut = 'A';
  vcbLabel = 'Bulge';
  hint = 'Click the start, click the end, then move to set the bulge and click. Type the bulge distance, or "12s" for the number of segments.';
  segments = 12;
  private a: THREE.Vector3 | null = null;
  private b: THREE.Vector3 | null = null;
  private n = new THREE.Vector3(0, 0, 1);
  private bulge = 0;
  private lock: Axis | null = null;

  activate(): void {
    this.a = this.b = null;
  }

  /** Points along the arc from a to b with signed bulge (sagitta) s. */
  points(a: THREE.Vector3, b: THREE.Vector3, s: number): THREE.Vector3[] {
    const chord = b.clone().sub(a);
    const c = chord.length();
    if (Math.abs(s) < 1e-6 || c < 1e-6) return [a.clone(), b.clone()];
    const perp = new THREE.Vector3().crossVectors(this.n, chord).normalize();
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const R = (c * c) / 4 / (2 * Math.abs(s)) + Math.abs(s) / 2;
    const center = mid.clone().add(perp.clone().multiplyScalar(Math.sign(s) * (Math.abs(s) - R)));
    const top = mid.clone().add(perp.clone().multiplyScalar(s));
    const va = a.clone().sub(center);
    const total = 4 * Math.atan((2 * Math.abs(s)) / c);
    // pick the rotation direction that passes through the bulge point
    const tryDir = (sign: number) => va.clone().applyAxisAngle(this.n, (sign * total) / 2).add(center).distanceTo(top);
    const sign = tryDir(1) < tryDir(-1) ? 1 : -1;
    const out: THREE.Vector3[] = [];
    for (let i = 0; i <= this.segments; i++) out.push(va.clone().applyAxisAngle(this.n, (sign * total * i) / this.segments).add(center));
    out[0] = a.clone();
    out[out.length - 1] = b.clone();
    return out;
  }

  pointerMove(e: ToolEvent, app: App): void {
    if (!this.a) return app.showInference(app.infer(e));
    if (!this.b) {
      const inf = app.infer(e, { from: this.a, lockAxis: this.lock, plane: new THREE.Plane().setFromNormalAndCoplanarPoint(this.n, this.a) });
      app.showInference(inf);
      app.vp.clearOverlay();
      app.vp.overlayLines(segs([this.a, inf.point]), lineColor(this.a, inf.point), 2);
      app.setVCB(app.fmt(this.a.distanceTo(inf.point)), 'Length');
      return;
    }
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(this.n, this.a);
    const inf = app.infer(e, { plane });
    app.showInference(inf);
    const chord = this.b.clone().sub(this.a);
    const perp = new THREE.Vector3().crossVectors(this.n, chord).normalize();
    const mid = this.a.clone().add(this.b).multiplyScalar(0.5);
    let s = inf.point.clone().sub(mid).dot(perp);
    const half = chord.length() / 2;
    const semicircle = Math.abs(Math.abs(s) - half) < half * 0.04;
    if (semicircle) s = Math.sign(s) * half;
    this.bulge = s;
    app.vp.clearOverlay();
    app.vp.overlayLines(segs(this.points(this.a, this.b, s)), semicircle ? 0xc026d3 : 0x111111, 2.2);
    app.setVCB(app.fmt(Math.abs(s)), 'Bulge');
    app.setHint(semicircle ? 'Half circle' : this.hint);
  }

  pointerDown(e: ToolEvent, app: App): void {
    if (!this.a) {
      const inf = app.infer(e);
      this.a = inf.point.clone();
      this.n = planeFromInference(inf, this.lock);
      return;
    }
    if (!this.b) {
      const inf = app.infer(e, { from: this.a, lockAxis: this.lock, plane: new THREE.Plane().setFromNormalAndCoplanarPoint(this.n, this.a) });
      if (inf.point.distanceTo(this.a) < 1e-4) return;
      this.b = inf.point.clone();
      this.bulge = 0;
      return;
    }
    this.commit(app);
  }

  private commit(app: App): void {
    if (!this.a || !this.b) return;
    const pts = this.points(this.a, this.b, this.bulge);
    app.doc.transact('Arc', () => addChain(app, pts));
    this.a = this.b = null;
    app.vp.clearOverlay();
    app.setVCB('');
  }

  keyDown(e: KeyboardEvent): boolean {
    const a = axisFromKey(e, this.lock);
    if (a === undefined) return false;
    this.lock = a;
    return true;
  }

  vcb(text: string, app: App): boolean {
    const m = text.trim().match(/^(\d+)\s*s$/i);
    if (m) {
      this.segments = Math.max(2, Math.min(180, parseInt(m[1], 10)));
      return true;
    }
    const v = parseLength(text, app.doc.units);
    if (v === null) return false;
    if (this.a && !this.b) {
      // typed chord length along the current direction is not known yet; ignore
      return false;
    }
    if (!this.b) return false;
    this.bulge = (Math.sign(this.bulge) || 1) * v;
    this.commit(app);
    return true;
  }

  cancel(app: App): void {
    if (!this.a) return app.escapeDefault();
    this.a = this.b = null;
    app.vp.clearOverlay();
  }
}

// ---------------------------------------------------------------- Polygon

export class PolygonTool extends CircleTool {
  id = 'polygon';
  name = 'Polygon';
  icon = icons.polygon;
  shortcut = '';
  hint = 'Click the centre, then a corner. Type a radius and press Enter, or "8s" for the number of sides.';
  segments = 6;
}

// ---------------------------------------------------------------- Offset

export class OffsetTool implements Tool {
  id = 'offset';
  name = 'Offset';
  icon = icons.offset;
  shortcut = 'F';
  vcbLabel = 'Distance';
  hint = 'Click a face, then move inward or outward and click to offset its outline. Type a distance (negative = outward).';
  private op: { faceId: number; plane: THREE.Plane; start: number; d: number; live: Live } | null = null;
  private lastD = 0;

  /** Signed distance of p from the face outline (+ inside). */
  private insideDistance(app: App, faceId: number, p: THREE.Vector3): number {
    const mesh = app.context.mesh;
    const face = mesh.faces.get(faceId);
    if (!face) return 0;
    const m = app.context.worldMatrix();
    const pts = mesh.loopPoints(face.outer).map((q) => q.clone().applyMatrix4(m));
    let d = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const ab = b.clone().sub(a);
      const t = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / ab.lengthSq()));
      d = Math.min(d, a.clone().add(ab.multiplyScalar(t)).distanceTo(p));
    }
    const local = app.toLocal(p);
    return mesh.pointInFace({ ...face, holes: [] }, local, 0) ? d : -d;
  }

  pointerMove(e: ToolEvent, app: App): void {
    if (!this.op) {
      const hit = app.vp.raycastFaces(e.ray, (g) => g === app.context);
      const hf = hit ? { groupId: hit.group.id, faceId: hit.faceId } : null;
      if ((hf?.faceId ?? null) !== (app.hoverFace?.faceId ?? null)) {
        app.hoverFace = hf;
        app.refresh();
      }
      return;
    }
    const p = e.ray.intersectPlane(this.op.plane, new THREE.Vector3());
    if (!p) return;
    this.apply(app, this.insideDistance(app, this.op.faceId, p) - this.op.start);
  }

  private apply(app: App, d: number): void {
    const op = this.op!;
    op.d = d;
    op.live.apply(() => app.context.mesh.offsetFace(op.faceId, d));
    app.setVCB(app.fmt(d));
  }

  pointerDown(e: ToolEvent, app: App): void {
    if (this.op) return this.finish(app);
    const hit = app.vp.raycastFaces(e.ray, (g) => g === app.context);
    if (!hit) return;
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(hit.normal, hit.point);
    this.op = { faceId: hit.faceId, plane, start: 0, d: 0, live: app.live('Offset') };
    this.op.start = this.insideDistance(app, hit.faceId, hit.point);
    app.hoverFace = null;
  }

  private finish(app: App): void {
    const op = this.op!;
    this.op = null;
    if (Math.abs(op.d) < 1e-4) return op.live.cancel();
    op.live.commit();
    this.lastD = op.d;
  }

  doubleClick(e: ToolEvent, app: App): void {
    if (this.op || !this.lastD) return;
    const hit = app.vp.raycastFaces(e.ray, (g) => g === app.context);
    const d = this.lastD;
    if (hit) app.doc.transact('Offset', () => app.context.mesh.offsetFace(hit.faceId, d));
  }

  vcb(text: string, app: App): boolean {
    const v = parseLength(text, app.doc.units);
    if (v === null || !this.op) return false;
    this.apply(app, v);
    this.finish(app);
    return true;
  }

  cancel(app: App): void {
    if (!this.op) return app.escapeDefault();
    this.op.live.cancel();
    this.op = null;
  }

  deactivate(app: App): void {
    if (this.op) this.cancel(app);
  }
}

// ---------------------------------------------------------------- Scale

interface Grip {
  mask: THREE.Vector3; // -1/0/1 per box axis
  point: THREE.Vector3; // world
}

export class ScaleTool implements Tool {
  id = 'scale';
  name = 'Scale';
  icon = icons.scale;
  shortcut = 'S';
  vcbLabel = 'Scale';
  hint = 'Select something, then drag a green grip. Corners scale evenly, edges and faces stretch. Hold Ctrl/Option to scale about the centre. Type a factor (2, 0.5, -1 to mirror) or a size like 24".';
  private box: { center: THREE.Vector3; half: THREE.Vector3; basis: THREE.Matrix4 } | null = null;
  private grips: Grip[] = [];
  private hover: Grip | null = null;
  private op: { grip: Grip; anchor: THREE.Vector3; live: Live; factor: THREE.Vector3; down: { x: number; y: number } } | null = null;
  private aboutCenter = false;

  activate(app: App): void {
    this.computeBox(app);
    this.draw(app);
  }

  deactivate(app: App): void {
    if (this.op) this.cancel(app);
    app.vp.clearOverlay();
  }

  private computeBox(app: App): void {
    this.box = null;
    this.grips = [];
    const groups = app.selectedGroups();
    const ctx = app.context;
    const m = ctx.worldMatrix();
    let basis = new THREE.Matrix4();
    const pts: THREE.Vector3[] = [];
    const onlyGroup = groups.length === 1 && !app.selection.faces.size && !app.selection.edges.size;
    if (onlyGroup) {
      // a single group scales along its own axes
      const g = groups[0];
      const wm = g.worldMatrix();
      const q = new THREE.Quaternion();
      wm.decompose(new THREE.Vector3(), q, new THREE.Vector3());
      basis = new THREE.Matrix4().makeRotationFromQuaternion(q);
      const lb = g.localBounds();
      if (lb.isEmpty()) return;
      for (const x of [lb.min.x, lb.max.x]) for (const y of [lb.min.y, lb.max.y]) for (const z of [lb.min.z, lb.max.z]) pts.push(new THREE.Vector3(x, y, z).applyMatrix4(wm));
    } else {
      for (const v of ctx.mesh.verticesOf(app.selection.faces, app.selection.edges)) pts.push(ctx.mesh.v(v).clone().applyMatrix4(m));
      for (const g of groups) {
        const b = g.worldBounds();
        if (!b.isEmpty()) pts.push(b.min.clone(), b.max.clone());
      }
    }
    if (!pts.length) return;
    const inv = basis.clone().invert();
    const lb = new THREE.Box3().setFromPoints(pts.map((p) => p.clone().applyMatrix4(inv)));
    const center = lb.getCenter(new THREE.Vector3()).applyMatrix4(basis);
    const half = lb.getSize(new THREE.Vector3()).multiplyScalar(0.5);
    this.box = { center, half, basis };
    for (const x of [-1, 0, 1])
      for (const y of [-1, 0, 1])
        for (const z of [-1, 0, 1]) {
          const mask = new THREE.Vector3(x, y, z);
          if (!x && !y && !z) continue;
          // skip grips along flat dimensions (e.g. a face drawn on the ground has no height)
          if ((half.x < 1e-6 && x) || (half.y < 1e-6 && y) || (half.z < 1e-6 && z)) continue;
          this.grips.push({ mask, point: this.gripPoint(mask) });
        }
  }

  private gripPoint(mask: THREE.Vector3): THREE.Vector3 {
    const b = this.box!;
    return new THREE.Vector3(mask.x * b.half.x, mask.y * b.half.y, mask.z * b.half.z).applyMatrix4(b.basis).add(b.center);
  }

  private draw(app: App): void {
    app.vp.clearOverlay();
    if (!this.box) {
      app.setHint('Select a group, component or some geometry first, then choose Scale.');
      return;
    }
    const c: THREE.Vector3[] = [];
    for (const z of [-1, 1]) for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) c.push(this.gripPoint(new THREE.Vector3(x, y, z)));
    app.vp.overlayLines([...segs(c.slice(0, 4), true), ...segs(c.slice(4), true), ...[0, 1, 2, 3].flatMap((i) => segs([c[i], c[i + 4]]))], 0xd97706, 1.2, false, false);
    const pos: number[] = [];
    const hov: number[] = [];
    for (const g of this.grips) {
      const r = app.vp.worldPerPixel(g.point) * 4;
      const arr = g === this.hover ? hov : pos;
      for (const ax of [new THREE.Vector3(r, 0, 0), new THREE.Vector3(0, r, 0), new THREE.Vector3(0, 0, r)]) {
        const a = g.point.clone().sub(ax);
        const b = g.point.clone().add(ax);
        arr.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
    }
    app.vp.overlayLines(pos, 0x16a34a, 4);
    if (hov.length) app.vp.overlayLines(hov, 0xdc2626, 6);
  }

  private nearestGrip(app: App, e: ToolEvent): Grip | null {
    let best: { d: number; g: Grip } | null = null;
    for (const g of this.grips) {
      const s = app.vp.project(g.point);
      const d = Math.hypot(s.x - e.x, s.y - e.y);
      if (!s.behind && d < 12 && (!best || d < best.d)) best = { d, g };
    }
    return best?.g ?? null;
  }

  pointerMove(e: ToolEvent, app: App): void {
    if (!this.op) {
      const g = this.nearestGrip(app, e);
      if (g !== this.hover) {
        this.hover = g;
        this.draw(app);
        app.setHint(g ? (Math.abs(g.mask.x) + Math.abs(g.mask.y) + Math.abs(g.mask.z) === 3 ? 'Uniform scale (corner)' : 'Stretch') : this.hint);
      }
      return;
    }
    const { grip, anchor } = this.op;
    const dir = grip.point.clone().sub(anchor);
    const len = dir.length();
    if (len < 1e-9) return;
    const t = closestParamOnLine(anchor, dir.clone().normalize(), e.ray.origin, e.ray.direction) / len;
    this.apply(app, t);
  }

  private factorVector(t: number): THREE.Vector3 {
    const m = this.op!.grip.mask;
    return new THREE.Vector3(m.x ? t : 1, m.y ? t : 1, m.z ? t : 1);
  }

  private apply(app: App, t: number | THREE.Vector3): void {
    const op = this.op!;
    let f = typeof t === 'number' ? this.factorVector(Math.abs(t) < 1e-4 ? 1e-4 * Math.sign(t || 1) : t) : t;
    const corner = Math.abs(op.grip.mask.x) + Math.abs(op.grip.mask.y) + Math.abs(op.grip.mask.z) === 3;
    if (typeof t === 'number' && corner) f = new THREE.Vector3(t, t, t);
    op.factor = f;
    const b = this.box!;
    const world = new THREE.Matrix4()
      .makeTranslation(op.anchor.x, op.anchor.y, op.anchor.z)
      .multiply(b.basis)
      .multiply(new THREE.Matrix4().makeScale(f.x, f.y, f.z))
      .multiply(b.basis.clone().invert())
      .multiply(new THREE.Matrix4().makeTranslation(-op.anchor.x, -op.anchor.y, -op.anchor.z));
    const sel = { faces: [...app.selection.faces], edges: [...app.selection.edges], groups: [...app.selection.groups] };
    op.live.apply(() => {
      const ctx = app.context;
      const ctxW = ctx.worldMatrix();
      const local = ctxW.clone().invert().multiply(world).multiply(ctxW);
      for (const id of sel.groups) {
        const g = app.doc.findGroup(id);
        if (!g) continue;
        g.matrix.premultiply(local);
        app.doc.bakeScale(g);
      }
      const verts = ctx.mesh.verticesOf(sel.faces, sel.edges);
      ctx.mesh.applyMatrix(verts, local);
      if (local.determinant() < 0) {
        // mirrored geometry: flip every face that moved entirely
        for (const f2 of ctx.mesh.faces.values()) if (ctx.mesh.faceVertexIds(f2).every((v) => verts.has(v))) ctx.mesh.reverseFace(f2);
      }
    });
    const fmt = (x: number) => (Math.round(x * 1000) / 1000).toString();
    app.setVCB(f.x === f.y && f.y === f.z ? fmt(f.x) : `${fmt(f.x)}, ${fmt(f.y)}, ${fmt(f.z)}`);
  }

  pointerDown(e: ToolEvent, app: App): void {
    if (this.op) return this.finish(app);
    if (!this.box) {
      // pick what's under the cursor, like Move does
      const p = pickEntity(app, e, false);
      if (!p) return;
      app.setSelection(p.kind === 'group' ? { groups: [p.id as number] } : p.kind === 'face' ? { faces: [p.id as number] } : { edges: [p.id as string] });
      this.computeBox(app);
      this.draw(app);
      return;
    }
    const g = this.nearestGrip(app, e);
    if (!g) return;
    const anchor = this.aboutCenter ? this.box.center.clone() : this.gripPoint(g.mask.clone().negate());
    this.op = { grip: g, anchor, live: app.live('Scale'), factor: new THREE.Vector3(1, 1, 1), down: { x: e.x, y: e.y } };
  }

  pointerUp(e: ToolEvent, app: App): void {
    if (this.op && Math.hypot(e.x - this.op.down.x, e.y - this.op.down.y) > 6) this.finish(app);
  }

  private finish(app: App): void {
    const op = this.op!;
    this.op = null;
    const f = op.factor;
    if (Math.abs(f.x - 1) < 1e-6 && Math.abs(f.y - 1) < 1e-6 && Math.abs(f.z - 1) < 1e-6) op.live.cancel();
    else op.live.commit();
    this.computeBox(app);
    this.draw(app);
  }

  keyDown(e: KeyboardEvent, app: App): boolean {
    if (e.key === 'Control' || e.key === 'Alt') {
      this.aboutCenter = !this.aboutCenter;
      app.setHint(this.aboutCenter ? 'Scaling about the centre.' : 'Scaling about the opposite grip.');
      return true;
    }
    return false;
  }

  vcb(text: string, app: App): boolean {
    if (!this.op) return false;
    const op = this.op;
    const nums = text.split(/[,;]/).map((x) => x.trim());
    const dims = this.box!.half.clone().multiplyScalar(2);
    const axisSize = (i: number) => [dims.x, dims.y, dims.z][i];
    const active = [op.grip.mask.x, op.grip.mask.y, op.grip.mask.z].map((m, i) => (m ? i : -1)).filter((i) => i >= 0);
    // a value with a unit is a target size along the first active axis
    const toFactor = (s: string, axis: number): number | null => {
      if (/^-?[\d.]+$/.test(s)) return parseFloat(s);
      const len = parseLength(s, app.doc.units);
      return len === null || axisSize(axis) < 1e-9 ? null : len / axisSize(axis);
    };
    let f: THREE.Vector3;
    if (nums.length === 1) {
      const k = toFactor(nums[0], active[0]);
      if (k === null) return false;
      f = this.factorVector(k);
      if (active.length === 3) f.set(k, k, k);
    } else {
      const ks = nums.map((s, i) => toFactor(s, active[i] ?? i));
      if (ks.some((k) => k === null)) return false;
      f = new THREE.Vector3(1, 1, 1);
      active.forEach((ax, i) => f.setComponent(ax, ks[i] ?? 1));
    }
    this.apply(app, f);
    this.finish(app);
    return true;
  }

  cancel(app: App): void {
    if (!this.op) return app.escapeDefault();
    this.op.live.cancel();
    this.op = null;
    this.draw(app);
  }
}

// ---------------------------------------------------------------- Tape measure (with guides)

export class TapeTool implements Tool {
  id = 'tape';
  name = 'Tape Measure';
  icon = icons.tape;
  shortcut = 'T';
  vcbLabel = 'Length';
  hint = 'Click two points to measure. Start on an edge to place a parallel guide line; start on a point to place a guide point. Tap Ctrl/Option to measure without guides. Double-click an edge for a guide along it.';
  private a: THREE.Vector3 | null = null;
  private edgeDir: THREE.Vector3 | null = null;
  private last: THREE.Vector3 | null = null;
  private lock: Axis | null = null;
  guides = true;

  activate(app: App): void {
    this.reset(app);
  }

  private reset(app: App): void {
    this.a = null;
    this.edgeDir = null;
    this.last = null;
    this.lock = null;
    app.vp.clearOverlay();
  }

  /** For parallel guides: the point offset from the start edge, and that offset distance. */
  private parallel(p: THREE.Vector3): { p: THREE.Vector3; dist: number; perp: THREE.Vector3 } {
    const a = this.a!;
    const d = this.edgeDir!;
    const rel = p.clone().sub(a);
    const perp = rel.clone().sub(d.clone().multiplyScalar(rel.dot(d)));
    return { p: a.clone().add(perp), dist: perp.length(), perp };
  }

  pointerMove(e: ToolEvent, app: App): void {
    const inf = app.infer(e, this.a ? { from: this.a, lockAxis: this.lock } : {});
    app.showInference(inf);
    if (!this.a) return;
    this.last = inf.point.clone();
    app.vp.clearOverlay();
    const a = this.a;
    if (this.edgeDir && this.guides) {
      const { p, dist } = this.parallel(inf.point);
      const d = this.edgeDir.clone().multiplyScalar(2000);
      app.vp.overlayLines([...segs([p.clone().sub(d), p.clone().add(d)])], 0x0d9488, 1.2, true, false);
      app.vp.overlayLines(segs([a, p]), 0x111111, 1.6, true);
      app.setVCB(app.fmt(dist));
      return;
    }
    const b = inf.point;
    app.vp.overlayLines(segs([a, b]), lineColor(a, b), 2, true);
    const d = b.clone().sub(a);
    app.setVCB(app.fmt(d.length()));
    app.setHint(`Δ red ${app.fmt(Math.abs(d.x))}   Δ green ${app.fmt(Math.abs(d.y))}   Δ blue ${app.fmt(Math.abs(d.z))}${this.guides ? '' : '   (guides off)'}`);
  }

  pointerDown(e: ToolEvent, app: App): void {
    const inf = app.infer(e, this.a ? { from: this.a, lockAxis: this.lock } : {});
    if (!this.a) {
      this.a = inf.point.clone();
      this.edgeDir = (inf.kind === 'on-edge' || inf.kind === 'midpoint') && inf.edge ? inf.edge.b.clone().sub(inf.edge.a).normalize() : null;
      return;
    }
    this.place(app, inf.point);
  }

  private place(app: App, b: THREE.Vector3): void {
    const a = this.a!;
    if (this.guides) {
      if (this.edgeDir) {
        const { p, dist } = this.parallel(b);
        if (dist > 1e-4) app.doc.transact('Guide', () => app.doc.guides.push({ id: app.doc.nextItemId++, point: v3(p), dir: v3(this.edgeDir!) }));
      } else if (b.distanceTo(a) > 1e-4) {
        app.doc.transact('Guide Point', () => app.doc.guides.push({ id: app.doc.nextItemId++, point: v3(b) }));
      }
    }
    this.toastLength(app, this.edgeDir ? this.parallel(b).dist : a.distanceTo(b));
    this.reset(app);
  }

  private toastLength(app: App, d: number): void {
    app.setVCB(app.fmt(d));
  }

  doubleClick(e: ToolEvent, app: App): void {
    const inf = app.infer(e);
    if (inf.edge && this.guides) {
      const dir = inf.edge.b.clone().sub(inf.edge.a).normalize();
      // replace the half-started measurement from the double-click's first click
      this.reset(app);
      app.doc.transact('Guide', () => app.doc.guides.push({ id: app.doc.nextItemId++, point: v3(inf.edge!.a), dir: v3(dir) }));
    }
  }

  keyDown(e: KeyboardEvent, app: App): boolean {
    if (e.key === 'Control' || e.key === 'Alt') {
      this.guides = !this.guides;
      app.setHint(this.guides ? this.hint : 'Measuring only: no guides will be created.');
      return true;
    }
    const a = axisFromKey(e, this.lock);
    if (a === undefined) return false;
    this.lock = a;
    return true;
  }

  vcb(text: string, app: App): boolean {
    const v = parseLength(text, app.doc.units);
    if (v === null || !this.a || !this.last) return false;
    if (this.edgeDir) {
      const { perp } = this.parallel(this.last);
      if (perp.lengthSq() < 1e-12) return false;
      this.place(app, this.a.clone().add(perp.normalize().multiplyScalar(v)));
      return true;
    }
    const dir = this.last.clone().sub(this.a);
    if (dir.lengthSq() < 1e-12) return false;
    this.place(app, this.a.clone().add(dir.normalize().multiplyScalar(v)));
    return true;
  }

  cancel(app: App): void {
    if (!this.a) return app.escapeDefault();
    this.reset(app);
    app.setHint(this.hint);
  }
}

// ---------------------------------------------------------------- Dimension

export class DimensionTool implements Tool {
  id = 'dimension';
  name = 'Dimension';
  icon = icons.dimension;
  shortcut = '';
  vcbLabel = 'Length';
  hint = 'Click two points (or an edge), then move out and click to place the dimension. Double-click an edge to dimension it directly.';
  private a: THREE.Vector3 | null = null;
  private b: THREE.Vector3 | null = null;
  private offset = new THREE.Vector3();

  activate(): void {
    this.a = this.b = null;
  }

  private offsetFor(app: App, e: ToolEvent): THREE.Vector3 {
    const a = this.a!;
    const b = this.b!;
    const ab = b.clone().sub(a).normalize();
    const view = new THREE.Vector3();
    app.vp.persp.getWorldDirection(view);
    let n = new THREE.Vector3().crossVectors(ab, view).cross(ab).normalize();
    if (n.lengthSq() < 0.5) n = new THREE.Vector3(0, 0, 1);
    const q = e.ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(n, a), new THREE.Vector3());
    if (!q) return this.offset;
    const rel = q.sub(a);
    return rel.sub(ab.multiplyScalar(rel.dot(ab)));
  }

  private preview(app: App): void {
    app.vp.clearOverlay();
    const a2 = this.a!.clone().add(this.offset);
    const b2 = this.b!.clone().add(this.offset);
    app.vp.overlayLines([...segs([this.a!, a2]), ...segs([this.b!, b2]), ...segs([a2, b2])], 0x1f2937, 1.4, false);
    app.setVCB(app.fmt(this.a!.distanceTo(this.b!)));
  }

  pointerMove(e: ToolEvent, app: App): void {
    if (this.a && this.b) {
      this.offset = this.offsetFor(app, e);
      return this.preview(app);
    }
    const inf = app.infer(e, this.a ? { from: this.a } : {});
    app.showInference(inf);
    if (this.a) {
      app.vp.clearOverlay();
      app.vp.overlayLines(segs([this.a, inf.point]), lineColor(this.a, inf.point), 1.6, true);
      app.setVCB(app.fmt(this.a.distanceTo(inf.point)));
    }
  }

  pointerDown(e: ToolEvent, app: App): void {
    if (this.a && this.b) {
      const d = { id: app.doc.nextItemId++, a: v3(this.a), b: v3(this.b), offset: v3(this.offset) };
      app.doc.transact('Dimension', () => app.doc.dimensions.push(d));
      this.a = this.b = null;
      app.vp.clearOverlay();
      return;
    }
    const inf = app.infer(e, this.a ? { from: this.a } : {});
    if (!this.a) {
      // clicking the middle of an edge dimensions the whole edge
      if (inf.kind === 'on-edge' && inf.edge) {
        this.a = inf.edge.a.clone();
        this.b = inf.edge.b.clone();
        this.offset = new THREE.Vector3();
        return;
      }
      this.a = inf.point.clone();
      return;
    }
    if (inf.point.distanceTo(this.a) < 1e-4) return;
    this.b = inf.point.clone();
    this.offset = new THREE.Vector3();
  }

  cancel(app: App): void {
    if (!this.a) return app.escapeDefault();
    this.a = this.b = null;
    app.vp.clearOverlay();
  }
}

// ---------------------------------------------------------------- Section plane

export class SectionTool implements Tool {
  id = 'section';
  name = 'Section Plane';
  icon = icons.section;
  shortcut = '';
  vcbLabel = 'Depth';
  hint = 'Click a face to place a section plane on it, move to set how deep it cuts, then click. Type a depth. Toggle cuts in View → Section Cut.';
  private op: { point: THREE.Vector3; n: THREE.Vector3; d: number } | null = null;

  pointerMove(e: ToolEvent, app: App): void {
    if (!this.op) {
      const hit = app.vp.raycastFaces(e.ray);
      app.vp.clearOverlay();
      if (hit) this.outline(app, hit.point, hit.normal);
      return;
    }
    const d = -closestParamOnLine(this.op.point, this.op.n, e.ray.origin, e.ray.direction);
    this.op.d = Math.max(0, d);
    app.vp.clearOverlay();
    this.outline(app, this.op.point.clone().addScaledVector(this.op.n, -this.op.d), this.op.n);
    app.setVCB(app.fmt(this.op.d));
  }

  private outline(app: App, p: THREE.Vector3, n: THREE.Vector3): void {
    const { u, v } = planeBasis(n);
    const r = app.vp.worldPerPixel(p) * 60;
    const c = [
      [-r, -r],
      [r, -r],
      [r, r],
      [-r, r],
    ].map(([x, y]) => p.clone().add(u.clone().multiplyScalar(x)).add(v.clone().multiplyScalar(y)));
    app.vp.overlayLines(segs(c, true), 0xea580c, 2);
    app.vp.overlayPolygon(c, 0xea580c, 0.12);
  }

  pointerDown(e: ToolEvent, app: App): void {
    if (!this.op) {
      const hit = app.vp.raycastFaces(e.ray);
      if (!hit) return;
      this.op = { point: hit.point.clone(), n: hit.normal.clone().normalize(), d: 0 };
      return;
    }
    this.place(app);
  }

  private place(app: App): void {
    const op = this.op!;
    this.op = null;
    app.vp.clearOverlay();
    const point = op.point.clone().addScaledVector(op.n, -Math.max(op.d, 0.01));
    app.doc.transact('Section Plane', () => {
      for (const s of app.doc.sections) s.active = false;
      app.doc.sections.push({ id: app.doc.nextItemId++, point: v3(point), normal: v3(op.n), active: true });
    });
  }

  vcb(text: string, app: App): boolean {
    const v = parseLength(text, app.doc.units);
    if (v === null || !this.op) return false;
    this.op.d = Math.abs(v);
    this.place(app);
    return true;
  }

  cancel(app: App): void {
    if (!this.op) return app.escapeDefault();
    this.op = null;
    app.vp.clearOverlay();
  }
}

