import * as THREE from 'three';
import { Group, WorkbenchDocument } from '../core/document';
import { formatLength } from '../core/units';
import { Tool, ToolEvent } from '../tools/tool';
import { Navigation } from './navigation';
import { Inference, InferOptions, infer } from './inference';
import { Viewport, isHidden, setHiddenTags } from './viewport';

export interface Command {
  id: string;
  label: string;
  /** Menu to show the command in, e.g. "Edit" or "Add-ons". */
  menu?: string;
  /** Like "Mod+G" (Mod = Cmd on Mac, Ctrl elsewhere), "Shift+Z", "Delete". */
  shortcut?: string;
  run: () => void | Promise<void>;
  enabled?: () => boolean;
  /** Visual separator before this item in its menu. */
  separatorBefore?: boolean;
  /** Also show in the right-click menu when enabled. */
  context?: boolean;
  /** A label that follows the state, e.g. "Undo Push/Pull" or "Hide Grid". */
  dynamicLabel?: () => string;
  /** Items of a submenu (e.g. Open Recent). The command itself is then just the parent. */
  submenu?: () => { label: string; run: () => void; enabled?: boolean; separatorBefore?: boolean }[];
}

export interface Selection {
  faces: Set<number>;
  edges: Set<string>;
  groups: Set<number>;
}

type AppEvent = 'selection' | 'tool' | 'context' | 'change' | 'vcb' | 'hint' | 'commands' | 'rename' | 'settings';

export { isMac } from './os';
import { isMac } from './os';

/**
 * Ties the document, viewport, tools and commands together.
 * Add-ons get at this through the API in src/plugins/api.ts rather than directly.
 */
export class App {
  readonly doc = new WorkbenchDocument();
  readonly vp: Viewport;
  readonly nav: Navigation;
  readonly tools = new Map<string, Tool>();
  readonly commands = new Map<string, Command>();
  tool: Tool | null = null;
  private previousToolId = 'select';
  contextId = 0;
  selection: Selection = { faces: new Set(), edges: new Set(), groups: new Set() };
  hoverFace: { groupId: number; faceId: number } | null = null;
  hoverGroup: number | null = null;
  xray = false;
  vcbText = '';
  vcbLabel = 'Measurements';
  vcbValue = '';
  hint = '';
  fileName = 'Untitled';
  private listeners = new Map<AppEvent, Set<() => void>>();
  private navActive = false;
  private navDown: { x: number; y: number; button: number } | null = null;
  private marker: HTMLDivElement;
  private markerLabel: HTMLDivElement;
  private lastPointer = { x: 0, y: 0 };
  /** Paint colour used by the paint tool. */
  paintColor = '#c8a26b';

  constructor(readonly container: HTMLElement) {
    this.vp = new Viewport(container);
    this.nav = new Navigation(this.vp, (x, y) => this.vp.raycastFaces(this.vp.ray(x, y))?.point ?? null);
    this.nav.onChange = () => this.repositionMarker();

    this.marker = document.createElement('div');
    this.marker.className = 'snap-marker';
    this.markerLabel = document.createElement('div');
    this.markerLabel.className = 'snap-label';
    container.append(this.marker, this.markerLabel);

    this.doc.onChange(() => {
      this.syncComponents();
      this.pruneSelection();
      this.refresh();
      this.emit('change');
    });
    this.bindInput();
  }

  // ---------- events ----------

  on(ev: AppEvent, fn: () => void): () => void {
    if (!this.listeners.has(ev)) this.listeners.set(ev, new Set());
    this.listeners.get(ev)!.add(fn);
    return () => this.listeners.get(ev)!.delete(fn);
  }

  emit(ev: AppEvent): void {
    for (const fn of this.listeners.get(ev) ?? []) fn();
  }

  // ---------- context & selection ----------

  get context(): Group {
    return this.doc.findGroup(this.contextId) ?? this.doc.root;
  }

  enterGroup(id: number): void {
    this.contextId = id;
    this.clearSelection();
    this.refresh();
    this.emit('context');
  }

