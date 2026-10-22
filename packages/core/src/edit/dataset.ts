// Pure edit operations on a Dataset — SPEC.md §5.4. Every operation takes variables and samples by
// id, returns a NEW dataset plus warnings and never mutates its input. An edit that changes nothing
// (or is refused) returns the input dataset itself, so callers can skip work by reference equality.
// 0 and null stay distinct throughout: null = not assessed.

import type { Dataset, MeasurementKind, Sample, Variable } from "../model/types.js";
import { sampleId as newSampleId, variableId as newVariableId } from "./ids.js";

export interface EditResult {
  dataset: Dataset;
  warnings: string[];
}

export interface AddResult extends EditResult {
  /** Id of the new variable or sample. */
  id: string;
}

/** A cell as entered: a number, null (not assessed) or text (a code of an ordinal column, or a number still to parse). */
export type CellInput = number | null | string;

const ORDINAL: readonly MeasurementKind[] = ["abundanceClass", "presence"];
const NUMBER_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
/** Text that means "not assessed": empty, or a dash (en/em dash as shown by the app). */
const NULL_TEXT = new Set(["", "—", "–"]);

const same = (ds: Dataset, ...warnings: string[]): EditResult => ({ dataset: ds, warnings });

/**
 * Text → number, null or (non-numeric) text: "", "—" → null; "-" stays text, which setCells reads
 * as null unless the column uses "-" as a code. `decimalComma` accepts "0,5" (only without a ".").
 */
export function parseCellText(text: string, decimalComma = false): CellInput {
  const s = text.trim();
  if (NULL_TEXT.has(s)) return null;
  const n = decimalComma && !s.includes(".") ? s.replace(",", ".") : s;
  return NUMBER_RE.test(n) ? Number(n) : s;
}

function varIndex(ds: Dataset, id: string): number {
  return ds.variables.findIndex((v) => v.id === id);
}

function sampleIndex(ds: Dataset, id: string): number {
  return ds.samples.findIndex((s) => s.id === id);
}

/** Warning if depths no longer increase downwards (duplicates included). */
function orderWarnings(samples: readonly Sample[]): string[] {
  for (let i = 1; i < samples.length; i++) {
    if (samples[i]!.depth < samples[i - 1]!.depth) return ["Depths are not in increasing order; sort the samples by depth."];
  }
  return [];
}

interface Resolved {
  value?: number | null;
  /** New codes list of the variable (a code was added). */
  codes?: string[];
  warning?: string;
}

/** What `input` means for variable `v` whose column currently holds `column`. */
function resolveInput(v: Variable, column: () => readonly (number | null)[], input: CellInput): Resolved {
  if (input === null) return { value: null };
  if (typeof input === "number") {
    if (!Number.isFinite(input)) return { warning: `"${v.name}": ${input} is not a finite number; not set.` };
    if (v.codes) return { warning: `"${v.name}" holds text codes; enter a code, not ${input}.` };
    return { value: input };
  }
  const s = input.trim();
  if (v.codes) {
    if (NULL_TEXT.has(s)) return { value: null };
    const at = v.codes.indexOf(s);
    if (at !== -1) return { value: at };
    // "-" is a code only where the column already uses it (e.g. DAFOR "absent"); else it means "not assessed".
    if (s === "-") return { value: null };
    return { value: v.codes.length, codes: [...v.codes, s] };
  }
  const parsed = parseCellText(s);
  if (typeof parsed === "number" || parsed === null) return { value: parsed };
  if (s === "-") return { value: null };
  if (ORDINAL.includes(v.kind) && column().every((x) => x === null)) return { value: 0, codes: [s] };
  return { warning: `"${v.name}": "${s}" is not a number; not set.` };
}

/**
 * Writes a block of cells (rows = samples, columns = variables) starting at the given sample and
 * variable. Cells beyond the last sample or variable are ignored with a warning; add samples or
 * variables first. Text in an ordinal column becomes a code.
 */
export function setCells(ds: Dataset, start: { sampleId: string; variableId: string }, block: readonly (readonly CellInput[])[]): EditResult {
  const r0 = sampleIndex(ds, start.sampleId);
  const c0 = varIndex(ds, start.variableId);
  if (r0 === -1) return same(ds, `Unknown sample "${start.sampleId}".`);
  if (c0 === -1) return same(ds, `Unknown variable "${start.variableId}".`);
  const warnings: string[] = [];
  let values = ds.values;
  let variables = ds.variables;
  const copiedRows = new Set<number>();
  let outside = 0;
  block.forEach((cells, i) =>
    cells.forEach((input, j) => {
      const r = r0 + i;
      const c = c0 + j;
      if (r >= ds.samples.length || c >= variables.length) {
        outside++;
        return;
      }
      const v = variables[c]!;
      const res = resolveInput(v, () => values.map((row) => row[c] ?? null), input);
      if (res.warning) warnings.push(res.warning);
      if (res.value === undefined) return;
      if (res.codes) {
        if (variables === ds.variables) variables = [...variables];
        variables[c] = { ...v, codes: res.codes };
      }
      if (values[r]![c] === res.value) return;
      if (values === ds.values) values = [...values];
      if (!copiedRows.has(r)) {
        values[r] = [...values[r]!];
        copiedRows.add(r);
      }
      (values[r] as (number | null)[])[c] = res.value;
    }),
  );
  if (outside > 0) warnings.push(`${outside} cell${outside > 1 ? "s" : ""} outside the table ignored.`);
  if (values === ds.values && variables === ds.variables) return same(ds, ...warnings);
  return { dataset: { ...ds, variables, values }, warnings };
}

