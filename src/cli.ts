import { compareCommits } from "./compare-commits.js";
import { findVersionTagForSha } from "./find-version-tag.js";
import { formatComparison, formatJson, formatText, type InspectionReport } from "./format.js";
import { getLatestRelease, NoReleaseError, type LatestRelease } from "./latest-release.js";
import { parseActionReference } from "./parse-reference.js";
import { generateShaPinnedReference } from "./pinned-reference.js";
import {
  getRepositoryMetadata,
  type RepositoryMetadata,
} from "./repository-metadata.js";
import { resolveActionReference } from "./resolve-reference.js";
import type { ResolvedActionReference } from "./resolve-reference.js";
import { compareVersions, isVersionTag } from "./version.js";
import { formatScan, scanRepository } from "./scan.js";
import { listVersionReleases } from "./release-candidates.js";
import { parseRepositoryOptions } from "./command-options.js";
import { compareActionDetails, inspectAction, inspectReusableWorkflow } from "./action-details.js";
import { renderLines } from "./terminal.js";

interface CliOutput {
  stdout: (message: string) => void;
  stderr: (message: string) => void;
  /** Shows (or clears, when null) a transient progress message. */
  status?: (message: string | null) => void;
  /** Whether colors and status icons may be used. */
  color?: boolean;
  width?: number;
}

const USAGE = "Usage: action-inspector [--json] <owner/repository[/path]@ref>";

function helpLines(command?: string): string[] {
  const shared = [
    "  --json                  Output JSON instead of a text report",
    "  --no-cache              Bypass the five-minute API cache",
    "  -h, --help              Show help",
  ];
  const writeOptions = [
    "  --dry-run               Preview changes (the default)",
    "  --write                 Apply changes to workflow files",
  ];
  if (!command) return [
    "GitHub Action Inspector",
    "  Inspect, scan, pin, and upgrade GitHub Actions.",
    "",
    "Usage",
    "  action-inspector <action@ref> [options]",
    "  action-inspector <command> [arguments] [options]",
    "",
    "Commands",
    "  <action@ref>             Inspect an Action reference",
    "  scan [directory]        Check workflow dependencies and updates",
    "  pin [directory]         Preview full-SHA pins for current commits",
    "  upgrade [directory]     Preview version upgrades and SHA pins",
    "  compare <before> <after>",
    "                          Compare two versions of the same Action",
    "",
    "Options",
    "  --details               Include runtime, inputs, and outputs when inspecting",
    ...shared,
    "",
    "Examples",
    "  action-inspector actions/checkout@v4 --details",
    "  action-inspector scan",
    "  action-inspector pin --dry-run",
    "  action-inspector upgrade --policy latest",
    "  action-inspector compare actions/checkout@v4 actions/checkout@v7",
    "",
    "Safety",
    "  Pin and upgrade preview by default. Only --write modifies files.",
    "",
    "Command help",
    "  Run action-inspector <command> --help for command-specific options.",
  ];
  const comparison = command === "compare";
  return [
    `action-inspector ${command}`,
    "",
    "Usage",
    `  action-inspector ${command} ${comparison ? "<action@before> <action@after>" : "[directory]"} [options]`,
    "",
    "Arguments",
    ...(comparison ? [
      "  <action@before>         Original Action reference",
      "  <action@after>          New reference for the same Action and subdirectory",
    ] : ["  [directory]             Repository root (default: current directory)"]),
    "",
    "Options",
    ...(command === "scan" ? [
      "  --fail-on <checks>      Fail on comma-separated policy checks:",
      "                          unpinned, archived, publisher",
      "  --allow-publishers <owners>",
      "                          Comma-separated owners allowed by publisher policy",
    ] : []),
    ...(command === "pin" || command === "upgrade" ? writeOptions : []),
    ...(command === "upgrade" ? [
      "  --policy <policy>       Upgrade boundary (default: major)",
      "    patch                 Stay within the current major and minor",
      "    major                 Stay within the current major",
      "    latest                Allow upgrades to newer major versions",
    ] : []),
    ...shared,
    "",
    "Examples",
    ...(comparison ? ["  action-inspector compare actions/checkout@v4 actions/checkout@v7"]
      : command === "scan" ? [
        "  action-inspector scan",
        "  action-inspector scan --fail-on unpinned,archived",
        "  action-inspector scan --fail-on publisher --allow-publishers actions,github",
      ] : [
        `  action-inspector ${command} --dry-run`,
        `  action-inspector ${command}${command === "upgrade" ? " --policy latest" : ""} --write`,
      ]),
    ...(command === "pin" || command === "upgrade" ? [
      "", "Safety",
      command === "pin" ? "  Pinning preserves current commits; it does not upgrade versions."
        : "  Review compatibility findings before applying upgrades.",
      "  Preview is the default. Only --write modifies files.",
    ] : []),
  ];
}

