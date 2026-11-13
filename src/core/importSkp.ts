// Turns a parsed SketchUp model (from the `openskp` library) into Workbench3D groups.
//
// SketchUp and Workbench3D agree on the basics: lengths in inches, Z up, planar faces with
// holes, groups and components that are placements of shared geometry. So the import keeps
// the file's structure: every SketchUp group becomes a group, every component placement
// becomes an instance of one Workbench3D component, faces keep their colours, tags
// (layers), scenes and guide lines come across.
//
// Not yet: textures (faces get the material's average colour), soft/smooth edges (they
// are drawn), text, dimensions, section planes, images.
import type { Definition, Instance, SkpModel } from 'openskp';
import { Matrix4, Vector3 } from 'three';
import { Group, Tag, WorkbenchDocument } from './document';
import { Mesh, edgeKey } from './mesh';

export interface SkpImportResult {
  /** The group that holds everything from the file. */
  group: Group;
  faces: number;
  groups: number;
  components: number;
  tags: number;
  scenes: number;
  /** Things the file had that did not come across, for a message to the user. */
  skipped: string[];
}

/** SketchUp's default tag; geometry on it is "untagged". */
const DEFAULT_LAYERS = new Set(['Layer0', 'Untagged']);

/**
 * A placement's 4x4 transform. openskp gives 13 numbers: a 3x3 matrix in rows
 * (world = R·local), the translation, and a homogeneous scale that divides the result.
 */
export function skpMatrix(m: number[]): Matrix4 {
  if (m.length >= 16) return new Matrix4().fromArray(m); // a full column-major matrix
  if (m.length < 12) return new Matrix4();
  const w = m.length > 12 && m[12] !== 0 ? m[12] : 1;
  return new Matrix4().set(
    m[0] / w, m[1] / w, m[2] / w, m[9] / w,
    m[3] / w, m[4] / w, m[5] / w, m[10] / w,
    m[6] / w, m[7] / w, m[8] / w, m[11] / w,
    0, 0, 0, 1,
  );
}

