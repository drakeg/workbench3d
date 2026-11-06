import { Box3, Matrix4, Vector2, Vector3 } from 'three';
import {
  TOL,
  closestPointOnSegment,
  planeBasis,
  pointInPolygon2D,
  polygonArea,
  polygonNormal,
  to2D,
  triangulate,
  distPointSegment2D,
} from './geom';

/**
 * A planar face: one outer loop and zero or more hole loops, each a list of vertex ids.
 * Convention: the outer loop winds counter-clockwise around the face normal,
 * holes wind the opposite way.
 */
export interface Face {
  id: number;
  outer: number[];
  holes: number[][];
  color?: string;
}

export interface MeshJSON {
  nextId: number;
  verts: [number, number, number, number][];
  faces: { id: number; outer: number[]; holes: number[][]; color?: string }[];
  lines: [number, number][];
}

export function edgeKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

export function parseEdgeKey(k: string): [number, number] {
  const [a, b] = k.split(':').map(Number);
  return [a, b];
}

function loopEdges(loop: number[]): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < loop.length; i++) out.push([loop[i], loop[(i + 1) % loop.length]]);
  return out;
}

/**
 * The editable geometry of one context (the model root or the inside of a group).
 * Geometry is "sticky": faces that share vertices and edges are connected, so moving
 * an edge stretches every face that uses it. Put parts in groups to keep them apart.
 */
export class Mesh {
  verts = new Map<number, Vector3>();
  faces = new Map<number, Face>();
  /** Edges that are not (yet) part of any face, stored as edge keys. */
  lines = new Set<string>();
  nextId = 1;

  // ---------- basic queries ----------

  v(id: number): Vector3 {
    const p = this.verts.get(id);
    if (!p) throw new Error(`Missing vertex ${id}`);
    return p;
  }

  loopPoints(loop: number[]): Vector3[] {
    return loop.map((id) => this.v(id));
  }

  normal(face: Face): Vector3 {
    return polygonNormal(this.loopPoints(face.outer));
  }

  area(face: Face): number {
    let a = polygonArea(this.loopPoints(face.outer));
    for (const h of face.holes) a -= polygonArea(this.loopPoints(h));
    return a;
  }

  faceVertexIds(face: Face): number[] {
    return [...face.outer, ...face.holes.flat()];
  }

  faceEdgeKeys(face: Face): string[] {
    const keys: string[] = [];
    for (const loop of [face.outer, ...face.holes]) for (const [a, b] of loopEdges(loop)) keys.push(edgeKey(a, b));
    return keys;
  }

  /** Every edge in the mesh (face edges and loose lines), keyed by edge key. */
  allEdges(): Map<string, [number, number]> {
    const m = new Map<string, [number, number]>();
    for (const f of this.faces.values()) for (const k of this.faceEdgeKeys(f)) if (!m.has(k)) m.set(k, parseEdgeKey(k));
    for (const k of this.lines) if (!m.has(k)) m.set(k, parseEdgeKey(k));
    return m;
  }

  facesUsingEdge(key: string): Face[] {
    const out: Face[] = [];
    for (const f of this.faces.values()) if (this.faceEdgeKeys(f).includes(key)) out.push(f);
    return out;
  }

  facesUsingVertex(id: number): Face[] {
    const out: Face[] = [];
    for (const f of this.faces.values()) if (this.faceVertexIds(f).includes(id)) out.push(f);
    return out;
  }

  edgeUsed(key: string): boolean {
    if (this.lines.has(key)) return true;
    for (const f of this.faces.values()) if (this.faceEdgeKeys(f).includes(key)) return true;
    return false;
  }

  /** 2D projection helpers for a face. */
  faceFrame(face: Face) {
    const n = this.normal(face);
    const { u, v } = planeBasis(n);
    const origin = this.v(face.outer[0]).clone();
    return { n, u, v, origin };
  }

