import { ShapeUtils, Vector2, Vector3 } from 'three';

/** Distance tolerance in inches used for welding and coplanarity. */
export const TOL = 1e-3;
export const ANG_TOL = 1e-6;

/** Newell's method: robust normal for a (possibly non-convex) planar polygon. Not normalized. */
export function newellNormal(pts: Vector3[]): Vector3 {
  const n = new Vector3();
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    n.x += (a.y - b.y) * (a.z + b.z);
    n.y += (a.z - b.z) * (a.x + b.x);
    n.z += (a.x - b.x) * (a.y + b.y);
  }
  return n;
}

export function polygonNormal(pts: Vector3[]): Vector3 {
  const n = newellNormal(pts);
  const len = n.length();
  return len < 1e-12 ? new Vector3(0, 0, 1) : n.divideScalar(len);
}

export function polygonArea(pts: Vector3[]): number {
  return newellNormal(pts).length() / 2;
}

/** An orthonormal in-plane basis (u, v) for normal n, aligned with world axes where possible. */
export function planeBasis(n: Vector3): { u: Vector3; v: Vector3 } {
  const nn = n.clone().normalize();
  // Prefer world X as u, unless the plane is nearly perpendicular to X.
  let ref = Math.abs(nn.x) < 0.9 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);
  // For vertical faces, keep v pointing up (world Z).
  if (Math.abs(nn.z) < 0.9) {
    const v = new Vector3(0, 0, 1).sub(nn.clone().multiplyScalar(nn.z)).normalize();
    const u = new Vector3().crossVectors(v, nn).normalize();
    return { u, v };
  }
  const u = ref.sub(nn.clone().multiplyScalar(ref.dot(nn))).normalize();
  const v = new Vector3().crossVectors(nn, u).normalize();
  return { u, v };
}

export function to2D(pts: Vector3[], origin: Vector3, u: Vector3, v: Vector3): Vector2[] {
  return pts.map((p) => {
    const d = p.clone().sub(origin);
    return new Vector2(d.dot(u), d.dot(v));
  });
}

export function pointInPolygon2D(p: Vector2, poly: Vector2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function distPointSegment2D(p: Vector2, a: Vector2, b: Vector2): number {
  const ab = b.clone().sub(a);
  const t = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / Math.max(ab.lengthSq(), 1e-18)));
  return a.clone().add(ab.multiplyScalar(t)).distanceTo(p);
}

export function closestPointOnSegment(p: Vector3, a: Vector3, b: Vector3): { point: Vector3; t: number } {
  const ab = b.clone().sub(a);
  const t = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / Math.max(ab.lengthSq(), 1e-18)));
  return { point: a.clone().add(ab.multiplyScalar(t)), t };
}

/**
 * Triangulate a polygon with holes. Returns index triples into [...outer, ...holes.flat()].
 */
export function triangulate(outer: Vector2[], holes: Vector2[][]): number[][] {
  return ShapeUtils.triangulateShape(outer, holes);
}

/** Closest points between an infinite line (p + t d) and a ray/line (q + s e). Returns parameter t on the first line. */
export function closestParamOnLine(p: Vector3, d: Vector3, q: Vector3, e: Vector3): number {
  const r = p.clone().sub(q);
  const a = d.dot(d);
  const b = d.dot(e);
  const c = e.dot(e);
  const dd = d.dot(r);
  const f = e.dot(r);
  const den = a * c - b * b;
  if (Math.abs(den) < 1e-12) return 0;
  return (b * f - c * dd) / den;
}
