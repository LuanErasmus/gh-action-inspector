import type { ParsedActionReference } from "./parse-reference.js";
import {
  createGitHubApiClient,
  GitHubApiError,
  type GitHubApiOptions,
} from "./github-api.js";

export type ActionReferenceType = "tag" | "branch" | "sha";

export interface ResolvedActionReference {
  sha: string;
  refType: ActionReferenceType;
}

export type ResolveActionReferenceOptions = GitHubApiOptions;

interface GitObject {
  sha: string;
  type: string;
}

interface GitReference {
  object: GitObject;
}

const SHA_PATTERN = /^[0-9a-f]{40}$/i;

export async function resolveActionReference(
  reference: Pick<ParsedActionReference, "owner" | "repository" | "ref">,
  options: ResolveActionReferenceOptions = {},
): Promise<ResolvedActionReference> {
  const { getRepositoryJson } = createGitHubApiClient(options);

  function getJson(path: string): Promise<unknown> {
    return getRepositoryJson(reference.owner, reference.repository, path);
  }

  function readGitObject(value: unknown): GitObject {
    if (
      typeof value !== "object" ||
      value === null ||
      !("sha" in value) ||
      typeof value.sha !== "string" ||
      !("type" in value) ||
      typeof value.type !== "string"
    ) {
      throw new Error("GitHub API returned an invalid Git object.");
    }
    return { sha: value.sha, type: value.type };
  }

  function readReference(value: unknown): GitReference {
    if (typeof value !== "object" || value === null || !("object" in value)) {
      throw new Error("GitHub API returned an invalid Git reference.");
    }
    return { object: readGitObject(value.object) };
  }

  function readCommitSha(value: unknown): string {
    if (
      typeof value !== "object" ||
      value === null ||
      !("sha" in value) ||
      typeof value.sha !== "string" ||
      !SHA_PATTERN.test(value.sha)
    ) {
      throw new Error("GitHub API returned an invalid commit SHA.");
    }
    return value.sha;
  }

  async function resolveTag(tag: string): Promise<string | undefined> {
    let ref: GitReference;
    try {
      const path = `/git/ref/tags/${tag
        .split("/")
        .map(encodeURIComponent)
        .join("/")}`;
      ref = readReference(await getJson(path));
    } catch (error) {
      if (error instanceof GitHubApiError && error.status === 404) {
        return undefined;
      }
      throw error;
    }

    let object = ref.object;
    const seen = new Set<string>();
    while (object.type === "tag") {
      if (seen.has(object.sha)) {
        throw new Error("GitHub returned a circular annotated tag.");
      }
      seen.add(object.sha);

      const tagObject = await getJson(`/git/tags/${encodeURIComponent(object.sha)}`);
      if (
        typeof tagObject !== "object" ||
        tagObject === null ||
        !("object" in tagObject)
      ) {
        throw new Error("GitHub API returned an invalid annotated tag.");
      }
      object = readGitObject(tagObject.object);
    }

    if (object.type !== "commit" || !SHA_PATTERN.test(object.sha)) {
      throw new Error("GitHub tag does not resolve to a commit.");
    }
    return object.sha;
  }

  async function resolveBranch(branch: string): Promise<string | undefined> {
    try {
      const path = `/git/ref/heads/${branch
        .split("/")
        .map(encodeURIComponent)
        .join("/")}`;
      const ref = readReference(await getJson(path));
      if (ref.object.type !== "commit" || !SHA_PATTERN.test(ref.object.sha)) {
        throw new Error("GitHub branch does not resolve to a commit.");
      }
      return ref.object.sha;
    } catch (error) {
      if (error instanceof GitHubApiError && error.status === 404) {
        return undefined;
      }
      throw error;
    }
  }

  const { ref, owner, repository } = reference;
  const repositoryName = `${owner}/${repository}`;

  if (SHA_PATTERN.test(ref)) {
    try {
      const commit = await getJson(`/commits/${encodeURIComponent(ref)}`);
      return { sha: readCommitSha(commit), refType: "sha" };
    } catch (error) {
      if (error instanceof GitHubApiError && error.status === 404) {
        throw new Error(`Commit ${ref} was not found in repository ${repositoryName}.`);
      }
      throw error;
    }
  }

  if (ref.startsWith("refs/heads/")) {
    const sha = await resolveBranch(ref.slice("refs/heads/".length));
    if (sha) {
      return { sha, refType: "branch" };
    }
  } else if (ref.startsWith("refs/tags/")) {
    const sha = await resolveTag(ref.slice("refs/tags/".length));
    if (sha) {
      return { sha, refType: "tag" };
    }
  } else {
    const tagSha = await resolveTag(ref);
    if (tagSha) {
      return { sha: tagSha, refType: "tag" };
    }

    const branchSha = await resolveBranch(ref);
    if (branchSha) {
      return { sha: branchSha, refType: "branch" };
    }
  }

  throw new Error(
    `Could not find repository ${repositoryName} or ref "${ref}". The repository may be private or inaccessible.`,
  );
}
