import { compareCommits } from "./compare-commits.js";
import { findVersionTagForSha } from "./find-version-tag.js";
import { formatJson, formatText, type InspectionReport } from "./format.js";
import { getLatestRelease, type LatestRelease } from "./latest-release.js";
import { parseActionReference } from "./parse-reference.js";
import { generateShaPinnedReference } from "./pinned-reference.js";
import {
  getRepositoryMetadata,
  type RepositoryMetadata,
} from "./repository-metadata.js";
import { resolveActionReference } from "./resolve-reference.js";
import type { ResolvedActionReference } from "./resolve-reference.js";
import { compareVersions, isVersionTag } from "./version.js";

interface CliOutput {
  stdout: (message: string) => void;
  stderr: (message: string) => void;
  /** Shows (or clears, when null) a transient progress message. */
  status?: (message: string | null) => void;
  /** Whether colors and status icons may be used. */
  color?: boolean;
}

const USAGE = "Usage: action-inspector [--json] <owner/repository[/path]@ref>";

interface CliDependencies {
  resolve: typeof resolveActionReference;
  getMetadata: typeof getRepositoryMetadata;
  getLatestRelease: typeof getLatestRelease;
  findVersionTag: typeof findVersionTagForSha;
  compareCommits: typeof compareCommits;
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
  const json = args.includes("--json");
  const positional = args.filter((arg) => arg !== "--json");
  if (positional.length === 1 && (positional[0] === "-h" || positional[0] === "--help")) {
    output.stdout(USAGE);
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
    const latestRelease: LatestRelease = await dependencies.getLatestRelease(action);
    const [version, latestResolved]: [string | null, ResolvedActionReference] =
      await Promise.all([
        dependencies.findVersionTag(action, resolved.sha),
        dependencies.resolve({ ...action, ref: latestRelease.tagName }),
      ]);
    // Version numbers are more reliable than commit ancestry: some Actions
    // (for example github/codeql-action) build older major versions on top of
    // newer release commits.
    const newerAvailable =
      version !== null && isVersionTag(version) && isVersionTag(latestRelease.tagName)
        ? compareVersions(latestRelease.tagName, version) > 0
        : ["ahead", "diverged"].includes(
            await dependencies.compareCommits(action, resolved.sha, latestResolved.sha),
          );
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
      latestRelease: {
        version: latestRelease.tagName,
        sha: latestResolved.sha,
        releaseNotesUrl: latestRelease.releaseNotesUrl,
        newerAvailable,
        pinned: generateShaPinnedReference(
          { ...action, ref: latestRelease.tagName },
          latestResolved.sha,
        ),
      },
    };

    if (json) {
      output.stdout(formatJson(report));
    } else {
      formatText(report, output.color ?? false).forEach((line) => output.stdout(line));
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
