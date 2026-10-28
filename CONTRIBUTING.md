# Contributing to Action Inspector

Thanks for your interest in improving Action Inspector. Contributions of code,
documentation, bug reports, and ideas are welcome.

## Before you start

- For bugs or feature ideas, check the existing issues before opening a new one.
- For a larger change, open an issue first to discuss the approach.
- Keep changes focused on the agreed scope and consistent with the existing
  project structure and style.

## Submitting a change

1. Fork the repository and create a branch for your change.
2. Make your changes, adding or updating tests when applicable.
3. Run `npm test`, `npm run typecheck`, and `npm run build`, and document the
   results in your pull request.
4. Open a pull request describing the problem, your changes, and any relevant
   verification results. Link related issues when applicable.

## Local development

Install dependencies, build the TypeScript CLI, and run it directly:

```bash
npm install
npm run build
node .\dist\main.js actions/checkout@v7
node .\dist\main.js --help
```

Alternatively, link the development build for use from any directory:

```bash
npm link
action-inspector actions/checkout@v7
```

Rebuild after source changes. The development build is separate from the
executable installed by `gh extension install`.

Run the existing validation commands:

```bash
npm test
npm run typecheck
npm run build
```

Build a standalone executable for the current platform into `release/`:

```bash
npm run build:executable
```

The CLI queries GitHub's REST API and automatically uses your GitHub CLI login.
See [authentication and API troubleshooting](docs/troubleshooting.md) for token
precedence, caching, and rate limits.

## Documentation

Keep the [README](README.md) focused on installation, quick start, and essential
safety defaults. Detailed user documentation lives in these guides:

- [Command reference](docs/commands.md): syntax, flags, output, and exit codes.
- [Pinning and upgrades](docs/pinning-and-upgrades.md): selection and write behaviour.
- [CI policies](docs/ci-policies.md): enforcement and CI integration.
- [Troubleshooting](docs/troubleshooting.md): authentication and operational issues.

Update the guide that owns a behaviour rather than duplicating detailed
explanations in the README. Keep examples and CLI help consistent with the code,
and use relative links between repository documents.

## Releases

Releases follow [Semantic Versioning](https://semver.org/) and are published
by the [Release workflow](.github/workflows/release.yml) when a version tag is
pushed. Version bumps must go through a pull request; do not commit directly to
protected `main` or create a release tag on an unmerged branch.

### Recommended: automated release

After the one-time GitHub App setup below:

1. Open **Actions > Prepare release > Run workflow** on `main`.
2. Choose `patch`, `minor`, or `major`. The workflow bumps both package manifests
   and opens a release PR; it does not merge it.
3. Review the PR, wait for required CI, and merge it. **Tag merged release**
   verifies the merged commit and creates its version tag using the App.
4. The tag triggers **Release**, which builds all six executables, uploads them
   to a draft, and publishes only after all uploads succeed.

The tag workflow also handles manually prepared version PRs. It ignores
dependency-only manifest changes when the package version is unchanged.
Do not also push a manual tag for a version handled by automation.

### One-time GitHub App setup

1. In your personal GitHub **Settings > Developer settings > GitHub Apps**, create
   an App (choose a unique name). Set its homepage to this repository, disable
   webhooks, and limit installation to your account.
2. Grant repository permissions **Contents: Read and write** and
   **Pull requests: Read and write**. No administration, workflow-editing,
   or account permissions are required.
3. Install the App on **only this repository**.
4. Generate a private key. Under this repository's
   **Settings > Environments > release**, add (create the environment if needed):
   - Variable `RELEASE_APP_CLIENT_ID`: the App's Client ID.
   - Secret `RELEASE_APP_PRIVATE_KEY`: the complete downloaded PEM private key.
   Never commit the key or paste it into logs, issues, or PRs.
   Preparation, tagging, and publishing jobs use this environment. Its deployment
   rules must allow `main` for preparation/tagging and version tags for
   publishing. Any required environment approval applies to each of these jobs;
   do not require approval by another person if you maintain the repository alone.
5. Add the installed App to the **Release tag creation** ruleset bypass list
   with **Always allow**. Do **not** add it to the branch ruleset or
   **Protect existing release tags**. If the App is not available in the
   bypass selector, stop and resolve installation/ruleset support before running.

The App is necessary because PRs and tag pushes created with the default
`GITHUB_TOKEN` do not trigger normal follow-up workflows. Tokens here are
repository-scoped, permission-limited, and revoked after each job. Preparation
only runs from `main`; tagging only runs on manifest changes pushed to `main`.
Keep required PR checks enabled and review release workflow edits carefully.
The App key is powerful: anyone able to modify trusted workflows could misuse
its granted access.

### Manual fallback

Use this only when automatic tagging is not active (for example, before App
setup). Otherwise merge the version PR and let automation create the tag.

1. Create a release branch from up-to-date `main`.
2. Update the version without automatically committing or creating a tag:

```sh
npm version patch --no-git-tag-version   # or: minor, major
```

3. Commit both `package.json` and `package-lock.json`, push the release branch,
   and open a pull request. Let the required checks and reviews complete,
   then merge it into `main`.
4. With a clean working tree, check out `main`, fast-forward to the merged
   commit, and confirm its CI checks passed. Create the tag from that commit:

```powershell
git switch main
git pull --ff-only origin main
$tag = "v$(node -p "require('./package.json').version")"
git tag -a $tag -m "Release $tag"
git push origin $tag
```

Only an authorized release maintainer can push release tags. Do not reuse,
move, or delete an existing release tag; publish a new version for corrections.
Tag the merged commit, not the pre-merge branch commit, especially when using
squash or rebase merging.

The workflow verifies that the
tag matches `package.json`, runs the tests and type-check, builds a standalone
executable for each supported platform, and then creates a draft GitHub Release
with the executables attached and automatically generated release notes. Only
after all uploads succeed does it publish the release. This supports immutable
releases: assets cannot be added or replaced after publication.

If uploading fails, the release stays as a draft. Inspect its assets before
recovering; the creation step does not overwrite or resume an existing draft.
If the tag job fails before creating a tag, fix the configuration and rerun
that failed job. Existing tags are never overwritten; do not rerun tag creation
after it succeeds. Retry failed build jobs in the existing Release run instead.
Once published as immutable, corrections require a new version and tag.
The GitHub CLI uses these release assets when users run
`gh extension install LuanErasmus/gh-action-inspector`.

Please avoid including credentials, tokens, or other sensitive information in
code, issues, or pull requests.

## Reporting security issues

Do not report security vulnerabilities in public issues or pull requests.
Follow the private reporting instructions in [SECURITY.md](SECURITY.md).