  exitGroup(): void {
    const parent = this.context.parent;
    if (!parent) return;
    const was = this.context.id;
    this.contextId = parent.id;
    this.clearSelection(false);
    this.selection.groups.add(was);
    this.refresh();
    this.emit('context');
    this.emit('selection');
  }

  clearSelection(emit = true): void {
    this.selection = { faces: new Set(), edges: new Set(), groups: new Set() };
    this.selectedItems = new Set();
    if (emit) {
      this.refresh();
      this.emit('selection');
    }
  }

  selectionEmpty(): boolean {
    const s = this.selection;
    return !s.faces.size && !s.edges.size && !s.groups.size && !this.selectedItems.size;
  }

  selectedGroups(): Group[] {
    return [...this.selection.groups].map((id) => this.doc.findGroup(id)).filter((g): g is Group => !!g);
  }

  setSelection(sel: { faces?: Iterable<number>; edges?: Iterable<string>; groups?: Iterable<number>; items?: Iterable<number> }): void {
    this.selection = {
      faces: new Set(sel.faces ?? []),
      edges: new Set(sel.edges ?? []),
      groups: new Set(sel.groups ?? []),
    };
    this.selectedItems = new Set(sel.items ?? []);
    this.refresh();
    this.emit('selection');
  }

  private pruneSelection(): void {
    if (!this.doc.findGroup(this.contextId)) this.contextId = 0;
    const ctx = this.context;
    const edges = ctx.mesh.allEdges();
    for (const id of [...this.selection.faces]) if (!ctx.mesh.faces.has(id)) this.selection.faces.delete(id);
    for (const k of [...this.selection.edges]) if (!edges.has(k)) this.selection.edges.delete(k);
    for (const id of [...this.selection.groups]) if (!ctx.children.some((c) => c.id === id)) this.selection.groups.delete(id);
    const items = new Set([...this.doc.guides, ...this.doc.dimensions, ...this.doc.sections].map((x) => x.id));
    for (const id of [...this.selectedItems]) if (!items.has(id)) this.selectedItems.delete(id);
  }

  /** While editing inside a component instance, mirror the edit into every other instance. */
  syncComponents(): void {
    for (let g: Group | null = this.doc.findGroup(this.contextId) ?? null; g; g = g.parent) if (g.componentId != null) this.doc.syncComponent(g);
  }

  /** Which selectable thing in the current context a group's geometry belongs to. */
  entityFor(g: Group): { kind: 'raw' } | { kind: 'group'; group: Group } | null {
    const ctx = this.context;
    if (g === ctx) return { kind: 'raw' };
    for (let p: Group | null = g; p; p = p.parent) if (p.parent === ctx) return { kind: 'group', group: p };
    return null;
  }

