// Clipboard tables from Excel, LibreOffice or Google Sheets (tab-separated text) — SPEC.md §9.
// parseClipboard only reads and guesses (header row, depth / age column, decimal commas, kinds);
// the app shows the guesses for confirmation, then datasetFromClipboard builds the dataset.

import { parseCellText, type EditResult } from "../edit/dataset.js";
import { sampleId as newSampleId, variableId as newVariableId } from "../edit/ids.js";
import type { Dataset, Group, MeasurementKind, Sample, Variable } from "../model/types.js";
import { parseDelimited } from "./delimited.js";

export interface ClipboardColumn {
  /** Column index in `cells`. */
  index: number;
  /** Header text, or "Column n" without a header row. */
  name: string;
  /** Guess: text codes → abundanceClass, whole numbers → count, decimals → continuous; or the "kind" row. */
  kind: MeasurementKind;
  unit?: string;
  group?: string;
}

export interface ClipboardTable {
  /** All non-blank rows, cells trimmed, padded to `width`. */
  cells: string[][];
  width: number;
  /** Rows before the data: the header row plus any "group" / "kind" / "unit" / "id" rows (0 = no header). */
  headerRows: number;
  /** The clipboard uses decimal commas ("0,5"); numbers are read that way throughout. */
  decimalComma: boolean;
  /** Depth column guess; undefined if no column is numeric throughout. */
  depthColumn: number | undefined;
  /** False when the depth column is only a guess (no "depth" / "cm" header): ask the user. */
  depthCertain: boolean;
  ageColumn: number | undefined;
  /** Every column, depth and age included. */
  columns: ClipboardColumn[];
  warnings: string[];
}

const MEASUREMENT_KINDS: readonly MeasurementKind[] = ["count", "percent", "concentration", "influx", "abundanceClass", "presence", "volumePercent", "continuous"];
const ORDINAL: readonly MeasurementKind[] = ["abundanceClass", "presence"];
const COMMA_DECIMAL = /^[+-]?\d*,\d+$/;
const DOT_DECIMAL = /^[+-]?\d*\.\d+([eE][+-]?\d+)?$/;
/** "1,234" could be a thousands separator just as well. */
const THOUSANDS = /^[+-]?\d{1,3},\d{3}$/;
const META_ROWS = new Set(["group", "kind", "unit", "id"]);

/** Decimal commas are assumed only when the text clearly uses them: some "0,5"-style cell, no "0.5"-style cell, not all like "1,234". */
function detectDecimalComma(cells: readonly string[]): { decimalComma: boolean; ambiguous: string | undefined } {
  const comma = cells.filter((c) => COMMA_DECIMAL.test(c));
  if (comma.length === 0 || cells.some((c) => DOT_DECIMAL.test(c))) return { decimalComma: false, ambiguous: undefined };
  if (comma.every((c) => THOUSANDS.test(c))) return { decimalComma: false, ambiguous: comma[0] };
  return { decimalComma: true, ambiguous: undefined };
}

export function parseClipboard(text: string): ClipboardTable {
  const warnings: string[] = [];
  const rows = parseDelimited(text, "\t")
    .map((r) => r.map((c) => c.trim()))
    .filter((r) => r.some((c) => c !== ""));
  const width = Math.max(0, ...rows.map((r) => r.length));
  const cells = rows.map((r) => [...r, ...Array<string>(width - r.length).fill("")]);
  const { decimalComma, ambiguous } = detectDecimalComma(cells.flat());
  if (decimalComma) warnings.push('The pasted numbers use decimal commas ("0,5"); read as decimals.');
  if (ambiguous) warnings.push(`Cells such as "${ambiguous}" could use a decimal comma or a thousands separator; they were not read as numbers.`);

  const isNum = (c: string) => typeof parseCellText(c, decimalComma) === "number";
  const numeric = (r: readonly string[] | undefined) => r?.filter(isNum).length ?? 0;
  const first = cells[0];
  // A header row has text and fewer numbers than the first data row (no data rows: no numbers at all).
  let next = 1;
  while (next < cells.length && META_ROWS.has(cells[next]![0]!.toLowerCase())) next++;
  const hasHeader =
    first !== undefined && first.some((c) => c !== "" && !isNum(c)) && (next >= cells.length ? numeric(first) === 0 : numeric(first) < numeric(cells[next]));

  let headerRows = hasHeader ? 1 : 0;
  const meta = new Map<string, string[]>();
  while (hasHeader && headerRows < cells.length) {
    const label = cells[headerRows]![0]!.toLowerCase();
    if (!META_ROWS.has(label) || meta.has(label)) break;
    meta.set(label, cells[headerRows]!);
    headerRows++;
  }
  const body = cells.slice(headerRows);
  const header = hasHeader ? first! : undefined;
  const columnCells = (j: number) => body.map((r) => r[j]!).filter((c) => c !== "");

  const named = header?.findIndex((h) => /^depth\b/i.test(h) || /^cm$/i.test(h)) ?? -1;
  const firstNumeric = Array.from({ length: width }, (_, j) => j).find((j) => {
    const cs = columnCells(j);
    return cs.length > 0 && cs.every(isNum);
  });
  const depthColumn = named !== -1 ? named : firstNumeric;
  const age = header?.findIndex((h, j) => j !== depthColumn && (/^age\b/i.test(h) || /\b(cal\.?\s*)?BP$/i.test(h) || /\bb2k$/i.test(h))) ?? -1;

  const columns = Array.from({ length: width }, (_, j): ClipboardColumn => {
    const cs = columnCells(j);
    const metaCell = (label: string) => meta.get(label)?.[j] || undefined;
    const given = metaCell("kind");
    let kind: MeasurementKind;
    if (given && (MEASUREMENT_KINDS as readonly string[]).includes(given)) kind = given as MeasurementKind;
    else if (cs.some((c) => !isNum(c) && c !== "-" && c !== "—")) kind = "abundanceClass";
    else kind = cs.some((c) => isNum(c) && !Number.isInteger(parseCellText(c, decimalComma))) ? "continuous" : "count";
    const col: ClipboardColumn = { index: j, name: header?.[j] || `Column ${j + 1}`, kind };
    const unit = metaCell("unit");
    const group = metaCell("group");
    if (unit) col.unit = unit;
    if (group) col.group = group;
    return col;
  });

  return { cells, width, headerRows, decimalComma, depthColumn, depthCertain: named !== -1, ageColumn: age === -1 ? undefined : age, columns, warnings };
}

