# Workbench3D prioritized backlog

This is the actionable companion to [ROADMAP.md](../ROADMAP.md) and [SPRINTS.md](SPRINTS.md). Estimates and ordering are initial proposals, not promises. Create/link GitHub Issues as implementation begins.

| ID | Priority | Points | Status | User outcome / acceptance | Dependency |
|---|---|---:|---|---|---|
| WB-001 | P1 | 2 | Done (PR #29) | Reject malformed measurements and zero denominators; signed feet/inches parse correctly and have regression tests | None |
| WB-002 | P2 | 3 | In Review (PR #35) | Import STL mesh into a new model/group with predictable units, useful errors and fixtures | Import architecture investigation |
| WB-003 | P2 | 3 | In Review (PR #36) | Export glTF/GLB with preserved group transforms and colors and loadable fixture | Mesh export coverage |
| WB-004 | P2 | 5 | Proposed | Offer printable orthographic shop drawing with dimensions and correct page scale | Dimension and PDF modules |
| WB-005 | P2 | 3 | Proposed | Cut-list estimate accepts stock prices and displays calculated cost totals | Cut-list layout |
| WB-006 | P2 | 5 | Proposed | RV floor plan starter templates plus commonly used appliance shapes and editable dimensions | Add-on API |
| WB-007 | P2 | 5 | Proposed | Follow Me sweep can construct a simple profile along a path; test closed solids and undo | Geometry engine |
| WB-008 | P2 | 3 | Done (PR #32) | Save/open round-trip tests and import failure reporting protect user files | Serialization fixtures |
| WB-009 | P3 | 3 | Proposed | Adjustable shortcuts persisted by platform, with collision detection | Settings UI |
| WB-010 | P3 | 3 | Proposed | 3-point arc tool with exact measurements and undo | Draw tool framework |
| WB-011 | P2 | 5 | Proposed | DXF/SVG vector export suitable for CNC/laser, with unit and scale checks | Geometry export |
| WB-013 | P2 | 2 | Done (PR #34) | Verify README technology/workflow/release/community badges, link sources, document conventions, and check them in CI | Root README; CI |
| WB-012 | P3 | 2 | Proposed | Desktop signing/notarization plan and reproducible release validation | Signing credentials and maintainer approval |

Priorities are reviewed at every sprint boundary. New requests should become measurable backlog entries before implementation. See [docs/AGILE.md](AGILE.md) for states and definition of done.