function hex(c: { r: number; g: number; b: number }): string {
  const h = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

function loopArea(pts: Vector3[], n: Vector3): number {
  const s = new Vector3();
  for (let i = 0; i < pts.length; i++) s.add(pts[i].clone().cross(pts[(i + 1) % pts.length]));
  return s.dot(n) / 2;
}

/** Build the mesh of one definition, in its own coordinates. Faces without a material get `inherited`. */
function definitionMesh(def: Definition, colorOf: (id: number | null) => string | undefined, inherited?: string): Mesh {
  const mesh = new Mesh();
  const vid = new Map<number, number>();
  const pos = new Map(def.vertices.map((v) => [v.id, new Vector3(v.x, v.y, v.z)]));
  const vertex = (id: number): number | undefined => {
    let v = vid.get(id);
    if (v === undefined) {
      const p = pos.get(id);
      if (!p) return undefined;
      v = mesh.newVertex(p);
      vid.set(id, v);
    }
    return v;
  };
  const edges = new Map(def.edges.map((e) => [e.id, e]));
  const usedEdges = new Set<number>();

  for (const f of def.faces) {
    const loops: number[][] = [];
    for (const loop of f.loops) {
      const ids: number[] = [];
      for (const ce of loop) {
        const e = edges.get(ce.edgeId);
        if (!e) continue;
        usedEdges.add(e.id);
        const start = ce.orientation >= 0 ? e.v1Id : e.v2Id;
        const v = vertex(start);
        if (v !== undefined && ids[ids.length - 1] !== v) ids.push(v);
      }
      if (ids.length > 1 && ids[0] === ids[ids.length - 1]) ids.pop();
      if (ids.length >= 3) loops.push(ids);
    }
    if (loops.length === 0) continue;
    const n = new Vector3(...f.normal);
    // The outer loop is the one with the largest area; the rest are holes.
    let outerIdx = 0;
    let best = -1;
    loops.forEach((l, i) => {
      const a = Math.abs(loopArea(l.map((id) => mesh.v(id)), n));
      if (a > best) {
        best = a;
        outerIdx = i;
      }
    });
    let outer = loops[outerIdx];
    if (loopArea(outer.map((id) => mesh.v(id)), n) < 0) outer = [...outer].reverse();
    const holes = loops.filter((_, i) => i !== outerIdx);
    mesh.addFace(outer, holes, colorOf(f.materialId) ?? inherited);
  }

  // Edges that bound no face are loose lines.
  for (const e of def.edges) {
    if (usedEdges.has(e.id) || e.hidden) continue;
    const a = vertex(e.v1Id);
    const b = vertex(e.v2Id);
    if (a !== undefined && b !== undefined && a !== b) mesh.lines.add(edgeKey(a, b));
  }
  return mesh;
}

/**
 * Add everything in a SketchUp model to `doc`, inside one new group named `name` placed
 * in `parent` (the model root by default). Call it inside a transaction for undo.
 */
export function importSkpModel(doc: WorkbenchDocument, model: SkpModel, name: string, parent: Group = doc.root): SkpImportResult {
  const colors = new Map<number, string>();
  for (const m of model.materials) if (m.id != null) colors.set(m.id, hex(m.color));
  const colorOf = (id: number | null) => (id == null ? undefined : colors.get(id));

  const result: SkpImportResult = { group: doc.newGroup(name), faces: 0, groups: 0, components: 0, tags: 0, scenes: 0, skipped: [] };
  const skipped = new Set<string>();

  // Tags
  for (const l of model.layers) {
    if (DEFAULT_LAYERS.has(l.name) || doc.tags.some((t) => t.name === l.name)) continue;
    const tag: Tag = { name: l.name, visible: !l.hidden, color: hex(l.color) };
    doc.tags.push(tag);
    result.tags++;
  }
  const tagOf = (layer: string) => (layer && !DEFAULT_LAYERS.has(layer) && doc.tags.some((t) => t.name === layer) ? layer : '');

  // One Workbench3D component per SketchUp component definition that gets placed.
  const componentIds = new Map<number, number>();
  const componentFor = (def: Definition): number => {
    let id = componentIds.get(def.id);
    if (id === undefined) {
      id = doc.nextItemId++;
      doc.components.push({ id, name: def.name || 'Component' });
      componentIds.set(def.id, id);
      result.components++;
    }
    return id;
  };

  // Definition meshes are built once per (definition, inherited colour).
  const meshCache = new Map<string, Mesh>();
  const meshOf = (def: Definition, inherited?: string): Mesh => {
    const key = `${def.id}|${inherited ?? ''}`;
    let m = meshCache.get(key);
    if (!m) {
      m = definitionMesh(def, colorOf, inherited);
      meshCache.set(key, m);
    }
    return m.clone();
  };

  const place = (inst: Instance, into: Group, inherited: string | undefined, depth: number) => {
    const def = model.definitions.get(inst.refIdx);
    if (!def) return;
    if (def.isImage) {
      skipped.add('images');
      return;
    }
    if (depth > 64) {
      skipped.add('components nested more than 64 deep');
      return;
    }
    const paint = colorOf(inst.materialId) ?? inherited;
    const g = doc.newGroup(inst.name || def.name || (def.isGroup ? 'Group' : 'Component'));
    g.matrix.copy(skpMatrix(inst.matrix));
    g.mesh = meshOf(def, paint);
    g.hidden = inst.hidden;
    g.tag = tagOf(inst.layer);
    if (!def.isGroup) g.componentId = componentFor(def);
    if (Object.keys(inst.properties).length) g.attributes = { sketchup: { ...inst.properties } };
    result.groups++;
    result.faces += g.mesh.faces.size;
    into.add(g);
    for (const child of def.instances) place(child, g, paint, depth + 1);
    noteSkipped(def);
  };

  const noteSkipped = (def: Definition) => {
    if (def.texts.length) skipped.add('text');
    if (def.dimensions.length) skipped.add('dimensions');
    if (def.sectionPlanes.length) skipped.add('section planes');
  };

  // The model's own top-level geometry and placements.
  const top = result.group;
  top.mesh = definitionMesh(model.root, colorOf);
  result.faces += top.mesh.faces.size;
  for (const inst of model.root.instances) place(inst, top, undefined, 0);
  noteSkipped(model.root);
  if (model.dimensions.length) skipped.add('dimensions');
  if (model.materials.some((m) => m.texture)) skipped.add('textures (faces use the average colour)');
  parent.add(top);

  // Guides
  for (const c of model.root.constructionLines) {
    doc.guides.push({ id: doc.nextItemId++, point: [...c.point], dir: [...c.direction] });
  }
  for (const p of model.root.constructionPoints) doc.guides.push({ id: doc.nextItemId++, point: [...p.position] });

  // Scenes (only into a model that has none, so they don't mix with the user's own)
  if (doc.scenes.length === 0) {
    for (const p of model.pages) {
      if (!p.eye || !p.target) continue;
      doc.scenes.push({
        name: p.name || `Scene ${doc.scenes.length + 1}`,
        camera: { position: [...p.eye], target: [...p.target], perspective: !p.parallel },
        hiddenTags: p.hiddenLayers.filter((n) => doc.tags.some((t) => t.name === n)),
      });
      result.scenes++;
    }
  }

  result.skipped = [...skipped];
  return result;
}

/** Read .skp bytes. Loads the parser on first use (it's large, so it isn't in the main bundle). */
export async function parseSkpFile(bytes: ArrayBuffer): Promise<SkpModel> {
  const { parseSkp } = await import('openskp');
  return parseSkp(bytes);
}
