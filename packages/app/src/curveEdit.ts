// Curve inspector model (SPEC §4 "Curve style cascade", §11). Pure: which cascade level an edit
// writes to (variable → curveStyles, group → groupStyles, panel → style.curve), what that level
// inherits and from where, a merged view of several selected curves ("Mixed" where they differ), and
// leaf edits written to every target at once. The spec keeps only what was set: emptied levels go.

import {
  coreDefaults,
  CURVE_TYPES,
  resolveColumnCurve,
  resolveSpec,
  type CurveStyleOverride,
  type CurveStyleSource,
  type CurveType,
  type Dataset,
  type DiagramLayout,
  type MeasurementKind,
  type Preset,
  type ResolvedCurveStyle,
  type ResolvedTaxonCurvesPanel,
  type SavedCurveStyle,
  type Spec,
} from "@linden/core";
import { getIn, removeIn, setIn, type Path } from "./form/paths";

/** A selected curve: variable `id` of `dataset`, as drawn in spec panel `panel` (null = not known). */
export interface CurveRef {
  dataset: string;
  id: string;
  panel: number | null;
}

/** Selection of the curve inspector: curves (one or more), or one group. View state, not in the spec. */
export type CurveSelection = { kind: "curves"; curves: CurveRef[] } | { kind: "group"; dataset: string; group: string; panel: number | null };

/** Cascade level edits are written to. */
export type ApplyTo = "curve" | "group" | "panel";

/** Value of an option that differs across the selection. */
export const MIXED: unique symbol = Symbol("mixed");
export type Mixed = typeof MIXED;

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x);

// ── Selection ──────────────────────────────────────────────────────────────────

const sameCurve = (a: CurveRef, b: CurveRef) => a.dataset === b.dataset && a.id === b.id;

/** Click on a curve: selects only it; `additive` (Shift / Ctrl / Cmd) adds it to or removes it from the curves selected. */
export function toggleCurve(sel: CurveSelection | null, ref: CurveRef, additive: boolean): CurveSelection | null {
  if (!additive || sel?.kind !== "curves") return { kind: "curves", curves: [ref] };
  const rest = sel.curves.filter((c) => !sameCurve(c, ref));
  if (rest.length < sel.curves.length) return rest.length > 0 ? { kind: "curves", curves: rest } : null;
  return { kind: "curves", curves: [...sel.curves, ref] };
}

export function isCurveSelected(sel: CurveSelection | null, dataset: string, id: string): boolean {
  return sel?.kind === "curves" && sel.curves.some((c) => c.dataset === dataset && c.id === id);
}

/** Default level: the curve itself, or the group when a group is selected. */
export function defaultApplyTo(sel: CurveSelection): ApplyTo {
  return sel.kind === "group" ? "group" : "curve";
}

// ── Targets ────────────────────────────────────────────────────────────────────

/** The taxonCurves panel drawing a variable: the clicked one, else the first whose columns include it, else the first of its dataset. */
export function panelOf(spec: Spec, layout: DiagramLayout | undefined, dataset: string, id: string | undefined, hint: number | null): number | null {
  const ok = (i: number) => spec.panels[i]?.type === "taxonCurves" && (spec.panels[i] as { dataset: string }).dataset === dataset;
  if (hint !== null && ok(hint)) return hint;
  const indices = spec.panels.map((_, i) => i).filter(ok);
  const drawn = id === undefined ? undefined : indices.find((i) => layout?.panels[i]?.columns.some((c) => c.id === id));
  return drawn ?? indices[0] ?? null;
}

export interface CurveTarget {
  /** Spec path of the cascade level written to. */
  path: Path;
  level: "variable" | "group" | "panel";
  /** The style down to and including that level, and the level each option came from. */
  resolved: ResolvedCurveStyle;
  /** Spec panel index (for "from panel n"). */
  panel: number | null;
  /** Group name of the variable / group (for "from group …"). */
  groupName?: string;
}

/** Context the targets are resolved in: spec, presets, the datasets as the diagram sees them and the last layout. */
export interface CurveEnv {
  spec: Spec;
  presets: readonly Preset[];
  /** prepareDatasets output: current groups (assignments, merges) and kinds. */
  prepared: readonly Dataset[];
  layout: DiagramLayout | undefined;
}

