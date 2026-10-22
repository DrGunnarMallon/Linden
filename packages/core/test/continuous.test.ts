// Continuous columns (SPEC §4 curve style `axis` / `error`, §6): per-column axes (range, reverse, log,
// step, width, title), error envelopes and bars from companion columns, the continuous kind defaults.

import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { deleteVariable, setCompanion } from "../src/edit/dataset.js";
import { exportDelimited, importDelimited } from "../src/io/delimited.js";
import { loadPresets } from "../src/io/presets.js";
import { parseProject, serializeProject } from "../src/io/project.js";
import { makeTheme } from "../src/layout/theme.js";
import { coreDefaults, type ResolvedTaxonCurvesStyle } from "../src/model/defaults.js";
import { resolveCurveStyle } from "../src/model/resolve.js";
import { SPEC_VERSION, type CurveStyleOverride, type Spec } from "../src/model/spec.js";
import type { Dataset } from "../src/model/types.js";
import { columnAxis, columnTicks, errorBounds, valueX, type AxisRequest, type TaxonColumn } from "../src/panels/taxonCurves.js";
import { render } from "../src/pipeline.js";
import { readRepoFile } from "./fixtures.js";

const { presets } = loadPresets(
  readdirSync(new URL("../../../presets/", import.meta.url))
    .filter((f) => f.endsWith(".json"))
    .map((file) => ({ file, text: readRepoFile(`presets/${file}`) })),
);

// WTD with lower / upper bounds, LOI with ± SE; a gap (null) and a sample without bounds break the envelope.
const ds: Dataset = {
  id: "c",
  name: "c",
  depthUnit: "cm",
  samples: [0, 10, 20, 30].map((depth) => ({ id: String(depth), depth })),
  variables: [
    { id: "WTD", name: "WTD", kind: "continuous", unit: "cm" },
    { id: "WTD_lo", name: "WTD lower", kind: "continuous", unit: "cm", companion: { errorOf: "WTD", role: "lower" } },
    { id: "WTD_hi", name: "WTD upper", kind: "continuous", unit: "cm", companion: { errorOf: "WTD", role: "upper" } },
    { id: "LOI", name: "LOI", kind: "continuous", unit: "%" },
    { id: "LOI_se", name: "LOI SE", kind: "continuous", unit: "%", companion: { errorOf: "LOI", role: "se" } },
    { id: "MS", name: "MS", kind: "continuous", unit: "SI" },
    { id: "d13C", name: "δ13C", kind: "continuous", unit: "‰" },
  ],
  groups: [],
  values: [
    [10, 8, 13, 90, 2, 1, -27],
    [20, 15, 24, null, null, 10, -26],
    [15, null, null, 80, 5, 100, -25.5],
    [5, 4, 7, 85, 1, 1000, -28],
  ],
};

const spec = (curveStyles: Record<string, CurveStyleOverride> = {}, ids?: string[], extra: Partial<Spec> = {}): Spec => ({
  specVersion: SPEC_VERSION,
  page: { width: 140, height: 80 },
  panels: [{ type: "taxonCurves", dataset: "c", style: { commonScale: false, columnWidth: 20 }, ...(ids ? { variables: { ids } } : {}) }],
  curveStyles,
  ...extra,
});

/** Inner markup of a column's group. */
function columnSvg(svg: string, id: string): string {
  const start = svg.indexOf(`id="panel-0-taxonCurves-${id}"`);
  const end = svg.indexOf('class="column"', start + 40);
  return svg.slice(start, end === -1 ? undefined : end);
}

/** Tick label texts of a column, left to right. */
const tickLabels = (col: string) => [...col.matchAll(/font-size="[\d.]+" text-anchor="(?:start|middle|end)">([^<]+)</g)].map((m) => m[1]);

/** x coordinates of the points of a path's d attribute. */
const pathXs = (d: string) => [...d.matchAll(/[ML](-?[\d.]+),/g)].map((m) => Number(m[1]));

const axisRequest = (over: Partial<AxisRequest>): AxisRequest => ({ min: null, max: null, log: false, step: null, minSpacing: 6, integer: false, fromZero: false, exact: false, ...over });

