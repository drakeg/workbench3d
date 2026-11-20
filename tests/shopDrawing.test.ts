import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { WorkbenchDocument } from '../src/core/document';
import { insertCabinetDemo } from '../src/core/sampleCabinet';
import { collectShopDrawing, exportShopDrawing } from '../src/core/shopDrawing';

describe('dimensioned orthographic shop views', () => {
  it('produces a printable one-page PDF with the exact cabinet envelope and a fixed scale', () => {
    const doc = new WorkbenchDocument();
    doc.transact('Sample', () => insertCabinetDemo(doc));
    const info = collectShopDrawing(doc.root);
    expect(info.bounds.getSize(new Vector3()).toArray()).toEqual([24, 24, 30]);
    expect(info.scale).toBe(12);
    expect(info.edges.length).toBeGreaterThan(40);
    const pdf = new TextDecoder('latin1').decode(exportShopDrawing(doc.root, 'Cabinet demo'));
    expect(pdf).toMatch(/^%PDF-1\.4/);
    expect(pdf).toContain('/Count 1');
    expect(pdf).toContain('(Scale 1:12 \(print at 100%, no fit-to-page\) | Dimensions in inches)');
    expect(pdf).toContain('(24.000 in)');
    expect(pdf).toContain('(30.000 in)');
    expect(pdf).toContain('(Cabinet demo)');
    expect(pdf).toContain('(Top - XY)');
    expect(pdf).toContain('(Front - XZ)');
    expect(pdf).toContain('(Right - YZ)');
  });

  it('uses world transforms, respects hidden groups and never alters saved project data', () => {
    const doc = new WorkbenchDocument();
    const first = doc.transact('First', () => insertCabinetDemo(doc, doc.root, [50, 20, 10]));
    const hidden = doc.transact('Hidden', () => insertCabinetDemo(doc, doc.root, [900, 0, 0]));
    hidden.hidden = true;
    const before = doc.serialize();
    const data = collectShopDrawing(doc.root);
    expect(data.bounds.min.x).toBeCloseTo(50);
    expect(data.bounds.max.x).toBeCloseTo(74);
    expect(data.bounds.min.z).toBeCloseTo(10);
    expect(data.bounds.max.z).toBeCloseTo(40);
    expect(data.edges.length).toBeGreaterThan(0);
    exportShopDrawing(doc.root);
    expect(doc.serialize()).toBe(before);
    expect(first.children).toHaveLength(6);
  });

  it('rejects an empty or fully hidden model instead of creating a blank drawing', () => {
    const doc = new WorkbenchDocument();
    expect(() => exportShopDrawing(doc.root)).toThrow(/no visible edges/);
    const group = doc.transact('Demo', () => insertCabinetDemo(doc));
    group.hidden = true;
    expect(() => exportShopDrawing(doc.root)).toThrow(/no visible edges/);
  });

  it('automatically chooses an appropriate printable scale for large builds', () => {
    const doc = new WorkbenchDocument();
    const box = doc.newGroup('Large shop footprint');
    const mesh = box.mesh;
    const ids = [
      mesh.newVertex(new Vector3(0, 0, 0)),
      mesh.newVertex(new Vector3(240, 0, 0)),
      mesh.newVertex(new Vector3(240, 180, 0)),
      mesh.newVertex(new Vector3(0, 180, 0)),
    ];
    mesh.addFace(ids);
    doc.root.add(box);
    const result = collectShopDrawing(doc.root);
    expect(result.scale).toBeGreaterThanOrEqual(96);
    expect(exportShopDrawing(doc.root).byteLength).toBeGreaterThan(500);
  });
});
