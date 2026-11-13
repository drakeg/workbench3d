import { describe, expect, it } from 'vitest';
import { buildScene, create, parseSkp } from 'openskp';
import { Box3, Vector3 } from 'three';
import { WorkbenchDocument } from '../src/core/document';
import { collectTriangles } from '../src/core/export';
import { importSkpModel, skpMatrix } from '../src/core/importSkp';

/** A small SketchUp file made with openskp's writer: a face with a hole, a loose line,
 *  a two-face component placed twice (once turned 90°, on a tag), a group, a guide. */
function sampleSkp(): ArrayBuffer {
  const b = create();
  const red = b.addMaterial('Red', [200, 30, 30, 255]);
  const tag = b.addLayer('Cabinets');
  const leg = b.addComponentDefinition('Leg', (d) => {
    d.addFace([[0, 0, 0], [2, 0, 0], [2, 2, 0], [0, 2, 0]]);
    d.addFace([[0, 0, 0], [0, 0, 10], [2, 0, 10], [2, 0, 0]]);
  });
  const tri = b.addGroup((d) => d.addFace([[0, 0, 0], [4, 0, 0], [4, 4, 0]]), { name: 'Tri', translation: [0, 20, 1] });
  void tri;
  b.addFace([[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0]], { holes: [[[3, 3, 0], [7, 3, 0], [7, 7, 0], [3, 7, 0]]], material: red });
  b.addPolyline([[0, 0, 5], [10, 0, 5]]);
  b.addInstance(leg, { name: 'Leg A', translation: [20, 0, 0] });
  b.addInstance(leg, { name: 'Leg B', translation: [30, 5, 0], matrix3x3: [0, 1, 0, -1, 0, 0, 0, 0, 1], layer: tag });
  b.addConstructionLine([0, -5, 0], { direction: [1, 0, 0] });
  const bytes = b.toBytes();
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function importSample() {
  const buf = sampleSkp();
  const doc = new WorkbenchDocument();
  const r = importSkpModel(doc, parseSkp(buf), 'sample');
  return { doc, r, buf };
}

describe('SketchUp import', () => {
  it('keeps the structure: one group holding the groups and component copies', () => {
    const { doc, r } = importSample();
    expect(doc.root.children).toEqual([r.group]);
    expect(r.group.name).toBe('sample');
    const names = r.group.children.map((g) => g.name).sort();
    expect(names).toEqual(['Leg A', 'Leg B', 'Tri']);
    const legs = r.group.children.filter((g) => g.name.startsWith('Leg'));
    expect(legs[0].componentId).not.toBeNull();
    expect(legs[0].componentId).toBe(legs[1].componentId);
    expect(doc.component(legs[0].componentId)?.name).toBe('Leg');
    expect(r.group.children.find((g) => g.name === 'Tri')?.componentId).toBeNull();
    expect(r.components).toBe(1);
  });

  it('keeps faces with holes, colours and loose lines', () => {
    const { r } = importSample();
    const faces = [...r.group.mesh.faces.values()];
    expect(faces).toHaveLength(1);
    expect(faces[0].holes).toHaveLength(1);
    expect(faces[0].color).toBe('#c81e1e');
    expect(r.group.mesh.area(faces[0])).toBeCloseTo(100 - 16, 6);
    expect(r.group.mesh.normal(faces[0]).z).toBeCloseTo(1, 6);
    expect(r.group.mesh.lines.size).toBe(1);
  });

  it('places copies where SketchUp does (same world bounds as openskp’s own scene)', () => {
    const { r, buf } = importSample();
    const box = new Box3();
    for (const t of collectTriangles(r.group)) for (const p of [t.a, t.b, t.c]) box.expandByPoint(p);
    const s = buildScene(buf).bounds!;
    // openskp's scene is in metres, Y-up: (x, y, z) -> (x, z, -y)
    const toSkp = (v: number[]) => new Vector3(v[0], -v[2], v[1]).multiplyScalar(1 / 0.0254);
    const ref = new Box3().setFromPoints([toSkp(s.min), toSkp(s.max)]);
    expect(box.min.distanceTo(ref.min)).toBeLessThan(1e-3);
    expect(box.max.distanceTo(ref.max)).toBeLessThan(1e-3);
  });

  it('turns a rotated copy the right way', () => {
    const { r } = importSample();
    const legB = r.group.children.find((g) => g.name === 'Leg B')!;
    // local +X goes to world -Y under the file's 90° turn
    const p = new Vector3(2, 0, 0).applyMatrix4(legB.worldMatrix());
    expect(p.x).toBeCloseTo(30, 6);
    expect(p.y).toBeCloseTo(3, 6);
    expect(legB.tag).toBe('Cabinets');
  });

  it('brings tags and guides', () => {
    const { doc, r } = importSample();
    expect(doc.tags.map((t) => t.name)).toEqual(['Cabinets']);
    expect(r.tags).toBe(1);
    expect(doc.guides).toHaveLength(1);
    expect(doc.guides[0].dir).toEqual([1, 0, 0]);
  });

  it('is one undo step and survives save and reopen', () => {
    const doc = new WorkbenchDocument();
    const model = parseSkp(sampleSkp());
    doc.transact('Import', () => importSkpModel(doc, model, 'sample'));
    const saved = doc.serialize();
    const again = new WorkbenchDocument();
    again.load(saved);
    expect(collectTriangles(again.root).length).toBe(collectTriangles(doc.root).length);
    doc.undo();
    expect(doc.root.children).toHaveLength(0);
  });

  it('reads the placement matrix layout', () => {
    const m = skpMatrix([0, 1, 0, -1, 0, 0, 0, 0, 1, 30, 5, 0, 1]);
    const p = new Vector3(1, 0, 0).applyMatrix4(m);
    expect([p.x, p.y, p.z].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([30, 4, 0]);
  });
});
