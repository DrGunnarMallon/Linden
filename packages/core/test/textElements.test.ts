import { describe, expect, it } from "vitest";
import { TEXT_ASCENT } from "../src/layout/header.js";
import { estimateTextWidth, makeTheme, PT_TO_MM } from "../src/layout/theme.js";
import { layoutTitle, SUBTITLE_RATIO, TITLE_GAP } from "../src/layout/title.js";
import { coreDefaults, type ResolvedTaxonCurvesStyle } from "../src/model/defaults.js";
import { resolveSpec } from "../src/model/resolve.js";
import type { Spec } from "../src/model/spec.js";
import type { Dataset, Variable } from "../src/model/types.js";
import { autoTickStep, columnTicks, defaultXTitle, type TaxonColumn, type Tick } from "../src/panels/taxonCurves.js";
import { render } from "../src/pipeline.js";
import { outsidePage, svgBounds } from "./svgBounds.js";

const theme = makeTheme(coreDefaults.page);

/** Two percent taxa and one count taxon at four depths. */
const ds = (over: Partial<Dataset> = {}): Dataset => ({
  id: "d",
  name: "d",
  depthUnit: "cm",
  samples: [10, 20, 30, 40].map((depth, i) => ({ id: String(depth), depth, age: 1000 + i * 500 })),
  variables: [
    { id: "A", name: "*Alnus*", kind: "percent", unit: "%" },
    { id: "B", name: "*Betula*", kind: "percent", unit: "%" },
    { id: "S", name: "Seeds", kind: "count", unit: "n/20 cm³" },
  ],
  groups: [],
  values: [
    [40, 5, 2],
    [20, 10, 1],
    [10, 0, 0],
    [5, 2, 3],
  ],
  ...over,
});

const percentPanel = (style: object = {}) => ({ type: "taxonCurves" as const, dataset: "d", variables: { kinds: ["percent" as const] }, style });
const yTitles = (svg: string) => [...svg.matchAll(/<text [^>]*rotate\(-90[^>]*>([^<]+)<\/text>/g)].map((m) => m[1]);
const xTitles = (svg: string) => [...svg.matchAll(/<g class="x-title">([\s\S]*?)<\/g>/g)].flatMap((m) => [...m[1]!.matchAll(/>([^<]+)<\/text>/g)].map((t) => t[1]));
const translateOf = (svg: string, id: string) => {
  const m = new RegExp(`id="${id}" transform="translate\\(([^,]+),([^)]+)\\)"`).exec(svg)!;
  return { x: Number(m[1]), y: Number(m[2]) };
};
const axisLength = (svg: string) => Number(/class="axis-primary"[\s\S]*?<line x1="[^"]+" y1="0" x2="[^"]+" y2="([^"]+)"/.exec(svg)![1]);

