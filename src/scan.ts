import { readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { isAlias, isMap, isScalar, isSeq, LineCounter, parseDocument } from "yaml";
import type { CliDependencies } from "./cli.js";
import { parseActionReference } from "./parse-reference.js";
import { compareVersions, isVersionTag } from "./version.js";
import { NoReleaseError } from "./latest-release.js";
import { listVersionReleases, selectUpgrade, type UpgradePolicy } from "./release-candidates.js";
import { compareActionDetails, inspectAction, inspectReusableWorkflow, type ActionDetailsComparison } from "./action-details.js";
import { formatTable, renderLines, type DisplayOptions } from "./terminal.js";

export interface Usage {
  file: string;
  line: number;
  reference: string;
  kind: "github" | "local" | "docker" | "expression" | "unsupported";
  start: number;
  end: number;
}

export interface Discovery {
  root: string;
  files: Map<string, string>;
  usages: Usage[];
  errors: string[];
  filesWithoutUses: string[];
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

export async function discoverWorkflows(directory: string): Promise<Discovery> {
  const root = await realpath(resolve(directory));
  const result: Discovery = { root, files: new Map(), usages: [], errors: [], filesWithoutUses: [] };
  const visited = new Set<string>();

  async function visit(path: string, workflow: boolean): Promise<void> {
    const canonical = await realpath(path);
    const name = relative(root, canonical);
    if (name === ".." || name.startsWith(`..${sep}`) || isAbsolute(name)) {
      throw new Error(`Local reference escapes the repository: ${path}`);
    }
    if (visited.has(canonical)) {
      return;
    }
    visited.add(canonical);
    const source = await readFile(canonical, "utf8");
    result.files.set(name, source);
    const lineCounter = new LineCounter();
    const doc = parseDocument(source, { lineCounter, uniqueKeys: true });
    if (doc.errors.length || doc.warnings.length) {
      throw new Error(`${name}: ${[...doc.errors, ...doc.warnings].map((error) => error.message).join("; ")}`);
    }
    const local: Usage[] = [];

    function readUses(node: unknown): void {
      if (isAlias(node)) {
        throw new Error(`${name}: YAML aliases for jobs or steps are not supported.`);
      }
      if (isMap(node) && node.has("<<")) {
        throw new Error(`${name}: YAML merge keys for jobs or steps are not supported.`);
      }
      if (!isMap(node) || !node.has("uses")) {
        return;
      }
      const value = node.get("uses", true);
      if (!isScalar(value) || typeof value.value !== "string" || !value.range) {
        throw new Error(`${name}: uses must be a literal string (YAML aliases are not supported).`);
      }
      const reference = value.value;
      const kind = reference.includes("${{") ? "expression"
        : reference.startsWith("./") ? "local"
        : reference.startsWith("docker://") ? "docker"
        : reference.includes("@") ? "github" : "unsupported";
      const usage: Usage = {
        file: name,
        line: lineCounter.linePos(value.range[0]).line,
        reference,
        kind,
        start: value.range[0],
        end: value.range[1],
      };
      result.usages.push(usage);
      if (kind === "local") {
        local.push(usage);
      }
    }

    function readSteps(node: unknown): void {
      if (node !== undefined && !isSeq(node)) {
        throw new Error(`${name}: steps must be a YAML sequence.`);
      }
      if (isSeq(node)) {
        node.items.forEach(readUses);
      }
    }

    if (workflow) {
      const jobs = doc.get("jobs", true);
      if (jobs !== undefined && !isMap(jobs)) {
        throw new Error(`${name}: jobs must be a YAML mapping.`);
      }
      if (isMap(jobs)) {
        for (const pair of jobs.items) {
          readUses(pair.value);
          if (isMap(pair.value)) {
            readSteps(pair.value.get("steps", true));
          }
        }
      }
    } else {
      const runs = doc.get("runs", true);
      if (isMap(runs) && runs.get("using") === "composite") {
        readSteps(runs.get("steps", true));
      }
    }

    if (!result.usages.some((usage) => usage.file === name)) {
      result.filesWithoutUses.push(name);
    }

    for (const usage of local) {
      try {
        const target = resolve(root, ...usage.reference.split("/"));
        if (/\.ya?ml$/i.test(target)) {
          await visit(target, true);
        } else {
          try {
            await visit(join(target, "action.yml"), false);
          } catch (error) {
            if (!isMissing(error)) {
              throw error;
            }
            await visit(join(target, "action.yaml"), false);
          }
        }
      } catch (error) {
        result.errors.push(`${usage.file}:${usage.line}: ${message(error)}`);
      }
    }
  }

  const workflows = join(root, ".github", "workflows");
  let entries: Dirent[] = [];
  try {
    entries = await readdir(workflows, { withFileTypes: true });
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if ((entry.isFile() || entry.isSymbolicLink()) && /\.ya?ml$/i.test(entry.name)) {
      try {
        await visit(join(workflows, entry.name), true);
      } catch (error) {
        result.errors.push(message(error));
      }
    }
  }
  const actionDirectories = new Set<string>();
  async function discoverActions(path: string): Promise<void> {
    const canonical = await realpath(path);
    const name = relative(root, canonical);
    if (name === ".." || name.startsWith(`..${sep}`) || isAbsolute(name)) {
      throw new Error(`Local Action directory escapes the repository: ${path}`);
    }
    if (actionDirectories.has(canonical)) return;
    actionDirectories.add(canonical);
    const children = await readdir(canonical, { withFileTypes: true });
    const metadata = ["action.yml", "action.yaml"].find((file) =>
      children.some((entry) => entry.name === file && (entry.isFile() || entry.isSymbolicLink())));
    if (metadata) {
      try {
        await visit(join(canonical, metadata), false);
      } catch (error) {
        result.errors.push(message(error));
      }
    }
    for (const child of children.sort((a, b) => a.name.localeCompare(b.name))) {
      try {
        if (child.isDirectory()) await discoverActions(join(canonical, child.name));
        else if (child.isSymbolicLink() && child.name !== metadata &&
            !["action.yml", "action.yaml"].includes(child.name)) {
          // Resolve links before traversal so external content is never scanned.
          const target = await realpath(join(canonical, child.name));
          const targetName = relative(root, target);
          if (targetName === ".." || targetName.startsWith(`..${sep}`) || isAbsolute(targetName)) {
            throw new Error(`Local Action path escapes the repository: ${join(canonical, child.name)}`);
          }
          if ((await stat(target)).isDirectory()) await discoverActions(target);
        }
      } catch (error) {
        result.errors.push(message(error));
      }
    }
  }
  const actions = join(root, ".github", "actions");
  try {
    await discoverActions(actions);
  } catch (error) {
    if (!isMissing(error)) result.errors.push(message(error));
  }
  return result;
}

export interface ScanRow {
  file: string;
  line: number;
  reference: string;
  status: string;
  version?: string | null;
  sha?: string;
  latest?: string;
  newerAvailable?: boolean;
  archived?: boolean;
  error?: string;
  warning?: string;
  target?: string;
  majorUpgrade?: boolean;
  publisher?: string;
  compatibility?: ActionDetailsComparison;
  releaseNotesUrl?: string;
}

export interface PinChange {
  file: string;
  line: number;
  before: string;
  after: string;
}

export interface ScanReport {
  mode: "scan" | "pin" | "upgrade";
  files: number;
  filesWithoutUses?: string[];
  minReleaseAge?: number;
  rows: ScanRow[];
  changes: PinChange[];
  errors: string[];
  written?: string[];
  policyFailures?: string[];
}

export interface ScanOptions {
  write?: boolean;
  policy?: UpgradePolicy;
  minReleaseAge?: number;
  failOn?: ("unpinned" | "archived" | "publisher")[];
  allowedPublishers?: string[];
}

export async function scanRepository(
  directory: string,
  mode: "scan" | "pin" | "upgrade",
  dependencies: CliDependencies,
  options: ScanOptions = {},
): Promise<ScanReport> {
  const discovery = await discoverWorkflows(directory);
  const policy = options.policy ?? "minor";
  const minReleaseAge = options.minReleaseAge ?? (policy === "latest" ? 7 : 0);
  const selectionTime = Date.now();
  const report: ScanReport = {
    mode, files: discovery.files.size, rows: [], changes: [], errors: [...discovery.errors],
    filesWithoutUses: discovery.filesWithoutUses,
    ...(mode === "upgrade" ? { minReleaseAge } : {}),
  };
  const references = new Map<string, Promise<Omit<ScanRow, "file" | "line" | "reference">>>();
  const repositories = new Map<string, Promise<{
    metadata: Awaited<ReturnType<CliDependencies["getMetadata"]>>;
    latest: Awaited<ReturnType<CliDependencies["getLatestRelease"]>> | null;
    sha?: string;
    warning?: string;
  }>>();
  const replacements = new Map<string, { start: number; end: number; value: string }[]>();
  const updatedFiles = new Map<string, { before: string; after: string }>();
  const releaseLists = new Map<string, ReturnType<typeof listVersionReleases>>();

  async function inspect(reference: string): Promise<Omit<ScanRow, "file" | "line" | "reference">> {
    const action = parseActionReference(reference);
    const resolved = await dependencies.resolve(action);
    const status = resolved.refType === "sha" ? "Pinned" : "Unpinned";
    if (mode === "pin") {
      return { status, sha: resolved.sha, publisher: action.owner };
    }
    const repository = `${action.owner}/${action.repository}`;
    if (mode === "upgrade") {
      const version = await dependencies.findVersionTag(action, resolved.sha);
      if (!version) throw new Error("Current commit has no version tag; cannot safely select an upgrade.");
      if (!releaseLists.has(repository)) {
        releaseLists.set(repository, (dependencies.listReleases ?? listVersionReleases)(action));
      }
      const releases = await releaseLists.get(repository)!;
      const target = selectUpgrade(releases, version, policy, minReleaseAge, selectionTime);
      const unrestricted = selectUpgrade(releases, version, policy);
      const warning = unrestricted && unrestricted.tagName !== target?.tagName
        ? `Release ${unrestricted.tagName} does not meet the minimum release age of ${minReleaseAge} days. ${target ? `Selected ${target.tagName} instead.` : "No eligible upgrade; current version retained."}`
        : undefined;
      if (!target) return { status, sha: resolved.sha, version, latest: version, newerAvailable: false, publisher: action.owner, warning };
      const targetResolved = await dependencies.resolve({ ...action, ref: target.tagName });
      let compatibility: ActionDetailsComparison | undefined;
      if (/^\.github\/workflows\/[^/]+\.ya?ml$/i.test(action.path ?? "")) {
        await (dependencies.inspectWorkflow ?? inspectReusableWorkflow)(action, targetResolved.sha);
      } else {
        const getDetails = dependencies.inspectAction ?? inspectAction;
        const [before, after] = await Promise.all([
          getDetails(action, resolved.sha), getDetails(action, targetResolved.sha),
        ]);
        compatibility = compareActionDetails(before, after);
      }
      return {
        status, sha: targetResolved.sha, version, target: target.tagName, latest: target.tagName,
        newerAvailable: true, publisher: action.owner,
        majorUpgrade: compareVersions(target.tagName.replace(/^v/, "").split(".")[0], version.replace(/^v/, "").split(".")[0]) > 0,
        compatibility, releaseNotesUrl: target.releaseNotesUrl,
        warning,
      };
    }
    if (!repositories.has(repository)) {
      repositories.set(repository, (async () => {
        const [metadata, result] = await Promise.all([
          dependencies.getMetadata(action),
          dependencies.getLatestRelease(action).then(
            (latest) => ({ latest, warning: undefined }),
            (error: unknown) => {
              if (error instanceof NoReleaseError) return { latest: null, warning: error.message };
              throw error;
            },
          ),
        ]);
        const release = result.latest ? await dependencies.resolve({ ...action, ref: result.latest.tagName }) : null;
        return { metadata, latest: result.latest, sha: release?.sha, warning: result.warning };
      })());
    }
    const [info, version] = await Promise.all([
      repositories.get(repository)!,
      dependencies.findVersionTag(action, resolved.sha),
    ]);
    if (!info.latest || !info.sha) {
      return { status, sha: resolved.sha, version, archived: info.metadata.archived, warning: info.warning, publisher: action.owner };
    }
    const newerAvailable = version && isVersionTag(version) && isVersionTag(info.latest.tagName)
      ? compareVersions(info.latest.tagName, version) > 0
      : ["ahead", "diverged"].includes(await dependencies.compareCommits(action, resolved.sha, info.sha));
    return {
      status, sha: resolved.sha, version, latest: info.latest.tagName,
      newerAvailable, archived: info.metadata.archived, publisher: action.owner,
    };
  }

  for (const usage of discovery.usages) {
    const row: ScanRow = {
      file: usage.file, line: usage.line, reference: usage.reference, status: usage.kind,
    };
    try {
      if (usage.kind === "github") {
        if (!references.has(usage.reference)) {
          references.set(usage.reference, inspect(usage.reference));
        }
        Object.assign(row, await references.get(usage.reference));
        if ((mode === "pin" && row.status !== "Pinned") || (mode === "upgrade" && row.target)) {
          const action = parseActionReference(usage.reference);
          const value = `${[action.owner, action.repository, action.path].filter(Boolean).join("/")}@${row.sha}`;
          const source = discovery.files.get(usage.file)!;
          const token = source.slice(usage.start, usage.end);
          if (/[\r\n]/.test(token) || /^[>|]/.test(token)) {
            throw new Error("Cannot safely preview pinning a multiline uses value.");
          }
          const quote = token.startsWith("'") ? "'" : token.startsWith('"') ? '"' : "";
          const edits = replacements.get(usage.file) ?? [];
          // Keep the original version as an informational comment when one is absent.
          const lineEnd = source.indexOf("\n", usage.end);
          const remainder = source.slice(usage.end, lineEnd < 0 ? undefined : lineEnd).replace(/\r$/, "");
          const comment = remainder.trim() === "" ? ` # ${row.target ?? action.ref}` : "";
          edits.push({ start: usage.start, end: usage.end, value: `${quote}${value}${quote}${comment}` });
          // Refresh an existing version-only comment during upgrades, not prose.
          if (mode === "upgrade" && /^\s*#\s*v?\d+(\.\d+)*\s*$/.test(remainder)) {
            const hash = usage.end + remainder.indexOf("#");
            edits.push({ start: hash, end: usage.end + remainder.length, value: `# ${row.target}` });
          }
          replacements.set(usage.file, edits);
        }
      } else if (usage.kind === "unsupported") {
        throw new Error("Unsupported uses reference.");
      }
    } catch (error) {
      row.status = "Error";
      row.error = message(error);
    }
    report.rows.push(row);
  }

  for (const [file, edits] of replacements) {
    const before = discovery.files.get(file)!;
    let after = before;
    for (const edit of edits.sort((a, b) => b.start - a.start)) {
      after = after.slice(0, edit.start) + edit.value + after.slice(edit.end);
    }
    const parsed = parseDocument(after);
    if (parsed.errors.length) {
      report.errors.push(`${file}: generated YAML is invalid; refusing to write.`);
      continue;
    }
    updatedFiles.set(file, { before, after });
    const oldLines = before.split(/\r?\n/);
    const newLines = after.split(/\r?\n/);
    oldLines.forEach((text, index) => {
      if (text !== newLines[index]) {
        report.changes.push({ file, line: index + 1, before: text, after: newLines[index] });
      }
    });
  }
  const failures: string[] = [];
  for (const row of report.rows) {
    if (options.failOn?.includes("unpinned") && row.status === "Unpinned") failures.push(`${row.file}:${row.line}: unpinned reference`);
    if (options.failOn?.includes("unpinned") && row.status === "docker" &&
        !/@sha256:[a-f0-9]{64}$/i.test(row.reference)) failures.push(`${row.file}:${row.line}: unpinned Docker image`);
    if (options.failOn?.length && row.status === "expression") {
      failures.push(`${row.file}:${row.line}: dynamic reference cannot be evaluated against policy`);
    }
    if (options.failOn?.includes("publisher") && row.status === "docker") {
      failures.push(`${row.file}:${row.line}: Docker publisher cannot be evaluated with a GitHub owner allowlist`);
    }
    if (options.failOn?.includes("archived") && row.archived) failures.push(`${row.file}:${row.line}: archived repository`);
    if (options.failOn?.includes("publisher") && row.publisher &&
        !options.allowedPublishers?.some((owner) => owner.toLowerCase() === row.publisher!.toLowerCase())) {
      failures.push(`${row.file}:${row.line}: publisher ${row.publisher} is not allowed`);
    }
  }
  if (failures.length) report.policyFailures = failures;
  if (options.write && !report.errors.length && !report.rows.some((row) => row.error) && !failures.length) {
    // Preflight every file before writing any; never overwrite a concurrent edit.
    for (const [file, change] of updatedFiles) {
      if (await readFile(join(discovery.root, file), "utf8") !== change.before) {
        throw new Error(`${file} changed during inspection; no files written.`);
      }
    }
    report.written = [];
    for (const [file, change] of updatedFiles) {
      try {
        const path = join(discovery.root, file);
        if (await realpath(path) !== path || await readFile(path, "utf8") !== change.before) {
          throw new Error("File changed or became a symbolic link.");
        }
        await writeFile(path, change.after);
        report.written.push(file);
      } catch (error) {
        throw new Error(`Could not write ${file}: ${message(error)} Already written: ${report.written.join(", ") || "none"}.`);
      }
    }
  }
  return report;
}

export function formatScan(report: ScanReport, options: DisplayOptions = {}): string[] {
  const groups = new Map<string, ScanRow[]>();
  for (const row of report.rows) {
    const group = groups.get(row.file) ?? [];
    group.push(row);
    groups.set(row.file, group);
  }
  for (const file of report.filesWithoutUses ?? []) {
    if (!groups.has(file)) groups.set(file, []);
  }
  const width = Number.isFinite(options.width) ? Math.max(1, Math.floor(options.width!)) : 100;
  const showVersions = report.mode !== "pin" && width >= 80;
  const showStatus = width >= 32;
  const versionHeader = report.mode === "upgrade" ? "Target" : "Latest";
  const references = [...groups].flatMap(([file, rows]) => {
    if (!rows.length) return ["", file, "  No uses found in file."];
    const status = (row: ScanRow) => row.status === "local" ? "Local dependency"
      : row.status === "expression" ? "Dynamic / not resolved"
      : row.status === "docker" ? "Docker / not resolved"
      : report.mode === "scan" && row.status !== "Error" && row.publisher && row.newerAvailable === undefined
        ? `${row.status}\nUpdate: Unknown` : row.status;
    const cells = rows.map((row) => {
      const reference = row.reference.replace(/@([a-f0-9]{40})$/i, (_, sha: string) => `@${sha.slice(0, 7)}...`);
      return [
        `L${row.line}`, `${reference}${row.newerAvailable ? " [Update]" : ""}`,
        ...(showStatus ? [status(row)] : []),
        ...(showVersions ? [row.version ?? "-", row.latest ?? "-"] : []),
      ];
    });
    const notes = rows.flatMap((row) => {
      const details = [
        ...(!showStatus ? [`Status: ${status(row)}`] : []),
        ...(!showVersions && row.version ? [`Current: ${row.version}`] : []),
        ...(!showVersions && row.latest ? [`${versionHeader}: ${row.latest}`] : []),
        ...(row.error ? [`ERROR: ${row.error}`] : []),
        ...(row.warning ? [`WARNING: ${row.warning}`] : []),
        ...(row.archived ? [`WARNING: ${row.reference} is archived.`] : []),
      ];
      return details.length ? [`  L${row.line} - ${row.reference}`, ...details.map((detail) => `    ${detail}`)] : [];
    });
    return [
      "", file,
      ...formatTable([
        "Line", "Action", ...(showStatus ? ["Status"] : []),
        ...(showVersions ? ["Current", versionHeader] : []),
      ], cells, width, options.color ? (rowIndex, column) => {
        if (rowIndex < 0 || !showVersions) return undefined;
        const versionColumn = showStatus ? 3 : 2;
        if (column !== versionColumn && column !== versionColumn + 1) return undefined;
        const row = rows[rowIndex];
        if (cells[rowIndex][column] === "-") return undefined;
        if (column === versionColumn + 1 && row.newerAvailable) return "cyan";
        return row.status === "Pinned" ? "green" : row.status === "Unpinned" ? "yellow" : undefined;
      } : undefined),
      ...(notes.length ? ["", ...notes] : []),
    ];
  });
  const preview: string[] = [];
  const count = (value: number, noun: string) => `${value} ${noun}${value === 1 ? "" : "s"}`;
  const changesByFile = new Map<string, ScanReport["changes"]>();
  for (const change of report.changes) {
    const changes = changesByFile.get(change.file) ?? [];
    changes.push(change);
    changesByFile.set(change.file, changes);
  }
  for (const [file, changes] of changesByFile) {
    preview.push("", file, `  ${count(changes.length, "changed line")}`);
    for (const change of changes) {
      preview.push(
        "", `  Line ${change.line}`,
        "    Before:", change.before,
        "    After:", change.after,
      );
    }
  }
  const title = `${report.mode === "scan" ? "Workflow scan" : `${report.mode === "pin" ? "Pin" : "Upgrade"} ${report.written ? "result" : "preview"}`}: ${count(report.files, "file")}, ${count(report.rows.length, "reference")}`;
  const totals = [
    `${report.rows.filter((row) => row.status === "Pinned").length} pinned`,
    `${report.rows.filter((row) => row.status === "Unpinned").length} unpinned`,
    ...(report.mode === "scan" ? [`${report.rows.filter((row) => row.newerAvailable).length} updates available`] : []),
    `${report.errors.length + report.rows.filter((row) => row.error).length} errors`,
    ...(report.policyFailures?.length ? [count(report.policyFailures.length, "policy violation")] : []),
  ].join(" | ");
  return renderLines([
    title,
    totals,
    ...(report.mode === "upgrade" ? [`Minimum release age: ${report.minReleaseAge ?? 0} days (publication age, not a stability guarantee).`] : []),
    ...(references.length ? references : ["", "No Action references found."]),
    ...report.rows.filter((row) => row.majorUpgrade).map((row) => `WARNING ${row.file}:${row.line}: major upgrade to ${row.target}; review release notes and compatibility.`),
    ...report.rows.filter((row) => row.target).flatMap((row) => {
      const comparison = row.compatibility;
      return [
        "",
        `Upgrade review - ${row.file}:${row.line}`,
        `  ${row.reference}`,
        `  Release notes: ${row.releaseNotesUrl}`,
        ...(comparison ? [
          ...(comparison.runtimeChanged ? [`WARNING Runtime changes: ${comparison.runtimeBefore} -> ${comparison.runtimeAfter}`] : []),
          ...[
            ...comparison.addedRequiredInputsWithoutDefaults,
            ...comparison.newlyRequiredInputsWithoutDefaults,
          ].map((input) => `WARNING Required input without default: ${input}`),
          ...comparison.removedInputs.map((input) => `WARNING Removed input: ${input}`),
          ...comparison.removedOutputs.map((output) => `WARNING Removed output: ${output}`),
          ...comparison.changedDefaults.map((change) => `WARNING Default changed: ${change.input}`),
          ...comparison.deprecatedInputs.map((input) => `WARNING Deprecated input ${input.input}: ${input.deprecationMessage}`),
          comparison.notice,
        ] : ["Reusable workflow upgrade: review workflow_call inputs, outputs, and release notes manually."]),
      ];
    }),
    ...(report.errors.length ? ["", "Discovery errors", ...report.errors.map((error) => `  ERROR: ${error}`)] : []),
    ...(report.policyFailures?.length ? ["", "Policy findings", ...report.policyFailures.map((failure) => `  POLICY: ${failure}`)] : []),
    ...(report.mode !== "scan" ? [
      "",
      "Changes",
      ...preview,
      "",
      report.written
        ? `${count(report.written.length, "file")} written.`
        : report.changes.length
          ? `${count(report.changes.length, "line")} would change. No files written; ${report.mode === "pin" ? "versions are not upgraded." : "review compatibility before using --write."}`
          : `No ${report.mode === "pin" ? "pin changes" : "upgrades"} proposed. No files written.`,
    ] : []),
    ...(report.rows.some((row) => ["local", "docker", "expression"].includes(row.status))
      ? ["Local references are followed when present; Docker references and expressions are not resolved or changed."]
      : []),
  ], options, new Set(report.changes.flatMap((change) => [change.before, change.after])),
  new Set([...groups.keys(), ...changesByFile.keys()]));
}
