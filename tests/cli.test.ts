import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";

const resolved = {
  sha: "a".repeat(40),
  refType: "tag" as const,
};
const metadata = {
  fullName: "actions/checkout",
  license: { name: "MIT License", spdxId: "MIT" },
  archived: false,
};
const latestRelease = {
  tagName: "v6.0.0",
  releaseNotesUrl: "https://github.com/actions/checkout/releases/tag/v6.0.0",
};

function run(args: string[], repositoryMetadata = metadata) {
  const stdout: string[] = [];
  const stderr: string[] = [];

  return runCli(
    args,
    {
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message),
    },
    {
      resolve: async () => resolved,
      getMetadata: async () => repositoryMetadata,
      getLatestRelease: async () => latestRelease,
    },
  ).then((exitCode) => ({ exitCode, stdout, stderr }));
}

describe("action-inspector CLI", () => {
  it("prints repository details, resolution, and the latest suggested version", async () => {
    await expect(run(["actions/checkout@v6"])).resolves.toEqual({
      exitCode: 0,
      stdout: [
        "Repository: actions/checkout",
        "Original reference: v6",
        "Reference type: tag",
        `Resolved commit SHA: ${resolved.sha}`,
        `Current SHA-pinned equivalent: actions/checkout@${resolved.sha}`,
        "License: MIT",
        "Archived: No",
        "Immutable: No",
        "Latest release: v6.0.0",
        `Release notes: ${latestRelease.releaseNotesUrl}`,
        `Latest SHA-pinned release: actions/checkout@${resolved.sha} # v6.0.0`,
      ],
      stderr: [],
    });
  });

  it("uses the latest release tag and SHA for the suggestion and links its notes", async () => {
    const latestSha = "c".repeat(40);
    const stdout: string[] = [];
    const stderr: string[] = [];
    const resolve = async (action: { ref: string }) =>
      action.ref === "v4" ? resolved : { sha: latestSha, refType: "tag" as const };
    const exitCode = await runCli(
      ["actions/checkout@v4"],
      {
        stdout: (message) => stdout.push(message),
        stderr: (message) => stderr.push(message),
      },
      {
        resolve,
        getMetadata: async () => metadata,
        getLatestRelease: async () => latestRelease,
      },
    );

    expect({ exitCode, stdout, stderr }).toEqual({
      exitCode: 0,
      stdout: [
        "Repository: actions/checkout",
        "Original reference: v4",
        "Reference type: tag",
        `Resolved commit SHA: ${resolved.sha}`,
        `Current SHA-pinned equivalent: actions/checkout@${resolved.sha}`,
        "License: MIT",
        "Archived: No",
        "Immutable: No",
        "Latest release: v6.0.0",
        `Release notes: ${latestRelease.releaseNotesUrl}`,
        `Latest SHA-pinned release: actions/checkout@${latestSha} # v6.0.0`,
      ],
      stderr: [],
    });
  });

  it("prints a nested action path", async () => {
    await expect(
      run(["owner/repository/path/to/action@main"], {
        ...metadata,
        fullName: "owner/repository",
      }),
    ).resolves.toEqual({
      exitCode: 0,
      stdout: [
        "Repository: owner/repository",
        "Original reference: main",
        "Reference type: tag",
        `Resolved commit SHA: ${resolved.sha}`,
        `Current SHA-pinned equivalent: owner/repository@${resolved.sha}`,
        "License: MIT",
        "Archived: No",
        "Immutable: No",
        "Latest release: v6.0.0",
        `Release notes: ${latestRelease.releaseNotesUrl}`,
        `Latest SHA-pinned release: owner/repository/path/to/action@${resolved.sha} # v6.0.0`,
      ],
      stderr: [],
    });
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

  it("reports resolution errors without printing partial output", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const exitCode = await runCli(
      ["actions/checkout@v6"],
      {
        stdout: (message) => stdout.push(message),
        stderr: (message) => stderr.push(message),
      },
      {
        resolve: async () => {
          throw new Error('Could not find repository actions/checkout or ref "v6".');
        },
        getMetadata: async () => metadata,
        getLatestRelease: async () => latestRelease,
      },
    );

    expect({ exitCode, stdout, stderr }).toEqual({
      exitCode: 1,
      stdout: [],
      stderr: ['Could not find repository actions/checkout or ref "v6".'],
    });
  });

  it("omits a pin suggestion for an immutable SHA and handles missing license", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const sha = "b".repeat(40);
    const exitCode = await runCli(
      [`actions/checkout@${sha}`],
      {
        stdout: (message) => stdout.push(message),
        stderr: (message) => stderr.push(message),
      },
      {
        resolve: async () => ({ sha, refType: "sha" }),
        getMetadata: async () => ({
          fullName: "actions/checkout",
          license: null,
          archived: true,
        }),
        getLatestRelease: async () => latestRelease,
      },
    );

    expect({ exitCode, stdout, stderr }).toEqual({
      exitCode: 0,
      stdout: [
        "Repository: actions/checkout",
        `Original reference: ${sha}`,
        "Reference type: sha",
        `Resolved commit SHA: ${sha}`,
        `Current SHA-pinned equivalent: actions/checkout@${sha}`,
        "License: Not detected",
        "Archived: Yes",
        "Immutable: Yes",
      ],
      stderr: [],
    });
  });

  it("reports metadata errors without printing partial output", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const exitCode = await runCli(
      ["actions/checkout@v6"],
      {
        stdout: (message) => stdout.push(message),
        stderr: (message) => stderr.push(message),
      },
      {
        resolve: async () => resolved,
        getMetadata: async () => {
          throw new Error("GitHub API request failed with HTTP 403.");
        },
        getLatestRelease: async () => latestRelease,
      },
    );

    expect({ exitCode, stdout, stderr }).toEqual({
      exitCode: 1,
      stdout: [],
      stderr: ["GitHub API request failed with HTTP 403."],
    });
  });

  it("reports when no latest published release is available", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const exitCode = await runCli(
      ["actions/checkout@v4"],
      {
        stdout: (message) => stdout.push(message),
        stderr: (message) => stderr.push(message),
      },
      {
        resolve: async () => resolved,
        getMetadata: async () => metadata,
        getLatestRelease: async () => {
          throw new Error("No latest published release was found for actions/checkout.");
        },
      },
    );

    expect({ exitCode, stdout, stderr }).toEqual({
      exitCode: 1,
      stdout: [],
      stderr: ["No latest published release was found for actions/checkout."],
    });
  });
});
