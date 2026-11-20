import { describe, expect, it } from 'vitest';
import { WorkbenchDocument } from '../src/core/document';
import { collectTriangles, exportSTL } from '../src/core/export';
import { importSTL } from '../src/core/importStl';
import { Vector3 } from 'three';

const bytes = (text: string) => new TextEncoder().encode(text).buffer as ArrayBuffer;

function sample() {
  const doc = new WorkbenchDocument();
  doc.root.mesh.addFace([
    doc.root.mesh.newVertex(new Vector3(0, 0, 0)),
    doc.root.mesh.newVertex(new Vector3(1, 0, 0)),
    doc.root.mesh.newVertex(new Vector3(0, 1, 0)),
  ]);
  return doc;
}

describe('STL import', () => {
  it('reads a binary STL exported in millimetres and returns inches', () => {
    const doc = sample();
    const result = importSTL(exportSTL(doc.root, 'mm'));
    expect(result.triangles).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.mesh.faces.size).toBe(1);
    const verts = [...result.mesh.verts.values()];
    expect(Math.max(...verts.map((v) => v.x))).toBeCloseTo(1, 5);
    expect(Math.max(...verts.map((v) => v.y))).toBeCloseTo(1, 5);
  });

  it('imports inch units without scaling and handles binary headers starting with solid', () => {
    const data = exportSTL(sample().root, 'in');
    const header = new Uint8Array(data);
    header.set(new TextEncoder().encode('solid misleading header'));
    const result = importSTL(data, 'in');
    expect(result.triangles).toBe(1);
    expect(Math.max(...[...result.mesh.verts.values()].map((v) => v.x))).toBeCloseTo(1, 5);
  });

  it('reads ASCII STL and deduplicates shared vertices', () => {
    const ascii = `solid sample
facet normal 0 0 1
outer loop
vertex 0 0 0
vertex 25.4 0 0
vertex 0 25.4 0
endloop
endfacet
facet normal 0 0 1
outer loop
vertex 25.4 0 0
vertex 25.4 25.4 0
vertex 0 25.4 0
endloop
endfacet
endsolid sample`;
    const result = importSTL(bytes(ascii));
    expect(result.triangles).toBe(2);
    expect(result.mesh.verts.size).toBe(4);
    expect(result.mesh.faces.size).toBe(2);
  });

  it('rejects truncated files and invalid coordinates', () => {
    expect(() => importSTL(new ArrayBuffer(0))).toThrow(/Empty/);
    expect(() => importSTL(bytes('not an STL'))).toThrow(/Not a supported/);
    expect(() => importSTL(bytes('solid missing\nendsolid missing'))).toThrow(/no facets/);
    expect(() => importSTL(bytes('solid broken\nfacet normal 0 0 1\nvertex 0 0 0\nendfacet'))).toThrow(/Invalid STL triangle/);
    expect(() => importSTL(bytes('solid broken\nfacet normal 0 0 1\nvertex NaN 0 0\nvertex 1 0 0\nvertex 0 1 0\nendfacet'))).toThrow(/Invalid STL triangle/);
  });

  it('creates triangles usable by the normal save/load and export pipeline', () => {
    const doc = new WorkbenchDocument();
    const mesh = importSTL(exportSTL(sample().root, 'mm')).mesh;
    doc.transact('Import STL', () => {
      const group = doc.newGroup('sample STL');
      group.mesh = mesh;
      doc.root.add(group);
    });
    const loaded = new WorkbenchDocument();
    loaded.load(doc.serialize());
    expect(collectTriangles(loaded.root)).toHaveLength(1);
    doc.undo();
    expect(doc.root.children).toHaveLength(0);
  });
});
