#!/usr/bin/env node
import { runCli } from "./cli.js";

runCli(process.argv.slice(2), {
  stdout: console.log,
  stderr: console.error,
}).then((exitCode) => {
  process.exitCode = exitCode;
});
