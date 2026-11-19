# Release policy

Workbench3D follows [Semantic Versioning](https://semver.org/) with additional pre-1.0 compatibility rules. This document is the source of truth for deciding **whether and when** to ship a release. See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution requirements and [docs/SPRINTS.md](docs/SPRINTS.md) for planned delivery.

## When a release happens

A merged feature, completed sprint, or documentation change **does not automatically require a release**.

The existing `.github/workflows/release.yml` workflow runs on each push to `main` (and can be started manually). It checks the `version` in `package.json` against the remote Git tag `v<version>`. If that tag already exists, there is nothing new to build. If the tag does not exist, the workflow attempts desktop builds for Windows and Linux (Tauri) and native Apple-silicon macOS; it publishes the draft GitHub Release only after those jobs succeed. A workflow failure does **not** constitute a shipped release: inspect the tag, draft release, and assets before retrying. A manually dispatched run with no version bump is not a new release if the tag already exists.

**Recommended cadence:** release at a meaningful, tested capability milestone (often after one or more sprint increments), not simply because the sprint ended. Issue patch releases promptly for important defects, security corrections, or user-data problems. Major milestones must be deliberately approved. Do not ship merely to catch up with a calendar.

## Which version bump?

| Change | Example | Use when |
|---|---|---|
| Patch (`Z`) | `0.4.0 → 0.4.1` | Backwards-compatible bug/security fixes, robustness, compatible small enhancements |
| Minor (`Y`) | `0.4.0 → 0.5.0` | Meaningful new tools, import/export formats, or workflows with compatible behavior |
| Major (`X`) | `1.2.3 → 2.0.0` | Deliberate breaking changes to the published compatibility contract |

**Before 1.0:** while versioned `0.Y.Z`, treat `0.Y` as the supported feature/compatibility line and `0.Y.Z` as compatible fixes. A breaking change to existing `.wb3d` documents, add-ons, commands, or behavior requires explicit review, migration/communication, and at least a new `0.(Y+1).0`; it must **not** slip into a patch. A minor bump is not permission to break user projects. Prefer preserving compatibility. Do not automatically jump to `1.0.0` for a breaking change; reserve `1.0.0` for an approved stability milestone.

**After 1.0:** increment major for incompatible published behavior or file/API contracts; minor for backward-compatible features; patch for backward-compatible corrections. Reset lower components when incrementing a higher component (`1.4.9 → 1.5.0`, `1.4.9 → 2.0.0`).

Changes to internal APIs without user-facing compatibility impact can normally be patched, but changes affecting saved model files, imported exports, the public add-on API, existing shortcuts, or native platform compatibility need explicit assessment. Documentation-only changes typically require no version bump.

## Compatibility promises and 1.0 criteria

- Existing `.wb3d` documents must continue loading without unintended data loss; format changes require versioned migration and round-trip tests.
- Add-ons using the documented public API should continue working, or receive migration instructions in a planned breaking release.
- Maintain expected modeling results, dimensions (inches internally), undo/redo, and cross-platform support.
- Do not advertise a native installer as supported unless it builds and passes the relevant checks.

**Candidate 1.0 exit criteria:** reliable core push/pull and components; documented/stable `.wb3d` and add-on contracts; successful save/open and import/export regression fixtures; repeatable Windows, Linux, and native macOS installers; passing CI and smoke tests; migration/backup and recovery instructions; publicly documented limitations. Final sign-off belongs to the maintainer.

## Release procedure

1. **Select scope:** review merged PRs, urgent fixes, open regressions, backlog, and sprint exit criteria. Choose patch/minor/major according to the rules above. Decide explicitly whether to release now; document the reason.
2. **Validate:** require green `npm ci`, `npm run typecheck`, `npm test`, `npm run build`, browser/platform smoke checks, plus any fixture/manual checks the change needs. For modeling, exercise creation, edit, undo/redo, save/reopen, dimensions, and export; for native builds check packaging and launch. Document unsupported/unrun platform tests.
3. **Prepare release notes:** summarize features, fixes, behavior changes, relevant issues/PRs, compatibility, known limitations, and upgrade/backup instructions. Check any documented minimum OS requirements.
4. **Bump version in a focused PR:** from the previous release version, use `npm run release:patch` or `npm run release:minor`; for major use `npm version major --no-git-tag-version`. These invoke `scripts/sync-version.mjs` to synchronize `package.json`, the npm lockfile, and the Tauri Cargo manifest/lock. The native Mac build reads the package version. Verify with `node scripts/sync-version.mjs --check`; review the diff and CI.
5. **Approve and merge** that PR to `main`. Do **not** create a `v*` tag manually; do not bump versions simply to trigger a rerun.
6. **Observe the Release desktop app workflow** and inspect build logs. The workflow creates or updates a draft release and publishes it after Windows/Linux and native Mac succeed. Confirm `v<version>`, the release notes, and the actual downloadable assets at [GitHub Releases](https://github.com/drakeg/workbench3d/releases). A green unrelated CI workflow does not prove installers were published.
7. **Post-release:** link the release to its sprint/backlog entries, record regressions and follow-up work, and make patch follow-ups as needed.

## Failure and rollback procedure

If CI or a platform build fails: fix the branch/workflow, investigate incomplete draft/tag state, and rerun only once the root cause is resolved. Because the workflow's build jobs can create the tag and draft **before** all platforms finish, an existing tag alone is not proof of a complete public release. The current workflow skips a tagged version on later runs; recovery of a partial release may require a deliberate maintainer action and workflow repair. Never delete/rewrite a published tag, force-release, or silently republish different binaries under the same version without explicit approval.

If a release is defective after publication, record the known issue, provide workarounds and a tested corrective patch version. If rollback is necessary, follow the platform-specific recovery plan and preserve affected user files; do not assume downgrading `.wb3d` documents is safe.

## Release notes template

```md
# Workbench3D vX.Y.Z
Released: YYYY-MM-DD

## Highlights
## Fixes
## Compatibility / migrations
## Installation and platform support
## Known issues
## Verification (CI and platform checks)
## Links to merged PRs / issues
```

The [release workflow](.github/workflows/release.yml) currently uses a generic installer list as the release body; add curated notes before publishing if richer notes are needed. This policy does not claim the workflow already generates that changelog automatically.
