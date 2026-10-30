import type { ActionReferenceType } from "./resolve-reference.js";
import type { ActionDetails, ActionDetailsComparison } from "./action-details.js";
import { formatTable, renderLines, type CellColor, type DisplayOptions } from "./terminal.js";

export interface InspectionReport {
  action: string;
  repository: string;
  reference: {
    original: string;
    type: ActionReferenceType;
    sha: string;
    version: string | null;
    immutable: boolean;
    pinned: string;
  };
  license: string;
  archived: boolean;
  details?: ActionDetails;
  warning?: string;
  latestRelease: {
    version: string;
    sha: string;
    releaseNotesUrl: string;
    newerAvailable: boolean;
    pinned: string;
  } | null;
}

type Row = [label: string, value: string];

function descriptionLines(description?: string): string[] {
  return description?.trim().split(/\r?\n/).map((line) => line ? `    ${line}` : "") ?? [];
}

export function formatJson(report: InspectionReport): string {
  return JSON.stringify(report, null, 2);
}

export function formatText(report: InspectionReport, color: boolean, width?: number): string[] {
  const good = (text: string) => color ? `✓ ${text}` : text;
  const warn = (text: string) => color ? `! ${text}` : text;
  const bad = (text: string) => color ? `✗ ${text}` : text;
  const dim = (text: string) => text;

  const { reference, latestRelease } = report;
  const immutable =
    reference.type === "short-sha"
      ? warn("No (short SHAs can't be used in uses:, pin the full SHA)")
      : reference.immutable
        ? good("Yes")
        : warn(`No (a ${reference.type} can be moved)`);
  const sections: [title: string, rows: Row[]][] = [
    [
      "Reference",
      [
        ["Type", reference.type === "short-sha" ? "short SHA" : reference.type],
        ["Commit SHA", dim(reference.sha)],
        ["Version", reference.version ?? warn("Not found (no tag points to this commit)")],
        ["Immutable", immutable],
        ["SHA-pinned", reference.pinned],
      ],
    ],
    [
      "Repository",
      [
        ["Name", report.repository],
        ["License", report.license],
        ["Archived", report.archived ? bad("Yes (no longer maintained)") : good("No")],
      ],
    ],
  ];
  sections.push(["Latest release", latestRelease ? [
    ["Version", latestRelease.version],
    ["Newer version", latestRelease.newerAvailable
      ? warn(`Yes (${reference.version ?? reference.original} → ${latestRelease.version})`)
      : good("No")],
    ["Release notes", dim(latestRelease.releaseNotesUrl)],
  ] : [["Status", warn(report.warning ?? "No published release; update availability is unknown.")]]]);

  const labelWidth =
    Math.max(...sections.flatMap(([, rows]) => rows.map(([label]) => label.length))) + 2;
  const heading = (text: string) => text;
  const tableWidth = width !== undefined && Number.isFinite(width) ? Math.max(24, width) : 100;
  const inputs = Object.entries(report.details?.inputs ?? {});
  const metadataPath = (report.details?.path ?? "action.yml").split("/")
    .map(encodeURIComponent).join("/");
  const metadataUrl = `https://github.com/${report.repository}/blob/${report.details?.sha}/${metadataPath}`;
  const fieldColors = new Map<string, CellColor>();
  const pinColor = reference.immutable ? "green" : "yellow";
  for (const [section, rows] of sections) {
    for (const [label, value] of rows) {
      const style = section === "Reference" && ["Version", "Immutable"].includes(label) ? pinColor
        : section === "Latest release" && ["Version", "Newer version"].includes(label)
          ? latestRelease?.newerAvailable ? "cyan" : pinColor
          : section === "Latest release" && label === "Status" ? "yellow"
          : label === "Archived" && report.archived ? "red" : undefined;
      if (style) fieldColors.set(`  ${label.padEnd(labelWidth)}${value}`, style);
    }
  }

  return renderLines([
    `${report.action}@${reference.original}`,
    ...sections.flatMap(([title, rows]) => [
      "",
      heading(title),
      ...rows.map(([label, value]) => `  ${dim(label.padEnd(labelWidth))}${value}`),
    ]),
    "",
    heading(latestRelease ? "Pin to latest release" : "Pin current commit"),
    `  uses: ${latestRelease?.pinned ?? reference.pinned}`,
    ...(report.details ? [
      "",
      heading("Action metadata"),
      `  Runtime: ${report.details.runtime}`,
      `  File: ${report.details.path}`,
      "",
      heading(`Inputs (${Object.keys(report.details.inputs).length})`),
      ...(inputs.length ? formatTable(
        tableWidth >= 60 ? ["Input", "Required", "Default"] : ["Input", "Configuration"],
        inputs.map(([name, input]) => {
          const required = input.required ? "Yes" : "No";
          const defaultValue = input.default === undefined ? "(not set)" : JSON.stringify(input.default);
          return tableWidth >= 60 ? [name, required, defaultValue]
            : [name, `Required: ${required}\nDefault: ${defaultValue}`];
        }), tableWidth,
      ) : ["  No inputs declared."]),
      "",
      "  Defaults are quoted; (not set) means no default is declared.",
      `  Full input descriptions: ${metadataUrl}`,
      ...inputs.flatMap(([name, input]) => descriptionLines(
        input.deprecationMessage ? `WARNING: Deprecated input ${name} - ${input.deprecationMessage}` : undefined,
      )),
      "",
      heading(`Outputs (${Object.keys(report.details.outputs).length})`),
      ...(Object.keys(report.details.outputs).length ? formatTable(
        ["Output", "Description"],
        Object.entries(report.details.outputs).map(([name, output]) => [
          name, output.description?.trim() || "(not documented)",
        ]), tableWidth,
      ) : ["  No outputs declared."]),
    ] : []),
  ], { color, width }, new Set(), new Set(), fieldColors);
}

