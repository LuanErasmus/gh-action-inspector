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
