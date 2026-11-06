import { Box3, Matrix4, Quaternion, Vector3 } from 'three';
import { Mesh, MeshJSON } from './mesh';
import { UnitSettings, defaultUnits } from './units';

export interface GroupJSON {
  id: number;
  name: string;
  matrix: number[];
  mesh: MeshJSON;
  children: GroupJSON[];
  hidden?: boolean;
  /** Tag (layer) name; untagged groups are always shown. */
  tag?: string;
  /** Groups with the same componentId are instances of one component: editing one edits all. */
  componentId?: number;
  /** Free-form data for add-ons (e.g. material, species, part number). */
  attributes?: Record<string, unknown>;
}

export interface DocumentJSON {
  format: 'workbench3d';
  version: 1;
  units: UnitSettings;
  nextGroupId: number;
  root: GroupJSON;
  guides?: Guide[];
  dimensions?: Dimension[];
  tags?: Tag[];
  scenes?: Scene[];
  sections?: SectionPlane[];
  components?: ComponentDef[];
  nextItemId?: number;
}

export type V3 = [number, number, number];
/** A guide line (with dir) or guide point (without), in world space. */
export interface Guide {
  id: number;
  point: V3;
  dir?: V3;
}
/** A linear dimension between two world points, drawn offset by `offset`. */
export interface Dimension {
  id: number;
  a: V3;
  b: V3;
  offset: V3;
}
export interface Tag {
  name: string;
  visible: boolean;
  color?: string;
}
export interface Scene {
  name: string;
  camera: { position: V3; target: V3; perspective: boolean };
  hiddenTags: string[];
  activeSection?: number | null;
}
export interface SectionPlane {
  id: number;
  point: V3;
  normal: V3;
  active: boolean;
}
export interface ComponentDef {
  id: number;
  name: string;
  description?: string;
}

/** A group is a separate piece of geometry with its own transform; its edges never stick to anything outside it. */
export class Group {
  id: number;
  name: string;
  matrix = new Matrix4();
  mesh = new Mesh();
  children: Group[] = [];
  parent: Group | null = null;
  hidden = false;
  tag = '';
  componentId: number | null = null;
  attributes: Record<string, unknown> = {};

  constructor(id: number, name = 'Group') {
    this.id = id;
    this.name = name;
  }

  /** Matrix from this group's local space to world space. */
  worldMatrix(): Matrix4 {
    const m = this.matrix.clone();
    for (let p = this.parent; p; p = p.parent) m.premultiply(p.matrix);
    return m;
  }

  add(child: Group): void {
    child.parent = this;
    this.children.push(child);
  }

  remove(child: Group): void {
    this.children = this.children.filter((c) => c !== child);
    child.parent = null;
  }

  /** World-space bounding box of everything in this group. */
  worldBounds(): Box3 {
    const box = this.mesh.bounds(this.worldMatrix());
    for (const c of this.children) box.union(c.worldBounds());
    return box;
  }

  /** Bounding box in the group's own axes (its "board size" regardless of how it's rotated). */
  localBounds(): Box3 {
    const box = this.mesh.bounds();
    for (const c of this.children) {
      const cb = c.localBoundsIn(c.matrix);
      box.union(cb);
    }
    return box;
  }

  private localBoundsIn(m: Matrix4): Box3 {
    const box = this.mesh.bounds(m);
    for (const c of this.children) box.union(c.localBoundsIn(m.clone().multiply(c.matrix)));
    return box;
  }

  toJSON(): GroupJSON {
    return {
      id: this.id,
      name: this.name,
      matrix: this.matrix.toArray(),
      mesh: this.mesh.toJSON(),
      children: this.children.map((c) => c.toJSON()),
      ...(this.hidden ? { hidden: true } : {}),
      ...(this.tag ? { tag: this.tag } : {}),
      ...(this.componentId != null ? { componentId: this.componentId } : {}),
      ...(Object.keys(this.attributes).length ? { attributes: structuredClone(this.attributes) } : {}),
    };
  }

