# Planned Workbench3D sprints

**Release candidates:** proposed every other Friday starting December 4, 2026; see [RELEASE_TRAIN.md](RELEASE_TRAIN.md). Candidate reviews do not guarantee published installers.

**Planning baseline:** November 18, 2026. These are *proposed* two-week iterations, not approved delivery promises; actual dates/capacity are confirmed at sprint planning. Track individual work in [BACKLOG.md](BACKLOG.md) and GitHub Issues/PRs. Never mark a sprint complete before verifying merged work.

| Sprint | Proposed window | Goal | Planned backlog IDs | Status |
|---|---|---|---|---|
| 01 — Reliability | Nov 19–Dec 2, 2026 | Harden measurements and file safety | WB-001, WB-008, WB-013, WB-014, WB-015 | Completed — PR #37 merged; Docker CI passed |
| 02 — Import/export | Dec 3–16, 2026 | Make external 3D models easier to exchange | WB-002, WB-003 | Delivered early — PRs #35 and #36 merged |
| 03 — Shop output | Dec 17–30, 2026 | Produce useful drawings and material budgets | WB-004, WB-005, WB-016 | Started early — WB-016 merged; WB-005 merged; WB-004 wireframe merged; detailed drawings pending |
| 04 — RV planning | Dec 31, 2026–Jan 13, 2027 | Speed RV interior layouts and editable parts | WB-006 | Proposed |
| 05 — Geometry tools | Jan 14–27, 2027 | Add path-based shaping for fabrication | WB-007, WB-010 | Proposed |
| 06 — Workflow and interoperability | Jan 28–Feb 10, 2027 | Expand CNC export and efficient editing | WB-011, WB-009 | Proposed |
| 07 — Peer-driven safety and correctness | Next ready hardening track (dates TBD) | Prevent data loss, wrong measurements, stale scenes and broken cutting plans | WB-017, WB-018, WB-019, WB-020, WB-022, WB-023 | Proposed — P1 acceptance in peer register |
| 08 — Parts and regression coverage | After 07, overlapping work permitted | Reliable instance quantities and reproducible workflows | WB-021, WB-024, WB-033 | Proposed |
| 09 — Material efficiency | After 08 | Reuse offcuts and produce realistic cabinet purchase estimates | WB-026, WB-027, WB-028 | Proposed |
| 10 — Fabrication documents | After 09 | Build instructions, layout sheets, section styles and manufacturing exports | WB-029, WB-030, WB-031, WB-032, WB-038 | Proposed |
| 11 — Automation and interchange | After 10 | Safe agent interfaces and richer imported file fidelity | WB-025, WB-035 | Proposed |
| 12 — Advanced editor and geometry | After 11 | Ergonomics, editing flexibility and optional advanced modeling | WB-034, WB-036, WB-037 | Proposed |

