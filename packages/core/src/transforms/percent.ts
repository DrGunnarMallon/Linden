// Percent transform — SPEC.md §5.2. Counts → % of a named sum.
// Only variables of kind "count" take part; other kinds pass through unchanged.
// Variables outside the sum are % of the sum, or % of (sum + own group) for groups listed
// in ctx.outsideSum with basis "sumPlusGroup" (a preset choice, not core logic).

import { PercentTransformSchema } from "../model/spec.js";
import type { Dataset, SumDefinition, Transform, TransformContext, Variable } from "../model/types.js";

function sumMembers(ds: Dataset, name: string, def: SumDefinition, ctx: TransformContext): boolean[] {
  const isCount = ds.variables.map((v) => v.kind === "count");
  if (def.includeAll) return isCount;

  const groups = new Set(def.includeGroups ?? []);
  for (const g of groups) {
    if (!ds.variables.some((v) => v.group === g)) ctx.warn(`Sum "${name}": group "${g}" has no variables.`);
  }
  const ids = new Set(def.includeVariables ?? []);
  for (const id of ids) {
    const v = ds.variables.find((x) => x.id === id);
    if (!v) ctx.warn(`Sum "${name}": variable "${id}" not found.`);
    else if (v.kind !== "count") ctx.warn(`Sum "${name}": variable "${id}" is "${v.kind}", not "count"; left out.`);
  }
  return ds.variables.map(
    (v, j) => isCount[j]! && (ids.has(v.id) || (v.group !== undefined && groups.has(v.group))),
  );
}

export const percentTransform: Transform = {
  type: "percent",
  apply(ds: Dataset, params: unknown, ctx: TransformContext): Dataset {
    const parsed = PercentTransformSchema.safeParse(params);
    if (!parsed.success) {
      ctx.warn(`percent: invalid parameters; transform skipped.`);
      return ds;
    }
    const sumName = parsed.data.sum;
    const def = ctx.sums[sumName];
    if (!def) {
      ctx.warn(`percent: sum "${sumName}" is not defined; transform skipped.`);
      return ds;
    }
    const member = sumMembers(ds, sumName, def, ctx);
    if (!member.includes(true)) {
      ctx.warn(`percent: sum "${sumName}" contains no count variables; transform skipped.`);
      return ds;
    }

    const plusGroup = new Set(ctx.outsideSum?.basis === "sumPlusGroup" ? ctx.outsideSum.groups : []);
    // Group used for a "sum + group" denominator, per variable (undefined = plain sum).
    const extraGroup = ds.variables.map((v, j) =>
      v.kind === "count" && !member[j] && v.group !== undefined && plusGroup.has(v.group) ? v.group : undefined,
    );

    const values = ds.values.map((row, i) => {
      let sum = 0;
      let assessed = false;
      const groupTotals = new Map<string, number>();
      row.forEach((x, j) => {
        if (x === null) return;
        if (member[j]) {
          sum += x;
          assessed = true;
        }
        const g = extraGroup[j];
        if (g !== undefined) groupTotals.set(g, (groupTotals.get(g) ?? 0) + x);
      });

      const valid = assessed && sum !== 0;
      if (!valid) {
        const depth = ds.samples[i]?.depth;
        ctx.warn(
          assessed
            ? `percent: sample at depth ${depth} has sum "${sumName}" = 0; percentages set to null.`
            : `percent: sample at depth ${depth} has no assessed values in sum "${sumName}"; percentages set to null.`,
        );
      }

      return row.map((x, j) => {
        if (ds.variables[j]!.kind !== "count") return x;
        if (x === null || !valid) return null;
        const g = extraGroup[j];
        const denom = g === undefined ? sum : sum + groupTotals.get(g)!;
        return (x / denom) * 100;
      });
    });

    const variables: Variable[] = ds.variables.map((v) => (v.kind === "count" ? { ...v, kind: "percent", unit: "%" } : v));
    return { ...ds, variables, values };
  },
};
