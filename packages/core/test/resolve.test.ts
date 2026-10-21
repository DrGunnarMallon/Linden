import { describe, expect, it } from "vitest";
import { parsePreset, parseSpec } from "../src/io/spec.js";
import { coreDefaults } from "../src/model/defaults.js";
import { mergeLayers, resolveSpec, resolveVariableStyle, type ResolvedTaxonCurvesPanel } from "../src/model/resolve.js";
import type { Preset, Spec } from "../src/model/spec.js";
import { readRepoJson } from "./fixtures.js";

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

const pollen = preset("pollen-percent");
const curves = (s: Spec, presets: Preset[] = [pollen]) =>
  resolveSpec(s, presets).spec.panels[0] as ResolvedTaxonCurvesPanel;

describe("mergeLayers", () => {
  it("merges objects deeply, replaces arrays/primitives/null, skips undefined", () => {
    expect(
      mergeLayers({ a: 1, n: { x: 1, y: 2 }, arr: [1, 2], r: [0, 1] as number[] | null }, { n: { y: 3 }, arr: [9], r: null, a: undefined }),
    ).toEqual({ a: 1, n: { x: 1, y: 3 }, arr: [9], r: null });
  });
});

describe("resolveSpec — order core → preset → spec → per-variable override", () => {
  const base = { specVersion: 1, preset: "pollen-percent" };

  it("core defaults fill what nothing else sets", () => {
    const p = curves(spec({ specVersion: 1, panels: [{ type: "taxonCurves", dataset: "d" }] }));
    expect(p.style).toEqual(coreDefaults.taxonCurves);
    expect(p.variables).toEqual({ minMax: 0, order: "data" });
  });

  it("preset beats core defaults", () => {
    const p = curves(spec({ ...base, panels: [{ type: "taxonCurves", dataset: "d" }] }));
    expect(p.style.exaggeration).toBe(10); // preset (core: 0)
    expect(p.style.plusBelow).toBe(0.5); // preset (core: 0)
    expect(p.style.minWidth).toBe(4);
  });

  it("spec beats preset", () => {
    const p = curves(spec({ ...base, panels: [{ type: "taxonCurves", dataset: "d", style: { exaggeration: 5 } }] }));
    expect(p.style.exaggeration).toBe(5);
    expect(p.style.minWidth).toBe(4); // untouched preset value survives
  });

  it("per-variable override beats spec", () => {
    const p = curves(
      spec({
        ...base,
        panels: [{ type: "taxonCurves", dataset: "d", style: { exaggeration: 5 }, overrides: { Pinus: { exaggeration: 0 } } }],
      }),
    );
    expect(resolveVariableStyle(p, "Pinus").exaggeration).toBe(0);
    expect(resolveVariableStyle(p, "Pinus").minWidth).toBe(4);
    expect(resolveVariableStyle(p, "Betula").exaggeration).toBe(5);
  });

  it("selection defaults follow the same order", () => {
    const diatom = preset("diatom-percent");
    const s = spec({ specVersion: 1, preset: "diatom-percent", panels: [{ type: "taxonCurves", dataset: "d", variables: { minMax: 5 } }] });
    expect(curves(s, [diatom]).variables).toEqual({ minMax: 5, order: "weightedAverageDepth" });
  });

  it("page and yAxis merge core defaults with the spec", () => {
    const r = resolveSpec(spec({ specVersion: 1, page: { height: 120, font: { size: 6 } }, panels: [] }));
    expect(r.spec.page).toEqual({ width: 180, height: 120, units: "mm", font: { family: "Arial", size: 6 } });
    expect(r.spec.yAxis).toEqual({ primary: "depth", reverse: true, range: null });
  });

  it("headerBand: core → preset → spec; nested xTicks merge per key", () => {
    const withBand: Preset = { ...pollen, headerBand: { angle: 90, minFontSize: 4 } };
    const r = resolveSpec(spec({ ...base, headerBand: { angle: 45 }, panels: [] }), [withBand]);
    expect(r.spec.headerBand).toEqual({ angle: 45, minFontSize: 4, height: null });
    expect(resolveSpec(spec({ specVersion: 2, panels: [] })).spec.headerBand).toEqual(coreDefaults.headerBand);
    const p = curves(spec({ ...base, panels: [{ type: "taxonCurves", dataset: "d", style: { xTicks: { minSpacing: 10 } } }] }));
    expect(p.style.xTicks).toEqual({ step: null, minSpacing: 10 });
    expect(p.style.groupGap).toBe(2);
  });

  it("dataset sums: spec replaces a preset sum of the same name; outsideSum comes from the preset", () => {
    const r = resolveSpec(
      spec({
        ...base,
        panels: [],
        datasets: [{ dataset: "d", sums: { terrestrial: { includeAll: true }, trees: { includeGroups: ["trees"] } } }],
      }),
      [pollen],
    );
    const d = r.spec.datasets[0]!;
    expect(d.sums).toEqual({ terrestrial: { includeAll: true }, trees: { includeGroups: ["trees"] } });
    expect(d.outsideSum).toEqual({ groups: ["aquatics", "spores"], basis: "sumPlusGroup" });
    expect(d.transforms).toEqual([]);
    expect(r.spec.groups.map((g) => g.id)).toEqual(["trees", "shrubs", "herbs", "aquatics", "spores"]);
  });

  it("warns about an unknown preset and falls back to core defaults", () => {
    const r = resolveSpec(spec({ specVersion: 1, preset: "nope", panels: [{ type: "taxonCurves", dataset: "d" }] }), [pollen]);
    expect(r.warnings).toEqual(['Preset "nope" not found; using core defaults.']);
    expect((r.spec.panels[0] as ResolvedTaxonCurvesPanel).style).toEqual(coreDefaults.taxonCurves);
  });

  it("does not mutate inputs", () => {
    const s = spec({ ...base, panels: [{ type: "taxonCurves", dataset: "d", style: { exaggeration: 5 } }] });
    const before = JSON.stringify([s, pollen, coreDefaults]);
    resolveSpec(s, [pollen]);
    expect(JSON.stringify([s, pollen, coreDefaults])).toBe(before);
  });
});