export interface ClipboardImport {
  /** Dataset id and name. */
  id: string;
  name: string;
  depthUnit: Dataset["depthUnit"];
  depthColumn: number;
  ageColumn?: number;
  /** The variables, in this order (depth and age columns are skipped if listed). */
  columns: readonly ClipboardColumn[];
}

/**
 * Builds a dataset from a parsed clipboard table and the user's choices. Rows without a numeric depth
 * are skipped (warning). Empty cells and "-" are null; ordinal columns with text keep it as codes;
 * other text → null with a warning. Variable and sample ids as for edits (ids.ts).
 */
export function datasetFromClipboard(table: ClipboardTable, choice: ClipboardImport): EditResult {
  const warnings = [...table.warnings];
  const num = (c: string) => parseCellText(c, table.decimalComma);
  const cols = choice.columns.filter((c) => c.index !== choice.depthColumn && c.index !== choice.ageColumn);
  const varIds = new Set<string>();
  const variables: Variable[] = cols.map((c) => {
    const id = newVariableId(c.name, varIds);
    varIds.add(id);
    const v: Variable = { id, name: c.name.trim() || id, kind: c.kind };
    if (c.unit?.trim()) v.unit = c.unit.trim();
    if (c.group?.trim()) v.group = c.group.trim();
    return v;
  });
  const body = table.cells.slice(table.headerRows);
  const coded = cols.map((c, k) => ORDINAL.includes(variables[k]!.kind) && body.some((r) => typeof num(r[c.index] ?? "") === "string" && r[c.index] !== "-"));
  coded.forEach((isCoded, k) => {
    if (isCoded) variables[k]!.codes = [];
  });

  const samples: Sample[] = [];
  const values: (number | null)[][] = [];
  const sampleIds = new Set<string>();
  body.forEach((r, i) => {
    const rowNo = table.headerRows + i + 1;
    const depth = num(r[choice.depthColumn] ?? "");
    if (typeof depth !== "number") {
      warnings.push(`Row ${rowNo}: depth "${r[choice.depthColumn] ?? ""}" is not a number; row skipped.`);
      return;
    }
    const s: Sample = { id: newSampleId(depth, sampleIds), depth };
    sampleIds.add(s.id);
    if (choice.ageColumn !== undefined) {
      const age = num(r[choice.ageColumn] ?? "");
      if (typeof age === "number") s.age = age;
      else if (age !== null && age !== "-") warnings.push(`Row ${rowNo}: age "${age}" is not a number; ignored.`);
    }
    samples.push(s);
    values.push(
      cols.map((c, k) => {
        const cell = r[c.index] ?? "";
        const v = variables[k]!;
        if (v.codes) {
          if (cell === "" || cell === "—") return null;
          if (!v.codes.includes(cell)) v.codes.push(cell);
          return v.codes.indexOf(cell);
        }
        const x = num(cell);
        if (typeof x === "number" || x === null) return x;
        if (x !== "-") warnings.push(`Row ${rowNo}, "${v.name}": "${x}" is not a number; treated as empty.`);
        return null;
      }),
    );
  });
  if (samples.some((s, i) => i > 0 && s.depth < samples[i - 1]!.depth)) warnings.push("Depths are not in increasing order; order kept as pasted.");

  const groups: Group[] = [];
  for (const v of variables) {
    if (v.group !== undefined && !groups.some((g) => g.id === v.group)) groups.push({ id: v.group, name: v.group, order: groups.length + 1 });
  }
  return { dataset: { id: choice.id, name: choice.name, depthUnit: choice.depthUnit, samples, variables, groups, values }, warnings };
}