  /** True if p (assumed on the face plane) is strictly inside the face (outside its holes). */
  pointInFace(face: Face, p: Vector3, margin = TOL): boolean {
    const { n, u, v, origin } = this.faceFrame(face);
    if (Math.abs(p.clone().sub(origin).dot(n)) > TOL * 10) return false;
    const [p2] = to2D([p], origin, u, v);
    const outer2 = to2D(this.loopPoints(face.outer), origin, u, v);
    if (!pointInPolygon2D(p2, outer2)) return false;
    if (minDistToLoop(p2, outer2) < margin) return false;
    for (const h of face.holes) {
      const h2 = to2D(this.loopPoints(h), origin, u, v);
      if (pointInPolygon2D(p2, h2) || minDistToLoop(p2, h2) < margin) return false;
    }
    return true;
  }

  isCoplanar(face: Face, pts: Vector3[]): boolean {
    const n = this.normal(face);
    const o = this.v(face.outer[0]);
    return pts.every((p) => Math.abs(p.clone().sub(o).dot(n)) < TOL * 10);
  }

  // ---------- creation ----------

  newVertex(p: Vector3): number {
    const id = this.nextId++;
    this.verts.set(id, p.clone());
    return id;
  }

  findVertex(p: Vector3, tol = TOL): number | undefined {
    for (const [id, q] of this.verts) if (q.distanceTo(p) < tol) return id;
    return undefined;
  }

  /** Insert vertex v into every loop and line that uses edge a-b. */
  splitEdge(a: number, b: number, v: number): void {
    const key = edgeKey(a, b);
    for (const f of this.faces.values()) {
      for (const loop of [f.outer, ...f.holes]) {
        for (let i = 0; i < loop.length; i++) {
          const x = loop[i];
          const y = loop[(i + 1) % loop.length];
          if ((x === a && y === b) || (x === b && y === a)) {
            loop.splice(i + 1, 0, v);
            break;
          }
        }
      }
    }
    if (this.lines.delete(key)) {
      this.lines.add(edgeKey(a, v));
      this.lines.add(edgeKey(v, b));
    }
  }

  /**
   * Get a vertex at p: reuse an existing vertex, or split an existing edge that passes
   * through p, or create a new vertex.
   */
  vertexAt(p: Vector3): number {
    const existing = this.findVertex(p);
    if (existing !== undefined) return existing;
    for (const [, [a, b]] of this.allEdges()) {
      const { point, t } = closestPointOnSegment(p, this.v(a), this.v(b));
      if (t > 0 && t < 1 && point.distanceTo(p) < TOL) {
        const id = this.newVertex(p);
        this.splitEdge(a, b, id);
        return id;
      }
    }
    return this.newVertex(p);
  }

  /** Create a face from vertex loops, normalizing winding. Loose lines on its edges are absorbed. */
  addFace(outer: number[], holes: number[][] = [], color?: string): Face {
    const n = polygonNormal(this.loopPoints(outer));
    const fixedHoles = holes.map((h) => {
      const hn = polygonNormal(this.loopPoints(h));
      return hn.dot(n) > 0 ? [...h].reverse() : [...h];
    });
    const face: Face = { id: this.nextId++, outer: [...outer], holes: fixedHoles, color };
    this.faces.set(face.id, face);
    for (const k of this.faceEdgeKeys(face)) this.lines.delete(k);
    return face;
  }

  /** Reverse a face's orientation. */
  reverseFace(face: Face): void {
    face.outer.reverse();
    for (const h of face.holes) h.reverse();
  }

  /**
   * Draw a closed polygon (rectangle, circle...). If it lies strictly inside an existing
   * coplanar face, it becomes a hole in that face plus a new inner face, so it can be
   * push/pulled into a pocket or boss. Otherwise its edges are added as lines, which may
   * split faces or close new faces. Returns the new face, if one was created.
   */
  addPolygon(points: Vector3[]): Face | null {
    if (points.length < 3 || polygonArea(points) < TOL * TOL) return null;
    const host = this.findHostFace(points);
    if (host) {
      const hostN = this.normal(host);
      const ids = points.map((p) => this.newVertex(p));
      const n = polygonNormal(points);
      const loop = n.dot(hostN) > 0 ? ids : [...ids].reverse();
      host.holes.push([...loop].reverse());
      return this.addFace(loop, [], host.color);
    }
    const ids = points.map((p) => this.vertexAt(p));
    const before = new Set(this.faces.keys());
    for (let i = 0; i < ids.length; i++) this.addLine(ids[i], ids[(i + 1) % ids.length]);
    // Find a face created from exactly this loop, or create it if the lines are still loose.
    const idSet = new Set(ids);
    for (const f of this.faces.values()) {
      if (!before.has(f.id) && f.outer.length === ids.length && f.outer.every((x) => idSet.has(x))) return this.orientGround(f);
    }
    const allLoose = loopEdges(ids).every(([a, b]) => this.lines.has(edgeKey(a, b)));
    if (allLoose) return this.orientGround(this.addFace(ids));
    return null;
  }

