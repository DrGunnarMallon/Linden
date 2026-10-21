// Drawing constants (mm). Not part of the spec yet; one place to tune the look.

import type { ResolvedPage } from "../model/defaults.js";
import { stripMarkup } from "../render/svg.js";

export interface Theme {
  margin: { top: number; right: number; bottom: number; left: number };
  fontFamily: string;
  /** Base font size in mm (spec gives pt). */
  fontSize: number;
  tickFontSize: number;
  lineWidth: number;
  curveLineWidth: number;
  tickLength: number;
  minorTickLength: number;
  columnGap: number;
  panelGap: number;
  /** mm per data unit before any shrinking (e.g. 0.4 mm per %). */
  naturalXScale: number;
  /** Column width for panels without a common scale. */
  independentColumnWidth: number;
  /** Header label angle in degrees from horizontal. */
  headerAngle: number;
  headerGap: number;
  /** Tick step for percentage columns. */
  percentTickStep: number;
  barThickness: number;
  exaggerationOpacity: number;
  defaultFill: string;
  stroke: string;
  plusSize: number;
  plusOffset: number;
  zoneLineWidth: number;
}

export const PT_TO_MM = 25.4 / 72;

export function makeTheme(page: ResolvedPage): Theme {
  const fontSize = page.font.size * PT_TO_MM;
  return {
    margin: { top: 5, right: 5, bottom: 5, left: 5 },
    fontFamily: page.font.family,
    fontSize,
    tickFontSize: fontSize * 0.85,
    lineWidth: 0.15,
    curveLineWidth: 0.1,
    tickLength: 1,
    minorTickLength: 0.6,
    columnGap: 1,
    panelGap: 2,
    naturalXScale: 0.4,
    independentColumnWidth: 15,
    headerAngle: 90,
    headerGap: 1,
    percentTickStep: 20,
    barThickness: 0.6,
    exaggerationOpacity: 0.35,
    defaultFill: "#808080",
    stroke: "#000000",
    plusSize: 0.6,
    plusOffset: 1.2,
    zoneLineWidth: 0.2,
  };
}

/** No font metrics without a DOM: average Arial/Helvetica glyph ≈ 0.55 em. */
export function estimateTextWidth(text: string, fontSize: number): number {
  return stripMarkup(text).length * 0.55 * fontSize;
}

export function footerHeight(theme: Theme): number {
  return theme.tickLength + 0.5 + theme.tickFontSize + 0.5;
}
