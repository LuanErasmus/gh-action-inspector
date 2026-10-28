#!/usr/bin/env node
import { runCli } from "./cli.js";
import { getGitHubToken } from "./authentication.js";

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (args.includes("--no-cache") || args.includes("--write")) {
    process.env.ACTION_INSPECTOR_NO_CACHE = "1";
  }
  const token = getGitHubToken();
  if (token) {
    process.env.GH_TOKEN = token;
  }
  return runCli(args.filter((arg) => arg !== "--no-cache"), {
    stdout: console.log,
    stderr: console.error,
    color: Boolean(process.stdout.isTTY && process.stdout.hasColors?.()),
    width: process.stdout.columns || 100,
    status: process.stderr.isTTY
      ? (message) => process.stderr.write(message === null ? "\r\x1b[K" : `\r\x1b[K${message}`)
      : undefined,
  });
}

main().then((exitCode) => {
  process.exitCode = exitCode;
}).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Could not start Action Inspector.");
  process.exitCode = 1;
});
