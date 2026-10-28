import { stripVTControlCharacters } from "node:util";
import { describe, expect, it } from "vitest";
import { formatComparison, formatText, type InspectionReport } from "../src/format.js";
import { formatScan, type ScanReport } from "../src/scan.js";
import { compareActionDetails, type ActionDetails } from "../src/action-details.js";
import { formatTable, renderLines, wrapText } from "../src/terminal.js";

const sha = "a".repeat(40);
const scan: ScanReport = {
  mode: "scan", files: 2, changes: [], errors: ["A local dependency could not be opened."],
  policyFailures: ["ci.yml:7: unpinned reference"],
  rows: [
    { file: ".github\\workflows\\ci.yml", line: 7, reference: `actions/checkout@${sha}`, status: "Pinned", version: "v4.0.0", latest: "v7.0.0", newerAvailable: true },
    { file: ".github\\workflows\\ci.yml", line: 11, reference: `organisation/${"long-action-name-".repeat(5)}@v1`, status: "Error", error: `Commit ${sha} could not be found in the repository. Check repository access.` },
    { file: ".github\\workflows\\deploy.yml", line: 20, reference: "./.github/actions/build", status: "local" },
  ],
};

const details: ActionDetails = {
  path: "action.yml", sha, runtime: "node24",
  inputs: {
    token: {
      required: true,
      default: "sample",
      description: "A lengthy input description that needs to be readable even on a narrow terminal window.",
      deprecationMessage: "Use the replacement credential input instead.",
    },
  },
  outputs: { result: { description: "The result of the operation." } },
};

const inspection: InspectionReport = {
  action: "actions/example", repository: "actions/example",
  reference: { original: "v1", type: "tag", sha, version: "v1.0.0", immutable: false, pinned: `actions/example@${sha}` },
  license: "MIT", archived: false, details, latestRelease: null, warning: "No applicable release found.",
};

