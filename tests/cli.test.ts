import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";
import type { CommitComparisonStatus } from "../src/compare-commits.js";
import { NoReleaseError } from "../src/latest-release.js";

const resolved = {
  sha: "a".repeat(40),
  refType: "tag" as const,
};
const latestSha = "c".repeat(40);
const metadata = {
  fullName: "actions/checkout",
  license: { name: "MIT License", spdxId: "MIT" },
  archived: false,
};
const latestRelease = {
  tagName: "v6.0.0",
  releaseNotesUrl: "https://github.com/actions/checkout/releases/tag/v6.0.0",
};

type Dependencies = NonNullable<Parameters<typeof runCli>[2]>;

const row = (label: string, value: string) => `  ${label.padEnd(15)}${value}`;

async function run(
  args: string[],
  overrides: Partial<Dependencies> = {},
  options: { color?: boolean; width?: number; status?: (message: string | null) => void } = {},
) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const exitCode = await runCli(
    args,
    {
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message),
      ...options,
    },
    {
      resolve: async (action) =>
        action.ref === latestRelease.tagName
          ? { sha: latestSha, refType: "tag" }
          : resolved,
      getMetadata: async () => metadata,
      getLatestRelease: async () => latestRelease,
      findVersionTag: async () => "v4.2.2",
      compareCommits: async () => "ahead",
      ...overrides,
    },
  );
  return { exitCode, stdout, stderr };
}

