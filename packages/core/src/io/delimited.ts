// CSV / TSV importer — see SPEC.md §9.
// Wide format: depth[, age], then one column per variable.
// Optional header rows directly below the first: "group", "kind", "unit", "id" (variable ids
// other than the header without markup, written by exportDelimited after a rename) and/or "error"
// (error columns: "se of WTD" = this column is the SE of variable WTD; roles lower, upper, se, sd).
// An age header may carry the unit: "age (cal BP)".
// Lines starting with "#" before the header are comments (e.g. provenance notes).
// Ordinal columns (kind abundanceClass / presence) may hold text codes (DAFOR letters, "+"): they
// are kept as `variable.codes`, values = indices into it, for a scaleMap transform to map.

import type { Dataset, ErrorRole, Group, Importer, ImportResult, MeasurementKind, Sample, Variable } from "../model/types.js";

export type Delimiter = "," | "\t" | ";";

export interface DelimitedImportOptions {
  /** Dataset id and name. Default "dataset". */
  name?: string;
  /** Default: auto-detected from the header line. */
  delimiter?: Delimiter;
  /** Default "cm". */
  depthUnit?: Dataset["depthUnit"];
}

const MEASUREMENT_KINDS: readonly MeasurementKind[] = [
  "count",
  "percent",
  "concentration",
  "influx",
  "abundanceClass",
  "presence",
  "volumePercent",
  "continuous",
];

const DELIMITERS: readonly Delimiter[] = [",", "\t", ";"];

const AGE_UNITS: readonly NonNullable<Dataset["ageUnit"]>[] = ["cal BP", "BP", "CE/BCE", "b2k"];
/** "se of WTD" in an "error" row. */
const ERROR_CELL = /^(lower|upper|se|sd) of (.+)$/i;

/** Text without leading "#" comment lines. */
function skipComments(text: string): string {
  return text.replace(/^\uFEFF?(?:[ \t]*#[^\n]*(?:\r?\n|$))*/, "");
}

/** Picks the candidate delimiter that occurs most often (outside quotes) in the first non-comment line. Ties: , > tab > ; */
export function detectDelimiter(text: string): Delimiter {
  const counts = new Map<string, number>();
  let inQuotes = false;
  for (const ch of skipComments(text)) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && (ch === "\n" || ch === "\r")) break;
    else if (!inQuotes) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  }
  let best: Delimiter = ",";
  let bestCount = 0;
  for (const d of DELIMITERS) {
    const n = counts.get(d) ?? 0;
    if (n > bestCount) {
      best = d;
      bestCount = n;
    }
  }
  return best;
}

/** RFC 4180-style parser: quoted fields, "" escapes, embedded delimiters/newlines, CRLF or LF. */
export function parseDelimited(text: string, delimiter: Delimiter = detectDelimiter(text)): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
    i++;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const NUMBER_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/** Parses a trimmed numeric cell; returns NaN if not a number. Decimal comma accepted only when `decimalComma`. */
function parseNumber(cell: string, decimalComma: boolean): number {
  const s = decimalComma && !cell.includes(".") ? cell.replace(",", ".") : cell;
  return NUMBER_RE.test(s) ? Number(s) : Number.NaN;
}

function stripMarkup(name: string): string {
  return name.replace(/\*/g, "").trim();
}

