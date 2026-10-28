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
    vi.stubEnv("GH_TOKEN", "");
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
    vi.stubEnv("GH_TOKEN", "");
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

  describe("short commit SHAs", () => {
    const fullSha = "3d3c42e5aac5ba805825da76410c181273ba90b1";
    const base = "https://api.github.com/repos/actions/checkout";

    it.each(["3d3c42", "3d3c42e", "3D3C42E5AAC5"])(
      "resolves %s after trying tags and branches",
      async (shortSha) => {
        const fetch = mockFetch({
          [`${base}/commits/${shortSha}`]: response({ sha: fullSha }),
        });

        await expect(
          resolveActionReference({ ...reference, ref: shortSha }, { fetch }),
        ).resolves.toEqual({ sha: fullSha, refType: "short-sha" });
        expect(vi.mocked(fetch!).mock.calls.map(([url]) => String(url))).toEqual([
          `${base}/git/ref/tags/${shortSha}`,
          `${base}/git/ref/heads/${shortSha}`,
          `${base}/commits/${shortSha}`,
        ]);
      },
    );

    it("prefers a tag or branch with a SHA-like name", async () => {
      const fetch = mockFetch({
        [`${base}/git/ref/heads/deadbeef`]: response({
          object: { sha: commitSha, type: "commit" },
        }),
      });

      await expect(
        resolveActionReference({ ...reference, ref: "deadbeef" }, { fetch }),
      ).resolves.toEqual({ sha: commitSha, refType: "branch" });
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it.each(["3d3c4", "3d3c42z", "not-a-sha"])(
      "does not look up %s as a commit",
      async (ref) => {
        const fetch = mockFetch({});

        await expect(
          resolveActionReference({ ...reference, ref }, { fetch }),
        ).rejects.toThrow(`Could not find repository actions/checkout or ref "${ref}".`);
        expect(fetch).toHaveBeenCalledTimes(2);
      },
    );

    it.each([404, 422])(
      "reports an unknown or ambiguous short SHA (HTTP %i) as not found",
      async (status) => {
        const fetch = mockFetch({
          [`${base}/commits/ffffff1`]: response({ message: "No commit found" }, status),
        });

        await expect(
          resolveActionReference({ ...reference, ref: "ffffff1" }, { fetch }),
        ).rejects.toThrow('Could not find repository actions/checkout or ref "ffffff1".');
      },
    );

    it("rejects a commit that does not start with the short SHA", async () => {
      const fetch = mockFetch({
        [`${base}/commits/3d3c42`]: response({ sha: commitSha }),
      });

      await expect(
        resolveActionReference({ ...reference, ref: "3d3c42" }, { fetch }),
      ).rejects.toThrow("GitHub API returned a commit that does not match the short SHA.");
    });
  });

  it("does not hide GitHub API errors other than not found", async () => {
    const fetch = vi.fn(async () => response({ message: "Rate limit exceeded" }, 403));

    await expect(resolveActionReference(reference, { fetch })).rejects.toThrow(
      "GitHub API request failed with HTTP 403 (rate limit or access denied). Check `gh auth status --hostname github.com`, or set GH_TOKEN or GITHUB_TOKEN.",
    );
  });
});
