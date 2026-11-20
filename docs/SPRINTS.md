# Planned Workbench3D sprints

**Planning baseline:** November 18, 2026. These are *proposed* two-week iterations, not approved delivery promises; actual dates/capacity are confirmed at sprint planning. Track individual work in [BACKLOG.md](BACKLOG.md) and GitHub Issues/PRs. Never mark a sprint complete before verifying merged work.

| Sprint | Proposed window | Goal | Planned backlog IDs | Status |
|---|---|---|---|---|
| 01 — Reliability | Nov 19–Dec 2, 2026 | Harden measurements and file safety | WB-001, WB-008, WB-013, WB-014, WB-015 | Completed — PR #37 merged; Docker CI passed |
| 02 — Import/export | Dec 3–16, 2026 | Make external 3D models easier to exchange | WB-002, WB-003 | Early implementation — [PR #35](https://github.com/drakeg/workbench3d/pull/35) merged; [PR #36](https://github.com/drakeg/workbench3d/pull/36) in review |
| 03 — Shop output | Dec 17–30, 2026 | Produce useful drawings and material budgets | WB-004, WB-005 | Proposed |
| 04 — RV planning | Dec 31, 2026–Jan 13, 2027 | Speed RV interior layouts and editable parts | WB-006 | Proposed |
| 05 — Geometry tools | Jan 14–27, 2027 | Add path-based shaping for fabrication | WB-007, WB-010 | Proposed |
| 06 — Workflow and interoperability | Jan 28–Feb 10, 2027 | Expand CNC export and efficient editing | WB-011, WB-009 | Proposed |

## Sprint 01 — Reliability
**Objective:** prevent avoidable invalid dimensions and protect existing model files.
- WB-001 (2 pts): strict measurement parsing. **Accept:** malformed metric/imperial strings and fractions with zero denominators return null; negative mixed dimensions resolve correctly; focused automated tests. **Current:** Done — [PR #29](https://github.com/drakeg/workbench3d/pull/29) merged; CI passed.
- WB-008 (3 pts): document serialization round-trip and bad file feedback. **Accept:** fixtures load/save without unwanted data loss, parse failures show actionable UI error, regression tests pass. **Current:** Done — [PR #32](https://github.com/drakeg/workbench3d/pull/32) merged.
- WB-013 (2 pts): README badges and CI validation. **Accept:** only verified stack/workflow/deployment badges, dynamic GitHub metadata, documented maintenance rules and CI validation. **Current:** Done — [PR #34](https://github.com/drakeg/workbench3d/pull/34) merged; validator green.
- WB-014 (3 pts): LAN Docker Compose browser test. **Accept:** configurable host port, static app responds from a container, CI verifies health and index response. **Current:** Done — [PR #37](https://github.com/drakeg/workbench3d/pull/37) merged.
- WB-015 (2 pts): security policy, standards and SMB validation plan. **Accept:** no unverified claims; actionable reporting, pilot and release policies. **Current:** In Review.
**Exit:** tests/CI verified; regression cases documented; completed PR URLs recorded below.

## Sprint 02 — Import/export
- WB-002 (3 pts): STL import with unit strategy, unsupported-file feedback and representative fixtures. **Current:** Done — [PR #35](https://github.com/drakeg/workbench3d/pull/35) merged.
- WB-003 (3 pts): glTF/GLB export preserves group hierarchy/transforms/colors; exported sample opens in a standards-compliant viewer. **Current:** In Review — [PR #36](https://github.com/drakeg/workbench3d/pull/36); loader tests and CI passed.
**Exit:** independently verifiable import/export test assets and documented limitations.

## Sprint 03 — Shop output
- WB-004 (5 pts): printable orthographic shop drawings with dimensions and predictable scaling.
- WB-005 (3 pts): material price input, quantity and cost estimation with explicit units, regression tests.
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

## Sprint reporting (update at every close)
| Sprint | Delivered PRs | Tests/CI | Carryovers / blockers | Retro / next action |
|---|---|---|---|---|
| 01 | [PR #29](https://github.com/drakeg/workbench3d/pull/29), [PR #32](https://github.com/drakeg/workbench3d/pull/32), [PR #34](https://github.com/drakeg/workbench3d/pull/34) merged | Badge and Docker CI passed | No blockers | Verify container and prepare customer demo |
| 02 | [PR #35](https://github.com/drakeg/workbench3d/pull/35) merged; [PR #36](https://github.com/drakeg/workbench3d/pull/36) in review | Both PR CI passed individually | Final merge/retest pending | WB-016 reproducible cabinet demo next |
| 03–06 | None yet | Not run | Proposed | Confirm capacity before starting |

Use actual merged PR links and CI results here rather than guessed outcomes. Move unfinished work forward intentionally; urgent P0/P1 work may displace planned features.