  /** Faces lying on the ground (z = 0) point down, like most modelers, so pulling them up builds outward faces. */
  private orientGround(f: Face): Face {
    const n = this.normal(f);
    const onGround = this.loopPoints(f.outer).every((p) => Math.abs(p.z) < TOL);
    if (onGround && n.z > 0.999) this.reverseFace(f);
    return f;
  }

  findHostFace(points: Vector3[]): Face | null {
    for (const f of this.faces.values()) {
      if (!this.isCoplanar(f, points)) continue;
      if (points.every((p) => this.pointInFace(f, p))) {
        // also make sure no edge of the face crosses the polygon (convex enough check via midpoints)
        let ok = true;
        for (let i = 0; i < points.length && ok; i++) {
          const m = points[i].clone().add(points[(i + 1) % points.length]).multiplyScalar(0.5);
          if (!this.pointInFace(f, m)) ok = false;
        }
        if (ok) return f;
      }
    }
    return null;
  }

  /**
   * Add an edge between two vertices. Like SketchUp, a line that cuts across a face splits
   * it, and a line that closes a planar loop creates a face.
   */
  addLine(a: number, b: number): void {
    if (a === b) return;
    const key = edgeKey(a, b);
    if (this.edgeUsed(key)) return;
    this.lines.add(key);
    if (this.trySplitWithChain(a, b)) return;
    this.tryCloseLoop(a, b);
  }

  private onFaceBoundary(id: number): boolean {
    for (const f of this.faces.values()) if (this.faceVertexIds(f).includes(id)) return true;
    return false;
  }

  private looseNeighbors(id: number): number[] {
    const out: number[] = [];
    for (const k of this.lines) {
      const [x, y] = parseEdgeKey(k);
      if (x === id) out.push(y);
      else if (y === id) out.push(x);
    }
    return out;
  }

  /** If a chain of loose lines runs across a face from one boundary vertex to another, split the face. */
  private trySplitWithChain(a: number, b: number): boolean {
    const chain = [a, b];
    const extend = (atEnd: boolean) => {
      for (let guard = 0; guard < 10000; guard++) {
        const end = atEnd ? chain[chain.length - 1] : chain[0];
        const prev = atEnd ? chain[chain.length - 2] : chain[1];
        if (this.onFaceBoundary(end)) return;
        const nb = this.looseNeighbors(end).filter((x) => x !== prev);
        if (nb.length !== 1 || chain.includes(nb[0])) return;
        if (atEnd) chain.push(nb[0]);
        else chain.unshift(nb[0]);
      }
    };
    extend(true);
    extend(false);
    const s = chain[0];
    const e = chain[chain.length - 1];
    if (s === e) return false;
    const pts = this.loopPoints(chain);
    for (const f of [...this.faces.values()]) {
      const i = f.outer.indexOf(s);
      const j = f.outer.indexOf(e);
      if (i < 0 || j < 0) continue;
      if (!this.isCoplanar(f, pts)) continue;
      // Interior of the chain must be inside the face.
      let inside = true;
      for (let k = 0; k < chain.length - 1 && inside; k++) {
        const m = pts[k].clone().add(pts[k + 1]).multiplyScalar(0.5);
        if (!this.pointInFace(f, m)) inside = false;
      }
      for (let k = 1; k < chain.length - 1 && inside; k++) if (!this.pointInFace(f, pts[k])) inside = false;
      if (!inside) continue;
      const interior = chain.slice(1, -1);
      const loopA = walk(f.outer, i, j).concat([...interior].reverse());
      const loopB = walk(f.outer, j, i).concat(interior);
      this.faces.delete(f.id);
      const fa = this.addFace(loopA, [], f.color);
      const fb = this.addFace(loopB, [], f.color);
      for (const h of f.holes) {
        const target = this.pointInFaceLoose(fa, this.v(h[0])) ? fa : fb;
        target.holes.push(h);
      }
      for (let k = 0; k < chain.length - 1; k++) this.lines.delete(edgeKey(chain[k], chain[k + 1]));
      return true;
    }
    return false;
  }

