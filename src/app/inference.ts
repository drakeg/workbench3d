import * as THREE from 'three';
import { Group } from '../core/document';
import { closestParamOnLine } from '../core/geom';
import { COLORS, Viewport, isHidden } from './viewport';

export type Axis = 'x' | 'y' | 'z';
export type InferKind = 'endpoint' | 'midpoint' | 'on-edge' | 'on-face' | 'axis' | 'parallel' | 'perpendicular' | 'from-point' | 'ground' | 'plane' | 'free';

export interface Inference {
  point: THREE.Vector3;
  kind: InferKind;
  label: string;
  color: string;
  group?: Group;
  faceId?: number;
  vertexId?: number;
  edge?: { key: string; a: THREE.Vector3; b: THREE.Vector3 };
  /** World normal of the face under the cursor, if any. */
  normal?: THREE.Vector3;
  axis?: Axis;
  /** Direction from the start point this inference follows (axis, parallel...). */
  dir?: THREE.Vector3;
  /** Dotted helper line to draw (e.g. for "From Point"). */
  guide?: [THREE.Vector3, THREE.Vector3];
}

export interface InferOptions {
  /** Start point of the current operation: enables axis inference. */
  from?: THREE.Vector3;
  lockAxis?: Axis | null;
  /** Lock to any direction from `from` (Shift-lock). Overrides lockAxis. */
  lockDir?: THREE.Vector3 | null;
  /** Guide lines (dir set) and guide points (no dir), in world space. */
  guides?: { point: THREE.Vector3; dir?: THREE.Vector3 }[];
  /** Constrain the result to this plane (endpoints are projected onto it). */
  plane?: THREE.Plane;
  /** Skip vertices/edges of these groups (e.g. a group being moved). */
  excludeGroups?: Set<number>;
  /** Skip specific vertices (e.g. geometry being moved), keyed `${groupId}:${vertexId}`. */
  excludeVerts?: Set<string>;
  noFaces?: boolean;
}

export const AXES: Record<Axis, THREE.Vector3> = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
};
const AXIS_NAMES: Record<Axis, string> = { x: 'On Red Axis', y: 'On Green Axis', z: 'On Blue Axis' };
export const AXIS_COLORS: Record<Axis, number> = { x: COLORS.axisX, y: COLORS.axisY, z: COLORS.axisZ };

const SNAP_PX = 11;
const EDGE_PX = 7;
const AXIS_PX = 10;

/**
 * Work out the 3D point the user means: snap to endpoints, midpoints and edges,
 * lock to the red/green/blue axes, fall back to faces and the ground plane.
 */