describe("axis titles — defaults from the dataset units, editable in the spec", () => {
  it("y axes: Depth (unit) and Age (unit) by default", () => {
    const spec: Spec = { specVersion: 6, yAxis: { secondary: "age" }, panels: [{ type: "yAxis" }] };
    expect(yTitles(render([ds({ ageUnit: "cal BP" })], spec).svg)).toEqual(["Depth (cm)", "Age (cal BP)"]);
    expect(yTitles(render([ds({ depthUnit: "m" })], spec).svg)).toEqual(["Depth (m)", "Age"]);
  });

  it("y axes: titles from yAxis.titles; an empty title is not drawn and frees its width", () => {
    const spec = (titles: object): Spec => ({ specVersion: 6, yAxis: { secondary: "age", titles }, panels: [{ type: "yAxis" }, percentPanel()] });
    const custom = render([ds()], spec({ depth: "Depth below surface (cm)", age: "Age (cal a BP)" }));
    expect(yTitles(custom.svg)).toEqual(["Depth below surface (cm)", "Age (cal a BP)"]);
    const none = render([ds()], spec({ depth: "" }));
    expect(yTitles(none.svg)).toEqual(["Age"]);
    // The depth title's column (1 em + 1 mm) is gone, so the curves start further left.
    const shift = translateOf(custom.svg, "panel-1-taxonCurves").x - translateOf(none.svg, "panel-1-taxonCurves").x;
    expect(shift).toBeCloseTo(theme.fontSize + 1, 1);
  });

  it("y-axis titles sit clear of the tick labels", () => {
    const { svg } = render([ds()], { specVersion: 6, panels: [{ type: "yAxis" }] });
    const boxes = svgBounds(svg).boxes.filter((b) => b.tag === "text" && b.where === "panel-0-yAxis");
    const [title, ...ticks] = boxes;
    for (const t of ticks) expect(t.x0).toBeGreaterThan(title!.x1 + 0.5);
  });

  it("y-axis title longer than its axis is reported", () => {
    const spec: Spec = { specVersion: 6, page: { height: 40 }, yAxis: { titles: { depth: "A very long depth axis title that cannot fit" } }, panels: [{ type: "yAxis" }] };
    expect(render([ds()], spec).warnings).toContainEqual(expect.stringMatching(/^y-axis title "A very long .*" is longer than its axis/));
  });

  it("x axes: default text from kind and unit", () => {
    const v = (kind: Variable["kind"], unit?: string) => defaultXTitle(unit === undefined ? { kind } : { kind, unit });
    expect(v("percent", "%")).toBe("%");
    expect(v("percent")).toBe("%");
    expect(v("count", "n/20 cm³")).toBe("Counts (n/20 cm³)");
    expect(v("count")).toBe("Counts");
    expect(v("concentration", "grains/cm³")).toBe("Concentration (grains/cm³)");
    expect(v("abundanceClass")).toBe("Abundance class");
    expect(v("presence")).toBe("Presence");
    expect(v("volumePercent")).toBe("Volume (%)");
    expect(v("continuous", "°C")).toBe("°C");
  });

  it("x axes: once per panel, under every column, custom text or none", () => {
    const at = (xTitle: object) => render([ds()], { specVersion: 6, panels: [percentPanel({ xTitle })] });
    expect(xTitles(at({}).svg)).toEqual(["%"]);
    expect(xTitles(at({ text: "% of TLP" }).svg)).toEqual(["% of TLP"]);
    expect(xTitles(at({ show: "column" }).svg)).toEqual(["%", "%"]);
    expect(xTitles(at({ show: "none" }).svg)).toEqual([]);
    expect(xTitles(at({ text: "" }).svg)).toEqual([]);
    // No title line → the footer is one line (1 em of the labels font) shorter, the plot taller.
    const withAxis = (xTitle: object) => render([ds()], { specVersion: 6, panels: [{ type: "yAxis" }, percentPanel({ xTitle })] }).svg;
    expect(axisLength(withAxis({ show: "none" })) - axisLength(withAxis({}))).toBeCloseTo(theme.fontSize, 1);
  });

  it("x axes: column titles that would overlap are skipped, with a warning", () => {
    const r = render([ds()], { specVersion: 6, panels: [percentPanel({ xTitle: { text: "Percentage of total land pollen", show: "column" } })] });
    expect(xTitles(r.svg)).toEqual(["Percentage of total land pollen"]);
    expect(r.warnings).toEqual([
      'taxonCurves (panel-0-taxonCurves): 1 x-axis title(s) omitted where the columns are too narrow; use xTitle.show "panel" or a shorter xTitle.text.',
    ]);
  });

  it("x-axis titles are reserved in the footer and stay on the page", () => {
    const r = render([ds()], { specVersion: 6, page: { width: 60, height: 60 }, panels: [{ type: "yAxis" }, percentPanel({ xTitle: { text: "Percentage of total land pollen" } })] });
    expect(outsidePage(r.svg)).toEqual([]);
    const title = svgBounds(r.svg).boxes.find((b) => b.cls === "x-title")!;
    const ticks = svgBounds(r.svg).boxes.filter((b) => b.tag === "text" && b.cls === "x-axis");
    for (const t of ticks) expect(title.y0).toBeGreaterThanOrEqual(t.y1);
  });
});

