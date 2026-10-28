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

The goal is to provide output similar to:

```text
🔍 Inspecting actions/checkout@v4

Action
  Repository       actions/checkout
  Reference        v4
  Reference type   Tag
  Resolved SHA     <resolved-sha>

Repository
  Archived         No
  License          MIT

Reference
  Immutable        No
  Pinned to SHA    No

Suggested
  actions/checkout@<resolved-sha> # v4
```

> Example output is illustrative while Action Inspector is under development.

## 🗺️ Roadmap

### v0.1

- [ ] Parse GitHub Action references
- [ ] Support Actions with subpaths
- [ ] Resolve references to commits
- [ ] Identify tags, branches, and commit SHAs
- [ ] Display basic repository metadata
- [ ] Generate a SHA-pinned reference

### Later

Possible future improvements will be driven by community feedback.

## 🚧 Project Status

Action Inspector is currently under development.

The initial release will focus on inspecting a single GitHub Action reference.

## 🤝 Contributing

Contributions, ideas, bug reports, and documentation improvements are welcome.

Please see [CONTRIBUTING.md](CONTRIBUTING.md) before contributing.

## 🔐 Security

If you discover a security issue in Action Inspector itself, please follow the guidance in [SECURITY.md](SECURITY.md).

## 📄 License

Action Inspector is available under the [MIT License](LICENSE).