export interface CliDependencies {
  resolve: typeof resolveActionReference;
  getMetadata: typeof getRepositoryMetadata;
  getLatestRelease: typeof getLatestRelease;
  findVersionTag: typeof findVersionTagForSha;
  compareCommits: typeof compareCommits;
  listReleases?: typeof listVersionReleases;
  inspectAction?: typeof inspectAction;
  inspectWorkflow?: typeof inspectReusableWorkflow;
}

const defaultDependencies: CliDependencies = {
  resolve: resolveActionReference,
  getMetadata: getRepositoryMetadata,
  getLatestRelease,
  findVersionTag: findVersionTagForSha,
  compareCommits,
};

export async function runCli(
  args: string[],
  output: CliOutput,
  dependencies: CliDependencies = defaultDependencies,
): Promise<number> {
  const stderr = output.stderr;
  output = {
    ...output,
    stderr: (message) => renderLines([message], output).forEach((line) => stderr(line)),
  };
  if (args[0] === "compare") {
    if (args.includes("--help") || args.includes("-h")) {
      output.stdout(renderLines(helpLines("compare"), output).join("\n"));
      return 0;
    }
    const references = args.slice(1).filter((arg) => arg !== "--json");
    if (references.length !== 2 || references.some((arg) => arg.startsWith("-"))) {
      output.stderr("Usage: action-inspector compare <action@before> <action@after> [--json]");
      return 1;
    }
    try {
      const before = parseActionReference(references[0]);
      const after = parseActionReference(references[1]);
      if (`${before.owner}/${before.repository}/${before.path ?? ""}`.toLowerCase() !==
          `${after.owner}/${after.repository}/${after.path ?? ""}`.toLowerCase()) {
        throw new Error("Compare requires two versions of the same Action.");
      }
      const resolved = await Promise.all([dependencies.resolve(before), dependencies.resolve(after)]);
      const details = dependencies.inspectAction ?? inspectAction;
      const [oldDetails, newDetails] = await Promise.all([
        details(before, resolved[0].sha), details(after, resolved[1].sha),
      ]);
      const comparison = compareActionDetails(oldDetails, newDetails);
      const report = {
        before: oldDetails, after: newDetails, comparison,
        releaseNotes: `https://github.com/${after.owner}/${after.repository}/releases`,
      };
      if (args.includes("--json")) output.stdout(JSON.stringify(report, null, 2));
      else formatComparison(references[0], references[1], comparison, report.releaseNotes, output)
        .forEach((line) => output.stdout(line));
      return 0;
    } catch (error) {
      output.stderr(error instanceof Error ? error.message : "Could not compare Actions.");
      return 1;
    }
  }
  if (args[0] === "scan" || args[0] === "pin" || args[0] === "upgrade") {
    const mode = args[0];
    const usage = `Usage: action-inspector ${mode} [directory] [--json]${mode !== "scan" ? " [--dry-run | --write]" : " [--fail-on unpinned,archived,publisher] [--allow-publishers owner,...]"}${mode === "upgrade" ? " [--policy patch|major|latest]" : ""}`;
    if (args.includes("--help") || args.includes("-h")) {
      output.stdout(renderLines(helpLines(mode), output).join("\n"));
      return 0;
    }
    try {
      const parsed = parseRepositoryOptions(args.slice(1), mode);
      output.status?.(mode === "pin" ? "Preparing pin preview..." : "Scanning workflows...");
      const report = await scanRepository(parsed.directory, mode, dependencies, parsed.options);
      output.status?.(null);
      if (parsed.json) {
        output.stdout(JSON.stringify(report, null, 2));
      } else {
        formatScan(report, output).forEach((line) => output.stdout(line));
      }
      return report.errors.length || report.rows.some((row) => row.error) || report.policyFailures?.length ? 1 : 0;
    } catch (error) {
      output.status?.(null);
      output.stderr(error instanceof Error ? error.message : "Could not scan workflows.");
      output.stderr(usage);
      return 1;
    }
  }
  const json = args.includes("--json");
  const positional = args.filter((arg) => arg !== "--json" && arg !== "--details");
  if (positional.length === 1 && (positional[0] === "-h" || positional[0] === "--help")) {
    output.stdout(renderLines(helpLines(), output).join("\n"));
    return 0;
  }
  if (positional.length !== 1 || positional[0].startsWith("-")) {
    output.stderr(USAGE);
    return 1;
  }

  try {
    const action = parseActionReference(positional[0]);
    output.status?.(`Inspecting ${positional[0]}…`);
    const [resolved, metadata]: [
      ResolvedActionReference,
      RepositoryMetadata,
    ] = await Promise.all([
      dependencies.resolve(action),
      dependencies.getMetadata(action),
    ]);
    let warning: string | undefined;
    const latestRelease: LatestRelease | null = await dependencies.getLatestRelease(action).catch((error: unknown) => {
      if (!(error instanceof NoReleaseError)) throw error;
      warning = error.message;
      return null;
    });
    const [version, latestResolved] =
      await Promise.all([
        dependencies.findVersionTag(action, resolved.sha),
        latestRelease ? dependencies.resolve({ ...action, ref: latestRelease.tagName }) : null,
      ]);
    // Version numbers are more reliable than commit ancestry: some Actions
    // (for example github/codeql-action) build older major versions on top of
    // newer release commits.
    const newerAvailable =
      latestRelease !== null && latestResolved !== null && (
      version !== null && isVersionTag(version) && isVersionTag(latestRelease.tagName)
        ? compareVersions(latestRelease.tagName, version) > 0
        : ["ahead", "diverged"].includes(
            await dependencies.compareCommits(action, resolved.sha, latestResolved.sha),
          ));
    output.status?.(null);

    const report: InspectionReport = {
      action: [action.owner, action.repository, ...(action.path ? [action.path] : [])].join("/"),
      repository: metadata.fullName,
      reference: {
        original: action.ref,
        type: resolved.refType,
        sha: resolved.sha,
        version,
        immutable: resolved.refType === "sha",
        pinned: generateShaPinnedReference(
          { ...action, ref: version ?? resolved.sha },
          resolved.sha,
        ),
      },
      license:
        metadata.license?.spdxId && metadata.license.spdxId !== "NOASSERTION"
          ? metadata.license.spdxId
          : metadata.license?.name ?? "Not detected",
      archived: metadata.archived,
      ...(warning ? { warning } : {}),
      ...(args.includes("--details") ? {
        details: await (dependencies.inspectAction ?? inspectAction)(action, resolved.sha),
      } : {}),
      latestRelease: latestRelease && latestResolved ? {
        version: latestRelease.tagName,
        sha: latestResolved.sha,
        releaseNotesUrl: latestRelease.releaseNotesUrl,
        newerAvailable,
        pinned: generateShaPinnedReference(
          { ...action, ref: latestRelease.tagName },
          latestResolved.sha,
        ),
      } : null,
    };

    if (json) {
      output.stdout(formatJson(report));
    } else {
      formatText(report, output.color ?? false, output.width).forEach((line) => output.stdout(line));
    }
    return 0;
  } catch (error) {
    output.status?.(null);
    output.stderr(
      error instanceof Error ? error.message : "Could not parse Action reference.",
    );
    return 1;
  }
}
