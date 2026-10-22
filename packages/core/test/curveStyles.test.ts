import { describe, expect, it } from "vitest";
import { importDelimited } from "../src/io/delimited.js";
import { parsePreset, parseSpec } from "../src/io/spec.js";
import { coreDefaults } from "../src/model/defaults.js";
import { migratePreset, migrateSpec } from "../src/model/migrate.js";
import { cascadeCurveStyle, resolveCurveStyle } from "../src/model/resolve.js";
import { CURVE_TYPES, CurveStyleSchema, type CurveStyleOverride, type Preset, type Spec } from "../src/model/spec.js";
import type { Dataset } from "../src/model/types.js";
import { render } from "../src/pipeline.js";
import { readRepoFile, readRepoJson } from "./fixtures.js";

function preset(name: string): Preset {
  const r = parsePreset(readRepoJson(`presets/${name}.json`));
  if (!r.ok) throw new Error(r.errors.join("\n"));
  return r.value;
}

function spec(json: unknown): Spec {
  const r = parseSpec(json);
  if (!r.ok) throw new Error(r.errors.join("\n"));
  return r.value;
}

/** Hand-made fixture: irregular depths, a null run in c, small values in d, a presence column p. */
const ds: Dataset = {
  id: "s",
  name: "s",
  depthUnit: "cm",
  samples: [0, 2, 5, 9, 14, 20, 27, 35, 44, 54, 65].map((depth, i) => ({ id: String(i), depth })),
  variables: [
    ...["a", "b", "c", "d", "e"].map((id) => ({ id, name: id, kind: "percent" as const, group: id === "e" ? "h" : "t" })),
    { id: "p", name: "p", kind: "presence" as const, group: "h" },
  ],
  groups: [
    { id: "t", name: "Trees", colour: "#2f6b3a", order: 1 },
    { id: "h", name: "Herbs", colour: "#c9a227", order: 2 },
  ],
  values: [
    [10, 5, 20, 0.2, 0, 1],
    [25, 8, 15, 0.4, 5, 0],
    [40, 12, null, 0, 10, 1],
    [30, 20, null, 1, 15, 1],
    [20, 30, 10, 3, 10, 0],
    [35, 25, 12, 0.3, 5, null],
    [50, 15, 18, 0, 0, 1],
    [45, 10, null, 2, 5, 0],
    [30, 8, 22, 0.8, 10, 0],
    [15, 4, 25, 0.1, 5, 1],
    [5, 2, 20, 0, 0, 1],
  ],
};

const percent = ["a", "b", "c", "d", "e"];

/** taxonCurves panels (one per id list) with a panel curve style, and per-variable styles. */
function curveSpec(curve: CurveStyleOverride, curveStyles: Record<string, CurveStyleOverride> = {}, ids: string[][] = [percent], extra: Partial<Spec> = {}): Spec {
  return spec({
    specVersion: 8,
    page: { width: 120, height: 70 },
    // Curves only: no x-axis titles or group headers between the narrow panels.
    panels: ids.map((list) => ({ type: "taxonCurves", dataset: "s", variables: { ids: list }, style: { curve, xTitle: { show: "none" } } })),
    groupHeaders: { show: false },
    curveStyles,
    ...extra,
  });
}