  private pointInFaceLoose(face: Face, p: Vector3): boolean {
    const { u, v, origin } = this.faceFrame(face);
    const [p2] = to2D([p], origin, u, v);
    return pointInPolygon2D(p2, to2D(this.loopPoints(face.outer), origin, u, v));
  }

  /** After adding edge a-b, look for the shortest planar loop through it and make a face. */
  private tryCloseLoop(a: number, b: number): Face | null {
    const skip = edgeKey(a, b);
    const adj = new Map<number, number[]>();
    for (const [k, [x, y]] of this.allEdges()) {
      if (k === skip) continue;
      (adj.get(x) ?? adj.set(x, []).get(x)!).push(y);
      (adj.get(y) ?? adj.set(y, []).get(y)!).push(x);
    }
    // BFS from b to a
    const prev = new Map<number, number>([[b, -1]]);
    const queue = [b];
    while (queue.length) {
      const cur = queue.shift()!;
      if (cur === a) break;
      for (const nx of adj.get(cur) ?? []) {
        if (!prev.has(nx)) {
          prev.set(nx, cur);
          queue.push(nx);
        }
      }
    }
    if (!prev.has(a)) return null;
    const path: number[] = [];
    for (let c = a; c !== -1; c = prev.get(c)!) path.push(c);
    // path is a ... b ; loop a -> ... -> b -> (a)
    if (path.length < 3) return null;
    const pts = this.loopPoints(path);
    if (polygonArea(pts) < TOL * TOL) return null;
    const n = polygonNormal(pts);
    const o = pts[0];
    if (!pts.every((p) => Math.abs(p.clone().sub(o).dot(n)) < TOL * 10)) return null;
    const set = new Set(path);
    for (const f of this.faces.values()) {
      if (f.outer.length === path.length && f.outer.every((x) => set.has(x))) return null;
    }
    // Don't create a face overlapping an existing coplanar face.
    const centroid = pts.reduce((acc, p) => acc.add(p), new Vector3()).divideScalar(pts.length);
    for (const f of this.faces.values()) if (this.isCoplanar(f, [centroid]) && this.pointInFace(f, centroid, 0)) return null;
    return this.orientGround(this.addFace(path));
  }

  // ---------- deletion ----------

  /** Remove a face. Its edges stay behind as lines unless dropEdges is set. */
  removeFace(id: number, dropEdges = false): void {
    const f = this.faces.get(id);
    if (!f) return;
    this.faces.delete(id);
    if (!dropEdges) for (const k of this.faceEdgeKeys(f)) if (!this.edgeUsed(k)) this.lines.add(k);
  }

  /** Erase an edge; faces that use it are removed too (their other edges remain). */
  eraseEdge(key: string): void {
    for (const f of this.facesUsingEdge(key)) this.removeFace(f.id);
    this.lines.delete(key);
  }

  /** Remove vertices that nothing references. */
  cleanup(): void {
    const used = new Set<number>();
    for (const f of this.faces.values()) for (const id of this.faceVertexIds(f)) used.add(id);
    for (const k of this.lines) for (const id of parseEdgeKey(k)) used.add(id);
    for (const id of [...this.verts.keys()]) if (!used.has(id)) this.verts.delete(id);
  }

  // ---------- transforms ----------

  verticesOf(faceIds: Iterable<number>, edgeKeys: Iterable<string>): Set<number> {
    const s = new Set<number>();
    for (const id of faceIds) {
      const f = this.faces.get(id);
      if (f) for (const v of this.faceVertexIds(f)) s.add(v);
    }
    for (const k of edgeKeys) for (const v of parseEdgeKey(k)) s.add(v);
    return s;
  }

  applyMatrix(vertIds: Iterable<number>, m: Matrix4): void {
    for (const id of vertIds) this.verts.get(id)?.applyMatrix4(m);
  }

  translate(vertIds: Iterable<number>, delta: Vector3): void {
    for (const id of vertIds) this.verts.get(id)?.add(delta);
  }