  static fromJSON(j: GroupJSON): Group {
    const g = new Group(j.id, j.name);
    g.matrix.fromArray(j.matrix);
    g.mesh = Mesh.fromJSON(j.mesh);
    g.hidden = !!j.hidden;
    g.tag = j.tag ?? '';
    g.componentId = j.componentId ?? null;
    g.attributes = j.attributes ? structuredClone(j.attributes) : {};
    for (const c of j.children) g.add(Group.fromJSON(c));
    return g;
  }

  /** Visit this group and every descendant. */
  *walk(): Generator<Group> {
    yield this;
    for (const c of this.children) yield* c.walk();
  }
}

/**
 * The whole model. Holds the root group, units, and an undo history made of snapshots.
 * Every change goes through `transact`, which records one undo step.
 */
export class WorkbenchDocument {
  root = new Group(0, 'Model');
  units: UnitSettings = { ...defaultUnits };
  nextGroupId = 1;
  guides: Guide[] = [];
  dimensions: Dimension[] = [];
  tags: Tag[] = [];
  scenes: Scene[] = [];
  sections: SectionPlane[] = [];
  components: ComponentDef[] = [];
  /** Shared id counter for guides, dimensions, sections and components. */
  nextItemId = 1;
  private undoStack: { label: string; state: string }[] = [];
  private redoStack: { label: string; state: string }[] = [];
  private listeners = new Set<() => void>();
  dirty = false;

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(): void {
    for (const fn of this.listeners) fn();
  }

  findGroup(id: number): Group | undefined {
    for (const g of this.root.walk()) if (g.id === id) return g;
    return undefined;
  }

  newGroup(name = 'Group'): Group {
    return new Group(this.nextGroupId++, name);
  }

  /** Run fn as one undoable step. Throwing inside fn rolls the change back. */
  transact<T>(label: string, fn: () => T): T {
    const before = this.serialize();
    try {
      const result = fn();
      this.undoStack.push({ label, state: before });
      if (this.undoStack.length > 200) this.undoStack.shift();
      this.redoStack = [];
      this.dirty = true;
      this.emit();
      return result;
    } catch (e) {
      this.restore(before);
      throw e;
    }
  }

