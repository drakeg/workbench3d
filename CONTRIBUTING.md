# Contributing to Workbench3D

Thanks for helping! Woodworkers, welders, RVers, home builders and programmers are all welcome, and you don't need to write code to contribute.

## Ways to help

- **Report a bug.** Open an issue with what you did, what you expected and what happened. Attach the `.wb3d` file if you can.
- **Suggest a feature.** Tell us about the project you were trying to build. Real use cases make the best features.
- **Write an add-on.** Lumber libraries, hardware (hinges, slides, fasteners), RV appliances, steel shapes, joinery helpers… see [docs/ADDONS.md](docs/ADDONS.md).
- **Improve the core.** Pick something from the [ROADMAP](ROADMAP.md) or an issue labelled `good first issue`.

## Sprint workflow and tracking

Before starting a task, consult [the planned sprints](docs/SPRINTS.md), [the backlog](docs/BACKLOG.md), and [the Agile process](docs/AGILE.md). Contributors using coding agents must also follow [AGENTS.md](AGENTS.md). Link the work item in the PR, and keep its status current through review and merge. A PR is not Done until reviewed, verified and merged.

## Development setup

```bash
npm install
npm run dev        # web app at http://localhost:5173 with hot reload
npm test           # unit tests (geometry, units, document)
npm run typecheck
npm run build
```

End-to-end test (drives the real UI in headless Chrome):

```bash
npm run build && npx vite preview --port 4173 &
CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" node scripts/smoke.mjs
```

Preview Mac or Windows conventions in any browser: `http://localhost:5173/?platform=mac` or `?platform=windows`, plus `&theme=dark`.

LAN browser test environment: `cp .env.example .env && docker compose up -d --build`. Open `http://<host-IP>:8087` from a trusted LAN machine, then `docker compose down`. Use `WB3D_BIND_ADDRESS=127.0.0.1` if LAN access is unnecessary. No user files are kept in a container database.

Desktop app: install [Rust](https://rustup.rs) and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/), then `npm run tauri dev`.

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) first; it's short.

## Pull requests

1. Fork, branch from `main` (`feature/dimension-tool`, `fix/pushpull-hole`).
2. Keep PRs focused, one feature or fix each.
3. Add or update tests. Geometry changes need a unit test in `tests/` (the signed-volume helper in `mesh.test.ts` is a great way to prove a solid is still closed).
4. `npm test && npm run typecheck && npm run build` must pass. CI runs them too.
5. Describe what changed and how you tested it. A screenshot or GIF helps for UI work.

## README badge standards

Maintain the verified badges beneath the README project title whenever dependencies, workflows, supported platforms, licensing or deployments change. Use Shields.io for technology and dynamic GitHub metadata, and official GitHub Actions status badges for actual workflows. Do not invent technology versions, passing checks, releases, Docker support or a license. Keep clickable badges in no more than three compact rows and preserve existing README prose. Run `node scripts/validate-badges.mjs` before submitting a PR; CI enforces the same check. Refer to [AGENTS.md](AGENTS.md) and the [central standards repository](https://github.com/drakeg/madmallard-repository-standards) as shared guidance becomes available.

## Code style

- TypeScript, strict mode. Prettier defaults (`.prettierrc`): 2 spaces, single quotes, 150 columns.
- `src/core` must not touch the DOM so it stays testable in Node.
- Change the model only inside `doc.transact(...)` (or `app.live(...)` for previews) so undo works.
- Menu labels are written in Title Case; `menuLabel()` turns them into sentence case on Windows. Show shortcuts with `kbd()`, never by hand.
- Lengths are inches internally. Convert only at the UI edge with `parseLength` / `formatLength`.
- Original work only. Don't copy code, icons, textures or models from proprietary software. If you port code from another open-source project, its license must be MIT-compatible and credited.

## Security and customer workflows

Read [SECURITY.md](SECURITY.md) before introducing import formats, add-ons or public exposure. Verify the SMB demo workflow and record real observations using [docs/COMMERCIALIZATION.md](docs/COMMERCIALIZATION.md); avoid invented customer validation. Standards updates should follow the opt-in [central adoption guide](https://github.com/drakeg/madmallard-repository-standards/blob/main/ADOPTION.md) without overwriting repository-specific rules.

## Releases

See [RELEASES.md](RELEASES.md) for the patch/minor/major decision rules, release readiness checklist, automated release flow, and failed-release recovery. A merge or sprint completion alone does not trigger a new version. Version bumps are reviewed PRs and must not bypass CI.

## License

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE).