function resolvedPanel(env: CurveEnv, panel: number | null, dataset: string): ResolvedTaxonCurvesPanel {
  const rs = resolveSpec(env.spec, env.presets).spec;
  const p = panel === null ? undefined : rs.panels[panel];
  if (p?.type === "taxonCurves") return p;
  // Not drawn in any panel: preset and spec levels only.
  const lone = resolveSpec({ ...env.spec, panels: [{ type: "taxonCurves", dataset }] }, env.presets).spec.panels[0];
  return lone as ResolvedTaxonCurvesPanel;
}

/** The cascade cut at a level: what that level inherits plus its own options. */
function resolveAt(panel: ResolvedTaxonCurvesPanel, level: CurveTarget["level"], id: string, group: string | undefined, kind: MeasurementKind | undefined): ResolvedCurveStyle {
  if (level === "variable") return resolveColumnCurve(panel, id, group, kind);
  const curve = { ...panel.curve, variables: {}, ...(level === "panel" ? { groups: {} } : {}) };
  return resolveColumnCurve({ ...panel, curve }, id, group);
}

const groupNameOf = (ds: Dataset | undefined, group: string | undefined) => (group === undefined ? undefined : (ds?.groups.find((g) => g.id === group)?.name ?? group));

/** Which levels the selection can write to ("its group" needs every curve to have one, "panel" a panel). */
export function availableApplyTo(env: CurveEnv, sel: CurveSelection): Record<ApplyTo, boolean> {
  if (sel.kind === "group") return { curve: false, group: true, panel: panelOf(env.spec, env.layout, sel.dataset, undefined, sel.panel) !== null };
  const variable = (c: CurveRef) => env.prepared.find((d) => d.id === c.dataset)?.variables.find((v) => v.id === c.id);
  return {
    curve: true,
    group: sel.curves.every((c) => variable(c)?.group !== undefined),
    panel: sel.curves.every((c) => panelOf(env.spec, env.layout, c.dataset, c.id, c.panel) !== null),
  };
}

/** Edit targets of a selection at a level, one per distinct spec path (several curves may share a group or panel). */
export function curveTargets(env: CurveEnv, sel: CurveSelection, applyTo: ApplyTo): CurveTarget[] {
  const out = new Map<string, CurveTarget>();
  const add = (t: CurveTarget) => {
    const key = JSON.stringify(t.path);
    if (!out.has(key)) out.set(key, t);
  };
  if (sel.kind === "group") {
    const ds = env.prepared.find((d) => d.id === sel.dataset);
    const member = ds?.variables.find((v) => v.group === sel.group)?.id;
    const panel = panelOf(env.spec, env.layout, sel.dataset, member, sel.panel);
    const level = applyTo === "panel" ? "panel" : "group";
    if (level === "panel" && panel === null) return [];
    const rp = resolvedPanel(env, panel, sel.dataset);
    const path: Path = level === "panel" ? ["panels", panel!, "style", "curve"] : ["groupStyles", sel.group];
    const t: CurveTarget = { path, level, resolved: resolveAt(rp, level, "", sel.group, undefined), panel };
    const name = groupNameOf(ds, sel.group);
    if (name !== undefined) t.groupName = name;
    add(t);
    return [...out.values()];
  }
  for (const c of sel.curves) {
    const ds = env.prepared.find((d) => d.id === c.dataset);
    const v = ds?.variables.find((x) => x.id === c.id);
    const panel = panelOf(env.spec, env.layout, c.dataset, c.id, c.panel);
    const level = applyTo === "curve" ? "variable" : applyTo;
    if ((level === "group" && v?.group === undefined) || (level === "panel" && panel === null)) continue;
    const path: Path = level === "variable" ? ["curveStyles", c.id] : level === "group" ? ["groupStyles", v!.group!] : ["panels", panel!, "style", "curve"];
    const t: CurveTarget = { path, level, resolved: resolveAt(resolvedPanel(env, panel, c.dataset), level, c.id, v?.group, v?.kind), panel };
    const name = groupNameOf(ds, v?.group);
    if (name !== undefined) t.groupName = name;
    add(t);
  }
  return [...out.values()];
}

