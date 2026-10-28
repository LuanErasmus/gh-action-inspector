import type { ParsedActionReference } from "./parse-reference.js";
import {
  createGitHubApiClient,
  GitHubApiError,
  type GitHubApiOptions,
} from "./github-api.js";

export interface LatestRelease {
  tagName: string;
  releaseNotesUrl: string;
}

export type GetLatestReleaseOptions = GitHubApiOptions;

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
      throw new Error(
        `No latest published release was found for ${repository.owner}/${repository.repository}.`,
      );
    }
    throw error;
  }

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

  return {
    tagName: value.tag_name,
    releaseNotesUrl: value.html_url,
  };
}
