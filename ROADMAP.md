# Roadmap

Rough priorities, open to discussion in issues. ✅ = done in v0.1.

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
- [ ] Cut list → sheet/board layout optimizer (plywood nesting, 1D stock cutting for steel)

## Trade-specific add-ons
- [ ] Woodworking: joinery (mortise & tenon, dado, dovetail), hardware library, edge banding
- [ ] Welding/fab: weld symbols, miter-cut tube ends, bend allowance for sheet metal, weight from density
- [ ] Home: walls with openings, doors/windows, stairs calculator, framing (studs at 16" o.c.)
- [ ] RV: floor-plan templates for common rigs, appliance blocks (fridge, cooktop, toilet, tanks), weight & balance (CG) calculator

## Import / export
- ✅ STL, OBJ, PNG export; `.wb3d` save/open
- [ ] glTF/GLB export, DXF export (CNC/laser), SVG of faces
- ✅ SketchUp `.skp` import (2013 and later): groups, components, colours, tags, scenes, guides
- [ ] SketchUp import: textures, soft/smooth edges, text and dimensions
- [ ] STL/OBJ import
- [ ] 3MF export for 3D printing

## App
- ✅ Right-click context menu
- ✅ Desktop installers via Tauri, autosave
- [ ] Code-signed macOS and Windows builds
- [ ] Preferences dialog (mouse/trackpad mapping, colours, default units)
- [ ] Customizable shortcuts
- [ ] Add-on gallery
- [ ] Touch / iPad support