describe("action-inspector CLI", () => {
  it("does not apply text wrapping or colors to JSON output", async () => {
    const plain = await run(["actions/checkout@v4", "--json"]);
    const narrow = await run(["actions/checkout@v4", "--json"], {}, { width: 20, color: true });
    expect(narrow).toEqual(plain);
  });
  const actionDetails = {
    path: "action.yml", sha: resolved.sha, name: "Example", runtime: "node20",
    inputs: { token: { required: true, description: "API token" } },
    outputs: { result: { description: "Result" } },
  };

  it("shows Action runtime, inputs, and outputs with --details", async () => {
    const result = await run(["actions/checkout@v4", "--details"], {
      inspectAction: async () => actionDetails,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.join("\n")).toContain("Runtime: node20");
    expect(result.stdout.join("\n")).toMatch(/\| token\s*\| Yes\s*\|/);
    expect(result.stdout.join("\n")).toContain("Output result\n    Result");
  });

  it("preserves commit inspection when the repository has no releases", async () => {
    const result = await run(["actions/checkout@v4", "--json"], {
      getLatestRelease: async () => { throw new NoReleaseError("No published release"); },
    });
    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout[0]);
    expect(report.latestRelease).toBeNull();
    expect(report.warning).toBe("No published release");
    expect(report.reference.sha).toBe(resolved.sha);
  });

  it("compares Action metadata and reports required manual review", async () => {
    const result = await run(["compare", "actions/checkout@v4", "actions/checkout@v6.0.0", "--json"], {
      inspectAction: async (_action, sha) => ({
        ...actionDetails, sha, runtime: sha === latestSha ? "node24" : "node20",
      }),
    });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout[0]).comparison).toMatchObject({
      runtimeChanged: true, runtimeBefore: "node20", runtimeAfter: "node24",
      notice: expect.stringContaining("cannot guarantee compatibility"),
    });
  });

  it("refuses to compare unrelated Actions", async () => {
    const result = await run(["compare", "owner/first@v1", "owner/second@v2"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr[0]).toContain("same Action");
  });
  it("prints details, the resolved version, and the latest release", async () => {
    await expect(run(["actions/checkout@v4"])).resolves.toEqual({
      exitCode: 0,
      stdout: [
        "actions/checkout@v4",
        "",
        "Reference",
        row("Type", "tag"),
        row("Commit SHA", resolved.sha),
        row("Version", "v4.2.2"),
        row("Immutable", "No (a tag can be moved)"),
        row("SHA-pinned", `actions/checkout@${resolved.sha} # v4.2.2`),
        "",
        "Repository",
        row("Name", "actions/checkout"),
        row("License", "MIT"),
        row("Archived", "No"),
        "",
        "Latest release",
        row("Version", "v6.0.0"),
        row("Newer version", "Yes (v4.2.2 → v6.0.0)"),
        row("Release notes", latestRelease.releaseNotesUrl),
        "",
        "Pin to latest release",
        `  uses: actions/checkout@${latestSha} # v6.0.0`,
      ],
      stderr: [],
    });
  });

  it("resolves a SHA reference to its version and reports newer releases", async () => {
    const sha = "b".repeat(40);
    const calls: string[] = [];
    const result = await run([`actions/checkout@${sha}`], {
      resolve: async (action) =>
        action.ref === sha
          ? { sha, refType: "sha" }
          : { sha: latestSha, refType: "tag" },
      findVersionTag: async (_repository, commitSha) => {
        calls.push(`tag:${commitSha}`);
        return "v4.1.0";
      },
      compareCommits: async (_repository, base, head) => {
        calls.push(`compare:${base}...${head}`);
        return "ahead";
      },
      getMetadata: async () => ({
        fullName: "actions/checkout",
        license: null,
        archived: true,
      }),
    });

    expect(calls).toEqual([`tag:${sha}`]);
    expect(result).toEqual({
      exitCode: 0,
      stdout: [
        `actions/checkout@${sha}`,
        "",
        "Reference",
        row("Type", "sha"),
        row("Commit SHA", sha),
        row("Version", "v4.1.0"),
        row("Immutable", "Yes"),
        row("SHA-pinned", `actions/checkout@${sha} # v4.1.0`),
        "",
        "Repository",
        row("Name", "actions/checkout"),
        row("License", "Not detected"),
        row("Archived", "Yes (no longer maintained)"),
        "",
        "Latest release",
        row("Version", "v6.0.0"),
        row("Newer version", "Yes (v4.1.0 → v6.0.0)"),
        row("Release notes", latestRelease.releaseNotesUrl),
        "",
        "Pin to latest release",
        `  uses: actions/checkout@${latestSha} # v6.0.0`,
      ],
      stderr: [],
    });
  });

  it.each<{ status: CommitComparisonStatus; expected: string }>([
    { status: "identical", expected: "No" },
    { status: "behind", expected: "No" },
    { status: "ahead", expected: "Yes (main → v6.0.0)" },
    { status: "diverged", expected: "Yes (main → v6.0.0)" },
  ])("uses commit comparison when no version tag is known and the latest release is $status", async ({ status, expected }) => {
    const { stdout } = await run(["actions/checkout@main"], {
      findVersionTag: async () => null,
      compareCommits: async () => status,
    });
    expect(stdout).toContain(row("Newer version", expected));
  });

  it.each([
    { version: "v3.39.1", latest: "v4.39.1", expected: "Yes (v3.39.1 → v4.39.1)" },
    { version: "v4.39.1", latest: "v4.39.1", expected: "No" },
    { version: "v4.10.0", latest: "v4.9.0", expected: "No" },
  ])("compares version numbers ($version vs $latest) instead of commits", async ({ version, latest, expected }) => {
    const { stdout } = await run(["github/codeql-action/analyze@v3"], {
      getLatestRelease: async () => ({ ...latestRelease, tagName: latest }),
      findVersionTag: async () => version,
      compareCommits: async () => {
        throw new Error("commit comparison should not be used");
      },
    });
    expect(stdout).toContain(row("Newer version", expected));
  });

  it("reports when no tag points to the resolved commit", async () => {
    const { stdout } = await run(["actions/checkout@main"], {
      resolve: async (action) =>
        action.ref === latestRelease.tagName
          ? { sha: latestSha, refType: "tag" }
          : { sha: resolved.sha, refType: "branch" },
      findVersionTag: async () => null,
    });
    expect(stdout).toEqual(
      expect.arrayContaining([
        row("Version", "Not found (no tag points to this commit)"),
        row("Immutable", "No (a branch can be moved)"),
        row("SHA-pinned", `actions/checkout@${resolved.sha}`),
        row("Newer version", "Yes (main → v6.0.0)"),
      ]),
    );
  });

  it("expands a short SHA to a full SHA-pinned reference", async () => {
    const { exitCode, stdout } = await run(["actions/checkout@aaaaaaa"], {
      resolve: async (action) =>
        action.ref === latestRelease.tagName
          ? { sha: latestSha, refType: "tag" }
          : { sha: resolved.sha, refType: "short-sha" },
    });
    expect(exitCode).toBe(0);
    expect(stdout).toEqual(
      expect.arrayContaining([
        "actions/checkout@aaaaaaa",
        row("Type", "short SHA"),
        row("Commit SHA", resolved.sha),
        row("Immutable", "No (short SHAs can't be used in uses:, pin the full SHA)"),
        row("SHA-pinned", `actions/checkout@${resolved.sha} # v4.2.2`),
      ]),
    );
  });

  it("prints a nested action path", async () => {
    const { exitCode, stdout } = await run(
      ["owner/repository/path/to/action@main"],
      { getMetadata: async () => ({ ...metadata, fullName: "owner/repository" }) },
    );
    expect(exitCode).toBe(0);
    expect(stdout[0]).toBe("owner/repository/path/to/action@main");
    expect(stdout).toContain(
      `  uses: owner/repository/path/to/action@${latestSha} # v6.0.0`,
    );
  });

  it("prints a JSON report with --json", async () => {
    const { exitCode, stdout, stderr } = await run(["--json", "actions/checkout@v4"]);
    expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: [] });
    expect(stdout).toHaveLength(1);
    expect(JSON.parse(stdout[0])).toEqual({
      action: "actions/checkout",
      repository: "actions/checkout",
      reference: {
        original: "v4",
        type: "tag",
        sha: resolved.sha,
        version: "v4.2.2",
        immutable: false,
        pinned: `actions/checkout@${resolved.sha} # v4.2.2`,
      },
      license: "MIT",
      archived: false,
      latestRelease: {
        version: "v6.0.0",
        sha: latestSha,
        releaseNotesUrl: latestRelease.releaseNotesUrl,
        newerAvailable: true,
        pinned: `actions/checkout@${latestSha} # v6.0.0`,
      },
    });
  });

  it("adds colors and status icons when color is enabled", async () => {
    const { stdout } = await run(["actions/checkout@v4"], {}, { color: true });
    const output = stdout.join("\n");
    expect(output).toContain("\x1b[");
    expect(output).toContain("! No (a tag can be moved)");
    expect(output).toContain("✓ No");
    expect(output.replace(/\x1b\[[0-9;]*m/g, "")).toContain(
      `uses: actions/checkout@${latestSha} # v6.0.0`,
    );
  });

  it.each([
    { description: "success", overrides: {} },
    {
      description: "failure",
      overrides: {
        resolve: async () => {
          throw new Error("boom");
        },
      },
    },
  ])("shows and clears a progress status on $description", async ({ overrides }) => {
    const statuses: (string | null)[] = [];
    await run(["actions/checkout@v4"], overrides, {
      status: (message) => statuses.push(message),
    });
    expect(statuses).toEqual(["Inspecting actions/checkout@v4…", null]);
  });

  it.each([["--help"], ["-h"]])("prints usage for %s", async (flag) => {
    const result = await run([flag]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toEqual([]);
    const text = result.stdout.join("\n");
    for (const section of ["GitHub Action Inspector", "Usage", "Commands", "Options", "Examples", "Safety", "Command help"]) {
      expect(text).toContain(section);
    }
    expect(text).toContain("--details");
    expect(text).toContain("--no-cache");
    expect(text).toContain("Only --write modifies files.");
  });

  it.each(["scan", "pin", "upgrade", "compare"])("shows focused help for %s", async (command) => {
    const result = await run([command, "--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toEqual([]);
    const text = result.stdout.join("\n");
    for (const section of ["Usage", "Arguments", "Options", "Examples"]) expect(text).toContain(section);
    expect(text).toContain(`action-inspector ${command}`);
    expect(text).toContain("--no-cache");
    if (command === "upgrade") {
      expect(text).toContain("default: minor");
      expect(text).toContain("minor                 Stay within the current major");
      expect(text).toContain("major                 Upgrade to the next major only");
      expect(text).toContain("latest                Allow upgrades to newer major versions");
    }
  });

  it("wraps help to narrow terminals and keeps colored text equivalent", async () => {
    const plain = await run(["--help"], {}, { width: 40 });
    const colored = await run(["--help"], {}, { width: 40, color: true });
    expect(plain.stdout[0].split("\n").every((line) => line.length <= 40)).toBe(true);
    expect(colored.stdout[0].replace(/\x1b\[[0-9;]*m/g, "")).toBe(plain.stdout[0]);
  });

  it.each([
    { description: "no arguments", args: [] },
    { description: "multiple arguments", args: ["actions/checkout@v6", "extra"] },
    { description: "an unknown option", args: ["--verbose", "actions/checkout@v6"] },
  ])("shows usage and fails when given $description", async ({ args }) => {
    await expect(run(args)).resolves.toEqual({
      exitCode: 1,
      stdout: [],
      stderr: ["Usage: action-inspector [--json] <owner/repository[/path]@ref>"],
    });
  });

  it("reports invalid references and exits unsuccessfully", async () => {
    await expect(run(["actions/checkout"])).resolves.toEqual({
      exitCode: 1,
      stdout: [],
      stderr: [
        "Action reference must include a ref after '@' (for example, actions/checkout@v4).",
      ],
    });
  });

  it.each<{ description: string; overrides: Partial<Dependencies>; message: string }>([
    {
      description: "resolution",
      overrides: {
        resolve: async () => {
          throw new Error('Could not find repository actions/checkout or ref "v6".');
        },
      },
      message: 'Could not find repository actions/checkout or ref "v6".',
    },
    {
      description: "metadata",
      overrides: {
        getMetadata: async () => {
          throw new Error("GitHub API request failed with HTTP 403.");
        },
      },
      message: "GitHub API request failed with HTTP 403.",
    },
    {
      description: "latest release",
      overrides: {
        getLatestRelease: async () => {
          throw new Error("No latest published release was found for actions/checkout.");
        },
      },
      message: "No latest published release was found for actions/checkout.",
    },
    {
      description: "version lookup",
      overrides: {
        findVersionTag: async () => {
          throw new Error("GitHub API returned an invalid tag list.");
        },
      },
      message: "GitHub API returned an invalid tag list.",
    },
    {
      description: "commit comparison",
      overrides: {
        findVersionTag: async () => null,
        compareCommits: async () => {
          throw new Error("GitHub API request failed with HTTP 404.");
        },
      },
      message: "GitHub API request failed with HTTP 404.",
    },
  ])("reports $description errors without printing partial output", async ({ overrides, message }) => {
    await expect(run(["actions/checkout@v6"], overrides)).resolves.toEqual({
      exitCode: 1,
      stdout: [],
      stderr: [message],
    });
  });
});
