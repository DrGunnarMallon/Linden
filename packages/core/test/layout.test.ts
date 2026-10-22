import { describe, expect, it } from "vitest";
import { compactLength, computeLayout, MIN_WIDTH_FLOOR, type FitState } from "../src/layout/layout.js";
import { interpolate, makeYScale, niceStep, ticksAt } from "../src/layout/scales.js";
import { makeTheme } from "../src/layout/theme.js";
import { coreDefaults, type ResolvedTaxonCurvesStyle } from "../src/model/defaults.js";
import type { Dataset } from "../src/model/types.js";
import { parseSpec } from "../src/io/spec.js";
import { autoTickStep, columnGeometry, columnTicks, type TaxonColumn } from "../src/panels/taxonCurves.js";
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

  it("independent scale (commonScale false): fixed width, own scale ending on a whole tick step", () => {
    // 30 over 15 mm = 0.5 mm/unit → auto step 20 (≥ 6 mm) → axis 0–40 → 15 / 40 mm per unit.
    expect(columnGeometry(30, style({ commonScale: false }), 0.4, 15)).toEqual({ width: 15, scale: 0.375, step: 20 });
    expect(columnGeometry(40, style({ commonScale: false }), 0.4, 15)).toEqual({ width: 15, scale: 0.375, step: 20 });
    expect(columnGeometry(54, style({ commonScale: false, xTicks: { step: 25, minSpacing: 6 } }), 0.4, 15)).toEqual({ width: 15, scale: 0.2, step: 25 });
    // exact (class scales): the top class at the column end.
    expect(columnGeometry(5, style({ commonScale: false }), 0.4, 15, true)).toEqual({ width: 15, scale: 3 });
  });
});