const goldens: Record<string, Spec> = {
  // Types.
  polygon: curveSpec({ type: "polygon" }, {
    b: { shape: "step" },
    c: { filled: false, outline: { colour: "#aa0000", width: 0.3, dash: "dashed" } },
    d: { fill: { opacity: 0.5 }, outline: { show: false } },
    e: { fill: { colour: "#3a78a8" } },
  }),
  "polygon-patterns": curveSpec({ type: "polygon", fill: { colour: "#000000" } }, {
    a: { fill: { pattern: { type: "hatch", angle: 45, spacing: 1 } } },
    b: { fill: { pattern: { type: "crosshatch", angle: 30, spacing: 1.2 } } },
    c: { fill: { pattern: { type: "dots", angle: 0, spacing: 0.8 } } },
    d: { fill: { pattern: { type: "hatch", angle: 0, spacing: 0.5 } } },
  }),
  line: curveSpec({ type: "line" }, {
    b: { interpolation: "step" },
    c: { line: { dash: "dashed" }, points: { show: true } },
    d: { line: { dash: [0.8, 0.3, 0.2, 0.3], width: 0.3, colour: "#000000" } },
    e: { line: { dash: "dotted" } },
  }),
  linePoints: curveSpec({ type: "linePoints" }, {
    b: { points: { shape: "square", filled: false } },
    c: { points: { shape: "triangle", size: 1.4 } },
    d: { points: { shape: "diamond", colour: "#000000" } },
    e: { points: { shape: "cross" }, interpolation: "step" },
  }),
  points: curveSpec({ type: "points" }, { b: { points: { filled: false } }, c: { points: { size: 2, colour: "#aa0000" } } }),
  bars: curveSpec({ type: "bars" }, {
    b: { barWidth: { mode: "mm", value: 1.5 } },
    c: { barWidth: { mode: "fraction", value: 1 } },
    d: { barWidth: { mode: "fraction", value: 0.5 }, fill: { colour: "#000000", pattern: { type: "hatch", angle: 45, spacing: 0.6 } } },
    e: { outline: { show: false } },
  }),
  presence: curveSpec({ type: "presence" }, {
    b: { presence: { symbol: "plus" } },
    c: { presence: { symbol: "bar", size: 0.6 } },
    d: { presence: { symbol: "square", colour: "#000000" } },
    p: { presence: { symbol: "square", size: 1.5 } },
  }, [percent, ["p"]]),
  none: curveSpec({ type: "none" }, { b: { valueLabels: { show: "all", decimals: 0 } }, c: { type: "polygon" } }, [["a", "b", "c"], ["p"]]),
  // Option families.
  exaggeration: curveSpec({ type: "polygon", exaggeration: { show: true, factor: 5 } }, {
    b: { exaggeration: { style: "line" } },
    c: { exaggeration: { colour: "#aa0000", opacity: 0.6, factor: 2 } },
    d: { type: "bars", exaggeration: { factor: 10 } },
    e: { type: "line", exaggeration: { style: "line", colour: "#000000" } },
  }),
  baseline: curveSpec({ type: "polygon" }, {
    a: { baseline: { show: false } },
    b: { baseline: { colour: "#aa0000", width: 0.3, dash: "dashed" } },
    c: { shape: "step" },
    d: { type: "line", baseline: { colour: "group" } },
  }),
  nulls: spec({
    specVersion: 8,
    page: { width: 120, height: 70 },
    panels: (["gap", "connect"] as const).flatMap((nulls) =>
      (["polygon", "line"] as const).map((type) => ({ type: "taxonCurves", dataset: "s", variables: { ids: ["c"] }, style: { curve: { type, nulls } } })),
    ),
  }),
  plus: curveSpec({ type: "polygon", plus: { show: true } }, { b: { plus: { threshold: 10, size: 2 } }, c: { plus: { show: false } }, d: { type: "bars" } }),
  valueLabels: curveSpec({ type: "polygon" }, {
    a: { valueLabels: { show: "all", decimals: 0 } },
    b: { valueLabels: { show: "aboveThreshold", threshold: 10, format: "{value}%", decimals: 1 } },
    d: { type: "none", valueLabels: { show: "aboveThreshold" } },
  }),
};

