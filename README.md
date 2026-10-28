# 🔍 Action Inspector

**Know what you're running before you add `uses:`.**

GitHub Actions workflows frequently reference external Actions using syntax like:

```yaml
- uses: actions/checkout@v4
```

But what exactly does `v4` point to?

**Action Inspector** is a small open-source tool for inspecting a GitHub Action reference before adding it to your workflow.

The goal is simple:

```bash
action-inspector actions/checkout@v4
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

## 🧪 Example

```bash
action-inspector actions/checkout@v4
```

The command resolves the supplied reference against GitHub, retrieves the
latest published release, and prints repository details, release notes, and a latest suggested version targeting that release:

```text
Repository: actions/checkout
Original reference: v4
Reference type: tag
Resolved commit SHA: <resolved-sha>
License: MIT
Archived: No
Immutable: No
Latest release: v6.0.0
Release notes: https://github.com/actions/checkout/releases/tag/v6.0.0
Latest suggested version: actions/checkout@<latest-release-sha> # v6.0.0
```

## 🗺️ Roadmap

### v0.1

- [x] Parse GitHub Action references
- [x] Support Actions with subpaths
- [x] Resolve references to commits
- [x] Identify tags, branches, and commit SHAs
- [x] Display basic repository metadata
- [x] Generate a SHA-pinned reference

### Later

Possible future improvements will be driven by community feedback.

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

You can then run the parser from any directory:

```bash
action-inspector actions/checkout@v6
```

Run the test suite and TypeScript type check with:

```bash
npm test
npm run typecheck
```

The CLI queries GitHub's REST API. Public repositories can be inspected without
authentication; set `GITHUB_TOKEN` to authenticate and help avoid API rate
limits. References already pinned to a full commit SHA are identified as
immutable and do not receive a latest-release suggestion.

## 🤝 Contributing

Contributions, ideas, bug reports, and documentation improvements are welcome.

Please see [CONTRIBUTING.md](CONTRIBUTING.md) before contributing.

## 🔐 Security

If you discover a security issue in Action Inspector itself, please follow the guidance in [SECURITY.md](SECURITY.md).

## 📄 License

Action Inspector is available under the [MIT License](LICENSE).
