import { Vector3 } from 'three';
import { Mesh } from './mesh';
import { MM_PER_INCH } from './units';

export interface StlImportResult {
  mesh: Mesh;
  triangles: number;
  skipped: number;
}

/**
 * STL has no unit metadata. Convert the unit explicitly selected by the user
 * into Workbench3D's internal inches, without changing the source file.
 * Both binary and ASCII STL are supported; colors/materials aren't in standard STL.
 */
export function importSTL(data: ArrayBuffer, unit: 'mm' | 'in' = 'mm'): StlImportResult {
  if (!data.byteLength) throw new Error('Empty STL file');
  const scale = unit === 'mm' ? 1 / MM_PER_INCH : 1;
  const mesh = new Mesh();
  const verts = new Map<string, number>();
  let triangles = 0;
  let skipped = 0;

  const addTriangle = (points: number[][]) => {
    if (points.length !== 3 || points.some((p) => p.length !== 3 || p.some((v) => !Number.isFinite(v)))) {
      throw new Error('Invalid STL triangle coordinates');
    }
    const p = points.map(([x, y, z]) => new Vector3(x * scale, y * scale, z * scale));
    if (p[1].clone().sub(p[0]).cross(p[2].clone().sub(p[0])).lengthSq() < 1e-18) {
      skipped++;
      return;
    }
    const ids = p.map((v) => {
      const key = `${v.x},${v.y},${v.z}`;
      let id = verts.get(key);
      if (id === undefined) {
        id = mesh.newVertex(v);
        verts.set(key, id);
      }
      return id;
    });
    mesh.addFace(ids);
    triangles++;
  };

  const dv = new DataView(data);
  // Exact byte count distinguishes a binary STL whose 80-byte header begins with "solid".
  const count = data.byteLength >= 84 ? dv.getUint32(80, true) : 0;
  const binary = data.byteLength >= 84 && 84 + count * 50 === data.byteLength;
  if (binary) {
    if (count > 2_000_000) throw new Error('STL has too many triangles');
    for (let i = 0; i < count; i++) {
      const start = 84 + i * 50 + 12; // skip the facet normal
      const p: number[][] = [];
      for (let n = 0; n < 3; n++) {
        const o = start + n * 12;
        p.push([dv.getFloat32(o, true), dv.getFloat32(o + 4, true), dv.getFloat32(o + 8, true)]);
      }
      addTriangle(p);
    }
  } else {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(data);
    if (!/^\s*solid(?:\s|$)/i.test(text)) throw new Error('Not a supported binary or ASCII STL file');
    const facets = [...text.matchAll(/\bfacet\s+normal\b[\s\S]*?\bendfacet\b/gi)];
    if (facets.length > 2_000_000) throw new Error('STL has too many triangles');
    if (facets.length === 0) throw new Error('STL contains no facets');
    for (const facet of facets) {
      const vertices = [...facet[0].matchAll(/\bvertex\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)/gi)]
        .map((m) => m.slice(1, 4).map(Number));
      addTriangle(vertices);
    }
  }
  if (!triangles) throw new Error('STL has no non-degenerate triangles to import');
  return { mesh, triangles, skipped };
}