describe("curve styles — golden SVG per type and option family", () => {
  it.each(Object.keys(goldens))("%s", async (name) => {
    const r = render([ds], goldens[name]!);
    expect(r.warnings).toEqual([]);
    expect(render([ds], goldens[name]!).svg).toBe(r.svg); // deterministic
    await expect(r.svg).toMatchFileSnapshot(`./__snapshots__/curve-${name}.svg`);
  });

  it("draws what each type asks for", () => {
    const svgOf = (name: string) => render([ds], goldens[name]!).svg;
    const col = (svg: string, id: string) => svg.split(`-taxonCurves-${id}" class="column"`)[1]!.split('class="column"')[0]!;
    expect(col(svgOf("polygon-patterns"), "a")).toMatch(/<pattern id="panel-0-taxonCurves-a-fill" width="1" height="1" patternTransform="rotate\(45,0,0\)" patternUnits="userSpaceOnUse">/);
    expect(col(svgOf("polygon-patterns"), "a")).toContain('fill="url(#panel-0-taxonCurves-a-fill)"');
    expect(col(svgOf("line"), "a")).toMatch(/<g class="curve">\s*<path d="M[^"]+" fill="none" stroke="#2f6b3a"/);
    expect(col(svgOf("line"), "c")).toContain('<g class="points">');
    expect(col(svgOf("line"), "a")).not.toContain('<g class="points">');
    expect(col(svgOf("line"), "d")).toContain('stroke-dasharray="0.8 0.3 0.2 0.3"');
    expect(col(svgOf("points"), "a")).not.toMatch(/<path d="M[^"]+" fill="none" stroke="#2f6b3a"/); // no line
    expect(col(svgOf("presence"), "a").match(/<circle /g)).toHaveLength(11); // every value > 0
    expect(col(svgOf("none"), "a")).not.toContain('class="curve"');
    expect(col(svgOf("none"), "b")).toContain('class="value-labels"');
    expect(col(svgOf("exaggeration"), "b")).toMatch(/<g class="exaggeration">\s*<path [^>]*fill="none" stroke="#2f6b3a" stroke-width="0.1" stroke-opacity="0.35"/);
    expect(col(svgOf("baseline"), "a")).not.toMatch(/<line x1="0" y1="0" x2="0"/);
    expect(col(svgOf("valueLabels"), "b")).toContain(">25.0%</text>");
    expect(col(svgOf("valueLabels"), "b")).not.toContain(">8.0%</text>");
  });

  it("fraction bars are centred, never overlap and stay inside the plot", () => {
    const svg = render([ds], goldens.bars!).svg;
    const c = svg.split("-taxonCurves-c\" class=\"column\"")[1]!.split('class="column"')[0]!;
    const bars = [...c.matchAll(/<rect x="0" y="([^"]+)" width="[^"]+" height="([^"]+)"/g)].map((m) => [Number(m[1]), Number(m[1]) + Number(m[2])]);
    expect(bars.length).toBeGreaterThan(5);
    bars.slice(1).forEach(([top], i) => expect(top).toBeGreaterThanOrEqual(bars[i]![1]! - 0.011));
    expect(bars[0]![0]).toBeGreaterThanOrEqual(0);
  });
});

