import { Vector3 } from 'three';
import { Group, WorkbenchDocument } from './document';

/** A documented 24 × 24 × 30 in cabinet carcass, made from nominal 3/4 in sheet material.
 * This is a demonstration model, not a manufacturing-ready assembly.
 * Every panel is an editable group with cut-list material attributes.
 */
export const CABINET = { width: 24, depth: 24, height: 30, thickness: 0.75 } as const;

export interface PanelSpec {
  name: string;
  width: number;
  depth: number;
  height: number;
  origin: [number, number, number];
}

export const CABINET_PANELS: readonly PanelSpec[] = [
  { name: 'Left side', width: 0.75, depth: 24, height: 30, origin: [0, 0, 0] },
  { name: 'Right side', width: 0.75, depth: 24, height: 30, origin: [23.25, 0, 0] },
  { name: 'Bottom', width: 22.5, depth: 24, height: 0.75, origin: [0.75, 0, 0] },
  { name: 'Top', width: 22.5, depth: 24, height: 0.75, origin: [0.75, 0, 29.25] },
  { name: 'Back', width: 22.5, depth: 0.75, height: 28.5, origin: [0.75, 23.25, 0.75] },
  { name: 'Shelf', width: 22.5, depth: 23.25, height: 0.75, origin: [0.75, 0, 14.625] },
];

/** Caller wraps this in doc.transact(...) for one undoable user action. */
export function insertCabinetDemo(doc: WorkbenchDocument, parent: Group = doc.root, origin: [number, number, number] = [0, 0, 0]): Group {
  const cabinet = doc.newGroup('Sample Cabinet — 24 × 24 × 30');
  cabinet.matrix.makeTranslation(...origin);
  parent.add(cabinet);
  for (const spec of CABINET_PANELS) {
    const panel = doc.newGroup(spec.name);
    const mesh = panel.mesh;
    const face = mesh.addPolygon([
      new Vector3(0, 0, 0),
      new Vector3(spec.width, 0, 0),
      new Vector3(spec.width, spec.depth, 0),
      new Vector3(0, spec.depth, 0),
    ]);
    if (!face) throw new Error(`Invalid sample cabinet panel: ${spec.name}`);
    mesh.pushPull(face.id, -spec.height);
    for (const f of mesh.faces.values()) f.color = '#d9bd8c';
    panel.matrix.makeTranslation(...spec.origin);
    panel.attributes = { material: 'Plywood', stock: '3/4" plywood', sample: true };
    cabinet.add(panel);
  }
  return cabinet;
}