## Sprint 01 — Reliability
**Objective:** prevent avoidable invalid dimensions and protect existing model files.
- WB-001 (2 pts): strict measurement parsing. **Accept:** malformed metric/imperial strings and fractions with zero denominators return null; negative mixed dimensions resolve correctly; focused automated tests. **Current:** Done — [PR #29](https://github.com/drakeg/workbench3d/pull/29) merged; CI passed.
- WB-008 (3 pts): document serialization round-trip and bad file feedback. **Accept:** fixtures load/save without unwanted data loss, parse failures show actionable UI error, regression tests pass. **Current:** Done — [PR #32](https://github.com/drakeg/workbench3d/pull/32) merged.
- WB-013 (2 pts): README badges and CI validation. **Accept:** only verified stack/workflow/deployment badges, dynamic GitHub metadata, documented maintenance rules and CI validation. **Current:** Done — [PR #34](https://github.com/drakeg/workbench3d/pull/34) merged; validator green.
- WB-014 (3 pts): LAN Docker Compose browser test. **Accept:** configurable host port, static app responds from a container, CI verifies health and index response. **Current:** Done — [PR #37](https://github.com/drakeg/workbench3d/pull/37) merged.
- WB-015 (2 pts): security policy, standards and SMB validation plan. **Accept:** no unverified claims; actionable reporting, pilot and release policies. **Current:** Done — [PR #37](https://github.com/drakeg/workbench3d/pull/37) merged.
**Exit:** tests/CI verified; regression cases documented; completed PR URLs recorded below.

## Sprint 02 — Import/export
- WB-002 (3 pts): STL import with unit strategy, unsupported-file feedback and representative fixtures. **Current:** Done — [PR #35](https://github.com/drakeg/workbench3d/pull/35) merged.
- WB-003 (3 pts): glTF/GLB export preserves group hierarchy/transforms/colors; exported sample opens in a standards-compliant viewer. **Current:** Done — [PR #36](https://github.com/drakeg/workbench3d/pull/36) merged; loader tests and CI passed.
**Exit:** independently verifiable import/export test assets and documented limitations.

## Sprint 03 — Shop output
- WB-016 (3 pts): generate a six-panel sample cabinet for the cut-list/shop workflow. **Current:** Done — [PR #38](https://github.com/drakeg/workbench3d/pull/38) merged; browser smoke verifies six parts, cut-list rows, and sheet layout. Customer validation remains pending.
- WB-004 (5 pts): printable orthographic shop drawings with dimensions and predictable scaling. **Current:** First increment merged — [PR #41](https://github.com/drakeg/workbench3d/pull/41), wireframe PDF and hidden-tag tests passed; detailed fabrication sheets remain future work.
- WB-005 (3 pts): material price input, quantity and cost estimation with explicit units, regression tests. **Current:** Done — [PR #40](https://github.com/drakeg/workbench3d/pull/40) merged; browser pricing and quote-stock regression tests passed.
**Exit:** sample cabinet can yield clear drawings and a reproducible material estimate. Split WB-004 if needed.

## Sprint 04 — RV planning
- WB-006 (5 pts): configurable interior footprint and appliance blocks via reusable, editable shapes.
**Exit:** sample RV layout loads/saves/reopens, dimensions remain editable, and the workflow is documented.

## Sprint 05 — Geometry tools
- WB-007 (5 pts): minimal Follow Me sweep over a defined path, with geometry and undo tests.
- WB-010 (3 pts): 3-point arc tool with typed dimensions and keyboard handling.
**Exit:** demonstrated use cases produce stable geometry, correct saving and undo.

## Sprint 06 — Workflow and interoperability
- WB-011 (5 pts): export scalable DXF/SVG profiles with verified units.
- WB-009 (3 pts): customize shortcuts, prevent collisions, persist correctly across platforms.
**Exit:** interoperability fixtures validate sizes and shortcut settings survive restart.

## Sprint 07 — Peer-driven safety and correctness (next ready reliability track)
**Goal:** preserve existing user files and improve the reliability of the first saleable cabinet workflow. Start from the next ready P1 story after any broken CI/urgent defect; do not delay normal development for customer surveys.
- **WB-017:** future-version .wb3d and unknown-field fixtures refuse destructive saves, autosave recovery is idempotent, and save/close dialogs offer Save, Don't Save or Cancel. **Current:** In Review (first increment): web and Mac guards, web Save/Don't Save/Cancel, autosave cleanup, regression tests; broader desktop close/recovery validation remains. Acceptance: no silent loss on open/save and no continuation after a failed/cancelled save.
- **WB-018:** dimension endpoints reference identifiable geometry and follow Move/Scale; missing anchors are flagged rather than displaying silently stale measurements. Acceptance: editor undo, save/reopen and cross-platform fixtures.
- **WB-019:** normalized inch/mm/fraction conversions; matching cut list, PDF and CSV quantities to stated precision. CSV generator extraction and fraction/metric export fixtures proposed in the current PR; native parity remains to verify. Acceptance: golden 1/8 in, 3/16 in, end-to-end export fixtures. **Current:** In Review — [PR #49](https://github.com/drakeg/workbench3d/pull/49): nonfinite and incomplete coordinate rejection plus correct web/native Mac decimal half-step rounding, tests for exact fractional conversions. Full cut-list/PDF/CSV output parity remains pending.
- **WB-020:** nested section/tag visibility and scale selection state are consistent on hide, delete, undo, scene switching and print. Acceptance: model/printed views and section origins preserve actual state.
- **WB-022:** cutting-layout synthetic adversarial fixtures, grain/rotation/kerf/trim and unplaced explanations. **Increment:** enforce finite positive stock/part measurements, sane integer quantities and non-negative kerf/trim before placement; adversarial rectangles, grain, kerf, placement accounting and utilization fixtures merged in PR #55; actionable explanations for trim, grain, width and length merged in PR #56; L-shaped parts remain. Acceptance: positive/negative fit tests and cost/yield reconciliation.
- **WB-023:** typed nesting parameters are stable across asynchronous updates and immediate Undo/Redo. Acceptance: pointer+keyboard browser smoke and targeted state tests.
**Exit:** six P1 stories merged separately with native/browser tests where applicable; no false production-readiness claims.

## Sprint 08 — Components, importer and performance
- **WB-021:** component-aware cabinet/agent-created parts; grouped quantities, drag-to-reparent and undo tests.
- **WB-024:** first-party SKP synthetic fixtures, full tool keyboard/pointer smoke and visual/model snapshots.
- **WB-033:** benchmark 50/300/1000 parts, verify budget trend and record platform constraints.
**Exit:** component instances and cut list agree; import and edit regressions fail CI; benchmarks publish baselines.

## Sprint 09 — Stock reuse and cabinet joinery
- **WB-026:** persisted offcuts, offcut-first nesting, savings report, edge banding and strip allowances.
- **WB-027:** editable back-panel thickness and door frame recipes that produce valid cut-list parts.
- **WB-028:** dimensional dados/mortise-and-tenon, reference edges, depth/fit and hardware/drilling data.
**Exit:** configurable sample cabinet generates honest quantities, savings and manufacturability notes.

## Sprint 10 — Plans and fabrication output
- **WB-029:** numbered, printable subassembly instructions tied to stable part IDs and model revisions.
- **WB-030:** model-persisted pages, controlled paper size/scale, vector PDF/SVG/DXF with hidden lines.
- **WB-031:** consistent section line style, hatch, cut priorities and printed color.
- **WB-032:** CNC-friendly dimension/centerline/drilling metadata and exact-units exports.
- **WB-038:** correctly originated section views, validated cut caps and no spurious internal lines.
**Exit:** a user can reproduce the cabinet on paper with traceable part identifiers; distinguish informative plans from certified fabrication drawings.

## Sprint 11 — Controlled automation and file fidelity
- **WB-025:** opt-in CLI/MCP with path-root restrictions, transactional edits, live-document conflict checks, and instance-aware operations.
- **WB-035:** SketchUp text/dimension/texture/material fidelity with synthetic multi-era fixtures and clear unsupported-record warnings.
**Exit:** no unauthorized file writes, overwrites or unverified importer claims.

## Sprint 12 — Editing ergonomics and advanced tools
- **WB-034:** shortcut collision handling and presets, Mac gestures/control-click, drag interactions and 3D mouse feasibility.
- **WB-036:** measured advanced geometry (fillet/chamfer/taper/subdivide) with topology and undo fixtures.
- **WB-037:** locked layers, isolated selection, off-axis drawing planes, Outliner reparenting with transform preservation.
**Exit:** newly delivered capabilities pass repeatable real user interaction tests.

**External reference policy:** [PEER_ISSUE_RESEARCH.md](PEER_ISSUE_RESEARCH.md) documents issues from Sawhorse, SketchCraft, IngeTrazo, WoodSketch, OpenCutList and FreeCAD. BenchUp is compared using its published user-facing functionality only; its GitHub issue tracker was unavailable. These are independently authored requirements. Do not copy peer code, assets, designs or files. A source issue being closed does not make a Workbench3D story complete. Scope can be re-ordered to address urgent user issues without freezing sprint progress.

## Sprint reporting (update at every close)
| Sprint | Delivered PRs | Tests/CI | Carryovers / blockers | Retro / next action |
|---|---|---|---|---|
| 01 | [PR #29](https://github.com/drakeg/workbench3d/pull/29), [PR #32](https://github.com/drakeg/workbench3d/pull/32), [PR #34](https://github.com/drakeg/workbench3d/pull/34) merged | Badge and Docker CI passed | No blockers | Verify container and prepare customer demo |
| 02 | PRs #35 and #36 merged | CI passed | None | Continue fabrication features |
| 03 | [PR #38](https://github.com/drakeg/workbench3d/pull/38), [PR #40](https://github.com/drakeg/workbench3d/pull/40), [PR #41](https://github.com/drakeg/workbench3d/pull/41) merged | CI verified for each PR | Detailed fabrication views unfinished | Validate pilot cabinet drawing workflow |\n| 04–06 | None yet | Not run | Proposed | Confirm capacity before starting |

Use actual merged PR links and CI results here rather than guessed outcomes. Move unfinished work forward intentionally; urgent P0/P1 work may displace planned features.

## Native Mac tool follow-through
- WB-MAC-03: Polygon and Scale merged in [PR #42](https://github.com/drakeg/workbench3d/pull/42). Native Dimension placement and persistent measurement labels merged in [PR #44](https://github.com/drakeg/workbench3d/pull/44). Section-plane placement/clipping/toggle merged in [PR #45](https://github.com/drakeg/workbench3d/pull/45) with green Mac and web CI; native SketchUp import remains pending. Acceptance: visual labels, undo, and `.wb3d` round-trip verified in macOS CI.

## Native Mac Section milestone
- WB-MAC-03 Section increment: place a cut on a face, set exact depth, clip visible geometry, toggle the cut, save/reopen and undo without changing the model mesh. **Done:** [PR #45](https://github.com/drakeg/workbench3d/pull/45) merged; native self-tests and application CI passed. No version bump triggered.
