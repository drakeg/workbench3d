import * as THREE from 'three';
import { Group } from '../core/document';
import { closestParamOnLine } from '../core/geom';
import { COLORS, Viewport, isHidden } from './viewport';

export type Axis = 'x' | 'y' | 'z';
export type InferKind = 'endpoint' | 'midpoint' | 'on-edge' | 'on-face' | 'axis' | 'ground' | 'plane' | 'free';

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
}

export interface InferOptions {
  /** Start point of the current operation: enables axis inference. */
  from?: THREE.Vector3;
  lockAxis?: Axis | null;
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

  // Locked axis: everything is projected onto the axis line through `from`.
  if (opts.from && opts.lockAxis) {
    const dir = AXES[opts.lockAxis];
    let p: THREE.Vector3;
    if (bestV) p = opts.from.clone().add(dir.clone().multiplyScalar(bestV.p.clone().sub(opts.from).dot(dir)));
    else p = opts.from.clone().add(dir.clone().multiplyScalar(closestParamOnLine(opts.from, dir, ray.origin, ray.direction)));
    return { point: p, kind: 'axis', axis: opts.lockAxis, label: AXIS_NAMES[opts.lockAxis] + ' (locked)', color: cssColor(AXIS_COLORS[opts.lockAxis]) };
  }

  if (bestV) return onPlane({ point: bestV.p.clone(), kind: 'endpoint', label: 'Endpoint', color: '#16a34a', group: bestV.g, vertexId: bestV.id });
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
    let best: { d: number; p: THREE.Vector3; axis: Axis } | null = null;
    for (const axis of ['x', 'y', 'z'] as Axis[]) {
      if (opts.plane && Math.abs(opts.plane.normal.dot(AXES[axis])) > 0.01) continue;
      const dir = AXES[axis];
      const t = closestParamOnLine(opts.from, dir, ray.origin, ray.direction);
      const p = opts.from.clone().add(dir.clone().multiplyScalar(t));
      const s = vp.project(p);
      if (s.behind) continue;
      const d = Math.hypot(s.x - x, s.y - y);
      if (d < AXIS_PX && (!best || d < best.d) && Math.abs(t) > 1e-6) best = { d, p, axis };
    }
    if (best) return { point: best.p, kind: 'axis', axis: best.axis, label: AXIS_NAMES[best.axis], color: cssColor(AXIS_COLORS[best.axis]) };
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
