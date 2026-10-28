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
