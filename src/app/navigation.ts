import * as THREE from 'three';
import { Viewport } from './viewport';
import { settings } from './settings';

export type NavMode = 'orbit' | 'pan' | 'zoom' | null;

/**
 * Camera navigation, tuned for both mice and Mac trackpads:
 *  - Middle drag: orbit. Shift + middle drag: pan. Right drag: pan.
 *  - Option/Alt + drag: orbit. Option/Alt + Shift + drag: pan.
 *  - Scroll / pinch: zoom toward the cursor.
 * Orbit pivots around the point under the cursor.
 */
export class Navigation {
  mode: NavMode = null;
  private last = new THREE.Vector2();
  private pivot = new THREE.Vector3();
  private panPlanePoint = new THREE.Vector3();
  private pickPoint: (x: number, y: number) => THREE.Vector3 | null;
  onChange: () => void = () => {};

  constructor(private vp: Viewport, pickPoint: (x: number, y: number) => THREE.Vector3 | null) {
    this.pickPoint = pickPoint;
    vp.dom.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    vp.dom.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Decide whether a pointerdown is a navigation gesture. */
  wantsPointer(e: PointerEvent, toolNav: NavMode): NavMode {
    if (e.button === 1) return e.shiftKey ? 'pan' : 'orbit';
    if (e.button === 2) return settings().rightDragOrbits && !e.shiftKey ? 'orbit' : 'pan';
    if (e.button === 0 && e.altKey) return e.shiftKey ? 'pan' : 'orbit';
    if (e.button === 0 && toolNav) return toolNav;
    return null;
  }

  start(mode: NavMode, x: number, y: number): void {
    this.mode = mode;
    this.last.set(x, y);
    const hit = this.pickPoint(x, y);
    if (mode === 'orbit') {
      this.pivot.copy(hit ?? this.vp.target);
    } else if (mode === 'pan' || mode === 'zoom') {
      this.panPlanePoint.copy(hit ?? this.vp.target);
      this.pivot.copy(this.panPlanePoint);
    }
  }

  move(x: number, y: number): void {
    const dx = x - this.last.x;
    const dy = y - this.last.y;
    this.last.set(x, y);
    if (this.mode === 'orbit') this.orbit(dx, dy);
    else if (this.mode === 'pan') this.pan(dx, dy);
    else if (this.mode === 'zoom') this.zoomAt(this.vp.width / 2, this.vp.height / 2, Math.exp(dy * 0.01));
  }

  end(): void {
    this.mode = null;
  }

  orbit(dx: number, dy: number): void {
    const cam = this.vp.persp;
    const yaw = -dx * 0.006;
    const pitch = -dy * 0.006;
    const qYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), yaw);
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0).normalize();
    const qPitch = new THREE.Quaternion().setFromAxisAngle(right, pitch);
    const q = qYaw.clone().multiply(qPitch);
    // reject pitch that would flip over the pole
    const fwd = new THREE.Vector3();
    cam.getWorldDirection(fwd);
    const newFwd = fwd.clone().applyQuaternion(q);
    const useQ = Math.abs(newFwd.z) > 0.995 ? qYaw : q;
    const rot = (p: THREE.Vector3) => p.sub(this.pivot).applyQuaternion(useQ).add(this.pivot);
    rot(cam.position);
    rot(this.vp.target);
    cam.quaternion.premultiply(useQ);
    cam.updateMatrixWorld();
    this.fixUp();
    this.changed();
  }

  /** Keep the horizon level after orbiting. */
  private fixUp(): void {
    const cam = this.vp.persp;
    const fwd = new THREE.Vector3();
    cam.getWorldDirection(fwd);
    if (Math.abs(fwd.z) < 0.9999) {
      const t = cam.position.clone().add(fwd);
      cam.up.set(0, 0, 1);
      cam.lookAt(t);
      cam.updateMatrixWorld();
    }
  }

  pan(dx: number, dy: number): void {
    const cam = this.vp.persp;
    const wpp = this.vp.worldPerPixel(this.panPlanePoint);
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
    const delta = right.multiplyScalar(-dx * wpp).add(up.multiplyScalar(dy * wpp));
    cam.position.add(delta);
    this.vp.target.add(delta);
    cam.updateMatrixWorld();
    this.changed();
  }

  /** factor < 1 zooms in. */
  zoomAt(x: number, y: number, factor: number): void {
    const cam = this.vp.persp;
    const hit = this.pickPoint(x, y);
    let p: THREE.Vector3;
    if (hit) p = hit;
    else {
      // point on the plane through the target facing the camera
      const ray = this.vp.ray(x, y);
      const n = new THREE.Vector3();
      cam.getWorldDirection(n);
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, this.vp.target);
      p = ray.intersectPlane(plane, new THREE.Vector3()) ?? this.vp.target.clone();
    }
    const dist = cam.position.distanceTo(p);
    if (factor < 1 && dist * factor < 0.5) factor = 0.5 / Math.max(dist, 0.5);
    if (factor > 1 && cam.position.distanceTo(this.vp.target) > 50000) return;
    cam.position.sub(p).multiplyScalar(factor).add(p);
    this.vp.target.sub(p).multiplyScalar(factor).add(p);
    cam.updateMatrixWorld();
    this.changed();
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const rect = this.vp.dom.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    let dx = e.deltaX;
    let dy = e.deltaY;
    if (e.deltaMode === 1) {
      dx *= 16;
      dy *= 16;
    }
    // trackpads: pinch arrives as ctrl+wheel. With "scroll pans" on, two-finger scroll pans like Maps.
    if (settings().scrollPans && !e.ctrlKey) {
      if (this.mode === null) {
        this.panPlanePoint.copy(this.pickPoint(x, y) ?? this.vp.target);
        this.pan(-dx, -dy);
      }
      return;
    }
    if (settings().invertZoom) dy = -dy;
    const k = e.ctrlKey ? 0.01 : 0.0015;
    this.zoomAt(x, y, Math.exp(dy * k));
  }

  private changed(): void {
    this.vp.requestRender();
    this.onChange();
  }
}
