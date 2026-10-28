import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getGitHubToken } from "../src/authentication.js";

vi.mock("node:child_process", () => ({ execFileSync: vi.fn() }));

beforeEach(() => {
  vi.stubEnv("GH_TOKEN", "");
  vi.stubEnv("GITHUB_TOKEN", "");
  vi.mocked(execFileSync).mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getGitHubToken", () => {
  it("prefers GH_TOKEN over GITHUB_TOKEN and the stored CLI token", () => {
    vi.stubEnv("GH_TOKEN", "gh-token");
    vi.stubEnv("GITHUB_TOKEN", "github-token");
    expect(getGitHubToken()).toBe("gh-token");
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it("uses GITHUB_TOKEN without invoking gh", () => {
    vi.stubEnv("GITHUB_TOKEN", "github-token");
    expect(getGitHubToken()).toBe("github-token");
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it("uses the stored github.com CLI token and trims its newline", () => {
    vi.mocked(execFileSync).mockReturnValue("stored-token\r\n");
    expect(getGitHubToken()).toBe("stored-token");
    expect(execFileSync).toHaveBeenCalledExactlyOnceWith(
      "gh",
      ["auth", "token", "--hostname", "github.com"],
      expect.objectContaining({
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 10_000,
        windowsHide: true,
      }),
    );
  });

  it.each([{ code: "ENOENT" }, { status: 1 }])(
    "allows public access when gh is missing or not logged in (%j)",
    (error) => {
      vi.mocked(execFileSync).mockImplementation(() => { throw error; });
      expect(getGitHubToken()).toBeUndefined();
    },
  );

  it.each([{ code: "ETIMEDOUT" }, { status: 2 }])(
    "reports unexpected credential lookup failures without exposing captured output (%j)",
    (error) => {
      vi.mocked(execFileSync).mockImplementation(() => {
        throw { ...error, stdout: "secret-token", stderr: "private-details" };
      });
      expect(getGitHubToken).toThrow(
        "Could not read GitHub CLI credentials. Check `gh auth status --hostname github.com` or set GH_TOKEN.",
      );
    },
  );
});
