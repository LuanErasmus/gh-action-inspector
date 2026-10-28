import { describe, expect, it } from "vitest";
import {
  getLatestRelease,
  type GetLatestReleaseOptions,
} from "../src/latest-release.js";

const repository = { owner: "actions", repository: "checkout" };

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mockFetch(result: Response): GetLatestReleaseOptions["fetch"] {
  return async () => result;
}

describe("getLatestRelease", () => {
  it("returns the latest release tag and notes URL", async () => {
    await expect(
      getLatestRelease(repository, {
        fetch: mockFetch(
          response({
            tag_name: "v6.0.0",
            html_url: "https://github.com/actions/checkout/releases/tag/v6.0.0",
          }),
        ),
      }),
    ).resolves.toEqual({
      tagName: "v6.0.0",
      releaseNotesUrl: "https://github.com/actions/checkout/releases/tag/v6.0.0",
    });
  });

  it("reports when no published release exists", async () => {
    await expect(
      getLatestRelease(repository, {
        fetch: mockFetch(response({ message: "Not Found" }, 404)),
      }),
    ).rejects.toThrow(
      "No latest published release was found for actions/checkout.",
    );
  });

  it("reports other GitHub API errors", async () => {
    await expect(
      getLatestRelease(repository, {
        fetch: mockFetch(response({ message: "Rate limit exceeded" }, 403)),
      }),
    ).rejects.toThrow(/HTTP 403/);
  });

  describe("when the latest release is not a version tag", () => {
    const codeql = { owner: "github", repository: "codeql-action" };
    const release = (tag_name: string, extra: object = {}) => ({
      tag_name,
      html_url: `https://github.com/github/codeql-action/releases/tag/${tag_name}`,
      ...extra,
    });

    function routedFetch(latest: unknown, releases: unknown, urls: string[] = []) {
      return (async (input: string | URL | Request) => {
        const url = String(input);
        urls.push(url);
        return response(url.endsWith("/releases/latest") ? latest : releases);
      }) as GetLatestReleaseOptions["fetch"];
    }

    it("returns the highest published version release", async () => {
      const urls: string[] = [];
      await expect(
        getLatestRelease(codeql, {
          fetch: routedFetch(
            release("codeql-bundle-v2.27.3"),
            [
              release("v5.0.0", { prerelease: true }),
              release("v6.0.0", { draft: true }),
              release("v3.39.1"),
              release("codeql-bundle-v2.27.3"),
              release("v4.39.1"),
              release("v4.9.0"),
            ],
            urls,
          ),
        }),
      ).resolves.toEqual({
        tagName: "v4.39.1",
        releaseNotesUrl: "https://github.com/github/codeql-action/releases/tag/v4.39.1",
      });
      expect(urls).toEqual([
        "https://api.github.com/repos/github/codeql-action/releases/latest",
        "https://api.github.com/repos/github/codeql-action/releases?per_page=100",
      ]);
    });

    it("falls back to the latest release when no release has a version tag", async () => {
      await expect(
        getLatestRelease(codeql, {
          fetch: routedFetch(release("nightly"), [release("nightly")]),
        }),
      ).resolves.toEqual({
        tagName: "nightly",
        releaseNotesUrl: "https://github.com/github/codeql-action/releases/tag/nightly",
      });
    });

    it("rejects an invalid release list", async () => {
      await expect(
        getLatestRelease(codeql, {
          fetch: routedFetch(release("nightly"), { message: "oops" }),
        }),
      ).rejects.toThrow("GitHub API returned an invalid release list.");
    });
  });

  it.each([
    { tag_name: "v6", html_url: "not a URL" },
    { tag_name: "v6", html_url: "http://github.com/actions/checkout/releases/tag/v6" },
    { tag_name: 6, html_url: "https://github.com/actions/checkout/releases/tag/v6" },
  ])("rejects malformed release metadata", async (body) => {
    await expect(
      getLatestRelease(repository, { fetch: mockFetch(response(body)) }),
    ).rejects.toThrow("GitHub API returned invalid latest release metadata.");
  });
});
