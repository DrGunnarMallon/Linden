import { describe, expect, it } from "vitest";
import { importDelimited } from "../src/io/delimited.js";
import { parsePreset, parseSpec } from "../src/io/spec.js";
import type { Preset, Spec } from "../src/model/spec.js";
import type { Dataset, TransformContext } from "../src/model/types.js";
import { prepareDatasets, render } from "../src/pipeline.js";
import { mergedTwice, mergeTransform } from "../src/transforms/merge.js";
import { readRepoFile, readRepoJson } from "./fixtures.js";

function run(ds: Dataset, params: Record<string, unknown>): { out: Dataset; warnings: string[] } {
  const warnings: string[] = [];
  const ctx: TransformContext = { sums: {}, warn: (m) => warnings.push(m) };
  return { out: mergeTransform.apply(ds, { type: "merge", ...params }, ctx), warnings };
}

// Three samples; a and b are counts, c is continuous.
const ds: Dataset = {
  id: "d",
  name: "d",
  depthUnit: "cm",
  samples: [1, 2, 3].map((depth) => ({ id: String(depth), depth })),
  variables: [
    { id: "x", name: "x", kind: "count", group: "herbs" },
    { id: "a", name: "*A. one*", kind: "count", group: "mosses" },
    { id: "b", name: "*A. two*", kind: "count", group: "mosses" },
    { id: "c", name: "LOI", kind: "continuous", unit: "%" },
  ],
  groups: [
    { id: "herbs", name: "Herbs", order: 1 },
    { id: "mosses", name: "Mosses", order: 2 },
  ],
  values: [
    [5, 2, null, 40],
    [6, null, null, 41],
    [7, 0, 0, 42],
  ],
};

describe("merge transform", () => {
  it("sums per sample: null + number = number, all null = null, 0 stays 0", () => {
    const { out, warnings } = run(ds, { id: "A", name: "*A.*", from: ["a", "b"] });
    expect(warnings).toEqual([]);
    expect(out.variables.map((v) => v.id)).toEqual(["x", "A", "c"]); // at the first source's place
    expect(out.values).toEqual([
      [5, 2, 40],
      [6, null, 41],
      [7, 0, 42],
    ]);
    expect(out.variables[1]).toEqual({ id: "A", name: "*A.*", kind: "count", group: "mosses" });
    expect(ds.variables).toHaveLength(4); // input untouched
  });

  it("keepSources keeps the sources after the merged variable; group can be set", () => {
    const { out } = run(ds, { id: "A", name: "A", from: ["b", "a"], keepSources: true, group: "herbs" });
    expect(out.variables.map((v) => v.id)).toEqual(["x", "A", "a", "b", "c"]);
    expect(out.variables[1]!.group).toBe("herbs");
    expect(out.values[0]).toEqual([5, 2, 2, null, 40]);
  });

  it("refuses different kinds", () => {
    const { out, warnings } = run(ds, { id: "A", name: "A", from: ["a", "c"] });
    expect(out).toBe(ds);
    expect(warnings).toEqual(['merge "A": sources have different kinds (count, continuous); merge skipped.']);
  });

  it("warns about different units but merges", () => {
    const withUnit: Dataset = { ...ds, variables: ds.variables.map((v) => (v.id === "b" ? { ...v, unit: "grains" } : v)) };
    const { out, warnings } = run(withUnit, { id: "A", name: "A", from: ["a", "b"] });
    expect(out.variables.map((v) => v.id)).toEqual(["x", "A", "c"]);
    expect(warnings).toEqual(['merge "A": sources have different units (none, grains); summed anyway.']);
  });

  it("warns about missing sources, id clashes and unknown groups", () => {
    expect(run(ds, { id: "A", name: "A", from: ["a", "nope"] }).warnings).toEqual(['merge "A": source "nope" not found in dataset "d"; left out.']);
    expect(run(ds, { id: "x", name: "x", from: ["a", "b"] }).warnings).toEqual(['merge "x": a variable with id "x" already exists; merge skipped.']);
    expect(run(ds, { id: "a", name: "a", from: ["a", "b"] }).warnings).toEqual([]); // replaces its own source
    expect(run(ds, { id: "A", name: "A", from: ["a", "b"], group: "zz" }).warnings).toEqual([
      'merge "A": group "zz" does not exist; using the first source\'s group.',
    ]);
  });

  it("finds variables merged twice across merges", () => {
    expect(
      mergedTwice([
        { type: "merge", id: "M1", name: "M1", from: ["a", "b", "a"] },
        { type: "percent", sum: "s" },
        { type: "merge", id: "M2", name: "M2", from: ["b", "c"] },
      ]),
    ).toEqual(["b"]);
  });
});

