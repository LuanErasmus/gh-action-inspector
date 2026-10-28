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
pushed. Maintainers release from an up-to-date `main` branch:

```sh
npm version patch   # or: minor, major
git push --follow-tags
```

`npm version` updates `package.json` and `package-lock.json`, commits the
change, and creates a matching `vX.Y.Z` tag. The workflow verifies that the
tag matches `package.json`, runs the tests and type-check, builds a standalone
executable for each supported platform, and then creates a GitHub Release with
the executables attached and automatically generated release notes. The GitHub
CLI uses these release assets when users run
`gh extension install LuanErasmus/gh-action-inspector`.

Please avoid including credentials, tokens, or other sensitive information in
code, issues, or pull requests.

## Reporting security issues

Do not report security vulnerabilities in public issues or pull requests.
Follow the private reporting instructions in [SECURITY.md](SECURITY.md).
