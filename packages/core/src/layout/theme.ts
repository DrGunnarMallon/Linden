// Drawing constants (mm): the figure style from the spec (style.*, SPEC §6) plus fixed constants;
// one place to tune the look.

import { coreDefaults, type ResolvedFigureStyle, type ResolvedPage } from "../model/defaults.js";
import { resolveStyle } from "../model/resolve.js";
import { stripMarkup } from "../render/svg.js";
import { textWidthEm } from "./metrics.js";

export interface Theme {
  margin: { top: number; right: number; bottom: number; left: number };
  /** Labels font (taxon labels, group headers, axis titles, zone labels). */
  fontFamily: string;
  /** Labels font size in mm (spec gives pt). */
  fontSize: number;
  tickFontFamily: string;
  tickFontSize: number;
  titleFontFamily: string;
  /** Diagram title font size in mm before any fitting. */
  titleFontSize: number;
  /** Page background; null = transparent. */
  background: string | null;
  /** Axis lines, ticks, zero lines, group header lines. */
  axisColour: string;
  textColour: string;
  /** Axis line width. */
  lineWidth: number;
  curveLineWidth: number;
  tickLength: number;
  minorTickLength: number;
  columnGap: number;
  panelGap: number;
  /** mm per data unit before any shrinking (spec xScale, e.g. 0.4 mm per %). */
  naturalXScale: number;
  /** Gap between the plot top and the taxon labels. */
  headerGap: number;
  /** Font-size step (pt) when shrinking header labels. */
  headerFontStep: number;
  /** Perpendicular space a rotated label needs, in em. */
  labelThickness: number;
  /** Group header bracket: end tick length and gap to the labels below. */
  bracketTick: number;
  bracketGap: number;
  /** Minimum clear space between tick labels. */
  tickLabelPad: number;
  barThickness: number;
  exaggerationOpacity: number;
  defaultFill: string;
  stroke: string;
  plusSize: number;
  /** Width of a presence column and radius of its dots. */
  presenceWidth: number;
  presenceDotRadius: number;
  plusOffset: number;
  zoneLineWidth: number;
}

export const PT_TO_MM = 25.4 / 72;

export function makeTheme(page: ResolvedPage, style: ResolvedFigureStyle = resolveStyle(page, undefined), xScale = coreDefaults.xScale): Theme {
  const { fonts } = style;
  return {
    margin: { top: 5, right: 5, bottom: 5, left: 5 },
    fontFamily: fonts.labels.family,
    fontSize: fonts.labels.size * PT_TO_MM,
    tickFontFamily: fonts.ticks.family,
    tickFontSize: fonts.ticks.size * PT_TO_MM,
    titleFontFamily: fonts.title.family,
    titleFontSize: fonts.title.size * PT_TO_MM,
    background: style.background,
    axisColour: style.colours.axis,
    textColour: style.colours.text,
    lineWidth: style.lineWidths.axis,
    curveLineWidth: style.lineWidths.curve,
    tickLength: style.tickLength,
    minorTickLength: style.tickLength * 0.6,
    columnGap: 1,
    panelGap: 2,
    naturalXScale: xScale,
    headerGap: 1,
    headerFontStep: 0.25,
    labelThickness: 1,
    bracketTick: 0.8,
    bracketGap: 1,
    tickLabelPad: 0.5,
    barThickness: 0.6,
    exaggerationOpacity: 0.35,
    defaultFill: "#808080",
    stroke: "#000000",
    plusSize: 0.6,
    presenceWidth: 3,
    presenceDotRadius: 0.6,
    plusOffset: 1.2,
    zoneLineWidth: 0.2,
  };
}

/** No DOM: width from the approximate Helvetica/Arial metrics table in metrics.ts. Markup is ignored. */
export function estimateTextWidth(text: string, fontSize: number): number {
  return textWidthEm(stripMarkup(text)) * fontSize;
}

export function footerHeight(theme: Theme): number {
  return theme.tickLength + 0.5 + theme.tickFontSize + 0.5;
}

/** Footer with a line for x-axis titles (labels font) under the tick labels; the title's glyph box starts at footerHeight. */
export function footerHeightWithTitle(theme: Theme): number {
  return footerHeight(theme) + theme.fontSize;
}

/** Font-family attribute for text in `family`, given the inherited one (undefined = inherit). */
export function familyAttr(family: string, inherited: string): string | undefined {
  return family === inherited ? undefined : family;
}
