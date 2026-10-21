// Pure spec edits driven by the UI. The spec stays the single source of truth:
// every checkbox or import becomes a new Spec value that the history can undo.

import {
  groupOrder,
  prepareDatasets,
  resolveSpec,
  selectVariables,
  stripMarkup,
  type Dataset,
  type DatasetEntry,
  type MergeTransformParams,
  type Preset,
  type ResolvedSelection,
  type Spec,
  type SpecGroup,
  type Variable,
} from "@linden/core";

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
    .filter((v) => sel.kinds === undefined || sel.kinds.includes(v.kind))
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

// ---- Groups, order and merges (SPEC §4). Every function returns a new Spec; the UI only commits it.

/** Variables of one effective group, in display order. `id` undefined = ungrouped. */
export interface GroupNode {
  id: string | undefined;
  name: string;
  colour?: string;
  members: Variable[];
}

export interface VariableTree {
  /** Dataset as the diagram sees it (groups, assignments, merges and other transforms applied). */
  prepared: Dataset;
  groups: GroupNode[];
  /** Merged variable id → its sources (from the raw data). */
  merges: Map<string, Variable[]>;
}

function entryOf(spec: Spec, datasetId: string): DatasetEntry | undefined {
  return spec.datasets?.find((d) => d.dataset === datasetId);
}

/** Applies `fn` to the dataset's entry, creating `{ dataset }` if there is none. */
function updateEntry(spec: Spec, datasetId: string, fn: (e: DatasetEntry) => DatasetEntry): Spec {
  const datasets = spec.datasets ?? [];
  if (!datasets.some((d) => d.dataset === datasetId)) return { ...spec, datasets: [...datasets, fn({ dataset: datasetId })] };
  return { ...spec, datasets: datasets.map((d) => (d.dataset === datasetId ? fn(d) : d)) };
}

function mergesOf(spec: Spec, datasetId: string): MergeTransformParams[] {
  return (entryOf(spec, datasetId)?.transforms ?? []).filter((t): t is MergeTransformParams => t.type === "merge");
}

function prepare(spec: Spec, presets: readonly Preset[], raw: Dataset): Dataset {
  return prepareDatasets([raw], spec, presets).datasets[0]!;
}

/** Display order: group order, the dataset's order list, then the first curve panel's order. */
function displayOrder(spec: Spec, presets: readonly Preset[], prepared: Dataset): Variable[] {
  const rs = resolveSpec(spec, presets).spec;
  const panel = rs.panels.find((p) => p.type === "taxonCurves" && p.dataset === prepared.id);
  const order = panel?.type === "taxonCurves" ? panel.variables.order : "data";
  const explicit = rs.datasets.find((d) => d.dataset === prepared.id)?.order ?? [];
  return selectVariables(prepared, { minMax: 0, order }, () => undefined, explicit).map((j) => prepared.variables[j]!);
}

export function variableTree(spec: Spec, presets: readonly Preset[], raw: Dataset): VariableTree {
  const prepared = prepare(spec, presets, raw);
  const ordered = displayOrder(spec, presets, prepared);
  const groups: GroupNode[] = groupOrder(prepared).map((id) => {
    const g = prepared.groups.find((x) => x.id === id)!;
    const node: GroupNode = { id, name: g.name, members: ordered.filter((v) => v.group === id) };
    if (g.colour !== undefined) node.colour = g.colour;
    return node;
  });
  // Groups a variable refers to that the dataset does not declare, then ungrouped.
  for (const v of ordered) {
    if (!groups.some((g) => g.id === v.group)) {
      groups.push({ id: v.group, name: v.group ?? "Ungrouped", members: ordered.filter((x) => x.group === v.group) });
    }
  }
  const merges = new Map(
    mergesOf(spec, raw.id).map((m) => [m.id, m.from.flatMap((id) => raw.variables.filter((v) => v.id === id))]),
  );
  return { prepared, groups, merges };
}

