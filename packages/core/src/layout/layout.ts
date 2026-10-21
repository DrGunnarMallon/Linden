// Layout engine — SPEC.md §6. Page = header band + plot area + footer band; columns left to right.
// If panels are too wide, shrink the single global x-scale (common scale preserved) and warn.

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

export interface LayoutResult {
  xScale: number;
  headerHeight: number;
  footerHeight: number;
  /** Plot area in page mm; height is the shared y-scale range. */
  plot: Rect;
  /** Left edge (page mm) and width of each panel. */
  panels: { x: number; width: number }[];
  /** Panels plus gaps. */
  panelsWidth: number;
  warnings: string[];
}

const mm = (n: number) => formatNumber(Math.round(n * 10) / 10);

/**
 * Largest x-scale ≤ natural for which totalAt(xScale) ≤ available. totalAt must be non-decreasing.
 * Never distorts individual columns: only the one global factor changes.
 */
export function fitXScale(
  totalAt: (xScale: number) => number,
  available: number,
  natural: number,
): { xScale: number; warning?: string } {
  const need = totalAt(natural);
  if (need <= available + 1e-9) return { xScale: natural };
  const floor = totalAt(0);
  if (floor > available + 1e-9) {
    return {
      xScale: natural,
      warning:
        `Diagram needs ${mm(floor)} mm even at minimum column widths but only ${mm(available)} mm are available; ` +
        `it overflows the page. Select fewer variables or reduce minWidth.`,
    };
  }
  let lo = 0;
  let hi = natural;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (totalAt(mid) <= available) lo = mid;
    else hi = mid;
  }
  return {
    xScale: lo,
    warning:
      `Diagram is ${mm(need)} mm wide at the natural x-scale but only ${mm(available)} mm are available; ` +
      `x-scale reduced from ${formatNumber(natural)} to ${lo.toFixed(3)} mm per unit (common scale kept).`,
  };
}

/** `measures[i](xScale)` measures panel i; `extraRight` is reserved right of the panels (overlay labels). */
export function computeLayout(
  page: ResolvedPage,
  theme: Theme,
  measures: readonly ((xScale: number) => PanelMeasure)[],
  extraRight = 0,
): LayoutResult {
  const warnings: string[] = [];
  const { margin } = theme;
  const gaps = theme.panelGap * Math.max(0, measures.length - 1);
  const available = page.width - margin.left - margin.right - extraRight;
  const totalAt = (f: number) => measures.reduce((s, m) => s + m(f).width, gaps);

  const fit = fitXScale(totalAt, available, theme.naturalXScale);
  if (fit.warning) warnings.push(fit.warning);

  const ms = measures.map((m) => m(fit.xScale));
  const headerHeight = ms.reduce((h, m) => Math.max(h, m.headerHeight), 0);
  const footer = footerHeight(theme);
  let height = page.height - margin.top - margin.bottom - headerHeight - footer;
  if (height < 10) {
    warnings.push(`Plot area is only ${mm(height)} mm high; using 10 mm. Increase page height or shorten labels.`);
    height = 10;
  }

  const panels: { x: number; width: number }[] = [];
  let x = margin.left;
  for (const m of ms) {
    panels.push({ x, width: m.width });
    x += m.width + theme.panelGap;
  }

  return {
    xScale: fit.xScale,
    headerHeight,
    footerHeight: footer,
    plot: { x: margin.left, y: margin.top + headerHeight, width: available, height },
    panels,
    panelsWidth: ms.reduce((s, m) => s + m.width, gaps),
    warnings,
  };
}
