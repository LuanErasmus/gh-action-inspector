import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resolveActionReference,
  type ResolveActionReferenceOptions,
} from "../src/resolve-reference.js";

const reference = {
  owner: "actions",
  repository: "checkout",
  ref: "v4",
};
const commitSha = "a".repeat(40);

afterEach(() => {
  vi.unstubAllEnvs();
});

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mockFetch(
  routes: Record<string, Response>,
): ResolveActionReferenceOptions["fetch"] {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    const result = routes[url];
    if (!result) {
      return response({ message: "Not Found" }, 404);
    }
    return result;
  }) as ResolveActionReferenceOptions["fetch"];
}

describe("resolveActionReference", () => {
  it("resolves lightweight tags", async () => {
    const fetch = mockFetch({
      "https://api.github.com/repos/actions/checkout/git/ref/tags/v4": response({
        object: { sha: commitSha, type: "commit" },
      }),
    });

    await expect(resolveActionReference(reference, { fetch })).resolves.toEqual({
      sha: commitSha,
      refType: "tag",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("resolves annotated tags through tag objects to the commit", async () => {
    const tagObjectSha = "b".repeat(40);
    const fetch = mockFetch({
      "https://api.github.com/repos/actions/checkout/git/ref/tags/v4": response({
        object: { sha: tagObjectSha, type: "tag" },
      }),
      [`https://api.github.com/repos/actions/checkout/git/tags/${tagObjectSha}`]:
        response({
          object: { sha: commitSha, type: "commit" },
        }),
    });

    await expect(resolveActionReference(reference, { fetch })).resolves.toEqual({
      sha: commitSha,
      refType: "tag",
    });
  });

  it("resolves branches with nested names after trying tags", async () => {
    const branchRef = { ...reference, ref: "feature/nested" };
    const fetch = mockFetch({
      "https://api.github.com/repos/actions/checkout/git/ref/heads/feature/nested":
        response({ object: { sha: commitSha, type: "commit" } }),
    });

    await expect(resolveActionReference(branchRef, { fetch })).resolves.toEqual({
      sha: commitSha,
      refType: "branch",
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("resolves explicit refs/heads and refs/tags prefixes", async () => {
    const branchFetch = mockFetch({
      "https://api.github.com/repos/actions/checkout/git/ref/heads/main": response({
        object: { sha: commitSha, type: "commit" },
      }),
    });
    await expect(
      resolveActionReference({ ...reference, ref: "refs/heads/main" }, {
        fetch: branchFetch,
      }),
    ).resolves.toEqual({ sha: commitSha, refType: "branch" });
    expect(branchFetch).toHaveBeenCalledTimes(1);

    const tagFetch = mockFetch({
      "https://api.github.com/repos/actions/checkout/git/ref/tags/v4": response({
        object: { sha: commitSha, type: "commit" },
      }),
    });
    await expect(
      resolveActionReference({ ...reference, ref: "refs/tags/v4" }, {
        fetch: tagFetch,
      }),
    ).resolves.toEqual({ sha: commitSha, refType: "tag" });
  });

  it("verifies and resolves full commit SHAs", async () => {
    const fetch = mockFetch({
      [`https://api.github.com/repos/actions/checkout/commits/${commitSha}`]:
        response({ sha: commitSha }),
    });

    await expect(
      resolveActionReference({ ...reference, ref: commitSha }, { fetch }),
    ).resolves.toEqual({ sha: commitSha, refType: "sha" });
  });

  it("sends an optional GitHub token as a bearer token", async () => {
    const fetch = mockFetch({
      "https://api.github.com/repos/actions/checkout/git/ref/tags/v4": response({
        object: { sha: commitSha, type: "commit" },
      }),
    });

    await resolveActionReference(reference, { fetch, token: "test-token" });
    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer test-token",
        }),
      }),
    );
  });

  it("can resolve public repositories without authentication", async () => {
    vi.stubEnv("GITHUB_TOKEN", "");
    const fetch = mockFetch({
      "https://api.github.com/repos/actions/checkout/git/ref/tags/v4": response({
        object: { sha: commitSha, type: "commit" },
      }),
    });

    await resolveActionReference(reference, { fetch });
    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.not.objectContaining({
          Authorization: expect.any(String),
        }),
      }),
    );
  });

  it("uses GITHUB_TOKEN from the environment", async () => {
    vi.stubEnv("GITHUB_TOKEN", "environment-token");
    const fetch = mockFetch({
      "https://api.github.com/repos/actions/checkout/git/ref/tags/v4": response({
        object: { sha: commitSha, type: "commit" },
      }),
    });

    await resolveActionReference(reference, { fetch });
    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer environment-token",
        }),
      }),
    );
  });

  it("reports when the repository or ref cannot be found", async () => {
    const fetch = mockFetch({});

    await expect(resolveActionReference(reference, { fetch })).rejects.toThrow(
      'Could not find repository actions/checkout or ref "v4".',
    );
  });

  it("reports when a full commit SHA cannot be found", async () => {
    const fetch = mockFetch({});

    await expect(
      resolveActionReference({ ...reference, ref: commitSha }, { fetch }),
    ).rejects.toThrow(`Commit ${commitSha} was not found in repository actions/checkout.`);
  });

  it("does not hide GitHub API errors other than not found", async () => {
    const fetch = vi.fn(async () => response({ message: "Rate limit exceeded" }, 403));

    await expect(resolveActionReference(reference, { fetch })).rejects.toThrow(
      "GitHub API request failed with HTTP 403 (rate limit or access denied). Set GITHUB_TOKEN to authenticate.",
    );
  });
});
