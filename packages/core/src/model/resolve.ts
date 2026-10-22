// Preset resolution — SPEC.md §4: core defaults → preset → spec → per-variable override.
// Presets are plain (already parsed) objects passed in; core never reads files.

import {
  coreDefaults,
  DEFAULT_CURVE_TYPE,
  TICK_SIZE_RATIO,
  TITLE_SIZE_EXTRA,
  type ResolvedFigureStyle,
  type ResolvedGroupHeaders,
  type ResolvedHeaderBand,
  type ResolvedPage,
  type ResolvedSelection,
  type ResolvedTaxonCurvesStyle,
  type ResolvedTitle,
  type ResolvedYAxis,
} from "./defaults.js";
import type {
  CurveStyle,
  CurveStyleOverride,
  CurveType,
  DatasetEntry,
  FigureStyle,
  HeaderSpec,
  OverlaySpec,
  PanelSpec,
  Preset,
  Spec,
  SpecGroup,
  TaxonCurvesStyle,
  TransformSpec,
  YAxisPanelSpec,
} from "./spec.js";
import type { MeasurementKind, OutsideSum, SumDefinition } from "./types.js";

export interface ResolvedDatasetEntry {
  dataset: string;
  transforms: TransformSpec[];
  sums: Record<string, SumDefinition>;
  scales: Record<string, Record<string, number | null>>;
  outsideSum?: OutsideSum;
  groups: SpecGroup[];
  assignments: Record<string, string>;
  order: string[];
}

export interface ResolvedTaxonCurvesPanel {
  type: "taxonCurves";
  dataset: string;
  variables: ResolvedSelection;
  style: ResolvedTaxonCurvesStyle;
  overrides: Record<string, Omit<TaxonCurvesStyle, "curve" | "groupGap" | "xTitle">>;
  /** Curve style cascade levels below the core defaults, as written (resolveColumnCurve merges them). */
  curve: CurveStyleLevels;
  width?: number;
}

/** The spec's curve style levels for one panel: only what preset and user wrote, never defaults. */
export interface CurveStyleLevels {
  preset?: CurveStyleOverride;
  panel?: CurveStyleOverride;
  /** spec.groupStyles: group id → style. */
  groups: Record<string, CurveStyleOverride>;
  /** spec.curveStyles: variable id → style. */
  variables: Record<string, CurveStyleOverride>;
}

export type ResolvedPanel = YAxisPanelSpec | ResolvedTaxonCurvesPanel;

export interface ResolvedSpec {
  specVersion: number;
  preset?: string;
  page: ResolvedPage;
  style: ResolvedFigureStyle;
  /** Absent = no title band. */
  title?: ResolvedTitle;
  /** Global x factor, mm per % before page fitting. */
  xScale: number;
  yAxis: ResolvedYAxis;
  datasets: ResolvedDatasetEntry[];
  panels: ResolvedPanel[];
  overlays: OverlaySpec[];
  headerBand: ResolvedHeaderBand;
  groupHeaders: ResolvedGroupHeaders;
  headers: HeaderSpec[];
}

type PlainObject = Record<string, unknown>;

