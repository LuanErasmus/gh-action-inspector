import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";
import type { CommitComparisonStatus } from "../src/compare-commits.js";

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

async function run(args: string[], overrides: Partial<Dependencies> = {}) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const exitCode = await runCli(
    args,
    {
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message),
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
  it("prints details, the resolved version, and the latest release", async () => {
    await expect(run(["actions/checkout@v4"])).resolves.toEqual({
      exitCode: 0,
      stdout: [
        "Repository: actions/checkout",
        "Original reference: v4",
        "Reference type: tag",
        `Resolved commit SHA: ${resolved.sha}`,
        "Resolved version: v4.2.2",
        `Current SHA-pinned equivalent: actions/checkout@${resolved.sha}`,
        "License: MIT",
        "Archived: No",
        "Immutable: No",
        "Latest release: v6.0.0",
        `Release notes: ${latestRelease.releaseNotesUrl}`,
        "Newer version available: Yes (v6.0.0)",
        `Latest SHA-pinned release: actions/checkout@${latestSha} # v6.0.0`,
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

    expect(calls).toEqual([`tag:${sha}`, `compare:${sha}...${latestSha}`]);
    expect(result).toEqual({
      exitCode: 0,
      stdout: [
        "Repository: actions/checkout",
        `Original reference: ${sha}`,
        "Reference type: sha",
        `Resolved commit SHA: ${sha}`,
        "Resolved version: v4.1.0",
        `Current SHA-pinned equivalent: actions/checkout@${sha}`,
        "License: Not detected",
        "Archived: Yes",
        "Immutable: Yes",
        "Latest release: v6.0.0",
        `Release notes: ${latestRelease.releaseNotesUrl}`,
        "Newer version available: Yes (v6.0.0)",
        `Latest SHA-pinned release: actions/checkout@${latestSha} # v6.0.0`,
      ],
      stderr: [],
    });
  });

  it.each<{ status: CommitComparisonStatus; expected: string }>([
    { status: "identical", expected: "No" },
    { status: "behind", expected: "No" },
    { status: "ahead", expected: "Yes (v6.0.0)" },
    { status: "diverged", expected: "Yes (v6.0.0)" },
  ])("reports newer version availability when the latest release is $status", async ({ status, expected }) => {
    const { stdout } = await run(["actions/checkout@v4"], {
      compareCommits: async () => status,
    });
    expect(stdout).toContain(`Newer version available: ${expected}`);
  });

  it("reports when no tag points to the resolved commit", async () => {
    const { stdout } = await run(["actions/checkout@main"], {
      findVersionTag: async () => null,
    });
    expect(stdout).toContain(
      "Resolved version: Not found (no tag points to this commit)",
    );
  });

  it("prints a nested action path", async () => {
    const { exitCode, stdout } = await run(
      ["owner/repository/path/to/action@main"],
      { getMetadata: async () => ({ ...metadata, fullName: "owner/repository" }) },
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain(
      `Latest SHA-pinned release: owner/repository/path/to/action@${latestSha} # v6.0.0`,
    );
  });

  it.each([
    { description: "no arguments", args: [] },
    { description: "multiple arguments", args: ["actions/checkout@v6", "extra"] },
  ])("shows usage and fails when given $description", async ({ args }) => {
    await expect(run(args)).resolves.toEqual({
      exitCode: 1,
      stdout: [],
      stderr: ["Usage: action-inspector <owner/repository[/path]@ref>"],
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