export function importDelimited(text: string, options: DelimitedImportOptions = {}): ImportResult {
  const warnings: string[] = [];
  const name = options.name ?? "dataset";
  const delimiter = options.delimiter ?? detectDelimiter(text);
  // A semicolon-delimited file is the usual sign of decimal commas.
  const decimalComma = delimiter === ";";

  // Keep 1-based row numbers for warnings; drop blank rows.
  const rows = parseDelimited(skipComments(text), delimiter)
    .map((cells, i) => ({ cells: cells.map((c) => c.trim()), rowNo: i + 1 }))
    .filter((r) => r.cells.some((c) => c !== ""));

  const header = rows[0];
  if (!header) {
    warnings.push("File contains no data.");
    return { datasets: [], warnings };
  }

  const head = header.cells;
  if (!/^depth\b/i.test(head[0] ?? "")) {
    warnings.push(`First column "${head[0] ?? ""}" is assumed to be depth.`);
  }
  const hasAge = /^age\b/i.test(head[1] ?? "");
  const firstVar = hasAge ? 2 : 1;
  const ageUnit = hasAge ? AGE_UNITS.find((u) => /\((.*)\)/.exec(head[1]!)?.[1]?.trim().toLowerCase() === u.toLowerCase()) : undefined;

  // Optional "group" / "kind" / "unit" / "id" / "error" rows.
  let idRow: string[] | undefined;
  let groupRow: string[] | undefined;
  let kindRow: string[] | undefined;
  let unitRow: string[] | undefined;
  let errorRow: string[] | undefined;
  let r = 1;
  for (; r < rows.length; r++) {
    const row = rows[r]!;
    const label = (row.cells[0] ?? "").toLowerCase();
    if (label === "group") {
      if (groupRow) warnings.push(`Row ${row.rowNo}: duplicate "group" row ignored.`);
      else groupRow = row.cells;
    } else if (label === "kind") {
      if (kindRow) warnings.push(`Row ${row.rowNo}: duplicate "kind" row ignored.`);
      else kindRow = row.cells;
    } else if (label === "unit") {
      if (unitRow) warnings.push(`Row ${row.rowNo}: duplicate "unit" row ignored.`);
      else unitRow = row.cells;
    } else if (label === "id") {
      if (idRow) warnings.push(`Row ${row.rowNo}: duplicate "id" row ignored.`);
      else idRow = row.cells;
    } else if (label === "error") {
      if (errorRow) warnings.push(`Row ${row.rowNo}: duplicate "error" row ignored.`);
      else errorRow = row.cells;
    } else break;
  }

  // Variables.
  const variables: Variable[] = [];
  const ids = new Set<string>();
  for (let c = firstVar; c < head.length; c++) {
    let varName = head[c]!;
    if (varName === "") {
      varName = `column ${c + 1}`;
      warnings.push(`Column ${c + 1} has no name; called "${varName}".`);
    }
    let id = idRow?.[c] || stripMarkup(varName);
    if (ids.has(id)) {
      let k = 2;
      while (ids.has(`${id} (${k})`)) k++;
      warnings.push(`Duplicate column name "${id}" (column ${c + 1}); renamed to "${id} (${k})".`);
      id = `${id} (${k})`;
    }
    ids.add(id);

    const kindCell = kindRow?.[c] ?? "";
    let kind: MeasurementKind = "count";
    if (kindCell !== "") {
      if ((MEASUREMENT_KINDS as readonly string[]).includes(kindCell)) kind = kindCell as MeasurementKind;
      else warnings.push(`Unknown kind "${kindCell}" for "${id}"; using "count".`);
    }

    const v: Variable = { id, name: varName, kind };
    const group = groupRow?.[c] ?? "";
    if (group !== "") v.group = group;
    const unit = unitRow?.[c] ?? "";
    if (unit !== "") v.unit = unit;
    variables.push(v);
  }

  // Error columns: "se of WTD" (the target by id or by its header).
  if (errorRow) {
    variables.forEach((v, k) => {
      const cell = errorRow![k + firstVar] ?? "";
      if (cell === "") return;
      const m = ERROR_CELL.exec(cell);
      const target = m && variables.find((x) => x !== v && (x.id === m[2]!.trim() || x.name === m[2]!.trim()));
      if (!m || !target) warnings.push(`Error row, "${v.id}": "${cell}" is not "<lower|upper|se|sd> of <variable>"; ignored.`);
      else v.companion = { errorOf: target.id, role: m[1]!.toLowerCase() as ErrorRole };
    });
  }

  // Groups in order of first appearance.
  const groups: Group[] = [];
  for (const v of variables) {
    if (v.group !== undefined && !groups.some((g) => g.id === v.group)) {
      groups.push({ id: v.group, name: v.group, order: groups.length + 1 });
    }
  }

  // Ordinal columns with any non-numeric cell keep their cells as text codes (first-seen order).
  const ORDINAL: readonly MeasurementKind[] = ["abundanceClass", "presence"];
  const dataRows = rows.slice(r);
  const coded = variables.map(
    (v, k) =>
      ORDINAL.includes(v.kind) &&
      dataRows.some(({ cells }) => {
        const cell = cells[k + firstVar] ?? "";
        return cell !== "" && Number.isNaN(parseNumber(cell, decimalComma));
      }),
  );
  coded.forEach((isCoded, k) => {
    if (isCoded) variables[k]!.codes = [];
  });

  // Samples and values.
  const samples: Sample[] = [];
  const values: (number | null)[][] = [];
  const sampleIds = new Set<string>();
  let unsortedAt: number | undefined;
  for (; r < rows.length; r++) {
    const { cells, rowNo } = rows[r]!;
    const depthCell = cells[0] ?? "";
    const depth = parseNumber(depthCell, decimalComma);
    if (Number.isNaN(depth)) {
      warnings.push(`Row ${rowNo}: depth "${depthCell}" is not a number; row skipped.`);
      continue;
    }
    if (cells.length < head.length) {
      warnings.push(`Row ${rowNo}: ${cells.length} cells, expected ${head.length}; missing cells treated as empty.`);
    } else if (cells.length > head.length) {
      warnings.push(`Row ${rowNo}: ${cells.length} cells, expected ${head.length}; extra cells ignored.`);
    }

    const prev = samples[samples.length - 1];
    if (prev && depth < prev.depth && unsortedAt === undefined) unsortedAt = rowNo;

    let id = depthCell;
    if (sampleIds.has(id)) {
      warnings.push(`Row ${rowNo}: duplicate depth ${depthCell}.`);
      let k = 2;
      while (sampleIds.has(`${depthCell}#${k}`)) k++;
      id = `${depthCell}#${k}`;
    }
    sampleIds.add(id);
    const sample: Sample = { id, depth };

    if (hasAge) {
      const ageCell = cells[1] ?? "";
      if (ageCell !== "") {
        const age = parseNumber(ageCell, decimalComma);
        if (Number.isNaN(age)) warnings.push(`Row ${rowNo}: age "${ageCell}" is not a number; ignored.`);
        else sample.age = age;
      }
    }
    samples.push(sample);

    const rowValues: (number | null)[] = [];
    for (let c = firstVar; c < head.length; c++) {
      const cell = cells[c] ?? "";
      if (cell === "") {
        rowValues.push(null);
        continue;
      }
      const codes = variables[c - firstVar]!.codes;
      if (codes) {
        if (!codes.includes(cell)) codes.push(cell);
        rowValues.push(codes.indexOf(cell));
        continue;
      }
      const n = parseNumber(cell, decimalComma);
      if (Number.isNaN(n)) {
        warnings.push(`Row ${rowNo}, "${variables[c - firstVar]!.id}": "${cell}" is not a number; treated as empty.`);
        rowValues.push(null);
      } else rowValues.push(n);
    }
    values.push(rowValues);
  }

  if (unsortedAt !== undefined) {
    warnings.push(`Depths are not in increasing order (first at row ${unsortedAt}); order kept as in file.`);
  }

  const dataset: Dataset = {
    id: name,
    name,
    depthUnit: options.depthUnit ?? "cm",
    ...(ageUnit ? { ageUnit } : {}),
    samples,
    variables,
    groups,
    values,
  };
  return { datasets: [dataset], warnings };
}