describe("error bounds from companion columns", () => {
  it("lower / upper bounds as given; none where a bound or the value is missing", () => {
    expect(errorBounds(ds, 0)).toEqual({ lo: [8, 15, undefined, 4], hi: [13, 24, undefined, 7] });
  });

  it("± SE around the value; a null value has no bounds", () => {
    expect(errorBounds(ds, 3)).toEqual({ lo: [88, undefined, 75, 84], hi: [92, undefined, 85, 86] });
  });

  it("no companions → undefined; SD when there is no SE; one bound alone reaches to the value", () => {
    expect(errorBounds(ds, 5)).toBeUndefined();
    const one: Dataset = {
      ...ds,
      variables: [
        { id: "a", name: "a", kind: "continuous" },
        { id: "a_sd", name: "a sd", kind: "continuous", companion: { errorOf: "a", role: "sd" } },
        { id: "b", name: "b", kind: "continuous" },
        { id: "b_up", name: "b up", kind: "continuous", companion: { errorOf: "b", role: "upper" } },
      ],
      values: [[10, -2, 5, 9]],
      samples: [ds.samples[0]!],
    };
    expect(errorBounds(one, 0)).toEqual({ lo: [8], hi: [12] }); // |sd| either side
    expect(errorBounds(one, 2)).toEqual({ lo: [5], hi: [9] });
  });
});

describe("column axis", () => {
  it("continuous: the data extent (with error bounds) rounded out to whole ticks, 0 not forced", () => {
    // 4–24 cm over 20 mm: 1 mm per cm → step 10 → 0–30.
    expect(columnAxis(20, axisRequest({ lo: 4, hi: 24 }))).toEqual({ scale: 20 / 30, lo: 0, hi: 30, log: false, step: 10 });
    // δ13C −28 … −25.5: step 1 → −28 … −25.
    expect(columnAxis(20, axisRequest({ lo: -28, hi: -25.5 }))).toEqual({ scale: 20 / 3, lo: -28, hi: -25, log: false, step: 1 });
  });

  it("abundance kinds still start at 0 (as columnGeometry); fixed ends are used as given", () => {
    expect(columnAxis(15, axisRequest({ hi: 30, fromZero: true }))).toEqual({ scale: 0.375, lo: 0, hi: 40, log: false, step: 20 });
    expect(columnAxis(20, axisRequest({ lo: 4, hi: 24, min: -5, max: 35 }))).toMatchObject({ scale: 0.5, lo: -5, hi: 35 });
  });

  it("log: whole decades around the data", () => {
    expect(columnAxis(20, axisRequest({ log: true, minPositive: 1.5, hi: 800 }))).toEqual({ scale: 20 / 999, lo: 1, hi: 1000, log: true });
    const col = { lo: 1, hi: 1000, log: true, reverse: false, scale: 20 / 999, width: 20 };
    expect(valueX(col, 10)).toBeCloseTo(20 / 3, 9);
    expect(valueX(col, 1000)).toBeCloseTo(20, 9);
    expect(valueX({ ...col, reverse: true }, 1000)).toBeCloseTo(0, 9);
    expect(valueX(col, 0)).toBe(Number.NEGATIVE_INFINITY);
  });

  it("reversed linear axis: the largest value on the left", () => {
    const col = { lo: 0, hi: 30, log: false, reverse: true, scale: 20 / 30, width: 20 };
    expect(valueX(col, 30)).toBe(0);
    expect(valueX(col, 0)).toBe(20);
    expect(valueX(col, 15)).toBe(10);
  });
});