describe("curve styles — mixed example", () => {
  const load = () => {
    const s = spec(readRepoFile("examples/curve-styles.spec.json"));
    const imported = importDelimited(readRepoFile("examples/curve-styles.csv"), { name: "curve-styles" });
    return { imported, r: render(imported.datasets, s) };
  };

  it("renders without warnings, deterministically, and matches its golden SVG", async () => {
    const { imported, r } = load();
    expect(imported.warnings).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(load().r.svg).toBe(r.svg);
    await expect(r.svg).toMatchFileSnapshot("./__snapshots__/curve-styles.svg");
    expect(readRepoFile("examples/curve-styles.csv")).toMatch(/^# SYNTHETIC DATA/);
  });

  it("has polygons, a hatched polygon, line + points, bars in mm and as a fraction, presence marks and a line exaggeration", () => {
    const { svg } = load().r;
    const col = (id: string) => svg.split(`-taxonCurves-${id}" class="column"`)[1]!.split('class="column"')[0]!;
    expect(col("Pinus")).toMatch(/<g class="curve">\s*<path /);
    expect(col("Betula")).toContain("<pattern ");
    expect(col("Alnus")).toContain('<g class="points">');
    expect(col("Poaceae")).toMatch(/<rect x="0" y="[^"]+" width="[^"]+" height="1" /);
    expect(col("Cyperaceae")).toMatch(/<g class="curve">\s*<rect /);
    expect(col("Charcoal")).toMatch(/<g class="presence">\s*<rect /);
    expect(col("Ulmus")).toMatch(/<g class="exaggeration">\s*<path [^>]*fill="none"/);
  });
});

describe("curve style cascade — resolveCurveStyle", () => {
  const pollen = preset("pollen-percent");
  const s = spec({
    specVersion: 8,
    preset: "pollen-percent",
    datasets: [{ dataset: "d", assignments: { Pinus: "trees" } }],
    panels: [{ type: "yAxis" }, { type: "taxonCurves", dataset: "d", style: { curve: { fill: { opacity: 0.8 }, exaggeration: { factor: 5 } } } }],
    groupStyles: { trees: { fill: { colour: "#123456" }, baseline: { dash: "dotted" } } },
    curveStyles: { Pinus: { exaggeration: { style: "line" }, fill: { colour: "#654321" } } },
  });

  it("core defaults → preset → panel → group → variable, deep-merged, with the level of every option", () => {
    const { style, source } = resolveCurveStyle(s, "Pinus", { presets: [pollen] });
    expect(style.type).toBe("polygon");
    if (style.type !== "polygon") throw new Error();
    expect(style.fill).toEqual({ colour: "#654321", opacity: 0.8, pattern: { type: "solid", angle: 45, spacing: 1 } });
    expect(style.exaggeration).toEqual({ show: true, factor: 5, style: "line", colour: "curve", opacity: 0.35 });
    expect(style.baseline.dash).toBe("dotted");
    expect(source).toMatchObject({
      type: "preset",
      "fill.colour": "variable", // the group's colour is overridden
      "fill.opacity": "panel",
      "fill.pattern.type": "default",
      "exaggeration.show": "preset",
      "exaggeration.factor": "panel",
      "exaggeration.style": "variable",
      "exaggeration.opacity": "default",
      "baseline.dash": "group",
      "plus.threshold": "preset",
      nulls: "default",
    });
    // Every option has a source, and nothing else does.
    expect(Object.keys(source).sort()).toEqual(leafKeys(style).sort());
    expect(CurveStyleSchema.parse(style)).toEqual(style);
  });

  it("the group comes from the spec's assignments unless given; other variables skip the group and variable levels", () => {
    expect(resolveCurveStyle(s, "Pinus", { presets: [pollen], group: "herbs" }).source["baseline.dash"]).toBe("default");
    const betula = resolveCurveStyle(s, "Betula", { presets: [pollen] });
    expect(betula.source["fill.colour"]).toBe("default");
    expect(betula.style.type === "polygon" && betula.style.fill.colour).toBe("group");
  });

  it("without a preset the cascade starts at the core defaults", () => {
    const { style, source } = resolveCurveStyle(spec({ specVersion: 8, panels: [{ type: "taxonCurves", dataset: "d" }] }), "x");
    expect(style).toEqual(coreDefaults.curve.polygon);
    expect(new Set(Object.values(source))).toEqual(new Set(["default"]));
  });

  it("a variable of kind presence is drawn as presence marks unless its type is none", () => {
    const r = resolveCurveStyle(s, "Charcoal", { presets: [pollen], kind: "presence" });
    expect(r.style.type).toBe("presence");
    expect(r.source.type).toBe("kind");
    expect(r.style.exaggeration.factor).toBe(5); // shared options are kept
    const none = spec({ specVersion: 8, panels: [{ type: "taxonCurves", dataset: "d", style: { curve: { type: "none" } } }] });
    expect(resolveCurveStyle(none, "Charcoal", { kind: "presence" }).style.type).toBe("none");
  });

  it("every type resolves to a valid full style", () => {
    for (const type of CURVE_TYPES) {
      const { style, source } = cascadeCurveStyle([["variable", { type }]]);
      expect(CurveStyleSchema.parse(style)).toEqual(style);
      expect(style).toEqual(coreDefaults.curve[type]);
      expect(source.type).toBe("variable");
    }
  });
});

describe("curve style cascade — changing the type", () => {
  const preset: CurveStyleOverride = {
    type: "polygon",
    fill: { colour: "#111111", pattern: { type: "hatch" } },
    outline: { width: 0.3 },
    exaggeration: { show: true, factor: 4 },
    plus: { show: true, threshold: 1 },
    valueLabels: { show: "all" },
  };

  it("discards inherited options the new type does not have, keeps the shared ones (and their sources)", () => {
    const { style, source } = cascadeCurveStyle([["preset", preset], ["variable", { type: "line" }]]);
    expect(style.type).toBe("line");
    expect(style).not.toHaveProperty("fill");
    expect(style).not.toHaveProperty("outline");
    expect(style.exaggeration).toMatchObject({ show: true, factor: 4 });
    expect(style.plus).toMatchObject({ show: true, threshold: 1 });
    expect(style.valueLabels.show).toBe("all");
    expect(source).toMatchObject({ type: "variable", "exaggeration.factor": "preset", "plus.threshold": "preset", "line.colour": "default" });
    expect(Object.keys(source).some((k) => k.startsWith("fill."))).toBe(false);
  });

  it("options both types have survive a switch (fill and outline from polygon to bars, line from line to linePoints)", () => {
    const bars = cascadeCurveStyle([["preset", preset], ["group", { type: "bars" }]]);
    expect(bars.style.type === "bars" && bars.style.fill.colour).toBe("#111111");
    expect(bars.source["outline.width"]).toBe("preset");
    const lp = cascadeCurveStyle([["panel", { type: "line", line: { colour: "#222222" }, points: { show: true } }], ["variable", { type: "linePoints" }]]);
    expect(lp.style.type === "linePoints" && lp.style.line.colour).toBe("#222222");
    expect(lp.style).not.toHaveProperty("points.show"); // linePoints always draws its points
  });

  it("switching away and back again does not bring discarded options back", () => {
    const { style, source } = cascadeCurveStyle([["preset", preset], ["group", { type: "line" }], ["variable", { type: "polygon" }]]);
    expect(style.type === "polygon" && style.fill.colour).toBe("group");
    expect(source["fill.colour"]).toBe("default");
    expect(style.exaggeration.factor).toBe(4);
  });

  it("options a level sets for another type wait until that type is chosen", () => {
    const levels = [["panel", { line: { colour: "#333333" } }], ["variable", undefined]] as const;
    expect(cascadeCurveStyle(levels).style).not.toHaveProperty("line");
    const line = cascadeCurveStyle([...levels, ["variable", { type: "line" }]]);
    expect(line.style.type === "line" && line.style.line.colour).toBe("#333333");
    expect(line.source["line.colour"]).toBe("panel");
  });
});

describe("changing a curve's type never changes the x-scale or the column widths", () => {
  const layoutOf = (type: (typeof CURVE_TYPES)[number], page = 120) => {
    const s = curveSpec({ type, plus: { show: true, threshold: 2 }, valueLabels: { show: "aboveThreshold", threshold: 30, decimals: 0 } }, {}, [percent, ["p"]], {
      page: { width: page, height: 70 },
    });
    const { layout, info } = render([ds], s);
    return { xScale: layout.xScale, slack: layout.slack, panels: layout.panels.map((p) => ({ box: p.box, columns: p.columns })), info };
  };

  it.each([120, 45])("page width %i mm (natural and fitted)", (page) => {
    const base = layoutOf("polygon", page);
    if (page === 45) expect(base.info.length).toBeGreaterThan(0); // fitting is active
    for (const type of CURVE_TYPES) expect(layoutOf(type, page), type).toEqual(base);
  });

  it("per-variable type changes leave every column where it was", () => {
    const widths = (curveStyles: Record<string, CurveStyleOverride>) => render([ds], curveSpec({ type: "polygon" }, curveStyles)).layout.panels[0]!.columns;
    const base = widths({});
    expect(widths({ a: { type: "bars" }, b: { type: "points" }, c: { type: "none" }, d: { type: "presence" }, e: { type: "linePoints" } })).toEqual(base);
  });
});

describe("v7 → v8 migration of panel modes and per-variable overrides", () => {
  const v7 = {
    specVersion: 7,
    panels: [
      { type: "yAxis" },
      {
        type: "taxonCurves",
        dataset: "d",
        style: { mode: "silhouette", fill: "group", exaggeration: 10, plusBelow: 0.5, commonScale: true, minWidth: 4, xTitle: { show: "panel" } },
        overrides: { Pinus: { exaggeration: 0, minWidth: 2 }, Poaceae: { mode: "bars", fill: "#c9a227" }, Alnus: { mode: "linePoints", fill: "#000000" } },
      },
      { type: "taxonCurves", dataset: "m", style: { mode: "line", presence: "bar", plusBelow: 0 } },
    ],
  };

  it("moves the curve keys into style.curve and curveStyles, keeping only what was set", () => {
    expect(migrateSpec(v7)).toEqual({
      specVersion: 8,
      panels: [
        { type: "yAxis" },
        {
          type: "taxonCurves",
          dataset: "d",
          style: {
            commonScale: true,
            minWidth: 4,
            xTitle: { show: "panel" },
            curve: {
              type: "polygon",
              fill: { colour: "group" },
              presence: { colour: "group" },
              exaggeration: { show: true, factor: 10 },
              plus: { show: true, threshold: 0.5 },
            },
          },
          overrides: { Pinus: { minWidth: 2 } },
        },
        { type: "taxonCurves", dataset: "m", style: { curve: { type: "line", plus: { show: false }, presence: { symbol: "bar", size: 0.6 } } } },
      ],
      curveStyles: {
        Pinus: { exaggeration: { show: false } },
        Poaceae: { type: "bars", fill: { colour: "#c9a227" }, presence: { colour: "#c9a227" } },
        Alnus: { type: "linePoints", line: { colour: "#000000" }, points: { colour: "#000000" }, presence: { colour: "#000000" } },
      },
    });
    expect(parseSpec(v7).ok).toBe(true);
    expect(v7.panels[1]).toHaveProperty("overrides.Pinus.exaggeration", 0); // input not mutated
  });

  it("drops emptied overrides and keeps invalid old values for validation to report", () => {
    const out = migrateSpec({ specVersion: 7, panels: [{ type: "taxonCurves", dataset: "d", style: { mode: "wiggly" }, overrides: { a: { exaggeration: 0 } } }] });
    expect(out).toMatchObject({ panels: [{ style: { mode: "wiggly" } }], curveStyles: { a: { exaggeration: { show: false } } } });
    expect((out as { panels: object[] }).panels[0]).not.toHaveProperty("overrides");
    const r = parseSpec(out);
    expect(!r.ok && r.errors[0]).toMatch(/^panels\[0\]\.style: .*mode/);
  });

  it("renders a migrated v7 diagram exactly like the v8 one", () => {
    const old = render([ds], spec({ specVersion: 7, panels: [{ type: "taxonCurves", dataset: "s", style: { mode: "bars", exaggeration: 5, plusBelow: 2 }, overrides: { a: { mode: "silhouette" } } }] }));
    const v8 = render([ds], spec({ specVersion: 8, panels: [{ type: "taxonCurves", dataset: "s", style: { curve: { type: "bars", exaggeration: { show: true, factor: 5 }, plus: { show: true, threshold: 2 } } } }], curveStyles: { a: { type: "polygon" } } }));
    expect(old.svg.replace(/<metadata[^<]*<\/metadata>/, "")).toBe(v8.svg.replace(/<metadata[^<]*<\/metadata>/, ""));
  });

  it("v1 presets migrate the same way; the bundled presets are v2", () => {
    const v1 = { presetVersion: 1, name: "p", panelDefaults: { taxonCurves: { mode: "bars", fill: "#7d5a3c", exaggeration: 0, minWidth: 4 } } };
    expect(migratePreset(v1)).toEqual({
      presetVersion: 2,
      name: "p",
      panelDefaults: { taxonCurves: { minWidth: 4, curve: { type: "bars", fill: { colour: "#7d5a3c" }, presence: { colour: "#7d5a3c" }, exaggeration: { show: false } } } },
    });
    expect(parsePreset(v1).ok).toBe(true);
    for (const name of ["pollen-percent", "testate-percent", "diatom-percent", "macrofossil-counts"]) {
      expect(readRepoJson(`presets/${name}.json`)).toHaveProperty("presetVersion", 2);
    }
  });
});

describe("the spec stores only the user's overrides", () => {
  it("resolving and rendering never write resolved defaults into the spec", () => {
    const s = curveSpec({ type: "bars" }, { a: { fill: { colour: "#000000" } } });
    const before = JSON.stringify(s);
    render([ds], s);
    resolveCurveStyle(s, "a");
    expect(JSON.stringify(s)).toBe(before);
    expect(s.curveStyles).toEqual({ a: { fill: { colour: "#000000" } } });
  });

  it("unknown variables and groups in curveStyles / groupStyles warn", () => {
    const r = render([ds], curveSpec({}, { zz: { type: "bars" } }, [percent], { groupStyles: { nope: { type: "line" }, t: { type: "line" } } }));
    expect(r.warnings).toEqual(['curveStyles: "zz" is not a variable of any dataset.', 'groupStyles: "nope" is not a group of any dataset.']);
  });
});

/** Leaf paths of a plain object ("fill.pattern.type"); arrays are leaves. */
function leafKeys(value: object, prefix = ""): string[] {
  return Object.entries(value).flatMap(([k, v]) =>
    typeof v === "object" && v !== null && !Array.isArray(v) ? leafKeys(v as object, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}