export function infer(x: number, y: number, root: Group, vp: Viewport, opts: InferOptions = {}): Inference {
  const ray = vp.ray(x, y);
  const mouse = new THREE.Vector2(x, y);
  const hit = opts.noFaces ? null : vp.raycastFaces(ray, (g) => !opts.excludeGroups?.has(g.id));
  // Geometry behind the face under the cursor shouldn't win snaps.
  const maxDepth = hit ? hit.distance + vp.worldPerPixel(hit.point) * 4 : Infinity;

  let bestV: { d: number; p: THREE.Vector3; g: Group; id: number } | null = null;
  let bestMid: { d: number; p: THREE.Vector3; g: Group; key: string; a: THREE.Vector3; b: THREE.Vector3 } | null = null;
  let bestEdge: { d: number; p: THREE.Vector3; g: Group; key: string; a: THREE.Vector3; b: THREE.Vector3 } | null = null;

  for (const g of root.walk()) {
    if (isHidden(g) || opts.excludeGroups?.has(g.id)) continue;
    const m = g.worldMatrix();
    const world = new Map<number, THREE.Vector3>();
    const screen = new Map<number, { x: number; y: number; behind: boolean }>();
    for (const [id, p] of g.mesh.verts) {
      const w = p.clone().applyMatrix4(m);
      world.set(id, w);
      screen.set(id, vp.project(w));
    }
    for (const [id, s] of screen) {
      if (s.behind || opts.excludeVerts?.has(`${g.id}:${id}`)) continue;
      const d = Math.hypot(s.x - x, s.y - y);
      if (d < SNAP_PX && (!bestV || d < bestV.d)) {
        const w = world.get(id)!;
        if (w.distanceTo(ray.origin) <= maxDepth) bestV = { d, p: w, g, id };
      }
    }
    for (const [key, [a, b]] of g.mesh.allEdges()) {
      if (opts.excludeVerts?.has(`${g.id}:${a}`) || opts.excludeVerts?.has(`${g.id}:${b}`)) continue;
      const sa = screen.get(a)!;
      const sb = screen.get(b)!;
      if (sa.behind || sb.behind) continue;
      const A = new THREE.Vector2(sa.x, sa.y);
      const B = new THREE.Vector2(sb.x, sb.y);
      const AB = B.clone().sub(A);
      const t = Math.max(0, Math.min(1, mouse.clone().sub(A).dot(AB) / Math.max(AB.lengthSq(), 1e-9)));
      const d = A.clone().add(AB.multiplyScalar(t)).distanceTo(mouse);
      if (d > EDGE_PX) continue;
      const wa = world.get(a)!;
      const wb = world.get(b)!;
      const mid = wa.clone().add(wb).multiplyScalar(0.5);
      const ms = vp.project(mid);
      const md = Math.hypot(ms.x - x, ms.y - y);
      if (md < SNAP_PX && (!bestMid || md < bestMid.d) && mid.distanceTo(ray.origin) <= maxDepth)
        bestMid = { d: md, p: mid, g, key, a: wa, b: wb };
      // 3D point on the edge closest to the cursor ray
      const dir = wb.clone().sub(wa);
      let s = closestParamOnLine(wa, dir, ray.origin, ray.direction);
      s = Math.max(0, Math.min(1, s));
      const p = wa.clone().add(dir.multiplyScalar(s));
      if ((!bestEdge || d < bestEdge.d) && p.distanceTo(ray.origin) <= maxDepth) bestEdge = { d, p, g, key, a: wa, b: wb };
    }
  }

  const onPlane = (r: Inference): Inference => {
    if (opts.plane) r.point = opts.plane.projectPoint(r.point, new THREE.Vector3());
    return r;
  };

  // Guides: guide points act like endpoints, guide lines like (infinite) edges.
  let bestGuideLine: { d: number; p: THREE.Vector3 } | null = null;
  for (const gd of opts.guides ?? []) {
    if (!gd.dir) {
      const s = vp.project(gd.point);
      const d = Math.hypot(s.x - x, s.y - y);
      if (!s.behind && d < SNAP_PX && (!bestV || d < bestV.d)) bestV = { d, p: gd.point.clone(), g: root, id: -1 };
      continue;
    }
    const t = closestParamOnLine(gd.point, gd.dir, ray.origin, ray.direction);
    const p = gd.point.clone().add(gd.dir.clone().multiplyScalar(t));
    const s = vp.project(p);
    const d = Math.hypot(s.x - x, s.y - y);
    if (!s.behind && d < EDGE_PX && (!bestGuideLine || d < bestGuideLine.d)) bestGuideLine = { d, p };
  }

  // remember what the cursor touched, for parallel and "from point" inferences later
  if (bestV && bestV.id !== -1) hints.point = bestV.p.clone();
  const edgeSeen = bestMid ?? bestEdge;
  if (edgeSeen && edgeSeen.a.distanceTo(edgeSeen.b) > 1e-6) hints.edge = { a: edgeSeen.a.clone(), b: edgeSeen.b.clone() };

  // Locked direction (arrow keys or Shift): everything is projected onto the line through `from`.
  const lockDir = opts.lockDir ?? (opts.lockAxis ? AXES[opts.lockAxis] : null);
  if (opts.from && lockDir) {
    const dir = lockDir.clone().normalize();
    let p: THREE.Vector3;
    if (bestV) p = opts.from.clone().add(dir.clone().multiplyScalar(bestV.p.clone().sub(opts.from).dot(dir)));
    else p = opts.from.clone().add(dir.clone().multiplyScalar(closestParamOnLine(opts.from, dir, ray.origin, ray.direction)));
    const ax = alignedAxis(dir);
    return {
      point: p,
      kind: 'axis',
      axis: ax ?? undefined,
      dir,
      label: (ax ? AXIS_NAMES[ax] : 'Along Direction') + ' (locked)',
      color: ax ? cssColor(AXIS_COLORS[ax]) : MAGENTA,
    };
  }

  if (bestV) return onPlane({ point: bestV.p.clone(), kind: 'endpoint', label: bestV.id === -1 ? 'Guide Point' : 'Endpoint', color: '#16a34a', group: bestV.g, vertexId: bestV.id === -1 ? undefined : bestV.id });
  if (bestMid)
    return onPlane({
      point: bestMid.p.clone(),
      kind: 'midpoint',
      label: 'Midpoint',
      color: '#0891b2',
      group: bestMid.g,
      edge: { key: bestMid.key, a: bestMid.a, b: bestMid.b },
    });

  if (opts.from) {
    // candidate directions from the start point: the three axes, plus parallel/perpendicular to the last edge touched
    const dirs: { dir: THREE.Vector3; axis?: Axis; label: string; color: string; kind: InferKind }[] = (['x', 'y', 'z'] as Axis[]).map((a) => ({
      dir: AXES[a],
      axis: a,
      label: AXIS_NAMES[a],
      color: cssColor(AXIS_COLORS[a]),
      kind: 'axis' as InferKind,
    }));
    if (hints.edge) {
      const ed = hints.edge.b.clone().sub(hints.edge.a).normalize();
      if (!alignedAxis(ed)) {
        dirs.push({ dir: ed, label: 'Parallel to Edge', color: MAGENTA, kind: 'parallel' });
        // perpendicular in the horizontal plane, or vertical-plane perpendicular for sloped edges
        const up = Math.abs(ed.z) > 0.999 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
        const perp = new THREE.Vector3().crossVectors(ed, up).normalize();
        if (perp.lengthSq() > 0.5) dirs.push({ dir: perp, label: 'Perpendicular to Edge', color: MAGENTA, kind: 'perpendicular' });
      }
    }
    let best: { d: number; p: THREE.Vector3; c: (typeof dirs)[number] } | null = null;
    for (const c of dirs) {
      if (opts.plane && Math.abs(opts.plane.normal.dot(c.dir)) > 0.01) continue;
      const t = closestParamOnLine(opts.from, c.dir, ray.origin, ray.direction);
      const p = opts.from.clone().add(c.dir.clone().multiplyScalar(t));
      const s = vp.project(p);
      if (s.behind) continue;
      const d = Math.hypot(s.x - x, s.y - y);
      if (d < AXIS_PX && (!best || d < best.d) && Math.abs(t) > 1e-6) best = { d, p, c };
    }
    if (best) {
      // "From point": slide along the direction until level with a point the cursor touched earlier
      if (hints.point && best.c.axis) {
        const dir = best.c.dir;
        const q = opts.from.clone().add(dir.clone().multiplyScalar(hints.point.clone().sub(opts.from).dot(dir)));
        const s = vp.project(q);
        if (!s.behind && Math.hypot(s.x - x, s.y - y) < SNAP_PX && q.distanceTo(hints.point) > 1e-4 && q.distanceTo(opts.from) > 1e-4)
          return { point: q, kind: 'from-point', axis: best.c.axis, dir, label: 'From Point', color: best.c.color, guide: [hints.point.clone(), q] };
      }
      return { point: best.p, kind: best.c.kind, axis: best.c.axis, dir: best.c.dir, label: best.c.label, color: best.c.color };
    }
  }

  if (bestEdge)
    return onPlane({
      point: bestEdge.p.clone(),
      kind: 'on-edge',
      label: 'On Edge',
      color: '#dc2626',
      group: bestEdge.g,
      edge: { key: bestEdge.key, a: bestEdge.a, b: bestEdge.b },
    });
  if (bestGuideLine) return onPlane({ point: bestGuideLine.p, kind: 'on-edge', label: 'On Guide', color: '#0d9488' });

  if (opts.plane) {
    const p = ray.intersectPlane(opts.plane, new THREE.Vector3());
    if (p) return { point: p, kind: 'plane', label: '', color: '#64748b', normal: opts.plane.normal.clone() };
  }

  if (hit) return { point: hit.point, kind: 'on-face', label: 'On Face', color: '#2563eb', group: hit.group, faceId: hit.faceId, normal: hit.normal };

  const groundZ = opts.from ? opts.from.z : 0;
  const ground = new THREE.Plane(new THREE.Vector3(0, 0, 1), -groundZ);
  const gp = ray.intersectPlane(ground, new THREE.Vector3());
  if (gp && gp.distanceTo(ray.origin) < 1e5) return { point: gp, kind: 'ground', label: '', color: '#64748b', normal: new THREE.Vector3(0, 0, 1) };
  return { point: ray.at(100, new THREE.Vector3()), kind: 'free', label: '', color: '#64748b' };
}

const MAGENTA = '#c026d3';

/** What the cursor touched recently: used for parallel and "from point" inference. */
export const hints: { edge: { a: THREE.Vector3; b: THREE.Vector3 } | null; point: THREE.Vector3 | null } = { edge: null, point: null };

export function cssColor(c: number): string {
  return '#' + c.toString(16).padStart(6, '0');
}

/** Which axis (if any) a direction is aligned with. */
export function alignedAxis(d: THREE.Vector3): Axis | null {
  const n = d.clone().normalize();
  if (Math.abs(n.x) > 0.9999) return 'x';
  if (Math.abs(n.y) > 0.9999) return 'y';
  if (Math.abs(n.z) > 0.9999) return 'z';
  return null;
}
