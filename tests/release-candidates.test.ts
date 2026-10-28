import { describe, expect, it } from "vitest";
import { listVersionReleases, selectUpgrade } from "../src/release-candidates.js";

const release = (tagName: string) => ({
  tagName, releaseNotesUrl: `https://github.com/owner/action/releases/tag/${tagName}`,
});
const releases = ["v1.2.9", "v1.3.0", "v2.0.0", "v1.2.10"].map(release);

describe("upgrade selection", () => {
  it.each([
    ["patch", "v1.2.10"],
    ["major", "v1.3.0"],
    ["latest", "v2.0.0"],
  ] as const)("selects the highest version under %s policy", (policy, expected) => {
    expect(selectUpgrade(releases, "v1.2.3", policy)?.tagName).toBe(expected);
  });

  it("never downgrades or recommends the same release", () => {
    expect(selectUpgrade(releases, "v3.0.0", "latest")).toBeUndefined();
    expect(selectUpgrade([release("v1.2.3")], "v1.2.3", "patch")).toBeUndefined();
  });

  it("refuses an unknown current version and excludes unrelated and prerelease tags", () => {
    expect(() => selectUpgrade(releases, "main", "latest")).toThrow("numeric current version");
    expect(selectUpgrade([release("bundle-v8.0.0"), release("v8.0.0-rc.1")], "v1", "latest")).toBeUndefined();
  });

  it("paginates releases and excludes drafts, prereleases, and unrelated products", async () => {
    const body = (tag: string, extra: object = {}) => ({
      tag_name: tag, html_url: release(tag).releaseNotesUrl,
      draft: false, prerelease: false, ...extra,
    });
    const urls: string[] = [];
    const result = await listVersionReleases({ owner: "owner", repository: "action" }, {
      fetch: async (url) => {
        urls.push(String(url));
        return new Response(JSON.stringify(urls.length === 1
          ? Array.from({ length: 100 }, () => body("bundle-v9.0.0"))
          : [body("v1.0.0"), body("v3.0.0", { draft: true }), body("v4.0.0", { prerelease: true }), body("v2.0.0")]));
      },
    });
    expect(result.map((item) => item.tagName)).toEqual(["v2.0.0", "v1.0.0"]);
    expect(urls[1]).toContain("page=2");
  });

  it("reports invalid release lists", async () => {
    await expect(listVersionReleases({ owner: "owner", repository: "action" }, {
      fetch: async () => new Response("{}"),
    })).rejects.toThrow("invalid release list");
  });
});
