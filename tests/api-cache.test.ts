import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiCache } from "../src/api-cache.js";
import { createGitHubApiClient } from "../src/github-api.js";

const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});
async function directory() {
  const path = await mkdtemp(join(tmpdir(), "inspector-cache-"));
  directories.push(path);
  return path;
}

describe("API caching", () => {
  it("expires entries exactly after five minutes", async () => {
    let now = 0;
    const cache = new ApiCache(await directory(), () => now);
    await cache.write("key", { data: 1 });
    now = 299_999;
    expect(await cache.read("key")).toEqual({ value: { data: 1 } });
    now = 300_000;
    expect(await cache.read("key")).toBeUndefined();
  });

  it("reuses responses and isolates different credentials without writing tokens", async () => {
    const path = await directory();
    vi.stubEnv("ACTION_INSPECTOR_CACHE_DIR", path);
    const fetch = vi.fn(async () => new Response('{"ok":true}'));
    const get = (token: string) => createGitHubApiClient({ fetch, token, cache: true })
      .getRepositoryJson("owner", "action", "");
    await get("private-token-a");
    await get("private-token-a");
    await get("private-token-b");
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const name of await readdir(path)) {
      expect(name).not.toContain("private-token");
      expect(await readFile(join(path, name), "utf8")).not.toContain("private-token");
    }
  });

  it("deduplicates in-flight requests across API clients", async () => {
    vi.stubEnv("ACTION_INSPECTOR_CACHE_DIR", await directory());
    const fetch = vi.fn(async () => new Response('{"ok":true}'));
    const get = () => createGitHubApiClient({ fetch, cache: true, token: "inflight" })
      .getRepositoryJson("owner", "action", "");
    await Promise.all([get(), get(), get()]);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("does not cache failed requests and cache:false bypasses reads and writes", async () => {
    const path = await directory();
    vi.stubEnv("ACTION_INSPECTOR_CACHE_DIR", path);
    const fetch = vi.fn(async () => new Response("{}", { status: 403 }));
    const client = createGitHubApiClient({ fetch, cache: true, token: "failure" });
    await expect(client.getRepositoryJson("owner", "action", "")).rejects.toThrow("HTTP 403");
    expect(await readdir(path)).toEqual([]);
    const bypass = createGitHubApiClient({
      fetch: async () => new Response("{}"), cache: false,
    });
    await bypass.getRepositoryJson("owner", "action", "");
    expect(await readdir(path)).toEqual([]);
  });

  it("reports corrupt cache files explicitly", async () => {
    const path = await directory();
    const cache = new ApiCache(path);
    await cache.write("key", {});
    await writeFile(join(path, (await readdir(path))[0]), "invalid");
    await expect(cache.read("key")).rejects.toThrow("--no-cache");
  });

  it("provides reset time for primary rate limits and retry information for secondary limits", async () => {
    await expect(createGitHubApiClient({
      fetch: async () => new Response("{}", {
        status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1800000000" },
      }),
    }).getRepositoryJson("owner", "action", "")).rejects.toThrow("Resets at 2027-01-15T08:00:00.000Z");
    await expect(createGitHubApiClient({
      fetch: async () => new Response("{}", { status: 429, headers: { "retry-after": "60" } }),
    }).getRepositoryJson("owner", "action", "")).rejects.toThrow("Retry after 60 seconds");
  });
});
