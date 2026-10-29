# 🔍 Action Inspector

[![CI](https://github.com/LuanErasmus/gh-action-inspector/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/LuanErasmus/gh-action-inspector/actions/workflows/ci.yml)
[![Release](https://github.com/LuanErasmus/gh-action-inspector/actions/workflows/release.yml/badge.svg)](https://github.com/LuanErasmus/gh-action-inspector/actions/workflows/release.yml)
[![Latest release](https://img.shields.io/github/v/release/LuanErasmus/gh-action-inspector?sort=semver)](https://github.com/LuanErasmus/gh-action-inspector/releases/latest)
[![License: MIT](https://img.shields.io/github/license/LuanErasmus/gh-action-inspector)](LICENSE)

**Know what you're running before you add `uses:`.**

Action Inspector is a [GitHub CLI](https://cli.github.com/) extension for
inspecting Actions before adopting or upgrading them. Resolve a version or SHA,
scan workflow dependencies, compare Action interfaces, and preview full-SHA pins
from your terminal.

Dependabot proposes dependency updates; Action Inspector helps you understand
and review them on demand. It queries GitHub's API and is not an offline tool.

> [!IMPORTANT]
> **Action Inspector does not retrieve or reveal GitHub Actions secret values.**
> It inspects workflow files and Action metadata; it does not execute workflows
> or resolve expressions such as `${{ secrets.MY_SECRET }}` to their values.
> It uses your GitHub CLI credentials or configured token to authenticate API
> requests, but does not print those credentials in its reports.
> This is not a secret scanner or redaction tool: do not hardcode secrets in
> workflow files or Action metadata, as source content can appear in reports
> and preview diffs.

## Installation

With GitHub CLI installed:

```bash
gh extension install LuanErasmus/gh-action-inspector
```

No Node.js installation is required. Each
[release](https://github.com/LuanErasmus/gh-action-inspector/releases) includes
standalone executables for Windows, macOS, and Linux (x64 and arm64).

Action Inspector automatically uses your existing `gh auth login` credentials.
See [authentication and troubleshooting](docs/troubleshooting.md#authentication)
if you encounter access or rate-limit errors.

```bash
gh extension upgrade action-inspector
gh extension remove action-inspector
```

## Quick start

```bash
# Inspect a reference, including its resolved full SHA and latest release
gh action-inspector actions/checkout@v4

# Scan workflows, local Actions under .github/actions, and reachable dependencies
gh action-inspector scan

# Preview pinning existing versions without upgrading
gh action-inspector pin --dry-run

# Preview upgrades within each Action's current major version
gh action-inspector upgrade --policy minor

# Compare runtime, inputs, defaults, outputs, and deprecations
gh action-inspector compare actions/checkout@v4 actions/checkout@v7

# Discover commands and options
gh action-inspector --help
```

You can inspect tags, branches, full SHAs, short SHAs of at least six characters,
and Actions in subdirectories. Commands also support JSON output for scripts.
See the [command reference](docs/commands.md) for examples and output details.

## Safety defaults

- **Preview is the default.** Only an explicit `--write` modifies workflow files.
- **Pinning preserves the current commit.** Upgrading is a separate command.
- **Compatibility checks are not a safety guarantee.** Review release notes and
  exercise your workflow before adopting an upgrade.
- No command creates commits or opens pull requests. Multi-file writes are
  sequential, not transactional; see [write safeguards](docs/pinning-and-upgrades.md#write-safeguards).

## Documentation

| Guide | Covers |
|---|---|
| [Command reference](docs/commands.md) | Commands, flags, help, scanning scope, examples, JSON, and exit codes |
| [Pinning and upgrades](docs/pinning-and-upgrades.md) | Preview/write behaviour, upgrade policies, and compatibility limits |
| [CI policies](docs/ci-policies.md) | Pinning checks, archived repositories, publisher allowlists, and CI integration |
| [Troubleshooting](docs/troubleshooting.md) | Authentication, rate limits, caching, missing releases, and unsupported YAML |
| [Contributing](CONTRIBUTING.md) | Local development, tests, standalone builds, contributions, and releases |

## Project status

Action Inspector is under active development. Current features include
single-reference inspection, repository scanning, SHA pinning, upgrade previews,
Action metadata comparisons, and CI policy checks.

## Contributing and security

Contributions, ideas, bug reports, and documentation improvements are welcome.
Read [CONTRIBUTING.md](CONTRIBUTING.md) before contributing.

For vulnerabilities in Action Inspector itself, follow the private reporting
instructions in [SECURITY.md](SECURITY.md).

## License

Action Inspector is available under the [MIT License](LICENSE).
