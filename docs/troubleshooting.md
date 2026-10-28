# Troubleshooting

[README](../README.md) · [Command reference](commands.md) ·
[Pinning and upgrades](pinning-and-upgrades.md) · [CI policies](ci-policies.md)

## Authentication

Action Inspector uses credentials in this order:

1. `GH_TOKEN`.
2. `GITHUB_TOKEN`.
3. Stored credentials from `gh auth token --hostname github.com`.

Your normal GitHub CLI login works without manually exporting a token,
including when running the tool directly with Node.js:

```bash
gh auth login
gh auth status --hostname github.com
```

An environment token overrides your stored login. If a stale token is set,
update it or remove it from the shell environment before retrying.
Never paste tokens into bug reports, logs, or screenshots.

If GitHub CLI is missing or not logged in, public repositories can still be
inspected anonymously, subject to GitHub's lower unauthenticated limits.
Private repositories require appropriate token access.

## Access denied and rate limits

A `403` can mean insufficient permissions, access restrictions, or rate limiting.
Check your login and the token's access to the requested repository. Rate-limit
errors include the reset time or retry delay when GitHub supplies those headers.
Wait until that time before retrying.

The tool does not silently substitute stale data or automatically retry write
plans after API failures. [CI authentication](ci-policies.md#github-actions-integration)
may need a dedicated token for cross-repository private dependencies.

## API cache

Successful responses are cached for **five minutes** in
`~/.cache/gh-action-inspector`. Set `ACTION_INSPECTOR_CACHE_DIR` to use a different
directory. Duplicate requests within a scan share lookups.

Credentials are not written to cache files; entries are isolated by a hash of
the authentication token. Cached responses can contain private repository
metadata. Protect the cache directory on shared machines.

Bypass cache reads and writes for fresh results or to diagnose cache problems:

```bash
gh action-inspector scan --no-cache
gh action-inspector actions/checkout@v7 --no-cache
```

Write commands automatically bypass the cache to re-resolve moving tags.
Corrupt or inaccessible cache files produce explicit errors rather than stale
or success-shaped fallback results.

## Missing releases or version tags

An Action does not need a published release to be inspected or pinned. When no
applicable release is available, the tool reports update availability as unknown,
not "up to date". Single-reference JSON uses `latestRelease: null` with a warning.

Some repositories publish multiple products. Non-version release names such as
`codeql-bundle-v2.27.3` are not treated as Action upgrade versions. Release
searches stop with an error at their documented limit rather than silently
choosing from incomplete data.

If no tag points to the current commit, the version is reported as not found.
You can still inspect or pin it, but upgrades require a numeric current version
tag to select a policy safely.

## Unknown or ambiguous short SHAs

Use at least six hexadecimal characters. If GitHub cannot resolve the prefix
uniquely, provide more characters or the full 40-character SHA. Confirm the
repository and access permissions as well.

A matching tag or branch takes precedence over a short SHA. Short SHAs are
lookup conveniences, not valid full-SHA workflow pins.

## Missing Action metadata

`--details` and `compare` require `action.yml` or `action.yaml` at the resolved
commit and selected subdirectory. Upgrade checks also verify target Action
metadata. Confirm that the path identifies an Action, not just its repository.

Reusable workflows are different: they cannot be used with `--details` or
`compare`. Upgrade checks verify a target workflow declares `on.workflow_call`,
but interface review remains manual.

## YAML and discovery errors

The scanner follows references from `.github/workflows` into reachable local
workflows and composite actions. Local paths are relative to the selected
repository root. Run from that root or pass its directory explicitly.

Unsupported YAML aliases or merge keys in jobs or steps, missing local files,
malformed YAML, and references escaping the repository are reported explicitly.
Docker references and expressions are listed but not resolved. Policies can
reject them as described in [CI policies](ci-policies.md).

Multiline `uses` values cannot be safely rewritten and block pin/upgrade writes.
Do not treat successful rows in an error report as a complete write plan.

## Terminal appearance

Scan, pin, and upgrade reports use compact tables per file, with line-labeled
diagnostics below each table. Long values wrap inside cells; version columns
move below the table in narrow terminals. Reports wrap explanatory text to the terminal width.
Colors are used only when terminal color support is detected. Piping or
redirecting output disables colors and inspection icons. Set `NO_COLOR` to
request plain output. Use `--json` for scripts rather than parsing the report.
Copyable YAML in Before/After change cards remains unwrapped intentionally.

## Installed extension differs from the local build

The installed extension runs a release executable, not your working copy:

```bash
gh extension upgrade action-inspector
```

Unpublished changes can be tried with `node .\dist\main.js` after building.
See [local development](../CONTRIBUTING.md#local-development).