describe("column ticks on reversed and log axes", () => {
  const tickFont = makeTheme(coreDefaults.page).tickFontSize;
  const style: ResolvedTaxonCurvesStyle = { ...coreDefaults.taxonCurves, commonScale: false };
  const col = (over: Partial<TaxonColumn>): TaxonColumn => ({
    index: 0,
    variable: { id: "v", name: "v", kind: "continuous" },
    style,
    curve: coreDefaults.curve.linePoints,
    max: 0,
    x: 0,
    width: 20,
    scale: 20 / 30,
    lo: 0,
    hi: 30,
    log: false,
    reverse: false,
    key: "continuous|",
    step: 10,
    ...over,
  });
  const labels = (ticks: ReturnType<typeof columnTicks>) => ticks.filter((t) => t.label).map((t) => [t.text, t.anchor]);

  it("reversed: labels left to right from the largest value, kept inside the column", () => {
    const ticks = columnTicks(col({ reverse: true }), 2, tickFont, 0.5);
    expect(ticks.map((t) => t.value)).toEqual([30, 20, 10, 0]);
    expect(labels(ticks)).toEqual([
      ["30", "start"],
      ["20", "middle"],
      ["10", "middle"],
      ["0", "end"],
    ]);
  });

  it("log: labels at the powers of ten, unlabelled minor ticks between them", () => {
    const ticks = columnTicks(col({ log: true, lo: 1, hi: 1000, scale: 20 / 999, width: 30 }), 2, tickFont, 0.5);
    expect(labels(ticks).map(([t]) => t)).toEqual(["1", "10", "100", "1000"]);
    expect(ticks.filter((t) => t.minor)).toHaveLength(24); // 2–9 in three decades
    expect(ticks.every((t, i) => i === 0 || t.value > ticks[i - 1]!.value)).toBe(true);
  });

  it("log over less than two decades: 2 and 5 are label candidates too", () => {
    const ticks = columnTicks(col({ log: true, lo: 1, hi: 10, scale: 20 / 9, width: 40 }), 2, tickFont, 0.5);
    expect(labels(ticks).map(([t]) => t)).toEqual(["1", "2", "5", "10"]);
  });
});

describe("continuous kind defaults (cascade level 'kind')", () => {
  const testate = { ...spec(), preset: "testate-percent" };

  it("line + points, no exaggeration, no '+', even under a bars preset with '+' markers", () => {
    const r = resolveCurveStyle(testate, "LOI", { dataset: ds, presets });
    expect(r.style.type).toBe("linePoints");
    expect(r.style.exaggeration.show).toBe(false);
    expect(r.style.plus.show).toBe(false);
    expect(r.source.type).toBe("kind");
    // Taxa (counts) keep the preset's bars.
    expect(resolveCurveStyle(testate, "x", { kind: "count", presets }).style.type).toBe("bars");
  });

  it("what the user sets (panel, group, curve) wins over the kind defaults", () => {
    const panel = { ...testate, panels: [{ type: "taxonCurves" as const, dataset: "c", style: { curve: { type: "bars" as const } } }] };
    expect(resolveCurveStyle(panel, "LOI", { dataset: ds, presets }).style.type).toBe("bars");
    expect(resolveCurveStyle({ ...testate, curveStyles: { LOI: { plus: { show: true } } } }, "LOI", { dataset: ds, presets }).style.plus.show).toBe(true);
  });
});

