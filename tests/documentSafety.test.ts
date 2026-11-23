import { describe, expect, it } from 'vitest';
import { WorkbenchDocument } from '../src/core/document';

describe('WorkbenchDocument project safety', () => {
  it('round-trips nested components and document metadata', () => {
    const doc = new WorkbenchDocument();
    doc.units = { system: 'metric', fraction: 32, mmDecimals: 2 };
    const parent = doc.newGroup('Cabinet');
    const child = doc.newGroup('Shelf');
    child.attributes = { material: 'plywood', thickness: 0.75 };
    parent.add(child);
    doc.root.add(parent);
    const component = doc.groupToComponent(child);
    doc.tags = [{ name: 'Wood', visible: true }];
    doc.guides = [{ id: 5, point: [2, 4, 6] }];
    doc.dimensions = [{ id: 6, a: [0, 0, 0], b: [12, 0, 0], offset: [0, 2, 0] }];
    doc.sections = [{ id: 7, point: [0, 0, 2], normal: [0, 0, 1], active: true }];
    doc.scenes = [{ name: 'Front', camera: { position: [0, -20, 10], target: [0, 0, 0], perspective: false }, hiddenTags: ['Wood'] }];
    doc.nextItemId = 8;
    const restored = new WorkbenchDocument();
    restored.load(doc.serialize());
    expect(restored.toJSON()).toEqual(doc.toJSON());
    expect(restored.findGroup(child.id)?.attributes.material).toBe('plywood');
    expect(restored.component(component.id)?.name).toBe('Shelf');
  });

  it('refuses unknown structural fields at every supported level without losing open work', () => {
    const doc = new WorkbenchDocument();
    doc.transact('Keep', () => doc.root.add(doc.newGroup('Saved locally')));
    const before = doc.serialize();
    const shape = doc.toJSON();
    const examples = [
      { ...shape, futureSheetLayouts: [{ id: 1 }] },
      { ...shape, units: { ...shape.units, futurePrecision: 0.01 } },
      { ...shape, root: { ...shape.root, futureChild: true } },
      { ...shape, root: { ...shape.root, mesh: { ...shape.root.mesh, futureFaces: [] } } },
      { ...shape, dimensions: [{ id: 7, a: [0, 0, 0], b: [1, 0, 0], offset: [0, 1, 0], futureAttachment: 5 }] },
      { ...shape, scenes: [{ name: 'A', camera: { position: [0, 0, 10], target: [0, 0, 0], perspective: true, futureRoll: 5 }, hiddenTags: [] }] },
    ];
    for (const source of examples) {
      expect(() => doc.load(JSON.stringify(source))).toThrow(/newer version/);
      expect(doc.serialize()).toBe(before);
      expect(doc.dirty).toBe(true);
      expect(doc.canUndo()).toBe(true);
    }
  });

  it('continues to support add-on attributes and valid version-1 round trips', () => {
    const doc = new WorkbenchDocument();
    doc.root.attributes = { extension: { experimental: { revision: 3 } }, tags: ['custom'] };
    const original = doc.toJSON();
    const reopened = new WorkbenchDocument();
    reopened.load(JSON.stringify(original));
    expect(reopened.toJSON()).toEqual(original);
  });

  it('rejects invalid files without changing a dirty document or its undo history', () => {
    const doc = new WorkbenchDocument();
    doc.transact('Add part', () => doc.root.add(doc.newGroup('Existing work')));
    const before = doc.serialize();
    const bad = [
      '{broken',
      '{}',
      JSON.stringify({ ...doc.toJSON(), version: 2 }),
      JSON.stringify({ ...doc.toJSON(), root: { ...doc.toJSON().root, children: null } }),
      JSON.stringify({ ...doc.toJSON(), root: { ...doc.toJSON().root, matrix: new Array(16).fill('wrong') } }),
      JSON.stringify({ ...doc.toJSON(), tags: {} }),
      JSON.stringify({ ...doc.toJSON(), nextGroupId: 'wrong' }),
    ];
    for (const text of bad) {
      expect(() => doc.load(text)).toThrow();
      expect(doc.serialize()).toBe(before);
      expect(doc.dirty).toBe(true);
      expect(doc.canUndo()).toBe(true);
    }
    doc.undo();
    expect(doc.root.children).toHaveLength(0);
  });
});
