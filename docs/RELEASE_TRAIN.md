# Release train and tester guide

The project is pre-1.0. **Latest verified public installers:** [v0.4.0](https://github.com/drakeg/workbench3d/releases/tag/v0.4.0), published November 16, 2026. A successful `Release desktop app` workflow on a normal `main` push may simply verify that the already-published package version exists; it does **not** publish new binaries without a version bump.

## Proposed predictable release train

- **Sprint planning:** two-week cadence described in [AGILE.md](AGILE.md) and [SPRINTS.md](SPRINTS.md). The sprint board and backlog are continuously updated; a sprint ending does not equal an installer release.
- **Release candidate review:** every other Friday, starting **December 4, 2026** (next proposed reviews December 18 and January 1). This is a target review cadence, **not** a promise of a shipped release or a scheduled automatic release.
- **Stable release:** publish an approved, validated candidate after blocking issues are resolved and installers are actually uploaded. When scope is incomplete, defer that feature or the candidate; document the reason and revised date instead of inventing a completed release.
- **Urgent fixes:** prepare a compatible patch candidate out of cycle for security, user-data loss, file corruption, serious regressions, or blocked installs.
- **Pre-release builds:** Windows/Linux and Apple silicon are built in GitHub Actions. A green CI or desktop workflow is not proof that fresh installers were published; use the published [Releases](https://github.com/drakeg/workbench3d/releases) listing as proof.

## Next candidate: proposed v0.5.0

**Target candidate review:** December 4, 2026. **State:** proposed/unreleased; version bump not yet submitted. Scope is limited to already-merged, compatible improvements since v0.4.0 plus any critical release fixes. Avoid promising completion of all Sprint 07/08 stories as a prerequisite.

Release gate:
1. Confirm latest intended PRs merged and identify release commit/notes, changes affecting `.wb3d` compatibility, and known limitations.
2. Verify `npm ci`, `npm run typecheck`, `npm test`, `npm run build`, browser smoke, Docker smoke, native Mac self-tests, and cross-platform installer jobs. Perform a real user workflow test where feasible; record any manual/platform test not performed.
3. With maintainer-approved scope/version, prepare a **focused version-bump PR**, including `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, and `src-tauri/Cargo.lock`; verify `node scripts/sync-version.mjs --check`.
4. Merge only after checks/review. `.github/workflows/release.yml` prepares a draft, builds, validates all expected installers and publishes. Confirm that the new version appears publicly with downloadable assets.
5. Link the release in [SPRINTS.md](SPRINTS.md) and update this document's history and next candidate. If blocked, record the failed check, owner/next action, and whether candidate review slipped.

## Install and smoke-test the current published version

- **Apple silicon Mac (macOS 26+):** [v0.4.0 native DMG](https://github.com/drakeg/workbench3d/releases/download/v0.4.0/Workbench3D_0.4.0_mac.dmg). The native app is **not notarized**; follow [README](../README.md) instructions for first launch. Some browser/Tauri features have not reached the native Mac app yet.
- **Windows x64:** [v0.4.0 setup EXE](https://github.com/drakeg/workbench3d/releases/download/v0.4.0/Workbench3D_0.4.0_x64-setup.exe) (MSI also available).
- **Linux x86-64:** AppImage, DEB and RPM from [v0.4.0 assets](https://github.com/drakeg/workbench3d/releases/tag/v0.4.0).
- **Latest browser build:** [GitHub Pages](https://drakeg.github.io/workbench3d/). It usually follows `main` more closely than published installers; verify the Pages action is green before relying on it.
- **LAN browser test:** use Docker Compose as shown in [README](../README.md). It serves an unauthenticated application: limit to a trusted LAN.

Smoke test: create/open a sample cabinet, edit a panel, undo/redo, save a `.wb3d`, reopen it, check cut-list quantities and printed/exported measurements. Preserve a backup of any important project before trying pre-release builds. Report OS/architecture, app version, reproduction steps, expected/actual behavior and attach a **synthetic** fixture if possible.

## Release register

| Version | Status | Published date | Evidence / next action |
|---|---|---|---|
| v0.3.0 | Published | November 9, 2026 | [GitHub Release](https://github.com/drakeg/workbench3d/releases/tag/v0.3.0) |
| v0.4.0 | Published | November 16, 2026 | [GitHub Release and installers](https://github.com/drakeg/workbench3d/releases/tag/v0.4.0) |
| v0.5.0 | Proposed candidate; **not released** | — | Review scope and quality gates on December 4, 2026; request version-bump approval before triggering release |

This schedule supplements [RELEASES.md](../RELEASES.md), which remains authoritative for SemVer, release approval, draft recovery, rollback, and publication.
