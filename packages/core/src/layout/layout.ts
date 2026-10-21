// Layout engine — SPEC.md §6. Page = title band + header band + plot area + footer band; columns left to right.
// Everything drawn is reserved: panel widths plus what panels draw beyond them (tick and unit
// labels, markers), the rotated taxon labels and group headers (left and right), overlay labels.
// The panels stay inside the page margins; ink beyond them (rotated label tails, zone labels, edge
// tick labels) may use the margins but never leaves the page.
// Too wide → fit in this order, each step only as far as needed (SPEC §6):
//   a. shrink the global x factor (common scale stays common), down to 25 % of natural;
//   b. compact column minWidth (→ 0.5 mm) and column/group gaps (→ 0.3 mm) proportionally;
//   c. reduce the taxon-label font, down to headerBand.minFontSize;
//   d. warn, with how many mm do not fit.
// Applied steps are reported as info messages.

import type { ResolvedPage } from "../model/defaults.js";
import type { PanelMeasure } from "../panels/types.js";
import { formatNumber } from "./scales.js";
import { footerHeight, type Theme } from "./theme.js";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The adjustable quantities of the fit. */
export interface FitState {
  /** Global x factor, mm per unit (percent family). */
  xScale: number;
  /** 1 = minWidth and gaps as specified; 0 = at their floors (see `compactLength`). */
  compact: number;
  /** Largest taxon-label font size allowed, pt. */
  labelFont: number;
}

/** Floors of step (b). */
export const MIN_WIDTH_FLOOR = 0.5;
export const GAP_FLOOR = 0.3;
/** Floor of step (a), as a fraction of the natural x factor. */
export const X_FACTOR_FLOOR = 0.25;

/** A length shrunk towards `floor` by `compact` (1 = unchanged); values at or below the floor stay. */
export function compactLength(value: number, floor: number, compact: number): number {
  return value <= floor ? value : floor + compact * (value - floor);
}

/** Header band at a fit state: height and horizontal extent of labels / group headers (from the first panel's left edge). */
export type HeaderMeasure = (s: FitState) => { height: number; left: number; right: number };

export interface LayoutOptions {
  /** Reserved right of the panels (overlay labels). */
  extraRight?: number;
  header?: HeaderMeasure;
  /** Base and minimum taxon-label font size, pt (step c). */
  labelFont?: { base: number; min: number };
  /** Distinct minWidth values in use, for the info message of step (b). */
  minWidths?: readonly number[];
  /** Height of the title band above the header band (layout/title.ts); 0 = none. */
  titleHeight?: number;
}

export interface LayoutResult {
  xScale: number;
  /** Fit state used (pass to panels / header). */
  fit: FitState;
  /** Title band height; the band's top is at margin.top. */
  titleHeight: number;
  headerHeight: number;
  footerHeight: number;
  /** Plot area in page mm; x = left edge of the first panel; height is the shared y-scale range. */
  plot: Rect;
  /** Left edge (page mm) and width of each panel. */
  panels: { x: number; width: number }[];
  /** Panels plus gaps. */
  panelsWidth: number;
  /** Page width (mm) left before fitting would start; 0 once fitted, negative if it does not fit. */
  slack: number;
  warnings: string[];
  /** Adjustments made to fit the page. */
  info: string[];
}

const mm = (n: number) => formatNumber(Math.round(n * 10) / 10);
const mm2 = (n: number) => formatNumber(Math.round(n * 100) / 100);

