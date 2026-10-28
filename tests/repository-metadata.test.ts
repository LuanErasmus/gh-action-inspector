import { describe, expect, it, vi } from "vitest";
import {
  getRepositoryMetadata,
  type GetRepositoryMetadataOptions,
} from "../src/repository-metadata.js";

const repository = { owner: "actions", repository: "checkout" };

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mockFetch(result: Response): GetRepositoryMetadataOptions["fetch"] {
  return async () => result;
}

describe("getRepositoryMetadata", () => {
  it("returns full name, license, and archived status", async () => {
    const fetch = mockFetch(
      response({
        full_name: "actions/checkout",
        license: { name: "MIT License", spdx_id: "MIT" },
        archived: false,
      }),
    );

    await expect(getRepositoryMetadata(repository, { fetch })).resolves.toEqual({
      fullName: "actions/checkout",
      license: { name: "MIT License", spdxId: "MIT" },
      archived: false,
    });
  });

  it("returns null license when GitHub has not detected a license", async () => {
    const fetch = mockFetch(
      response({
        full_name: "actions/checkout",
        license: null,
        archived: true,
      }),
    );

    await expect(getRepositoryMetadata(repository, { fetch })).resolves.toEqual({
      fullName: "actions/checkout",
      license: null,
      archived: true,
    });
  });

  it("preserves the license name when GitHub has no SPDX identifier", async () => {
    const fetch = mockFetch(
      response({
        full_name: "actions/checkout",
        license: { name: "Other", spdx_id: null },
        archived: false,
      }),
    );

    await expect(getRepositoryMetadata(repository, { fetch })).resolves.toEqual({
      fullName: "actions/checkout",
      license: { name: "Other", spdxId: null },
      archived: false,
    });
  });

  it("reports repositories that cannot be found", async () => {
    await expect(
      getRepositoryMetadata(repository, {
        fetch: mockFetch(response({ message: "Not Found" }, 404)),
      }),
    ).rejects.toThrow(
      "Repository actions/checkout was not found or is inaccessible.",
    );
  });

  it("reports GitHub API errors clearly", async () => {
    await expect(
      getRepositoryMetadata(repository, {
        fetch: mockFetch(response({ message: "Rate limit exceeded" }, 403)),
      }),
    ).rejects.toThrow(/HTTP 403/);
  });

  it("reports malformed repository metadata", async () => {
    await expect(
      getRepositoryMetadata(repository, {
        fetch: mockFetch(response({ full_name: "actions/checkout" })),
      }),
    ).rejects.toThrow("GitHub API returned invalid repository metadata.");
  });

  it("reports malformed license metadata", async () => {
    await expect(
      getRepositoryMetadata(repository, {
        fetch: mockFetch(
          response({
            full_name: "actions/checkout",
            license: { name: 123 },
            archived: false,
          }),
        ),
      }),
    ).rejects.toThrow("GitHub API returned invalid license metadata.");
  });

  it("uses the shared GitHub API client authentication option", async () => {
    const fetch = vi.fn(async () =>
      response({
        full_name: "actions/checkout",
        license: null,
        archived: false,
      }),
    );

    await getRepositoryMetadata(repository, { fetch, token: "test-token" });

    expect(fetch).toHaveBeenCalledWith(
      "https://api.github.com/repos/actions/checkout",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer test-token",
        }),
      }),
    );
  });
});
