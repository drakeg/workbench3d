import * as THREE from 'three';
import { Group, GroupJSON } from '../core/document';
import { Mesh, MeshJSON } from '../core/mesh';
import type { App } from './app';
import { store } from './platform';

/** What Cut/Copy put on the clipboard: geometry and groups in world coordinates. */
interface Clip {
  format: 'workbench3d-clip';
  mesh: MeshJSON | null;
  groups: GroupJSON[];
  componentNames: Record<number, string>;
}

const KEY = 'workbench3d.clipboard';
let memory: string | null = null;

export function hasClip(): boolean {
  return !!(memory ?? store.get(KEY));
}

export function copySelection(app: App): boolean {
  if (app.selectionEmpty()) return false;
  const ctx = app.context;
  const m = ctx.worldMatrix();
  const sel = app.selection;
  const faces = new Set(sel.faces);
  let mesh: MeshJSON | null = null;
  if (faces.size || sel.edges.size) {
    const piece = ctx.mesh.extract(faces, [...sel.edges].filter((k) => ctx.mesh.lines.has(k) || !faces.size));
    piece.applyMatrix(piece.verts.keys(), m);
    mesh = piece.toJSON();
  }
  const componentNames: Record<number, string> = {};
  const groups = app.selectedGroups().map((g) => {
    const j = g.toJSON();
    j.matrix = g.worldMatrix().toArray();
    for (const d of g.walk()) {
      const def = app.doc.component(d.componentId);
      if (def) componentNames[def.id] = def.name;
    }
    return j;
  });
  const clip: Clip = { format: 'workbench3d-clip', mesh, groups, componentNames };
  memory = JSON.stringify(clip);
  // lets you paste into another window of the app too
  store.set(KEY, memory);
  return true;
}

/**
 * Paste into the group being edited. In place keeps the original position; otherwise the
 * pasted parts land beside the model, selected and ready to move.
 */
export function paste(app: App, inPlace: boolean): boolean {
  const raw = memory ?? store.get(KEY);
  if (!raw) return false;
  let clip: Clip;
  try {
    clip = JSON.parse(raw);
  } catch {
    return false;
  }
  if (clip.format !== 'workbench3d-clip') return false;

  // bounds of what we're pasting, in world space
  const box = new THREE.Box3();
  const tmpMesh = clip.mesh ? Mesh.fromJSON(clip.mesh) : null;
  if (tmpMesh) box.union(tmpMesh.bounds());
  const tmpGroups = clip.groups.map((j) => Group.fromJSON(j));
  for (const g of tmpGroups) box.union(g.worldBounds());
  if (box.isEmpty()) return false;

  let offset = new THREE.Matrix4();
  if (!inPlace) {
    const model = app.modelBounds();
    const dx = model.isEmpty() ? 0 : model.max.x + 6 - box.min.x;
    offset = new THREE.Matrix4().makeTranslation(dx, 0, 0);
  }

  const out = { faces: [] as number[], edges: [] as string[], groups: [] as number[] };
  app.doc.transact(inPlace ? 'Paste in Place' : 'Paste', () => {
    const ctx = app.context;
    const toCtx = ctx.worldMatrix().invert().multiply(offset);
    if (tmpMesh) {
      const r = ctx.mesh.merge(tmpMesh, toCtx);
      out.faces.push(...r.faces);
      out.edges.push(...r.lines);
    }
    for (const j of clip.groups) {
      const copy = structuredClone(j);
      const reId = (x: GroupJSON) => {
        x.id = app.doc.nextGroupId++;
        // keep component links only if this model has the same component
        if (x.componentId != null) {
          const def = app.doc.component(x.componentId);
          if (!def || def.name !== clip.componentNames[x.componentId]) {
            const name = clip.componentNames[x.componentId] ?? 'Component';
            const existing = app.doc.components.find((c) => c.name === name);
            if (existing) x.componentId = existing.id;
            else {
              const nd = { id: app.doc.nextItemId++, name };
              app.doc.components.push(nd);
              clip.componentNames[nd.id] = name;
              x.componentId = nd.id;
            }
          }
        }
        x.children.forEach(reId);
      };
      reId(copy);
      const g = Group.fromJSON(copy);
      g.matrix.premultiply(toCtx);
      ctx.add(g);
      out.groups.push(g.id);
    }
  });
  app.setSelection(out);
  return true;
}
