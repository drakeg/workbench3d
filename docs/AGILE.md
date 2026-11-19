# Agile process

Workbench3D uses a lightweight **two-week sprint** cadence. Planned sprints are recorded in [SPRINTS.md](SPRINTS.md), actionable product work in [BACKLOG.md](BACKLOG.md), and the long-term direction in [ROADMAP.md](../ROADMAP.md). GitHub Issues and PRs provide discussion, execution and review links.

## Roles
The maintainer prioritizes and accepts work; contributors or coding agents implement and test; reviewers assess scope, compatibility, evidence, and CI. No one should assume an approval or successful check.

## States
**Proposed → Ready → In Progress → In Review → Done**. A blocked item records the blocker and stays out of Done. "Ready" requires user outcome, acceptance criteria, priority, estimate, dependencies, and test approach. An opened PR is *In Review*, not *Done*.

## Planning and tracking
At the beginning of each two-week sprint, agree a clear goal and pull only achievable Ready items from the backlog. Add scope and acceptance criteria to the sprint entry. Use an issue for each actionable item; when supported, label with type (bug/feature/docs/chore), priority (P0–P3), and sprint milestone. When no GitHub Project or milestone exists, the Markdown tables remain the source of truth; don't claim GitHub metadata was configured.

Relative estimates: **1** trivial, **2** small, **3** moderate, **5** significant, **8** split into smaller work. Priorities: **P0** security/data loss; **P1** blocked critical workflow; **P2** valuable feature or quality; **P3** polish/discovery. Bugs and file compatibility generally take priority over new tools.

## Delivery
1. Pick an issue/backlog ID and link its sprint.
2. Create a focused branch and PR with acceptance criteria, implementation notes, test results, screenshots for UI work, risk, and migration implications.
3. Run `npm run typecheck`, `npm test`, `npm run build`, and appropriate smoke tests; make sure CI finishes. Report unavailable checks instead of implying success.
4. After review and merge, update status, PR URL, and the sprint completion notes.
5. At sprint end, record what shipped, what carried over, blockers, and one retrospective improvement. No invented dates or metrics.

## Definition of Done
Acceptance criteria verified, regressions covered, backwards compatibility reviewed, documentation updated, CI passing (or an explicit exception recorded), approved and merged, with tracking updated. A feature PR being opened is not enough.

## Issue template
Problem and user outcome; scope/exclusions; acceptance criteria; test plan; priority/estimate; dependencies; sprint/status; linked PR.
