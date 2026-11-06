import { describe, expect, it } from 'vitest';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { Mesh, offsetLoop } from '../src/core/mesh';
import { WorkbenchDocument } from '../src/core/document';

const rect = (x0: number, y0: number, x1: number, y1: number, z = 0) => [
  new Vector3(x0, y0, z),
  new Vector3(x1, y0, z),
  new Vector3(x1, y1, z),
  new Vector3(x0, y1, z),
];

function signedVolume(m: Mesh) {
  let v = 0;
  for (const f of m.faces.values()) for (const [a, b, c] of m.triangulateFace(f)) v += m.v(a).dot(m.v(b).clone().cross(m.v(c))) / 6;
  return v;
}

describe('offset', () => {
  it('insets a square loop', () => {
    const out = offsetLoop(rect(0, 0, 10, 10), new Vector3(0, 0, 1), 1)!;
    expect(out.map((p) => [p.x, p.y])).toEqual([
      [1, 1],
      [9, 1],
      [9, 9],
      [1, 9],
    ]);
  });
  it('rejects an inset bigger than the shape', () => {
    expect(offsetLoop(rect(0, 0, 10, 10), new Vector3(0, 0, 1), 6)).toBeNull();
  });
  it('offsetFace inward makes a hole + inner face; outward makes a ring', () => {
    const m = new Mesh();
    const f = m.addPolygon(rect(0, 0, 10, 10))!;
    const inner = m.offsetFace(f.id, 2)!;
    expect(m.area(inner)).toBeCloseTo(36);
    expect(m.area(m.faces.get(f.id)!)).toBeCloseTo(64);
    const m2 = new Mesh();
    const g = m2.addPolygon(rect(0, 0, 10, 10))!;
    const ring = m2.offsetFace(g.id, -1)!;
    expect(m2.area(ring)).toBeCloseTo(144 - 100);
  });
  it('offset an L-shaped (concave) face', () => {
    const m = new Mesh();
    const L = [new Vector3(0, 0, 0), new Vector3(10, 0, 0), new Vector3(10, 4, 0), new Vector3(4, 4, 0), new Vector3(4, 10, 0), new Vector3(0, 10, 0)];
    const f = m.addPolygon(L)!;
    const inner = m.offsetFace(f.id, 1)!;
    // L of width 2 legs: (8x2) + (2x6)
    expect(m.area(inner)).toBeCloseTo(8 * 2 + 2 * 6);
  });
});

describe('scale', () => {
  it('bakes a group scale into its geometry so sizes stay true', () => {
    const doc = new WorkbenchDocument();
    const f = doc.root.mesh.addPolygon(rect(0, 0, 10, 20))!;
    doc.root.mesh.pushPull(f.id, -5);
    const g = doc.makeGroup(doc.root, [...doc.root.mesh.faces.keys()], [], []);
    g.matrix.makeRotationZ(Math.PI / 2);
    g.matrix.premultiply(new Matrix4().makeTranslation(50, 0, 0));
    // scale along the group's own X by 2 (pre-multiplied in world: rotate X->Y)
    const world = g.matrix.clone().multiply(new Matrix4().makeScale(2, 1, 1));
    g.matrix.copy(world);
    doc.bakeScale(g);
    const size = g.localBounds().getSize(new Vector3());
    expect([size.x, size.y, size.z].map((v) => +v.toFixed(6))).toEqual([20, 20, 5]);
    expect(signedVolume(g.mesh)).toBeCloseTo(2000);
    // transform is rigid again
    const s = new Vector3();
    g.matrix.decompose(new Vector3(), new Quaternion(), s);
    expect([s.x, s.y, s.z].map((v) => +v.toFixed(6))).toEqual([1, 1, 1]);
  });
  it('mirroring keeps faces pointing out', () => {
    const doc = new WorkbenchDocument();
    const f = doc.root.mesh.addPolygon(rect(0, 0, 10, 10))!;
    doc.root.mesh.pushPull(f.id, -10);
    const g = doc.makeGroup(doc.root, [...doc.root.mesh.faces.keys()], [], []);
    g.matrix.makeScale(-1, 1, 1);
    doc.bakeScale(g);
    expect(signedVolume(g.mesh)).toBeCloseTo(1000);
  });
});

describe('components', () => {
  it('editing one instance updates the others; make unique breaks the link', () => {
    const doc = new WorkbenchDocument();
    const f = doc.root.mesh.addPolygon(rect(0, 0, 10, 10))!;
    doc.root.mesh.pushPull(f.id, -2);
    const a = doc.makeComponent(doc.root, [...doc.root.mesh.faces.keys()], [], [], 'Shelf');
    const b = doc.duplicateGroup(a);
    b.matrix.makeTranslation(0, 0, 20);
    expect(b.componentId).toBe(a.componentId);
    // edit a: pull its top up 3
    const top = [...a.mesh.faces.values()].find((x) => a.mesh.normal(x).z > 0.99)!;
    a.mesh.pushPull(top.id, 3);
    doc.syncComponent(a);
    expect(signedVolume(b.mesh)).toBeCloseTo(500);
    expect(b.matrix.elements[14]).toBe(20); // keeps its own position
    doc.makeUnique(b);
    const top2 = [...a.mesh.faces.values()].find((x) => a.mesh.normal(x).z > 0.99)!;
    a.mesh.pushPull(top2.id, 5);
    doc.syncComponent(a);
    expect(signedVolume(b.mesh)).toBeCloseTo(500);
    expect(doc.components.length).toBe(2);
  });
  it('round-trips tags, scenes, guides, dimensions and sections', () => {
    const doc = new WorkbenchDocument();
    doc.tags.push({ name: 'Framing', visible: false });
    doc.guides.push({ id: 1, point: [0, 0, 0], dir: [1, 0, 0] });
    doc.dimensions.push({ id: 2, a: [0, 0, 0], b: [10, 0, 0], offset: [0, -2, 0] });
    doc.sections.push({ id: 3, point: [5, 0, 0], normal: [1, 0, 0], active: true });
    doc.scenes.push({ name: 'Plan', camera: { position: [0, 0, 100], target: [0, 0, 0], perspective: false }, hiddenTags: ['Framing'] });
    const copy = new WorkbenchDocument();
    copy.load(doc.serialize());
    expect(copy.tags).toEqual(doc.tags);
    expect(copy.guides).toEqual(doc.guides);
    expect(copy.dimensions).toEqual(doc.dimensions);
    expect(copy.sections).toEqual(doc.sections);
    expect(copy.scenes).toEqual(doc.scenes);
  });
});
