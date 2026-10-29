import type { ParsedActionReference } from "./parse-reference.js";
import {
  createGitHubApiClient,
  GitHubApiError,
  type GitHubApiOptions,
} from "./github-api.js";
import { compareVersions, isVersionTag } from "./version.js";

export interface LatestRelease {
  tagName: string;
  releaseNotesUrl: string;
  publishedAt?: string;
}

export class NoReleaseError extends Error {}

export type GetLatestReleaseOptions = GitHubApiOptions;

const RELEASES_PAGE_SIZE = 100;

function readRelease(value: unknown): LatestRelease {
  if (
    typeof value !== "object" ||
    value === null ||
    !("tag_name" in value) ||
    typeof value.tag_name !== "string" ||
    !("html_url" in value) ||
    typeof value.html_url !== "string" ||
    !URL.canParse(value.html_url) ||
    new URL(value.html_url).protocol !== "https:"
  ) {
    throw new Error("GitHub API returned invalid latest release metadata.");
  }
  return { tagName: value.tag_name, releaseNotesUrl: value.html_url };
}

/**
 * Picks the highest version-tagged, published, non-prerelease release. Some
 * repositories (for example github/codeql-action) also publish non-Action
 * releases such as "codeql-bundle-v2.27.3", which GitHub may mark as latest.
 */
function findHighestVersionRelease(value: unknown): LatestRelease | null {
  if (!Array.isArray(value)) {
    throw new Error("GitHub API returned an invalid release list.");
  }
  let best: LatestRelease | null = null;
  for (const item of value) {
    if (typeof item !== "object" || item === null ||
        ("draft" in item && typeof item.draft !== "boolean") ||
        ("prerelease" in item && typeof item.prerelease !== "boolean")) {
      throw new Error("GitHub API returned invalid release metadata.");
    }
    if (("draft" in item && item.draft) || ("prerelease" in item && item.prerelease)) {
      continue;
    }
    const release = readRelease(item);
    if (
      isVersionTag(release.tagName) &&
      (best === null || compareVersions(release.tagName, best.tagName) > 0)
    ) {
      best = release;
    }
  }
  return best;
}

export async function getLatestRelease(
  repository: Pick<ParsedActionReference, "owner" | "repository">,
  options: GetLatestReleaseOptions = {},
): Promise<LatestRelease> {
  const { getRepositoryJson } = createGitHubApiClient(options);
  let value: unknown;

  try {
    value = await getRepositoryJson(
      repository.owner,
      repository.repository,
      "/releases/latest",
    );
  } catch (error) {
    if (error instanceof GitHubApiError && error.status === 404) {
      throw new NoReleaseError(
        `No latest published release was found for ${repository.owner}/${repository.repository}.`,
      );
    }
    throw error;
  }

  const latest = readRelease(value);
  if (isVersionTag(latest.tagName)) {
    return latest;
  }

  let best: LatestRelease | null = null;
  for (let page = 1; page <= 20; page++) {
    const releases = await getRepositoryJson(
      repository.owner, repository.repository,
      `/releases?per_page=${RELEASES_PAGE_SIZE}${page === 1 ? "" : `&page=${page}`}`,
    );
    const candidate = findHighestVersionRelease(releases);
    if (candidate && (!best || compareVersions(candidate.tagName, best.tagName) > 0)) best = candidate;
    if (Array.isArray(releases) && releases.length < RELEASES_PAGE_SIZE) {
      if (best) return best;
      throw new NoReleaseError(
        `No numeric Action release was found for ${repository.owner}/${repository.repository}; unrelated release "${latest.tagName}" was not selected.`,
      );
    }
  }
  throw new Error("Release search exceeded 2,000 releases; latest Action version is unknown.");
}
