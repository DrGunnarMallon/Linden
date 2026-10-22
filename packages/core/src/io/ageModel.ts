// Age–depth model import — SPEC.md §9. A table with a depth column and one or more age columns (e.g.
// Bacon's *_ages.txt: depth, min, max, median, mean). The chosen age column is interpolated linearly
// to the sample depths and stored as the samples' ages, with a note of the source. No extrapolation:
// samples outside the model's depth range get no age (warning). Age–depth modelling itself is out of scope.

import type { EditResult } from "../edit/dataset.js";
import { interpolate } from "../layout/scales.js";
import type { Dataset } from "../model/types.js";
import { parseDelimited } from "./delimited.js";

export interface AgeModelTable {
  /** Column names (from the header row; "column n" without one). */
  columns: string[];
  /** Numeric cells; null = empty or not a number. */
  rows: (number | null)[][];
  /** Guessed columns: a "depth" column (else the first) and "median", "mean" or an "age" column. */
  depthColumn: number;
  ageColumn: number;
  warnings: string[];
}

const NUMBER_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

function num(cell: string, decimalComma: boolean): number | null {
  const s = decimalComma && !cell.includes(".") ? cell.replace(",", ".") : cell;
  return NUMBER_RE.test(s) ? Number(s) : null;
}

/** Splits the text into cells: tab, comma or semicolon delimited, else runs of spaces (R's write.table). */
function cellsOf(text: string): { cells: string[][]; decimalComma: boolean } {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "" && !l.trim().startsWith("#"));
  const first = lines[0] ?? "";
  const unquote = (c: string) => c.trim().replace(/^"(.*)"$/, "$1");
  for (const d of ["\t", ",", ";"] as const) {
    if (first.includes(d)) return { cells: parseDelimited(lines.join("\n"), d).map((r) => r.map(unquote)), decimalComma: d === ";" };
  }
  return { cells: lines.map((l) => l.trim().split(/\s+/).map(unquote)), decimalComma: false };
}

/** Reads an age–depth model table and guesses its depth and age columns. */
export function parseAgeModel(text: string): AgeModelTable {
  const warnings: string[] = [];
  const { cells, decimalComma } = cellsOf(text);
  const header = cells[0] !== undefined && cells[0].some((c) => c !== "" && num(c, decimalComma) === null) ? cells[0] : undefined;
  const body = header ? cells.slice(1) : cells;
  // R writes row names without a header cell: the header is one cell short.
  const shift = header && body[0] && body[0].length === header.length + 1 ? 1 : 0;
  const width = Math.max(header?.length ?? 0, ...body.map((r) => r.length - shift));
  const columns = Array.from({ length: width }, (_, k) => header?.[k] || `column ${k + 1}`);
  const rows = body.map((r) => columns.map((_, k) => num(r[k + shift] ?? "", decimalComma)));
  if (rows.length === 0) warnings.push("The age model has no rows.");
  if (width < 2) warnings.push("The age model needs a depth and an age column.");
  const find = (re: RegExp) => columns.findIndex((c) => re.test(c));
  const depthColumn = Math.max(0, find(/depth/i));
  const candidates = [find(/^median$/i), find(/^mean$/i), find(/age|bp|b2k/i), columns.findIndex((_, k) => k !== depthColumn)];
  const ageColumn = Math.max(0, candidates.find((k) => k !== -1 && k !== depthColumn) ?? (depthColumn === 0 ? 1 : 0));
  return { columns, rows, depthColumn, ageColumn, warnings };
}

export interface AgeModelChoice {
  depthColumn: number;
  ageColumn: number;
  /** Where the model came from, e.g. the file name; kept in dataset.ageSource. */
  source: string;
  ageUnit?: Dataset["ageUnit"];
}

const fmt = (n: number) => String(Number(n.toPrecision(6)));

/**
 * Sets every sample's age from the model: linear interpolation between the model's depths (same unit
 * as the dataset's depths). Samples outside the model's depth range get no age (warning); ages that
 * decrease with depth are reported. Refused if fewer than two rows have both a depth and an age.
 */
export function applyAgeModel(ds: Dataset, model: AgeModelTable, choice: AgeModelChoice): EditResult {
  const pairs = model.rows
    .map((r, i) => ({ depth: r[choice.depthColumn] ?? null, age: r[choice.ageColumn] ?? null, i }))
    .filter((p): p is { depth: number; age: number; i: number } => p.depth !== null && p.age !== null)
    .sort((a, b) => a.depth - b.depth || a.i - b.i);
  const ageName = model.columns[choice.ageColumn] ?? `column ${choice.ageColumn + 1}`;
  if (pairs.length < 2) return { dataset: ds, warnings: [`The age model has fewer than two rows with a depth and an age ("${ageName}"); no ages set.`] };
  const depths = pairs.map((p) => p.depth);
  const ages = pairs.map((p) => p.age);
  const warnings: string[] = [];
  const inversion = ages.findIndex((a, k) => k > 0 && a < ages[k - 1]!);
  if (inversion !== -1) warnings.push(`The age model's ages ("${ageName}") decrease with depth at ${fmt(depths[inversion]!)} ${ds.depthUnit}.`);

  const outside: number[] = [];
  const samples = ds.samples.map((s) => {
    const age = interpolate(depths, ages, s.depth);
    if (age === undefined) outside.push(s.depth);
    const { age: _age, ageError: _err, ...rest } = s;
    return age === undefined ? rest : { ...rest, age: Number(age.toPrecision(12)) };
  });
  if (outside.length > 0) {
    const listed = outside.slice(0, 5).map(fmt).join(", ") + (outside.length > 5 ? ", …" : "");
    warnings.push(
      `${outside.length} sample${outside.length > 1 ? "s lie" : " lies"} outside the age model's depth range (${fmt(depths[0]!)}–${fmt(depths[depths.length - 1]!)} ${ds.depthUnit}) ` +
        `and got no age (no extrapolation): ${listed} ${ds.depthUnit}.`,
    );
  }
  const dataset: Dataset = { ...ds, samples, ageSource: `${choice.source}, column "${ageName}", interpolated linearly to the sample depths` };
  if (choice.ageUnit) dataset.ageUnit = choice.ageUnit;
  return { dataset, warnings };
}