  // ---------- push/pull ----------

  /**
   * Push/pull a face by distance d along its normal.
   * - A face whose neighbours are all perpendicular to it (the top of a box) just moves.
   * - Otherwise new side faces are built. A face that is part of a solid is replaced
   *   (pocket or boss); a lone face keeps its original as the opposite cap.
   * Returns the id of the face at the new position.
   */
  pushPull(faceId: number, d: number): number {
    const face = this.faces.get(faceId);
    if (!face || Math.abs(d) < 1e-9) return faceId;
    const n = this.normal(face);
    const offset = n.clone().multiplyScalar(d);
    const ownEdges = new Set(this.faceEdgeKeys(face));
    const others = [...this.faces.values()].filter((f) => f.id !== faceId);
    const shared = others.some((f) => this.faceEdgeKeys(f).some((k) => ownEdges.has(k)));

    if (shared) {
      const ids = new Set(this.faceVertexIds(face));
      const neighbours = others.filter((f) => this.faceVertexIds(f).some((v) => ids.has(v)));
      const allPerpendicular = neighbours.every((f) => Math.abs(this.normal(f).dot(n)) < 1e-6);
      if (allPerpendicular) {
        this.translate(ids, offset);
        return faceId;
      }
    }

    const map = new Map<number, number>();
    for (const id of this.faceVertexIds(face)) map.set(id, this.newVertex(this.v(id).clone().add(offset)));
    const reverseSides = !shared && d < 0;
    const touched = new Set<Face>();
    for (const loop of [face.outer, ...face.holes]) {
      for (const [a, b] of loopEdges(loop)) {
        // If a neighbouring face lies in the plane the new side would occupy (e.g. the front of
        // a board when cutting a rabbet), reshape that face instead of stacking a second face on it.
        const key = edgeKey(a, b);
        const neighbour = others.find(
          (f) => !touched.has(f) && Math.abs(this.normal(f).dot(n)) < 1e-6 && this.faceEdgeKeys(f).includes(key),
        );
        if (neighbour) {
          this.spliceEdge(neighbour, a, b, map.get(a)!, map.get(b)!);
          touched.add(neighbour);
          continue;
        }
        const quad = [a, b, map.get(b)!, map.get(a)!];
        this.addFace(reverseSides ? quad.reverse() : quad, [], face.color);
      }
    }
    for (const f of touched) this.removeSpikes(f);
    const top = this.addFace(
      face.outer.map((id) => map.get(id)!),
      face.holes.map((h) => h.map((id) => map.get(id)!)),
      face.color,
    );
    if (!shared && d < 0) this.reverseFace(top);
    if (shared) this.faces.delete(faceId);
    else if (d > 0) this.reverseFace(face);
    for (const k of [...this.lines]) if (this.facesUsingEdge(k).length) this.lines.delete(k);
    this.cleanup();
    return top.id;
  }

  /** Replace edge a-b in a face's loop with the detour a -> a2 -> b2 -> b. */
  private spliceEdge(f: Face, a: number, b: number, a2: number, b2: number): void {
    for (const loop of [f.outer, ...f.holes]) {
      for (let i = 0; i < loop.length; i++) {
        const x = loop[i];
        const y = loop[(i + 1) % loop.length];
        if (x === a && y === b) {
          loop.splice(i + 1, 0, a2, b2);
          return;
        }
        if (x === b && y === a) {
          loop.splice(i + 1, 0, b2, a2);
          return;
        }
      }
    }
  }

  /** Remove vertices where a loop doubles straight back on itself. */
  private removeSpikes(f: Face): void {
    for (const loop of [f.outer, ...f.holes]) {
      let changed = true;
      while (changed && loop.length > 3) {
        changed = false;
        for (let i = 0; i < loop.length; i++) {
          const p = this.v(loop[(i - 1 + loop.length) % loop.length]);
          const c = this.v(loop[i]);
          const q = this.v(loop[(i + 1) % loop.length]);
          const d1 = c.clone().sub(p);
          const d2 = q.clone().sub(c);
          if (d1.lengthSq() < TOL * TOL || (d1.clone().cross(d2).length() < TOL * d1.length() && d1.dot(d2) < 0)) {
            loop.splice(i, 1);
            changed = true;
            break;
          }
        }
      }
    }
  }

