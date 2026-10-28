#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
}

const defaultDependencies: CliDependencies = {
  resolve: resolveActionReference,
  getMetadata: getRepositoryMetadata,
  getLatestRelease,
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
    let latestRelease: LatestRelease | undefined;
    let latestResolved: ResolvedActionReference | undefined;
    if (!immutable) {
      latestRelease = await dependencies.getLatestRelease(action);
      latestResolved = await dependencies.resolve({
        ...action,
        ref: latestRelease.tagName,
      });
    }

    output.stdout(`Repository: ${metadata.fullName}`);
    output.stdout(`Original reference: ${action.ref}`);
    output.stdout(`Reference type: ${resolved.refType}`);
    output.stdout(`Resolved commit SHA: ${resolved.sha}`);
    output.stdout(`Current SHA-pinned equivalent: ${metadata.fullName}@${resolved.sha}`);
    output.stdout(
      `License: ${metadata.license?.spdxId && metadata.license.spdxId !== "NOASSERTION" ? metadata.license.spdxId : metadata.license?.name ?? "Not detected"}`,
    );
    output.stdout(`Archived: ${metadata.archived ? "Yes" : "No"}`);
    output.stdout(`Immutable: ${immutable ? "Yes" : "No"}`);
    if (latestRelease && latestResolved) {
      output.stdout(`Latest release: ${latestRelease.tagName}`);
      output.stdout(`Release notes: ${latestRelease.releaseNotesUrl}`);
      output.stdout(
        `Latest SHA-pinned release: ${generateShaPinnedReference(
          { ...action, ref: latestRelease.tagName },
          latestResolved.sha,
        )}`,
      );
    }
    return 0;
  } catch (error) {
    output.stderr(
      error instanceof Error ? error.message : "Could not parse Action reference.",
    );
    return 1;
  }
}

if (
  process.argv[1] &&
  realpathSync(resolve(process.argv[1])) ===
    realpathSync(fileURLToPath(import.meta.url))
) {
  process.exitCode = await runCli(process.argv.slice(2), {
    stdout: console.log,
    stderr: console.error,
  });
}
