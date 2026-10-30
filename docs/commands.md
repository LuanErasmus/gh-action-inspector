# Command reference

[README](../README.md) · [Pinning and upgrades](pinning-and-upgrades.md) ·
[CI policies](ci-policies.md) · [Troubleshooting](troubleshooting.md)

## Help

```bash
gh action-inspector --help
gh action-inspector -h
gh action-inspector scan --help
gh action-inspector pin --help
gh action-inspector upgrade --help
gh action-inspector compare --help
```

Top-level help separates usage, commands, common options, examples, and safety
guidance into readable sections. Subcommand help shows arguments, applicable
options, and examples, including the upgrade policy boundaries. Help wraps to
the terminal width; the guides provide more detailed explanations.

## Inspect a reference

```text
gh action-inspector <owner/repository[/path]@ref> [--details] [--json] [--no-cache]
```

```bash
gh action-inspector actions/checkout@v4                                        # tag
gh action-inspector actions/checkout@main                                      # branch
gh action-inspector actions/checkout@11d5960a326750d5838078e36cf38b85af677262  # full SHA
gh action-inspector actions/checkout@11d5960                                   # short SHA
gh action-inspector github/codeql-action/analyze@v3                            # nested Action
```

The command resolves the reference against GitHub, finds a version tag pointing
to the commit, and compares it with the latest published Action release. It
reports repository/license information, archive status, whether the reference
is immutable, and copyable full-SHA references.

Short SHAs must contain 6–39 hexadecimal characters and resolve uniquely. Tags
and branches with the same name take precedence over a short SHA. Short SHAs
cannot be used in GitHub Actions `uses:`; copy the full-SHA pin from the output.
If no tag points to the commit, `Version` shows
`Not found (no tag points to this commit)`.

Example output (release values can change):

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

Passing the full SHA instead displays `Type: sha` and `Immutable: Yes`, while
still looking up its version and available updates. Repositories without
published releases remain inspectable, with update availability unknown.

### Action details

```bash
gh action-inspector actions/checkout@v7 --details
gh action-inspector github/codeql-action/analyze@v4 --details --json
```

`--details` reads `action.yml` (or `action.yaml`) at the exact resolved commit
and nested path. Text output shows runtime and a compact inputs table with
required status and defaults, followed by outputs and full deprecation warnings.
Input descriptions are linked to the metadata file at the exact resolved commit
instead of filling the terminal with long paragraphs. Use `--details --json`
to include every input description in the report.
Quoted `""` means an empty default; `(not set)` means no declared default.
Below 60 columns, required status and defaults share a configuration column.
Missing or malformed metadata
is an error. Reusable workflows cannot be inspected with `--details`.

## Scan a repository

```text
gh action-inspector scan [directory] [--json] [--no-cache]
  [--fail-on unpinned,archived,publisher] [--allow-publishers owner,...]
```

```bash
gh action-inspector scan
gh action-inspector scan C:\path\to\repository
gh action-inspector scan --json
```

The directory defaults to the current working directory. Results use a compact
table per workflow or local Action file. Summary totals appear first, followed
by line numbers, Action references, pin status, and current/latest versions.
Update availability appears as an `[Update]` badge next to the Action
reference in its table cell, wrapping within the cell on narrow terminals.
Status retains the pin state; unknown availability remains in Status.
Errors, warnings, and narrow-terminal version details appear
below each table, labeled with both the line number and Action reference.
Discovery errors and CI policy findings have separate sections.
Full SHAs are abbreviated in the summary but retained in JSON.
Long cell values wrap within their columns rather than being truncated.
Below 80 columns, version details move below the table to keep it readable.
Pin previews omit version columns; upgrade tables show `Target` instead of `Latest`.

```text
Workflow scan: 1 file
2 references · 1 pinned · 1 unpinned · 1 update · 0 errors
Pinning locks the ref; Latest/Target shows version freshness. Equal versions do not imply a pinned ref.

.github\workflows\ci.yml
  | Line | Action                      | Status   | Current | Latest |
  |------|-----------------------------|----------|---------|--------|
  | L16  | actions/checkout            | Pinned   | v7.0.1  | v7.0.1 |
  |------|-----------------------------|----------|---------|--------|
  | L20  | actions/setup-node [Update] | Unpinned | v6.0.0  | v7.1.0 |
```

### Discovery scope

The scanner reads `.yml` and `.yaml` files in `.github/workflows` and follows
reachable local reusable workflows and composite actions, including composites
outside `.github`. It also recursively discovers `action.yml` and `action.yaml`
under `.github/actions`, even when no workflow references them. `action.yml`
takes precedence when both names exist in a directory. Composite `runs.steps`
dependencies are inspected; JavaScript and Docker Action metadata do not add
nested `uses` dependencies. Files already reached from workflows are not scanned
twice. This discovery applies to scan, pin, and upgrade, including writes.
Successfully inspected files without dependency references appear with
`No uses found in file.` rather than being omitted. Malformed files are reported
as errors, not as empty files.
Remote reusable workflow references are inspected as
dependencies, but their contents are not recursively scanned.

Local paths are relative to the selected repository root; references outside
that root are refused. Cycles do not cause repeated traversal. A missing workflow
directory does not prevent local Action discovery. With neither workflows nor
local Action metadata, the scan is empty.

Docker references and expressions are listed but not resolved. Missing local
dependencies, unsupported YAML aliases/merge keys in jobs or steps, malformed
workflows, and API failures are reported explicitly. The scan continues where
possible. [CI policies](ci-policies.md) can enforce additional requirements.

## Pin current references

```text
gh action-inspector pin [directory] [--dry-run | --write] [--json] [--no-cache]
```

