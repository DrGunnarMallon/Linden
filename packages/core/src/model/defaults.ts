// Core defaults — the first layer of resolution (core → preset → spec → per-variable override).

import type { Selection, TaxonCurvesStyle, YAxisSpec } from "./spec.js";

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
};

export type ResolvedSelection = Required<Pick<Selection, "minMax" | "order">> & Pick<Selection, "ids" | "groups">;

export type ResolvedTaxonCurvesStyle = Required<Omit<TaxonCurvesStyle, "xTicks">> & {
  xTicks: { step: number | null; minSpacing: number };
};

export interface ResolvedHeaderBand {
  angle: number;
  /** pt */
  minFontSize: number;
  /** mm; null = fit the labels. */
  height: number | null;
}

export interface CoreDefaults {
  page: ResolvedPage;
  yAxis: ResolvedYAxis;
  headerBand: ResolvedHeaderBand;
  selection: ResolvedSelection;
  taxonCurves: ResolvedTaxonCurvesStyle;
}

export const coreDefaults: CoreDefaults = {
  page: { width: 180, height: 240, units: "mm", font: { family: "Arial", size: 7 } },
  yAxis: { primary: "depth", reverse: true, range: null },
  headerBand: { angle: 60, minFontSize: 5, height: null },
  selection: { minMax: 0, order: "data" },
  taxonCurves: {
    mode: "silhouette",
    fill: "group",
    exaggeration: 0,
    commonScale: true,
    minWidth: 0,
    plusBelow: 0,
    groupGap: 2,
    xTicks: { step: null, minSpacing: 6 },
  },
};
