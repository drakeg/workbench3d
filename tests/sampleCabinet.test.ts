import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { WorkbenchDocument } from '../src/core/document';
import { CABINET, CABINET_PANELS, insertCabinetDemo } from '../src/core/sampleCabinet';

describe('sample cabinet for woodworking demonstrations', () => {
  it('creates six named plywood panels with exact usable cut-list dimensions', () => {
    const doc = new WorkbenchDocument();
    const cabinet = doc.transact('Insert sample', () => insertCabinetDemo(doc));
    expect(cabinet.children).toHaveLength(6);
    expect(cabinet.children.map((g) => g.name)).toEqual(CABINET_PANELS.map((p) => p.name));
    for (const [i, panel] of cabinet.children.entries()) {
      const expected = CABINET_PANELS[i];
      const bounds = panel.localBounds().getSize(new Vector3());
      expect(bounds.x).toBeCloseTo(expected.width, 5);
      expect(bounds.y).toBeCloseTo(expected.depth, 5);
      expect(bounds.z).toBeCloseTo(expected.height, 5);
      expect(panel.attributes.material).toBe('Plywood');
      expect(panel.attributes.stock).toBe('3/4" plywood');
      expect(panel.mesh.faces.size).toBe(6);
    }
    const size = cabinet.localBounds().getSize(new Vector3());
    expect([size.x, size.y, size.z]).toEqual([CABINET.width, CABINET.depth, CABINET.height]);
  });

  it('is one undoable operation and preserves parts and attributes across saving', () => {
    const doc = new WorkbenchDocument();
    const sample = doc.transact('Insert sample', () => insertCabinetDemo(doc, doc.root, [30, 4, 0]));
    expect(sample.worldBounds().min.x).toBeCloseTo(30);
    const reopened = new WorkbenchDocument();
    reopened.load(doc.serialize());
    expect(reopened.toJSON()).toEqual(doc.toJSON());
    doc.undo();
    expect(doc.root.children).toHaveLength(0);
    doc.redo();
    expect(doc.root.children[0].children).toHaveLength(6);
  });

  it('can add two independent sample cabinets without overwriting an existing project', () => {
    const doc = new WorkbenchDocument();
    const first = doc.transact('First', () => insertCabinetDemo(doc));
    const second = doc.transact('Second', () => insertCabinetDemo(doc, doc.root, [40, 0, 0]));
    expect(doc.root.children).toHaveLength(2);
    expect(second.id).not.toBe(first.id);
    expect(first.worldBounds().max.x).toBeCloseTo(24);
    expect(second.worldBounds().min.x).toBeCloseTo(40);
  });
});