// ── Merged view ────────────────────────────────────────────────────────────────

/** Leaves of a nested object by dotted path ("fill.pattern.type"); arrays, null and primitives are leaves. */
export function flatten(value: unknown, prefix = "", out = new Map<string, unknown>()): Map<string, unknown> {
  if (!isObj(value)) return out;
  for (const [k, v] of Object.entries(value)) {
    if (v === undefined) continue;
    const p = prefix + k;
    if (isObj(v)) flatten(v, `${p}.`, out);
    else out.set(p, v);
  }
  return out;
}

export function unflatten(leaves: ReadonlyMap<string, unknown>): Obj {
  let out: Obj = {};
  for (const [p, v] of leaves) out = setIn(out, p.split("."), v);
  return out;
}

const same = (a: unknown, b: unknown) => a === b || (typeof a !== "symbol" && typeof b !== "symbol" && JSON.stringify(a) === JSON.stringify(b));

/** Leaves equal in every map keep their value; leaves that differ (or are missing in some) become MIXED. */
function mergeLeaves(maps: readonly ReadonlyMap<string, unknown>[]): Map<string, unknown> {
  const keys = [...new Set(maps.flatMap((m) => [...m.keys()]))];
  const out = new Map<string, unknown>();
  for (const k of keys) {
    const first = maps[0]?.get(k);
    out.set(k, maps.every((m) => m.has(k) && same(m.get(k), first)) ? first : MIXED);
  }
  return out;
}

export interface CurveView {
  /** Options set at the target levels (dotted path → value, or MIXED if the targets differ). */
  own: Map<string, unknown>;
  /** Effective options at the target levels (MIXED where they differ). */
  effective: Map<string, unknown>;
  /** Where each inherited option comes from, as shown ("from group Bryophytes"); MIXED if the targets differ. */
  sources: Map<string, string | Mixed>;
  type: CurveType | Mixed;
  /** Option keys (top level) the type(s) have; with mixed types only those all of them have. */
  keys: Set<string>;
}

/** "from group Bryophytes", "from preset", "default". */
export function sourceLabel(source: CurveStyleSource, t: CurveTarget, preset: string | undefined): string {
  switch (source) {
    case "default":
      return "default";
    case "preset":
      return preset ? `from preset ${preset}` : "from preset";
    case "panel":
      return t.panel === null ? "from panel" : `from panel ${t.panel + 1}`;
    case "group":
      return `from group ${t.groupName ?? ""}`.trim();
    case "variable":
      return "from this curve";
    case "kind":
      // Defaults of the variable's kind (continuous), or presence marks for kind presence.
      return "from the data's kind";
  }
}

export function curveView(targets: readonly CurveTarget[], spec: Spec): CurveView {
  const own = mergeLeaves(targets.map((t) => flatten(getIn(spec, t.path))));
  const effective = mergeLeaves(targets.map((t) => flatten(t.resolved.style)));
  const sources = mergeLeaves(targets.map((t) => new Map(Object.entries(t.resolved.source).map(([k, s]) => [k, sourceLabel(s, t, spec.preset)])))) as Map<string, string | Mixed>;
  const types = [...new Set(targets.map((t) => t.resolved.style.type))];
  const keyLists = types.map((ty) => Object.keys(coreDefaults.curve[ty]).filter((k) => k !== "type"));
  const keys = new Set(keyLists[0]?.filter((k) => keyLists.every((l) => l.includes(k))) ?? []);
  return { own, effective, sources, type: types.length === 1 ? types[0]! : MIXED, keys };
}

/** Number of options set at the target levels among `fields` (top-level keys). */
export function overriddenCount(view: CurveView, fields: readonly string[]): number {
  return [...view.own.keys()].filter((p) => fields.includes(p.split(".")[0]!)).length;
}

export function isCurveType(x: string): x is CurveType {
  return (CURVE_TYPES as readonly string[]).includes(x);
}

// ── Edits ──────────────────────────────────────────────────────────────────────

export interface LeafChange {
  path: string[];
  /** undefined = remove. */
  value: unknown;
}

