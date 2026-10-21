// Preset resolution — SPEC.md §4: core defaults → preset → spec → per-variable override.
// Presets are plain (already parsed) objects passed in; core never reads files.

import {
  coreDefaults,
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
import type { OutsideSum, SumDefinition } from "./types.js";

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
  overrides: Record<string, Omit<TaxonCurvesStyle, "groupGap" | "xTitle">>;
  width?: number;
}

export type ResolvedPanel = YAxisPanelSpec | ResolvedTaxonCurvesPanel;

export interface ResolvedSpec {
  specVersion: number;
  preset?: string;
  page: ResolvedPage;
  style: ResolvedFigureStyle;
  /** Absent = no title band. */
  title?: ResolvedTitle;
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
    yAxis: mergeLayers(coreDefaults.yAxis, preset?.yAxis, spec.yAxis),
    datasets: (spec.datasets ?? []).map((d) => resolveDatasetEntry(d, preset)),
    panels: spec.panels.map((p) => resolvePanel(p, preset)),
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
