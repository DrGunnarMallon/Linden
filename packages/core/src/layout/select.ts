// Declarative variable selection — SPEC.md §4 key rules.

import type { ResolvedSelection } from "../model/defaults.js";
import type { Dataset } from "../model/types.js";

/** Max of non-null values; 0 if none. */
export function columnMax(ds: Dataset, j: number): number {
  let max = 0;
  for (const row of ds.values) {
    const x = row[j];
    if (x !== null && x !== undefined && x > max) max = x;
  }
  return max;
}

function weightedAverageDepth(ds: Dataset, j: number): number {
  let num = 0;
  let den = 0;
  ds.values.forEach((row, i) => {
    const x = row[j];
    if (x !== null && x !== undefined && x > 0) {
      num += x * ds.samples[i]!.depth;
      den += x;
    }
  });
  return den > 0 ? num / den : Number.POSITIVE_INFINITY;
}

/** Returns variable indices in display order. */
export function selectVariables(ds: Dataset, sel: ResolvedSelection, warn: (m: string) => void): number[] {
  const ids = new Set(sel.ids ?? []);
  const groups = new Set(sel.groups ?? []);
  const all = ids.size === 0 && groups.size === 0;
  for (const id of ids) {
    if (!ds.variables.some((v) => v.id === id)) warn(`Variable "${id}" not found in dataset "${ds.id}".`);
  }

  let idx = ds.variables
    .map((v, j) => ({ v, j }))
    .filter(({ v }) => all || ids.has(v.id) || (v.group !== undefined && groups.has(v.group)))
    .filter(({ j }) => columnMax(ds, j) >= sel.minMax)
    .map(({ j }) => j);

  const order = sel.order;
  if (Array.isArray(order)) {
    const pos = (j: number) => {
      const p = order.indexOf(ds.variables[j]!.id);
      return p === -1 ? order.length : p;
    };
    idx = [...idx].sort((a, b) => pos(a) - pos(b) || a - b);
  } else if (order === "alphabetical") {
    const key = (j: number) => ds.variables[j]!.id.toLowerCase();
    idx = [...idx].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : a - b));
  } else if (order === "weightedAverageDepth") {
    idx = [...idx].sort((a, b) => {
      const wa = weightedAverageDepth(ds, a);
      const wb = weightedAverageDepth(ds, b);
      return wa === wb ? a - b : wa < wb ? -1 : 1;
    });
  } else if (order === "firstOccurrence") {
    warn(`Ordering "firstOccurrence" is not implemented yet; using data order.`);
  }
  return idx;
}
