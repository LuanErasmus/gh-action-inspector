import { describe, expect, it } from "vitest";
import { findVersionTagForSha } from "../src/find-version-tag.js";

const repository = { owner: "actions", repository: "checkout" };
const sha = "a".repeat(40);
const otherSha = "b".repeat(40);

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function tag(name: string, commitSha: string) {
  return { name, commit: { sha: commitSha } };
}

describe("findVersionTagForSha", () => {
  it("returns the most specific version tag pointing to the commit", async () => {
    const urls: string[] = [];
    await expect(
      findVersionTagForSha(repository, sha.toUpperCase(), {
        fetch: async (input) => {
          urls.push(String(input));
          return response([
            tag("v5.0.0", otherSha),
            tag("v4", sha),
            tag("v4.2.2", sha),
            tag("v4.2", sha),
          ]);
        },
      }),
    ).resolves.toBe("v4.2.2");
    expect(urls).toEqual([
      "https://api.github.com/repos/actions/checkout/tags?per_page=100&page=1",
    ]);
  });

  it("prefers version tags over other tag names", async () => {
    await expect(
      findVersionTagForSha(repository, sha, {
        fetch: async () => response([tag("latest", sha), tag("v1", sha)]),
      }),
    ).resolves.toBe("v1");
  });

  it("searches later pages until a short page is returned", async () => {
    const pages = [
      Array.from({ length: 100 }, (_, index) => tag(`v0.${index}`, otherSha)),
      [tag("v3.6.0", sha)],
    ];
    let calls = 0;
    await expect(
      findVersionTagForSha(repository, sha, {
        fetch: async () => response(pages[calls++]),
      }),
    ).resolves.toBe("v3.6.0");
    expect(calls).toBe(2);
  });

  it("returns null when no tag points to the commit", async () => {
    await expect(
      findVersionTagForSha(repository, sha, {
        fetch: async () => response([tag("v1.0.0", otherSha)]),
      }),
    ).resolves.toBeNull();
  });

  it.each([{ message: "nope" }, [{ name: "v1" }], [{ name: 1, commit: { sha } }]])(
    "rejects malformed tag lists",
    async (body) => {
      await expect(
        findVersionTagForSha(repository, sha, { fetch: async () => response(body) }),
      ).rejects.toThrow("GitHub API returned an invalid tag list.");
    },
  );

  it("reports GitHub API errors", async () => {
    await expect(
      findVersionTagForSha(repository, sha, {
        fetch: async () => response({ message: "Forbidden" }, 403),
      }),
    ).rejects.toThrow(/HTTP 403/);
  });
});
