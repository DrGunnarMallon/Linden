// Pure helpers for the Data tab (SPEC §11): how the sheet maps onto a dataset, and composite edits
// built from core's edit operations (a paste is one edit, so one undo step).

import {
  addSample,
  addVariable,
  parseCellText,
  setCell,
  setCells,
  setSampleAge,
  setSampleDepth,
  type CellInput,
  type ClipboardTable,
  type Dataset,
  type EditResult,
  type Spec,
} from "@linden/core";

/** A sheet column: the frozen depth / age columns, then one per variable. */
export type SheetColumn = { kind: "depth" } | { kind: "age" } | { kind: "variable"; index: number };

/** The age column is shown when any sample has an age. */
export function hasAgeColumn(ds: Dataset): boolean {
  return ds.samples.some((s) => s.age !== undefined);
}

export function sheetColumns(ds: Dataset, showAge = hasAgeColumn(ds)): SheetColumn[] {
  return [{ kind: "depth" }, ...(showAge ? [{ kind: "age" } as const] : []), ...ds.variables.map((_, index) => ({ kind: "variable", index }) as const)];
}

const COMMA_DECIMAL = /^[+-]?\d*,\d+$/;
const THOUSANDS = /^[+-]?\d{1,3},\d{3}$/;

/** A typed cell: "0,5" is a decimal comma (but "1,234" is not read as a number: it could be either). */
export function parseTyped(text: string): CellInput {
  const s = text.trim();
  return parseCellText(s, COMMA_DECIMAL.test(s) && !THOUSANDS.test(s));
}

/** Depth for a sample inserted at row `at`: halfway between its neighbours, else one step beyond the ends. */
export function insertDepth(ds: Dataset, at: number): number {
  const prev = ds.samples[at - 1]?.depth;
  const next = ds.samples[at]?.depth;
  if (prev !== undefined && next !== undefined) return (prev + next) / 2;
  const step = (a: number | undefined, b: number | undefined) => (a !== undefined && b !== undefined && a !== b ? Math.abs(a - b) : 1);
  if (prev !== undefined) return prev + step(prev, ds.samples[at - 2]?.depth);
  if (next !== undefined) return next - step(next, ds.samples[at + 1]?.depth);
  return 0;
}

/** Group of a raw variable as the diagram sees it: its spec assignment, else the data's group. */
export function effectiveGroup(spec: Spec, datasetId: string, ds: Dataset, variableId: string): string | undefined {
  return spec.datasets?.find((e) => e.dataset === datasetId)?.assignments?.[variableId] ?? ds.variables.find((v) => v.id === variableId)?.group;
}

/**
 * Spec assignment of a raw variable to a group (`undefined`: back to the data's group). Used for
 * variables the diagram does not show by themselves (merge sources); others move with specEdit.moveVariable.
 */
export function assignGroup(spec: Spec, ds: Dataset, variableId: string, groupId: string | undefined): Spec {
  const own = ds.variables.find((v) => v.id === variableId)?.group;
  const entries = spec.datasets ?? [];
  const entry = entries.find((e) => e.dataset === ds.id) ?? { dataset: ds.id };
  const { [variableId]: _old, ...rest } = entry.assignments ?? {};
  const assignments = groupId === undefined || groupId === own ? rest : { ...rest, [variableId]: groupId };
  const { assignments: _a, ...base } = entry;
  const next = Object.keys(assignments).length > 0 ? { ...base, assignments } : base;
  return { ...spec, datasets: entries.some((e) => e.dataset === ds.id) ? entries.map((e) => (e.dataset === ds.id ? next : e)) : [...entries, next] };
}

/** One typed cell of the sheet (row = sample, col = sheet column). A depth cannot be emptied; an age can. */
export function editSheetCell(ds: Dataset, at: { row: number; col: number }, text: string, showAge = hasAgeColumn(ds)): EditResult {
  const sample = ds.samples[at.row];
  const col = sheetColumns(ds, showAge)[at.col];
  if (!sample || !col) return { dataset: ds, warnings: [] };
  const value = parseTyped(text);
  if (col.kind === "depth") {
    if (typeof value === "number") return setSampleDepth(ds, sample.id, value);
    return { dataset: ds, warnings: [value === null ? "Every sample needs a depth; delete the sample instead." : `Depth "${text.trim()}" is not a number.`] };
  }
  if (col.kind === "age") {
    if (typeof value === "number" || value === null) return setSampleAge(ds, sample.id, value);
    return { dataset: ds, warnings: [`Age "${text.trim()}" is not a number.`] };
  }
  return setCell(ds, sample.id, ds.variables[col.index]!.id, value);
}

