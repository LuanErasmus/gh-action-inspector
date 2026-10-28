# CI policies

[README](../README.md) · [Command reference](commands.md) ·
[Pinning and upgrades](pinning-and-upgrades.md) · [Troubleshooting](troubleshooting.md)

## Enable checks

```bash
gh action-inspector scan --fail-on unpinned,archived
gh action-inspector scan --fail-on publisher --allow-publishers actions,github
gh action-inspector scan --json --fail-on unpinned,archived,publisher --allow-publishers actions,github
```

Policies are opt-in. Combine names in a comma-separated `--fail-on` value.

| Policy | Fails when |
|---|---|
| `unpinned` | A GitHub dependency is not pinned to a full commit SHA, or a Docker image lacks a full SHA-256 digest |
| `archived` | A referenced GitHub repository is archived |
| `publisher` | A GitHub owner is not on the supplied allowlist |

`--fail-on publisher` requires `--allow-publishers`. Entries are exact GitHub
owner names, matched case-insensitively, not wildcard patterns. An allowlist
expresses your policy; it is not a guarantee of publisher or code safety.

## Local, Docker, and dynamic references

Local dependencies are followed, and their external references are checked.
The local references themselves do not need SHA pins.

Docker images are checked for digest pinning under `unpinned`. Docker
publishers cannot be evaluated against a GitHub-owner allowlist, so they fail
the `publisher` policy.

Expressions cannot be resolved statically and fail whenever policies are
enabled, rather than silently bypassing the checks.

## Results and exit codes

Violations return exit code `1`, print their file/line locations, and appear in
JSON `policyFailures`. Discovery, API, and malformed metadata failures also fail
the scan. A clean scan returns `0`.

An available update alone is not a violation. If a repository has no applicable
published release, update availability is unknown; that does not make it
archived or unpinned. A repository with no workflow directory produces an empty
scan and returns `0`.

See [discovery scope](commands.md#discovery-scope) and
[JSON reports](commands.md#json-reports) for limitations and output structure.

## GitHub Actions integration

For a GitHub-hosted Ubuntu job where checkout has already run, install the
extension and invoke the policy check:

```yaml
- name: Install Action Inspector
  env:
    GH_TOKEN: ${{ github.token }}
  run: gh extension install LuanErasmus/gh-action-inspector

- name: Check Action dependency policies
  env:
    GH_TOKEN: ${{ github.token }}
  run: gh action-inspector scan --fail-on unpinned,archived,publisher --allow-publishers actions,github
```

Give the job `contents: read` permission. Private dependencies outside the
workflow repository may require a separately scoped token; the repository's
`github.token` does not automatically grant access to other private repositories.
The example installs the current extension release.

CI checks only inspect files. Do not add `--write` to a policy-check job; use
pinning and upgrade previews in your review workflow instead.
