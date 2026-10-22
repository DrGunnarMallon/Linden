// Spec references to variables that no longer exist (e.g. after deleteVariable) — SPEC.md §5.4.
// Edits never change the spec behind the user's back: danglingReferences reports them, and
// cleanupSpec removes them only when asked.

import type { DatasetEntry, MergeTransformParams, PanelSpec, Spec, TransformSpec } from "../model/spec.js";
import type { Dataset } from "../model/types.js";

export interface DanglingReference {
  /** Where in the spec, e.g. `datasets[0].assignments.Pinus`, `curveStyles.Pinus`. */
  path: string;
  /** The variable id that refers to nothing. */
  id: string;
}

const isMerge = (t: TransformSpec): t is MergeTransformParams => t.type === "merge";

/** Variable ids a dataset's spec entry may refer to: its variables, plus merges with at least one source left. */
function validIds(ds: Dataset, entry: DatasetEntry | undefined): Set<string> {
  const ids = new Set(ds.variables.map((v) => v.id));
  for (const t of entry?.transforms ?? []) {
    if (isMerge(t) && t.from.some((id) => ds.variables.some((v) => v.id === id))) ids.add(t.id);
  }
  return ids;
}

interface Context {
  /** Valid ids by dataset id (only datasets that were passed in). */
  byDataset: Map<string, Set<string>>;
  /** Valid in any dataset (curveStyles and headers are not per dataset). */
  any: Set<string>;
}

function context(spec: Spec, datasets: readonly Dataset[]): Context {
  const byDataset = new Map(datasets.map((ds) => [ds.id, validIds(ds, spec.datasets?.find((e) => e.dataset === ds.id))]));
  return { byDataset, any: new Set([...byDataset.values()].flatMap((s) => [...s])) };
}

/**
 * Every spec reference to a variable id that is no variable (or merge) of the datasets. Checks
 * dataset entries (assignments, order, merge sources, scaleMap variables), taxonCurves panels
 * (explicit ids and order, overrides), explicit headers and curveStyles. Entries and panels of
 * datasets not passed in are skipped; `datasets` should be all the project's datasets, since
 * curveStyles and headers apply to any dataset. Order follows the spec.
 */
export function danglingReferences(spec: Spec, datasets: readonly Dataset[]): DanglingReference[] {
  const ctx = context(spec, datasets);
  const out: DanglingReference[] = [];
  const check = (path: string, ids: Iterable<string>, valid: ReadonlySet<string>) => {
    for (const id of ids) if (!valid.has(id)) out.push({ path, id });
  };
  spec.datasets?.forEach((e, i) => {
    const valid = ctx.byDataset.get(e.dataset);
    if (!valid) return;
    const raw = new Set(datasets.find((d) => d.id === e.dataset)!.variables.map((v) => v.id));
    for (const id of Object.keys(e.assignments ?? {})) if (!valid.has(id)) out.push({ path: `datasets[${i}].assignments.${id}`, id });
    check(`datasets[${i}].order`, e.order ?? [], valid);
    e.transforms?.forEach((t, k) => {
      if (isMerge(t)) check(`datasets[${i}].transforms[${k}].from`, t.from, raw);
      else if (t.type === "scaleMap") check(`datasets[${i}].transforms[${k}].variables`, t.variables ?? [], valid);
    });
  });
  spec.panels.forEach((p, i) => {
    if (p.type !== "taxonCurves") return;
    const valid = ctx.byDataset.get(p.dataset);
    if (!valid) return;
    check(`panels[${i}].variables.ids`, p.variables?.ids ?? [], valid);
    if (Array.isArray(p.variables?.order)) check(`panels[${i}].variables.order`, p.variables.order, valid);
    for (const id of Object.keys(p.overrides ?? {})) if (!valid.has(id)) out.push({ path: `panels[${i}].overrides.${id}`, id });
  });
  spec.headers?.forEach((h, i) => check(`headers[${i}].spans.ids`, h.spans.ids ?? [], ctx.any));
  for (const id of Object.keys(spec.curveStyles ?? {})) if (!ctx.any.has(id)) out.push({ path: `curveStyles.${id}`, id });
  return out;
}