describe("x-axis tick labels", () => {
  const style = (over: Partial<ResolvedTaxonCurvesStyle["xTicks"]> = {}): ResolvedTaxonCurvesStyle => ({
    ...coreDefaults.taxonCurves,
    xTicks: { ...coreDefaults.taxonCurves.xTicks, ...over },
  });
  const column = (width: number, scale: number, s = style(), variable: Variable = { id: "A", name: "A", kind: "percent", unit: "%" }): TaxonColumn => ({
    index: 0,
    variable,
    style: s,
    max: width / scale,
    x: 0,
    width,
    scale,
    key: "percent|%",
  });
  const labels = (ticks: Tick[]) => ticks.filter((t) => t.label).map((t) => t.text);
  const extent = (t: Tick, col: TaxonColumn) => {
    const x = t.value * col.scale + (t.shift ?? 0);
    const w = estimateTextWidth(t.text, theme.tickFontSize);
    return t.anchor === "start" ? [x, x + w] : t.anchor === "end" ? [x - w, x] : [x - w / 2, x + w / 2];
  };
  const noOverlap = (ticks: Tick[], col: TaxonColumn) => {
    const boxes = ticks.filter((t) => t.label).map((t) => extent(t, col));
    boxes.slice(1).forEach((b, i) => expect(b[0]!).toBeGreaterThanOrEqual(boxes[i]![1]! + theme.tickLabelPad - 1e-9));
  };

  it("automatic interval from the column width: 0, 20, 40 at 0.4 mm/%", () => {
    const col = column(20, 0.4);
    expect(labels(columnTicks(col, 1, theme.tickFontSize, theme.tickLabelPad))).toEqual(["0", "20", "40"]);
  });

  it("a narrow column keeps a single label; a forced dense step never overlaps", () => {
    expect(labels(columnTicks(column(2, 0.1), 0.3, theme.tickFontSize, theme.tickLabelPad))).toEqual(["0"]);
    const dense = column(8, 0.4, style({ step: 2 }));
    const ticks = columnTicks(dense, 1, theme.tickFontSize, theme.tickLabelPad);
    expect(ticks).toHaveLength(11); // every tick drawn …
    expect(labels(ticks).length).toBeLessThan(5); // … but only labels that fit
    noOverlap(ticks, dense);
  });

  it("a previous column's label pushes out even the next column's 0", () => {
    const col = column(4, 0.4);
    const after = estimateTextWidth("0", theme.tickFontSize) / 2 - 0.1; // right end of the neighbour's last label
    expect(labels(columnTicks(col, 1, theme.tickFontSize, theme.tickLabelPad, after))).toEqual([]);
  });

  it("counts and abundance classes get integer steps", () => {
    expect(autoTickStep(10, 6)).toBe(1);
    expect(autoTickStep(20, 6)).toBe(0.5);
    expect(autoTickStep(20, 6, true)).toBe(1);
    // 20 mm per count: 0.5 would be ≥ 6 mm, but counts step by whole numbers.
    const counts = column(70, 20, style(), { id: "S", name: "S", kind: "count" });
    expect(labels(columnTicks(counts, 1, theme.tickFontSize, theme.tickLabelPad))).toEqual(["0", "1", "2", "3"]);
  });

  it("abundance classes are labelled with the scale's codes", () => {
    const scaleLabels = ["-", "R", "O", "F", "A", "D"].map((label, value) => ({ value, label }));
    const col = { ...column(15, 3, { ...style(), commonScale: false }, { id: "M", name: "M", kind: "abundanceClass", scaleLabels }), key: "abundanceClass|" };
    expect(labels(columnTicks(col, 1, theme.tickFontSize, theme.tickLabelPad))).toEqual(["-", "R", "O", "F", "A", "D"]);
  });

  it("unit suffix on the last label (the number stays on its tick), dropped where it does not fit", () => {
    const col = column(20, 0.4, style({ unitSuffix: true }));
    const ticks = columnTicks(col, 1, theme.tickFontSize, theme.tickLabelPad);
    expect(labels(ticks)).toEqual(["0", "20", "40%"]);
    const last = ticks.find((t) => t.text === "40%")!;
    expect(last.anchor).toBe("start");
    expect(extent(last, col)[0]).toBeCloseTo(16 - estimateTextWidth("40", theme.tickFontSize) / 2, 6);
    noOverlap(ticks, col);
    // Counts: unit after a space. No room right of a crowded column: no suffix rather than an overlap.
    const counts = { ...column(15, 0.75, { ...style({ unitSuffix: true }), commonScale: false }, { id: "S", name: "S", kind: "count", unit: "n" }), key: "count|n" };
    expect(labels(columnTicks(counts, 1, theme.tickFontSize, theme.tickLabelPad))).toEqual(["0", "10", "20 n"]);
    // "40" does not fit, so the suffix goes on the last label that does.
    const tight = column(16.4, 0.4, style({ unitSuffix: true }));
    expect(labels(columnTicks(tight, 0.3, theme.tickFontSize, theme.tickLabelPad))).toEqual(["0", "20%"]);
    const narrow = column(2, 0.1, style({ unitSuffix: true }));
    expect(labels(columnTicks(narrow, 0.3, theme.tickFontSize, theme.tickLabelPad))).toEqual(["0"]);
  });

  it("whole diagrams on a narrow page: compacted columns never overlap their tick labels, suffix or not", () => {
    const many: Dataset = {
      ...ds(),
      variables: Array.from({ length: 30 }, (_, k) => ({ id: `T${k}`, name: `Taxon ${k}`, kind: "count" as const })),
      values: [10, 20, 30, 40].map((_, i) => Array.from({ length: 30 }, (_, k) => ((i + 1) * (k + 3)) % 17)),
    };
    for (const unitSuffix of [false, true]) {
      const r = render([many], { specVersion: 6, page: { width: 85, height: 80 }, datasets: [{ dataset: "d", transforms: [{ type: "percent" }] }], panels: [{ type: "taxonCurves", dataset: "d", style: { minWidth: 4, xTicks: { unitSuffix } } }] });
      const tickBoxes = svgBounds(r.svg).boxes.filter((b) => b.tag === "text" && b.cls === "x-axis").sort((a, b) => a.x0 - b.x0);
      expect(tickBoxes.length).toBeGreaterThan(3);
      tickBoxes.slice(1).forEach((b, i) => expect(b.x0).toBeGreaterThanOrEqual(tickBoxes[i]!.x1 - 1e-6));
      expect(outsidePage(r.svg)).toEqual([]);
    }
  });
});

