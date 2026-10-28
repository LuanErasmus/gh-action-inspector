import { compareCommits } from "./compare-commits.js";
import { findVersionTagForSha } from "./find-version-tag.js";
import { getLatestRelease, type LatestRelease } from "./latest-release.js";
import { parseActionReference } from "./parse-reference.js";
import { generateShaPinnedReference } from "./pinned-reference.js";
import {
  getRepositoryMetadata,
  type RepositoryMetadata,
} from "./repository-metadata.js";
import { resolveActionReference } from "./resolve-reference.js";
import type { ResolvedActionReference } from "./resolve-reference.js";

interface CliOutput {
  stdout: (message: string) => void;
  stderr: (message: string) => void;
}

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
  if (args.length !== 1) {
    output.stderr("Usage: action-inspector <owner/repository[/path]@ref>");
    return 1;
  }

  try {
    const action = parseActionReference(args[0]);
    const [resolved, metadata]: [
      ResolvedActionReference,
      RepositoryMetadata,
    ] = await Promise.all([
      dependencies.resolve(action),
      dependencies.getMetadata(action),
    ]);
    const immutable = resolved.refType === "sha";
    const latestRelease: LatestRelease = await dependencies.getLatestRelease(action);
    const [version, latestResolved]: [string | null, ResolvedActionReference] =
      await Promise.all([
        dependencies.findVersionTag(action, resolved.sha),
        dependencies.resolve({ ...action, ref: latestRelease.tagName }),
      ]);
    const comparison = await dependencies.compareCommits(
      action,
      resolved.sha,
      latestResolved.sha,
    );
    const newerAvailable = comparison === "ahead" || comparison === "diverged";

    output.stdout(`Repository: ${metadata.fullName}`);
    output.stdout(`Original reference: ${action.ref}`);
    output.stdout(`Reference type: ${resolved.refType}`);
    output.stdout(`Resolved commit SHA: ${resolved.sha}`);
    output.stdout(`Resolved version: ${version ?? "Not found (no tag points to this commit)"}`);
    output.stdout(`Current SHA-pinned equivalent: ${metadata.fullName}@${resolved.sha}`);
    output.stdout(
      `License: ${metadata.license?.spdxId && metadata.license.spdxId !== "NOASSERTION" ? metadata.license.spdxId : metadata.license?.name ?? "Not detected"}`,
    );
    output.stdout(`Archived: ${metadata.archived ? "Yes" : "No"}`);
    output.stdout(`Immutable: ${immutable ? "Yes" : "No"}`);
    output.stdout(`Latest release: ${latestRelease.tagName}`);
    output.stdout(`Release notes: ${latestRelease.releaseNotesUrl}`);
    output.stdout(
      `Newer version available: ${newerAvailable ? `Yes (${latestRelease.tagName})` : "No"}`,
    );
    output.stdout(
      `Latest SHA-pinned release: ${generateShaPinnedReference(
        { ...action, ref: latestRelease.tagName },
        latestResolved.sha,
      )}`,
    );
    return 0;
  } catch (error) {
    output.stderr(
      error instanceof Error ? error.message : "Could not parse Action reference.",
    );
    return 1;
  }
}