/** Leaf differences from `before` to `after` (nested objects; MIXED leaves left alone count as unchanged). */
export function leafChanges(before: unknown, after: unknown): LeafChange[] {
  const a = flatten(before);
  const b = flatten(after);
  const keys = [...new Set([...a.keys(), ...b.keys()])];
  return keys.filter((k) => !same(a.get(k), b.get(k))).map((k) => ({ path: k.split("."), value: b.get(k) }));
}

/** Removes empty objects inside the value at `path`, then the value itself and its empty named parents (never array items). */
function prune(spec: Spec, path: Path): Spec {
  const clean = (v: unknown): unknown => {
    if (!isObj(v)) return v;
    const entries = Object.entries(v)
      .map(([k, x]) => [k, clean(x)] as const)
      .filter(([, x]) => x !== undefined);
    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
  };
  const at = getIn(spec, path);
  let out = at === undefined ? spec : setIn(spec, path, clean(at));
  for (let p = path.slice(0, -1); p.length > 0 && typeof p[p.length - 1] === "string"; p = p.slice(0, -1)) {
    const v = getIn(out, p);
    if (!isObj(v) || Object.keys(v).length > 0) break;
    out = removeIn(out, p);
  }
  return out;
}

/** Writes the changes into every target level (only the changed options), dropping what becomes empty. */
export function applyCurveChanges(spec: Spec, targets: readonly Path[], changes: readonly LeafChange[]): Spec {
  let out = spec;
  for (const t of targets) {
    for (const c of changes) out = c.value === undefined ? removeIn(out, [...t, ...c.path]) : setIn(out, [...t, ...c.path], c.value);
    out = prune(out, t);
  }
  return out;
}

/**
 * One edit of the merged level (the Curve tab's controls): `edit` gets the level as shown, MIXED leaves
 * as symbols, and returns it changed; the leaf difference is written to every target. undefined = no change.
 */
export function editTargets(spec: Spec, targets: readonly CurveTarget[], view: CurveView, edit: (level: Obj) => unknown): Spec | undefined {
  const before = unflatten(view.own);
  const changes = leafChanges(before, edit(before));
  return changes.length === 0 ? undefined : applyCurveChanges(spec, targets.map((t) => t.path), changes);
}

/** "Reset to inherited": removes the target levels entirely. */
export function resetCurveTargets(spec: Spec, targets: readonly Path[]): Spec {
  return targets.reduce((s, t) => prune(removeIn(s, t), t), spec);
}

// ── Quick actions (context menu, shortcuts, saved styles) ──────────────────────────

/** Levels a copied style takes options from: what the user set, not core or preset defaults. */
const COPIED: ReadonlySet<CurveStyleSource> = new Set(["panel", "group", "variable"]);

/**
 * Style of the first selected curve (or the group) as the user set it: its type and every option set at
 * its panel, group or curve level. Used by Copy style and Save style as.
 */
export function copyCurveStyle(env: CurveEnv, sel: CurveSelection): CurveStyleOverride | undefined {
  const one: CurveSelection = sel.kind === "curves" ? { kind: "curves", curves: sel.curves.slice(0, 1) } : sel;
  const t = curveTargets(env, one, defaultApplyTo(sel))[0];
  if (!t) return undefined;
  const { style, source } = t.resolved;
  // A type that comes from the data's kind (presence, continuous defaults) is not the curve's style.
  const keep = (k: string) => (k === "type" ? source.type !== "kind" : COPIED.has(source[k] ?? "default"));
  return unflatten(new Map([...flatten(style)].filter(([k]) => keep(k)))) as CurveStyleOverride;
}

/** Targets of a selection at a level, resolved as if `spec` (the levels cleared) were current; by path. */
function targetsIn(env: CurveEnv, spec: Spec, sel: CurveSelection, applyTo: ApplyTo): Map<string, CurveTarget> {
  return new Map(curveTargets({ ...env, spec }, sel, applyTo).map((t) => [JSON.stringify(t.path), t]));
}

