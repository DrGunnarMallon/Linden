import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { importDelimited } from "../src/io/delimited.js";
import { loadPresets } from "../src/io/presets.js";
import { parseSpec } from "../src/io/spec.js";
import type { Spec } from "../src/model/spec.js";
import type { Dataset, TransformContext } from "../src/model/types.js";
import { prepareDatasets, render } from "../src/pipeline.js";
import { scaleMapTransform } from "../src/transforms/scaleMap.js";
import { readRepoFile } from "./fixtures.js";

const presetFiles = readdirSync(new URL("../../../presets/", import.meta.url))
  .filter((f) => f.endsWith(".json"))
  .map((file) => ({ file, text: readRepoFile(`presets/${file}`) }));
const { presets } = loadPresets(presetFiles);

describe("importer: comments, unit row, text codes", () => {
  const csv = [
    "# SYNTHETIC — a comment, with commas; and semicolons",
    "# second comment line",
    "depth,Seeds,Moss,Charcoal",
    "kind,count,abundanceClass,presence",
    "unit,n/20 cm³,,",
    "10,3,D,+",
    "20,0,R,-",
    "30,,F,",
  ].join("\n");
  const { datasets, warnings } = importDelimited(csv, { name: "m" });
  const ds = datasets[0]!;

  it("skips leading # lines, reads units, keeps ordinal text codes as indices", () => {
    expect(warnings).toEqual([]);
    expect(ds.variables).toEqual([
      { id: "Seeds", name: "Seeds", kind: "count", unit: "n/20 cm³" },
      { id: "Moss", name: "Moss", kind: "abundanceClass", codes: ["D", "R", "F"] },
      { id: "Charcoal", name: "Charcoal", kind: "presence", codes: ["+", "-"] },
    ]);
    expect(ds.values).toEqual([
      [3, 0, 0],
      [0, 1, 1],
      [null, 2, null],
    ]);
  });

  it("non-ordinal kinds still reject text", () => {
    const r = importDelimited("depth,a\nkind,count\n1,x\n", { name: "x" });
    expect(r.warnings).toEqual(['Row 3, "a": "x" is not a number; treated as empty.']);
    expect(r.datasets[0]!.variables[0]!.codes).toBeUndefined();
  });
});

function scaleMap(ds: Dataset, params: Record<string, unknown>, scales: TransformContext["scales"] = {}) {
  const warnings: string[] = [];
  const out = scaleMapTransform.apply(ds, { type: "scaleMap", ...params }, { sums: {}, scales, warn: (m) => warnings.push(m) });
  return { out, warnings };
}

describe("scaleMap transform", () => {
  const dafor = { "-": 0, R: 1, O: 2, F: 3, A: 4, D: 5 };
  const classes = { "0": 0, "1": 1, "2": 2, "3": 3, "4": 4, "5": 5 };
  const presence = { "-": 0, "+": 1 };
  const ds: Dataset = {
    id: "m",
    name: "m",
    depthUnit: "cm",
    samples: [10, 20, 30].map((depth) => ({ id: String(depth), depth })),
    variables: [
      { id: "Moss", name: "Moss", kind: "abundanceClass", codes: ["D", "R", "F"] },
      { id: "Leaves", name: "Leaves", kind: "abundanceClass" },
      { id: "Charcoal", name: "Charcoal", kind: "presence", codes: ["+", "-"] },
      { id: "Seeds", name: "Seeds", kind: "count" },
    ],
    groups: [],
    values: [
      [0, 4, 0, 3],
      [1, 0, 1, 0],
      [2, null, null, 7],
    ],
  };

  it("maps each variable with the first listed scale that covers its codes; counts untouched", () => {
    const { out, warnings } = scaleMap(ds, { scale: ["classes", "dafor", "presence"] }, { classes, dafor, presence });
    expect(warnings).toEqual([]);
    expect(out.values).toEqual([
      [5, 4, 1, 3],
      [1, 0, 0, 0],
      [3, null, null, 7],
    ]);
    expect(out.variables[0]).toEqual({
      id: "Moss",
      name: "Moss",
      kind: "abundanceClass",
      scaleLabels: ["-", "R", "O", "F", "A", "D"].map((label, value) => ({ value, label })),
    });
    expect(out.variables[1]!.scaleLabels!.map((l) => l.label)).toEqual(["0", "1", "2", "3", "4", "5"]);
    expect(out.variables[2]!.codes).toBeUndefined();
    expect(out.variables[3]).toBe(ds.variables[3]);
  });

  it("inline map; unmapped codes become null with a warning, numeric 0 stays 0", () => {
    const { out, warnings } = scaleMap(ds, { map: { "4": 2.5, D: 1, R: 0.5 }, kinds: ["abundanceClass"] });
    expect(out.values.map((r) => r.slice(0, 2))).toEqual([
      [1, 2.5],
      [0.5, 0],
      [null, null],
    ]);
    expect(warnings).toEqual(['scaleMap: "Moss" has values not in the scale (F); set to null.']);
  });

  it("parameter problems are warnings, never throws", () => {
    expect(scaleMap(ds, { scale: "nope" }).warnings).toEqual(['scaleMap: scale "nope" is not defined.', "scaleMap: no usable scale; transform skipped."]);
    expect(scaleMap(ds, {}).warnings).toEqual(['scaleMap: give exactly one of "scale" (a named scale) or "map"; transform skipped.']);
    expect(scaleMap(ds, { map: {}, variables: ["Zz"] }).warnings).toEqual(['scaleMap: variable "Zz" not found in dataset "m".']);
  });

  it("unmapped text codes reaching a panel warn and leave the column empty", () => {
    const { warnings, svg } = render([ds], { specVersion: 4, panels: [{ type: "taxonCurves", dataset: "m", variables: { ids: ["Moss"] } }] });
    expect(warnings).toEqual(['"Moss" has text codes (D, R, F) but no scaleMap transform maps them; column left empty.']);
    expect(svg).not.toContain("<rect");
  });
});

