import * as THREE from 'three';
import type { App, Command } from '../app/app';
import { store } from '../app/platform';
import { Group, WorkbenchDocument } from '../core/document';
import { UnitSettings, formatLength, parseLength } from '../core/units';
import { icons } from '../tools/icons';
import type { Tool } from '../tools/tool';
import { FormField, dialog, form } from '../ui/dialogs';

export const API_VERSION = '1.0';

/**
 * An add-on. Export one of these as the default export of an ES module, or call
 * `window.Workbench3D.registerAddOn(addOn)` from a plain script.
 */
export interface AddOn {
  id: string;
  name: string;
  version?: string;
  description?: string;
  author?: string;
  activate(api: WorkbenchAPI): void | Promise<void>;
}

export interface BoxOptions {
  width: number; // along red (X)
  depth: number; // along green (Y)
  height: number; // along blue (Z)
  origin?: THREE.Vector3 | [number, number, number];
  name?: string;
  color?: string;
  attributes?: Record<string, unknown>;
  /** Defaults to the group being edited. */
  parent?: Group;
}

export interface ExtrusionOptions {
  /** Outline in the XY plane (z ignored), in inches. */
  profile: Array<THREE.Vector3 | [number, number]>;
  /** Openings inside the outline (e.g. the inside of a tube). */
  holes?: Array<Array<THREE.Vector3 | [number, number]>>;
  /** Extrusion length along +Z before the axis rotation. */
  length: number;
  /** Which world axis the length runs along. Default 'z'. */
  axis?: 'x' | 'y' | 'z';
  origin?: THREE.Vector3 | [number, number, number];
  name?: string;
  color?: string;
  attributes?: Record<string, unknown>;
  parent?: Group;
}

export interface WorkbenchAPI {
  apiVersion: string;
  /** The three.js module, so add-ons don't need to bundle their own copy. */
  THREE: typeof THREE;
  doc: WorkbenchDocument;
  icons: typeof icons;
  units: {
    parse(text: string): number | null;
    format(inches: number): string;
    settings(): UnitSettings;
  };
  /** The open model's file name without the extension ("Untitled" if never saved). */
  modelName(): string;
  /** The group currently being edited (the model root if none). */
  context(): Group;
  selection(): { faces: number[]; edges: string[]; groups: Group[] };
  setSelection(sel: { faces?: number[]; edges?: string[]; groups?: number[] }): void;
  setTool(id: string): void;
  registerTool(tool: Tool): void;
  registerCommand(cmd: Command): void;
  /** Make a change as one undo step. */
  transact<T>(label: string, fn: () => T): T;
  /** A rectangular solid in its own group, e.g. a board or a cabinet panel. */
  createBox(o: BoxOptions): Group;
  /** A profile pushed to a length in its own group, e.g. steel tube or angle. */
  createExtrusion(o: ExtrusionOptions): Group;
  ui: {
    form(title: string, fields: FormField[], submitLabel?: string): Promise<Record<string, unknown> | null>;
    /** A dialog; the last button is the default (Return). `wide` for tables and drawings. */
    dialog(title: string, content: string | HTMLElement, buttons?: string[], opts?: { wide?: boolean }): Promise<string | null>;
    toast(message: string, kind?: 'info' | 'error'): void;
    download(fileName: string, data: string | ArrayBuffer): void;
  };
  on(event: 'change' | 'selection', fn: () => void): () => void;
  /** Persistent key/value storage for this add-on's settings. */
  storage: { get(key: string): string | null; set(key: string, value: string): void };
}

const v3 = (p: THREE.Vector3 | [number, number] | [number, number, number]) =>
  p instanceof THREE.Vector3 ? p.clone().setZ(0) : new THREE.Vector3(p[0], p[1], 0);

