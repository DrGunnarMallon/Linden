import { describe, expect, it } from "vitest";
import { computeLayout, fitXScale } from "../src/layout/layout.js";
import { interpolate, makeYScale, niceStep, ticksAt } from "../src/layout/scales.js";
import { makeTheme } from "../src/layout/theme.js";
import { coreDefaults, type ResolvedTaxonCurvesStyle } from "../src/model/defaults.js";
import type { Dataset } from "../src/model/types.js";
import { columnGeometry } from "../src/panels/taxonCurves.js";
import { render } from "../src/pipeline.js";

const style = (s: Partial<ResolvedTaxonCurvesStyle> = {}): ResolvedTaxonCurvesStyle => ({ ...coreDefaults.taxonCurves, ...s });

describe("scales", () => {
  it("y scale: depth increases downwards when reverse", () => {
    const y = makeYScale([10, 110], 50, true);
    expect(y.toMm(10)).toBe(0);
    expect(y.toMm(60)).toBe(25);
    expect(makeYScale([10, 110], 50, false).toMm(10)).toBe(50);
  });

  it("ticks and nice steps", () => {
    expect(ticksAt(10, 100, 20)).toEqual([20, 40, 60, 80, 100]);
    expect(ticksAt(0, 0.3, 0.1)).toEqual([0, 0.1, 0.2, 0.3]);
    expect(niceStep(10500, 6)).toBe(2000);
  });

  it("interpolates without extrapolating", () => {
    // demo: 10 cm = 1200, 20 cm = 2400 → 2000 yr at 10 + 800/1200 × 10 cm
    expect(interpolate([1200, 2400], [10, 20], 2000)).toBeCloseTo(16.6667, 4);
    expect(interpolate([1200, 2400], [10, 20], 1000)).toBeUndefined();
  });
});

describe("common scale", () => {
  it("column width ∝ max value with one x-scale", () => {
    const a = columnGeometry(50, style(), 0.4, 15);
    const b = columnGeometry(10, style(), 0.4, 15);
    expect(a).toEqual({ width: 20, scale: 0.4 });
    expect(b).toEqual({ width: 4, scale: 0.4 });
    expect(a.width / b.width).toBe(5);
  });

  it("minWidth widens the column but keeps the common scale", () => {
    expect(columnGeometry(2, style({ minWidth: 4 }), 0.4, 15)).toEqual({ width: 4, scale: 0.4 });
    expect(columnGeometry(50, style({ minWidth: 4 }), 0.4, 15)).toEqual({ width: 20, scale: 0.4 });
  });

  it("independent scale (commonScale false) uses a fixed width and own scale", () => {
    expect(columnGeometry(30, style({ commonScale: false }), 0.4, 15)).toEqual({ width: 15, scale: 0.5 });
  });
});

describe("fitting the page", () => {
  const theme = makeTheme(coreDefaults.page); // 180 mm wide, margins 5 + 5 → 170 mm available
  const maxes = [60, 40, 20, 5];
  const panel = (minWidth: number) => (f: number) => ({
    width: maxes.reduce((w, m) => w + columnGeometry(m, style({ minWidth }), f, 15).width, 0) + 3 * theme.columnGap,
    headerHeight: 10,
  });

  it("keeps the natural x-scale when everything fits", () => {
    const r = computeLayout(coreDefaults.page, theme, [panel(4)]);
    expect(r.xScale).toBe(theme.naturalXScale);
    expect(r.warnings).toEqual([]);
    expect(r.panelsWidth).toBeCloseTo(24 + 16 + 8 + 4 + 3, 10); // 5 % → 2 mm, floored to minWidth 4
  });

  it("shrinks the global x-scale with a warning when too wide", () => {
    const wide = [panel(4), panel(4), panel(4), panel(4)]; // 4 × 55 + 3 × 2 = 226 mm > 170 mm
    const r = computeLayout(coreDefaults.page, theme, wide);
    expect(r.xScale).toBeLessThan(theme.naturalXScale);
    expect(r.panelsWidth).toBeLessThanOrEqual(170 + 1e-9);
    expect(r.panelsWidth).toBeCloseTo(170, 6);
    expect(r.warnings).toEqual([expect.stringContaining("x-scale reduced from 0.4 to")]);
    // Common scale kept: the 60 % and 40 % columns are still 3 : 2.
    const w60 = columnGeometry(60, style({ minWidth: 4 }), r.xScale, 15).width;
    const w40 = columnGeometry(40, style({ minWidth: 4 }), r.xScale, 15).width;
    expect(w60 / w40).toBeCloseTo(1.5, 10);
  });

  it("warns about overflow when even minimum widths do not fit, without breaking the scale", () => {
    const r = fitXScale((f) => 200 + f, 170, 0.4);
    expect(r.xScale).toBe(0.4);
    expect(r.warning).toMatch(/overflows the page/);
  });

  it("render() shrinks and warns, keeping columns proportional", () => {
    const n = 12;
    const ds: Dataset = {
      id: "wide",
      name: "wide",
      depthUnit: "cm",
      samples: [{ id: "1", depth: 1 }, { id: "2", depth: 2 }],
      variables: Array.from({ length: n }, (_, j) => ({ id: `v${j}`, name: `v${j}`, kind: "percent" as const })),
      groups: [],
      values: [Array.from({ length: n }, (_, j) => (j % 2 ? 60 : 30)), Array(n).fill(0)],
    };
    const { svg, warnings } = render([ds], { specVersion: 1, panels: [{ type: "taxonCurves", dataset: "wide" }] });
    expect(warnings).toEqual([expect.stringContaining("x-scale reduced")]);
    const widths = [...svg.matchAll(/class="x-axis">\s*<line x1="0" y1="[^"]+" x2="([^"]+)"/g)].map((m) => Number(m[1]));
    expect(widths).toHaveLength(n);
    expect(widths[1]! / widths[0]!).toBeCloseTo(2, 2);
  });
});
