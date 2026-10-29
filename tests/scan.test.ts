import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { discoverWorkflows, formatScan, scanRepository } from "../src/scan.js";
import { runCli, type CliDependencies } from "../src/cli.js";
import { NoReleaseError } from "../src/latest-release.js";

const roots: string[] = [];
const sha = "a".repeat(40);

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "action-inspector-"));
  roots.push(root);
  for (const [file, text] of Object.entries(files)) {
    const path = join(root, ...file.split("/"));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text);
  }
  return root;
}

function dependencies(): CliDependencies {
  return {
    resolve: vi.fn(async (action) => ({
      sha: action.ref === "v2" ? "b".repeat(40) : sha,
      refType: /^[a-f0-9]{40}$/i.test(action.ref) ? "sha" as const : "tag" as const,
    })),
    getMetadata: vi.fn(async () => ({
      fullName: "owner/action", archived: false, license: null,
    })),
    getLatestRelease: vi.fn(async () => ({
      tagName: "v2", releaseNotesUrl: "https://github.com/owner/action/releases/tag/v2",
    })),
    findVersionTag: vi.fn(async () => "v1.0.0"),
    compareCommits: vi.fn(async () => "ahead" as const),
    inspectAction: async (_reference, sha) => ({
      sha, path: "action.yml", runtime: "node24", inputs: {}, outputs: {},
    }),
  };
}

const workflow = (steps: string) => `name: CI
on: push
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
${steps}
`;