/** Largest value in [lo, hi] for which `fits` holds, given fits(lo) and a monotone `fits`. */
function bisect(fits: (v: number) => boolean, lo: number, hi: number): number {
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

interface Extent {
  /** Ink extent (≤ 0 / ≥ body), relative to the first panel's left edge. */
  left: number;
  right: number;
  /** Panels incl. gaps: must stay inside the margins. */
  panels: number;
  /** Overlay labels right of the panels (part of the ink). */
  zones: number;
}

/**
 * `measures[i](s)` measures panel i at fit state s. Every measure must be non-decreasing in
 * s.xScale, s.compact and s.labelFont (wider never gets narrower).
 */
export function computeLayout(
  page: ResolvedPage,
  theme: Theme,
  measures: readonly ((s: FitState) => PanelMeasure)[],
  options: LayoutOptions = {},
): LayoutResult {
  const warnings: string[] = [];
  const info: string[] = [];
  const { margin } = theme;
  const extraRight = options.extraRight ?? 0;
  const font = options.labelFont ?? { base: page.font.size, min: page.font.size };
  const available = page.width - margin.left - margin.right;
  const gaps = theme.panelGap * Math.max(0, measures.length - 1);

  /** Horizontal extent of everything drawn, relative to the first panel's left edge. */
  const extentAt = (s: FitState): Extent => {
    let x = 0;
    let left = 0;
    let right = 0;
    for (const m of measures.map((f) => f(s))) {
      left = Math.min(left, x - (m.overhang?.left ?? 0));
      right = Math.max(right, x + m.width + (m.overhang?.right ?? 0));
      x += m.width + theme.panelGap;
    }
    const panels = Math.max(0, x - theme.panelGap);
    right = Math.max(right, panels + extraRight);
    const h = options.header?.(s);
    if (h) {
      left = Math.min(left, h.left);
      right = Math.max(right, h.right);
    }
    return { left, right, panels, zones: extraRight };
  };
  /** First panel's page x: at the left margin, further right only if ink would leave the page. */
  const originOf = (e: Extent) => Math.max(margin.left, -e.left);
  /** Page width needed: panels inside the right margin, ink inside the page. */
  const pageNeeded = (e: Extent) => originOf(e) + Math.max(e.panels + margin.right, e.right);
  const needAt = (s: FitState) => pageNeeded(extentAt(s));
  const fits = (s: FitState) => needAt(s) <= page.width + 1e-9;

  const natural = theme.naturalXScale;
  const xFloor = natural * X_FACTOR_FLOOR;
  let s: FitState = { xScale: natural, compact: 1, labelFont: font.base };
  if (!fits(s)) {
    const need = needAt(s);
    // (a) global x factor
    s = { ...s, xScale: fits({ ...s, xScale: xFloor }) ? bisect((f) => fits({ ...s, xScale: f }), xFloor, natural) : xFloor };
    info.push(
      `x-scale reduced from ${formatNumber(natural)} to ${mm2(s.xScale)} mm per unit to fit the page ` +
        `(needs ${mm(need)} mm at full size, page is ${mm(page.width)} mm; common scale kept).`,
    );
    // (b) minWidth and gaps
    if (!fits(s)) {
      s = { ...s, compact: fits({ ...s, compact: 0 }) ? bisect((c) => fits({ ...s, compact: c }), 0, 1) : 0 };
      const widths = [...new Set(options.minWidths ?? [])].filter((w) => w > MIN_WIDTH_FLOOR).sort((a, b) => b - a);
      const parts = widths.map((w) => `minWidth reduced from ${mm2(w)} to ${mm2(compactLength(w, MIN_WIDTH_FLOOR, s.compact))} mm`);
      parts.push(`column gaps from ${mm2(theme.columnGap)} to ${mm2(compactLength(theme.columnGap, GAP_FLOOR, s.compact))} mm`);
      info.push(`${parts.join(", ")} to fit the page.`);
    }
    // (c) label font, in steps of theme.headerFontStep
    if (!fits(s)) {
      let size = font.base;
      while (size - theme.headerFontStep >= font.min - 1e-9 && !fits({ ...s, labelFont: size })) size -= theme.headerFontStep;
      size = Math.max(font.min, size);
      s = { ...s, labelFont: size };
      info.push(`Taxon label font reduced from ${formatNumber(font.base)} to ${formatNumber(size)} pt to fit the page.`);
    }
    // (d) warn
    if (!fits(s)) {
      const e = extentAt(s);
      const need = pageNeeded(e);
      const parts = [`panels ${mm(e.panels)} mm`];
      if (-e.left > 0.05) parts.push(`labels reaching ${mm(-e.left)} mm left of the first panel`);
      if (e.right > e.panels + 0.05) parts.push(`labels reaching ${mm(e.right - e.panels)} mm right of the last panel`);
      warnings.push(
        `Diagram does not fit the page width: it needs a page ${mm(need)} mm wide (${parts.join(", ")}, margins ` +
          `${mm(margin.left)} + ${mm(margin.right)} mm) but the page is ${mm(page.width)} mm — ${mm(need - page.width)} mm too wide ` +
          `even at the smallest x-scale, minWidth, gaps and label size. Select fewer variables or use a wider page.`,
      );
    }
  }

  const ms = measures.map((m) => m(s));
  const extent = extentAt(s);
  const h = options.header?.(s);
  const headerHeight = ms.reduce((acc, m) => Math.max(acc, m.headerHeight), h?.height ?? 0);
  const footer = ms.reduce((f, m) => Math.max(f, m.footerHeight ?? 0), footerHeight(theme));
  const titleHeight = options.titleHeight ?? 0;
  let height = page.height - margin.top - margin.bottom - titleHeight - headerHeight - footer;
  if (height < 10) {
    warnings.push(`Plot area is only ${mm(height)} mm high; using 10 mm. Increase page height or shorten labels.`);
    height = 10;
  }

  const x0 = originOf(extent);
  const panels: { x: number; width: number }[] = [];
  let x = x0;
  for (const m of ms) {
    panels.push({ x, width: m.width });
    x += m.width + theme.panelGap;
  }

  return {
    xScale: s.xScale,
    fit: s,
    titleHeight,
    headerHeight,
    footerHeight: footer,
    plot: { x: x0, y: margin.top + titleHeight + headerHeight, width: ms.reduce((acc, m) => acc + m.width, gaps), height },
    panels,
    panelsWidth: ms.reduce((acc, m) => acc + m.width, gaps),
    slack: page.width - pageNeeded(extent),
    warnings,
    info,
  };
}