```bash
gh action-inspector pin --dry-run
gh action-inspector pin C:\path\to\repository --json
gh action-inspector pin --write
```

Pinning preserves the current commit, not necessarily the latest release.
See [pinning and write safeguards](pinning-and-upgrades.md).

## Upgrade references

```text
gh action-inspector upgrade [directory] [--policy patch|minor|major|latest]
  [--min-release-age days]
  [--dry-run | --write] [--json] [--no-cache]
```

```bash
gh action-inspector upgrade --policy patch
gh action-inspector upgrade --policy minor
gh action-inspector upgrade --policy major
gh action-inspector upgrade --policy latest
gh action-inspector upgrade --policy major --write
```

The default policy is `minor`, meaning **within the current major**.
`major` selects the highest release in the next major only (v5 to v6);
`latest` can skip majors (v5 to v7). See [upgrade selection](pinning-and-upgrades.md#upgrade-selection)
for policy boundaries and compatibility warnings.

`latest` only selects stable releases published at least **7 days** ago by
default. Set `--min-release-age 14` for two weeks or `0` to disable the wait.
Other policies only apply a waiting period when explicitly requested.
See [minimum release age](pinning-and-upgrades.md#minimum-release-age).

## Compare two Action versions

```text
gh action-inspector compare <action@before> <action@after> [--json] [--no-cache]
```

```bash
gh action-inspector compare actions/checkout@v4 actions/checkout@v7
gh action-inspector compare actions/checkout@v4 actions/checkout@v7 --json
```

Both references must identify the same Action, including its subdirectory.
Comparison reports runtime changes, added or newly required inputs without
defaults, removed inputs/outputs, changed defaults, and deprecated inputs.
Release-note links and a manual-review notice accompany the results.

It does not compare arbitrary implementation code, infer runner permissions,
or detect all breaking changes. Reusable workflows are not supported by this
command. See [compatibility limits](pinning-and-upgrades.md#compatibility-checks).

## Output and shared options

| Option | Behaviour |
|---|---|
| `--help`, `-h` | Show top-level or subcommand usage |
| `--json` | Emit a single JSON document for scripting |
| `--no-cache` | Bypass API cache reads and writes |
| `--details` | Include Action metadata in single-reference inspection |
| `--dry-run` | Explicitly request the default pin/upgrade preview |
| `--write` | Apply pin/upgrade changes; cannot be combined with `--dry-run` |

Reports use consistent sections and terminal-aware wrapping. Comparisons group
compatibility findings separately from manual-review guidance. Detailed Action
inputs use a compact table; deprecation warnings remain outside the table.
Within each file, scan, pin, and upgrade tables sort by Action name (ignoring
case and version), then by source line. Repeated Actions stay together even
when their versions differ. Line numbers still refer to the original file;
JSON reports, source files, and change previews retain their existing order.
Subtle table dividers separate different Actions. When Current is visible and
identifies a resolved version, numeric-tag and SHA references omit the ref from
the Action label. Branches, unresolved references, pin tables, and narrow tables
retain their references. Full references remain in JSON and change previews.
The compact summary colors only nonzero status counts, and a single legend
explains that pinning and version freshness are independent. Reference errors
and discovery errors associated with a displayed file appear below its table;
unassociated discovery errors remain in the Discovery errors section.

Interactive terminals show an animated magenta progress spinner with elapsed
time while inspecting, comparing, scanning, pinning, or upgrading. Repository
commands also show discovery and reference-checking progress. The status clears
before results or errors appear. Progress uses stderr only when it is a terminal;
redirected stderr stays quiet and JSON on stdout remains unchanged.

When terminal color support is detected, file headings are bold magenta.
Tables color individual pin states (`Pinned` green, `Unpinned`
yellow), `[Update]` badges cyan, and errors red, rather than coloring whole rows.
Current versions match the pin state: green for pinned, yellow for unpinned.
Latest/Target versions are cyan when an update is available, otherwise they
match the pin state. Missing version placeholders remain neutral.
Action names, local dependencies, and unknown availability remain neutral.
Warnings are yellow and policy failures are red.
Single-reference inspection also uses status markers (✓, !, ✗); `!` avoids
wide warning-emoji rendering issues. Colors and icons are disabled when output
is redirected/piped or `NO_COLOR` is set.

Prose, errors, long references, and URLs wrap to the terminal width (100 columns
when the width is unavailable). Copyable `uses:` lines and Before/After YAML lines are kept
intact, so these may exceed narrow windows. JSON output is unchanged and never
contains display colors or presentation wrapping.

### JSON reports

```bash
gh action-inspector --json actions/checkout@v4
gh action-inspector scan --json
gh action-inspector pin --json
```

Inspection returns the reference, repository information, and latest release;
`latestRelease` is `null` with a warning when no applicable release is available.
`--details` adds Action metadata. Comparison returns `before`, `after`,
`comparison`, and `releaseNotes`.

Repository commands return `mode`, `files` (the discovered file count), `rows`,
`filesWithoutUses` (successfully inspected paths with no dependency references),
`changes`, and `errors`. Per-reference errors appear in `rows[].error`;
discovery errors appear in `errors`. Policy violations appear in
`policyFailures`, and applied file paths appear in `written`.

Successful previews in a report with errors are partial results, not a complete
write plan. Fatal command errors are printed on stderr rather than as a JSON
report. Always check the exit code.

### Exit codes

| Code | Meaning |
|---|---|
| `0` | Command completed, including an empty scan or a preview with no changes |
| `1` | Invalid arguments, discovery/API/metadata/write failure, or policy violation |

Updates being available do not by themselves fail a scan. Missing release
metadata can be a warning with unknown update availability, not an error.