export function setCell(ds: Dataset, sampleId: string, variableId: string, value: CellInput): EditResult {
  return setCells(ds, { sampleId, variableId }, [[value]]);
}

function updateVariable(ds: Dataset, id: string, fn: (v: Variable) => Variable | string): EditResult {
  const i = varIndex(ds, id);
  if (i === -1) return same(ds, `Unknown variable "${id}".`);
  const next = fn(ds.variables[i]!);
  if (typeof next === "string") return same(ds, next);
  if (next === ds.variables[i]) return same(ds);
  const variables = [...ds.variables];
  variables[i] = next;
  return { dataset: { ...ds, variables }, warnings: [] };
}

/** Changes the display name only; the id (and every spec reference to it) stays. */
export function renameVariable(ds: Dataset, id: string, name: string): EditResult {
  const trimmed = name.trim();
  return updateVariable(ds, id, (v) => (trimmed === "" ? "A variable name cannot be empty." : trimmed === v.name ? v : { ...v, name: trimmed }));
}

/**
 * Sets the measurement kind. A column of text codes changed to a non-ordinal kind gets its codes as
 * numbers where they are numbers; other codes become null (with a warning).
 */
export function setVariableKind(ds: Dataset, id: string, kind: MeasurementKind): EditResult {
  const i = varIndex(ds, id);
  const v = ds.variables[i];
  if (!v) return same(ds, `Unknown variable "${id}".`);
  if (v.kind === kind) return same(ds);
  if (!v.codes || ORDINAL.includes(kind)) return updateVariable(ds, id, (x) => ({ ...x, kind }));
  const codes = v.codes;
  let lost = 0;
  const values = ds.values.map((row) => {
    const out = [...row];
    const code = row[i];
    if (code === null || code === undefined) return out;
    const text = codes[code] ?? "";
    const n = NUMBER_RE.test(text) ? Number(text) : Number.NaN;
    if (Number.isNaN(n)) lost++;
    out[i] = Number.isNaN(n) ? null : n;
    return out;
  });
  const { codes: _codes, ...rest } = v;
  const variables = [...ds.variables];
  variables[i] = { ...rest, kind };
  const warnings = lost > 0 ? [`"${v.name}": ${lost} text code${lost > 1 ? "s are" : " is"} not a number and became empty (not assessed).`] : [];
  return { dataset: { ...ds, variables, values }, warnings };
}

/** Sets the unit; "" or undefined removes it. */
export function setVariableUnit(ds: Dataset, id: string, unit: string | undefined): EditResult {
  const u = unit?.trim() ?? "";
  return updateVariable(ds, id, (v) => {
    if ((v.unit ?? "") === u) return v;
    if (u !== "") return { ...v, unit: u };
    const { unit: _unit, ...rest } = v;
    return rest;
  });
}

export interface NewVariable {
  name: string;
  kind?: MeasurementKind;
  unit?: string;
  /** Group id; added to `dataset.groups` if the data has no such group yet. */
  group?: string;
}

/** Adds an empty (all null) variable at column `at` (default: last). Its id is derived from the name (ids.ts). */
export function addVariable(ds: Dataset, spec: NewVariable, at = ds.variables.length): AddResult {
  const name = spec.name.trim();
  const id = newVariableId(name, new Set(ds.variables.map((v) => v.id)));
  const v: Variable = { id, name: name || id, kind: spec.kind ?? "count" };
  if (spec.unit?.trim()) v.unit = spec.unit.trim();
  if (spec.group?.trim()) v.group = spec.group.trim();
  const k = Math.max(0, Math.min(at, ds.variables.length));
  const variables = [...ds.variables.slice(0, k), v, ...ds.variables.slice(k)];
  const values = ds.values.map((row) => [...row.slice(0, k), null, ...row.slice(k)]);
  let groups = ds.groups;
  if (v.group !== undefined && !groups.some((g) => g.id === v.group)) {
    const orders = groups.map((g) => g.order).filter(Number.isFinite);
    groups = [...groups, { id: v.group, name: v.group, order: (orders.length ? Math.max(...orders) : 0) + 1 }];
  }
  return { dataset: { ...ds, variables, values, groups }, warnings: [], id };
}