describe("continuous columns in a taxonCurves panel", () => {
  it("error columns are never drawn as curves", () => {
    const r = render([ds], spec());
    expect([...r.svg.matchAll(/id="panel-0-taxonCurves-([^"]+)" class="column"/g)].map((m) => m[1])).toEqual(["WTD", "LOI", "MS", "d13C"]);
    expect(r.warnings).toEqual([]);
    // Listed explicitly, still not drawn.
    expect(render([ds], spec({}, ["WTD", "WTD_lo"])).svg).not.toContain("taxonCurves-WTD_lo");
  });

  it("an error column of a variable that is not there: warning, not drawn", () => {
    const lone: Dataset = { ...ds, variables: ds.variables.map((v) => (v.id === "LOI_se" ? { ...v, companion: { errorOf: "nope", role: "se" as const } } : v)) };
    const r = render([lone], spec());
    expect(r.warnings).toContain('"LOI_se" is an error of "nope", which is not in dataset "c"; not drawn.');
    expect(r.svg).not.toContain("taxonCurves-LOI_se");
  });

  it("envelope from lower / upper bounds: one ring per run of bounded samples, a lone sample as a thin band", () => {
    const r = render([ds], spec({ WTD: { axis: { min: 0, max: 40 }, error: { show: "envelope" } } }, ["WTD"]));
    expect(r.warnings).toEqual([]);
    const col = columnSvg(r.svg, "WTD");
    const d = /<g class="error">\s*<path d="([^"]+)"/.exec(col)![1]!;
    // 0.5 mm per cm: upper 13, 24 down, lower 15, 8 back up; then the lone sample at 30 cm (4–7 cm).
    expect(pathXs(d)).toEqual([6.5, 12, 7.5, 4, 3.5, 3.5, 2, 2]);
    expect(d.match(/Z/g)).toHaveLength(2);
    expect(col).toMatch(/<g class="error">\s*<path d="[^"]+" fill="#808080" fill-opacity="0.25"\/>/);
  });

  it("envelope from ± SE; a null value breaks it", () => {
    const r = render([ds], spec({ LOI: { axis: { min: 0, max: 100 }, error: { show: "envelope" } } }, ["LOI"]));
    const d = /<g class="error">\s*<path d="([^"]+)"/.exec(columnSvg(r.svg, "LOI"))![1]!;
    // 0.2 mm per %: 90 ± 2 alone; then 80 ± 5 and 85 ± 1.
    expect(pathXs(d)).toEqual([18.4, 18.4, 17.6, 17.6, 17, 17.2, 16.8, 15]);
  });

  it("error bars: a whisker per bounded sample with end caps", () => {
    const r = render([ds], spec({ WTD: { axis: { min: 0, max: 40 }, error: { show: "bars", bars: { cap: 1 } } } }, ["WTD"]));
    const d = /<g class="error">\s*<path d="([^"]+)" fill="none"/.exec(columnSvg(r.svg, "WTD"))![1]!;
    expect(d.match(/M/g)).toHaveLength(9); // 3 samples × (whisker + 2 caps)
    expect(pathXs(d).slice(0, 6)).toEqual([4, 6.5, 4, 4, 6.5, 6.5]);
    const noCaps = render([ds], spec({ WTD: { error: { show: "bars", bars: { cap: 0 } } } }, ["WTD"])).svg;
    expect(/<g class="error">\s*<path d="([^"]+)"/.exec(columnSvg(noCaps, "WTD"))![1]!.match(/M/g)).toHaveLength(3);
  });

  it("the auto range includes the error bounds (WTD 5–20, bounds 4–24 → 0–30)", () => {
    const col = columnSvg(render([ds], spec({}, ["WTD"])).svg, "WTD");
    expect(tickLabels(col)).toEqual(["0", "10", "20", "30"]);
  });

  it("reversed axis: the tick labels run from the largest value on the left", () => {
    const col = columnSvg(render([ds], spec({ WTD: { axis: { reverse: true } } }, ["WTD"])).svg, "WTD");
    expect([...col.matchAll(/<text x="([\d.]+)"[^>]*font-size="[\d.]+" text-anchor="(start|middle|end)">([^<]+)</g)].map((m) => [Number(m[1]), m[3]])).toEqual([
      [0, "30"],
      [6.67, "20"],
      [13.33, "10"],
      [20, "0"],
    ]);
  });

  it("log axis: decade labels; values ≤ 0 on a log axis are reported, as is a log axis without positive values", () => {
    const r = render([ds], spec({ MS: { axis: { scale: "log", width: 30 } } }, ["MS"]));
    expect(r.warnings).toEqual([]);
    const col = columnSvg(r.svg, "MS");
    expect(tickLabels(col)).toEqual(["1", "10", "100", "1000"]);
    // Points at 1, 10, 100, 1000 lie at 0, ⅓, ⅔ and the full width.
    expect([...col.matchAll(/<circle cx="([\d.]+)"/g)].map((m) => Number(m[1]))).toEqual([0, 10, 20, 30]);
    const zero = { ...ds, values: ds.values.map((row, i) => (i === 0 ? row.map((v, j) => (j === 5 ? 0 : v)) : row)) };
    expect(render([zero], spec({ MS: { axis: { scale: "log" } } }, ["MS"])).warnings).toContain('"MS": 1 value(s) ≤ 0 cannot be drawn on a log axis; left out.');
    expect(render([ds], spec({ d13C: { axis: { scale: "log" } } }, ["d13C"])).warnings).toContain('"d13C": a log x axis needs positive values; linear axis used.');
  });

  it("fixed range: values outside it are reported; min ≥ max falls back to automatic", () => {
    expect(render([ds], spec({ WTD: { axis: { min: 0, max: 12 } } }, ["WTD"])).warnings).toContain('"WTD": 2 value(s) outside the x-axis range 0–12 are drawn at the axis end.');
    expect(render([ds], spec({ WTD: { axis: { min: 10, max: 10 } } }, ["WTD"])).warnings).toContain('"WTD": x-axis min 10 is not below max 10; automatic range used.');
  });

  it("column width and tick interval per column", () => {
    const r = render([ds], spec({ LOI: { axis: { width: 30, step: 5 } } }, ["WTD", "LOI"]));
    const [wtd, loi] = r.layout.panels[0]!.columns;
    expect(wtd!.width).toBe(20);
    expect(loi!.width).toBe(30);
    expect(loi!.sizing).toBe("fixed"); // the panel's column-width handle does not move it
    expect(tickLabels(columnSvg(r.svg, "LOI"))).toEqual(["75", "80", "85", "90", "95"]);
  });

  it("x-axis title per column; one title per run of the same family and title", () => {
    const titles = (s: Spec) => [...render([ds], s).svg.matchAll(/<g class="x-title">([\s\S]*?)<\/g>/g)].flatMap((m) => [...m[1]!.matchAll(/>([^<]+)<\/text>/g)].map((t) => t[1]));
    expect(titles(spec({ WTD: { axis: { title: "WTD (cm)" } }, LOI: { axis: { title: "LOI (%)" } } }))).toEqual(["WTD (cm)", "LOI (%)", "SI", "‰"]);
    expect(titles(spec({ WTD: { axis: { title: "" } } }))).toEqual(["%", "SI", "‰"]);
  });

  it("axis options on a common-scale (non-continuous) column are ignored with a warning (the common scale is kept)", () => {
    const counts: Dataset = { ...ds, variables: ds.variables.map((v) => (v.id === "MS" || v.id === "WTD" ? { ...v, kind: "count" as const, unit: "n" } : v)) };
    const common = (cs: Record<string, CurveStyleOverride>) => render([counts], { ...spec(cs, ["WTD", "MS"]), panels: [{ type: "taxonCurves", dataset: "c", variables: { ids: ["WTD", "MS"] } }] });
    const plain = common({});
    const reversed = common({ WTD: { axis: { reverse: true, width: 40 } } });
    expect(reversed.warnings).toContain('"WTD": x-axis range, reverse, log, step and width apply only to columns without a common scale (commonScale false); ignored to keep the common scale.');
    expect(reversed.layout.panels[0]!.columns).toEqual(plain.layout.panels[0]!.columns);
  });

  it("continuous columns have their own x axis even in a common-scale panel (fixed range applies, no warning)", () => {
    const counts: Dataset = { ...ds, variables: ds.variables.map((v) => (v.id === "MS" ? { ...v, kind: "count" as const, unit: "n" } : v)) };
    const r = render([counts], { ...spec({ LOI: { axis: { min: 70, max: 100, step: 10 } } }), panels: [{ type: "taxonCurves", dataset: "c", style: { commonScale: true }, variables: { ids: ["MS", "LOI"] } }] });
    expect(r.warnings).toEqual([]);
    const labels = tickLabels(columnSvg(r.svg, "LOI"));
    expect([labels[0], labels[labels.length - 1]]).toEqual(["70", "100"]); // the axis runs 70–100 (inner labels thinned to fit)
    const col = (id: string) => r.layout.panels[0]!.columns.find((c) => c.id === id)!;
    const [ms, loi] = [col("MS"), col("LOI")];
    expect(ms!.sizing).toBe("scale"); // the count column keeps the common scale
    expect(loi!.sizing).toBe("column");
  });

  it("δ13C (all negative) is drawn on its own extent and never dropped by minMax", () => {
    const r = render([ds], { ...spec({}, ["d13C"]), panels: [{ type: "taxonCurves", dataset: "c", style: { commonScale: false, columnWidth: 20 }, variables: { ids: ["d13C"], minMax: 2 } }] });
    const col = columnSvg(r.svg, "d13C");
    expect(tickLabels(col)).toEqual(["-28", "-27", "-26", "-25"]);
    expect(col).toContain("<circle");
  });
});

