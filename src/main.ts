#!/usr/bin/env node
import { runCli } from "./cli.js";

runCli(process.argv.slice(2), {
  stdout: console.log,
  stderr: console.error,
  color: Boolean(process.stdout.isTTY && process.stdout.hasColors?.()),
  status: process.stderr.isTTY
    ? (message) => process.stderr.write(message === null ? "\r\x1b[K" : `\r\x1b[K${message}`)
    : undefined,
}).then((exitCode) => {
  process.exitCode = exitCode;
});
