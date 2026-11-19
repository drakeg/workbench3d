# Workbench3D — agent instructions

Read RELEASES.md, CONTRIBUTING.md, ROADMAP.md, docs/ARCHITECTURE.md, docs/AGILE.md, docs/BACKLOG.md, and docs/SPRINTS.md before making changes.

## Goals
Maintain a reliable, open-source 3D modeler for woodworking, fabrication, home and RV planning. Prefer working software and small, independently testable PRs over large unreviewable changes.

## Execution rules
1. Check current issues and PRs before selecting work. Use the planned sprint in docs/SPRINTS.md and the prioritized backlog in docs/BACKLOG.md; avoid duplicating ongoing tasks.
2. Work on a feature/*, fix/* or docs/* branch from main. One coherent change per PR. Link the backlog item and issue, and explain acceptance criteria.
3. Preserve compatibility with .wb3d files and existing add-ons. Geometry changes require regression tests. Verify undo/redo for edits.
4. Run npm ci, npm run typecheck, npm test, and npm run build. For UI changes also run the browser/platform smoke checks in CONTRIBUTING.md. Report unrun checks honestly.
5. Create reviewable PRs with verification results, risks, and screenshot evidence for UI work. Do not mark tasks Done before merge and review.
6. Update docs/BACKLOG.md and docs/SPRINTS.md as work progresses. Record blockers and carryovers; do not assume planned work is completed.

## Invariants
- All model lengths and coordinates are internally inches; Z is up.
- Keep src/core DOM-free; parsing and geometry should be testable in Node.
- Change document state through doc.transact(...) or app.live(...) for previews; ensure undo is consistent.
- Hold stable IDs rather than stale mesh references across document restores.
- Serialization changes need explicit versioning and migration.
- Consider native Mac, Tauri Windows/Linux, browser, keyboard and trackpad behavior.
- Respect existing add-on public API.

## Safety
Never commit credentials, user projects, generated installers, or proprietary assets. Do not force-push main, merge feature PRs without review approval, or trigger releases without authorization. Prefer supported secure dependencies; validate lockfiles and CI.

The Definition of Done and sprint workflow are in docs/AGILE.md. Release readiness, SemVer, and partial-release recovery are governed by RELEASES.md; never bump versions or trigger releases without maintainer approval.
