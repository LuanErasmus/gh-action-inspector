import { describe, expect, it } from "vitest";
import { parseActionReference } from "../src/parse-reference.js";
import { generateShaPinnedReference } from "../src/pinned-reference.js";

const sha = "a".repeat(40);

describe("generateShaPinnedReference", () => {
  it("replaces a tag with the resolved full SHA and keeps the original ref as a comment", () => {
    expect(
      generateShaPinnedReference(
        parseActionReference("actions/checkout@v4"),
        sha,
      ),
    ).toBe(`actions/checkout@${sha} # v4`);
  });

  it("preserves nested Action subpaths", () => {
    expect(
      generateShaPinnedReference(
        parseActionReference("github/codeql-action/analyze@v3"),
        sha,
      ),
    ).toBe(`github/codeql-action/analyze@${sha} # v3`);
  });

  it("preserves the original branch ref in the comment", () => {
    expect(
      generateShaPinnedReference(
        parseActionReference("owner/repository/path/to/action@feature/nested"),
        sha,
      ),
    ).toBe(`owner/repository/path/to/action@${sha} # feature/nested`);
  });

  it("leaves an already pinned reference unchanged", () => {
    expect(
      generateShaPinnedReference(
        parseActionReference(`actions/checkout@${sha}`),
        sha,
      ),
    ).toBe(`actions/checkout@${sha}`);
  });

  it("rejects a resolved SHA that does not match an existing pin", () => {
    expect(() =>
      generateShaPinnedReference(
        parseActionReference(`actions/checkout@${sha}`),
        "b".repeat(40),
      ),
    ).toThrow("Resolved SHA does not match the SHA already pinned in the reference.");
  });

  it.each(["", "abc", "g".repeat(40)])(
    "rejects an invalid resolved SHA %j",
    (resolvedSha) => {
      expect(() =>
        generateShaPinnedReference(
          parseActionReference("actions/checkout@v4"),
          resolvedSha,
        ),
      ).toThrow("Resolved commit SHA must be a full 40-character hexadecimal SHA.");
    },
  );
});
