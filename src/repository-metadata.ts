import type { ParsedActionReference } from "./parse-reference.js";
import {
  createGitHubApiClient,
  GitHubApiError,
  type GitHubApiOptions,
} from "./github-api.js";

export interface RepositoryLicense {
  name: string;
  spdxId: string | null;
}

export interface RepositoryMetadata {
  fullName: string;
  license: RepositoryLicense | null;
  archived: boolean;
}

export type GetRepositoryMetadataOptions = GitHubApiOptions;

export async function getRepositoryMetadata(
  repository: Pick<ParsedActionReference, "owner" | "repository">,
  options: GetRepositoryMetadataOptions = {},
): Promise<RepositoryMetadata> {
  const { getRepositoryJson } = createGitHubApiClient(options);
  let value: unknown;

  try {
    value = await getRepositoryJson(
      repository.owner,
      repository.repository,
      "",
    );
  } catch (error) {
    if (error instanceof GitHubApiError && error.status === 404) {
      throw new Error(
        `Repository ${repository.owner}/${repository.repository} was not found or is inaccessible.`,
      );
    }
    throw error;
  }

  if (
    typeof value !== "object" ||
    value === null ||
    !("full_name" in value) ||
    typeof value.full_name !== "string" ||
    !("archived" in value) ||
    typeof value.archived !== "boolean" ||
    !("license" in value)
  ) {
    throw new Error("GitHub API returned invalid repository metadata.");
  }

  let license: RepositoryLicense | null = null;
  if (value.license !== null) {
    if (
      typeof value.license !== "object" ||
      !("name" in value.license) ||
      typeof value.license.name !== "string" ||
      !("spdx_id" in value.license) ||
      (typeof value.license.spdx_id !== "string" &&
        value.license.spdx_id !== null)
    ) {
      throw new Error("GitHub API returned invalid license metadata.");
    }

    license = {
      name: value.license.name,
      spdxId: value.license.spdx_id,
    };
  }

  return {
    fullName: value.full_name,
    license,
    archived: value.archived,
  };
}
