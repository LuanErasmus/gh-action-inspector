import type { ParsedActionReference } from "./parse-reference.js";
import { createGitHubApiClient, type GitHubApiOptions } from "./github-api.js";

export type CommitComparisonStatus = "ahead" | "behind" | "identical" | "diverged";

export type CompareCommitsOptions = GitHubApiOptions;

const STATUSES: readonly string[] = ["ahead", "behind", "identical", "diverged"];

function isStatus(value: unknown): value is CommitComparisonStatus {
  return typeof value === "string" && STATUSES.includes(value);
}

/**
 * Compares head against base. "ahead" means head contains commits that base
 * does not, so head is newer than base.
 */
export async function compareCommits(
  repository: Pick<ParsedActionReference, "owner" | "repository">,
  baseSha: string,
  headSha: string,
  options: CompareCommitsOptions = {},
): Promise<CommitComparisonStatus> {
  if (baseSha.toLowerCase() === headSha.toLowerCase()) {
    return "identical";
  }

  const { getRepositoryJson } = createGitHubApiClient(options);
  const value = await getRepositoryJson(
    repository.owner,
    repository.repository,
    `/compare/${encodeURIComponent(baseSha)}...${encodeURIComponent(headSha)}`,
  );

  if (typeof value !== "object" || value === null || !("status" in value) || !isStatus(value.status)) {
    throw new Error("GitHub API returned an invalid commit comparison.");
  }
  return value.status;
}