  // ---------- offset ----------

  /**
   * Offset a face's outline by d (positive = inward). Inward offsets become a hole + inner
   * face (so the inner part can be push/pulled); outward offsets add a ring around the face.
   * Returns the new face, or null if the offset collapses the outline.
   */
  offsetFace(faceId: number, d: number): Face | null {
    const face = this.faces.get(faceId);
    if (!face || Math.abs(d) < 1e-9) return null;
    const pts = offsetLoop(this.loopPoints(face.outer), this.normal(face), d);
    if (!pts) return null;
    if (d > 0) return this.addPolygon(pts);
    const ids = pts.map((p) => this.newVertex(p));
    return this.addFace(ids, [[...face.outer].reverse()], face.color);
  }

  // ---------- copy / split / merge ----------

  /** Copy faces and lines into a new mesh (same coordinates). */
  extract(faceIds: Iterable<number>, edgeKeys: Iterable<string>): Mesh {
    const out = new Mesh();
    const map = new Map<number, number>();
    const mv = (id: number) => {
      if (!map.has(id)) map.set(id, out.newVertex(this.v(id)));
      return map.get(id)!;
    };
    for (const fid of faceIds) {
      const f = this.faces.get(fid);
      if (!f) continue;
      out.addFace(f.outer.map(mv), f.holes.map((h) => h.map(mv)), f.color);
    }
    for (const k of edgeKeys) {
      const [a, b] = parseEdgeKey(k);
      const key = edgeKey(mv(a), mv(b));
      if (!out.edgeUsed(key)) out.lines.add(key);
    }
    return out;
  }

  /** Remove faces and loose lines (used after extract when grouping). */
  removeEntities(faceIds: Iterable<number>, edgeKeys: Iterable<string>): void {
    for (const id of faceIds) this.faces.delete(id);
    for (const k of edgeKeys) {
      if (this.facesUsingEdge(k).length) continue;
      this.lines.delete(k);
    }
    this.cleanup();
  }

  /** Erase a selection the way users expect: faces go, selected edges take their faces with them. */
  erase(faceIds: Iterable<number>, edgeKeys: Iterable<string>): void {
    for (const id of faceIds) this.removeFace(id);
    for (const k of edgeKeys) this.eraseEdge(k);
    this.cleanup();
  }

  /** Merge another mesh into this one, transformed by m. Coincident vertices are welded. */
  merge(other: Mesh, m?: Matrix4): { faces: number[]; lines: string[] } {
    const map = new Map<number, number>();
    for (const [id, p] of other.verts) {
      const q = m ? p.clone().applyMatrix4(m) : p.clone();
      map.set(id, this.findVertex(q) ?? this.newVertex(q));
    }
    const faces: number[] = [];
    for (const f of other.faces.values()) {
      const nf = this.addFace(f.outer.map((x) => map.get(x)!), f.holes.map((h) => h.map((x) => map.get(x)!)), f.color);
      faces.push(nf.id);
    }
    const lines: string[] = [];
    for (const k of other.lines) {
      const [a, b] = parseEdgeKey(k);
      const key = edgeKey(map.get(a)!, map.get(b)!);
      if (!this.edgeUsed(key)) {
        this.lines.add(key);
        lines.push(key);
      }
    }
    if (m && m.determinant() < 0) for (const id of faces) this.reverseFace(this.faces.get(id)!);
    return { faces, lines };
  }

  /** Triangles for a face as vertex-id triples, wound to match the face normal. */
  triangulateFace(face: Face): [number, number, number][] {
    const { n, u, v, origin } = this.faceFrame(face);
    const ids = this.faceVertexIds(face);
    const outer2 = to2D(this.loopPoints(face.outer), origin, u, v);
    const holes2 = face.holes.map((h) => to2D(this.loopPoints(h), origin, u, v));
    let tris: number[][];
    try {
      tris = triangulate(outer2, holes2);
    } catch {
      tris = [];
    }
    return tris.map(([i, j, k]) => {
      const a = ids[i];
      const b = ids[j];
      const c = ids[k];
      const pa = this.v(a);
      const tn = this.v(b).clone().sub(pa).cross(this.v(c).clone().sub(pa));
      return tn.dot(n) >= 0 ? ([a, b, c] as [number, number, number]) : ([a, c, b] as [number, number, number]);
    });
  }

