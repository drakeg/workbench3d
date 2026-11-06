import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { Group } from '../core/document';
import { parseEdgeKey } from '../core/mesh';

export const COLORS = {
  background: 0xeef1f4,
  face: '#f4f1ea',
  back: 0x9fb0c6,
  edge: 0x1d1f22,
  edgeDim: 0xb4b8be,
  select: 0x1a73e8,
  hover: 0xf2a900,
  axisX: 0xd93025,
  axisY: 0x188038,
  axisZ: 0x1a5fd0,
  grid: 0xd5dae0,
  gridMajor: 0xc3cad3,
};

export interface FaceHit {
  point: THREE.Vector3;
  group: Group;
  faceId: number;
  normal: THREE.Vector3;
  distance: number;
}

export interface RenderState {
  root: Group;
  context: Group;
  selectedFaces: Set<number>;
  selectedEdges: Set<string>;
  selectedGroups: Set<number>;
  hoverFace?: { groupId: number; faceId: number } | null;
  hoverGroup?: number | null;
  xray: boolean;
}

interface PickMesh extends THREE.Mesh {
  userData: { group: Group; triFace: number[] };
}

/** The 3D view: renderer, cameras, scene contents built from the document, and picking. */
export class Viewport {
  readonly dom: HTMLCanvasElement;
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly persp: THREE.PerspectiveCamera;
  readonly ortho: THREE.OrthographicCamera;
  perspective = true;
  readonly target = new THREE.Vector3(0, 0, 0);
  private model = new THREE.Group();
  readonly overlay = new THREE.Group();
  private helpers = new THREE.Group();
  private pickMeshes: PickMesh[] = [];
  private lineMaterials: LineMaterial[] = [];
  private needsRender = true;
  showGrid = true;
  width = 1;
  height = 1;

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.dom = this.renderer.domElement;
    this.dom.className = 'viewport-canvas';
    container.appendChild(this.dom);