/** Removes a variable and its column. Spec references to it are not touched: see danglingReferences / cleanupSpec. */
export function deleteVariable(ds: Dataset, id: string): EditResult {
  const i = varIndex(ds, id);
  if (i === -1) return same(ds, `Unknown variable "${id}".`);
  return {
    dataset: { ...ds, variables: ds.variables.filter((_, k) => k !== i), values: ds.values.map((row) => row.filter((_, k) => k !== i)) },
    warnings: [],
  };
}

/** Moves a variable (and its column) to position `toIndex` (clamped). */
export function moveVariable(ds: Dataset, id: string, toIndex: number): EditResult {
  const i = varIndex(ds, id);
  if (i === -1) return same(ds, `Unknown variable "${id}".`);
  const to = Math.max(0, Math.min(toIndex, ds.variables.length - 1));
  if (to === i) return same(ds);
  const move = <T>(list: readonly T[]): T[] => {
    const out = [...list];
    const [x] = out.splice(i, 1);
    out.splice(to, 0, x!);
    return out;
  };
  return { dataset: { ...ds, variables: move(ds.variables), values: ds.values.map(move) }, warnings: [] };
}

export interface NewSample {
  depth: number;
  age?: number;
  label?: string;
}

/** Adds an empty (all null) sample at row `at`; default: after the last sample not deeper than it. */
export function addSample(ds: Dataset, spec: NewSample, at?: number): AddResult {
  if (!Number.isFinite(spec.depth)) return { ...same(ds, `Depth ${spec.depth} is not a finite number; no sample added.`), id: "" };
  const id = newSampleId(spec.depth, new Set(ds.samples.map((s) => s.id)));
  const sample: Sample = { id, depth: spec.depth };
  if (spec.age !== undefined && Number.isFinite(spec.age)) sample.age = spec.age;
  if (spec.label !== undefined) sample.label = spec.label;
  let k = at ?? ds.samples.length;
  if (at === undefined) {
    const deeper = ds.samples.findIndex((s) => s.depth > spec.depth);
    if (deeper !== -1) k = deeper;
  }
  k = Math.max(0, Math.min(k, ds.samples.length));
  const samples = [...ds.samples.slice(0, k), sample, ...ds.samples.slice(k)];
  const values = [...ds.values.slice(0, k), ds.variables.map(() => null), ...ds.values.slice(k)];
  return { dataset: { ...ds, samples, values }, warnings: orderWarnings(samples), id };
}

export function deleteSample(ds: Dataset, id: string): EditResult {
  const i = sampleIndex(ds, id);
  if (i === -1) return same(ds, `Unknown sample "${id}".`);
  const warnings = ds.extra?.spikes?.some((s) => s.sampleId === id) ? [`Spike data of sample "${id}" now refer to no sample.`] : [];
  return { dataset: { ...ds, samples: ds.samples.filter((_, k) => k !== i), values: ds.values.filter((_, k) => k !== i) }, warnings };
}

function updateSample(ds: Dataset, id: string, fn: (s: Sample) => Sample | string): EditResult {
  const i = sampleIndex(ds, id);
  if (i === -1) return same(ds, `Unknown sample "${id}".`);
  const next = fn(ds.samples[i]!);
  if (typeof next === "string") return same(ds, next);
  if (next === ds.samples[i]) return same(ds);
  const samples = [...ds.samples];
  samples[i] = next;
  return { dataset: { ...ds, samples }, warnings: [] };
}

/** Sets a sample's depth; the sample keeps its id and row. Warns if depths stop increasing or repeat. */
export function setSampleDepth(ds: Dataset, id: string, depth: number): EditResult {
  if (!Number.isFinite(depth)) return same(ds, `Depth ${depth} is not a finite number; not set.`);
  const r = updateSample(ds, id, (s) => (s.depth === depth ? s : { ...s, depth }));
  if (r.dataset === ds) return r;
  const dup = ds.samples.some((s) => s.id !== id && s.depth === depth) ? [`Another sample is at depth ${depth} too.`] : [];
  return { ...r, warnings: [...orderWarnings(r.dataset.samples), ...dup] };
}

/** Sets a sample's age; null removes it. */
export function setSampleAge(ds: Dataset, id: string, age: number | null): EditResult {
  if (age !== null && !Number.isFinite(age)) return same(ds, `Age ${age} is not a finite number; not set.`);
  return updateSample(ds, id, (s) => {
    if ((s.age ?? null) === age) return s;
    if (age !== null) return { ...s, age };
    const { age: _age, ageError: _err, ...rest } = s;
    return rest;
  });
}

/** Stable sort of the samples (with their rows) by depth, shallowest first. */
export function sortSamplesByDepth(ds: Dataset): EditResult {
  const order = ds.samples.map((s, i) => ({ s, i })).sort((a, b) => a.s.depth - b.s.depth || a.i - b.i);
  if (order.every(({ i }, k) => i === k)) return same(ds);
  return { dataset: { ...ds, samples: order.map(({ s }) => s), values: order.map(({ i }) => ds.values[i]!) }, warnings: [] };
}