export function createAPI(app: App, addOnId = 'core'): WorkbenchAPI {
  const units = () => app.doc.units;
  const placeGroup = (g: Group, parent: Group | undefined, origin?: THREE.Vector3 | [number, number, number], axis: 'x' | 'y' | 'z' = 'z') => {
    const o = origin instanceof THREE.Vector3 ? origin : new THREE.Vector3(...(origin ?? [0, 0, 0]));
    const rot = new THREE.Matrix4();
    if (axis === 'x') rot.makeBasis(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0));
    if (axis === 'y') rot.makeBasis(new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0));
    g.matrix.copy(new THREE.Matrix4().makeTranslation(o.x, o.y, o.z).multiply(rot));
    (parent ?? app.context).add(g);
    return g;
  };

  const api: WorkbenchAPI = {
    apiVersion: API_VERSION,
    THREE,
    doc: app.doc,
    icons,
    units: {
      parse: (t) => parseLength(t, units()),
      format: (i) => formatLength(i, units()),
      settings: () => ({ ...units() }),
    },
    modelName: () => app.fileName.replace(/\.wb3d$/i, '') || 'Untitled',
    context: () => app.context,
    selection: () => ({ faces: [...app.selection.faces], edges: [...app.selection.edges], groups: app.selectedGroups() }),
    setSelection: (s) => app.setSelection(s),
    setTool: (id) => app.setTool(id),
    registerTool: (tool) => app.registerTool(tool),
    registerCommand: (cmd) => app.registerCommand({ menu: 'Add-ons', ...cmd }),
    transact: (label, fn) => app.doc.transact(label, fn),
    createBox(o) {
      const g = app.doc.newGroup(o.name ?? 'Box');
      const { width: w, depth: d, height: h } = o;
      const f = g.mesh.addPolygon([new THREE.Vector3(0, 0, 0), new THREE.Vector3(w, 0, 0), new THREE.Vector3(w, d, 0), new THREE.Vector3(0, d, 0)]);
      if (!f) throw new Error('Box needs a width and depth greater than zero');
      if (o.color) f.color = o.color;
      g.mesh.pushPull(f.id, -h);
      if (o.attributes) g.attributes = { ...o.attributes };
      return placeGroup(g, o.parent, o.origin);
    },
    createExtrusion(o) {
      const g = app.doc.newGroup(o.name ?? 'Extrusion');
      const f = g.mesh.addPolygon(o.profile.map(v3));
      if (!f) throw new Error('Profile needs at least three points');
      for (const hole of o.holes ?? []) {
        const inner = g.mesh.addPolygon(hole.map(v3));
        if (inner) g.mesh.removeFace(inner.id);
      }
      g.mesh.cleanup();
      if (o.color) for (const face of g.mesh.faces.values()) face.color = o.color;
      // profiles on the ground face down, so a negative push/pull goes up +Z
      const sign = g.mesh.normal(g.mesh.faces.get(f.id)!).z < 0 ? -1 : 1;
      g.mesh.pushPull(f.id, sign * o.length);
      if (o.color) for (const face of g.mesh.faces.values()) face.color = o.color;
      if (o.attributes) g.attributes = { ...o.attributes };
      return placeGroup(g, o.parent, o.origin, o.axis);
    },
    ui: {
      form: (title, fields, submitLabel) => form(title, fields, units(), submitLabel),
      dialog: (title, content, buttons, opts) => dialog(title, content, buttons, opts?.wide),
      toast: (m, k) => app.toast(m, k),
      download(name, data) {
        const url = URL.createObjectURL(new Blob([data]));
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      },
    },
    on: (ev, fn) => app.on(ev, fn),
    storage: {
      get: (k) => store.get(`workbench3d.addon.${addOnId}.${k}`),
      set: (k, v) => store.set(`workbench3d.addon.${addOnId}.${k}`, v),
    },
  };
  return api;
}

interface StoredAddOn {
  id: string;
  name: string;
  code: string;
}

const STORE_KEY = 'workbench3d.addons';

/** Loads, tracks and persists add-ons. */
export class AddOnManager {
  readonly loaded = new Map<string, { addOn: AddOn; builtin: boolean }>();
  private pending: AddOn[] = [];

  constructor(private app: App) {
    (window as unknown as { Workbench3D: unknown }).Workbench3D = {
      apiVersion: API_VERSION,
      registerAddOn: (a: AddOn) => this.pending.push(a),
    };
  }

  async activate(addOn: AddOn, builtin = false): Promise<void> {
    if (!addOn?.id || typeof addOn.activate !== 'function') throw new Error('Not a Workbench3D add-on (needs id, name and activate)');
    if (this.loaded.has(addOn.id)) throw new Error(`An add-on with id "${addOn.id}" is already loaded`);
    await addOn.activate(createAPI(this.app, addOn.id));
    this.loaded.set(addOn.id, { addOn, builtin });
    this.app.emit('commands');
  }

  /** Run add-on source code (an ES module). Returns the add-ons it registered. */
  async loadCode(code: string): Promise<AddOn[]> {
    this.pending = [];
    const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    try {
      const mod = (await import(/* @vite-ignore */ url)) as { default?: AddOn; addOn?: AddOn };
      const found = [...(mod.default ? [mod.default] : []), ...(mod.addOn ? [mod.addOn] : []), ...this.pending];
      if (!found.length) throw new Error('The file did not export or register an add-on');
      for (const a of found) await this.activate(a);
      return found;
    } finally {
      URL.revokeObjectURL(url);
      this.pending = [];
    }
  }

  async install(code: string): Promise<AddOn[]> {
    const added = await this.loadCode(code);
    const saved = this.saved().filter((s) => !added.some((a) => a.id === s.id));
    for (const a of added) saved.push({ id: a.id, name: a.name, code });
    store.set(STORE_KEY, JSON.stringify(saved));
    return added;
  }

  uninstall(id: string): void {
    store.set(STORE_KEY, JSON.stringify(this.saved().filter((s) => s.id !== id)));
  }

  saved(): StoredAddOn[] {
    try {
      return JSON.parse(store.get(STORE_KEY) ?? '[]') as StoredAddOn[];
    } catch {
      return [];
    }
  }

  /** Re-load user add-ons saved from earlier sessions. */
  async restore(): Promise<void> {
    const seen = new Set<string>();
    for (const s of this.saved()) {
      if (seen.has(s.code)) continue;
      seen.add(s.code);
      try {
        await this.loadCode(s.code);
      } catch (e) {
        this.app.toast(`Add-on "${s.name}" failed to load: ${(e as Error).message}`, 'error');
      }
    }
  }
}
