import { describe, expect, it } from "vitest";
import { listVersionReleases, selectUpgrade } from "../src/release-candidates.js";
import { parseRepositoryOptions } from "../src/command-options.js";

const release = (tagName: string) => ({
  tagName, releaseNotesUrl: `https://github.com/owner/action/releases/tag/${tagName}`,
});
const releases = ["v1.2.9", "v1.3.0", "v2.0.0", "v1.2.10", "v2.9.0", "v3.0.0"].map(release);

describe("upgrade selection", () => {
  it.each(["patch", "minor", "major", "latest"] as const)("accepts explicit %s policy", (policy) => {
    expect(parseRepositoryOptions(["--policy", policy], "upgrade").options.policy).toBe(policy);
  });
  it.each([
    ["patch", "v1.2.10"],
    ["minor", "v1.3.0"],
    ["major", "v2.9.0"],
    ["latest", "v3.0.0"],
  ] as const)("selects the highest version under %s policy", (policy, expected) => {
    expect(selectUpgrade(releases, "v1.2.3", policy)?.tagName).toBe(expected);
  });

  it("does not skip a missing next major or fall back to a within-major update", () => {
    expect(selectUpgrade([release("v5.9.0"), release("v7.0.0")], "v5.1.0", "major")).toBeUndefined();
  });

  it.each(["v5", "v5.2", "5.2.3"])("selects the next major from %s", (current) => {
    expect(selectUpgrade(["v5.9.0", "v6.0.0", "v6.4.0", "v7.0.0"].map(release), current, "major")?.tagName)
      .toBe("v6.4.0");
  });

  it("handles zero-major versions without crossing boundaries for minor or patch", () => {
    const candidates = ["v0.2.4", "v0.3.0", "v1.0.0"].map(release);
    expect(selectUpgrade(candidates, "v0.2.3", "patch")?.tagName).toBe("v0.2.4");
    expect(selectUpgrade(candidates, "v0.2.3", "minor")?.tagName).toBe("v0.3.0");
    expect(selectUpgrade(candidates, "v0.2.3", "major")?.tagName).toBe("v1.0.0");
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
