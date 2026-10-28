import { styleText } from "node:util";

export interface InspectionReport {
  action: string;
  repository: string;
  reference: {
    original: string;
    type: "tag" | "branch" | "sha";
    sha: string;
    version: string | null;
    immutable: boolean;
    pinned: string;
  };
  license: string;
  archived: boolean;
  latestRelease: {
    version: string;
    sha: string;
    releaseNotesUrl: string;
    newerAvailable: boolean;
    pinned: string;
  };
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
  const sections: [title: string, rows: Row[]][] = [
    [
      "Reference",
      [
        ["Type", reference.type],
        ["Commit SHA", dim(reference.sha)],
        ["Version", reference.version ?? warn("Not found (no tag points to this commit)")],
        [
          "Immutable",
          reference.immutable ? good("Yes") : warn(`No (a ${reference.type} can be moved)`),
        ],
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
    [
      "Latest release",
      [
        ["Version", latestRelease.version],
        [
          "Newer version",
          latestRelease.newerAvailable
            ? warn(`Yes (${reference.version ?? reference.original} → ${latestRelease.version})`)
            : good("No"),
        ],
        ["Release notes", dim(latestRelease.releaseNotesUrl)],
      ],
    ],
  ];

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
    heading("Pin to latest release"),
    `  ${paint("green", `uses: ${latestRelease.pinned}`)}`,
  ];
}