/** Re-shows `ids` that were visible in `before` but are hidden in `after` (e.g. moved into a group the panel does not select). */
function keepVisible(after: Spec, presets: readonly Preset[], raw: Dataset, ids: readonly string[], visibleBefore: ReadonlySet<string>): Spec {
  let spec = after;
  for (const id of ids) {
    if (!visibleBefore.has(id)) continue;
    const prepared = prepare(spec, presets, raw);
    if (!prepared.variables.some((v) => v.id === id)) continue;
    if (!variableVisibility(spec, presets, prepared).get(id)?.visible) spec = setVariableVisible(spec, presets, prepared, id, true);
  }
  return spec;
}

function visibleIds(spec: Spec, presets: readonly Preset[], raw: Dataset): Set<string> {
  const prepared = prepare(spec, presets, raw);
  return new Set([...variableVisibility(spec, presets, prepared)].filter(([, v]) => v.visible).map(([id]) => id));
}

/**
 * Moves a variable to position `toIndex` of group `toGroup`. A group change becomes an assignment
 * (or the merge transform's `group` for merged variables); the new arrangement of the target group
 * is written to the dataset's `order` list, leaving other groups' entries alone.
 */
export function moveVariable(spec: Spec, presets: readonly Preset[], raw: Dataset, varId: string, toGroup: string, toIndex: number): Spec {
  const before = variableTree(spec, presets, raw);
  const v = before.prepared.variables.find((x) => x.id === varId);
  if (!v) return spec;
  const target = before.groups.find((g) => g.id === toGroup);
  if (!target) return spec;
  const members = target.members.map((m) => m.id).filter((id) => id !== varId);
  const arranged = [...members.slice(0, toIndex), varId, ...members.slice(toIndex)];

  const isMerge = before.merges.has(varId);
  const original = raw.variables.find((x) => x.id === varId)?.group;
  let next = updateEntry(spec, raw.id, (e) => {
    const out: DatasetEntry = { ...e };
    if (v.group !== toGroup) {
      if (isMerge) {
        out.transforms = (e.transforms ?? []).map((t) => (t.type === "merge" && t.id === varId ? { ...t, group: toGroup } : t));
      } else {
        const { [varId]: _old, ...rest } = e.assignments ?? {};
        out.assignments = original === toGroup ? rest : { ...rest, [varId]: toGroup };
        if (Object.keys(out.assignments).length === 0) delete out.assignments;
      }
    }
    const kept = (e.order ?? []).filter((id) => id !== varId && !members.includes(id));
    out.order = [...kept, ...arranged];
    return out;
  });
  next = keepVisible(next, presets, raw, [varId], visibleIds(spec, presets, raw));
  return sameJson(next, spec) ? spec : next;
}

function upsertGroup(spec: Spec, id: string, patch: Omit<SpecGroup, "id">): Spec {
  const groups = spec.groups ?? [];
  if (groups.some((g) => g.id === id)) return { ...spec, groups: groups.map((g) => (g.id === id ? { ...g, ...patch } : g)) };
  return { ...spec, groups: [...groups, { id, ...patch }] };
}

/** Writes order 1…n for the given group ids (all groups shown for a dataset). */
export function reorderGroups(spec: Spec, groupIds: readonly string[]): Spec {
  return groupIds.reduce((s, id, i) => upsertGroup(s, id, { order: i + 1 }), spec);
}

export function renameGroup(spec: Spec, id: string, name: string): Spec {
  return upsertGroup(spec, id, { name });
}

export function recolourGroup(spec: Spec, id: string, colour: string): Spec {
  return upsertGroup(spec, id, { colour });
}

/** New group after all `existing` ones; id derived from the name and unique. */
export function createGroup(spec: Spec, name: string, existing: readonly { id: string; order: number }[]): { spec: Spec; id: string } {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "group";
  const taken = new Set([...existing.map((g) => g.id), ...(spec.groups ?? []).map((g) => g.id)]);
  let id = base;
  for (let k = 2; taken.has(id); k++) id = `${base}-${k}`;
  const finite = existing.map((g) => g.order).filter(Number.isFinite);
  const order = (finite.length ? Math.max(...finite) : 0) + 1;
  return { spec: upsertGroup(spec, id, { name, order }), id };
}

/** Replaces each of `ids` in a list by `by` (at the first hit), keeping everything else. */
function replaceIds(list: readonly string[], ids: readonly string[], by: readonly string[]): string[] {
  const out: string[] = [];
  let placed = false;
  for (const id of list) {
    if (!ids.includes(id)) out.push(id);
    else if (!placed) {
      out.push(...by.filter((b) => !out.includes(b)));
      placed = true;
    }
  }
  return out;
}