/** Small dataset: two count taxa, one presence taxon, one percent taxon. */
const mixed: Dataset = {
  id: "x",
  name: "x",
  depthUnit: "cm",
  samples: [10, 20, 30, 40].map((depth) => ({ id: String(depth), depth })),
  variables: [
    { id: "SeedsA", name: "Seeds A", kind: "count", unit: "n/20 cm³" },
    { id: "SeedsB", name: "Seeds B", kind: "count", unit: "n/20 cm³" },
    { id: "Charcoal", name: "Charcoal", kind: "presence" },
    { id: "Pollen", name: "Pollen", kind: "percent", unit: "%" },
  ],
  groups: [],
  values: [
    [40, 10, 1, 50],
    [20, 5, 0, 25],
    [0, 0, null, 10],
    [10, 2, 1, 5],
  ],
};
const columnsOf = (svg: string) =>
  Object.fromEntries(
    [...svg.matchAll(/id="panel-(\d)-taxonCurves-([^"]+)" class="column"[\s\S]*?<g class="x-axis">\s*<line x1="0" y1="[^"]+" x2="([^"]+)"/g)].map(
      (m) => [m[2], Number(m[3])],
    ),
  );

describe("presence columns", () => {
  it("dot (default) or bar at present samples only; fixed width, no ticks; null and 0 draw nothing", () => {
    const spec = (presence?: "bar") => ({
      specVersion: 4,
      panels: [{ type: "taxonCurves" as const, dataset: "x", variables: { kinds: ["presence" as const] }, style: presence ? { presence } : {} }],
    });
    const dots = render([mixed], spec()).svg;
    expect(dots.match(/<circle /g)).toHaveLength(2);
    expect(columnsOf(dots)).toEqual({ Charcoal: 3 });
    expect(dots).toMatch(/<g class="x-axis">\s*<line [^>]*\/>\s*<\/g>/); // axis line only, no ticks or labels
    const bars = render([mixed], spec("bar")).svg;
    expect(bars.match(/<g class="presence">[\s\S]*?<\/g>/)![0].match(/<rect /g)).toHaveLength(2);
    expect(bars).not.toContain("<circle");
  });
});

describe("common vs independent scales", () => {
  it("a percent panel next to a count panel never shares a scale; units are shown", () => {
    const spec: Spec = {
      specVersion: 4,
      panels: [
        { type: "taxonCurves", dataset: "x", variables: { kinds: ["percent"] } },
        { type: "taxonCurves", dataset: "x", variables: { kinds: ["count"] } },
      ],
    };
    const { svg, warnings } = render([mixed], spec);
    expect(warnings).toEqual([]);
    const w = columnsOf(svg);
    // Percent: 0.4 mm/% → 50 % = 20 mm. Counts: own family, max 40 → range 50 drawn like 100 % → 40 × 0.4 × 100/50 = 32 mm.
    expect(w.Pollen).toBeCloseTo(20, 2);
    expect(w.SeedsA).toBeCloseTo(32, 2);
    expect(w.SeedsA! / w.SeedsB!).toBeCloseTo(4, 2); // common within the count family
    // Two families → one unit label per family run.
    expect([...svg.matchAll(/class="unit"[^>]*>([^<]+)</g)].map((m) => m[1])).toEqual(["%", "n/20 cm³"]);
  });

  it("independent scales: every column its own axis 0…nice max and its own unit label", () => {
    const spec: Spec = {
      specVersion: 4,
      panels: [{ type: "taxonCurves", dataset: "x", variables: { kinds: ["count"] }, style: { commonScale: false } }],
    };
    const { svg } = render([mixed], spec);
    expect(columnsOf(svg)).toEqual({ SeedsA: 15, SeedsB: 15 });
    const labels = [...svg.matchAll(/class="x-axis">([\s\S]*?)<\/g>/g)].map((m) => [...m[1]!.matchAll(/>([^<]+)<\/text>/g)].map((t) => t[1]));
    // Seeds A max 40 → step 20 → 0–40; Seeds B max 10 → step 5 → 0–10.
    expect(labels).toEqual([
      ["0", "20", "40", "n/20 cm³"],
      ["0", "5", "10", "n/20 cm³"],
    ]);
  });

  it("warns when one panel mixes kinds", () => {
    const { warnings } = render([mixed], { specVersion: 4, panels: [{ type: "taxonCurves", dataset: "x" }] });
    expect(warnings).toEqual([
      'taxonCurves (panel-0-taxonCurves): mixes kinds (count, presence, percent); each kind gets its own x-scale. Use one panel per kind (selection "kinds").',
    ]);
  });
});

