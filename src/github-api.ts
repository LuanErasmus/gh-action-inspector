import { createHash } from "node:crypto";
import { ApiCache } from "./api-cache.js";

export interface GitHubApiOptions {
  token?: string;
  fetch?: typeof globalThis.fetch;
  cache?: boolean;
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
const pending = new Map<string, Promise<unknown>>();

export function createGitHubApiClient(options: GitHubApiOptions = {}) {
  const fetcher = options.fetch ?? globalThis.fetch;
  const token = options.token ?? (process.env.GH_TOKEN || process.env.GITHUB_TOKEN);
  const cached = options.cache ?? (!options.fetch && process.env.ACTION_INSPECTOR_NO_CACHE !== "1");
  const cache = new ApiCache();

  return {
    async getRepositoryJson(
      owner: string,
      repository: string,
      path: string,
    ): Promise<unknown> {
      const repositoryPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`;
      const url = `${API_URL}${repositoryPath}${path}`;
      const key = `${createHash("sha256").update(token ?? "anonymous").digest("hex")}:${url}`;
      const request = async (): Promise<unknown> => {
        if (cached) {
          const hit = await cache.read(key);
          if (hit) return hit.value;
        }
        const headers: Record<string, string> = {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
      };
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      const response = await fetcher(url, {
        headers,
      });

      if (!response.ok) {
        const sso = response.headers.get("x-github-sso");
        if (response.status === 403 && /^required(?:;|$)/i.test(sso?.trim() ?? "")) {
          throw new GitHubApiError(
            "GitHub API request failed with HTTP 403: organization SSO authorization is required for the selected credentials. " +
            "Sign in to your organization's SSO, then authorize the GitHub CLI OAuth app or your classic personal access token for that organization in GitHub Settings. " +
            "Check `gh auth status --hostname github.com`. GH_TOKEN and GITHUB_TOKEN override the stored CLI login; authorize or replace the selected token, not a different account. " +
            "See https://docs.github.com/en/authentication/authenticating-with-single-sign-on",
            response.status,
          );
        }
        const remaining = response.headers.get("x-ratelimit-remaining");
        const reset = response.headers.get("x-ratelimit-reset");
        const retry = response.headers.get("retry-after");
        if (response.status === 429 || (response.status === 403 && (remaining === "0" || retry))) {
          const resetDate = reset ? new Date(Number(reset) * 1000) : undefined;
          const date = resetDate && Number.isFinite(resetDate.getTime()) ? resetDate.toISOString() : undefined;
          throw new GitHubApiError(
            `GitHub API rate limit exceeded.${date ? ` Resets at ${date}.` : ""}${retry ? ` Retry after ${retry} seconds.` : ""} Use \`gh auth login\` for authenticated limits.`,
            response.status,
          );
        }
        throw new GitHubApiError(
          response.status === 403
            ? "GitHub API request failed with HTTP 403 (rate limit or access denied). Check `gh auth status --hostname github.com`, or set GH_TOKEN or GITHUB_TOKEN."
            : `GitHub API request failed with HTTP ${response.status}.`,
          response.status,
        );
      }

      const value: unknown = await response.json();
      if (cached) await cache.write(key, value);
      return value;
      };
      if (!cached) return request();
      const existing = pending.get(key);
      if (existing) return existing;
      const promise = request();
      pending.set(key, promise);
      try { return await promise; } finally { pending.delete(key); }
    },
  };
}
