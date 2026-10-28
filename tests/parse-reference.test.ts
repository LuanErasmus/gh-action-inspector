import { describe, expect, it } from "vitest";
import { parseActionReference } from "../src/parse-reference.js";

describe("parseActionReference", () => {
  it.each([
    ["actions/checkout@v4", "actions", "checkout", undefined, "v4"],
    ["docker/login-action@v3", "docker", "login-action", undefined, "v3"],
    [
      "github/codeql-action/analyze@v3",
      "github",
      "codeql-action",
      "analyze",
      "v3",
    ],
    [
      "owner/repository/path/to/action@main",
      "owner",
      "repository",
      "path/to/action",
      "main",
    ],
    [
      "owner/repository/action@refs/heads/feature/one",
      "owner",
      "repository",
      "action",
      "refs/heads/feature/one",
    ],
  ])(
    "parses %s",
    (input, owner, repository, path, ref) => {
      expect(parseActionReference(input)).toEqual({
        owner,
        repository,
        ...(path ? { path } : {}),
        ref,
      });
    },
  );

  it("trims surrounding whitespace", () => {
    expect(parseActionReference("  actions/checkout@v4 \n")).toEqual({
      owner: "actions",
      repository: "checkout",
      ref: "v4",
    });
  });

  it.each([
    ["", /non-empty string/],
    ["   ", /non-empty string/],
    ["actions/checkout", /include a ref/],
    ["checkout@v4", /owner and repository/],
    ["/checkout@v4", /empty path segments/],
    ["actions/@v4", /empty path segments/],
    ["actions/checkout/@v4", /empty path segments/],
    ["actions//checkout@v4", /empty path segments/],
    ["actions/checkout@", /non-empty ref/],
    ["actions/checkout@/main", /non-empty ref/],
    ["actions/checkout@main/", /non-empty ref/],
    ["actions/checkout@v4@extra", /exactly one '@'/],
    ["actions/checkout @v4", /whitespace/],
    ["actions\\checkout@v4", /backslashes/],
  ])("rejects malformed reference %j", (input, error) => {
    expect(() => parseActionReference(input)).toThrow(error);
  });
});