function bryophytes() {
  const datasets = importDelimited(readRepoFile("examples/demo-bryophytes.csv"), { name: "demo-bryophytes" }).datasets;
  const spec = parseSpec(readRepoFile("examples/demo-bryophytes.spec.json"));
  const preset = parsePreset(readRepoJson("presets/pollen-percent.json"));
  if (!spec.ok || !preset.ok) throw new Error("fixtures invalid");
  return { datasets, spec: spec.value as Spec, presets: [preset.value as Preset] };
}

describe("merge before percent (examples/demo-bryophytes)", () => {
  const { datasets, spec, presets } = bryophytes();
  const { datasets: [ds10], warnings } = prepareDatasets(datasets, spec, presets);
  const value = (id: string, depth: number) => {
    const i = ds10!.samples.findIndex((s) => s.depth === depth);
    return ds10!.values[i]![ds10!.variables.findIndex((v) => v.id === id)];
  };

  it("merged taxon is a percentage of the same terrestrial sum (10 cm checked by hand)", () => {
    expect(warnings).toEqual([]);
    // Terrestrial sum at 10 cm: 120 + 85 + 40 + 60 + 55 + 20 + 0 = 380.
    // Calliergon = giganteum 3 + cordifolium 2 = 5 → 5 / 380 × 100 = 1.3158 %.
    expect(value("Calliergon", 10)).toBeCloseTo((5 / 380) * 100, 10);
    // Sphagnum is now a bryophyte, outside "spores" (sum + group): plain % of the sum, 14 / 380.
    expect(value("Sphagnum", 10)).toBeCloseTo((14 / 380) * 100, 10);
    // 90 cm: giganteum not counted (null), cordifolium 12 → 12 / (90 + 20 + 0 + 2 + 180 + 90 + 65) = 12 / 447.
    expect(value("Calliergon", 90)).toBeCloseTo((12 / 447) * 100, 10);
    expect(ds10!.variables.find((v) => v.id === "Calliergon")).toMatchObject({ kind: "percent", unit: "%", group: "bryophytes" });
    expect(ds10!.variables.some((v) => v.id === "Calliergon giganteum")).toBe(false);
  });

  it("a merge after the percent transform is skipped with a warning", () => {
    const entry = spec.datasets![0]!;
    const late: Spec = { ...spec, datasets: [{ ...entry, transforms: [...entry.transforms!].reverse() }] };
    const r = prepareDatasets(datasets, late, presets);
    expect(r.warnings).toContain(
      'merge "Calliergon" comes after a percent transform; merges must run first so merged taxa share the same sum. Merge skipped.',
    );
    expect(r.datasets[0]!.variables.some((v) => v.id === "Calliergon")).toBe(false);
  });

  it("warns about a variable merged twice, an unknown id in the order list and an assignment to a missing group", () => {
    const entry = spec.datasets![0]!;
    const bad: Spec = {
      ...spec,
      datasets: [
        {
          ...entry,
          assignments: { ...entry.assignments, Poaceae: "grasses" },
          order: [...entry.order!, "Nope"],
          transforms: [
            ...entry.transforms!.slice(0, 1),
            { type: "merge", id: "Calliergon2", name: "x", from: ["Calliergon giganteum"] },
            ...entry.transforms!.slice(1),
          ],
        },
      ],
    };
    const { warnings: w } = render(datasets, bad, presets);
    expect(w).toEqual(
      expect.arrayContaining([
        'Assignment of "Poaceae" to group "grasses": no such group in dataset "demo-bryophytes" or the spec; ignored.',
        'Variable "Calliergon giganteum" is merged more than once in dataset "demo-bryophytes".',
        'Order list of dataset "demo-bryophytes": unknown variable "Nope".',
      ]),
    );
  });
});
