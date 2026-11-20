# Workbench3D — agent instructions

Read SECURITY.md, docs/COMMERCIALIZATION.md, RELEASES.md, CONTRIBUTING.md, ROADMAP.md, docs/ARCHITECTURE.md, docs/AGILE.md, docs/BACKLOG.md, and docs/SPRINTS.md before making changes.

## Goals
Maintain a reliable, open-source 3D modeler for woodworking, fabrication, home and RV planning. Prefer working software and small, independently testable PRs over large unreviewable changes.

## Execution rules
1. Check current issues and PRs before selecting work. Use the planned sprint in docs/SPRINTS.md and the prioritized backlog in docs/BACKLOG.md; avoid duplicating ongoing tasks.
2. Work on a feature/*, fix/* or docs/* branch from main. One coherent change per PR. Link the backlog item and issue, and explain acceptance criteria.
3. Preserve compatibility with .wb3d files and existing add-ons. Geometry changes require regression tests. Verify undo/redo for edits.
4. Run npm ci, npm run typecheck, npm test, and npm run build. For UI changes also run the browser/platform smoke checks in CONTRIBUTING.md. Report unrun checks honestly.
5. Create reviewable PRs with verification results, risks, and screenshot evidence for UI work. Do not mark tasks Done before merge and review.
6. Update docs/BACKLOG.md and docs/SPRINTS.md as work progresses. Record blockers and carryovers; do not assume planned work is completed.

## Autonomous delivery and business validation

Use **Build → Deploy → Test → Fix → Redeploy → Continue** for each authorized development session. Prioritize P0/P1 defects, broken CI and customer-facing workflows before polish; advance to the next Ready backlog item when safe. Maintain a browser build, Docker Compose LAN test configuration, and GitHub Pages deployment workflow. Do not claim local deployment without actually starting and accessing it; test the container image in CI. Production changes, costs, destructive operations, and release bumps still require applicable authorization/review.

The first SMB hypothesis is small cabinetry/woodworking shops. See [commercialization plan](docs/COMMERCIALIZATION.md); test cut-list, sheet layout and model save/reopen as the first sellable workflow. No invented demand, customers, revenue or price validation.

Adopt [central repository standards](https://github.com/drakeg/madmallard-repository-standards) selectively and at a reviewed version, preserving this app's original source and policies. Keep [SECURITY.md](SECURITY.md), README badges, release guidance, CONTRIBUTING and sprint/backlog documents synchronized with ordinary PRs. Do not copy unreviewed templates or use mutable remote CI scripts with write permissions.

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

## Repository README badges

Follow the [Mad Mallard repository standards](https://github.com/drakeg/madmallard-repository-standards) when its shared rules become available; meanwhile use the explicit requirements in this file. Keep the compact `<!-- badges:start -->` to `<!-- badges:end -->` block immediately under the README title. Inspect manifests, lockfiles, workflows, deployment configuration, and license before changing badges. Only claim verified technologies and versions. Use dynamic GitHub Actions badges for existing workflows and dynamic Shields.io badges for releases, license, issues, and PRs. Never hardcode passing security or build status. Link badges to their actual project documentation or workflows; omit unsupported Docker, cloud, database, or security claims. When technology or workflows change, update the badge block and `scripts/validate-badges.mjs` together. Run `node scripts/validate-badges.mjs` and preserve the rest of README. Include badge maintenance in the related development PR rather than standalone PRs when appropriate.