/** Levels below a group / panel target, cleared when a style is applied to it so all its curves match. */
function levelsBelow(env: CurveEnv, t: CurveTarget): Path[] {
  if (t.level === "group") {
    const group = t.path[1];
    return env.prepared.flatMap((d) => d.variables.filter((v) => v.group === group).map((v): Path => ["curveStyles", v.id]));
  }
  if (t.level !== "panel" || t.panel === null) return [];
  const p = env.spec.panels[t.panel];
  const ds = env.prepared.find((d) => p?.type === "taxonCurves" && d.id === p.dataset);
  const drawn = env.layout?.panels[t.panel]?.columns.map((c) => c.id);
  const vars = (ds?.variables ?? []).filter((v) => drawn === undefined || drawn.includes(v.id));
  const groups = [...new Set(vars.flatMap((v) => (v.group === undefined ? [] : [v.group])))];
  return [...vars.map((v): Path => ["curveStyles", v.id]), ...groups.map((g): Path => ["groupStyles", g])];
}

/**
 * Applies a style (pasted, saved) at a level: each target level becomes the style, minus the options it
 * would inherit anyway (the spec stays minimal). At group / panel level, the levels below (the members'
 * curve styles; for a panel also its groups' styles) are removed, so every curve there looks the same.
 */
export function applyCurveStyle(env: CurveEnv, sel: CurveSelection, style: CurveStyleOverride, applyTo: ApplyTo): Spec {
  const targets = curveTargets(env, sel, applyTo);
  const cleared = resetCurveTargets(env.spec, [...targets.map((t) => t.path), ...targets.flatMap((t) => levelsBelow(env, t))]);
  const bare = targetsIn(env, cleared, sel, applyTo);
  // Options are compared with what the level inherits under the style's type (defaults differ per type).
  const typed = style.type === undefined ? bare : targetsIn(env, targets.reduce((s, t) => setIn(s, [...t.path, "type"], style.type), cleared), sel, applyTo);
  const leaves = flatten(style);
  return targets.reduce((spec, t) => {
    const key = JSON.stringify(t.path);
    const inherited = flatten(typed.get(key)?.resolved.style);
    const differs = ([k, v]: [string, unknown]) => (k === "type" ? bare.get(key)?.resolved.style.type !== v : !same(inherited.get(k), v));
    const changes = [...leaves].filter(differs).map(([k, v]) => ({ path: k.split("."), value: v }));
    return applyCurveChanges(spec, [t.path], changes);
  }, cleared);
}

/** Sets one option (dotted path) at every target level; where the level would inherit that value anyway, removes it instead. */
export function setCurveOption(env: CurveEnv, sel: CurveSelection, applyTo: ApplyTo, option: string, value: unknown): Spec {
  const path = option.split(".");
  const targets = curveTargets(env, sel, applyTo);
  const without = targets.reduce((s, t) => removeIn(s, [...t.path, ...path]), env.spec);
  const bare = targetsIn(env, without, sel, applyTo);
  return targets.reduce((spec, t) => {
    const inherited = flatten(bare.get(JSON.stringify(t.path))?.resolved.style).get(option);
    return applyCurveChanges(spec, [t.path], [{ path, value: same(inherited, value) ? undefined : value }]);
  }, env.spec);
}

/** Saves a named style: replaces the one of that name (in place) or adds it at the end. */
export function saveLibraryStyle(spec: Spec, name: string, style: CurveStyleOverride): Spec {
  const list = spec.styleLibrary ?? [];
  const entry: SavedCurveStyle = { name, style };
  const i = list.findIndex((s) => s.name === name);
  return { ...spec, styleLibrary: i === -1 ? [...list, entry] : list.map((s, j) => (j === i ? entry : s)) };
}

export function removeLibraryStyle(spec: Spec, name: string): Spec {
  const { styleLibrary, ...rest } = spec;
  const list = (styleLibrary ?? []).filter((s) => s.name !== name);
  return list.length > 0 ? { ...rest, styleLibrary: list } : rest;
}

/** Imported styles join the library; a style with the name of a saved one replaces it. */
export function importLibraryStyles(spec: Spec, styles: readonly SavedCurveStyle[]): Spec {
  return styles.reduce((s, x) => saveLibraryStyle(s, x.name, x.style), spec);
}
