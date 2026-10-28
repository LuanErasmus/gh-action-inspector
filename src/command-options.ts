import type { ScanOptions } from "./scan.js";

export function parseRepositoryOptions(args: string[], mode: "scan" | "pin" | "upgrade"): {
  directory: string; json: boolean; options: ScanOptions;
} {
  let directory: string | undefined;
  let json = false;
  let dryRun = false;
  const options: ScanOptions = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--json") { json = true; continue; }
    if (arg === "--dry-run" && mode !== "scan") { dryRun = true; continue; }
    if (arg === "--write" && mode !== "scan") { options.write = true; continue; }
    if (arg === "--policy" && mode === "upgrade") {
      const value = args[++i];
      if (value !== "patch" && value !== "major" && value !== "latest") {
        throw new Error("--policy must be patch, major (within the current major), or latest.");
      }
      options.policy = value;
      continue;
    }
    if (arg === "--fail-on" && mode === "scan") {
      const values = args[++i]?.split(",") ?? [];
      if (!values.length || values.some((value) => !["unpinned", "archived", "publisher"].includes(value))) {
        throw new Error("--fail-on accepts unpinned,archived,publisher.");
      }
      options.failOn = values.map((value) => {
        if (value === "unpinned" || value === "archived" || value === "publisher") return value;
        throw new Error("Invalid policy.");
      });
      continue;
    }
    if (arg === "--allow-publishers" && mode === "scan") {
      const value = args[++i];
      if (!value || value.split(",").some((owner) => !/^[a-z0-9][a-z0-9-]*$/i.test(owner))) {
        throw new Error("--allow-publishers requires comma-separated GitHub owners.");
      }
      options.allowedPublishers = value.split(",");
      continue;
    }
    if (arg.startsWith("-") || directory !== undefined) throw new Error(`Unexpected argument: ${arg}`);
    directory = arg;
  }
  if (dryRun && options.write) throw new Error("--dry-run and --write cannot be combined.");
  if (options.failOn?.includes("publisher") && !options.allowedPublishers?.length) {
    throw new Error("--fail-on publisher requires --allow-publishers.");
  }
  return { directory: directory ?? ".", json, options };
}