function isPlainObject(x: unknown): x is PlainObject {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/**
 * Layered merge: later layers win. Plain objects merge recursively; arrays, primitives and
 * null replace. `undefined` never overrides. Key order is first-seen, so output is deterministic.
 */
export function mergeLayers<T>(base: T, ...layers: unknown[]): T {
  let out: unknown = base;
  for (const layer of layers) {
    if (layer === undefined) continue;
    if (isPlainObject(out) && isPlainObject(layer)) {
      const merged: PlainObject = { ...out };
      for (const key of Object.keys(layer)) {
        const value = layer[key];
        if (value === undefined) continue;
        merged[key] = key in out ? mergeLayers(out[key], value) : value;
      }
      out = merged;
    } else {
      out = layer;
    }
  }
  return out as T;
}

function resolveDatasetEntry(entry: DatasetEntry, preset: Preset | undefined): ResolvedDatasetEntry {
  // Sums, outsideSum and groups are the dataset's own (presets define none).
  const resolved: ResolvedDatasetEntry = {
    dataset: entry.dataset,
    // Arrays replace: the entry's own transforms, else the preset's defaults.
    transforms: entry.transforms ?? preset?.transforms ?? [],
    sums: { ...entry.sums },
    scales: { ...preset?.scales, ...entry.scales },
    groups: entry.groups ?? [],
    assignments: entry.assignments ?? {},
    order: entry.order ?? [],
  };
  if (entry.outsideSum) resolved.outsideSum = entry.outsideSum;
  return resolved;
}

function resolvePanel(panel: PanelSpec, preset: Preset | undefined, spec: Spec): ResolvedPanel {
  if (panel.type === "yAxis") return panel;
  const { curve: presetCurve, ...presetStyle } = preset?.panelDefaults?.taxonCurves ?? {};
  const { curve: panelCurve, ...panelStyle } = panel.style ?? {};
  const curve: CurveStyleLevels = { groups: spec.groupStyles ?? {}, variables: spec.curveStyles ?? {} };
  if (presetCurve) curve.preset = presetCurve;
  if (panelCurve) curve.panel = panelCurve;
  const resolved: ResolvedTaxonCurvesPanel = {
    type: "taxonCurves",
    dataset: panel.dataset,
    variables: mergeLayers(coreDefaults.selection, preset?.selectionDefaults, panel.variables),
    style: mergeLayers(coreDefaults.taxonCurves, presetStyle, panelStyle),
    overrides: panel.overrides ?? {},
    curve,
  };
  if (panel.width !== undefined) resolved.width = panel.width;
  return resolved;
}

/** Figure style: fonts default from the page font (labels = page.font, ticks 0.85 ×, title +3 pt). */
export function resolveStyle(page: ResolvedPage, style: FigureStyle | undefined): ResolvedFigureStyle {
  const { fonts, ...rest } = style ?? {};
  const labels = { family: fonts?.labels?.family ?? page.font.family, size: fonts?.labels?.size ?? page.font.size };
  return {
    ...mergeLayers(coreDefaults.style, rest),
    fonts: {
      title: { family: fonts?.title?.family ?? labels.family, size: fonts?.title?.size ?? labels.size + TITLE_SIZE_EXTRA },
      labels,
      ticks: { family: fonts?.ticks?.family ?? labels.family, size: fonts?.ticks?.size ?? labels.size * TICK_SIZE_RATIO },
    },
  };
}

/** Fills every default. `presets` are looked up by `spec.preset` name. Never throws; problems become warnings. */
export function resolveSpec(spec: Spec, presets: readonly Preset[] = []): { spec: ResolvedSpec; warnings: string[] } {
  const warnings: string[] = [];
  let preset: Preset | undefined;
  if (spec.preset !== undefined) {
    preset = presets.find((p) => p.name === spec.preset);
    if (!preset) warnings.push(`Preset "${spec.preset}" not found; using core defaults.`);
  }

  const page = mergeLayers(coreDefaults.page, preset?.page, spec.page);
  const style = resolveStyle(page, spec.style);
  const resolved: ResolvedSpec = {
    specVersion: spec.specVersion,
    page,
    style,
    xScale: spec.xScale ?? coreDefaults.xScale,
    yAxis: mergeLayers(coreDefaults.yAxis, preset?.yAxis, spec.yAxis),
    datasets: (spec.datasets ?? []).map((d) => resolveDatasetEntry(d, preset)),
    panels: spec.panels.map((p) => resolvePanel(p, preset, spec)),
    overlays: spec.overlays ?? [],
    headerBand: mergeLayers(coreDefaults.headerBand, preset?.headerBand, spec.headerBand),
    groupHeaders: mergeLayers(coreDefaults.groupHeaders, spec.groupHeaders),
    headers: spec.headers ?? [],
  };
  if (spec.preset !== undefined) resolved.preset = spec.preset;
  if (spec.title?.text || spec.title?.subtitle) {
    resolved.title = mergeLayers({ ...coreDefaults.title, size: style.fonts.title.size }, spec.title);
  }
  return { spec: resolved, warnings };
}

/** Last layer: per-variable override on top of the resolved panel style. */
export function resolveVariableStyle(panel: ResolvedTaxonCurvesPanel, variableId: string): ResolvedTaxonCurvesStyle {
  return mergeLayers(panel.style, panel.overrides[variableId]);
}

/**
 * Cascade level an option came from. "kind": a variable of kind presence (no x-scale) is drawn with
 * presence marks whatever its type, unless the type is "none".
 */
export type CurveStyleSource = "default" | "preset" | "panel" | "group" | "variable" | "kind";

export interface ResolvedCurveStyle {
  style: CurveStyle;
  /** Option path ("type", "fill.colour", "exaggeration.factor", …) → level it came from. */
  source: Record<string, CurveStyleSource>;
}

/** Keeps the keys of `value` that `like` has, recursively into plain objects; arrays and primitives are leaves. */
function pickLike(value: PlainObject, like: PlainObject): PlainObject {
  const out: PlainObject = {};
  for (const key of Object.keys(value)) {
    if (!(key in like)) continue;
    const v = value[key];
    const l = like[key];
    out[key] = isPlainObject(v) && isPlainObject(l) ? pickLike(v, l) : v;
  }
  return out;
}

/** Paths of the leaves (primitives, arrays, null) of a plain object, e.g. "fill.pattern.type". */
function leafPaths(value: PlainObject, prefix = ""): string[] {
  return Object.keys(value).flatMap((key) => {
    const v = value[key];
    if (v === undefined) return [];
    const path = prefix + key;
    return isPlainObject(v) ? leafPaths(v, `${path}.`) : [path];
  });
}

/**
 * Curve style cascade (SPEC §4): core defaults of the final type → preset → panel → group → variable.
 * Each level deep-merges into the options collected so far. A level that changes the type first drops
 * the collected options the new type does not have (shared options always survive). Options the final
 * type does not have are ignored.
 */
export function cascadeCurveStyle(levels: readonly (readonly [CurveStyleSource, CurveStyleOverride | undefined])[]): ResolvedCurveStyle {
  let type: CurveType = DEFAULT_CURVE_TYPE;
  let typeSource: CurveStyleSource = "default";
  let collected: PlainObject = {};
  const from: Record<string, CurveStyleSource> = {};
  for (const [name, level] of levels) {
    if (!level) continue;
    const { type: t, ...options } = level;
    if (t !== undefined) {
      if (t !== type) collected = pickLike(collected, coreDefaults.curve[t]);
      type = t;
      typeSource = name;
    }
    collected = mergeLayers(collected, options);
    for (const path of leafPaths(options)) from[path] = name;
  }
  const own = pickLike(collected, coreDefaults.curve[type]);
  const style = mergeLayers<CurveStyle>(coreDefaults.curve[type], own);
  const set = new Set(leafPaths(own));
  const source: Record<string, CurveStyleSource> = { type: typeSource };
  for (const path of leafPaths(style)) if (path !== "type") source[path] = set.has(path) ? from[path]! : "default";
  return { style, source };
}

/** Curve style of one column: `group` = the variable's group, `kind` its measurement kind. */
export function resolveColumnCurve(panel: ResolvedTaxonCurvesPanel, variableId: string, group?: string, kind?: MeasurementKind): ResolvedCurveStyle {
  const { preset, panel: own, groups, variables } = panel.curve;
  const levels: [CurveStyleSource, CurveStyleOverride | undefined][] = [
    ["preset", preset],
    ["panel", own],
    ["group", group === undefined ? undefined : groups[group]],
    ["variable", variables[variableId]],
  ];
  const resolved = cascadeCurveStyle(levels);
  if (kind === "presence" && resolved.style.type !== "presence" && resolved.style.type !== "none") {
    return cascadeCurveStyle([...levels, ["kind", { type: "presence" }]]);
  }
  return resolved;
}

/**
 * The resolved curve style of a variable and the level each option came from (for the app's
 * inspector). `panel` = spec panel index (default: the first taxonCurves panel); `group` = the
 * variable's group (default: its assignment in that panel's dataset entry); `kind` = its kind.
 */
export function resolveCurveStyle(
  spec: Spec,
  variableId: string,
  options: { panel?: number; group?: string; kind?: MeasurementKind; presets?: readonly Preset[] } = {},
): ResolvedCurveStyle {
  const index = options.panel ?? spec.panels.findIndex((p) => p.type === "taxonCurves");
  const panelSpec = spec.panels[index];
  const panelOrEmpty: PanelSpec = panelSpec?.type === "taxonCurves" ? panelSpec : { type: "taxonCurves", dataset: "" };
  const preset = options.presets?.find((p) => p.name === spec.preset);
  const panel = resolvePanel(panelOrEmpty, preset, spec) as ResolvedTaxonCurvesPanel;
  const group = options.group ?? spec.datasets?.find((d) => d.dataset === panel.dataset)?.assignments?.[variableId];
  return resolveColumnCurve(panel, variableId, group, options.kind);
}
