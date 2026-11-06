import { Vector3 } from 'three';
import { Group } from './document';
import { MM_PER_INCH } from './units';

export interface Triangle {
  a: Vector3;
  b: Vector3;
  c: Vector3;
  group: string;
}

/** World-space triangles for every visible face in the model. */
export function collectTriangles(root: Group): Triangle[] {
  const out: Triangle[] = [];
  for (const g of root.walk()) {
    if (isHidden(g)) continue;
    const m = g.worldMatrix();
    for (const f of g.mesh.faces.values()) {
      for (const [a, b, c] of g.mesh.triangulateFace(f)) {
        out.push({
          a: g.mesh.v(a).clone().applyMatrix4(m),
          b: g.mesh.v(b).clone().applyMatrix4(m),
          c: g.mesh.v(c).clone().applyMatrix4(m),
          group: g.name,
        });
      }
    }
  }
  return out;
}

function isHidden(g: Group): boolean {
  for (let p: Group | null = g; p; p = p.parent) if (p.hidden) return true;
  return false;
}

/** Binary STL. 3D printers and slicers expect millimetres, so that's the default. */
export function exportSTL(root: Group, unit: 'mm' | 'in' = 'mm'): ArrayBuffer {
  const s = unit === 'mm' ? MM_PER_INCH : 1;
  const tris = collectTriangles(root);
  const buf = new ArrayBuffer(84 + tris.length * 50);
  const dv = new DataView(buf);
  const header = 'Workbench3D STL export';
  for (let i = 0; i < header.length; i++) dv.setUint8(i, header.charCodeAt(i));
  dv.setUint32(80, tris.length, true);
  let o = 84;
  for (const t of tris) {
    const n = t.b.clone().sub(t.a).cross(t.c.clone().sub(t.a)).normalize();
    for (const v of [n, t.a.clone().multiplyScalar(s), t.b.clone().multiplyScalar(s), t.c.clone().multiplyScalar(s)]) {
      dv.setFloat32(o, v.x, true);
      dv.setFloat32(o + 4, v.y, true);
      dv.setFloat32(o + 8, v.z, true);
      o += 12;
    }
    dv.setUint16(o, 0, true);
    o += 2;
  }
  return buf;
}

/** Wavefront OBJ with one object per group, polygons kept as triangles. */
export function exportOBJ(root: Group, unit: 'mm' | 'in' = 'in'): string {
  const s = unit === 'mm' ? MM_PER_INCH : 1;
  const lines = [`# Workbench3D OBJ export (units: ${unit})`];
  let base = 1;
  for (const g of root.walk()) {
    if (isHidden(g) || g.mesh.faces.size === 0) continue;
    const m = g.worldMatrix();
    lines.push(`o ${g.name.replace(/\s+/g, '_')}_${g.id}`);
    const index = new Map<number, number>();
    for (const [id, p] of g.mesh.verts) {
      const q = p.clone().applyMatrix4(m).multiplyScalar(s);
      index.set(id, base++);
      lines.push(`v ${q.x.toFixed(5)} ${q.y.toFixed(5)} ${q.z.toFixed(5)}`);
    }
    for (const f of g.mesh.faces.values()) {
      for (const [a, b, c] of g.mesh.triangulateFace(f)) lines.push(`f ${index.get(a)} ${index.get(b)} ${index.get(c)}`);
    }
  }
  return lines.join('\n') + '\n';
}
