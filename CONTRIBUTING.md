# Contributing to Workbench3D

Thanks for helping! Woodworkers, welders, RVers, home builders and programmers are all welcome, and you don't need to write code to contribute.

## Ways to help

- **Report a bug.** Open an issue with what you did, what you expected and what happened. Attach the `.wb3d` file if you can.
- **Suggest a feature.** Tell us about the project you were trying to build. Real use cases make the best features.
- **Write an add-on.** Lumber libraries, hardware (hinges, slides, fasteners), RV appliances, steel shapes, joinery helpers… see [docs/ADDONS.md](docs/ADDONS.md).
- **Improve the core.** Pick something from the [ROADMAP](ROADMAP.md) or an issue labelled `good first issue`.

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

Desktop app: install [Rust](https://rustup.rs) and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/), then `npm run tauri dev`.

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) first; it's short.

## Pull requests

1. Fork, branch from `main` (`feature/dimension-tool`, `fix/pushpull-hole`).
2. Keep PRs focused, one feature or fix each.
3. Add or update tests. Geometry changes need a unit test in `tests/` (the signed-volume helper in `mesh.test.ts` is a great way to prove a solid is still closed).
4. `npm test && npm run typecheck && npm run build` must pass. CI runs them too.
5. Describe what changed and how you tested it. A screenshot or GIF helps for UI work.

## Code style

- TypeScript, strict mode. Prettier defaults (`.prettierrc`): 2 spaces, single quotes, 150 columns.
- `src/core` must not touch the DOM so it stays testable in Node.
- Change the model only inside `doc.transact(...)` (or `app.live(...)` for previews) so undo works.
- Lengths are inches internally. Convert only at the UI edge with `parseLength` / `formatLength`.
- Original work only. Don't copy code, icons, textures or models from proprietary software. If you port code from another open-source project, its license must be MIT-compatible and credited.

## Releases

Releases are automatic. When `main` has a `version` in `package.json` that hasn't been released yet, the **Release desktop app** workflow builds the macOS, Windows and Linux installers, tags `v<version>` and publishes the release once every build succeeds.

To ship a release, bump the version in a PR (`npm run release:patch` or `npm run release:minor`) and merge it. The desktop app reads its version from `package.json`, so that's the only number to change.

## License

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE).
