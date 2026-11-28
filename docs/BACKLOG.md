# Workbench3D prioritized backlog

This is the actionable companion to [ROADMAP.md](../ROADMAP.md) and [SPRINTS.md](SPRINTS.md). Estimates and ordering are initial proposals, not promises. Create/link GitHub Issues as implementation begins.

| ID | Priority | Points | Status | User outcome / acceptance | Dependency |
|---|---|---:|---|---|---|
| WB-001 | P1 | 2 | Done (PR #29) | Reject malformed measurements and zero denominators; signed feet/inches parse correctly and have regression tests | None |
| WB-002 | P2 | 3 | Done (PR #35) | Import STL mesh into a new model/group with predictable units, useful errors and fixtures | Import architecture investigation |
| WB-003 | P2 | 3 | Done (PR #36) | Export glTF/GLB with preserved group transforms and colors and loadable fixture | Mesh export coverage |
| WB-004 | P2 | 5 | In progress (wireframe increment merged in PR #41) | Offer printable orthographic shop drawing with dimensions and correct page scale | Dimension and PDF modules |
| WB-005 | P2 | 3 | Done (PR #40) | Cut-list estimate accepts stock prices and displays calculated cost totals | Cut-list layout |
| WB-006 | P2 | 5 | Proposed | RV floor plan starter templates plus commonly used appliance shapes and editable dimensions | Add-on API |
| WB-007 | P2 | 5 | Proposed | Follow Me sweep can construct a simple profile along a path; test closed solids and undo | Geometry engine |
| WB-008 | P2 | 3 | Done (PR #32) | Save/open round-trip tests and import failure reporting protect user files | Serialization fixtures |
| WB-009 | P3 | 3 | Proposed | Adjustable shortcuts persisted by platform, with collision detection | Settings UI |
| WB-010 | P3 | 3 | Proposed | 3-point arc tool with exact measurements and undo | Draw tool framework |
| WB-011 | P2 | 5 | Proposed | DXF/SVG vector export suitable for CNC/laser, with unit and scale checks | Geometry export |
| WB-013 | P2 | 2 | Done (PR #34) | Verify README technology/workflow/release/community badges, link sources, document conventions, and check them in CI | Root README; CI |
| WB-014 | P1 | 3 | Done (PR #37) | Supply LAN-accessible Docker browser testing, verify container response in CI and preserve default web hosting | Docker Compose, CI |
| WB-015 | P2 | 2 | Done (PR #37) | Adopt security disclosure, central standards and evidence-based SMB validation workflow | SECURITY, AGENTS, commercialization |
| WB-016 | P1 | 3 | Done (PR #38) | Deliver reproducible cabinet sample, material cut-list and print workflow with user-observed errors captured | Demo fixture, cut list |
| WB-012 | P3 | 2 | Proposed | Desktop signing/notarization plan and reproducible release validation | Signing credentials and maintainer approval |

| WB-MAC-01 | P2 | 3 | Done (PR #39) | Native Mac app: Tags and Scenes panels (show/hide, rename, delete, tag selection, save/update/step through scenes), with self-test checks and snapshots | Mac milestone 1 |
| WB-MAC-02 | P1 | 5 | Done (PR #43) | Native Mac Cut List for the SMB cabinet workflow: parts, sheet/board layout with kerf, trim and grain, PDF cutting plan and CSV (re-scoped from running the HTML add-ons, which need a browser) | Add-on API |
| WB-MAC-03 | P2 | 5 | In progress (Polygon/Scale #42 and Dimension #44 merged; Section merged #45; native SKP import pending) | Native Mac app: remaining tools (Polygon, Scale, Dimension, Section) and SketchUp .skp import | Mac milestone 1 |

## Peer issue-driven backlog (independent implementations)

Source issue-by-issue provenance, eligibility and detailed acceptance criteria: [PEER_ISSUE_RESEARCH.md](PEER_ISSUE_RESEARCH.md). These are **Workbench3D-specific** proposals, not upstream code transfers or confirmed local defects. Status stays Proposed until work is verified. P1 correctness is the next active hardening track; it does not stop other ready sprints or commercialization exploration.

| ID | Priority | Points | Status | User outcome / acceptance | Dependency |
|---|---|---:|---|---|---|
| WB-017 | P1 | 5 | In Review (first increment) | Protect files and recovery: unsupported future versions/fields refuse destructive save; Save/Don't Save/Cancel and desktop recovery tests | WB-008, file format |
| WB-018 | P1 | 8 | Proposed | Associative dimensions follow edited geometry or warn when detached; stable references, undo and compatible save/reopen | WB-004, dimensions |
| WB-019 | P1 | 3 | In progress (PR #49 merged; CSV/PDF export fixture PR pending; native parity remains) | Golden inch/mm/fraction fixtures agree across model, cut list, PDF and CSV; documented precision | WB-001, WB-005 |
| WB-020 | P1 | 5 | Proposed | Section/scene/tag visibility and selection stay consistent on edits, undo, PDF and reopen; no lost planes | WB-MAC-03, WB-004 |
| WB-021 | P1 | 5 | Proposed | Repeated cabinet parts become named component instances; cut-list quantities, grouping and Outliner reparenting preserve transforms | WB-016, components |
| WB-022 | P1 | 5 | In progress (PRs #52, #55 and #56 merged; L-shaped parts remain) | Nesting handles rectangular/L-shaped fixtures, rotations, grain, kerf/trim, utilization and clear unplaced reasons | WB-005, layout |
| WB-023 | P1 | 3 | Proposed | Live nesting inputs retain typed values and focused field during recompute; undo followed by edit does not reapply stale settings | WB-005, settings |
| WB-024 | P1 | 5 | Proposed | Synthetic SKP import corpus, editing tool browser/native coverage, image and geometry regression fixtures in CI | WB-002, WB-008 |
| WB-025 | P2 | 8 | Proposed | Opt-in guarded CLI/MCP modeling with safe file roots, transactions, live-file conflict detection and grouped parts | WB-017, WB-021 |
| WB-026 | P2 | 8 | Proposed | Offcut inventory and reuse policy, glue-up strip/edge banding allowances, estimated purchasing and residual stock savings | WB-022, WB-005 |
| WB-027 | P2 | 5 | Proposed | Editable cabinet and frame-panel recipes: independent back thickness, rails, stiles, clearances and verified parts | WB-016, components |
| WB-028 | P2 | 8 | Proposed | Original joint/hardware workflow: dados/tenons/drilling with depth, offset, fit checks and matching reports | WB-027, geometry |
| WB-029 | P2 | 5 | Proposed | Printable ordered assembly instructions with stable part IDs, joint references and stale-step warnings | WB-021, WB-028, WB-004 |
| WB-030 | P2 | 8 | Proposed | Layout workspace and model-saved sheets: anchored scaled viewports, multi-page PDF/SVG/DXF and hidden lines | WB-004, WB-011 |
| WB-031 | P2 | 5 | Proposed | Printable section styling: per-tag line/hatch/cut-fill priorities, consistent PDF colors and overlaps | WB-020, WB-030 |
| WB-032 | P2 | 5 | Proposed | Fabrication exports with explicit units, part IDs, cut lines, optional drilling/centerlines and verified physical sizes | WB-011, WB-028 |
| WB-033 | P2 | 5 | Proposed | Benchmarks and performance budgets on high-part/component models; redraw, save, undo and nesting memory | WB-024, geometry |
| WB-034 | P3 | 5 | Proposed | Shortcut presets and conflict checks, trackpad/mouse/drag ergonomics, accessible measurements and 3D mouse evaluation | WB-009, platform UI |
| WB-035 | P3 | 5 | Proposed | SketchUp annotation/texture/material import fidelity, reversible errors and provenance-safe synthetic fixtures | WB-024, importer |
| WB-036 | P3 | 8 | Proposed | Optional curved and advanced geometry: chamfer/fillet/taper/subdivision with tolerance and undo regression | WB-007, geometry |
| WB-037 | P3 | 5 | Proposed | Locked tags, isolate-selection, oriented drawing planes and drag-to-reparent with stable transforms | WB-021, scenes |
| WB-038 | P2 | 5 | Proposed | Reliable fabrication section sheets: persistent section origin, hidden/internal line removal and validated cut caps | WB-020, WB-030 |

Priorities are reviewed at every sprint boundary. New requests should become measurable backlog entries before implementation. See [docs/AGILE.md](AGILE.md) for states and definition of done.
