import type * as THREE from 'three';
import type { App } from '../app/app';

export interface ToolEvent {
  /** Canvas-relative pixel coordinates. */
  x: number;
  y: number;
  ray: THREE.Ray;
  button: number;
  shift: boolean;
  /** Ctrl on Windows/Linux, Option on Mac: the "copy" modifier. */
  copy: boolean;
  native: PointerEvent | MouseEvent;
}

/**
 * A tool reacts to pointer and keyboard input in the viewport.
 * Built-in tools and add-on tools implement the same interface.
 */
export interface Tool {
  id: string;
  name: string;
  /** SVG markup (24x24 viewBox) shown on the toolbar. */
  icon?: string;
  /** Single key shortcut, e.g. "L". */
  shortcut?: string;
  /** Status bar text when the tool starts. */
  hint?: string;
  /** Label for the measurements box. */
  vcbLabel?: string;
  /** Use left-drag for camera navigation (orbit/pan/zoom tools). */
  navigation?: 'orbit' | 'pan' | 'zoom';
  cursor?: string;

  activate?(app: App): void;
  deactivate?(app: App): void;
  pointerDown?(e: ToolEvent, app: App): void;
  pointerMove?(e: ToolEvent, app: App): void;
  pointerUp?(e: ToolEvent, app: App): void;
  doubleClick?(e: ToolEvent, app: App): void;
  /** Return true if the key was used. */
  keyDown?(e: KeyboardEvent, app: App): boolean;
  keyUp?(e: KeyboardEvent, app: App): boolean;
  /** Text typed into the measurements box. Return true if accepted. */
  vcb?(text: string, app: App): boolean;
  /** Escape pressed. */
  cancel?(app: App): void;
}