  /** A guide, dimension or section plane near the cursor (these live at model level). */
  pickItem(x: number, y: number, px = 6): number | null {
    const mouse = new THREE.Vector2(x, y);
    let best: { d: number; id: number } | null = null;
    const consider = (id: number, a: THREE.Vector3, b: THREE.Vector3) => {
      const sa = this.vp.project(a);
      const sb = this.vp.project(b);
      if (sa.behind && sb.behind) return;
      const A = new THREE.Vector2(sa.x, sa.y);
      const AB = new THREE.Vector2(sb.x, sb.y).sub(A);
      const t = Math.max(0, Math.min(1, mouse.clone().sub(A).dot(AB) / Math.max(AB.lengthSq(), 1e-9)));
      const d = A.add(AB.multiplyScalar(t)).distanceTo(mouse);
      if (d < px && (!best || d < best.d)) best = { d, id };
    };
    for (const g of this.guideList()) {
      if (g.dir) {
        // clip the infinite guide to a long segment around the camera target
        const t = this.vp.target.clone().sub(g.point).dot(g.dir);
        const c = g.point.clone().add(g.dir.clone().multiplyScalar(t));
        const span = this.vp.persp.position.distanceTo(this.vp.target) * 4;
        consider(g.id, c.clone().addScaledVector(g.dir, -span), c.clone().addScaledVector(g.dir, span));
      } else consider(g.id, g.point, g.point);
    }
    for (const d of this.doc.dimensions) {
      const a = new THREE.Vector3(...d.a).add(new THREE.Vector3(...d.offset));
      const b = new THREE.Vector3(...d.b).add(new THREE.Vector3(...d.offset));
      consider(d.id, a, b);
    }
    // dimension labels are HTML; hit-test them directly
    const r = this.vp.dom.getBoundingClientRect();
    for (const el of this.container.querySelectorAll<HTMLElement>('.dim-label')) {
      const b = el.getBoundingClientRect();
      const cx = x + r.left;
      const cy = y + r.top;
      if (cx >= b.left && cx <= b.right && cy >= b.top && cy <= b.bottom) return Number(el.dataset.id);
    }
    if (this.showSectionPlanes) {
      for (const s of this.doc.sections) {
        const p = new THREE.Vector3(...s.point);
        const n = new THREE.Vector3(...s.normal);
        const ref = Math.abs(n.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
        const size = this.sectionSize();
        const u = new THREE.Vector3().crossVectors(ref, n).normalize().multiplyScalar(size);
        const v = new THREE.Vector3().crossVectors(n, u).normalize().multiplyScalar(size);
        const c = [u.clone().negate().sub(v), u.clone().sub(v), u.clone().add(v), u.clone().negate().add(v)].map((o) => p.clone().add(o));
        for (let i = 0; i < 4; i++) consider(s.id, c[i], c[(i + 1) % 4]);
      }
    }
    return (best as { d: number; id: number } | null)?.id ?? null;
  }

  /** Nearest edge of the active context within a few pixels of the cursor. */
  pickEdge(x: number, y: number, px = 6): string | null {
    const ctx = this.context;
    const m = ctx.worldMatrix();
    let best: { d: number; key: string } | null = null;
    const ray = this.vp.ray(x, y);
    const faceHit = this.vp.raycastFaces(ray);
    const maxDepth = faceHit ? faceHit.distance + this.vp.worldPerPixel(faceHit.point) * 4 : Infinity;
    for (const [key, [a, b]] of ctx.mesh.allEdges()) {
      const wa = ctx.mesh.v(a).clone().applyMatrix4(m);
      const wb = ctx.mesh.v(b).clone().applyMatrix4(m);
      const sa = this.vp.project(wa);
      const sb = this.vp.project(wb);
      if (sa.behind || sb.behind) continue;
      const A = new THREE.Vector2(sa.x, sa.y);
      const AB = new THREE.Vector2(sb.x, sb.y).sub(A);
      const t = Math.max(0, Math.min(1, new THREE.Vector2(x, y).sub(A).dot(AB) / Math.max(AB.lengthSq(), 1e-9)));
      const d = A.clone().add(AB.clone().multiplyScalar(t)).distanceTo(new THREE.Vector2(x, y));
      const mid = wa.clone().lerp(wb, t);
      if (d < px && (!best || d < best.d) && mid.distanceTo(ray.origin) <= maxDepth) best = { d, key };
    }
    return best?.key ?? null;
  }

  // ---------- coordinates ----------

  toLocal(p: THREE.Vector3): THREE.Vector3 {
    return p.clone().applyMatrix4(this.context.worldMatrix().invert());
  }

  dirToLocal(d: THREE.Vector3): THREE.Vector3 {
    const m = new THREE.Matrix3().setFromMatrix4(this.context.worldMatrix().invert());
    return d.clone().applyMatrix3(m);
  }

  toWorld(p: THREE.Vector3, g: Group = this.context): THREE.Vector3 {
    return p.clone().applyMatrix4(g.worldMatrix());
  }

  // ---------- inference & feedback ----------

  /** Shift-lock: the direction locked while Shift is held. */
  shiftLock: THREE.Vector3 | null = null;
  lastInference: Inference | null = null;
  lastInferenceFrom: THREE.Vector3 | null = null;
  /** Selected guides, dimensions and section planes (by id). */
  selectedItems = new Set<number>();

  infer(e: { x: number; y: number }, opts: InferOptions = {}): Inference {
    const o: InferOptions = { ...opts, guides: this.guideList() };
    if (this.shiftLock && o.from && !o.lockAxis && !o.lockDir) o.lockDir = this.shiftLock;
    const r = infer(e.x, e.y, this.doc.root, this.vp, o);
    this.lastInference = r;
    this.lastInferenceFrom = o.from ?? null;
    return r;
  }

  guideList(): { point: THREE.Vector3; dir?: THREE.Vector3; id: number }[] {
    return this.doc.guides.map((g) => ({ id: g.id, point: new THREE.Vector3(...g.point), dir: g.dir ? new THREE.Vector3(...g.dir) : undefined }));
  }

  private markerPoint: THREE.Vector3 | null = null;

  showInference(inf: Inference | null): void {
    this.vp.setInferenceGuide(inf?.guide ?? null);
    this.markerPoint = inf && inf.kind !== 'free' ? inf.point.clone() : null;
    if (!inf || !this.markerPoint) {
      this.marker.style.display = 'none';
      this.markerLabel.style.display = 'none';
      return;
    }
    this.marker.dataset.kind = inf.kind;
    this.marker.style.setProperty('--c', inf.color);
    this.markerLabel.textContent = inf.label;
    this.markerLabel.style.display = inf.label ? 'block' : 'none';
    this.repositionMarker();
  }

  private repositionMarker(): void {
    if (!this.markerPoint) return;
    const s = this.vp.project(this.markerPoint);
    if (s.behind) {
      this.marker.style.display = 'none';
      return;
    }
    this.marker.style.display = 'block';
    this.marker.style.transform = `translate(${s.x}px, ${s.y}px)`;
    this.markerLabel.style.transform = `translate(${this.lastPointer.x + 16}px, ${this.lastPointer.y + 18}px)`;
  }

  setHint(text: string): void {
    this.hint = text;
    this.emit('hint');
  }

  /** Show a value in the measurements box (e.g. the current length while drawing). */
  setVCB(value: string, label?: string): void {
    this.vcbValue = value;
    if (label) this.vcbLabel = label;
    this.emit('vcb');
  }

  fmt(inches: number): string {
    return formatLength(inches, this.doc.units);
  }

  // ---------- rendering ----------

  refresh(): void {
    setHiddenTags(new Set(this.doc.tags.filter((t) => !t.visible).map((t) => t.name)));
    this.vp.rebuild({
      root: this.doc.root,
      context: this.context,
      selectedFaces: this.selection.faces,
      selectedEdges: this.selection.edges,
      selectedGroups: this.selection.groups,
      hoverFace: this.hoverFace,
      hoverGroup: this.hoverGroup,
      xray: this.xray,
      guides: this.guideList(),
      dimensions: this.doc.dimensions.map((d) => {
        const a = new THREE.Vector3(...d.a);
        const b = new THREE.Vector3(...d.b);
        return { id: d.id, a, b, offset: new THREE.Vector3(...d.offset), text: this.fmt(a.distanceTo(b)) };
      }),
      section: (() => {
        const s = this.doc.sections.find((x) => x.active);
        return s ? { point: new THREE.Vector3(...s.point), normal: new THREE.Vector3(...s.normal) } : null;
      })(),
      sectionOutlines: this.showSectionPlanes
        ? this.doc.sections.map((x) => ({ id: x.id, active: x.active, point: new THREE.Vector3(...x.point), normal: new THREE.Vector3(...x.normal) }))
        : [],
      selectedItems: this.selectedItems,
      sectionSize: this.sectionSize(),
    });
  }

  showSectionPlanes = true;

  sectionSize(): number {
    const b = this.modelBounds();
    if (b.isEmpty()) return 30;
    return Math.max(12, b.getSize(new THREE.Vector3()).length() * 0.6);
  }

  /**
   * A change previewed live while the mouse moves. Each `apply` starts from the state at
   * `live()` time, so tools can recompute from scratch on every pointer move.
   */
  live(label: string) {
    const tx = this.doc.begin(label);
    let applied = false;
    return {
      apply: (fn: () => void) => {
        this.doc.restore(tx.snapshot);
        fn();
        this.syncComponents();
        applied = true;
        this.pruneSelection();
        this.refresh();
      },
      commit: () => {
        if (applied) tx.commit();
      },
      cancel: () => {
        tx.cancel();
      },
    };
  }

  // ---------- tools ----------

  registerTool(tool: Tool): void {
    this.tools.set(tool.id, tool);
    this.emit('tool');
  }

  setTool(id: string): void {
    const next = this.tools.get(id);
    if (!next) return;
    if (this.tool?.id !== id && this.tool && !this.tool.navigation) this.previousToolId = this.tool.id;
    this.tool?.deactivate?.(this);
    this.vp.clearOverlay();
    this.showInference(null);
    this.hoverFace = null;
    this.hoverGroup = null;
    this.vcbText = '';
    this.vcbLabel = next.vcbLabel ?? 'Measurements';
    this.vcbValue = '';
    this.tool = next;
    this.vp.dom.style.cursor = next.cursor ?? 'crosshair';
    this.setHint(next.hint ?? '');
    next.activate?.(this);
    this.refresh();
    this.emit('tool');
    this.emit('vcb');
  }

  /** Return to the last drawing/editing tool (used after orbit/pan). */
  previousTool(): void {
    this.setTool(this.previousToolId);
  }

  // ---------- commands ----------

  registerCommand(cmd: Command): void {
    this.commands.set(cmd.id, cmd);
    this.emit('commands');
  }

  private lastRun = { id: '', t: 0 };

  runCommand(id: string): void {
    // the native menu and the page can both see the same key press; run it once
    const now = performance.now();
    if (this.lastRun.id === id && now - this.lastRun.t < 150) return;
    this.lastRun = { id, t: now };
    const c = this.commands.get(id);
    if (!c || (c.enabled && !c.enabled())) return;
    Promise.resolve(c.run()).catch((err) => this.toast(String(err?.message ?? err), 'error'));
  }

  toast(message: string, kind: 'info' | 'error' = 'info', action?: { label: string; run: () => void }): void {
    const host = document.querySelector('.toasts') ?? document.body;
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = message;
    if (action) {
      const b = document.createElement('button');
      b.textContent = action.label;
      b.onclick = () => {
        action.run();
        el.remove();
      };
      el.append(b);
    }
    host.append(el);
    setTimeout(() => el.remove(), action ? 9000 : 3500);
  }

  // ---------- input ----------

  private toolEvent(e: PointerEvent | MouseEvent): ToolEvent {
    const r = this.vp.dom.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    return { x, y, ray: this.vp.ray(x, y), button: e.button, shift: e.shiftKey, copy: e.ctrlKey || e.altKey, native: e };
  }

  private bindInput(): void {
    const dom = this.vp.dom;
    dom.addEventListener('pointerdown', (e) => {
      dom.setPointerCapture(e.pointerId);
      (document.activeElement as HTMLElement | null)?.blur?.();
      const te = this.toolEvent(e);
      const mode = this.nav.wantsPointer(e, this.tool?.navigation ?? null);
      if (mode) {
        this.navActive = true;
        this.navDown = { x: e.clientX, y: e.clientY, button: e.button };
        this.nav.start(mode, te.x, te.y);
        return;
      }
      if (e.button === 0) this.tool?.pointerDown?.(te, this);
    });
    dom.addEventListener('pointermove', (e) => {
      const te = this.toolEvent(e);
      this.lastPointer = { x: te.x, y: te.y };
      if (this.navActive) {
        this.nav.move(te.x, te.y);
        return;
      }
      this.tool?.pointerMove?.(te, this);
      this.repositionMarker();
    });
    dom.addEventListener('pointerup', (e) => {
      if (this.navActive) {
        this.navActive = false;
        this.nav.end();
        // a right-click without dragging opens the context menu
        const d = this.navDown;
        if (d && d.button === 2 && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) this.contextMenu?.(e.clientX, e.clientY);
        this.navDown = null;
        return;
      }
      if (e.button === 0) this.tool?.pointerUp?.(this.toolEvent(e), this);
    });
    dom.addEventListener('dblclick', (e) => {
      if (e.altKey) return;
      this.tool?.doubleClick?.(this.toolEvent(e), this);
    });
    dom.addEventListener('pointerleave', () => this.showInference(null));

    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => {
      if (e.key === 'Shift' && this.shiftLock) {
        this.shiftLock = null;
        this.setHint(this.tool?.hint ?? '');
      }
      this.tool?.keyUp?.(e, this);
    });
    window.addEventListener('blur', () => (this.shiftLock = null));
  }