function decodeText(input: ArrayBuffer): string {
  // TextDecoder exists in browsers and Node ≥ 11; reached via globalThis so core needs no DOM/Node typings.
  const { TextDecoder } = globalThis as unknown as {
    TextDecoder: new (label?: string) => { decode(input: ArrayBuffer): string };
  };
  return new TextDecoder("utf-8").decode(input);
}

export const csvImporter: Importer = {
  type: "csv",
  accepts(file) {
    return (
      /\.(csv|tsv|txt)$/i.test(file.name) ||
      file.mime === "text/csv" ||
      file.mime === "text/tab-separated-values"
    );
  },
  async import(input, options) {
    const text = typeof input === "string" ? input : decodeText(input);
    return importDelimited(text, (options ?? {}) as DelimitedImportOptions);
  },
};

export interface DelimitedExportOptions {
  /** Default ",". */
  delimiter?: Delimiter;
}

/** Quotes a field if it holds the delimiter, a quote, a line break or surrounding spaces (the importer trims). */
function csvField(text: string, delimiter: Delimiter): string {
  return text.includes(delimiter) || /["\r\n]/.test(text) || text !== text.trim() ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * The dataset as CSV in the importer's wide format, so it reads back the same: header (depth[, age
 * with its unit], variable names with markup), then "id" (only if an id differs from its name without
 * markup), "group" (if any), "kind", "unit" (if any) and "error" (if any) rows, then one row per sample. null → empty cell,
 * 0 → "0"; text codes are written as their codes. Numbers use the shortest exact form.
 */
export function exportDelimited(ds: Dataset, options: DelimitedExportOptions = {}): string {
  const d = options.delimiter ?? ",";
  const hasAge = ds.samples.some((s) => s.age !== undefined);
  const lead = hasAge ? 2 : 1;
  const row = (label: string, cells: readonly string[]) => [label, ...Array<string>(lead - 1).fill(""), ...cells];
  const age = ds.ageUnit ? `age (${ds.ageUnit})` : "age";
  const lines: string[][] = [["depth", ...(hasAge ? [age] : []), ...ds.variables.map((v) => v.name)]];
  if (ds.variables.some((v) => v.id !== stripMarkup(v.name))) lines.push(row("id", ds.variables.map((v) => v.id)));
  if (ds.variables.some((v) => v.group !== undefined)) lines.push(row("group", ds.variables.map((v) => v.group ?? "")));
  lines.push(row("kind", ds.variables.map((v) => v.kind)));
  if (ds.variables.some((v) => v.unit !== undefined)) lines.push(row("unit", ds.variables.map((v) => v.unit ?? "")));
  if (ds.variables.some((v) => v.companion)) lines.push(row("error", ds.variables.map((v) => (v.companion ? `${v.companion.role} of ${v.companion.errorOf}` : ""))));
  ds.samples.forEach((s, i) => {
    const cells = ds.variables.map((v, j) => {
      const x = ds.values[i]?.[j] ?? null;
      if (x === null) return "";
      return v.codes ? (v.codes[x] ?? "") : String(x);
    });
    lines.push([String(s.depth), ...(hasAge ? [s.age === undefined ? "" : String(s.age)] : []), ...cells]);
  });
  return `${lines.map((cells) => cells.map((c) => csvField(c, d)).join(d)).join("\n")}\n`;
}
