# 🔍 Action Inspector

[![CI](https://github.com/LuanErasmus/gh-action-inspector/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/LuanErasmus/gh-action-inspector/actions/workflows/ci.yml)
[![Release](https://github.com/LuanErasmus/gh-action-inspector/actions/workflows/release.yml/badge.svg)](https://github.com/LuanErasmus/gh-action-inspector/actions/workflows/release.yml)
[![Latest release](https://img.shields.io/github/v/release/LuanErasmus/gh-action-inspector?sort=semver)](https://github.com/LuanErasmus/gh-action-inspector/releases/latest)
[![License: MIT](https://img.shields.io/github/license/LuanErasmus/gh-action-inspector)](LICENSE)

**Know what you're running before you add `uses:`.**

GitHub Actions workflows frequently reference external Actions using syntax like:

```yaml
- uses: actions/checkout@v4
```

But what exactly does `v4` point to?

**Action Inspector** is a small open-source tool for inspecting a GitHub Action reference before adding it to your workflow.

The goal is simple:

```bash
gh action-inspector actions/checkout@v4
```

And get a clear explanation of the Action and the reference being used.

## 🎯 What Action Inspector will show

Given an Action reference such as:

```text
actions/checkout@v4
```

Action Inspector aims to show:

- 🔎 The repository behind the Action
- 🏷️ The supplied reference
- 🔗 The commit SHA the reference currently resolves to
- 🔒 Whether the reference is immutable
- 📦 Basic repository information
- 📌 An equivalent SHA-pinned reference

## 💡 Why?

GitHub Actions are dependencies of your CI/CD environment.

References such as:

```yaml
uses: actions/checkout@v4
```

are convenient, but they don't immediately tell you what commit will actually execute.

Action Inspector focuses on answering one question:

> **What exactly am I referencing when I write `uses:`?**

## 📥 Installation

Action Inspector is a [GitHub CLI](https://cli.github.com/) extension. With `gh`
installed, run:

```bash
gh extension install LuanErasmus/gh-action-inspector
```

No Node.js or other dependencies are required: each
[release](https://github.com/LuanErasmus/gh-action-inspector/releases) includes a
standalone executable for Windows, macOS, and Linux (x64 and arm64), and `gh`
downloads the one for your platform.

Upgrade or remove the extension with:

```bash
gh extension upgrade action-inspector
gh extension remove action-inspector
```

Action Inspector automatically uses your GitHub CLI login (`gh auth login`),
including when run directly with Node.js. No token environment variable is
required. If set, `GH_TOKEN` takes precedence over `GITHUB_TOKEN`, followed by
the stored credentials from `gh auth token --hostname github.com`.

Public repositories can still be inspected without authentication when GitHub CLI
is unavailable or not logged in, but GitHub's unauthenticated rate limits apply.

## 🧪 Examples

Action Inspector accepts any reference you can use in `uses:`:

```bash
gh action-inspector actions/checkout@v4                                        # tag
gh action-inspector actions/checkout@main                                      # branch
gh action-inspector actions/checkout@11d5960a326750d5838078e36cf38b85af677262  # commit SHA
gh action-inspector actions/checkout@11d5960                                   # short commit SHA
gh action-inspector github/codeql-action/analyze@v3                            # Action in a subdirectory
```

The command resolves the supplied reference against GitHub, finds the version
tag that points to the resolved commit, and compares it with the latest
published release.

### Inspecting a tag

```bash
gh action-inspector actions/checkout@v4
```

```text
actions/checkout@v4

Reference
  Type           tag
  Commit SHA     11d5960a326750d5838078e36cf38b85af677262
  Version        v4.4.0
  Immutable      No (a tag can be moved)
  SHA-pinned     actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0

Repository
  Name           actions/checkout
  License        MIT
  Archived       No

Latest release
  Version        v7.0.1
  Newer version  Yes (v4.4.0 → v7.0.1)
  Release notes  https://github.com/actions/checkout/releases/tag/v7.0.1

Pin to latest release
  uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
```

### Inspecting a pinned commit SHA

If your workflow already pins an Action to a full commit SHA, pass the SHA to
find out which version it corresponds to and whether a newer release exists:

```bash
gh action-inspector actions/checkout@11d5960a326750d5838078e36cf38b85af677262
```

```text
actions/checkout@11d5960a326750d5838078e36cf38b85af677262

Reference
  Type           sha
  Commit SHA     11d5960a326750d5838078e36cf38b85af677262
  Version        v4.4.0
  Immutable      Yes
  SHA-pinned     actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0

Repository
  Name           actions/checkout
  License        MIT
  Archived       No

Latest release
  Version        v7.0.1
  Newer version  Yes (v4.4.0 → v7.0.1)
  Release notes  https://github.com/actions/checkout/releases/tag/v7.0.1

Pin to latest release
  uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
```

You can also pass a short SHA of at least 6 characters (for example `11d5960`).
It is expanded to the full SHA. Tags and branches with the same name take
precedence. GitHub Actions does not accept short SHAs in `uses:`, so use the
`SHA-pinned` line from the output instead. If no tag points to the
commit, `Version` shows `Not found (no tag points to this commit)`.

### Terminal output

When run in a terminal, the output uses colors and status icons (✓, ⚠, ✗) and
shows a progress message while GitHub is queried. Colors are disabled
automatically when the output is redirected or piped, or when `NO_COLOR` is set.

### JSON output

Use `--json` for machine-readable output, for example in scripts:

```bash
gh action-inspector --json actions/checkout@v4
```

## 🚧 Project Status

Action Inspector is currently under development.

The initial release will focus on inspecting a single GitHub Action reference.

## 🛠️ Development

Install dependencies, build the CLI, and link it for local use:

```bash
npm install
npm run build
npm link
```

You can then run the development build from any directory:

```bash
action-inspector actions/checkout@v6
```

Run the test suite and TypeScript type check with:

```bash
npm test
npm run typecheck
```

Build the standalone executable for your current platform (written to
`release/`) with:

```bash
npm run build:executable
```

The CLI queries GitHub's REST API. Public repositories can be inspected without
authentication; set `GITHUB_TOKEN` to authenticate and help avoid API rate
limits.

## 🤝 Contributing

Contributions, ideas, bug reports, and documentation improvements are welcome.

Please see [CONTRIBUTING.md](CONTRIBUTING.md) before contributing.

## 🔐 Security

If you discover a security issue in Action Inspector itself, please follow the guidance in [SECURITY.md](SECURITY.md).

## 📄 License

Action Inspector is available under the [MIT License](LICENSE).