describe("readable terminal reports", () => {
  it.each([40, 80, 120])("groups references under each file and wraps at %i columns", (width) => {
    const lines = formatScan(scan, { width });
    expect(lines.every((line) => Array.from(line).length <= width)).toBe(true);
    const output = lines.join("\n");
    expect(output.match(/\.github\\workflows\\ci.yml/g)).toHaveLength(1);
    expect(output).toContain("L7");
    expect(output).toContain("L11");
    const statusColumn = lines.filter((line) => line.startsWith("  | "))
      .map((line) => line.split("|")[3]?.trim() ?? "").join("").replace(/\s/g, "");
    expect(statusColumn).toContain("Localdependency");
    expect(output).toContain("| Line");
    expect(output).toContain("| Action");
    expect(output).toContain("Discovery errors");
    expect(output).toContain("Policy findings");
    expect(output.indexOf("ERROR")).toBeGreaterThan(output.indexOf("L11"));
    // Wrapping must not discard long identifiers or diagnostic words.
    const actionColumn = lines.filter((line) => line.startsWith("  | ") && !line.includes("| Action"))
      .map((line) => line.split("|")[2].trim()).join("");
    expect(actionColumn).toContain(scan.rows[1].reference);
    expect(output.replace(/\s/g, "")).toContain(scan.rows[1].error!.replace(/\s/g, ""));
  });

  it.each(["scan", "pin", "upgrade"] as const)("uses per-file tables for %s", (mode) => {
    const output = formatScan({ ...scan, mode }, { width: 100 }).join("\n");
    expect(output.match(/\| Line /g)).toHaveLength(2);
    expect(output).toContain("| Status");
    if (mode === "pin") expect(output).not.toContain("| Current");
    else {
      expect(output).toContain("| Current");
      expect(output).toContain(mode === "upgrade" ? "| Target" : "| Latest");
    }
    expect(output.indexOf("ERROR")).toBeGreaterThan(output.indexOf(scan.rows[1].reference.slice(0, 12)));
  });

  it("moves version details below narrow tables instead of losing information", () => {
    const output = formatScan(scan, { width: 40 }).join("\n");
    expect(output).not.toContain("| Current");
    expect(output).toContain("Current: v4.0.0");
    expect(output).toContain("Latest: v7.0.0");
    expect(output).toContain("Update: Available");
  });

  it("aligns wide and combining characters within table cells", () => {
    const lines = formatTable(["Line", "Action"], [["L1", "界".repeat(20)], ["L2", "e\u0301".repeat(12)]], 40);
    expect(lines[0].length).toBeLessThanOrEqual(40);
    expect(lines[1].length).toBe(lines[0].length);
    expect(lines.filter((line) => line.includes("界")).length).toBeGreaterThan(1);
    expect(lines.every((line) => line.endsWith("|"))).toBe(true);
  });

  it("keeps ASCII column boundaries aligned across wrapped rows", () => {
    const lines = formatTable(["Line", "Action", "Status"], [
      ["L1", "actions/checkout@abcdefg...", "Pinned"],
      ["L200", "owner/" + "long-action-name".repeat(4) + "@v1", "Unpinned"],
    ], 60);
    const boundaries = (line: string) => Array.from(line.matchAll(/\|/g), (match) => match.index);
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(60);
      expect(boundaries(line)).toEqual(boundaries(lines[0]));
    }
  });

  it("uses equivalent readable text with or without ANSI colors", () => {
    const plain = formatScan(scan, { width: 60 });
    const colored = formatScan(scan, { width: 60, color: true });
    expect(colored.some((line) => line.includes("\x1b["))).toBe(true);
    expect(colored.map(stripVTControlCharacters)).toEqual(plain);
  });

  it("keeps copyable YAML intact in labeled change cards at narrow widths", () => {
    const literal = `  uses: actions/example@${sha} # v1.0.0`;
    expect(renderLines([literal], { width: 20 })).toEqual([literal]);
    const before = "      - uses: actions/example@v1";
    const after = `      - uses: actions/example@${sha}`;
    const lines = formatScan({
      mode: "pin", files: 1, rows: [], errors: [],
      changes: [{ file: "ci.yml", line: 7, before, after }],
    }, { width: 40 });
    expect(lines).toContain(before);
    expect(lines).toContain(after);
    expect(lines).toContain("  Line 7");
    expect(lines).toContain("    Before:");
    expect(lines).toContain("    After:");
    expect(lines.join("\n")).not.toContain("@@");
  });

  it.each(["pin", "upgrade"] as const)("groups %s change cards once per file with plain/color parity", (mode) => {
    const changes = [
      { file: "ci.yml", line: 7, before: "  - uses: owner/action@v1", after: `  - uses: owner/action@${sha} # v1` },
      { file: "deploy.yml", line: 9, before: "job: { uses: owner/repo/workflow@v1 }", after: `job: { uses: owner/repo/workflow@${sha} }` },
      { file: "ci.yml", line: 11, before: "  - uses: owner/other@v1", after: `  - uses: owner/other@${sha}` },
    ];
    const report: ScanReport = { mode, files: 2, rows: [], errors: [], changes };
    const plain = formatScan(report, { width: 40 });
    const colored = formatScan(report, { width: 40, color: true });
    expect(colored.map(stripVTControlCharacters)).toEqual(plain);
    expect(plain.filter((line) => line === "ci.yml")).toHaveLength(1);
    expect(plain).toContain("  2 changed lines");
    for (const change of changes) {
      expect(plain).toContain(change.before);
      expect(plain).toContain(change.after);
    }
    expect(plain.join("\n")).toContain("    After:\n" + changes[0].after + "\n\n  Line 11");
    expect(plain).toContain("3 lines would change. No files written;");
  });

  it("shows a compact input table and retains deprecation warnings", () => {
    const lines = formatText(inspection, false, 50);
    expect(lines.filter((line) => !line.trimStart().startsWith("uses:"))
      .every((line) => Array.from(line).length <= 50)).toBe(true);
    const output = lines.join("\n");
    expect(output).toContain("Inputs (1)");
    expect(output).toContain("Outputs (1)");
    expect(output).toContain('Default: "sample"');
    expect(output).toContain("| Input");
    expect(output).toContain("| Configuration");
    expect(output).toContain("WARNING: Deprecated");
    expect(output).not.toContain("A lengthy input description");
    expect(output.replace(/\s/g, "")).toContain(`https://github.com/actions/example/blob/${sha}/action.yml`);
    expect(output).not.toContain("\x1b[");
  });

  it("links full input descriptions while keeping output paragraphs indented", () => {
    const report: InspectionReport = {
      ...inspection,
      details: {
        ...details,
        inputs: { token: { required: false, description: "First paragraph.\n\nSecond paragraph.\n" } },
        outputs: { result: { description: "First output line.\nSecond output line.\n" } },
      },
    };
    const output = formatText(report, false, 80).join("\n");
    expect(output).not.toContain("First paragraph.");
    expect(output).not.toContain("Second paragraph.");
    expect(output).toContain("  Output result\n    First output line.\n    Second output line.");
  });

  it("distinguishes missing and empty defaults and links nested metadata exactly", () => {
    const report: InspectionReport = {
      ...inspection,
      action: "actions/example/nested",
      details: {
        ...details, path: "nested/action.yaml",
        inputs: {
          missing: { required: true },
          empty: { required: false, default: "" },
          multiline: { required: false, default: "first\nsecond" },
        },
      },
    };
    const output = formatText(report, false, 100).join("\n");
    expect(output).toMatch(/\| missing\s*\| Yes\s*\| \(not set\)/);
    expect(output).toMatch(/\| empty\s*\| No\s*\| ""/);
    expect(output).toContain('"first\\nsecond"');
    expect(output.replace(/\s/g, "")).toContain(`/blob/${sha}/nested/action.yaml`);
  });

  it("shows an explicit empty-input state without an empty table", () => {
    const output = formatText({
      ...inspection, details: { ...details, inputs: {} },
    }, false, 80).join("\n");
    expect(output).toContain("No inputs declared.");
    expect(output).not.toContain("| Input");
  });

  it("groups comparison findings separately from manual-review guidance", () => {
    const before = { ...details, runtime: "node20", inputs: {} };
    const comparison = compareActionDetails(before, details);
    const lines = formatComparison("owner/action@v1", "owner/action@v2", comparison,
      "https://github.com/owner/action/releases", { width: 50 });
    expect(lines.every((line) => Array.from(line).length <= 50)).toBe(true);
    expect(lines.join("\n")).toContain("Findings (2)");
    expect(lines.join("\n")).toContain("Manual review");
    expect(lines.join("\n")).toContain("Before: owner/action@v1");
  });

  it("does not claim compatibility when no metadata differences exist", () => {
    const comparison = compareActionDetails(details, details);
    // Existing deprecation is still reported, even without interface changes.
    const output = formatComparison("owner/action@v1", "owner/action@v1", comparison, "https://github.com").join("\n");
    expect(output).toContain("cannot guarantee compatibility");
  });

  it("handles empty reports without rendering a wide empty table", () => {
    const lines = formatScan({ mode: "scan", files: 0, rows: [], changes: [], errors: [] }, { width: 40 });
    expect(lines.join("\n")).toContain("No Action references found.");
  });

  it("wraps multiline text and long tokens without ANSI escapes", () => {
    const lines = wrapText("\x1b[31mERROR\x1b[0m\n" + "b".repeat(90), 30);
    expect(lines.every((line) => line.length <= 30)).toBe(true);
    expect(lines.join("").replace(/\s/g, "")).toBe("ERROR" + "b".repeat(90));
  });

  it("counts wide glyphs and preserves combining characters when wrapping", () => {
    const wide = wrapText("界".repeat(20), 20);
    expect(wide[0]).toBe("界".repeat(10));
    expect(wide.join("").replace(/ /g, "")).toBe("界".repeat(20));
    const combined = wrapText("e\u0301".repeat(30), 20);
    expect(combined[0]).toBe("e\u0301".repeat(20));
    expect(combined.join("").replace(/ /g, "")).toBe("e\u0301".repeat(30));
  });
});
