export interface GitHubApiOptions {
  token?: string;
  fetch?: typeof globalThis.fetch;
}

export class GitHubApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "GitHubApiError";
  }
}

const API_URL = "https://api.github.com";

export function createGitHubApiClient(options: GitHubApiOptions = {}) {
  const fetcher = options.fetch ?? globalThis.fetch;
  const token = options.token ?? process.env.GITHUB_TOKEN;

  return {
    async getRepositoryJson(
      owner: string,
      repository: string,
      path: string,
    ): Promise<unknown> {
      const headers: Record<string, string> = {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      };
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      const repositoryPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`;
      const response = await fetcher(`${API_URL}${repositoryPath}${path}`, {
        headers,
      });

      if (!response.ok) {
        throw new GitHubApiError(
          response.status === 403
            ? "GitHub API request failed with HTTP 403 (rate limit or access denied). Set GITHUB_TOKEN to authenticate."
            : `GitHub API request failed with HTTP ${response.status}.`,
          response.status,
        );
      }

      return response.json() as Promise<unknown>;
    },
  };
}