describe("title band", () => {
  const spec = (over: Partial<Spec> = {}): Spec => ({
    specVersion: 6,
    page: { width: 120, height: 90 },
    yAxis: { secondary: "age" },
    panels: [{ type: "yAxis" }, percentPanel()],
    ...over,
  });

  it("lays out title and subtitle: sizes, baselines, band height", () => {
    const t = layoutTitle({ text: "Lake Linden", subtitle: "Pollen percentages", align: "left", size: 10 }, 100, 7, 0.25);
    const em = 10 * PT_TO_MM;
    expect(t.lines.map((l) => l.class)).toEqual(["title", "subtitle"]);
    expect(t.lines[0]!.size).toBeCloseTo(em, 9);
    expect(t.lines[1]!.size).toBeCloseTo(em * SUBTITLE_RATIO, 9);
    expect(t.lines[0]!.baseline).toBeCloseTo(TEXT_ASCENT * em, 9);
    expect(t.height).toBeCloseTo(em + 1.3 * em * SUBTITLE_RATIO + TITLE_GAP, 9);
    expect(layoutTitle(undefined, 100, 7, 0.25).height).toBe(0);
  });

  it("reserves its height above the header band: panels move down, the plot gets shorter, widths stay", () => {
    const plain = render([ds()], spec());
    const titled = render([ds()], spec({ title: { text: "Lake *Linden*", subtitle: "Synthetic test data" } }));
    const band = layoutTitle(resolveSpec(spec({ title: { text: "Lake *Linden*", subtitle: "Synthetic test data" } })).spec.title, 110, 7, 0.25).height;
    expect(titled.warnings).toEqual(plain.warnings);
    expect(titled.info).toEqual(plain.info);
    const [p0, p1] = [translateOf(plain.svg, "panel-1-taxonCurves"), translateOf(titled.svg, "panel-1-taxonCurves")];
    expect(p1.x).toBe(p0.x);
    expect(p1.y - p0.y).toBeCloseTo(band, 1);
    expect(axisLength(plain.svg) - axisLength(titled.svg)).toBeCloseTo(band, 1);
    expect(outsidePage(titled.svg)).toEqual([]);
    expect(titled.svg).toContain('<tspan font-style="italic">Linden</tspan>');
    // The title's ink ends above everything else drawn.
    const boxes = svgBounds(titled.svg).boxes.filter((b) => b.where !== "background");
    const title = boxes.filter((b) => b.where === "title");
    const rest = boxes.filter((b) => b.where !== "title");
    expect(title).toHaveLength(2);
    expect(Math.max(...title.map((b) => b.y1))).toBeLessThan(Math.min(...rest.map((b) => b.y0)));
  });

  it("left-aligned with the first panel, or centred over the panels", () => {
    const left = render([ds()], spec({ title: { text: "Lake Linden" } })).svg;
    expect(left).toMatch(new RegExp(`<text class="title" x="${translateOf(left, "panel-0-yAxis").x}" `));
    const centred = render([ds()], spec({ title: { text: "Lake Linden", align: "centre" } })).svg;
    const box = svgBounds(centred).boxes.find((b) => b.cls === "title")!;
    const p0 = translateOf(centred, "panel-0-yAxis").x;
    const p1 = svgBounds(centred).boxes.filter((b) => b.where.startsWith("panel-1") && b.tag === "line").reduce((m, b) => Math.max(m, b.x1), 0);
    expect((box.x0 + box.x1) / 2).toBeCloseTo((p0 + p1) / 2, 0);
  });

  it("title size from style.fonts.title, overridden by title.size", () => {
    const size = (s: Spec) => Number(/class="title" [^>]*font-size="([^"]+)"/.exec(render([ds()], s).svg)![1]);
    expect(size(spec({ title: { text: "T" } }))).toBeCloseTo(10 * PT_TO_MM, 1); // page font 7 pt + 3
    expect(size(spec({ title: { text: "T" }, style: { fonts: { title: { size: 12 } } } }))).toBeCloseTo(12 * PT_TO_MM, 1);
    expect(size(spec({ title: { text: "T", size: 9 }, style: { fonts: { title: { size: 12 } } } }))).toBeCloseTo(9 * PT_TO_MM, 1);
  });

  it("fitting: too wide → smaller title (info), down to the labels size; then a warning", () => {
    const long = "Pollen percentage diagram of Lake Linden";
    // 66 mm wide at 10 pt, 46 mm at 7 pt; 60 mm between the margins of a 70 mm page.
    const shrunk = render([ds()], spec({ page: { width: 70, height: 90 }, title: { text: long } }));
    expect(shrunk.info).toContainEqual(expect.stringMatching(/^Title font reduced from 10 to \d+(\.\d+)? pt to fit the page width\.$/));
    expect(shrunk.warnings.filter((w) => w.startsWith("Title"))).toEqual([]);
    expect(outsidePage(shrunk.svg)).toEqual([]);
    const tooLong = render([ds()], spec({ page: { width: 70, height: 90 }, title: { text: `${long}, core LIN-1, 0–40 cm, synthetic` } }));
    expect(tooLong.info).toContain("Title font reduced from 10 to 7 pt to fit the page width.");
    expect(tooLong.warnings).toContain("Title is 81.3 mm wide at 7 pt but the page has 60 mm between the margins; shorten the title or subtitle.");
  });

  it("fitting: the band's height comes out of the plot; a plot squeezed below 10 mm is reported", () => {
    const r = render([ds()], spec({ page: { width: 120, height: 30 }, title: { text: "Lake Linden", subtitle: "Pollen" } }));
    expect(r.warnings).toContainEqual(expect.stringMatching(/^Plot area is only -?\d+(\.\d)? mm high; using 10 mm/));
  });
});

