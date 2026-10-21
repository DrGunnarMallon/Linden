// Declarative variable selection — SPEC.md §4 key rules.
// Columns: group order first, then the dataset's explicit `order` list within each group, then the
// panel's order for unlisted variables (so new taxa never vanish). Deterministic: every panel order
// except "data" breaks ties by variable id.

import type { ResolvedSelection } from "../model/defaults.js";
import { groupOrder } from "../model/groups.js";
import type { Dataset } from "../model/types.js";
import { stripMarkup } from "../render/svg.js";

/** Max of non-null values; 0 if none. */
export function columnMax(ds: Dataset, j: number): number {
  let max = 0;
  for (const row of ds.values) {
    const x = row[j];
    if (x !== null && x !== undefined && x > max) max = x;
  }
  return max;
}

/** Abundance-weighted mean depth of the non-zero values; +∞ if none. */
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

/** Depth of the deepest (oldest) non-zero value — the stratigraphic first appearance; −∞ if none. */
function firstOccurrenceDepth(ds: Dataset, j: number): number {
  let deepest = Number.NEGATIVE_INFINITY;
  ds.values.forEach((row, i) => {
    const x = row[j];
    if (x !== null && x !== undefined && x > 0) deepest = Math.max(deepest, ds.samples[i]!.depth);
  });
  return deepest;
}

/** Code-unit comparison: locale-independent, so the order is the same on every machine. */
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Stable sort by key, ties broken by variable id. */
function sortBy(ds: Dataset, idx: number[], key: (j: number) => number | string): number[] {
  const keys = new Map(idx.map((j) => [j, key(j)]));
  return [...idx].sort((a, b) => {
    const ka = keys.get(a)!;
    const kb = keys.get(b)!;
    return ka < kb ? -1 : ka > kb ? 1 : compareStrings(ds.variables[a]!.id, ds.variables[b]!.id);
  });
}

/** Stable sort by group (dataset group order; unknown groups next in first-seen order; ungrouped last), then by `explicit` position. */
function arrange(ds: Dataset, idx: number[], explicit: readonly string[]): number[] {
  const rank = new Map(groupOrder(ds).map((g, i) => [g, i]));
  const groupRank = (j: number): number => {
    const g = ds.variables[j]!.group;
    if (g === undefined) return Number.POSITIVE_INFINITY;
    if (!rank.has(g)) rank.set(g, rank.size);
    return rank.get(g)!;
  };
  const pos = (j: number): number => {
    const p = explicit.indexOf(ds.variables[j]!.id);
    return p === -1 ? explicit.length : p;
  };
  const keys = new Map(ds.variables.map((_, j) => [j, [groupRank(j), pos(j)] as const]));
  return [...idx].sort((a, b) => {
    const [ga, pa] = keys.get(a)!;
    const [gb, pb] = keys.get(b)!;
    return ga - gb || pa - pb;
  });
}

/** Returns variable indices in display order. `explicit` = the dataset's order list (within groups). */
export function selectVariables(
  ds: Dataset,
  sel: ResolvedSelection,
  warn: (m: string) => void,
  explicit: readonly string[] = [],
): number[] {
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
    // Listed variables first, in list order; the rest after them, by id.
    idx = sortBy(ds, idx, (j) => {
      const p = order.indexOf(ds.variables[j]!.id);
      return p === -1 ? order.length : p;
    });
  } else if (order === "alphabetical") {
    idx = sortBy(ds, idx, (j) => stripMarkup(ds.variables[j]!.name).toLowerCase());
  } else if (order === "weightedAverageDepth") {
    idx = sortBy(ds, idx, (j) => weightedAverageDepth(ds, j));
  } else if (order === "firstOccurrence") {
    idx = sortBy(ds, idx, (j) => -firstOccurrenceDepth(ds, j));
  }
  return arrange(ds, idx, explicit);
}
