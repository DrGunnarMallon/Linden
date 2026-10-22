import { describe, expect, it } from "vitest";
import { parsePreset, parseSpec, specJsonSchema } from "../src/io/spec.js";
import { migrateSpec } from "../src/model/migrate.js";
import { SPEC_VERSION } from "../src/model/spec.js";
import { importDelimited } from "../src/io/delimited.js";
import { loadPresets } from "../src/io/presets.js";
import { render } from "../src/pipeline.js";
import { readRepoFile, readRepoJson, withoutMetadata } from "./fixtures.js";

describe("parseSpec", () => {
  it("accepts the demo spec (as string or object)", () => {
    const text = readRepoFile("examples/demo-pollen.spec.json");
    const fromString = parseSpec(text);
    expect(fromString.ok).toBe(true);
    expect(parseSpec(JSON.parse(text))).toEqual(fromString);
    if (fromString.ok) expect(fromString.value.panels[1]!.type).toBe("taxonCurves");
  });

  it("reports invalid JSON", () => {
    const r = parseSpec("{ specVersion: 1");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatch(/^Invalid JSON/);
  });

  it("reports errors with readable paths", () => {
    const r = parseSpec({
      specVersion: 8,
      panels: [{ type: "yAxis" }, { type: "taxonCurves", dataset: "p", style: { curve: { type: "wiggly" } } }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toHaveLength(1);
      expect(r.errors[0]).toMatch(/^panels\[1\]\.style\.curve\.type: /);
    }
  });

  it("reports missing fields, wrong version, unknown keys and unknown panel types", () => {
    const r = parseSpec({ specVersion: 99, page: { widht: 100 }, panels: [{ type: "pie" }] });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const paths = r.errors.map((e) => e.split(":")[0]);
      expect(paths).toEqual(expect.arrayContaining(["specVersion", "page", "panels[0].type"]));
      expect(r.errors.join("\n")).toContain("widht");
    }
    const missing = parseSpec({ specVersion: 1 });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.errors[0]).toMatch(/^panels: /);
  });

  it("rejects a malformed percent transform", () => {
    const r = parseSpec({ specVersion: 1, panels: [], datasets: [{ dataset: "p", transforms: [{ type: "percent", sum: 3 }] }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatch(/^datasets\[0\]\.transforms\[0\]\.sum: /);
  });
});

describe("spec migration", () => {
  it("migrates a v1 spec to the current version, keeping everything else", () => {
    const v1 = { specVersion: 1, page: { width: 100 }, panels: [{ type: "yAxis" }] };
    const r = parseSpec(JSON.stringify(v1));
    expect(r).toEqual({ ok: true, value: { specVersion: SPEC_VERSION, page: { width: 100 }, panels: [{ type: "yAxis" }] } });
    expect(SPEC_VERSION).toBe(9);
    expect(migrateSpec(v1)).toEqual({ ...v1, specVersion: 9 });
    expect(v1.specVersion).toBe(1); // input not mutated
  });

  it("migrates v5 → v6 and accepts the v6 fields (title, style, y-axis titles, x-axis titles, unit suffix)", () => {
    const v5 = {
      specVersion: 5,
      title: { text: "Lake *Linden*", subtitle: "Pollen", align: "centre", size: 11 },
      style: {
        background: null,
        fonts: { title: { family: "Helvetica", size: 12 }, labels: { size: 6 }, ticks: { family: "Arial" } },
        lineWidths: { axis: 0.2, curve: 0.08 },
        tickLength: 1.5,
        colours: { axis: "#333333", text: "#111111" },
      },
      yAxis: { titles: { depth: "Depth (m below surface)", age: "" } },
      panels: [{ type: "taxonCurves", dataset: "d", style: { xTitle: { text: "%", show: "column" }, xTicks: { unitSuffix: true } } }],
    };
    expect(migrateSpec(v5)).toEqual({ ...v5, specVersion: 9 });
    expect(parseSpec(v5)).toEqual({ ok: true, value: { ...v5, specVersion: 9 } });
    // xTitle is panel-level: not allowed in per-variable overrides.
    const bad = parseSpec({ specVersion: 7, panels: [{ type: "taxonCurves", dataset: "d", overrides: { a: { xTitle: { show: "none" } } } }] });
    expect(bad.ok).toBe(false);
  });

  it("migrates v6 → v7 and accepts the v7 fields (global xScale, taxonCurves columnWidth)", () => {
    const v6 = { specVersion: 6, panels: [{ type: "taxonCurves", dataset: "d", style: { commonScale: false, columnWidth: 12.5 } }] };
    expect(migrateSpec(v6)).toEqual({ ...v6, specVersion: 9 });
    expect(parseSpec(v6)).toEqual({ ok: true, value: { ...v6, specVersion: 9 } });
    expect(parseSpec({ ...v6, specVersion: 7, xScale: 0.55 }).ok).toBe(true);
    expect(parseSpec({ specVersion: 7, xScale: 0, panels: [] }).ok).toBe(false);
    expect(parseSpec({ specVersion: 7, panels: [{ type: "taxonCurves", dataset: "d", style: { columnWidth: -1 } }] }).ok).toBe(false);
  });

  it("migrates v8 → v9 and accepts the v9 styleLibrary (unique names, curve style overrides)", () => {
    const v8 = { specVersion: 8, panels: [], curveStyles: { a: { type: "line" } } };
    expect(migrateSpec(v8)).toEqual({ ...v8, specVersion: 9 });
    const styleLibrary = [{ name: "Moss line", style: { type: "line", line: { colour: "group", dash: "dashed" } } }];
    expect(parseSpec({ ...v8, styleLibrary })).toEqual({ ok: true, value: { ...v8, specVersion: 9, styleLibrary } });
    const dup = parseSpec({ specVersion: 9, panels: [], styleLibrary: [...styleLibrary, { name: "Moss line", style: {} }] });
    expect(dup).toMatchObject({ ok: false, errors: [expect.stringContaining("styleLibrary[1].name")] });
    expect(parseSpec({ specVersion: 9, panels: [], styleLibrary: [{ name: "", style: {} }] }).ok).toBe(false);
    expect(parseSpec({ specVersion: 9, panels: [], styleLibrary: [{ name: "x", style: { type: "wiggly" } }] }).ok).toBe(false);
  });

  it("leaves current, unknown and non-object input to validation", () => {
    const current = { specVersion: 9, panels: [] };
    expect(migrateSpec(current)).toBe(current);
    expect(migrateSpec({ specVersion: 0, panels: [] })).toEqual({ specVersion: 0, panels: [] });
    expect(migrateSpec("x")).toBe("x");
  });

  it("migrates v3 → v4 and accepts the v4 fields (scaleMap, scales, kinds, presence)", () => {
    const v3 = {
      specVersion: 3,
      datasets: [{ dataset: "m", scales: { dafor: { D: 5, A: 4 } }, transforms: [{ type: "scaleMap", scale: "dafor" }] }],
      panels: [{ type: "taxonCurves", dataset: "m", variables: { kinds: ["presence"] }, style: { presence: "bar" } }],
    };
    const r = parseSpec(v3);
    const panels = [{ ...v3.panels[0], style: { curve: { presence: { symbol: "bar", size: 0.6 } } } }]; // v8: into the curve style
    expect(r).toEqual({ ok: true, value: { ...v3, panels, specVersion: 9 } });
  });

  it("migrates v2 → v3 and accepts the v3 grouping fields (top-level groups end up in the dataset entries)", () => {
    const entry = { dataset: "d", assignments: { Sphagnum: "bryophytes" }, order: ["Sphagnum"], transforms: [{ type: "merge", id: "M", name: "M", from: ["a", "b"] }] };
    const v2 = { specVersion: 2, groups: [{ id: "bryophytes", name: "Bryophytes" }], datasets: [entry], panels: [] };
    const expected = { specVersion: 9, datasets: [{ ...entry, groups: [{ id: "bryophytes", name: "Bryophytes" }] }], panels: [] };
    const r = parseSpec(v2);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual(expected);
    expect(migrateSpec(v2)).toEqual(expected);
  });

  describe("v4 → v5: groups per dataset, presets without groups and sums", () => {
    const pollenGroups = [
      { id: "trees", name: "Trees", colour: "#2f6b3a", order: 1 },
      { id: "shrubs", name: "Shrubs", colour: "#7a9a3c", order: 2 },
      { id: "herbs", name: "Herbs", colour: "#c9a227", order: 3 },
      { id: "aquatics", name: "Aquatics", colour: "#3a78a8", order: 4 },
      { id: "spores", name: "Spores", colour: "#8a6a9a", order: 5 },
    ];
    const terrestrial = { terrestrial: { includeGroups: ["trees", "shrubs", "herbs"] } };
    const outsideSum = { groups: ["aquatics", "spores"], basis: "sumPlusGroup" };

    it("copies the old preset's groups (spec fields win), sums, outsideSum and transforms into the entry", () => {
      const v4 = {
        specVersion: 4,
        preset: "pollen-percent",
        groups: [{ id: "herbs", name: "Herbs (upland)" }, { id: "bryophytes", name: "Bryophytes", order: 6 }],
        datasets: [{ dataset: "d" }],
        panels: [{ type: "taxonCurves", dataset: "d" }],
      };
      const groups = pollenGroups.map((g) => (g.id === "herbs" ? { ...g, name: "Herbs (upland)" } : g));
      expect(migrateSpec(v4)).toEqual({
        specVersion: 9,
        preset: "pollen-percent",
        datasets: [
          {
            dataset: "d",
            groups: [...groups, { id: "bryophytes", name: "Bryophytes", order: 6 }],
            transforms: [{ type: "percent", sum: "terrestrial" }],
            sums: terrestrial,
            outsideSum,
          },
        ],
        panels: [{ type: "taxonCurves", dataset: "d" }],
      });
      expect(v4.groups).toHaveLength(2); // input not mutated
    });

    it("keeps the entry's own transforms, sums and outsideSum; copies only sums they name", () => {
      const own = { dataset: "d", transforms: [{ type: "percent", sum: "total" }], outsideSum: { groups: ["x"], basis: "sum" } };
      const out = migrateSpec({ specVersion: 4, preset: "diatom-percent", datasets: [own, { dataset: "e" }], panels: [] }) as { datasets: unknown[] };
      expect(out.datasets).toEqual([{ ...own, sums: { total: { includeAll: true } } }, { dataset: "e" }]);
    });

    it("creates entries (without transforms, as before) for panel datasets that had none", () => {
      const out = migrateSpec({ specVersion: 4, groups: [{ id: "g", name: "G" }], panels: [{ type: "yAxis" }, { type: "taxonCurves", dataset: "d" }] });
      expect(out).toEqual({
        specVersion: 9,
        panels: [{ type: "yAxis" }, { type: "taxonCurves", dataset: "d" }],
        datasets: [{ dataset: "d", transforms: [], groups: [{ id: "g", name: "G" }] }],
      });
    });

    it("explicit headers keep their brackets; specs without headers get the default group headers", () => {
      expect(migrateSpec({ specVersion: 4, panels: [], headers: [{ spans: { groups: ["g"] } }] })).toHaveProperty("groupHeaders", { line: "bracket" });
      expect(migrateSpec({ specVersion: 4, panels: [] })).not.toHaveProperty("groupHeaders");
    });

    it("a v4 project that relied on preset groups renders exactly as before (golden SVG unchanged apart from the spec hash)", () => {
      const v4 = {
        specVersion: 4,
        preset: "pollen-percent",
        page: { width: 180, height: 120, units: "mm", font: { family: "Arial", size: 7 } },
        yAxis: { primary: "depth", secondary: "age", reverse: true, ticks: { major: 20, minor: 10 } },
        groups: [{ id: "bryophytes", name: "Bryophytes", colour: "#6b7f2a", order: 6 }],
        datasets: [
          {
            dataset: "demo-bryophytes",
            assignments: { Sphagnum: "bryophytes", "Scorpidium scorpioides": "bryophytes" },
            order: ["Sphagnum", "Calliergon"],
            transforms: [
              { type: "merge", id: "Calliergon", name: "*Calliergon*", from: ["Calliergon giganteum", "Calliergon cordifolium"], group: "bryophytes" },
              { type: "percent", sum: "terrestrial" },
            ],
            sums: terrestrial,
          },
        ],
        panels: [
          { type: "yAxis" },
          {
            type: "taxonCurves",
            dataset: "demo-bryophytes",
            variables: { groups: ["trees", "shrubs", "herbs", "bryophytes"], order: "data" },
            style: { mode: "silhouette", fill: "group", exaggeration: 10, commonScale: true, minWidth: 4 },
          },
        ],
        overlays: [{ type: "zones", manual: [{ depth: 65, label: "P1/P2" }] }],
        headers: [
          { label: "Trees & shrubs", spans: { groups: ["trees", "shrubs"] } },
          { spans: { groups: ["herbs"] } },
          { spans: { groups: ["bryophytes"] } },
        ],
      };
      const spec = parseSpec(v4);
      if (!spec.ok) throw new Error(spec.errors.join("\n"));
      const { presets } = loadPresets([{ file: "pollen-percent.json", text: readRepoFile("presets/pollen-percent.json") }]);
      const datasets = importDelimited(readRepoFile("examples/demo-bryophytes.csv"), { name: "demo-bryophytes" }).datasets;
      const r = render(datasets, spec.value, presets);
      expect(r.warnings).toEqual([]);
      // The migrated spec is not the example file, so only its hash in <metadata> differs.
      expect(withoutMetadata(r.svg)).toBe(withoutMetadata(readRepoFile("packages/core/test/__snapshots__/demo-bryophytes.svg")));
    });
  });

  it("rejects a merge without sources", () => {
    const r = parseSpec({ specVersion: 3, panels: [], datasets: [{ dataset: "d", transforms: [{ type: "merge", id: "M", name: "M", from: [] }] }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatch(/^datasets\[0\]\.transforms\[0\]\.from: /);
  });

  it("accepts v2-only fields in a migrated v1 file (they are all optional)", () => {
    const r = parseSpec({ specVersion: 1, panels: [], headerBand: { angle: 45 }, headers: [{ spans: { groups: ["trees"] } }] });
    expect(r.ok).toBe(true);
  });
});

describe("parsePreset", () => {
  it.each(["pollen-percent", "testate-percent", "diatom-percent", "macrofossil-counts"])("accepts presets/%s.json", (name) => {
    const r = parsePreset(readRepoJson(`presets/${name}.json`));
    expect(r.ok).toBe(true);
  });
});

describe("specJsonSchema", () => {
  it("exports a JSON Schema for the spec", () => {
    const schema = specJsonSchema() as { type: string; required: string[]; properties: Record<string, unknown> };
    expect(schema.type).toBe("object");
    expect(schema.required).toEqual(expect.arrayContaining(["specVersion", "panels"]));
    expect(Object.keys(schema.properties)).toEqual(
      expect.arrayContaining(["page", "yAxis", "datasets", "panels", "overlays"]),
    );
    expect(JSON.parse(JSON.stringify(schema))).toEqual(schema);
  });
});

describe("presets", () => {
  it.each(["pollen-percent", "testate-percent", "diatom-percent", "macrofossil-counts"])("presets/%s.json defines no groups or sums", (name) => {
    const json = readRepoJson(`presets/${name}.json`) as Record<string, unknown>;
    for (const key of ["groups", "sums", "outsideSum"]) expect(json).not.toHaveProperty(key);
    expect(JSON.stringify(json)).not.toMatch(/"(includeGroups|groups)"/);
  });

  it("the preset schema rejects groups, sums, outsideSum and group selections", () => {
    const base = { presetVersion: 1, name: "p" };
    for (const extra of [
      { groups: [{ id: "trees", name: "Trees", order: 1 }] },
      { sums: { total: { includeAll: true } } },
      { outsideSum: { groups: ["spores"], basis: "sum" } },
      { selectionDefaults: { groups: ["trees"] } },
    ]) {
      expect(parsePreset({ ...base, ...extra }).ok).toBe(false);
    }
    expect(parsePreset(base).ok).toBe(true);
  });
});
