import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const TTL = 5 * 60_000;

export class ApiCache {
  constructor(
    private readonly directory = process.env.ACTION_INSPECTOR_CACHE_DIR ||
      join(homedir(), ".cache", "gh-action-inspector"),
    private readonly now = () => Date.now(),
  ) {}

  private path(key: string): string {
    return join(this.directory, `${createHash("sha256").update(key).digest("hex")}.json`);
  }

  async read(key: string): Promise<{ value: unknown } | undefined> {
    let text: string;
    try {
      text = await readFile(this.path(key), "utf8");
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return;
      throw new Error("Could not read the Action Inspector API cache. Use --no-cache to bypass it.");
    }
    let data: unknown;
    try { data = JSON.parse(text); } catch {
      throw new Error("The Action Inspector API cache is invalid. Use --no-cache to bypass it.");
    }
    if (typeof data !== "object" || data === null || !("expires" in data) ||
        typeof data.expires !== "number" || !("value" in data)) {
      throw new Error("The Action Inspector API cache is invalid. Use --no-cache to bypass it.");
    }
    if (data.expires <= this.now()) return;
    return { value: data.value };
  }

  async write(key: string, value: unknown): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const target = this.path(key);
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify({ expires: this.now() + TTL, value }), { mode: 0o600 });
      await rename(temporary, target);
    } catch {
      await rm(temporary, { force: true });
      throw new Error("Could not update the Action Inspector API cache. Use --no-cache to bypass it.");
    }
  }
}
