import type { ParsedActionReference } from "./parse-reference.js";
import { createGitHubApiClient, type GitHubApiOptions } from "./github-api.js";

export type FindVersionTagOptions = GitHubApiOptions;

const PAGE_SIZE = 100;
const MAX_PAGES = 10;
const VERSION_PATTERN = /^v?\d+(\.\d+)*$/;

function versionSpecificity(tag: string): number {
  return VERSION_PATTERN.test(tag) ? tag.split(".").length : 0;
}

function readTags(value: unknown): { name: string; sha: string }[] {
  if (!Array.isArray(value)) {
    throw new Error("GitHub API returned an invalid tag list.");
  }
  return value.map((tag: unknown) => {
    if (
      typeof tag !== "object" ||
      tag === null ||
      !("name" in tag) ||
      typeof tag.name !== "string" ||
      !("commit" in tag) ||
      typeof tag.commit !== "object" ||
      tag.commit === null ||
      !("sha" in tag.commit) ||
      typeof tag.commit.sha !== "string"
    ) {
      throw new Error("GitHub API returned an invalid tag list.");
    }
    return { name: tag.name, sha: tag.commit.sha };
  });
}

/**
 * Returns the most specific tag (for example, v4.2.2 rather than v4) that
 * points to the commit, or null when no tag points to it.
 */
export async function findVersionTagForSha(
  repository: Pick<ParsedActionReference, "owner" | "repository">,
  sha: string,
  options: FindVersionTagOptions = {},
): Promise<string | null> {
  const { getRepositoryJson } = createGitHubApiClient(options);
  const target = sha.toLowerCase();
  let best: string | null = null;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const tags = readTags(
      await getRepositoryJson(
        repository.owner,
        repository.repository,
        `/tags?per_page=${PAGE_SIZE}&page=${page}`,
      ),
    );

    for (const tag of tags) {
      if (
        tag.sha.toLowerCase() === target &&
        (best === null || versionSpecificity(tag.name) > versionSpecificity(best))
      ) {
        best = tag.name;
      }
    }

    if (tags.length < PAGE_SIZE) {
      break;
    }
  }

  return best;
}
