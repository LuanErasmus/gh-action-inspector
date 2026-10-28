# Pinning and upgrades

[README](../README.md) · [Command reference](commands.md) ·
[CI policies](ci-policies.md) · [Troubleshooting](troubleshooting.md)

## Pin without upgrading

```bash
gh action-inspector pin --dry-run
gh action-inspector pin C:\path\to\repository --dry-run
gh action-inspector pin --json
```

`pin` defaults to preview mode (`--dry-run` is optional). File-grouped change
cards show each affected line with explicit **Before** and **After** labels,
blank space between changes, and a changed-line count per file. The preview
replaces mutable or short-SHA references with the **full SHA of the current
commit**. It does not select a newer release or require a published release.
Upgrade previews use the same layout. Complete YAML lines remain unwrapped
and copyable, including full SHAs; JSON retains the original change data.

Apply the replacements explicitly:

```bash
gh action-inspector pin --write
```

Existing quotes, prose comments, inline YAML, nested Action paths, and line
endings are preserved. Already full-SHA-pinned references are checked but left
unchanged. When no existing comment is present, a reference comment is added to
standalone `uses` lines. Inline YAML is kept intact.

Local references, Docker images, and expressions are not changed. Multiline
`uses` values are reported as unsafe to preview rather than rewritten.
See [discovery scope](commands.md#discovery-scope) for files that are scanned.

## Upgrade selection

```bash
gh action-inspector upgrade --policy patch
gh action-inspector upgrade --policy minor
gh action-inspector upgrade --policy major
gh action-inspector upgrade --policy latest
gh action-inspector upgrade --policy major --write
```

Upgrades also preview by default. Policies select the highest stable published
`vX.Y.Z` or `X.Y.Z` release:

| Policy | Allowed upgrade | Example from v1.2.3 |
|---|---|---|
| `patch` | Same major and minor | v1.2.10 |
| `minor` (default) | Within the current major | v1.9.0 |
| `major` | Next major only | v2.9.0 |
| `latest` | Any major, including skipping majors | v3.0.0 |

`major` does not fall back to a minor update or skip a missing major: if no
stable release exists in the next major, no upgrade is proposed.

> [!IMPORTANT]
> Previously, `major` meant staying within the current major. Use `minor` to
> retain that behavior in existing scripts. Explicit `--policy major` now allows
> a breaking upgrade to the next major. Commands without `--policy` retain
> their previous within-current-major behavior.

Upgrades write full SHA pins and never downgrade. The current commit must have
a numeric version tag; otherwise selection fails explicitly.

Release listing is paginated, excludes drafts, prereleases, and unrelated tag
names, and fails if the 2,000-release search limit is reached instead of making
an incomplete recommendation. Existing version-only comments are refreshed;
prose comments are preserved.

## Compatibility checks

For Actions, the target path is checked for metadata at its resolved commit.
The current and target metadata are compared for:

- Runtime changes, such as Node.js 20 to Node.js 24.
- Added or newly required inputs without defaults.
- Removed inputs and outputs.
- Changed defaults and deprecated inputs.

The same comparison is available independently with
[`compare`](commands.md#compare-two-action-versions).

**These checks cannot guarantee compatibility.** They do not inspect arbitrary
implementation code or infer all permissions, runner requirements, or breaking
changes. Review the linked release notes and exercise the workflow before
deploying an upgrade.

Major upgrades and metadata differences are warnings. `--write` is your explicit
choice to apply them; the tool does not automatically treat warnings as blockers.
Missing or malformed target metadata is an error and blocks writes.

Remote reusable workflow targets are checked for a workflow file declaring
`on.workflow_call`. Their inputs and outputs still require manual review.

## Write safeguards

Only `pin --write` and `upgrade --write` modify workflow files.
`--write` cannot be combined with `--dry-run`.

No command creates commits or opens pull requests. Writes are refused when any
reference or discovery error occurs. Generated YAML is parsed before writing.
All affected files are checked against their original contents before writes,
then checked again immediately before each write to reduce the risk of
overwriting concurrent edits.

**Writes are sequential, not a multi-file transaction.** A concurrent edit can
still race with a write, and an I/O failure may leave some files updated.
Failures report which files were already written. Review the resulting diff
before committing, and avoid editing the same files while a write is running.

Write commands bypass the API cache so moving references are freshly resolved.
An earlier preview is not a saved execution plan: running again with `--write`
performs a new inspection, and references may have moved in the meantime.

For machine-readable previews, see [JSON reports](commands.md#json-reports).
