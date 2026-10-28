import { stripVTControlCharacters, styleText } from "node:util";

export interface DisplayOptions {
  color?: boolean;
  width?: number;
}

const segments = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function cellWidth(text: string): number {
  if (/^[\p{Mark}\p{Cf}]+$/u.test(text)) return 0;
  const point = text.codePointAt(0) ?? 0;
  if (/\p{Emoji_Presentation}|\uFE0F/u.test(text) ||
      (point >= 0x1100 && (
        point <= 0x115f || point === 0x2329 || point === 0x232a ||
        (point >= 0x2e80 && point <= 0xa4cf) ||
        (point >= 0xac00 && point <= 0xd7a3) ||
        (point >= 0xf900 && point <= 0xfaff) ||
        (point >= 0xfe10 && point <= 0xfe6f) ||
        (point >= 0xff01 && point <= 0xff60) ||
        (point >= 0xffe0 && point <= 0xffe6) ||
        (point >= 0x20000 && point <= 0x3fffd)
      ))) return 2;
  return 1;
}

function displayWidth(text: string): number {
  return Array.from(segments.segment(text), (part) => cellWidth(part.segment))
    .reduce((total, width) => total + width, 0);
}

export function formatTable(headers: string[], rows: string[][], width = 100): string[] {
  const widths = headers.map((header, index) => Math.max(
    displayWidth(header), ...rows.map((row) => displayWidth(row[index])),
  ));
  const available = Math.max(headers.length * 4, width - headers.length * 3 - 3);
  while (widths.reduce((sum, value) => sum + value, 0) > available) {
    const largest = widths.indexOf(Math.max(...widths));
    widths[largest]--;
  }
  const formatRow = (row: string[]) => {
    const cells = row.map((cell, index) => wrapText(cell, widths[index], ""));
    return Array.from({ length: Math.max(...cells.map((cell) => cell.length)) }, (_, line) =>
      `  | ${cells.map((cell, index) => {
        const value = cell[line] ?? "";
        return value + " ".repeat(Math.max(0, widths[index] - displayWidth(value)));
      }).join(" | ")} |`);
  };
  const divider = `  |-${widths.map((size) => "-".repeat(size)).join("-|-")}-|`;
  return [...formatRow(headers), divider, ...rows.flatMap(formatRow)];
}

/** Wrap prose and long identifiers without dropping characters. */
export function wrapText(text: string, width: number, continuation = "    "): string[] {
  const limit = Number.isFinite(width) ? Math.max(1, Math.floor(width)) : 100;
  const result: string[] = [];
  for (const original of stripVTControlCharacters(text).replace(/\r/g, "").split("\n")) {
    let remaining = original;
    while (true) {
      const characters = Array.from(segments.segment(remaining), (part) => part.segment);
      let cells = 0;
      let boundary = 0;
      while (boundary < characters.length && cells + cellWidth(characters[boundary]) <= limit) {
        cells += cellWidth(characters[boundary++]);
      }
      if (boundary === characters.length) break;
      if (boundary === 0) boundary = 1;
      let end = characters.slice(0, boundary + 1).lastIndexOf(" ");
      if (end < Math.floor(boundary / 2)) end = boundary;
      result.push(characters.slice(0, end).join(""));
      const rest = characters.slice(end).join("").replace(/^ +/, "");
      remaining = continuation.slice(0, Math.min(continuation.length, Math.max(0, limit - 2))) + rest;
    }
    result.push(remaining);
  }
  return result;
}

export function renderLines(
  lines: string[],
  options: DisplayOptions = {},
  literalLines: ReadonlySet<string> = new Set(),
): string[] {
  return lines.flatMap((line) => {
    const plain = stripVTControlCharacters(line);
    // Keep executable YAML and diff lines intact for copying or patch review.
    const literal = literalLines.has(line) || /^\s*uses:|^[+-]|^@@/.test(plain);
    const wrapped = options.width === undefined || literal ? plain.split("\n") : wrapText(plain, options.width);
    if (!options.color) return wrapped;
    const style = /^\s*Before:$/.test(plain) ? "red"
      : /^\s*After:$/.test(plain) ? "green"
      : /\b(ERROR|Error|POLICY|Policy)\b/.test(plain) ? "red"
      : /\b(WARNING|Warning|Unpinned|Available|REVIEW)\b|! /.test(plain) ? "yellow"
      : /^\+[^+]|✓|\bPinned\b/.test(plain) ? "green"
      : /^-[^-]/.test(plain) ? "red"
      : /^\S/.test(plain) ? "cyan" : undefined;
    return style ? wrapped.map((part) => styleText(
      style === "cyan" ? ["bold", "cyan"] : style, part, { validateStream: false },
    )) : wrapped;
  });
}