export function formatComparison(
  before: string,
  after: string,
  comparison: ActionDetailsComparison,
  releaseNotes: string,
  options: DisplayOptions = {},
): string[] {
  const findings = [
    ...(comparison.runtimeChanged ? [`  WARNING Runtime: ${comparison.runtimeBefore} -> ${comparison.runtimeAfter}`] : []),
    ...comparison.addedRequiredInputsWithoutDefaults.map((input) => `  WARNING New required input without default: ${input}`),
    ...comparison.newlyRequiredInputsWithoutDefaults.map((input) => `  WARNING Input now required without default: ${input}`),
    ...comparison.removedInputs.map((input) => `  WARNING Removed input: ${input}`),
    ...comparison.removedOutputs.map((output) => `  WARNING Removed output: ${output}`),
    ...comparison.changedDefaults.flatMap((change) => [
      `  WARNING Default changed: ${change.input}`,
      `    Before: ${JSON.stringify(change.before) ?? "(unset)"}`,
      `    After:  ${JSON.stringify(change.after) ?? "(unset)"}`,
    ]),
    ...comparison.deprecatedInputs.map((input) => `  WARNING Deprecated ${input.input}: ${input.deprecationMessage}`),
  ];
  const findingCount = findings.filter((line) => line.startsWith("  WARNING")).length;
  const references = [
    `  Before: ${before}`,
    `  After:  ${after}`,
  ];
  const lineColors = new Map<string, CellColor>([
    [references[1], "cyan"],
    [`Findings (${findingCount})`, findingCount ? "yellow" : undefined],
  ]);
  return renderLines([
    "Action comparison",
    ...references,
    "",
    `Findings (${findingCount})`,
    ...(findings.length ? findings : [
      "  No interface or runtime changes detected.",
      `  Runtime: ${comparison.runtimeAfter}`,
    ]),
    "",
    "Manual review",
    `  ${comparison.notice}`,
    `  Release notes: ${releaseNotes}`,
  ], options, new Set(), new Set(), lineColors);
}