  /** Match a keyboard event against a shortcut string like "Mod+Shift+Z". */
  static matches(e: KeyboardEvent, shortcut: string): boolean {
    const parts = shortcut.split('+');
    let key = parts.pop()!.toLowerCase();
    if (key === '' && shortcut.endsWith('+')) key = '+';
    const mods = new Set(parts.map((p) => p.toLowerCase()));
    const mod = isMac ? e.metaKey : e.ctrlKey;
    if (mods.has('mod') !== mod) return false;
    if (mods.has('shift') !== e.shiftKey) return false;
    if (mods.has('alt') !== e.altKey) return false;
    if (isMac) {
      if (mods.has('ctrl') !== e.ctrlKey) return false;
      if (!mods.has('mod') && e.metaKey) return false;
    } else if (!mods.has('mod') && e.ctrlKey) return false;
    const k = e.key.toLowerCase();
    if (key === 'delete') return k === 'delete' || k === 'backspace';
    const codes: Record<string, string> = { '/': 'slash', ',': 'comma', '.': 'period', '?': 'slash' };
    if (codes[key] && e.code.toLowerCase() === codes[key]) return true;
    return k === key || e.code.toLowerCase() === `key${key}`;
  }

  private onKeyDown(e: KeyboardEvent): void {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (document.querySelector('.modal-backdrop')) return;
    const mod = isMac ? e.metaKey : e.ctrlKey;

    // A bare modifier press (e.g. tapping Ctrl/Option to toggle copy) goes to the tool.
    if (['Control', 'Alt', 'Meta', 'Shift'].includes(e.key)) {
      if (e.repeat) return;
      if (e.key === 'Shift') this.startShiftLock();
      this.tool?.keyDown?.(e, this);
      return;
    }

    // Commands with modifiers first (undo, save, group...)
    if (mod) {
      for (const c of this.commands.values()) {
        if (c.shortcut && App.matches(e, c.shortcut)) {
          e.preventDefault();
          this.runCommand(c.id);
          return;
        }
      }
      return;
    }

    // Shift+F10 or the Menu key opens the context menu at the pointer (Windows convention)
    if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      e.preventDefault();
      const r = this.vp.dom.getBoundingClientRect();
      this.contextMenu?.(r.left + this.lastPointer.x, r.top + this.lastPointer.y);
      return;
    }

