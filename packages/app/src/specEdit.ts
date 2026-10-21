// Pure spec edits driven by the UI. The spec stays the single source of truth:
// every checkbox or import becomes a new Spec value that the history can undo.

import { resolveSpec, type Dataset, type Preset, type ResolvedSelection, type Spec } from "@linden/core";

export function prettySpec(spec: Spec): string {
  return `${JSON.stringify(spec, null, 2)}\n`;
}

/** Indices of taxonCurves panels drawing `datasetId`. */
function curvePanels(spec: Spec, datasetId: string): number[] {
  return spec.panels.flatMap((p, i) => (p.type === "taxonCurves" && p.dataset === datasetId ? [i] : []));
}

/** Variable ids a resolved selection includes, in dataset order. Ignores `minMax`, which depends on transformed values. */
function members(ds: Dataset, sel: ResolvedSelection): string[] {
  const ids = new Set(sel.ids ?? []);
  const groups = new Set(sel.groups ?? []);
  const all = ids.size === 0 && groups.size === 0;
  return ds.variables
    .filter((v) => all || ids.has(v.id) || (v.group !== undefined && groups.has(v.group)))
    .map((v) => v.id);
}

function resolvedMembers(spec: Spec, presets: readonly Preset[], ds: Dataset): Map<number, string[]> {
  const rs = resolveSpec(spec, presets).spec;
  const out = new Map<number, string[]>();
  for (const i of curvePanels(spec, ds.id)) {
    const p = rs.panels[i];
    if (p?.type === "taxonCurves") out.set(i, members(ds, p.variables));
  }
  return out;
}

export interface VariableVisibility {
  visible: boolean;
  /** False when hiding would leave a panel empty (an empty selection means "all"). */
  canHide: boolean;
}

export function variableVisibility(spec: Spec, presets: readonly Preset[], ds: Dataset): Map<string, VariableVisibility> {
  const panels = [...resolvedMembers(spec, presets, ds).values()];
  return new Map(
    ds.variables.map((v) => {
      const holding = panels.filter((m) => m.includes(v.id));
      return [v.id, { visible: holding.length > 0, canHide: holding.every((m) => m.length > 1) }];
    }),
  );
}

/**
 * Shows or hides one variable by editing `variables.ids` / `variables.groups` of the
 * taxonCurves panels for its dataset. Showing adds it to the first such panel (creating one if
 * there is none); hiding removes it from all. Keeps the edit minimal: a group selection is only
 * expanded into explicit ids when a variable reached via that group is hidden.
 */
export function setVariableVisible(spec: Spec, presets: readonly Preset[], ds: Dataset, varId: string, visible: boolean): Spec {
  const byPanel = resolvedMembers(spec, presets, ds);
  if (byPanel.size === 0) {
    return visible ? { ...spec, panels: [...spec.panels, { type: "taxonCurves", dataset: ds.id, variables: { ids: [varId] } }] } : spec;
  }
  const group = ds.variables.find((v) => v.id === varId)?.group;
  const rs = resolveSpec(spec, presets).spec;
  const first = Math.min(...byPanel.keys());

  const panels = spec.panels.map((p, i) => {
    const m = byPanel.get(i);
    const rp = rs.panels[i];
    if (!m || p.type !== "taxonCurves" || rp?.type !== "taxonCurves") return p;
    const sel = rp.variables;
    if (visible) {
      if (i !== first || m.includes(varId)) return p;
      return { ...p, variables: { ...p.variables, ids: [...(sel.ids ?? []), varId] } };
    }
    if (!m.includes(varId)) return p;
    const rest = m.filter((id) => id !== varId);
    if (rest.length === 0) return p;
    const viaGroup = group !== undefined && (sel.groups ?? []).includes(group);
    if (!viaGroup && (sel.ids ?? []).includes(varId)) {
      return { ...p, variables: { ...p.variables, ids: sel.ids!.filter((id) => id !== varId) } };
    }
    // `groups: []` (not omitted) so preset selectionDefaults cannot bring the group back.
    return { ...p, variables: { ...p.variables, ids: rest, groups: [] } };
  });
  return { ...spec, panels };
}

/** Makes a freshly imported dataset visible: adds a dataset entry, a taxonCurves panel and a y axis if missing. */
export function ensureDatasetInSpec(spec: Spec, datasetId: string): Spec {
  const datasets = spec.datasets ?? [];
  const hasEntry = datasets.some((d) => d.dataset === datasetId);
  const hasPanel = spec.panels.some((p) => p.type === "taxonCurves" && p.dataset === datasetId);
  if (hasEntry && hasPanel) return spec;
  const panels = [...spec.panels];
  if (!panels.some((p) => p.type === "yAxis")) panels.unshift({ type: "yAxis" });
  if (!hasPanel) panels.push({ type: "taxonCurves", dataset: datasetId });
  return { ...spec, datasets: hasEntry ? datasets : [...datasets, { dataset: datasetId }], panels };
}

/** Drops dataset entries and panels referring to `datasetId`. */
export function removeDatasetFromSpec(spec: Spec, datasetId: string): Spec {
  const out: Spec = { ...spec, panels: spec.panels.filter((p) => p.type !== "taxonCurves" || p.dataset !== datasetId) };
  if (spec.datasets) out.datasets = spec.datasets.filter((d) => d.dataset !== datasetId);
  return out;
}