    THREE.Object3D.DEFAULT_UP.set(0, 0, 1);
    this.persp = new THREE.PerspectiveCamera(35, 1, 0.1, 100000);
    this.persp.up.set(0, 0, 1);
    this.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -100000, 100000);
    this.ortho.up.set(0, 0, 1);
    this.persp.position.set(-120, -180, 110);
    this.persp.lookAt(this.target);

    this.scene.background = new THREE.Color(COLORS.background);
    const hemi = new THREE.HemisphereLight(0xffffff, 0x8a8f99, 1.6);
    hemi.position.set(0, 0, 1);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(-0.4, -0.7, 1);
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0xffffff, 0.5);
    fill.position.set(0.6, 0.5, 0.3);
    this.scene.add(fill);

    this.scene.add(this.helpers, this.model, this.overlay);
    this.buildHelpers();
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    const loop = () => {
      if (this.needsRender) {
        this.needsRender = false;
        this.syncOrtho();
        this.renderer.render(this.scene, this.camera);
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  get camera(): THREE.Camera {
    return this.perspective ? this.persp : this.ortho;
  }

  requestRender(): void {
    this.needsRender = true;
  }

  resize(): void {
    const r = this.container.getBoundingClientRect();
    this.width = Math.max(1, r.width);
    this.height = Math.max(1, r.height);
    this.renderer.setSize(this.width, this.height, false);
    this.dom.style.width = `${this.width}px`;
    this.dom.style.height = `${this.height}px`;
    this.persp.aspect = this.width / this.height;
    this.persp.updateProjectionMatrix();
    for (const m of this.lineMaterials) m.resolution.set(this.width, this.height);
    this.requestRender();
  }

  /** Keep the parallel-projection camera matched to the perspective one. */
  syncOrtho(): void {
    this.persp.updateMatrixWorld();
    const dist = this.persp.position.distanceTo(this.target);
    const h = 2 * dist * Math.tan(THREE.MathUtils.degToRad(this.persp.fov / 2));
    const w = h * (this.width / this.height);
    this.ortho.left = -w / 2;
    this.ortho.right = w / 2;
    this.ortho.top = h / 2;
    this.ortho.bottom = -h / 2;
    this.ortho.position.copy(this.persp.position);
    this.ortho.quaternion.copy(this.persp.quaternion);
    this.ortho.updateProjectionMatrix();
    this.ortho.updateMatrixWorld();
  }

  // ---------- coordinates ----------

  ndc(x: number, y: number): THREE.Vector2 {
    return new THREE.Vector2((x / this.width) * 2 - 1, -(y / this.height) * 2 + 1);
  }

  ray(x: number, y: number): THREE.Ray {
    this.syncOrtho();
    const rc = new THREE.Raycaster();
    rc.setFromCamera(this.ndc(x, y), this.camera);
    return rc.ray.clone();
  }

  /** World point to canvas pixels. z > 1 means behind the camera. */
  project(p: THREE.Vector3): { x: number; y: number; behind: boolean } {
    this.syncOrtho();
    const v = p.clone().project(this.camera);
    return { x: ((v.x + 1) / 2) * this.width, y: ((1 - v.y) / 2) * this.height, behind: v.z > 1 || v.z < -1 };
  }

  /** World units per pixel at a given point (for screen-size tolerances and pan). */
  worldPerPixel(at: THREE.Vector3): number {
    const fovH = 2 * Math.tan(THREE.MathUtils.degToRad(this.persp.fov / 2));
    if (!this.perspective) return (this.persp.position.distanceTo(this.target) * fovH) / this.height;
    const dir = new THREE.Vector3();
    this.persp.getWorldDirection(dir);
    const depth = Math.max(0.01, at.clone().sub(this.persp.position).dot(dir));
    return (depth * fovH) / this.height;
  }

  // ---------- helpers (grid + axes) ----------

  private makeLineMaterial(color: number, width: number, opts: Partial<{ dashed: boolean; opacity: number; depthTest: boolean }> = {}) {
    const m = new LineMaterial({
      color,
      linewidth: width,
      dashed: !!opts.dashed,
      dashSize: 6,
      gapSize: 4,
      transparent: opts.opacity !== undefined && opts.opacity < 1,
      opacity: opts.opacity ?? 1,
      depthTest: opts.depthTest ?? true,
      worldUnits: false,
    });
    m.resolution.set(this.width, this.height);
    this.lineMaterials.push(m);
    return m;
  }

  private segments(positions: number[], material: LineMaterial, colors?: number[]): LineSegments2 {
    const g = new LineSegmentsGeometry();
    g.setPositions(positions);
    if (colors) g.setColors(colors);
    const l = new LineSegments2(g, material);
    if (material.dashed) l.computeLineDistances();
    return l;
  }

  private buildHelpers(): void {
    this.helpers.clear();
    if (this.showGrid) {
      const minor: number[] = [];
      const major: number[] = [];
      const step = 12;
      const n = 40;
      for (let i = -n; i <= n; i++) {
        const arr = i % 10 === 0 ? major : minor;
        if (i === 0) continue;
        arr.push(i * step, -n * step, 0, i * step, n * step, 0);
        arr.push(-n * step, i * step, 0, n * step, i * step, 0);
      }
      const gm = new THREE.LineBasicMaterial({ color: COLORS.grid, transparent: true, opacity: 0.7, depthWrite: false });
      const gM = new THREE.LineBasicMaterial({ color: COLORS.gridMajor, transparent: true, opacity: 0.9, depthWrite: false });
      const mk = (a: number[], m: THREE.Material) => {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(a, 3));
        const l = new THREE.LineSegments(g, m);
        l.position.z = -0.03; // just under the ground so faces drawn on it hide the grid
        l.renderOrder = -2;
        return l;
      };
      this.helpers.add(mk(minor, gm), mk(major, gM));
    }
    const L = 5000;
    const axis = (color: number, a: number[], b: number[]) => {
      this.helpers.add(this.segments([0, 0, 0, ...a], this.makeLineMaterial(color, 1.6)));
      this.helpers.add(this.segments([0, 0, 0, ...b], this.makeLineMaterial(color, 1.2, { dashed: true, opacity: 0.6 })));
    };
    axis(COLORS.axisX, [L, 0, 0], [-L, 0, 0]);
    axis(COLORS.axisY, [0, L, 0], [0, -L, 0]);
    axis(COLORS.axisZ, [0, 0, L], [0, 0, -L]);
  }

  setGridVisible(v: boolean): void {
    this.showGrid = v;
    this.buildHelpers();
    this.requestRender();
  }

  // ---------- model ----------

  /** Rebuild all model geometry from the document. Cheap enough to call on every change. */
  rebuild(state: RenderState): void {
    for (const c of this.model.children) disposeDeep(c);
    this.model.clear();
    this.pickMeshes = [];
    const ctx = state.context;
    const inContextTree = new Set<number>();
    for (const g of ctx.walk()) inContextTree.add(g.id);
    const editingInside = ctx !== state.root;

    const edgeNormal: number[] = [];
    const edgeDim: number[] = [];
    const edgeSel: number[] = [];
    const edgeHover: number[] = [];
    const selFaceTris: number[] = [];
    const hoverTris: number[] = [];
    const selectedTrees = new Set<number>();
    for (const id of state.selectedGroups) {
      const g = ctx.children.find((c) => c.id === id);
      if (g) for (const d of g.walk()) selectedTrees.add(d.id);
    }
    const hoverTree = new Set<number>();
    if (state.hoverGroup != null) {
      const g = ctx.children.find((c) => c.id === state.hoverGroup);
      if (g) for (const d of g.walk()) hoverTree.add(d.id);
    }

    for (const g of state.root.walk()) {
      if (isHidden(g)) continue;
      const m = g.worldMatrix();
      const mesh = g.mesh;
      const dim = editingInside && !inContextTree.has(g.id);
      const isCtx = g === ctx;
      // faces
      const pos: number[] = [];
      const col: number[] = [];
      const triFace: number[] = [];
      const c = new THREE.Color();
      const world = new Map<number, THREE.Vector3>();
      const W = (id: number) => {
        let p = world.get(id);
        if (!p) {
          p = mesh.v(id).clone().applyMatrix4(m);
          world.set(id, p);
        }
        return p;
      };
      for (const f of mesh.faces.values()) {
        c.set(f.color ?? COLORS.face);
        const sel = isCtx && state.selectedFaces.has(f.id);
        const hov = state.hoverFace && state.hoverFace.groupId === g.id && state.hoverFace.faceId === f.id;
        for (const tri of mesh.triangulateFace(f)) {
          for (const id of tri) {
            const p = W(id);
            pos.push(p.x, p.y, p.z);
            col.push(c.r, c.g, c.b);
            if (sel) selFaceTris.push(p.x, p.y, p.z);
            if (hov) hoverTris.push(p.x, p.y, p.z);
          }
          triFace.push(f.id);
        }
      }
      if (pos.length) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
        geo.computeVertexNormals();
        const transparent = dim || state.xray;
        const front = new THREE.MeshLambertMaterial({
          vertexColors: true,
          side: THREE.FrontSide,
          transparent,
          opacity: dim ? 0.25 : state.xray ? 0.45 : 1,
          depthWrite: !transparent,
          polygonOffset: true,
          polygonOffsetFactor: 1,
          polygonOffsetUnits: 1,
        });
        const back = new THREE.MeshLambertMaterial({
          color: COLORS.back,
          side: THREE.BackSide,
          transparent,
          opacity: dim ? 0.25 : state.xray ? 0.45 : 1,
          depthWrite: !transparent,
          polygonOffset: true,
          polygonOffsetFactor: 1,
          polygonOffsetUnits: 1,
        });
        const fm = new THREE.Mesh(geo, front) as unknown as PickMesh;
        fm.userData = { group: g, triFace };
        const bm = new THREE.Mesh(geo, back);
        this.model.add(fm, bm);
        this.pickMeshes.push(fm);
      }
      // edges
      const highlight = selectedTrees.has(g.id);
      const hoverG = hoverTree.has(g.id);
      for (const [key, [a, b]] of mesh.allEdges()) {
        const pa = W(a);
        const pb = W(b);
        const arr =
          (isCtx && state.selectedEdges.has(key)) || highlight
            ? edgeSel
            : hoverG
              ? edgeHover
              : dim
                ? edgeDim
                : edgeNormal;
        arr.push(pa.x, pa.y, pa.z, pb.x, pb.y, pb.z);
      }
      // selected faces also show their edges as selected
      if (isCtx) {
        for (const fid of state.selectedFaces) {
          const f = mesh.faces.get(fid);
          if (!f) continue;
          for (const k of mesh.faceEdgeKeys(f)) {
            const [a, b] = parseEdgeKey(k);
            const pa = W(a);
            const pb = W(b);
            edgeSel.push(pa.x, pa.y, pa.z, pb.x, pb.y, pb.z);
          }
        }
      }
    }

    if (edgeNormal.length) this.model.add(this.segments(edgeNormal, this.lineMat('edge', COLORS.edge, 1.4)));
    if (edgeDim.length) this.model.add(this.segments(edgeDim, this.lineMat('dim', COLORS.edgeDim, 1)));
    if (edgeHover.length) this.model.add(this.segments(edgeHover, this.lineMat('hover', COLORS.hover, 2)));
    if (edgeSel.length) {
      const l = this.segments(edgeSel, this.lineMat('sel', COLORS.select, 2.4));
      l.renderOrder = 2;
      this.model.add(l);
    }
    const overlayFaces = (tris: number[], color: number, opacity: number) => {
      if (!tris.length) return;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(tris, 3));
      const m = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        side: THREE.DoubleSide,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      });
      const mesh = new THREE.Mesh(geo, m);
      mesh.renderOrder = 1;
      this.model.add(mesh);
    };
    overlayFaces(selFaceTris, COLORS.select, 0.32);
    overlayFaces(hoverTris, COLORS.hover, 0.25);

    // boxes around selected groups and the group being edited
    for (const id of state.selectedGroups) {
      const g = ctx.children.find((c) => c.id === id);
      if (g && !isHidden(g)) this.model.add(this.boxLines(g, this.lineMat('selbox', COLORS.select, 1.2)));
    }
    if (editingInside) this.model.add(this.boxLines(ctx, this.lineMat('ctxbox', 0x6b7280, 1, true)));
    this.requestRender();
  }

  private cachedMats = new Map<string, LineMaterial>();
  private lineMat(key: string, color: number, width: number, dashed = false): LineMaterial {
    let m = this.cachedMats.get(key);
    if (!m) {
      m = this.makeLineMaterial(color, width, { dashed });
      this.cachedMats.set(key, m);
    }
    return m;
  }

  private boxLines(g: Group, mat: LineMaterial): LineSegments2 {
    const b = g.localBounds();
    if (b.isEmpty()) b.set(new THREE.Vector3(), new THREE.Vector3());
    const pad = 0.15;
    b.expandByScalar(pad);
    const m = g.worldMatrix();
    const c = [
      [b.min.x, b.min.y, b.min.z],
      [b.max.x, b.min.y, b.min.z],
      [b.max.x, b.max.y, b.min.z],
      [b.min.x, b.max.y, b.min.z],
      [b.min.x, b.min.y, b.max.z],
      [b.max.x, b.min.y, b.max.z],
      [b.max.x, b.max.y, b.max.z],
      [b.min.x, b.max.y, b.max.z],
    ].map(([x, y, z]) => new THREE.Vector3(x, y, z).applyMatrix4(m));
    const idx = [0, 1, 1, 2, 2, 3, 3, 0, 4, 5, 5, 6, 6, 7, 7, 4, 0, 4, 1, 5, 2, 6, 3, 7];
    const pos: number[] = [];
    for (const i of idx) pos.push(c[i].x, c[i].y, c[i].z);
    return this.segments(pos, mat);
  }

  // ---------- overlay (tool previews) ----------

  clearOverlay(): void {
    for (const c of this.overlay.children) {
      const temp = (c.userData as { tempMaterial?: LineMaterial }).tempMaterial;
      if (temp) this.lineMaterials = this.lineMaterials.filter((m) => m !== temp);
      disposeDeep(c, true);
    }
    this.overlay.clear();
    this.requestRender();
  }

  overlayLines(positions: number[], color: number, width = 2, dashed = false, onTop = true): void {
    if (!positions.length) return;
    const m = this.makeLineMaterial(color, width, { dashed, depthTest: !onTop });
    const l = this.segments(positions, m);
    l.renderOrder = 10;
    (l.userData as { tempMaterial?: LineMaterial }).tempMaterial = m;
    this.overlay.add(l);
    this.requestRender();
  }

  overlayPolygon(points: THREE.Vector3[], color: number, opacity = 0.2): void {
    if (points.length < 3) return;
    const shapePts = points;
    const geo = new THREE.BufferGeometry();
    const pos: number[] = [];
    for (let i = 1; i < shapePts.length - 1; i++) {
      for (const p of [shapePts[0], shapePts[i], shapePts[i + 1]]) pos.push(p.x, p.y, p.z);
    }
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false }),
    );
    mesh.renderOrder = 9;
    this.overlay.add(mesh);
    this.requestRender();
  }

  // ---------- picking ----------

  raycastFaces(ray: THREE.Ray, filter?: (g: Group) => boolean): FaceHit | null {
    const rc = new THREE.Raycaster(ray.origin, ray.direction);
    const meshes = filter ? this.pickMeshes.filter((m) => filter(m.userData.group)) : this.pickMeshes;
    // faces are pickable from both sides (ground faces show their back from above)
    for (const m of meshes) (m.material as THREE.Material).side = THREE.DoubleSide;
    const hits = rc.intersectObjects(meshes, false);
    for (const m of meshes) (m.material as THREE.Material).side = THREE.FrontSide;
    for (const h of hits) {
      const pm = h.object as PickMesh;
      if (h.faceIndex == null) continue;
      const faceId = pm.userData.triFace[h.faceIndex];
      const g = pm.userData.group;
      const f = g.mesh.faces.get(faceId);
      if (!f) continue;
      const nm = new THREE.Matrix3().getNormalMatrix(g.worldMatrix());
      const normal = g.mesh.normal(f).applyMatrix3(nm).normalize();
      return { point: h.point.clone(), group: g, faceId, normal, distance: h.distance };
    }
    return null;
  }

  // ---------- camera helpers ----------

  lookAt(position: THREE.Vector3, target: THREE.Vector3): void {
    this.persp.position.copy(position);
    this.target.copy(target);
    const dir = target.clone().sub(position).normalize();
    // looking straight down/up: pick a stable up vector
    if (Math.abs(dir.z) > 0.9999) this.persp.up.set(0, 1, 0);
    else this.persp.up.set(0, 0, 1);
    this.persp.lookAt(target);
    this.persp.up.set(0, 0, 1);
    this.persp.updateMatrixWorld();
    this.requestRender();
  }

  zoomExtents(box: THREE.Box3): void {
    if (box.isEmpty()) box = new THREE.Box3(new THREE.Vector3(-60, -60, 0), new THREE.Vector3(60, 60, 40));
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 6);
    const dir = this.persp.position.clone().sub(this.target).normalize();
    const fov = THREE.MathUtils.degToRad(this.persp.fov);
    const fit = Math.min(fov, 2 * Math.atan(Math.tan(fov / 2) * this.persp.aspect));
    const dist = (radius / Math.sin(fit / 2)) * 1.05;
    this.lookAt(center.clone().add(dir.multiplyScalar(dist)), center);
  }

  setStandardView(view: 'iso' | 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right', box: THREE.Box3): void {
    const dirs: Record<string, THREE.Vector3> = {
      iso: new THREE.Vector3(-1, -1.4, 0.95),
      top: new THREE.Vector3(0, -0.0001, 1),
      bottom: new THREE.Vector3(0, 0.0001, -1),
      front: new THREE.Vector3(0, -1, 0),
      back: new THREE.Vector3(0, 1, 0),
      left: new THREE.Vector3(-1, 0, 0),
      right: new THREE.Vector3(1, 0, 0),
    };
    const d = dirs[view].clone().normalize();
    this.lookAt(this.target.clone().add(d.multiplyScalar(100)), this.target.clone());
    this.zoomExtents(box);
  }

  screenshot(): string {
    this.syncOrtho();
    this.renderer.render(this.scene, this.camera);
    return this.dom.toDataURL('image/png');
  }
}

export function isHidden(g: Group): boolean {
  for (let p: Group | null = g; p; p = p.parent) if (p.hidden) return true;
  return false;
}

function disposeDeep(o: THREE.Object3D, materialsToo = false): void {
  o.traverse((x) => {
    const anyX = x as THREE.Object3D & { geometry?: THREE.BufferGeometry; material?: THREE.Material | THREE.Material[] };
    anyX.geometry?.dispose();
    const temp = (x.userData as { tempMaterial?: THREE.Material }).tempMaterial;
    if (temp) temp.dispose();
    if (materialsToo || !(anyX.material instanceof LineMaterial)) {
      const mats = Array.isArray(anyX.material) ? anyX.material : anyX.material ? [anyX.material] : [];
      for (const m of mats) if (!(m instanceof LineMaterial) || temp === m) m.dispose();
    }
  });
}
