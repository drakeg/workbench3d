import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { Mesh, edgeKey } from '../src/core/mesh';
import { WorkbenchDocument } from '../src/core/document';
import { exportSTL, collectTriangles } from '../src/core/export';

const rect = (x0: number, y0: number, x1: number, y1: number, z = 0) => [
  new Vector3(x0, y0, z),
  new Vector3(x1, y0, z),
  new Vector3(x1, y1, z),
  new Vector3(x0, y1, z),
];

function box(m: Mesh, w = 10, d = 20, h = 5) {
  const f = m.addPolygon(rect(0, 0, w, d))!;
  expect(f).toBeTruthy();
  // ground faces point down, so pulling "up" is a negative distance along the normal
  expect(m.normal(f).z).toBeLessThan(0);
  const top = m.pushPull(f.id, -h);
  return { bottom: f, top };
}

function totalArea(m: Mesh) {
  let a = 0;
  for (const f of m.faces.values()) a += m.area(f);
  return a;
}

/** Closed, consistently oriented solids have signed volume equal to their real volume. */
function signedVolume(m: Mesh) {
  let v = 0;
  for (const f of m.faces.values())
    for (const [a, b, c] of m.triangulateFace(f)) v += m.v(a).dot(m.v(b).clone().cross(m.v(c))) / 6;
  return v;
}

describe('Mesh', () => {
  it('draws a rectangle face on the ground', () => {
    const m = new Mesh();
    const f = m.addPolygon(rect(0, 0, 4, 3))!;
    expect(m.faces.size).toBe(1);
    expect(m.area(f)).toBeCloseTo(12);
    expect(m.lines.size).toBe(0);
  });

  it('push/pulls a rectangle into a closed box', () => {
    const m = new Mesh();
    box(m);
    expect(m.faces.size).toBe(6);
    expect(totalArea(m)).toBeCloseTo(2 * (10 * 20 + 10 * 5 + 20 * 5));
    expect(signedVolume(m)).toBeCloseTo(1000);
  });

  it('pulling the top of a box again just stretches it', () => {
    const m = new Mesh();
    const { top } = box(m);
    const n = m.normal(m.faces.get(top)!);
    expect(n.z).toBeGreaterThan(0.99);
    const again = m.pushPull(top, 3);
    expect(again).toBe(top);
    expect(m.faces.size).toBe(6);
    expect(signedVolume(m)).toBeCloseTo(10 * 20 * 8);
  });

  it('rectangle on a face becomes a hole + inner face, pushing it makes a pocket', () => {
    const m = new Mesh();
    const { top } = box(m);
    const inner = m.addPolygon(rect(2, 2, 6, 6, 5))!;
    expect(inner).toBeTruthy();
    expect(m.faces.get(top)!.holes.length).toBe(1);
    expect(m.area(m.faces.get(top)!)).toBeCloseTo(200 - 16);
    m.pushPull(inner.id, -2);
    expect(signedVolume(m)).toBeCloseTo(1000 - 32);
  });

  it('pulling an inner face out makes a boss', () => {
    const m = new Mesh();
    const { top } = box(m);
    const inner = m.addPolygon(rect(2, 2, 6, 6, 5))!;
    m.pushPull(inner.id, 3);
    expect(m.faces.get(top)!.holes.length).toBe(1);
    expect(signedVolume(m)).toBeCloseTo(1000 + 48);
  });

  it('a line across a face splits it', () => {
    const m = new Mesh();
    const { top } = box(m);
    const a = m.vertexAt(new Vector3(5, 0, 5));
    const b = m.vertexAt(new Vector3(5, 20, 5));
    m.addLine(a, b);
    expect(m.faces.has(top)).toBe(false);
    expect(m.faces.size).toBe(9 - 2); // top replaced by two halves
    expect(m.lines.size).toBe(0);
    // the edge split also added vertices to the side faces
    const half = [...m.faces.values()].find((f) => m.normal(f).z > 0.99 && m.loopPoints(f.outer).every((p) => p.x <= 5 + 1e-9))!;
    expect(m.area(half)).toBeCloseTo(100);
    // push one half down: notch
    m.pushPull(half.id, -2);
    expect(signedVolume(m)).toBeCloseTo(1000 - 5 * 20 * 2);
    // a clean rabbet: side faces were reshaped, not doubled up
    expect(m.faces.size).toBe(8);
    expect(totalArea(m)).toBeCloseTo(680);
  });

  it('closing a loop of lines creates a face', () => {
    const m = new Mesh();
    const ids = rect(0, 0, 3, 3).map((p) => m.vertexAt(p));
    m.addLine(ids[0], ids[1]);
    m.addLine(ids[1], ids[2]);
    m.addLine(ids[2], ids[3]);
    expect(m.faces.size).toBe(0);
    m.addLine(ids[3], ids[0]);
    expect(m.faces.size).toBe(1);
    expect(m.lines.size).toBe(0);
  });

  it('erasing an edge removes the faces that use it', () => {
    const m = new Mesh();
    box(m);
    const [a, b] = [m.findVertex(new Vector3(0, 0, 5))!, m.findVertex(new Vector3(10, 0, 5))!];
    m.erase([], [edgeKey(a, b)]);
    expect(m.faces.size).toBe(4);
  });

  it('round-trips through JSON', () => {
    const m = new Mesh();
    box(m);
    const copy = Mesh.fromJSON(JSON.parse(JSON.stringify(m.toJSON())));
    expect(copy.faces.size).toBe(6);
    expect(signedVolume(copy)).toBeCloseTo(1000);
  });
});

describe('WorkbenchDocument', () => {
  it('groups, moves, undoes and exports', () => {
    const doc = new WorkbenchDocument();
    doc.transact('Box', () => box(doc.root.mesh));
    const g = doc.transact('Group', () => doc.makeGroup(doc.root, [...doc.root.mesh.faces.keys()], [], []));
    expect(doc.root.mesh.faces.size).toBe(0);
    expect(g.mesh.faces.size).toBe(6);
    doc.transact('Move', () => g.matrix.makeTranslation(100, 0, 0));
    expect(doc.bounds().min.x).toBeCloseTo(100);
    const size = g.localBounds().getSize(new Vector3());
    expect([size.x, size.y, size.z]).toEqual([10, 20, 5]);
    doc.undo();
    expect(doc.findGroup(g.id)!.matrix.elements[12]).toBe(0);
    doc.redo();
    expect(doc.findGroup(g.id)!.matrix.elements[12]).toBe(100);
    expect(collectTriangles(doc.root).length).toBe(12);
    const stl = exportSTL(doc.root);
    expect(stl.byteLength).toBe(84 + 12 * 50);
  });

  it('explodes a moved group back into the parent', () => {
    const doc = new WorkbenchDocument();
    box(doc.root.mesh);
    const g = doc.makeGroup(doc.root, [...doc.root.mesh.faces.keys()], [], []);
    g.matrix.makeTranslation(0, 0, 10);
    doc.explode(g);
    expect(doc.root.children.length).toBe(0);
    expect(doc.root.mesh.bounds().min.z).toBeCloseTo(10);
  });
});