function pick<T>(record: Record<string, T>, keep: (id: string) => boolean): Record<string, T> | undefined {
  const entries = Object.entries(record).filter(([id]) => keep(id));
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

/** Sets `key` to `value`, or removes it when `value` is undefined. */
function withKey<T extends object, K extends keyof T>(obj: T, key: K, value: T[K] | undefined): T {
  if (value !== undefined) return { ...obj, [key]: value };
  const { [key]: _drop, ...rest } = obj;
  return rest as T;
}

function cleanEntry(e: DatasetEntry, ds: Dataset): DatasetEntry {
  const raw = new Set(ds.variables.map((v) => v.id));
  let out = e;
  if (e.transforms) {
    // Merges lose missing sources; a merge with none left is removed.
    const transforms = e.transforms.flatMap((t): TransformSpec[] => {
      if (!isMerge(t)) return [t];
      const from = t.from.filter((id) => raw.has(id));
      if (from.length === 0) return [];
      return [from.length === t.from.length ? t : { ...t, from }];
    });
    out = { ...out, transforms };
  }
  const valid = validIds(ds, out);
  if (out.transforms) {
    out.transforms = out.transforms.map((t) => (t.type === "scaleMap" && t.variables ? { ...t, variables: t.variables.filter((id) => valid.has(id)) } : t));
  }
  if (e.assignments) out = withKey(out, "assignments", pick(e.assignments, (id) => valid.has(id)));
  if (e.order) {
    const order = e.order.filter((id) => valid.has(id));
    out = withKey(out, "order", order.length > 0 ? order : undefined);
  }
  return out;
}

function cleanPanel(p: PanelSpec, valid: ReadonlySet<string>): PanelSpec {
  if (p.type !== "taxonCurves") return p;
  let out = p;
  if (p.variables) {
    const variables = { ...p.variables };
    // Selections keep an emptied list: removing it could change what the panel shows.
    if (variables.ids) variables.ids = variables.ids.filter((id) => valid.has(id));
    if (Array.isArray(variables.order)) variables.order = variables.order.filter((id) => valid.has(id));
    out = { ...out, variables };
  }
  if (p.overrides) out = withKey(out, "overrides", pick(p.overrides, (id) => valid.has(id)));
  return out;
}

/**
 * The spec without the references danglingReferences reports. Emptied `assignments`, `order`,
 * `overrides` and `curveStyles` are removed; selection lists (`variables.ids`, scaleMap
 * `variables`, header `spans.ids`) are kept even when empty. Returns `spec` itself if nothing dangles.
 */
export function cleanupSpec(spec: Spec, datasets: readonly Dataset[]): Spec {
  if (danglingReferences(spec, datasets).length === 0) return spec;
  let out: Spec = spec;
  if (spec.datasets) {
    out = {
      ...out,
      datasets: spec.datasets.map((e) => {
        const ds = datasets.find((d) => d.id === e.dataset);
        return ds ? cleanEntry(e, ds) : e;
      }),
    };
  }
  const ctx = context(out, datasets);
  out = {
    ...out,
    panels: out.panels.map((p) => {
      const valid = p.type === "taxonCurves" ? ctx.byDataset.get(p.dataset) : undefined;
      return valid ? cleanPanel(p, valid) : p;
    }),
  };
  if (spec.headers) {
    out.headers = spec.headers.map((h) => (h.spans.ids ? { ...h, spans: { ...h.spans, ids: h.spans.ids.filter((id) => ctx.any.has(id)) } } : h));
  }
  if (spec.curveStyles) out = withKey(out, "curveStyles", pick(spec.curveStyles, (id) => ctx.any.has(id)));
  return out;
}
