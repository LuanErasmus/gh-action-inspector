#!/usr/bin/env node
import { runCli } from "./cli.js";
import { getGitHubToken } from "./authentication.js";
import { createProgress } from "./progress.js";

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (args.includes("--no-cache") || args.includes("--write")) {
    process.env.ACTION_INSPECTOR_NO_CACHE = "1";
  }
  const token = getGitHubToken();
  if (token) {
    process.env.GH_TOKEN = token;
  }
  const status = process.stderr.isTTY ? createProgress(
    (text) => process.stderr.write(text),
    { color: Boolean(process.stderr.hasColors?.()), width: () => process.stderr.columns },
  ) : undefined;
  const interrupt = () => {
    status?.(null);
    process.exit(130);
  };
  process.once("SIGINT", interrupt);
  try {
    return await runCli(args.filter((arg) => arg !== "--no-cache"), {
      stdout: console.log,
      stderr: console.error,
      color: Boolean(process.stdout.isTTY && process.stdout.hasColors?.()),
      width: process.stdout.columns || 100,
      status,
    });
  } finally {
    status?.(null);
    process.removeListener("SIGINT", interrupt);
  }
}

main().then((exitCode) => {
  process.exitCode = exitCode;
}).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Could not start Action Inspector.");
  process.exitCode = 1;
});
