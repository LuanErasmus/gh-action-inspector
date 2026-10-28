import { describe, expect, it } from "vitest";
import { compareCommits } from "../src/compare-commits.js";

const repository = { owner: "actions", repository: "checkout" };
const base = "a".repeat(40);
const head = "b".repeat(40);

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("compareCommits", () => {
  it("returns identical without calling GitHub for the same SHA", async () => {
    await expect(
      compareCommits(repository, base, base.toUpperCase(), {
        fetch: async () => {
          throw new Error("unexpected request");
        },
      }),
    ).resolves.toBe("identical");
  });

  it.each(["ahead", "behind", "identical", "diverged"] as const)(
    "returns the %s comparison status",
    async (status) => {
      const urls: string[] = [];
      await expect(
        compareCommits(repository, base, head, {
          fetch: async (input) => {
            urls.push(String(input));
            return response({ status });
          },
        }),
      ).resolves.toBe(status);
      expect(urls).toEqual([
        `https://api.github.com/repos/actions/checkout/compare/${base}...${head}`,
      ]);
    },
  );

  it.each([{}, { status: "unknown" }, []])("rejects malformed comparisons", async (body) => {
    await expect(
      compareCommits(repository, base, head, { fetch: async () => response(body) }),
    ).rejects.toThrow("GitHub API returned an invalid commit comparison.");
  });

  it("reports GitHub API errors", async () => {
    await expect(
      compareCommits(repository, base, head, {
        fetch: async () => response({ message: "Not Found" }, 404),
      }),
    ).rejects.toThrow(/HTTP 404/);
  });
});