describe("preset loader", () => {
  it("accepts all presets in /presets", () => {
    const r = loadPresets(presetFiles);
    expect(r.errors).toEqual([]);
    expect(r.presets.map((p) => p.name)).toEqual(["diatom-percent", "macrofossil-counts", "pollen-percent", "testate-percent"]);
  });

  it("reports JSON, schema, name and duplicate problems with the file name", () => {
    const r = loadPresets([
      { file: "broken.json", text: "{ presetVersion: 1" },
      { file: "a.json", text: JSON.stringify({ presetVersion: 1, name: "a", panelDefaults: { continuous: {} }, transforms: [{ type: "scaleMap", scale: 3 }] }) },
      { file: "b.json", text: JSON.stringify({ presetVersion: 1, name: "c" }) },
      { file: "dir/c.json", text: JSON.stringify({ presetVersion: 1, name: "c" }) },
      { file: "d/c.json", text: JSON.stringify({ presetVersion: 1, name: "c" }) },
    ]);
    expect(r.presets.map((p) => p.name)).toEqual(["c"]);
    expect(r.errors).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^Preset a\.json: panelDefaults: Unrecognized key.*continuous/),
        expect.stringMatching(/^Preset a\.json: transforms\[0\]\.scale: /),
        'Preset b.json: name "c" does not match the file name; expected "b".',
        expect.stringMatching(/^Preset broken\.json: Invalid JSON/),
        'Preset dir/c.json: duplicate preset name "c"; ignored.',
      ]),
    );
  });
});

describe("example diagrams (synthetic data, presets only)", () => {
  const example = (name: string) => {
    const spec = parseSpec(readRepoFile(`examples/${name}.spec.json`));
    if (!spec.ok) throw new Error(spec.errors.join("\n"));
    const imported = importDelimited(readRepoFile(`examples/${name}.csv`), { name });
    return { ...render(imported.datasets, spec.value, presets), importWarnings: imported.warnings, datasets: imported.datasets, spec: spec.value };
  };

  it.each(["testate-percent", "diatom-percent", "macrofossil-counts"])("%s renders without warnings and matches its golden SVG", async (name) => {
    const r = example(name);
    expect(r.importWarnings).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(example(name).svg).toBe(r.svg);
    await expect(r.svg).toMatchFileSnapshot(`./__snapshots__/${name}.svg`);
  });

  it("CSV headers mark the data as synthetic", () => {
    for (const name of ["testate-percent", "diatom-percent", "macrofossil-counts"]) {
      expect(readRepoFile(`examples/${name}.csv`)).toMatch(/^# SYNTHETIC DATA/);
    }
  });

  it("diatoms: the 2 % threshold and weighted-average-depth ordering come from the preset", () => {
    const r = example("diatom-percent");
    const ds = prepareDatasets(r.datasets, r.spec, presets).datasets[0]!;
    const shown = [...r.svg.matchAll(/id="panel-1-taxonCurves-([^"]+)" class="column"/g)].map((m) => m[1]!.replace(/_/g, " "));
    expect(ds.variables).toHaveLength(40);
    const max = (id: string) => Math.max(...ds.values.map((row) => row[ds.variables.findIndex((v) => v.id === id)] ?? 0));
    // Exactly the taxa reaching 2 % somewhere are drawn.
    expect(shown.sort()).toEqual(ds.variables.filter((v) => max(v.id) >= 2).map((v) => v.id).sort());
    expect(shown.length).toBeGreaterThan(15);
    expect(shown.length).toBeLessThan(40);
    // Percent of all valves: each sample sums to 100.
    for (const row of ds.values) expect(row.reduce((s: number, x) => s + (x ?? 0), 0)).toBeCloseTo(100, 8);
  });

  it("macrofossils: counts, classes and presence each in their own panel and scale", () => {
    const { svg } = example("macrofossil-counts");
    expect(svg).toContain('text-anchor="end">D</text>'); // DAFOR axis ends on D
    expect(svg).toContain('text-anchor="end">5</text>'); // numeric class axis ends on 5
    expect([...svg.matchAll(/class="unit"[^>]*>([^<]+)</g)].map((m) => m[1])).toEqual(Array(5).fill("n/20 cm³"));
    expect(svg).toContain("<circle ");
  });
});