describe("figure style", () => {
  const spec = (style: Spec["style"]): Spec => ({ specVersion: 6, style, panels: [{ type: "yAxis" }, percentPanel()] });

  it("white background by default; null = transparent", () => {
    expect(render([ds()], spec(undefined)).svg).toContain('<rect id="background" x="0" y="0" width="180" height="240" fill="#ffffff"/>');
    expect(render([ds()], spec({ background: "#fafaf0" })).svg).toContain('fill="#fafaf0"');
    expect(render([ds()], spec({ background: null })).svg).not.toContain('id="background"');
  });

  it("fonts default from page.font: labels = page font, ticks 0.85 ×, title +3 pt", () => {
    const r = resolveSpec({ specVersion: 6, page: { font: { family: "Helvetica", size: 8 } }, panels: [] }).spec.style;
    expect(r.fonts).toEqual({ title: { family: "Helvetica", size: 11 }, labels: { family: "Helvetica", size: 8 }, ticks: { family: "Helvetica", size: 6.8 } });
  });

  it("fonts, line widths, tick length and colours reach the SVG", () => {
    const { svg } = render(
      [ds()],
      spec({
        fonts: { labels: { family: "Times", size: 8 }, ticks: { family: "Courier", size: 5 } },
        lineWidths: { axis: 0.3, curve: 0.05 },
        tickLength: 2,
        colours: { axis: "#444444", text: "#222222" },
      }),
    );
    expect(svg).toContain(`<g fill="#222222" font-family="Times" font-size="${(8 * PT_TO_MM).toFixed(2)}">`);
    expect(svg).toMatch(/<text x="[^"]+" y="[^"]+" font-family="Courier" font-size="1.76"/);
    expect(svg).toMatch(/stroke="#444444" stroke-width="0.3"/);
    expect(svg).toMatch(/stroke="#000000" stroke-width="0.05"/); // curve outline keeps its own colour
    expect(svg).not.toMatch(/stroke="#000000" stroke-width="0.15"/);
    // Tick length 2 mm on the y axis: the tick runs from w − 2 to w.
    const [, x1, , x2] = /class="axis-primary"[\s\S]*?<line x1="([^"]+)" y1="([^"]+)" x2="([^"]+)" y2="\2"/.exec(svg)!;
    expect(Number(x2) - Number(x1)).toBeCloseTo(2, 2);
  });
});
