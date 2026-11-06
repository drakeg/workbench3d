# Architecture

Workbench3D is a TypeScript web app built with [Vite](https://vite.dev) and [three.js](https://threejs.org). The desktop app is the same web app inside a [Tauri](https://tauri.app) window; the only desktop-specific code is file dialogs in `src/app/platform.ts`.

```
src/
  core/            Geometry and data. No DOM; runs in Node (unit tested).
    units.ts       Parse/format lengths: 1 1/2", 2' 6", 19mm…  Internal unit = inches.
    geom.ts        Plane math, polygon normals, triangulation helpers.
    mesh.ts        The editable geometry of one group: vertices, planar faces with holes,
                   loose lines. addPolygon / addLine / pushPull / splitEdge / erase…
    document.ts    Group tree (each group = mesh + transform), undo/redo, serialization.
    export.ts      STL and OBJ export.
  app/
    app.ts         Ties everything together: tools, commands, selection, editing context,
                   keyboard handling, the measurements box (VCB), live previews.
    viewport.ts    Renderer, cameras (Z-up), scene rebuilt from the document, picking.
    navigation.ts  Orbit / pan / zoom (mouse and trackpad).
    inference.ts   Snapping: endpoint, midpoint, on-edge, on-face, axis locks.
    commands.ts    Built-in menu commands (file, edit, view…).
    platform.ts    Browser vs desktop file access; safe localStorage.
  tools/           One class per tool, all implementing the Tool interface in tool.ts.
  plugins/api.ts   The add-on API and the add-on manager.
  ui/              Menus, toolbar, side panels, status bar, dialogs/forms.
addons/            Built-in add-ons (Lumber, Steel, Cut List); they only use the public API.
src-tauri/         Desktop shell (Rust). Rarely needs changes.
tests/             Vitest unit tests for core/.
scripts/smoke.mjs  End-to-end test that drives the real UI in headless Chrome.
```

## Key ideas

**Sticky geometry, separate groups.** Inside a group, faces share vertices and edges: move an edge and every face using it stretches. Groups isolate parts from each other and carry a transform, so a board can be moved and rotated without touching anything else. The editing *context* is the group currently open; tools only change the context's mesh.

**Faces are planar polygons with holes.** Each face has an outer loop (counter-clockwise around its normal) and hole loops (clockwise). This is what makes pockets work: drawing a rectangle inside a face turns it into a hole in that face plus a new inner face, and push/pulling the inner face builds walls.

**Push/pull rules** (`Mesh.pushPull`):
1. If every neighbour of the face is perpendicular to it (the top of a box), just move the face.
2. Otherwise build side walls. If a side would lie in the plane of an existing neighbour (the front of a board when cutting a rabbet), reshape that neighbour instead of stacking a second face on it.
3. A face that's part of a solid is replaced (pocket or boss); a lone face keeps its original as the opposite cap.

Faces drawn on the ground point down, so pulling one up gives outward-facing walls.

**Undo is snapshots.** `doc.transact(label, fn)` serializes the document before `fn` runs. It's simple and robust. Live previews (`app.live()`) restore the starting snapshot on every mouse move and re-apply the operation from scratch, so tools never accumulate drift. Because restore creates new objects, tools hold **ids**, never `Group`/`Face` references, across moves.

**Rendering is rebuilt from the document** on each change (`Viewport.rebuild`). That's fine for the model sizes we target today; incremental updates are on the roadmap.

## Coordinate system

Z is up. Red = X, green = Y, blue = Z. One unit = one inch. Files store raw inches; display units are a document setting.

## File format (`.wb3d`)

JSON:

```jsonc
{
  "format": "workbench3d",
  "version": 1,
  "units": { "system": "imperial", "fraction": 16, "mmDecimals": 0 },
  "nextGroupId": 4,
  "root": {
    "id": 0, "name": "Model", "matrix": [/* 16 numbers, column-major */],
    "mesh": { "nextId": 1, "verts": [[id, x, y, z]], "faces": [{ "id", "outer": [ids], "holes": [[ids]], "color"? }], "lines": [[a, b]] },
    "children": [ /* groups, same shape, optional "hidden" and "attributes" */ ]
  }
}
```

If you change the format, bump `version` and add a migration in `WorkbenchDocument.restore`.
