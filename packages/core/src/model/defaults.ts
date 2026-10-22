// Core defaults — the first layer of resolution (core → preset → spec → per-variable override).

import type { CurveStyle, CurveStyleOverride, CurveType, Selection, TaxonCurvesStyle, TitleSpec, YAxisSpec } from "./spec.js";
import type { MeasurementKind } from "./types.js";

export interface ResolvedPage {
  width: number;
  height: number;
  units: "mm";
  font: { family: string; size: number };
}

/** `ticks` stays optional: absent = chosen automatically by layout. */
export type ResolvedYAxis = Required<Pick<YAxisSpec, "primary" | "reverse">> & {
  secondary?: YAxisSpec["secondary"];
  range: [number, number] | null;
  ticks?: YAxisSpec["ticks"];
  titles: { depth?: string; age?: string };
};

export type ResolvedSelection = Required<Pick<Selection, "minMax" | "order">> & Pick<Selection, "ids" | "groups" | "kinds">;

/** Column layout of a taxonCurves panel; the curve style resolves separately (resolveCurveStyle). */
export type ResolvedTaxonCurvesStyle = Required<Omit<TaxonCurvesStyle, "curve" | "xTicks" | "xTitle">> & {
  xTicks: { step: number | null; minSpacing: number; unitSuffix: boolean };
  /** `text` absent = default from the variables' kind and unit. */
  xTitle: { text?: string; show: "panel" | "column" | "none" };
};

export interface ResolvedFont {
  family: string;
  /** pt */
  size: number;
}

/** Figure style (spec.style) with every default filled in; fonts default from page.font. */
export interface ResolvedFigureStyle {
  background: string | null;
  fonts: { title: ResolvedFont; labels: ResolvedFont; ticks: ResolvedFont };
  lineWidths: { axis: number; curve: number };
  tickLength: number;
  colours: { axis: string; text: string };
}

export type ResolvedTitle = Required<Pick<TitleSpec, "align" | "size">> & Pick<TitleSpec, "text" | "subtitle">;

export interface ResolvedHeaderBand {
  angle: number;
  /** pt */
  minFontSize: number;
  /** mm; null = fit the labels. */
  height: number | null;
}

export interface ResolvedGroupHeaders {
  show: boolean;
  line: "line" | "bracket" | "none";
}

/** Font sizes relative to the labels font (page.font unless style.fonts.labels says otherwise). */
export const TITLE_SIZE_EXTRA = 3;
export const TICK_SIZE_RATIO = 0.85;

export interface CoreDefaults {
  page: ResolvedPage;
  /** Fonts are derived from the page font, see resolveStyle. */
  style: Omit<ResolvedFigureStyle, "fonts">;
  title: Pick<ResolvedTitle, "align">;
  /** Global x factor, mm per % before page fitting. */
  xScale: number;
  yAxis: ResolvedYAxis;
  headerBand: ResolvedHeaderBand;
  groupHeaders: ResolvedGroupHeaders;
  selection: ResolvedSelection;
  taxonCurves: ResolvedTaxonCurvesStyle;
  /** Full curve style of each type: the first cascade level (SPEC §4 "Curve styles"). */
  curve: { [T in CurveType]: Extract<CurveStyle, { type: T }> };
  /** Curve style level of a measurement kind, between the preset and the panel (cascade level "kind"). */
  kindCurves: Partial<Record<MeasurementKind, CurveStyleOverride>>;
}

/** Type of a curve whose cascade sets none. */
export const DEFAULT_CURVE_TYPE: CurveType = "polygon";

const solid = { type: "solid", angle: 45, spacing: 1 } as const;
const fill = { colour: "group", opacity: 1, pattern: solid } as const;
const outline = { show: true, colour: "#000000", width: null, dash: "solid" } as const;
const line = { colour: "group", width: null, dash: "solid" } as const;
const points = { shape: "circle", size: 1, filled: true, colour: "group" } as const;
const shared = {
  exaggeration: { show: false, factor: 10, style: "filled", colour: "curve", opacity: 0.35 },
  baseline: { show: true, colour: "axis", width: null, dash: "solid" },
  nulls: "gap",
  plus: { show: false, threshold: 0.5, size: 1.2 },
  valueLabels: { show: "off", threshold: 0, format: "{value}", decimals: 1 },
  axis: { min: null, max: null, reverse: false, scale: "linear", step: null, width: null, title: null },
  error: { show: "off", envelope: { colour: "curve", opacity: 0.25 }, bars: { colour: "curve", width: null, cap: 1 } },
} as const;

export const coreDefaults: CoreDefaults = {
  page: { width: 180, height: 240, units: "mm", font: { family: "Arial", size: 7 } },
  style: { background: "#ffffff", lineWidths: { axis: 0.15, curve: 0.1 }, tickLength: 1, colours: { axis: "#000000", text: "#000000" } },
  title: { align: "left" },
  xScale: 0.4,
  yAxis: { primary: "depth", reverse: true, range: null, titles: {} },
  headerBand: { angle: 60, minFontSize: 5, height: null },
  groupHeaders: { show: true, line: "line" },
  selection: { minMax: 0, order: "data" },
  taxonCurves: {
    commonScale: true,
    minWidth: 0,
    columnWidth: 15,
    groupGap: 2,
    xTicks: { step: null, minSpacing: 6, unitSuffix: false },
    xTitle: { show: "panel" },
  },
  curve: {
    polygon: { type: "polygon", ...shared, filled: true, fill, outline, shape: "linear" },
    line: { type: "line", ...shared, line, interpolation: "linear", points: { ...points, show: false } },
    linePoints: { type: "linePoints", ...shared, line, interpolation: "linear", points },
    points: { type: "points", ...shared, points },
    bars: { type: "bars", ...shared, barWidth: { mode: "mm", value: 0.6 }, fill, outline, align: "centre" },
    presence: { type: "presence", ...shared, presence: { symbol: "dot", size: 1.2, colour: "group" } },
    none: { type: "none", ...shared },
  },
  // Continuous values (LOI, δ13C, inferred WTD) are read as a line through the samples, not as abundances.
  kindCurves: {
    continuous: { type: "linePoints", exaggeration: { show: false }, plus: { show: false } },
  },
};
