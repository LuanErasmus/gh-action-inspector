import { describe, expect, it } from "vitest";
import {
  compareActionDetails,
  inspectAction,
  inspectReusableWorkflow,
  type ActionDetails,
} from "../src/action-details.js";
import type { ParsedActionReference } from "../src/parse-reference.js";

const reference: ParsedActionReference = {
  owner: "octo",
  repository: "action",
  ref: "v1",
};
const sha = "a".repeat(40);

function contents(source: string): Response {
  return new Response(
    JSON.stringify({
      type: "file",
      encoding: "base64",
      content: Buffer.from(source, "utf8").toString("base64"),
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function failure(status: number): Response {
  return new Response(JSON.stringify({ message: "failure" }), { status });
}

describe("inspectAction", () => {
  it("reads action.yml at the exact commit and parses typed metadata", async () => {
    const urls: string[] = [];
    const result = await inspectAction(reference, sha, {
      fetch: async (input) => {
        urls.push(String(input));
        return contents(
          [
            "name: Example",
            "description: An action",
            "inputs:",
            "  token:",
            "    description: API token",
            "    required: true",
            "    default: supplied",
            "    deprecationMessage: Use credential instead",
            "  optional:",
            "    required: false",
            "outputs:",
            "  result:",
            "    description: Result value",
            "runs:",
            "  using: node20",
            "  main: index.js",
          ].join("\n"),
        );
      },
    });

    expect(urls).toEqual([
      `https://api.github.com/repos/octo/action/contents/action.yml?ref=${sha}`,
    ]);
    expect(result).toEqual({
      path: "action.yml",
      sha,
      name: "Example",
      description: "An action",
      runtime: "node20",
      inputs: {
        token: {
          description: "API token",
          required: true,
          default: "supplied",
          deprecationMessage: "Use credential instead",
        },
        optional: { required: false },
      },
      outputs: { result: { description: "Result value" } },
    });
  });

  it("reads action.yaml after and only after an action.yml 404", async () => {
    const urls: string[] = [];
    const result = await inspectAction({ ...reference, path: "nested/action" }, sha, {
      fetch: async (input) => {
        urls.push(String(input));
        return urls.length === 1
          ? failure(404)
          : contents("runs:\n  using: composite\ninputs:\n  enabled:\n    default: 'false'\n");
      },
    });

    expect(urls).toEqual([
      `https://api.github.com/repos/octo/action/contents/nested/action/action.yml?ref=${sha}`,
      `https://api.github.com/repos/octo/action/contents/nested/action/action.yaml?ref=${sha}`,
    ]);
    expect(result).toEqual({
      path: "nested/action/action.yaml",
      sha,
      runtime: "composite",
      inputs: { enabled: { required: false, default: "false" } },
      outputs: {},
    });
  });

  it("does not fallback for non-404 errors or invalid first-file data", async () => {
    let calls = 0;
    await expect(
      inspectAction(reference, sha, {
        fetch: async () => {
          calls += 1;
          return failure(403);
        },
      }),
    ).rejects.toThrow("HTTP 403");
    expect(calls).toBe(1);

    await expect(
      inspectAction(reference, sha, {
        fetch: async () => contents("runs:\n  using: node20\n"),
      }),
    ).resolves.toMatchObject({ runtime: "node20" });
  });

  it("reports missing metadata when both supported names return 404", async () => {
    await expect(
      inspectAction(reference, sha, { fetch: async () => failure(404) }),
    ).rejects.toThrow(`No action.yml or action.yaml found at "." in octo/action at ${sha}.`);
  });

  it("rejects reusable workflow paths without requesting action metadata", async () => {
    let calls = 0;
    await expect(
      inspectAction(
        { ...reference, path: ".github/workflows/release.yml" },
        sha,
        {
          fetch: async () => {
            calls += 1;
            return failure(404);
          },
        },
      ),
    ).rejects.toThrow('is a reusable workflow, not action metadata');
    expect(calls).toBe(0);
  });

  it.each([
    ["not yaml: [", /Could not parse action metadata/],
    ["- item", /must contain a YAML mapping/],
    ["runs: []", /must define a runs mapping/],
    ["runs:\n  using: 3", /runs\.using as a non-empty string/],
    ["runs:\n  using: node20\ninputs: []", /inputs.*must be a mapping/],
    ["runs:\n  using: node20\ninputs:\n  x:\n    required: yes", /required.*boolean/],
    ["runs:\n  using: node20\ninputs:\n  x:\n    default: []", /default.*must be a scalar/],
    ["runs:\n  using: node20\noutputs:\n  x: []", /Action output.*must be a mapping/],
  ])("rejects malformed metadata %s", async (source, error) => {
    await expect(
      inspectAction(reference, sha, { fetch: async () => contents(source) }),
    ).rejects.toThrow(error);
  });

  it("rejects invalid contents API responses and malformed base64", async () => {
    await expect(
      inspectAction(reference, sha, {
        fetch: async () =>
          new Response(JSON.stringify({ type: "dir", encoding: "none", content: "" })),
      }),
    ).rejects.toThrow(/expected a base64-encoded file/);
    await expect(
      inspectAction(reference, sha, {
        fetch: async () =>
          new Response(
            JSON.stringify({ type: "file", encoding: "base64", content: "***" }),
          ),
      }),
    ).rejects.toThrow(/invalid base64 content/);
  });
});

describe("inspectReusableWorkflow", () => {
  const workflow = { ...reference, path: ".github/workflows/build.yml" };
  it.each([
    "on: workflow_call\njobs: {}",
    "on: [push, workflow_call]\njobs: {}",
    "on:\n  workflow_call:\njobs: {}",
  ])("verifies the target workflow is callable (%s)", async (source) => {
    const urls: string[] = [];
    await expect(inspectReusableWorkflow(workflow, sha, {
      fetch: async (url) => {
        urls.push(String(url));
        return contents(source);
      },
    })).resolves.toBeUndefined();
    expect(urls[0]).toContain(`.github/workflows/build.yml?ref=${sha}`);
  });

  it("rejects workflows without workflow_call or jobs", async () => {
    await expect(inspectReusableWorkflow(workflow, sha, {
      fetch: async () => contents("on: push\njobs: {}"),
    })).rejects.toThrow("does not declare on.workflow_call");
    await expect(inspectReusableWorkflow(workflow, sha, {
      fetch: async () => contents("on: workflow_call"),
    })).rejects.toThrow("jobs mapping");
  });
});

describe("compareActionDetails", () => {
  it("accepts boolean and numeric defaults as string values like GitHub Actions", async () => {
    const result = await inspectAction(
      { owner: "owner", repository: "repo", ref: "v1" },
      "a".repeat(40),
      { fetch: async () => contents("runs:\n  using: node24\ninputs:\n  flag:\n    default: true\n  count:\n    default: 42\n  empty:\n    default:\n") },
    );
    expect(result.inputs.flag.default).toBe("true");
    expect(result.inputs.count.default).toBe("42");
    expect(result.inputs.empty.default).toBe("");
  });
  const base: ActionDetails = {
    path: "action.yml",
    sha: "1",
    runtime: "node20",
    inputs: {
      keep: { required: false, default: "old" },
      remove: { required: false },
      deprecate: { required: false },
    },
    outputs: { result: {}, gone: {} },
  };

  it("reports compatibility-relevant metadata changes and manual review notice", () => {
    const after: ActionDetails = {
      path: "action.yaml",
      sha: "2",
      runtime: "node24",
      inputs: {
        keep: { required: true, default: "new" },
        added: { required: true },
        addedWithDefault: { required: true, default: "yes" },
        deprecate: {
          required: false,
          deprecationMessage: "Use another input.",
        },
      },
      outputs: { result: {} },
    };

    expect(compareActionDetails(base, after)).toEqual({
      runtimeChanged: true,
      runtimeBefore: "node20",
      runtimeAfter: "node24",
      addedRequiredInputsWithoutDefaults: ["added"],
      newlyRequiredInputsWithoutDefaults: [],
      removedInputs: ["remove"],
      removedOutputs: ["gone"],
      changedDefaults: [{ input: "keep", before: "old", after: "new" }],
      deprecatedInputs: [
        { input: "deprecate", deprecationMessage: "Use another input." },
      ],
      notice:
        "Runtime and metadata comparison cannot guarantee compatibility; review the action's release notes manually.",
    });
  });

  it("reports runtime unchanged and default removal", () => {
    const after = {
      ...base,
      sha: "2",
      inputs: {
        ...base.inputs,
        keep: { required: false },
      },
    };
    expect(compareActionDetails(base, after)).toMatchObject({
      runtimeChanged: false,
      changedDefaults: [{ input: "keep", before: "old" }],
      addedRequiredInputsWithoutDefaults: [],
      removedInputs: [],
      removedOutputs: [],
      deprecatedInputs: [],
    });

  });

  it("reports an existing optional input becoming required without a default", () => {
    const after = { ...base, inputs: { ...base.inputs, keep: { required: true } } };
    expect(compareActionDetails(base, after).newlyRequiredInputsWithoutDefaults).toEqual(["keep"]);
  });
});