    if (this.tool?.keyDown?.(e, this)) {
      e.preventDefault();
      return;
    }

    // Measurements box typing
    if (e.key === 'Enter') {
      if (this.vcbText) {
        const text = this.vcbText;
        this.vcbText = '';
        const ok = this.tool?.vcb?.(text, this) ?? false;
        if (!ok) this.toast(`"${text}" isn't a value this tool can use`, 'error');
        this.emit('vcb');
        e.preventDefault();
      }
      return;
    }
    if (e.key === 'Backspace' && this.vcbText) {
      this.vcbText = this.vcbText.slice(0, -1);
      this.emit('vcb');
      e.preventDefault();
      return;
    }
    const typing = this.vcbText.length > 0;
    if (e.key.length === 1 && (typing || /[0-9.\-/'",<*x]/.test(e.key))) {
      this.vcbText += e.key;
      this.emit('vcb');
      e.preventDefault();
      return;
    }

    if (e.key === 'Escape') {
      if (this.vcbText) {
        this.vcbText = '';
        this.emit('vcb');
        return;
      }
      if (this.tool?.cancel) this.tool.cancel(this);
      else this.escapeDefault();
      return;
    }

    for (const c of this.commands.values()) {
      if (c.shortcut && App.matches(e, c.shortcut)) {
        e.preventDefault();
        this.runCommand(c.id);
        return;
      }
    }
    if (e.key.length === 1 && !e.altKey) {
      const key = e.key === ' ' ? 'SPACE' : e.key.toUpperCase();
      for (const tool of this.tools.values()) {
        if (tool.shortcut && tool.shortcut.toUpperCase() === key && !e.shiftKey) {
          e.preventDefault();
          this.setTool(tool.id);
          return;
        }
      }
    }
  }

  /** Holding Shift locks the direction of the current inference (axis, parallel, or towards a point). */
  private startShiftLock(): void {
    const inf = this.lastInference;
    const from = this.lastInferenceFrom;
    if (!inf || !from) return;
    let dir: THREE.Vector3 | null = inf.dir?.clone() ?? null;
    if (!dir && (inf.kind === 'endpoint' || inf.kind === 'midpoint' || inf.kind === 'on-edge')) dir = inf.point.clone().sub(from);
    if (!dir || dir.lengthSq() < 1e-10) return;
    this.shiftLock = dir.normalize();
    this.setHint('Direction locked while Shift is held.');
  }

  /** Set by the file commands: open a model from text (drag and drop, Finder/Explorer). */
  openFileText: (text: string, name: string, path?: string) => Promise<void> = async () => {};
  openFilePath: (path: string) => Promise<void> = async () => {};
  /** Import another format (SketchUp .skp) into the open model. */
  importFile: (name: string, bytes: ArrayBuffer) => Promise<void> = async () => {};
  saveCurrent: () => Promise<void> = async () => {};

  /** Set by the UI: shows the right-click menu. */
  contextMenu: ((clientX: number, clientY: number) => void) | null = null;

  /** What Escape does when the tool has nothing in progress. */
  escapeDefault(): void {
    if (!this.selectionEmpty()) this.clearSelection();
    else if (this.context !== this.doc.root) this.exitGroup();
  }

  // ---------- scenes ----------

  /** Capture the current camera, hidden tags and active section as a scene. */
  captureScene(name: string): import('../core/document').Scene {
    const active = this.doc.sections.find((x) => x.active);
    return {
      name,
      camera: {
        position: this.vp.persp.position.toArray() as [number, number, number],
        target: this.vp.target.toArray() as [number, number, number],
        perspective: this.vp.perspective,
      },
      hiddenTags: this.doc.tags.filter((t) => !t.visible).map((t) => t.name),
      activeSection: active?.id ?? null,
    };
  }

  activeScene = -1;

  /** Go to a scene, animating the camera. Tag and section state switch immediately. */
  goToScene(index: number): void {
    const sc = this.doc.scenes[index];
    if (!sc) return;
    this.activeScene = index;
    for (const t of this.doc.tags) t.visible = !sc.hiddenTags.includes(t.name);
    for (const s of this.doc.sections) s.active = s.id === sc.activeSection;
    this.vp.perspective = sc.camera.perspective;
    this.refresh();
    this.emit('change');
    const fromP = this.vp.persp.position.clone();
    const fromT = this.vp.target.clone();
    const toP = new THREE.Vector3(...sc.camera.position);
    const toT = new THREE.Vector3(...sc.camera.target);
    const start = performance.now();
    const dur = 450;
    const step = () => {
      const k = Math.min(1, (performance.now() - start) / dur);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      this.vp.lookAt(fromP.clone().lerp(toP, e), fromT.clone().lerp(toT, e));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /** Bounds of all visible geometry (for zoom extents). */
  modelBounds(): THREE.Box3 {
    const box = new THREE.Box3();
    for (const g of this.doc.root.walk()) if (!isHidden(g)) box.union(g.mesh.bounds(g.worldMatrix()));
    return box;
  }
}
