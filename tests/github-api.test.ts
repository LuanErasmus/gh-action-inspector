import { afterEach, describe, expect, it, vi } from "vitest";
import { createGitHubApiClient } from "../src/github-api.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GitHub API authentication", () => {
  it.each([
    { token: "explicit-token", gh: "gh-token", github: "github-token", expected: "explicit-token" },
    { token: undefined, gh: "gh-token", github: "github-token", expected: "gh-token" },
    { token: undefined, gh: "", github: "github-token", expected: "github-token" },
    { token: undefined, gh: "", github: "", expected: undefined },
  ])("selects the correct token ($expected)", async ({ token, gh, github, expected }) => {
    vi.stubEnv("GH_TOKEN", gh);
    vi.stubEnv("GITHUB_TOKEN", github);
    const fetch = vi.fn(async () => new Response("{}"));
    const client = createGitHubApiClient({ fetch, token });

    await client.getRepositoryJson("actions", "checkout", "");
    expect(fetch).toHaveBeenCalledWith(
      "https://api.github.com/repos/actions/checkout",
      expect.objectContaining({
        headers: expected
          ? expect.objectContaining({ Authorization: `Bearer ${expected}` })
          : expect.not.objectContaining({ Authorization: expect.anything() }),
      }),
    );
  });
});
