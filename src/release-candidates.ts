import { createGitHubApiClient, type GitHubApiOptions } from "./github-api.js";
import type { ParsedActionReference } from "./parse-reference.js";
import { compareVersions, isVersionTag } from "./version.js";
import type { LatestRelease } from "./latest-release.js";

export type UpgradePolicy = "patch" | "minor" | "major" | "latest";

/** Lists stable version releases, not unrelated products or moving major tags. */
export async function listVersionReleases(
  repository: Pick<ParsedActionReference, "owner" | "repository">,
  options: GitHubApiOptions = {},
): Promise<LatestRelease[]> {
  const client = createGitHubApiClient(options);
  const releases: LatestRelease[] = [];
  for (let page = 1; page <= 20; page++) {
    const data = await client.getRepositoryJson(
      repository.owner, repository.repository, `/releases?per_page=100&page=${page}`,
    );
    if (!Array.isArray(data)) {
      throw new Error("GitHub API returned an invalid release list.");
    }
    for (const item of data) {
      if (typeof item !== "object" || item === null ||
          typeof item.tag_name !== "string" ||
          typeof item.html_url !== "string" ||
          typeof item.draft !== "boolean" || typeof item.prerelease !== "boolean") {
        throw new Error("GitHub API returned invalid release metadata.");
      }
      if (item.draft || item.prerelease || !/^v?\d+\.\d+\.\d+$/.test(item.tag_name)) continue;
      const url = new URL(item.html_url);
      if (url.protocol !== "https:") throw new Error("GitHub API returned an invalid release URL.");
      if (typeof item.published_at !== "string" || !Number.isFinite(Date.parse(item.published_at))) {
        throw new Error("GitHub API returned a missing or invalid release publication date.");
      }
      releases.push({ tagName: item.tag_name, releaseNotesUrl: item.html_url, publishedAt: item.published_at });
    }
    if (data.length < 100) {
      return releases.sort((a, b) => compareVersions(b.tagName, a.tagName));
    }
  }
  throw new Error("Release search exceeded 2,000 releases; cannot safely select an upgrade.");
}

export function selectUpgrade(
  releases: LatestRelease[], current: string, policy: UpgradePolicy,
  minReleaseAge = 0, now = Date.now(),
): LatestRelease | undefined {
  if (!Number.isSafeInteger(minReleaseAge) || minReleaseAge < 0 ||
      !Number.isFinite(minReleaseAge * 86_400_000) || !Number.isFinite(now)) {
    throw new Error("Minimum release age must be a non-negative whole number of days.");
  }
  if (!isVersionTag(current)) {
    throw new Error("Cannot select an upgrade without a numeric current version tag.");
  }
  const parts = (version: string) => version.replace(/^v/, "").split(".").map(Number);
  const [major, minor = 0] = parts(current);
  return releases.filter((release) => {
    if (!/^v?\d+\.\d+\.\d+$/.test(release.tagName) || compareVersions(release.tagName, current) <= 0) return false;
    const [nextMajor, nextMinor] = parts(release.tagName);
    const allowed = policy === "latest" ||
      (policy === "major" ? nextMajor === major + 1
        : nextMajor === major && (policy === "minor" || nextMinor === minor));
    if (!allowed || minReleaseAge === 0) return allowed;
    const published = release.publishedAt ? Date.parse(release.publishedAt) : NaN;
    if (!Number.isFinite(published)) {
      throw new Error(`Missing or invalid publication date for ${release.tagName}; cannot enforce minimum release age.`);
    }
    return now - published >= minReleaseAge * 86_400_000;
  }).sort((a, b) => compareVersions(b.tagName, a.tagName))[0];
}
