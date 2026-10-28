import { execFileSync } from "node:child_process";

export function getGitHubToken(): string | undefined {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (token) {
    return token;
  }

  try {
    return execFileSync("gh", ["auth", "token", "--hostname", "github.com"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10_000,
      windowsHide: true,
    }).trim() || undefined;
  } catch (error) {
    // Public, unauthenticated access remains available without gh or a login.
    if (
      typeof error === "object" &&
      error !== null &&
      (("code" in error && error.code === "ENOENT") ||
        ("status" in error && error.status === 1))
    ) {
      return undefined;
    }
    // Child-process errors can contain the captured token; do not expose them.
    throw new Error(
      "Could not read GitHub CLI credentials. Check `gh auth status --hostname github.com` or set GH_TOKEN.",
    );
  }
}
