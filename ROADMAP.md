# Roadmap

Long-term capabilities and rough priorities, open to discussion in issues. The actionable [backlog](docs/BACKLOG.md), [planned sprints](docs/SPRINTS.md), and [Agile process](docs/AGILE.md) govern execution. ✅ marks existing functionality; some entries were completed after v0.1.

## Ready-to-demo SMB workflow
- ✅ Insert a reproducible six-panel plywood cabinet using the Sample Cabinet built-in add-on (demo, not a fabrication drawing)
- [ ] Observe and validate the complete cut-list → sheet-layout → printable PDF customer workflow

## Fabrication output
- [x] Printable orthographic top/front/right PDF views with true printed 1:N scale and model envelope dimensions (wireframe reference, not manufacturing drawings)
- [ ] Hidden-line suppression, part-level detailed dimensions, drawing layouts and tolerances

## Core modeling
- ✅ Line, rectangle, circle, push/pull, move, rotate, tape measure, eraser, paint
- ✅ Inference: endpoint, midpoint, on-edge, on-face, axis + arrow-key axis lock
- ✅ Faces with holes (pockets/bosses), face splitting, rabbets
- ✅ Groups, nested editing, explode, hide; move/rotate copies and arrays
- ✅ **Components**: reusable definitions; edit one, all copies update (doors, drawers, studs)
- ✅ **Scale** tool and **Offset** tool
- [ ] **Follow Me** (sweep a profile along a path: trim, mouldings, handrails, bent tube)
- ✅ 2-point arc and polygons
- [ ] 3-point arc, pie, freehand
- [ ] Intersect faces / solid tools (union, subtract) for joinery and cope cuts
- ✅ "From point" inference, parallel/perpendicular inference, Shift lock
- [ ] Inference along face normals, tangents to arcs
- ✅ Guide lines and guide points (tape measure creates guides)
- [ ] Protractor tool (angled guides)
- [ ] Soften/smooth edges for curved surfaces
- [ ] Half-edge data structure and incremental rendering for big models

## Documentation & output
- ✅ Linear dimension tool
- [ ] Text labels with leaders, angular/radial dimensions
- ✅ Scenes (saved camera views) and section planes
- [ ] Section fills (caps on cut faces), scene transitions for presentations/video
- ✅ Tags / layers with visibility
- [ ] Printable shop drawings: orthographic views with dimensions to PDF
- ✅ Cut list layout: parts on sheets and boards with saw kerf, trim and grain; steel cut from 20' sticks; printable PDF cutting plan
- ✅ Cut list: optional user-entered stock prices and material estimate (PR #40)
- [ ] Cut list: edge banding, offcut reuse across projects and part labels

## Trade-specific add-ons
- [ ] Woodworking: joinery (mortise & tenon, dado, dovetail), hardware library, edge banding
- [ ] Welding/fab: weld symbols, miter-cut tube ends, bend allowance for sheet metal, weight from density
- [ ] Home: walls with openings, doors/windows, stairs calculator, framing (studs at 16" o.c.)
- [ ] RV: floor-plan templates for common rigs, appliance blocks (fridge, cooktop, toilet, tanks), weight & balance (CG) calculator

## Import / export
- ✅ STL, OBJ, PNG export; `.wb3d` save/open
- ✅ glTF/GLB export
- [ ] DXF export (CNC/laser), SVG of faces
- ✅ SketchUp `.skp` import (2013 and later): groups, components, colours, tags, scenes, guides
- [ ] SketchUp import: textures, soft/smooth edges, text and dimensions
- ✅ STL import (binary and ASCII; user-specified units)
- [ ] OBJ import
- [ ] 3MF export for 3D printing

## App
- ✅ Right-click context menu
- ✅ Desktop installers via Tauri, autosave
- [ ] Code-signed macOS and Windows builds
- [ ] Preferences dialog (mouse/trackpad mapping, colours, default units)
- [ ] Customizable shortcuts
- [ ] Add-on gallery
- [ ] Touch / iPad support

## Peer issue-inspired improvements (independent implementations)
The [issue research register](docs/PEER_ISSUE_RESEARCH.md) links specific Sawhorse, SketchCraft, IngeTrazo, WoodSketch, OpenCutList and FreeCAD issues to **new** Workbench3D stories. BenchUp published functionality is compared separately because its issues could not be verified with the connected GitHub tool. No third-party code or assets will be used.

- **Correctness first:** future-proof saves/recovery (WB-017), associative dimensions (WB-018), dimension round-trip and rounding (WB-019), sections/scenes (WB-020), correct nesting and fields (WB-022/023), tool/import regression tests (WB-024).
- **Shop productivity:** component quantities (WB-021), reusable offcuts and realistic costs (WB-026), configurable cabinets (WB-027), joints and hardware (WB-028), assembly plans (WB-029), fabrication exports (WB-032).
- **Drawing quality:** sheet layouts, vector/hidden-line views, sections, hatch styles and physical-size validation (WB-030/031/038).
- **Extensibility and scale:** guarded CLI/MCP (WB-025), large-model budgets (WB-033), UI/accessibility improvements (WB-034/037), import fidelity (WB-035), advanced geometry (WB-036).

These items are **Proposed** until tested and merged. See Sprints 07–12 in [SPRINTS.md](docs/SPRINTS.md); continue ready development without treating customer discovery as a block.