  /** Begin a live change (e.g. while dragging); call the returned commit or cancel. */
  begin(label: string): { commit: () => void; cancel: () => void; snapshot: string } {
    const snapshot = this.serialize();
    return {
      snapshot,
      commit: () => {
        this.undoStack.push({ label, state: snapshot });
        this.redoStack = [];
        this.dirty = true;
        this.emit();
      },
      cancel: () => {
        this.restore(snapshot);
        this.emit();
      },
    };
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  canRedo(): boolean {
    return this.redoStack.length > 0;
  }
  undoLabel(): string | undefined {
    return this.undoStack[this.undoStack.length - 1]?.label;
  }
  redoLabel(): string | undefined {
    return this.redoStack[this.redoStack.length - 1]?.label;
  }

  undo(): void {
    const step = this.undoStack.pop();
    if (!step) return;
    this.redoStack.push({ label: step.label, state: this.serialize() });
    this.restore(step.state);
    this.emit();
  }

  redo(): void {
    const step = this.redoStack.pop();
    if (!step) return;
    this.undoStack.push({ label: step.label, state: this.serialize() });
    this.restore(step.state);
    this.emit();
  }

  toJSON(): DocumentJSON {
    return {
      format: 'workbench3d',
      version: 1,
      units: { ...this.units },
      nextGroupId: this.nextGroupId,
      root: this.root.toJSON(),
      guides: structuredClone(this.guides),
      dimensions: structuredClone(this.dimensions),
      tags: structuredClone(this.tags),
      scenes: structuredClone(this.scenes),
      sections: structuredClone(this.sections),
      components: structuredClone(this.components),
      nextItemId: this.nextItemId,
    };
  }

  serialize(): string {
    return JSON.stringify(this.toJSON());
  }

  restore(text: string): void {
    const j = JSON.parse(text) as DocumentJSON;
    if (j.format !== 'workbench3d') throw new Error('Not a Workbench3D file');
    this.root = Group.fromJSON(j.root);
    this.units = { ...defaultUnits, ...j.units };
    this.nextGroupId = j.nextGroupId;
    this.guides = j.guides ? structuredClone(j.guides) : [];
    this.dimensions = j.dimensions ? structuredClone(j.dimensions) : [];
    this.tags = j.tags ? structuredClone(j.tags) : [];
    this.scenes = j.scenes ? structuredClone(j.scenes) : [];
    this.sections = j.sections ? structuredClone(j.sections) : [];
    this.components = j.components ? structuredClone(j.components) : [];
    this.nextItemId = j.nextItemId ?? 1;
  }

  /** Load a file, clearing history. */
  load(text: string): void {
    this.restore(text);
    this.undoStack = [];
    this.redoStack = [];
    this.dirty = false;
    this.emit();
  }

  clear(): void {
    this.root = new Group(0, 'Model');
    this.nextGroupId = 1;
    this.guides = [];
    this.dimensions = [];
    this.tags = [];
    this.scenes = [];
    this.sections = [];
    this.components = [];
    this.nextItemId = 1;
    this.undoStack = [];
    this.redoStack = [];
    this.dirty = false;
    this.emit();
  }

  /** Move selected faces/lines of a context into a new child group. */
  makeGroup(context: Group, faceIds: number[], edgeKeys: string[], groups: Group[], name = 'Group'): Group {
    const g = this.newGroup(name);
    g.mesh = context.mesh.extract(faceIds, edgeKeys);
    context.mesh.removeEntities(faceIds, edgeKeys);
    for (const child of groups) {
      context.remove(child);
      g.add(child);
    }
    context.add(g);
    return g;
  }

  /** Dissolve a group back into its parent's geometry. */
  explode(group: Group): { faces: number[]; lines: string[]; groups: Group[] } {
    const parent = group.parent;
    if (!parent) throw new Error('Cannot explode the model root');
    const res = parent.mesh.merge(group.mesh, group.matrix);
    parent.remove(group);
    const groups: Group[] = [];
    for (const c of [...group.children]) {
      group.remove(c);
      c.matrix.premultiply(group.matrix);
      parent.add(c);
      groups.push(c);
    }
    return { ...res, groups };
  }

  /** Deep copy a group (new ids) and add it to the same parent. */
  duplicateGroup(group: Group): Group {
    const j = group.toJSON();
    const reId = (x: GroupJSON) => {
      x.id = this.nextGroupId++;
      x.children.forEach(reId);
    };
    reId(j);
    const copy = Group.fromJSON(j);
    (group.parent ?? this.root).add(copy);
    return copy;
  }

  /**
   * Keep group transforms rigid: after a scale, push the scale into the geometry so sizes
   * (Entity Info, cut lists) stay true. Negative scales (mirrors) flip faces back outward.
   */
  bakeScale(g: Group): void {
    const pos = new Vector3();
    const quat = new Quaternion();
    const scl = new Vector3();
    g.matrix.decompose(pos, quat, scl);
    if (Math.abs(scl.x - 1) < 1e-9 && Math.abs(scl.y - 1) < 1e-9 && Math.abs(scl.z - 1) < 1e-9) return;
    const rigid = new Matrix4().compose(pos, quat, new Vector3(1, 1, 1));
    let linear = rigid.clone().invert().multiply(g.matrix); // what's left after removing T*R
    const recomposed = rigid.clone().multiply(new Matrix4().makeScale(scl.x, scl.y, scl.z));
    let keep = rigid;
    if (!matricesClose(recomposed, g.matrix)) {
      // sheared (scaled along axes the group isn't aligned to): bake everything but the translation
      keep = new Matrix4().makeTranslation(pos.x, pos.y, pos.z);
      linear = keep.clone().invert().multiply(g.matrix);
    }
    g.mesh.applyMatrix(g.mesh.verts.keys(), linear);
    if (linear.determinant() < 0) for (const f of g.mesh.faces.values()) g.mesh.reverseFace(f);
    for (const c of g.children) {
      c.matrix.premultiply(linear);
      this.bakeScale(c);
    }
    g.matrix.copy(keep);
  }

  // ---------- components ----------

  component(id: number | null | undefined): ComponentDef | undefined {
    return id == null ? undefined : this.components.find((c) => c.id === id);
  }

  instances(componentId: number): Group[] {
    return [...this.root.walk()].filter((g) => g.componentId === componentId);
  }

  /** Turn selected geometry into a component instance (a group whose edits are shared by its copies). */
  makeComponent(context: Group, faceIds: number[], edgeKeys: string[], groups: Group[], name = 'Component'): Group {
    const g = this.makeGroup(context, faceIds, edgeKeys, groups, name);
    const def: ComponentDef = { id: this.nextItemId++, name };
    this.components.push(def);
    g.componentId = def.id;
    return g;
  }

  /** Turn an existing group into a component. */
  groupToComponent(g: Group): ComponentDef {
    const def: ComponentDef = { id: this.nextItemId++, name: g.name };
    this.components.push(def);
    g.componentId = def.id;
    return def;
  }

  /** Copy an edited instance's contents to every other instance of the same component. */
  syncComponent(source: Group): void {
    if (source.componentId == null) return;
    const meshJSON = source.mesh.toJSON();
    const kids = source.children.map((c) => c.toJSON());
    for (const other of this.instances(source.componentId)) {
      if (other === source || isAncestor(other, source) || isAncestor(source, other)) continue;
      other.mesh = Mesh.fromJSON(meshJSON);
      for (const c of [...other.children]) other.remove(c);
      for (const k of kids) {
        const copy = structuredClone(k);
        const reId = (x: GroupJSON) => {
          x.id = this.nextGroupId++;
          x.children.forEach(reId);
        };
        reId(copy);
        other.add(Group.fromJSON(copy));
      }
    }
  }

  /** Give an instance its own definition so edits no longer affect the others. */
  makeUnique(g: Group): ComponentDef | undefined {
    const old = this.component(g.componentId);
    if (!old) return undefined;
    const def: ComponentDef = { id: this.nextItemId++, name: `${old.name} #${this.instances(old.id).length}` };
    this.components.push(def);
    g.componentId = def.id;
    return def;
  }

  /** Drop component definitions that no longer have instances. */
  purgeComponents(): void {
    const used = new Set([...this.root.walk()].map((g) => g.componentId).filter((x) => x != null));
    this.components = this.components.filter((c) => used.has(c.id));
  }

  /** The component instance (if any) containing a group, innermost first. */
  componentOf(g: Group | null): Group | null {
    for (let p = g; p; p = p.parent) if (p.componentId != null) return p;
    return null;
  }

  isTagVisible(tag: string): boolean {
    if (!tag) return true;
    return this.tags.find((t) => t.name === tag)?.visible ?? true;
  }

  /** World bounds of the whole model. */
  bounds(): Box3 {
    return this.root.worldBounds();
  }
}

function matricesClose(a: Matrix4, b: Matrix4): boolean {
  return a.elements.every((v, i) => Math.abs(v - b.elements[i]) < 1e-6);
}

function isAncestor(a: Group, b: Group): boolean {
  for (let p = b.parent; p; p = p.parent) if (p === a) return true;
  return false;
}

export function translationMatrix(v: Vector3): Matrix4 {
  return new Matrix4().makeTranslation(v.x, v.y, v.z);
}
