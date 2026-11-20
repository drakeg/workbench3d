// The add-on host for the native Mac app.
//
// The Mac app (Swift) runs Workbench3D's JavaScript add-ons by loading this page in a hidden
// WebKit view (JavaScriptCore). The add-ons see the same WorkbenchAPI as in the web app, backed
// by the same TypeScript engine: Swift passes the model in as .wb3d JSON, the add-on command runs
// against it, and if the model changed the new JSON goes back to Swift as one undo step.
// Dialogs and forms render in this page, which Swift shows in a sheet while one is open.
//
// Messages to Swift (window.webkit.messageHandlers.wb.postMessage):
//   { type: 'ready', commands: [{ id, label, addOn }] }
//   { type: 'ui', open: boolean, wide: boolean }      a dialog or form opened / closed
//   { type: 'toast', message, kind }
//   { type: 'download', name, base64 }
import '../styles.css';
import * as THREE from 'three';
import { WorkbenchDocument, Group } from '../core/document';
import { AddOn, WorkbenchAPI, createAPI } from '../plugins/api';
import type { App, Command } from '../app/app';
import type { Tool } from '../tools/tool';
import lumber from '../../addons/lumber';
import steel from '../../addons/steel';
import cutlist from '../../addons/cutlist';
import cabinetDemo from '../../addons/cabinetDemo';

type Post = (msg: Record<string, unknown>) => void;
const post: Post = (msg) => {
  const h = (window as unknown as { webkit?: { messageHandlers?: { wb?: { postMessage: (m: unknown) => void } } } }).webkit?.messageHandlers?.wb;
  if (h) h.postMessage(msg);
  else console.log('[host]', msg);
};

/** Just enough of the web app's App for createAPI: a document, a context and a selection. */
class HostApp {
  doc = new WorkbenchDocument();
  context: Group = this.doc.root;
  fileName = '';
  selection = { faces: new Set<number>(), edges: new Set<string>(), groups: new Set<number>() };
  commands = new Map<string, Command & { addOn: string }>();
  tools = new Map<string, Tool>();
  currentAddOn = '';
  private listeners = new Map<string, Set<() => void>>();

  selectedGroups(): Group[] {
    return [...this.selection.groups].map((id) => this.doc.findGroup(id)).filter((g): g is Group => !!g);
  }
  setSelection(s: { faces?: number[]; edges?: string[]; groups?: number[] }) {
    this.selection = { faces: new Set(s.faces ?? []), edges: new Set(s.edges ?? []), groups: new Set(s.groups ?? []) };
  }
  setTool(_id: string) {}
  registerTool(t: Tool) {
    this.tools.set(t.id, t);
  }
  registerCommand(c: Command) {
    this.commands.set(c.id, { ...c, addOn: this.currentAddOn });
  }
  toast(message: string, kind?: string) {
    post({ type: 'toast', message, kind: kind ?? 'info' });
  }
  on(ev: string, fn: () => void) {
    if (!this.listeners.has(ev)) this.listeners.set(ev, new Set());
    this.listeners.get(ev)!.add(fn);
    return () => this.listeners.get(ev)?.delete(fn);
  }
  emit(ev: string) {
    for (const fn of this.listeners.get(ev) ?? []) fn();
  }
}

const app = new HostApp();

function toBase64(data: string | ArrayBuffer): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function activate(addOn: AddOn) {
  app.currentAddOn = addOn.name;
  const api: WorkbenchAPI = createAPI(app as unknown as App, addOn.id);
  api.ui.download = (name, data) => post({ type: 'download', name, base64: toBase64(data) });
  await addOn.activate(api);
}

// Tell Swift when a dialog or form opens and closes, so it can show this page in a sheet.
let open = false;
new MutationObserver(() => {
  const modal = document.querySelector('.modal');
  if (!!modal !== open) {
    open = !!modal;
    post({ type: 'ui', open, wide: !!modal?.classList.contains('wide') });
  }
}).observe(document.body, { childList: true, subtree: true });

interface RunResult {
  /** The changed model, or null when the command didn't change it. */
  doc: string | null;
  selection: number[];
  error?: string;
}

const host = {
  /** Run an add-on command on the model `docJSON`. */
  async run(id: string, docJSON: string, fileName: string, contextId: number, selectedGroups: number[]): Promise<RunResult> {
    const cmd = app.commands.get(id);
    if (!cmd) return { doc: null, selection: selectedGroups, error: `No add-on command "${id}"` };
    try {
      app.doc.load(docJSON);
    } catch (e) {
      return { doc: null, selection: selectedGroups, error: `Couldn't read the model: ${(e as Error).message}` };
    }
    app.fileName = fileName;
    app.context = (contextId && app.doc.findGroup(contextId)) || app.doc.root;
    app.setSelection({ groups: selectedGroups });
    const before = app.doc.serialize();
    try {
      await cmd.run();
    } catch (e) {
      return { doc: null, selection: selectedGroups, error: (e as Error).message ?? String(e) };
    }
    const after = app.doc.serialize();
    return { doc: after === before ? null : after, selection: [...app.selection.groups] };
  },
  commands() {
    return [...app.commands.values()].map((c) => ({ id: c.id, label: c.label, addOn: c.addOn }));
  },
};
(window as unknown as { wbHost: typeof host; THREE: typeof THREE }).wbHost = host;

(async () => {
  for (const a of [lumber, steel, cutlist, cabinetDemo]) {
    try {
      await activate(a);
    } catch (e) {
      console.error(`Add-on ${a.name} failed to load`, e);
    }
  }
  post({ type: 'ready', commands: host.commands() });
})();