export interface PasteNeeds {
  rows: number;
  columns: number;
}

/** How many samples and variables a paste at (row, col) of the sheet would add. */
export function pasteNeeds(ds: Dataset, at: { row: number; col: number }, table: ClipboardTable, showAge = hasAgeColumn(ds)): PasteNeeds {
  const cols = sheetColumns(ds, showAge).length;
  return { rows: Math.max(0, at.row + table.cells.length - ds.samples.length), columns: Math.max(0, at.col + table.width - cols) };
}

/**
 * Pastes a clipboard table at (row, col) of the sheet, adding samples and variables as needed (the
 * caller asks before adding variables; pass `addColumns: false` to drop what does not fit). Pasted
 * depths are used for new samples; otherwise new depths continue the last spacing (with a warning).
 * New variables get the table's kind guesses. Every row is pasted, header rows included.
 */
export function pasteIntoSheet(ds: Dataset, at: { row: number; col: number }, table: ClipboardTable, opts: { addColumns: boolean; showAge?: boolean }): EditResult {
  const showAge = opts.showAge ?? hasAgeColumn(ds);
  const warnings = [...table.warnings];
  const value = (cell: string) => parseCellText(cell, table.decimalComma);
  const cols = sheetColumns(ds, showAge);
  const needs = pasteNeeds(ds, at, table, showAge);
  let out = ds;

  // New variables (right of the last column).
  if (needs.columns > 0) {
    if (opts.addColumns) {
      for (let k = 0; k < needs.columns; k++) {
        const j = table.width - needs.columns + k;
        out = addVariable(out, { name: `Variable ${out.variables.length + 1}`, kind: table.columns[j]?.kind ?? "count" }).dataset;
      }
    } else warnings.push(`${needs.columns} pasted column${needs.columns > 1 ? "s" : ""} outside the table ignored.`);
  }
  const allCols = sheetColumns(out, showAge);

  // New samples (below the last row), at the end so rows line up with the pasted block.
  const depthAt = cols.findIndex((c) => c.kind === "depth") - at.col;
  let guessed = 0;
  for (let k = 0; k < needs.rows; k++) {
    const i = out.samples.length - at.row;
    const pasted = depthAt >= 0 ? value(table.cells[i]?.[depthAt] ?? "") : null;
    let depth: number;
    if (typeof pasted === "number") depth = pasted;
    else {
      const last = out.samples[out.samples.length - 1]?.depth;
      const before = out.samples[out.samples.length - 2]?.depth;
      depth = last === undefined ? 0 : last + (before !== undefined && before !== last ? Math.abs(last - before) : 1);
      guessed++;
    }
    out = addSample(out, { depth }, out.samples.length).dataset;
  }
  if (guessed > 0) warnings.push(`${guessed} new sample${guessed > 1 ? "s were" : " was"} given depths continuing the last spacing; check them.`);

  // Depth and age cells, then one block of variable cells.
  const firstVar = allCols.findIndex((c) => c.kind === "variable");
  const block: CellInput[][] = [];
  table.cells.forEach((cells, i) => {
    const sample = out.samples[at.row + i];
    if (!sample) return;
    const row: CellInput[] = [];
    cells.forEach((cell, j) => {
      const col = allCols[at.col + j];
      if (!col) return;
      if (col.kind === "depth") {
        const d = value(cell);
        if (typeof d === "number") out = setSampleDepth(out, sample.id, d).dataset;
        else warnings.push(`Depth "${cell}" is not a number; the depth was not changed.`);
      } else if (col.kind === "age") {
        const a = value(cell);
        if (typeof a === "number" || a === null) out = setSampleAge(out, sample.id, a).dataset;
        else warnings.push(`Age "${cell}" is not a number; not set.`);
      } else row.push(cell === "" ? null : value(cell));
    });
    block.push(row);
  });
  const startVar = Math.max(at.col, firstVar) - firstVar;
  const firstSample = out.samples[at.row];
  const startVariable = out.variables[startVar];
  if (firstSample && startVariable && block.some((r) => r.length > 0)) {
    const r = setCells(out, { sampleId: firstSample.id, variableId: startVariable.id }, block);
    out = r.dataset;
    warnings.push(...r.warnings);
  }
  if (out.samples.some((s, i) => i > 0 && s.depth < out.samples[i - 1]!.depth)) warnings.push("Depths are not in increasing order; sort the samples by depth.");
  return { dataset: out, warnings: [...new Set(warnings)] };
}
