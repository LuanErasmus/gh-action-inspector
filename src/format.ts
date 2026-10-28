import { styleText } from "node:util";
import type { ActionReferenceType } from "./resolve-reference.js";
import type { ActionDetails } from "./action-details.js";

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

type Style = Parameters<typeof styleText>[0];
type Row = [label: string, value: string];

export function formatJson(report: InspectionReport): string {
  return JSON.stringify(report, null, 2);
}

export function formatText(report: InspectionReport, color: boolean): string[] {
  const paint = (style: Style, text: string) =>
    color ? styleText(style, text, { validateStream: false }) : text;
  const good = (text: string) => paint("green", color ? `✓ ${text}` : text);
  const warn = (text: string) => paint("yellow", color ? `⚠ ${text}` : text);
  const bad = (text: string) => paint("red", color ? `✗ ${text}` : text);
  const dim = (text: string) => paint("dim", text);

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
  const heading = (text: string) => paint("bold", text);

  return [
    paint(["bold", "cyan"], `${report.action}@${reference.original}`),
    ...sections.flatMap(([title, rows]) => [
      "",
      heading(title),
      ...rows.map(([label, value]) => `  ${dim(label.padEnd(labelWidth))}${value}`),
    ]),
    "",
    heading(latestRelease ? "Pin to latest release" : "Pin current commit"),
    `  ${paint("green", `uses: ${latestRelease?.pinned ?? reference.pinned}`)}`,
    ...(report.details ? [
      "",
      heading("Action metadata"),
      `  Runtime: ${report.details.runtime}`,
      `  File: ${report.details.path}`,
      ...Object.entries(report.details.inputs).map(([name, input]) =>
        `  Input ${name}: ${input.required ? "required" : "optional"}${input.default === undefined ? "" : `, default=${JSON.stringify(input.default)}`}${input.deprecationMessage ? `, DEPRECATED: ${input.deprecationMessage}` : ""}${input.description ? ` - ${input.description}` : ""}`),
      ...Object.entries(report.details.outputs).map(([name, output]) => `  Output ${name}${output.description ? `: ${output.description}` : ""}`),
    ] : []),
  ];
}
