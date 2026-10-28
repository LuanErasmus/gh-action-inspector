#!/usr/bin/env node
import { runCli } from "./cli.js";
import { getGitHubToken } from "./authentication.js";

async function main(): Promise<number> {
  const token = getGitHubToken();
  if (token) {
    process.env.GH_TOKEN = token;
  }
  return runCli(process.argv.slice(2), {
    stdout: console.log,
    stderr: console.error,
    color: Boolean(process.stdout.isTTY && process.stdout.hasColors?.()),
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
