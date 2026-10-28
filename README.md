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

## Scan a repository

Inspect all `.yml` and `.yaml` workflows in the current repository:

```bash
gh action-inspector scan
gh action-inspector scan C:\path\to\repository
gh action-inspector scan --json
```

The summary lists each reference's file and line, resolved version, full-SHA pin
status, latest release, and whether an update is available. Archived repositories
are flagged. Full SHAs are abbreviated in the table for readability; JSON retains
the complete reference and resolved SHA.

The scanner follows local reusable workflows and local composite actions reachable
from the workflows, including composite actions outside `.github`. Remote reusable
workflow references are inspected as dependencies, but their contents are not
recursively scanned. Local references are resolved relative to the selected
repository root; files outside that root are refused.

Docker references and expressions are listed but not resolved. Missing local
dependencies, unsupported YAML aliases/merge keys in jobs or steps, malformed
workflows, and API failures are reported explicitly. A scan continues where
possible and exits with code 1 if any errors occurred; otherwise it exits with
code 0. No workflow directory is treated as an empty scan.

Repeated references share lookups within a scan to reduce API requests. API
responses are cached for five minutes across invocations (see below). Actions
without published releases remain inspectable: update availability is unknown,
not "up to date". Unrelated non-version releases are not recommended as updates.

## Preview SHA pinning

```bash
gh action-inspector pin --dry-run
gh action-inspector pin C:\path\to\repository --dry-run
gh action-inspector pin --json
```

`pin` defaults to preview mode (`--dry-run` is optional). It shows a
line-by-line diff replacing each mutable or short-SHA reference with the **full
SHA of its current commit**. It does not upgrade versions. Use `--write` to
explicitly apply the replacements:

```bash
gh action-inspector pin --write
```

No command creates commits or opens pull requests. Writes are refused if any
reference or discovery error occurs. All affected files are checked against the
original contents before writes to avoid overwriting concurrent edits. Writes
are sequential, not a multi-file transaction: an I/O failure reports files
already written. Review the diff before committing.

Existing quotes, comments, inline YAML, nested Action paths, and line endings are
preserved. Already full-SHA-pinned references are checked but left unchanged.
Local references, Docker images, and expressions are not changed. Multiline
`uses` values are reported as unsafe to preview instead of being rewritten.
Pinning does not require the Action to have a published release.
When no existing comment is present, a version/reference comment is added to
standalone `uses` lines. Inline YAML is kept intact.

With `--json`, both commands return a single report containing `mode`, `files`
(the count of discovered files), `rows`, `changes`, and `errors`. Per-reference
errors appear in `rows[].error`; discovery errors appear in `errors`. Successful
previews in a report with errors are partial results, not a complete pinning plan.

## Upgrade policies

```bash
gh action-inspector upgrade --policy patch
gh action-inspector upgrade --policy major
gh action-inspector upgrade --policy latest
gh action-inspector upgrade --policy major --write
```

All upgrade commands preview by default. `--write` applies the preview; it cannot
be combined with `--dry-run`. Policies select the highest stable published
`vX.Y.Z` or `X.Y.Z` release:

| Policy | Allowed upgrade | Example from v1.2.3 |
|---|---|---|
| `patch` | Same major and minor | v1.2.10 |
| `major` (default) | Within the current major | v1.9.0 |
| `latest` | Any major | v2.0.0 |

Upgrades always write full SHA pins. They never downgrade. The current commit
must have a numeric version tag; otherwise selection fails explicitly. Release
listing is paginated, excludes drafts, prereleases, and unrelated tag names, and
fails if the 2,000-release search limit is reached rather than making an
incomplete recommendation.

For Actions, the target path is checked for metadata at its resolved commit and
the current/target runtime, inputs, defaults, outputs, and deprecations are
compared. Major upgrades and metadata differences are warnings, not a guarantee
of compatibility; `--write` is your explicit choice to apply them. Review the
linked release notes. Remote reusable workflow targets are checked for a workflow
file with `on.workflow_call`; their inputs and outputs still require manual review.
Existing version-only comments are refreshed; prose
comments are preserved.

## Action details and compatibility comparison

```bash
gh action-inspector actions/checkout@v7 --details
gh action-inspector github/codeql-action/analyze@v4 --details --json
gh action-inspector compare actions/checkout@v4 actions/checkout@v7
gh action-inspector compare actions/checkout@v4 actions/checkout@v7 --json
```

`--details` reads `action.yml` (or `action.yaml`) at the resolved commit, including
the nested Action path. It shows runtime, required/optional inputs, defaults,
outputs, descriptions, and deprecation messages. Missing or malformed Action
metadata is an error. Reusable workflows are not Action metadata and cannot be
used with `--details` or `compare`.

`compare` accepts two references to the same Action and reports runtime changes,
added or newly required inputs without defaults, removed inputs/outputs, changed
defaults, and deprecated inputs. It does not inspect arbitrary implementation
code or infer runner permissions or all breaking changes. Always review release
notes and exercise the workflow before deploying an upgrade.

## CI policy checks

```bash
gh action-inspector scan --fail-on unpinned,archived
gh action-inspector scan --fail-on publisher --allow-publishers actions,github
gh action-inspector scan --json --fail-on unpinned,archived,publisher --allow-publishers actions,github
```

Policy violations return exit code 1 and are included in JSON `policyFailures`.
Allowlist entries are exact GitHub owner names (case-insensitive), not wildcard
patterns. Local dependencies are followed; their local references do not require
SHA pins. `unpinned` also flags Docker images without full SHA-256 digests.
Dynamic expressions cannot be evaluated and fail when policies are enabled.
Docker publishers cannot be evaluated against a GitHub-owner allowlist and fail
the publisher policy. Metadata/API failures also fail the scan.

## API cache and rate limits

Successful API responses are cached for **five minutes** in
`~/.cache/gh-action-inspector`. Credentials are never written to cache files;
entries are isolated by a hash of the authentication token. Cached responses can
contain repository metadata, so protect the cache directory on shared machines.
Set `ACTION_INSPECTOR_CACHE_DIR` to use another directory.

```bash
gh action-inspector scan --no-cache
gh action-inspector actions/checkout@v7 --no-cache
```

`--no-cache` bypasses reads and writes. Write commands automatically bypass the
cache to re-resolve moving tags. Rate-limit errors include the reset time or
retry delay when supplied by GitHub. The tool does not silently fall back to
stale data or automatically retry write plans after an API failure.

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
