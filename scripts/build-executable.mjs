// Builds a standalone executable for the current platform using Node.js
// single executable applications: https://nodejs.org/api/single-executable-applications.html
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { build } from "esbuild";
import { inject } from "postject";

const EXTENSION_NAME = "gh-action-inspector";
const OS_NAMES = { win32: "windows", darwin: "darwin", linux: "linux" };
const ARCH_NAMES = { x64: "amd64", arm64: "arm64" };

const os = OS_NAMES[process.platform];
const arch = ARCH_NAMES[process.arch];
if (!os || !arch) {
  throw new Error(`Unsupported platform: ${process.platform}-${process.arch}`);
}

const workDir = join("build", "sea");
const outDir = "release";
const bundle = join(workDir, "main.cjs");
const blob = join(workDir, "sea-prep.blob");
const seaConfig = join(workDir, "sea-config.json");
const executable = join(
  outDir,
  `${EXTENSION_NAME}-${os}-${arch}${os === "windows" ? ".exe" : ""}`,
);

rmSync(workDir, { recursive: true, force: true });
mkdirSync(workDir, { recursive: true });
mkdirSync(outDir, { recursive: true });

await build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: `node${process.versions.node.split(".")[0]}`,
  outfile: bundle,
  logLevel: "warning",
});

writeFileSync(
  seaConfig,
  JSON.stringify({ main: bundle, output: blob, disableExperimentalSEAWarning: true }),
);
execFileSync(process.execPath, ["--experimental-sea-config", seaConfig], {
  stdio: "inherit",
});

rmSync(executable, { force: true });
copyFileSync(process.execPath, executable);
if (os === "darwin") {
  execFileSync("codesign", ["--remove-signature", executable], { stdio: "inherit" });
}

await inject(executable, "NODE_SEA_BLOB", readFileSync(blob), {
  sentinelFuse: "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
  ...(os === "darwin" ? { machoSegmentName: "NODE_SEA" } : {}),
});

if (os === "darwin") {
  execFileSync("codesign", ["--sign", "-", executable], { stdio: "inherit" });
}

console.log(`Built ${executable}`);