describe("fitting the page", () => {
  const theme = makeTheme(coreDefaults.page); // 180 mm wide, margins 5 + 5 → 170 mm available
  const maxes = [60, 40, 20, 5];
  const panel = (minWidth: number) => (s: FitState) => ({
    width:
      maxes.reduce((w, m) => w + columnGeometry(m, style({ minWidth: compactLength(minWidth, MIN_WIDTH_FLOOR, s.compact) }), s.xScale, 15).width, 0) +
      3 * theme.columnGap,
    headerHeight: 10,
  });

  it("keeps the natural x-scale when everything fits", () => {
    const r = computeLayout(coreDefaults.page, theme, [panel(4)]);
    expect(r.xScale).toBe(theme.naturalXScale);
    expect(r.warnings).toEqual([]);
    expect(r.info).toEqual([]);
    expect(r.panelsWidth).toBeCloseTo(24 + 16 + 8 + 4 + 3, 10); // 5 % → 2 mm, floored to minWidth 4
  });

  it("step (a) only: shrinks the global x-scale, reported as info, no warning", () => {
    const wide = [panel(4), panel(4), panel(4), panel(4)]; // 4 × 55 + 3 × 2 = 226 mm > 170 mm
    const r = computeLayout(coreDefaults.page, theme, wide);
    expect(r.xScale).toBeLessThan(theme.naturalXScale);
    expect(r.panelsWidth).toBeLessThanOrEqual(170 + 1e-9);
    expect(r.panelsWidth).toBeCloseTo(170, 6);
    expect(r.warnings).toEqual([]);
    expect(r.info).toEqual([expect.stringMatching(/^x-scale reduced from 0\.4 to 0\.\d+ mm per unit to fit the page \(needs 236 mm at full size, page is 180 mm; common scale kept\)\.$/)]);
    expect(r.fit.compact).toBe(1);
    // Common scale kept: the 60 % and 40 % columns are still 3 : 2.
    const w60 = columnGeometry(60, style({ minWidth: 4 }), r.xScale, 15).width;
    const w40 = columnGeometry(40, style({ minWidth: 4 }), r.xScale, 15).width;
    expect(w60 / w40).toBeCloseTo(1.5, 10);
  });

  it("steps (a)+(b): x-scale stops at 25 %, then minWidth is compacted only as far as needed", () => {
    // Nine panels at x floor 0.1 mm/%: columns 6, 4, 4, 4 mm (minWidth 4) + 3 gaps = 21 mm → 9 × 21 + 8 × 2 = 205 mm > 170.
    // Fully compacted (minWidth 0.5): 6 + 4 + 2 + 0.5 + 3 = 15.5 mm → 155.5 mm, so (b) stops part-way.
    const r = computeLayout(coreDefaults.page, theme, Array(9).fill(panel(4)), { minWidths: [4] });
    expect(r.xScale).toBeCloseTo(0.1, 10);
    expect(r.fit.compact).toBeGreaterThan(0);
    expect(r.fit.compact).toBeLessThan(1);
    expect(r.panelsWidth).toBeCloseTo(170, 6);
    expect(r.warnings).toEqual([]);
    expect(r.info).toEqual([
      expect.stringMatching(/^x-scale reduced from 0\.4 to 0\.1 mm per unit/),
      expect.stringMatching(/^minWidth reduced from 4 to \d\.\d+ mm, column gaps from 1 to 0\.\d+ mm to fit the page\.$/),
    ]);
  });

  it("step (d): warns with how many mm do not fit, after trying every step", () => {
    const r = computeLayout(coreDefaults.page, theme, [(s: FitState) => ({ width: 200 + s.xScale, headerHeight: 0 })], { labelFont: { base: 7, min: 5 } });
    expect(r.info).toHaveLength(3); // (a), (b) and (c) all applied (and reported) before the warning
    expect(r.warnings).toEqual([
      "Diagram does not fit the page width: it needs a page 210.1 mm wide (panels 200.1 mm, margins 5 + 5 mm) but the page is 180 mm — 30.1 mm too wide even at the smallest x-scale, minWidth, gaps and label size. Select fewer variables or use a wider page.",
    ]);
  });

  it("render() shrinks (info, no warning), keeping columns proportional", () => {
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
    const { svg, warnings, info } = render([ds], { specVersion: 2, panels: [{ type: "taxonCurves", dataset: "wide" }] });
    expect(warnings).toEqual([]);
    expect(info).toEqual([expect.stringContaining("x-scale reduced")]);
    const widths = [...svg.matchAll(/class="x-axis">\s*<line x1="0" y1="[^"]+" x2="([^"]+)"/g)].map((m) => Number(m[1]));
    expect(widths).toHaveLength(n);
    expect(widths[1]! / widths[0]!).toBeCloseTo(2, 2);
  });
});

describe("per-column x axes", () => {
  const tickFont = makeTheme(coreDefaults.page).tickFontSize; // 7 pt × 0.85
  const col = (max: number, width: number, s: Partial<ResolvedTaxonCurvesStyle> = {}): TaxonColumn => ({
    index: 0,
    variable: { id: "v", name: "v", kind: "percent" },
    style: style(s),
    max,
    x: 0,
    width,
    scale: 0.4,
    lo: 0,
    hi: width / 0.4,
    log: false,
    reverse: false,
  });
  const labelled = (ticks: { value: number; label: boolean }[]) => ticks.filter((t) => t.label).map((t) => t.value);

  it("automatic step: smallest 1–2–5 step at least minSpacing mm long", () => {
    expect(autoTickStep(0.4, 6)).toBe(20); // 10 % = 4 mm too tight, 20 % = 8 mm
    expect(autoTickStep(0.2, 6)).toBe(50);
    expect(autoTickStep(0.4, 8)).toBe(20); // exactly 8 mm
    expect(autoTickStep(1, 6)).toBe(10);
    expect(autoTickStep(0.004, 6)).toBe(2000);
  });

  it("wide column: ticks every 20 %, labels unless they would reach the next column's 0", () => {
    const ticks = columnTicks(col(60, 24), 1, tickFont, 0.5);
    expect(ticks.map((t) => t.value)).toEqual([0, 20, 40, 60]);
    expect(labelled(ticks)).toEqual([0, 20, 40]); // "60" at the column edge would touch the next "0"
    expect(labelled(columnTicks(col(60, 24), 5, tickFont, 0.5))).toEqual([0, 20, 40, 60]); // more room after
  });

  it("narrow columns get a single label", () => {
    expect(labelled(columnTicks(col(10, 4), 1, tickFont, 0.5))).toEqual([0]);
    const two = columnTicks(col(22.5, 9), 1, tickFont, 0.5);
    expect(two.map((t) => t.value)).toEqual([0, 20]);
    expect(labelled(two)).toEqual([0]);
  });

  it("explicit step and minSpacing from the spec", () => {
    expect(columnTicks(col(30, 12, { xTicks: { step: 10, minSpacing: 6 } }), 1, tickFont, 0.5).map((t) => t.value)).toEqual([0, 10, 20, 30]);
    expect(columnTicks(col(60, 24, { xTicks: { step: null, minSpacing: 16 } }), 1, tickFont, 0.5).map((t) => t.value)).toEqual([0, 50]);
  });
});

describe("per-variable overrides", () => {
  const ds: Dataset = {
    id: "o",
    name: "o",
    depthUnit: "cm",
    samples: [{ id: "1", depth: 1 }, { id: "2", depth: 2 }],
    variables: ["a", "b"].map((id) => ({ id, name: id, kind: "percent" as const })),
    groups: [],
    values: [[10, 10], [5, 5]],
  };

  it("switch exaggeration off for one taxon only (old overrides migrate to curveStyles); unknown ids warn", () => {
    const spec = parseSpec({
      specVersion: 2,
      panels: [{ type: "taxonCurves", dataset: "o", style: { exaggeration: 10 }, overrides: { a: { exaggeration: 0 }, zz: { mode: "bars" } } }],
    });
    if (!spec.ok) throw new Error(spec.errors.join("\n"));
    expect(spec.value.curveStyles).toEqual({ a: { exaggeration: { show: false } }, zz: { type: "bars" } });
    const { svg, warnings } = render([ds], spec.value);
    const [, a, b] = svg.split('class="column"');
    expect(a).not.toContain('class="exaggeration"');
    expect(b).toContain('class="exaggeration"');
    expect(warnings).toEqual(['curveStyles: "zz" is not a variable of any dataset.']);
    const layoutOverride = render([ds], { specVersion: 8, panels: [{ type: "taxonCurves", dataset: "o", overrides: { zz: { minWidth: 3 } } }] });
    expect(layoutOverride.warnings).toEqual(['taxonCurves: override for "zz", which is not in dataset "o".']);
  });

  it("panel-level layout keys cannot be overridden per variable", () => {
    const r = parseSpec({ specVersion: 2, panels: [{ type: "taxonCurves", dataset: "o", overrides: { a: { groupGap: 1 } } }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatch(/^panels\[0\]\.overrides\.a: /);
  });
});