describe("workflow discovery", () => {
  it("finds real step references, not comments, scripts, or arbitrary uses keys", async () => {
    const root = await fixture({
      ".github/workflows/ci.yml": workflow(`      # - uses: ignored/comment@v1
      - run: |
          uses: ignored/script@v1
      - uses: 'owner/action@v1' # keep this
      - { uses: "owner/action/nested@v2", with: { test: true } }
      - name: Example
        with: { uses: ignored/input@v1 }
        run: echo ok`),
      ".github/workflows/notes.txt": "not: yaml",
    });
    const result = await discoverWorkflows(root);
    expect(result.errors).toEqual([]);
    expect(result.usages.map(({ reference, line, kind }) => ({ reference, line, kind }))).toEqual([
      { reference: "owner/action@v1", line: 10, kind: "github" },
      { reference: "owner/action/nested@v2", line: 11, kind: "github" },
    ]);
  });

  it("follows reusable workflows and composite actions without looping or duplicating files", async () => {
    const root = await fixture({
      ".github/workflows/ci.yml": `jobs:
  reuse:
    uses: ./.github/workflows/reusable.yaml
  remote:
    uses: owner/repo/.github/workflows/build.yml@v1
`,
      ".github/workflows/reusable.yaml": workflow("      - uses: ./.github/actions/build"),
      ".github/actions/build/action.yaml": `runs:
  using: composite
  steps:
    - uses: owner/action@v1
    - uses: ./.github/actions/build
`,
    });
    const result = await discoverWorkflows(root);
    expect(result.errors).toEqual([]);
    expect(result.files.size).toBe(3);
    expect(result.usages.filter((usage) => usage.kind === "github").map((usage) => usage.reference))
      .toEqual(["owner/repo/.github/workflows/build.yml@v1", "owner/action@v1"]);
  });

  it("classifies local, Docker, and dynamic references explicitly", async () => {
    const root = await fixture({
      ".github/workflows/ci.yml": workflow(`      - uses: docker://alpine:3
      - uses: \${{ matrix.action }}
      - uses: ./missing`),
    });
    const result = await discoverWorkflows(root);
    expect(result.usages.map((usage) => usage.kind)).toEqual(["docker", "expression", "local"]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("ci.yml");
  });

    it("discovers unreferenced nested composites even without workflows", async () => {
      const root = await fixture({
        ".github/actions/group/build/action.yaml": "runs:\n  using: composite\n  steps:\n    - uses: owner/action@v1\n",
        ".github/actions/js/action.yml": "runs:\n  using: node24\n  main: index.js\n",
        ".github/actions/notes.yml": "uses: ignored/example@v1\n",
      });
      const result = await discoverWorkflows(root);
      expect(result.errors).toEqual([]);
      expect(result.usages.map((usage) => usage.reference)).toEqual(["owner/action@v1"]);
      expect(result.usages[0].file).toBe(join(".github", "actions", "group", "build", "action.yaml"));
    });

    it("does not duplicate referenced composites and prefers action.yml over action.yaml", async () => {
      const root = await fixture({
        ".github/workflows/ci.yml": workflow("      - uses: ./.github/actions/build"),
        ".github/actions/build/action.yml": "runs:\n  using: composite\n  steps:\n    - uses: owner/action@v1\n",
        ".github/actions/build/action.yaml": "runs:\n  using: composite\n  steps:\n    - uses: ignored/action@v1\n",
      });
      const result = await discoverWorkflows(root);
      expect(result.errors).toEqual([]);
      expect(result.usages.filter((usage) => usage.kind === "github").map((usage) => usage.reference))
        .toEqual(["owner/action@v1"]);
    });

    it("reports malformed unreferenced metadata without skipping other composites", async () => {
      const root = await fixture({
        ".github/actions/bad/action.yml": "runs: [",
        ".github/actions/good/action.yml": "runs:\n  using: composite\n  steps:\n    - uses: owner/action@v1\n",
      });
      const result = await discoverWorkflows(root);
      expect(result.errors).toHaveLength(1);
      expect(result.usages[0].reference).toBe("owner/action@v1");
    });
  it("refuses references outside the repository", async () => {
    const external = await fixture({ "action.yml": "runs:\n  using: composite\n  steps:\n    - uses: external/action@v1\n" });
    const root = await fixture({
      ".github/workflows/ci.yml": workflow(`      - uses: ./../${basename(external)}`),
    });
    const result = await discoverWorkflows(root);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("escapes the repository");
    expect(result.usages.some((usage) => usage.reference === "external/action@v1")).toBe(false);
  });

  it.each([
    "jobs: [",
    "jobs:\n  x:\n    steps:\n      - uses: owner/action@v1\n        uses: owner/action@v2\n",
    "jobs:\n  x:\n    steps:\n      - uses: [owner/action@v1]\n",
    "jobs:\n  x:\n    steps:\n      - uses: &ref owner/action@v1\n      - uses: *ref\n",
  ])("reports malformed or unsupported YAML rather than silently ignoring it", async (source) => {
    const root = await fixture({ ".github/workflows/ci.yml": source });
    expect((await discoverWorkflows(root)).errors.length).toBeGreaterThan(0);
  });

  it("returns an empty result when there are no workflows", async () => {
    const root = await fixture({});
    const result = await discoverWorkflows(root);
    expect(result.usages).toEqual([]);
    expect(result.errors).toEqual([]);
  });
});

describe("repository scan", () => {
  it("shows scanned files without uses and does not label malformed files as empty", async () => {
    const root = await fixture({
      ".github/workflows/ci.yml": workflow("      - uses: ./.github/actions/local"),
      ".github/actions/local/action.yml": "runs:\n  using: composite\n  steps:\n    - run: echo hello\n      shell: bash\n",
      ".github/actions/bad/action.yml": "runs: [",
      ".github/workflows/scripts.yml": workflow("      - run: echo hello"),
    });
    const report = await scanRepository(root, "scan", dependencies());
    expect(report.filesWithoutUses).toEqual(expect.arrayContaining([
      join(".github", "actions", "local", "action.yml"),
      join(".github", "workflows", "scripts.yml"),
    ]));
    expect(report.filesWithoutUses).not.toContain(join(".github", "actions", "bad", "action.yml"));
    const output = formatScan(report).join("\n");
    expect(output).toContain(`${join(".github", "actions", "local", "action.yml")}\n  No uses found in file.`);
    expect(report.errors).toHaveLength(1);
  });
  it("scans and pins dependencies of an unreferenced local composite", async () => {
    const file = ".github/actions/build/action.yml";
    const source = "runs:\n  using: composite\n  steps:\n    - uses: owner/action@v1\n";
    const root = await fixture({ [file]: source });
    const deps = dependencies();
    const scan = await scanRepository(root, "scan", deps);
    expect(scan.rows[0]).toMatchObject({ reference: "owner/action@v1", status: "Unpinned" });
    const preview = await scanRepository(root, "pin", deps);
    expect(preview.changes[0].after).toContain(`owner/action@${sha}`);
    expect(await readFile(join(root, file), "utf8")).toBe(source);
    await scanRepository(root, "pin", deps, { write: true });
    expect(await readFile(join(root, file), "utf8")).toContain(`owner/action@${sha}`);
  });
  it("reports locations, current version, pin status, latest version, and updates", async () => {
    const root = await fixture({
      ".github/workflows/ci.yml": workflow(`      - uses: owner/action@v1
      - uses: owner/action@${sha}`),
    });
    const deps = dependencies();
    const report = await scanRepository(root, "scan", deps);
    expect(report.rows).toEqual([
      expect.objectContaining({
        line: 7, reference: "owner/action@v1", version: "v1.0.0", sha,
        status: "Unpinned", latest: "v2", newerAvailable: true,
      }),
      expect.objectContaining({ status: "Pinned" }),
    ]);
    expect(deps.getLatestRelease).toHaveBeenCalledTimes(1);
    expect(deps.getMetadata).toHaveBeenCalledTimes(1);
    const output = formatScan(report).join("\n");
    for (const text of ["ci.yml", "L7", "owner/action@v1", "Unpinned", "Available", "v2"]) {
      expect(output).toContain(text);
    }
  });

  it("deduplicates API lookups but retains each occurrence", async () => {
    const root = await fixture({
      ".github/workflows/ci.yml": workflow(`      - uses: owner/action@v1
      - uses: owner/action@v1`),
    });
    const deps = dependencies();
    const report = await scanRepository(root, "scan", deps);
    expect(report.rows).toHaveLength(2);
    expect(deps.resolve).toHaveBeenCalledTimes(2); // current and latest
    expect(deps.findVersionTag).toHaveBeenCalledTimes(1);
  });

  it("reports a failed reference and continues scanning other references", async () => {
    const root = await fixture({
      ".github/workflows/ci.yml": workflow(`      - uses: broken/action@v1
      - uses: owner/action@v1`),
    });
    const deps = dependencies();
    const original = deps.resolve;
    deps.resolve = async (action) => {
      if (action.owner === "broken") throw new Error("Access denied");
      return original(action);
    };
    const report = await scanRepository(root, "scan", deps);
    expect(report.rows[0]).toMatchObject({ status: "Error", error: "Access denied" });
    expect(report.rows[1]).toMatchObject({ status: "Unpinned" });
  });

  it("uses commit comparison for unversioned commits and warns about archived repositories", async () => {
    const root = await fixture({
      ".github/workflows/ci.yml": workflow("      - uses: owner/action@main"),
    });
    const deps = dependencies();
    deps.findVersionTag = vi.fn(async () => null);
    deps.getMetadata = vi.fn(async () => ({
      fullName: "owner/action", archived: true, license: null,
    }));
    const report = await scanRepository(root, "scan", deps);
    expect(report.rows[0]).toMatchObject({ version: null, newerAvailable: true, archived: true });
    expect(deps.compareCommits).toHaveBeenCalledOnce();
    expect(formatScan(report).join("\n")).toContain("owner/action@main is archived");
  });
});

describe("pin preview", () => {
  it("writes only with opt-in, preserving CRLF, comments, and quoting", async () => {
    const source = workflow("      - uses: 'owner/action@v1' # keep").replace(/\n/g, "\r\n");
    const root = await fixture({ ".github/workflows/ci.yml": source });
    const report = await scanRepository(root, "pin", dependencies(), { write: true });
    expect(report.written).toHaveLength(1);
    expect(await readFile(join(root, ".github", "workflows", "ci.yml"), "utf8"))
      .toBe(source.replace("owner/action@v1", `owner/action@${sha}`));
  });

  it("refuses all writes when any reference has an error", async () => {
    const source = workflow("      - uses: owner/action@v1\n      - uses: invalid-reference");
    const root = await fixture({ ".github/workflows/ci.yml": source });
    const report = await scanRepository(root, "pin", dependencies(), { write: true });
    expect(report.written).toBeUndefined();
    expect(await readFile(join(root, ".github", "workflows", "ci.yml"), "utf8")).toBe(source);
  });

  it("does not overwrite a concurrent edit", async () => {
    const source = workflow("      - uses: owner/action@v1");
    const root = await fixture({ ".github/workflows/ci.yml": source });
    const deps = dependencies();
    const original = deps.resolve;
    deps.resolve = async (action) => {
      await writeFile(join(root, ".github", "workflows", "ci.yml"), `${source}# external change\n`);
      return original(action);
    };
    await expect(scanRepository(root, "pin", deps, { write: true })).rejects.toThrow("changed during inspection");
    expect(await readFile(join(root, ".github", "workflows", "ci.yml"), "utf8")).toContain("external change");
  });
  it("pins the existing commit, preserving quotes, comments, flow YAML and nested paths without writing", async () => {
    const source = workflow(`      - uses: 'owner/action@v1' # intentional old version
      - { uses: "owner/action/nested@v1", name: Nested }
      - uses: owner/action@${sha} # already pinned`).replace(/\n/g, "\r\n");
    const root = await fixture({ ".github/workflows/ci.yml": source });
    const deps = dependencies();
    const report = await scanRepository(root, "pin", deps);
    expect(report.changes).toEqual([
      expect.objectContaining({
        line: 7,
        before: "      - uses: 'owner/action@v1' # intentional old version",
        after: `      - uses: 'owner/action@${sha}' # intentional old version`,
      }),
      expect.objectContaining({
        line: 8,
        after: `      - { uses: "owner/action/nested@${sha}", name: Nested }`,
      }),
    ]);
    expect(await readFile(join(root, ".github", "workflows", "ci.yml"), "utf8")).toBe(source);
    expect(deps.getLatestRelease).not.toHaveBeenCalled();
    expect(deps.getMetadata).not.toHaveBeenCalled();
    expect(deps.findVersionTag).not.toHaveBeenCalled();
    expect(formatScan(report).join("\n")).toContain("No files written; versions are not upgraded.");
  });

  it("combines multiple replacements on one line into one preview hunk", async () => {
    const root = await fixture({
      ".github/workflows/ci.yml": "jobs: { build: { steps: [ { uses: owner/action@v1 }, { uses: owner/action/nested@v1 } ] } }\n",
    });
    const report = await scanRepository(root, "pin", dependencies());
    expect(report.changes).toHaveLength(1);
    expect(report.changes[0].after).toContain(`owner/action@${sha}`);
    expect(report.changes[0].after).toContain(`owner/action/nested@${sha}`);
  });

  it("reports multiline values as unsafe to preview", async () => {
    const root = await fixture({
      ".github/workflows/ci.yml": workflow("      - uses: >-\n          owner/action@v1"),
    });
    const report = await scanRepository(root, "pin", dependencies());
    expect(report.changes).toEqual([]);
    expect(report.rows[0].error).toContain("multiline");
  });

  it("previews nested composite actions and remote reusable workflows without looking up releases", async () => {
    const root = await fixture({
      ".github/workflows/ci.yml": `jobs:
  reuse:
    uses: owner/repo/.github/workflows/build.yml@v1
  build:
    steps:
      - uses: ./tools/build
`,
      "tools/build/action.yml": `runs:
  using: composite
  steps:
    - uses: owner/action/subpath@v1
`,
    });
    const deps = dependencies();
    deps.getLatestRelease = async () => { throw new Error("No published release"); };
    const report = await scanRepository(root, "pin", deps);
    expect(report.errors).toEqual([]);
    expect(report.rows.some((row) => row.error)).toBe(false);
    expect(report.changes).toHaveLength(2);
    expect(report.changes[0].after).toContain(`owner/repo/.github/workflows/build.yml@${sha}`);
    expect(report.changes[1].after).toContain(`owner/action/subpath@${sha}`);
  });
});

describe("upgrades and CI policies", () => {
  it("previews a major upgrade, then writes the exact selected SHA and refreshes the version-only comment", async () => {
    const source = workflow(`      - uses: owner/action@${sha} # v1.0.0`);
    const root = await fixture({ ".github/workflows/ci.yml": source });
    const deps = dependencies();
    deps.listReleases = vi.fn(async () => [
      { tagName: "v2.0.0", releaseNotesUrl: "https://github.com/owner/action/releases/tag/v2.0.0" },
    ]);
    const original = deps.resolve;
    deps.resolve = async (action) => action.ref === "v2.0.0"
      ? { sha: "b".repeat(40), refType: "tag" } : original(action);
    const preview = await scanRepository(root, "upgrade", deps, { policy: "major" });
    expect(preview.rows[0]).toMatchObject({ target: "v2.0.0", majorUpgrade: true });
    expect(preview.changes[0].after).toContain(`${"b".repeat(40)} # v2.0.0`);
    expect(await readFile(join(root, ".github", "workflows", "ci.yml"), "utf8")).toBe(source);
    const written = await scanRepository(root, "upgrade", deps, { policy: "major", write: true });
    expect(written.written).toHaveLength(1);
  });

  it("uses within-major upgrades by default and refuses unknown versions", async () => {
    const root = await fixture({ ".github/workflows/ci.yml": workflow("      - uses: owner/action@v1") });
    const deps = dependencies();
    deps.listReleases = async () => [
      { tagName: "v2.0.0", releaseNotesUrl: "https://github.com/owner/action/releases/tag/v2.0.0" },
    ];
    expect((await scanRepository(root, "upgrade", deps)).changes).toEqual([]);
    deps.findVersionTag = async () => null;
    const report = await scanRepository(root, "upgrade", deps, { write: true });
    expect(report.rows[0].error).toContain("no version tag");
    expect(report.written).toBeUndefined();
  });

  it("evaluates unpinned, archived, and allowed-publisher policies", async () => {
    const root = await fixture({ ".github/workflows/ci.yml": workflow("      - uses: owner/action@v1") });
    const deps = dependencies();
    deps.getMetadata = async () => ({ fullName: "owner/action", archived: true, license: null });
    const report = await scanRepository(root, "scan", deps, {
      failOn: ["unpinned", "archived", "publisher"], allowedPublishers: ["trusted"],
    });
    expect(report.policyFailures).toHaveLength(3);
    const passing = await scanRepository(root, "scan", deps, {
      failOn: ["publisher"], allowedPublishers: ["OWNER"],
    });
    expect(passing.policyFailures).toBeUndefined();
  });

  it("fails closed on dynamic references and handles Docker digests under pin policies", async () => {
    const root = await fixture({
      ".github/workflows/ci.yml": workflow(`      - uses: \${{ matrix.action }}
      - uses: docker://alpine:3
      - uses: docker://alpine@sha256:${"a".repeat(64)}`),
    });
    const report = await scanRepository(root, "scan", dependencies(), { failOn: ["unpinned"] });
    expect(report.policyFailures).toHaveLength(2);
    expect(report.policyFailures?.join("\n")).toContain("dynamic reference");
    expect(report.policyFailures?.join("\n")).toContain("unpinned Docker");
  });

  it("refuses to write upgrades with missing target Action metadata", async () => {
    const source = workflow("      - uses: owner/action/nested@v1");
    const root = await fixture({ ".github/workflows/ci.yml": source });
    const deps = dependencies();
    deps.listReleases = async () => [{
      tagName: "v1.1.0", releaseNotesUrl: "https://github.com/owner/action/releases/tag/v1.1.0",
    }];
    deps.inspectAction = async () => { throw new Error("No action.yml at target path"); };
    const report = await scanRepository(root, "upgrade", deps, { write: true });
    expect(report.rows[0].error).toContain("No action.yml");
    expect(report.written).toBeUndefined();
    expect(await readFile(join(root, ".github", "workflows", "ci.yml"), "utf8")).toBe(source);
  });

  it("verifies reusable workflow targets before proposing an upgrade", async () => {
    const root = await fixture({
      ".github/workflows/ci.yml": "jobs:\n  reuse:\n    uses: owner/action/.github/workflows/build.yml@v1\n",
    });
    const deps = dependencies();
    deps.listReleases = async () => [{
      tagName: "v1.1.0", releaseNotesUrl: "https://github.com/owner/action/releases/tag/v1.1.0",
    }];
    deps.inspectWorkflow = vi.fn(async () => { throw new Error("Missing workflow_call"); });
    const report = await scanRepository(root, "upgrade", deps, { write: true });
    expect(report.rows[0].error).toBe("Missing workflow_call");
    expect(report.written).toBeUndefined();
    expect(deps.inspectWorkflow).toHaveBeenCalledOnce();
  });

  it("keeps inspection results when no release exists instead of claiming no updates", async () => {
    const root = await fixture({ ".github/workflows/ci.yml": workflow("      - uses: owner/action@v1") });
    const deps = dependencies();
    deps.getLatestRelease = async () => { throw new NoReleaseError("No published release"); };
    const report = await scanRepository(root, "scan", deps);
    expect(report.rows[0]).toMatchObject({ status: "Unpinned", sha, warning: "No published release" });
    expect(report.rows[0].newerAvailable).toBeUndefined();
    expect(report.rows[0].error).toBeUndefined();
  });
});

describe("scan and pin CLI commands", () => {
  async function run(args: string[], deps = dependencies()) {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const code = await runCli(args, {
      stdout: (line) => stdout.push(line), stderr: (line) => stderr.push(line),
    }, deps);
    return { code, stdout, stderr };
  }

  it.each(["scan", "pin"])("supports JSON output for %s", async (command) => {
    const root = await fixture({
      ".github/workflows/ci.yml": workflow("      - uses: owner/action@v1"),
    });
    const result = await run([command, root, "--json"]);
    expect(result.code).toBe(0);
    expect(result.stderr).toEqual([]);
    expect(result.stdout).toHaveLength(1);
    expect(JSON.parse(result.stdout[0])).toMatchObject({ mode: command, files: 1 });
  });

  it("accepts --dry-run and explicit write mode but rejects combining them", async () => {
    const root = await fixture({});
    expect((await run(["pin", root, "--dry-run"])).code).toBe(0);
    const result = await run(["pin", root, "--write"]);
    expect(result.code).toBe(0);
    expect((await run(["pin", root, "--write", "--dry-run"])).code).toBe(1);
  });

  it("returns a nonzero exit code for partial failures with details in JSON", async () => {
    const root = await fixture({
      ".github/workflows/ci.yml": workflow("      - uses: not-a-reference"),
    });
    const result = await run(["scan", root, "--json"]);
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout[0]).rows[0]).toMatchObject({
      status: "Error", error: "Unsupported uses reference.",
    });
  });

  it.each(["scan", "pin"])("shows command help for %s", async (command) => {
    const result = await run([command, "--help"]);
    expect(result.code).toBe(0);
    expect(result.stdout[0]).toContain(`action-inspector ${command}`);
  });

  it("returns a nonzero exit code when discovery fails", async () => {
    const root = await fixture({ ".github/workflows/broken.yml": "jobs: [" });
    const result = await run(["scan", root, "--json"]);
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout[0]).errors).toHaveLength(1);
  });

  it("returns a nonzero exit code for CI policy violations", async () => {
    const root = await fixture({ ".github/workflows/ci.yml": workflow("      - uses: owner/action@v1") });
    const result = await run(["scan", root, "--json", "--fail-on", "unpinned"]);
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout[0]).policyFailures).toHaveLength(1);
  });

  it.each([
    ["scan", "--fail-on", "publisher"],
    ["scan", "--fail-on", "unknown"],
    ["upgrade", "--policy", "unknown"],
    ["pin", "--write", "--dry-run"],
    ["scan", "--write"],
  ])("rejects invalid options %j", async (...args) => {
    expect((await run(args)).code).toBe(1);
  });
});
