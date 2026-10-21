// scaleMap transform — SPEC.md §5.2. Maps ordinal classes (1–5, DAFOR letters, "+" for presence…)
// to plotted values. The mapping is data (a named scale in the preset / dataset entry, or inline),
// never code. Text codes come from the importer as `variable.codes` (values = indices into it).
// Unmapped codes → null with a warning; an unmapped numeric 0 stays 0 (zero ≠ null).
// Axis labels (`scaleLabels`) list the whole chosen scale, so every class column reads the same.

import { formatNumber } from "../layout/scales.js";
import { ScaleMapTransformSchema, type ScaleSpec } from "../model/spec.js";
import type { Dataset, MeasurementKind, Transform, TransformContext, Variable } from "../model/types.js";

const DEFAULT_KINDS: readonly MeasurementKind[] = ["abundanceClass", "presence"];

/** Code of a stored value: the text code for coded variables, else the number as text. */
function codeOf(v: Variable, x: number): string | undefined {
  return v.codes ? v.codes[x] : formatNumber(x);
}

/** Axis labels: every entry of the scale, one per plotted value (first code in scale order), sorted by value. */
function labelsFor(map: ScaleSpec): { value: number; label: string }[] {
  const out: { value: number; label: string }[] = [];
  for (const [code, value] of Object.entries(map)) {
    if (value !== null && !out.some((l) => l.value === value)) out.push({ value, label: code });
  }
  return out.sort((a, b) => a.value - b.value);
}

/** Distinct codes a variable uses (non-null values). */
function codesUsed(ds: Dataset, j: number): string[] {
  const v = ds.variables[j]!;
  const out = new Set<string>();
  for (const row of ds.values) {
    const x = row[j];
    if (x !== null && x !== undefined) out.add(codeOf(v, x) ?? String(x));
  }
  return [...out];
}

export const scaleMapTransform: Transform = {
  type: "scaleMap",
  apply(ds: Dataset, params: unknown, ctx: TransformContext): Dataset {
    const parsed = ScaleMapTransformSchema.safeParse(params);
    if (!parsed.success) {
      ctx.warn("scaleMap: invalid parameters; transform skipped.");
      return ds;
    }
    const p = parsed.data;
    if ((p.scale === undefined) === (p.map === undefined)) {
      ctx.warn('scaleMap: give exactly one of "scale" (a named scale) or "map"; transform skipped.');
      return ds;
    }
    const names = p.scale === undefined ? [] : typeof p.scale === "string" ? [p.scale] : p.scale;
    const named: [string, ScaleSpec][] = [];
    for (const name of names) {
      const m = ctx.scales?.[name];
      if (m) named.push([name, m]);
      else ctx.warn(`scaleMap: scale "${name}" is not defined.`);
    }
    const candidates: [string, ScaleSpec][] = p.map ? [["(inline)", p.map]] : named;
    if (candidates.length === 0) {
      ctx.warn("scaleMap: no usable scale; transform skipped.");
      return ds;
    }
    const label = p.map ? "scaleMap" : `scaleMap "${names.join(", ")}"`;
    for (const id of p.variables ?? []) {
      if (!ds.variables.some((v) => v.id === id)) ctx.warn(`${label}: variable "${id}" not found in dataset "${ds.id}".`);
    }
    const kinds = p.kinds ?? DEFAULT_KINDS;
    const target = ds.variables.map((v) => (p.variables ? p.variables.includes(v.id) : kinds.includes(v.kind)));
    if (!target.includes(true)) return ds;

    // Per variable: the first candidate scale that contains every code it uses (else the first, with warnings).
    const chosen = ds.variables.map((_, j) => {
      if (!target[j]) return undefined;
      const used = codesUsed(ds, j);
      const covering = candidates.find(([, m]) => used.every((c) => Object.hasOwn(m, c) || (c === "0" && !ds.variables[j]!.codes)));
      return (covering ?? candidates[0]!)[1];
    });
    const unmapped = ds.variables.map(() => new Set<string>());
    const values = ds.values.map((row) =>
      row.map((x, j) => {
        const map = chosen[j];
        if (!map || x === null) return x;
        const v = ds.variables[j]!;
        const code = codeOf(v, x);
        if (code !== undefined && Object.hasOwn(map, code)) return map[code]!;
        if (!v.codes && x === 0) return 0;
        unmapped[j]!.add(code ?? String(x));
        return null;
      }),
    );

    const variables = ds.variables.map((v, j) => {
      if (!target[j]) return v;
      if (unmapped[j]!.size > 0) {
        ctx.warn(`${label}: "${v.id}" has values not in the scale (${[...unmapped[j]!].join(", ")}); set to null.`);
      }
      const { codes: _codes, ...rest } = v;
      return { ...rest, scaleLabels: labelsFor(chosen[j]!) };
    });
    return { ...ds, variables, values };
  },
};
