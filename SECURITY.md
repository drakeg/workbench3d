# Security policy

Workbench3D is an open-source 3D modeling application. Protect users' project files, imported models and add-on execution.

## Reporting a vulnerability

Do **not** post exploits, credentials, personal information, or sensitive project files in public GitHub issues. Use GitHub's private vulnerability reporting for [this repository](https://github.com/drakeg/workbench3d/security/advisories/new) if enabled. Otherwise contact the maintainer privately through an agreed channel; do not disclose sensitive details publicly until a safe process is established.

Include affected versions, impact, prerequisites, minimal reproduction, and possible mitigation. Do not upload real customer files without authorization.

## Supported versions

Before the first stable release, security fixes target the current `main` branch; previously published `0.x` builds are not guaranteed extended maintenance. Supported release lines will be stated here after `1.0`.

## Security requirements

- Treat imported SketchUp, STL and `.wb3d` files as untrusted; reject malformed/oversized input and preserve user files on failure.
- Add-ons are user-provided executable JavaScript. Load only trusted add-ons; do not present them as sandboxed.
- Never commit secrets or credentials. GitHub Actions running untrusted PR code should use minimal permissions and no deployment credentials.
- The Docker Compose setup is an **optional, unauthenticated browser-app test environment**; its default bind makes it reachable on the local network. Do not expose port 8087 directly to the internet; restrict access using host firewall and trusted networks.
- Review dependency updates, release build provenance and any new network or external upload behavior before merging.

See [RELEASES.md](RELEASES.md) for security patch releases and regression validation.