  bounds(m?: Matrix4): Box3 {
    const box = new Box3();
    for (const p of this.verts.values()) box.expandByPoint(m ? p.clone().applyMatrix4(m) : p);
    return box;
  }

  isEmpty(): boolean {
    return this.faces.size === 0 && this.lines.size === 0;
  }

  // ---------- serialization ----------

  toJSON(): MeshJSON {
    return {
      nextId: this.nextId,
      verts: [...this.verts].map(([id, p]) => [id, round(p.x), round(p.y), round(p.z)]),
      faces: [...this.faces.values()].map((f) => ({
        id: f.id,
        outer: [...f.outer],
        holes: f.holes.map((h) => [...h]),
        ...(f.color ? { color: f.color } : {}),
      })),
      lines: [...this.lines].map(parseEdgeKey),
    };
  }

  static fromJSON(j: MeshJSON): Mesh {
    const m = new Mesh();
    m.nextId = j.nextId;
    for (const [id, x, y, z] of j.verts) m.verts.set(id, new Vector3(x, y, z));
    for (const f of j.faces) m.faces.set(f.id, { id: f.id, outer: [...f.outer], holes: f.holes.map((h) => [...h]), color: f.color });
    for (const [a, b] of j.lines) m.lines.add(edgeKey(a, b));
    return m;
  }

  clone(): Mesh {
    return Mesh.fromJSON(this.toJSON());
  }
}

/**
 * Offset a planar loop (counter-clockwise around n) by d: positive moves every edge inward.
 * Returns null if the result folds over itself.
 */
export function offsetLoop(pts: Vector3[], n: Vector3, d: number): Vector3[] | null {
  const N = pts.length;
  // drop collinear points so parallel neighbours don't produce degenerate intersections
  const clean: Vector3[] = [];
  for (let i = 0; i < N; i++) {
    const p = pts[(i - 1 + N) % N];
    const c = pts[i];
    const q = pts[(i + 1) % N];
    if (c.clone().sub(p).cross(q.clone().sub(c)).length() > 1e-9 * Math.max(1, c.distanceTo(p) * q.distanceTo(c))) clean.push(c);
  }
  if (clean.length < 3) return null;
  const M = clean.length;
  const lines = clean.map((a, i) => {
    const b = clean[(i + 1) % M];
    const dir = b.clone().sub(a).normalize();
    const inward = n.clone().cross(dir).normalize(); // left of the edge = inside for CCW loops
    return { p: a.clone().add(inward.multiplyScalar(d)), dir };
  });
  const out: Vector3[] = [];
  for (let i = 0; i < M; i++) {
    const L1 = lines[(i - 1 + M) % M];
    const L2 = lines[i];
    // intersect L1 and L2 (coplanar): solve L1.p + t L1.dir = L2.p + s L2.dir
    const w = L2.p.clone().sub(L1.p);
    const cross = L1.dir.clone().cross(L2.dir);
    const den = cross.lengthSq();
    if (den < 1e-12) {
      out.push(L2.p.clone());
      continue;
    }
    const t = w.clone().cross(L2.dir).dot(cross) / den;
    out.push(L1.p.clone().add(L1.dir.clone().multiplyScalar(t)));
  }
  // reject folded results: every offset edge must keep its direction
  for (let i = 0; i < M; i++) {
    const e = out[(i + 1) % M].clone().sub(out[i]);
    if (e.dot(lines[i].dir) <= 1e-9) return null;
  }
  return out;
}

function round(x: number): number {
  return Math.round(x * 1e6) / 1e6;
}

function walk(loop: number[], from: number, to: number): number[] {
  const out: number[] = [];
  for (let i = from; ; i = (i + 1) % loop.length) {
    out.push(loop[i]);
    if (i === to) break;
  }
  return out;
}

function minDistToLoop(p: Vector2, loop: Vector2[]): number {
  let d = Infinity;
  for (let i = 0; i < loop.length; i++) d = Math.min(d, distPointSegment2D(p, loop[i], loop[(i + 1) % loop.length]));
  return d;
}