/** Applies `fn` to `variables.ids` of every taxonCurves panel for the dataset that has explicit ids. */
function mapPanelIds(spec: Spec, datasetId: string, fn: (ids: string[]) => string[]): Spec {
  return {
    ...spec,
    panels: spec.panels.map((p) =>
      p.type === "taxonCurves" && p.dataset === datasetId && p.variables?.ids ? { ...p, variables: { ...p.variables, ids: fn(p.variables.ids) } } : p,
    ),
  };
}

/**
 * Merges `ids` into one variable named `name` (a merge transform placed before the first percent
 * transform). Already-merged variables are dissolved into their sources first, so a merge always
 * lists raw variables. Order list and explicit panel ids refer to the merged id afterwards.
 */
export function mergeVariables(spec: Spec, presets: readonly Preset[], raw: Dataset, ids: readonly string[], name: string): { spec: Spec; id?: string } {
  const tree = variableTree(spec, presets, raw);
  const ordered = tree.groups.flatMap((g) => g.members).filter((v) => ids.includes(v.id));
  if (ordered.length < 2 || name.trim() === "") return { spec };
  const dissolved = ordered.filter((v) => tree.merges.has(v.id)).map((v) => v.id);
  const sources = [...new Set(ordered.flatMap((v) => (tree.merges.has(v.id) ? mergesOf(spec, raw.id).find((m) => m.id === v.id)!.from : [v.id])))];

  const base = stripMarkup(name).trim();
  const taken = new Set([...tree.prepared.variables.map((v) => v.id), ...raw.variables.map((v) => v.id)].filter((id) => !ids.includes(id) && !sources.includes(id)));
  let id = base;
  for (let k = 2; taken.has(id); k++) id = `${base} ${k}`;

  const merge: MergeTransformParams = { type: "merge", id, name: name.trim(), from: sources };
  if (ordered[0]!.group !== undefined) merge.group = ordered[0]!.group;
  const visible = visibleIds(spec, presets, raw);
  // An entry without transforms uses the preset's; writing a merge must keep them.
  const inherited = resolveSpec(spec, presets).spec.datasets.find((d) => d.dataset === raw.id)?.transforms ?? [];

  let next = updateEntry(spec, raw.id, (e) => {
    const transforms = (e.transforms ?? inherited).filter((t) => !(t.type === "merge" && dissolved.includes(t.id)));
    const at = transforms.findIndex((t) => t.type === "percent");
    const out: DatasetEntry = { ...e, transforms: at === -1 ? [...transforms, merge] : [...transforms.slice(0, at), merge, ...transforms.slice(at)] };
    if (e.order) out.order = replaceIds(e.order, ordered.map((v) => v.id), [id]);
    return out;
  });
  next = mapPanelIds(next, raw.id, (list) => replaceIds(list, ordered.map((v) => v.id), [id]));
  if (ordered.some((v) => visible.has(v.id))) next = keepVisible(next, presets, raw, [id], new Set([id]));
  return { spec: next, id };
}

/** Removes a merge; its sources come back where the merged variable was (order list, panel ids). */
export function unmergeVariable(spec: Spec, presets: readonly Preset[], raw: Dataset, mergedId: string): Spec {
  const merge = mergesOf(spec, raw.id).find((m) => m.id === mergedId);
  if (!merge) return spec;
  const sources = merge.from.filter((id) => raw.variables.some((v) => v.id === id));
  const visible = visibleIds(spec, presets, raw);
  let next = updateEntry(spec, raw.id, (e) => {
    const out: DatasetEntry = { ...e, transforms: (e.transforms ?? []).filter((t) => t !== merge) };
    if (out.transforms!.length === 0) delete out.transforms;
    if (e.order) out.order = replaceIds(e.order, [mergedId], sources);
    return out;
  });
  next = mapPanelIds(next, raw.id, (list) => replaceIds(list, [mergedId], sources));
  if (visible.has(mergedId)) next = keepVisible(next, presets, raw, sources, new Set(sources));
  return next;
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