describe("golden SVGs: continuous columns", () => {
  const goldens: Record<string, Spec> = {
    "continuous-envelope": spec({
      WTD: { axis: { reverse: true, title: "WTD (cm)" }, error: { show: "envelope" } },
      LOI: { error: { show: "envelope", envelope: { colour: "#4a7ab5", opacity: 0.3 } }, interpolation: "step" },
      MS: { axis: { scale: "log", title: "MS (SI, log)" } },
    }),
    "continuous-bars": spec({
      WTD: { axis: { min: -5, max: 30, step: 10 }, error: { show: "bars", bars: { cap: 1.2 } } },
      LOI: { type: "bars", error: { show: "bars", bars: { colour: "#b00000", cap: 0 } } },
    }),
  };
  it.each(Object.keys(goldens))("%s", async (name) => {
    const r = render([ds], goldens[name]!);
    expect(r.warnings).toEqual([]);
    expect(render([ds], goldens[name]!).svg).toBe(r.svg);
    await expect(r.svg).toMatchFileSnapshot(`./__snapshots__/${name}.svg`);
  });
});

describe("error columns in the data", () => {
  it("setCompanion declares and releases an error column; refuses self, unknown and chained targets", () => {
    const plain: Dataset = { ...ds, variables: ds.variables.map(({ companion: _c, ...v }) => v) };
    const r = setCompanion(plain, "LOI_se", { errorOf: "LOI", role: "se" });
    expect(r.warnings).toEqual([]);
    expect(r.dataset.variables[4]!.companion).toEqual({ errorOf: "LOI", role: "se" });
    expect(plain.variables[4]!.companion).toBeUndefined(); // input not mutated
    expect(setCompanion(r.dataset, "LOI_se", { errorOf: "LOI", role: "se" }).dataset).toBe(r.dataset); // no change
    expect(setCompanion(r.dataset, "LOI_se", undefined).dataset.variables[4]!.companion).toBeUndefined();
    expect(setCompanion(plain, "LOI", { errorOf: "LOI", role: "se" }).warnings).toEqual(["A column cannot be an error of itself."]);
    expect(setCompanion(plain, "LOI", { errorOf: "zzz", role: "se" }).warnings).toEqual(['Unknown variable "zzz".']);
    expect(setCompanion(r.dataset, "MS", { errorOf: "LOI_se", role: "sd" }).warnings).toEqual(['"LOI SE" is itself an error column.']);
    expect(setCompanion(r.dataset, "LOI", { errorOf: "MS", role: "sd" }).warnings).toEqual(["Other columns are errors of this one; release them first."]);
  });

  it("deleting a variable turns its error columns into ordinary columns", () => {
    const r = deleteVariable(ds, "WTD");
    expect(r.dataset.variables.find((v) => v.id === "WTD_lo")!.companion).toBeUndefined();
    expect(r.dataset.variables.find((v) => v.id === "LOI_se")!.companion).toEqual({ errorOf: "LOI", role: "se" });
    expect(r.warnings).toEqual(['"WTD lower", "WTD upper" were error columns of "WTD" and are now drawn as curves.']);
  });

  it("CSV: the error row and the age unit round-trip", () => {
    const dated: Dataset = { ...ds, ageUnit: "cal BP", samples: ds.samples.map((s) => ({ ...s, age: s.depth * 10 })) };
    const csv = exportDelimited(dated);
    expect(csv.split("\n")[0]).toMatch(/^depth,age \(cal BP\),WTD,/);
    expect(csv).toContain("\nerror,,,lower of WTD,upper of WTD,,se of LOI,,\n");
    const back = importDelimited(csv, { name: "c" });
    expect(back.warnings).toEqual([]);
    expect(back.datasets[0]).toEqual(dated);
  });

  it("CSV: a bad error cell is a warning", () => {
    const r = importDelimited("depth,a,b\nerror,,se of nothing\n1,2,3\n", { name: "x" });
    expect(r.warnings).toEqual(['Error row, "b": "se of nothing" is not "<lower|upper|se|sd> of <variable>"; ignored.']);
    expect(r.datasets[0]!.variables[1]!.companion).toBeUndefined();
  });

  it("project bundle keeps companions and the age source", () => {
    const withSource: Dataset = { ...ds, ageSource: "model.txt" };
    const back = parseProject(serializeProject({ spec: spec(), datasets: [withSource] }));
    expect(back.ok && back.value.datasets[0]).toEqual(withSource);
  });
});
