// Merge transform — SPEC.md §5.2. Sums several variables into one per sample (e.g. two moss
// species into one genus). null + number = number; all null = null; 0 stays 0.
// Must run before "percent" so merged taxa are percentages of the same sum (enforced by the pipeline).

import { MergeTransformSchema, type TransformSpec } from "../model/spec.js";
import type { Dataset, Transform, TransformContext, Variable } from "../model/types.js";

export const mergeTransform: Transform = {
  type: "merge",
  apply(ds: Dataset, params: unknown, ctx: TransformContext): Dataset {
    const parsed = MergeTransformSchema.safeParse(params);
    if (!parsed.success) {
      ctx.warn("merge: invalid parameters; transform skipped.");
      return ds;
    }
    const p = parsed.data;
    const skip = (why: string) => {
      ctx.warn(`merge "${p.id}": ${why}; merge skipped.`);
      return ds;
    };

    const cols: number[] = [];
    for (const id of p.from) {
      const j = ds.variables.findIndex((v) => v.id === id);
      if (j === -1) ctx.warn(`merge "${p.id}": source "${id}" not found in dataset "${ds.id}"; left out.`);
      else if (cols.includes(j)) ctx.warn(`merge "${p.id}": source "${id}" listed twice; counted once.`);
      else cols.push(j);
    }
    if (cols.length === 0) return skip("no sources found");

    const sources = cols.map((j) => ds.variables[j]!);
    const kinds = [...new Set(sources.map((v) => v.kind))];
    if (kinds.length > 1) return skip(`sources have different kinds (${kinds.join(", ")})`);
    const units = [...new Set(sources.map((v) => v.unit ?? ""))];
    if (units.length > 1) ctx.warn(`merge "${p.id}": sources have different units (${units.map((u) => u || "none").join(", ")}); summed anyway.`);

    const keep = p.keepSources ?? false;
    const clash = ds.variables.some((v, j) => v.id === p.id && (keep || !cols.includes(j)));
    if (clash) return skip(`a variable with id "${p.id}" already exists`);

    const first = sources[0]!;
    let group = first.group;
    if (p.group !== undefined) {
      if (ds.groups.some((g) => g.id === p.group)) group = p.group;
      else ctx.warn(`merge "${p.id}": group "${p.group}" does not exist; using the first source's group.`);
    }
    const merged: Variable = { id: p.id, name: p.name, kind: first.kind };
    if (first.unit !== undefined) merged.unit = first.unit;
    if (group !== undefined) merged.group = group;

    const sumRow = (row: (number | null)[]): number | null => {
      let sum: number | null = null;
      for (const j of cols) {
        const x = row[j];
        if (x !== null && x !== undefined) sum = (sum ?? 0) + x;
      }
      return sum;
    };

    // The merged variable takes the place of its first source (in data order).
    const at = Math.min(...cols);
    const removed = new Set(keep ? [] : cols);
    const reorder = <T>(items: readonly T[], extra: T): T[] => {
      const out: T[] = [];
      items.forEach((item, j) => {
        if (j === at) out.push(extra);
        if (!removed.has(j)) out.push(item);
      });
      return out;
    };
    return {
      ...ds,
      variables: reorder(ds.variables, merged),
      values: ds.values.map((row) => reorder(row, sumRow(row))),
    };
  },
};

/** Ids used as a source by more than one merge in the same transform list, in first-seen order. */
export function mergedTwice(transforms: readonly TransformSpec[]): string[] {
  const seen = new Set<string>();
  const twice: string[] = [];
  for (const t of transforms) {
    if (t.type !== "merge") continue;
    for (const id of new Set(t.from)) {
      if (seen.has(id) && !twice.includes(id)) twice.push(id);
      seen.add(id);
    }
  }
  return twice;
}
