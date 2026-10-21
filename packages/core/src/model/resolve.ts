// Preset resolution — SPEC.md §4: core defaults → preset → spec → per-variable override.
// Presets are plain (already parsed) objects passed in; core never reads files.

import { coreDefaults, type ResolvedHeaderBand, type ResolvedPage, type ResolvedSelection, type ResolvedTaxonCurvesStyle, type ResolvedYAxis } from "./defaults.js";
import type {
  DatasetEntry,
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
import type { OutsideSum, SumDefinition } from "./types.js";

export interface ResolvedDatasetEntry {
  dataset: string;
  transforms: TransformSpec[];
  sums: Record<string, SumDefinition>;
  outsideSum?: OutsideSum;
  assignments: Record<string, string>;
  order: string[];
}

export interface ResolvedTaxonCurvesPanel {
  type: "taxonCurves";
  dataset: string;
  variables: ResolvedSelection;
  style: ResolvedTaxonCurvesStyle;
  overrides: Record<string, Omit<TaxonCurvesStyle, "groupGap">>;
  width?: number;
}

export type ResolvedPanel = YAxisPanelSpec | ResolvedTaxonCurvesPanel;

export interface ResolvedSpec {
  specVersion: number;
  preset?: string;
  page: ResolvedPage;
  yAxis: ResolvedYAxis;
  /** Group metadata from the preset, overlaid field by field with spec groups (spec-only groups appended). */
  groups: SpecGroup[];
  datasets: ResolvedDatasetEntry[];
  panels: ResolvedPanel[];
  overlays: OverlaySpec[];
  headerBand: ResolvedHeaderBand;
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

/** Preset groups overlaid by spec groups with the same id; spec-only groups follow in spec order. */
function resolveGroups(preset: readonly SpecGroup[], spec: readonly SpecGroup[]): SpecGroup[] {
  const out = preset.map((g) => mergeLayers<SpecGroup>({ ...g }, spec.find((s) => s.id === g.id)));
  for (const g of spec) if (!out.some((o) => o.id === g.id)) out.push({ ...g });
  return out;
}

function resolveDatasetEntry(entry: DatasetEntry, preset: Preset | undefined): ResolvedDatasetEntry {
  // Sum definitions replace whole (merging includeGroups with includeAll would change meaning).
  const resolved: ResolvedDatasetEntry = {
    dataset: entry.dataset,
    transforms: entry.transforms ?? [],
    sums: { ...preset?.sums, ...entry.sums },
    assignments: entry.assignments ?? {},
    order: entry.order ?? [],
  };
  const outsideSum = entry.outsideSum ?? preset?.outsideSum;
  if (outsideSum) resolved.outsideSum = outsideSum;
  return resolved;
}

function resolvePanel(panel: PanelSpec, preset: Preset | undefined): ResolvedPanel {
  if (panel.type === "yAxis") return panel;
  const resolved: ResolvedTaxonCurvesPanel = {
    type: "taxonCurves",
    dataset: panel.dataset,
    variables: mergeLayers(coreDefaults.selection, preset?.selectionDefaults, panel.variables),
    style: mergeLayers(coreDefaults.taxonCurves, preset?.panelDefaults?.taxonCurves, panel.style),
    overrides: panel.overrides ?? {},
  };
  if (panel.width !== undefined) resolved.width = panel.width;
  return resolved;
}

/** Fills every default. `presets` are looked up by `spec.preset` name. Never throws; problems become warnings. */
export function resolveSpec(spec: Spec, presets: readonly Preset[] = []): { spec: ResolvedSpec; warnings: string[] } {
  const warnings: string[] = [];
  let preset: Preset | undefined;
  if (spec.preset !== undefined) {
    preset = presets.find((p) => p.name === spec.preset);
    if (!preset) warnings.push(`Preset "${spec.preset}" not found; using core defaults.`);
  }

  const resolved: ResolvedSpec = {
    specVersion: spec.specVersion,
    page: mergeLayers(coreDefaults.page, preset?.page, spec.page),
    yAxis: mergeLayers(coreDefaults.yAxis, preset?.yAxis, spec.yAxis),
    groups: resolveGroups(preset?.groups ?? [], spec.groups ?? []),
    datasets: (spec.datasets ?? []).map((d) => resolveDatasetEntry(d, preset)),
    panels: spec.panels.map((p) => resolvePanel(p, preset)),
    overlays: spec.overlays ?? [],
    headerBand: mergeLayers(coreDefaults.headerBand, preset?.headerBand, spec.headerBand),
    headers: spec.headers ?? [],
  };
  if (spec.preset !== undefined) resolved.preset = spec.preset;
  return { spec: resolved, warnings };
}

/** Last layer: per-variable override on top of the resolved panel style. */
export function resolveVariableStyle(panel: ResolvedTaxonCurvesPanel, variableId: string): ResolvedTaxonCurvesStyle {
  return mergeLayers(panel.style, panel.overrides[variableId]);
}
