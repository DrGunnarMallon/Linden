// Core defaults — the first layer of resolution (core → preset → spec → per-variable override).

import type { Selection, TaxonCurvesStyle, TitleSpec, YAxisSpec } from "./spec.js";

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

export type ResolvedTaxonCurvesStyle = Required<Omit<TaxonCurvesStyle, "xTicks" | "xTitle">> & {
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
  yAxis: ResolvedYAxis;
  headerBand: ResolvedHeaderBand;
  groupHeaders: ResolvedGroupHeaders;
  selection: ResolvedSelection;
  taxonCurves: ResolvedTaxonCurvesStyle;
}

export const coreDefaults: CoreDefaults = {
  page: { width: 180, height: 240, units: "mm", font: { family: "Arial", size: 7 } },
  style: { background: "#ffffff", lineWidths: { axis: 0.15, curve: 0.1 }, tickLength: 1, colours: { axis: "#000000", text: "#000000" } },
  title: { align: "left" },
  yAxis: { primary: "depth", reverse: true, range: null, titles: {} },
  headerBand: { angle: 60, minFontSize: 5, height: null },
  groupHeaders: { show: true, line: "line" },
  selection: { minMax: 0, order: "data" },
  taxonCurves: {
    mode: "silhouette",
    fill: "group",
    exaggeration: 0,
    commonScale: true,
    minWidth: 0,
    plusBelow: 0,
    groupGap: 2,
    xTicks: { step: null, minSpacing: 6, unitSuffix: false },
    xTitle: { show: "panel" },
    presence: "dot",
  },
};
