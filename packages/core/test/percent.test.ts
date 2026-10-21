import { describe, expect, it } from "vitest";
import { importDelimited } from "../src/io/delimited.js";
import { parsePreset, parseSpec } from "../src/io/spec.js";
import { resolveSpec } from "../src/model/resolve.js";
import type { Dataset, TransformContext } from "../src/model/types.js";
import { transforms } from "../src/registry.js";
import { percentTransform } from "../src/transforms/percent.js";
import { readRepoFile, readRepoJson } from "./fixtures.js";

function ctxWith(partial: Omit<TransformContext, "warn">): TransformContext & { warnings: string[] } {
  const warnings: string[] = [];
  return { ...partial, warnings, warn: (m) => warnings.push(m) };
}

function col(ds: Dataset, id: string): (number | null)[] {
  const j = ds.variables.findIndex((v) => v.id === id);
  return ds.values.map((row) => row[j]!);
}

describe("percent — demo pollen via resolved spec + preset", () => {
  const demo = importDelimited(readRepoFile("examples/demo-pollen.csv"), { name: "demo-pollen" }).datasets[0]!;
  const presetResult = parsePreset(readRepoJson("presets/pollen-percent.json"));
  const specResult = parseSpec(readRepoFile("examples/demo-pollen.spec.json"));
  if (!presetResult.ok || !specResult.ok) throw new Error("fixtures invalid");
  const entry = resolveSpec(specResult.value, [presetResult.value]).spec.datasets[0]!;
  const ctx = ctxWith({ sums: entry.sums, ...(entry.outsideSum ? { outsideSum: entry.outsideSum } : {}) });
  const out = transforms.get("percent").apply(demo, entry.transforms[0], ctx);

  it("runs without warnings and marks variables as percent", () => {
    expect(ctx.warnings).toEqual([]);
    expect(out.variables.every((v) => v.kind === "percent" && v.unit === "%")).toBe(true);
  });

  // 10 cm: trees 120+85+40 = 245, shrubs 60, herbs 55+20+0 = 75 → sum = 380.
  it("10 cm: % of terrestrial sum 380", () => {
    expect(col(out, "Betula")[0]).toBeCloseTo((120 / 380) * 100, 10); // 31.578947…
    expect(col(out, "Pinus")[0]).toBeCloseTo(22.368421, 5); // 85/380
    expect(col(out, "Artemisia")[0]).toBe(0); // zero stays zero
  });

  it("10 cm: Sphagnum is % of (sum + spores) = 14 / 394", () => {
    expect(col(out, "Sphagnum")[0]).toBeCloseTo(3.553299, 5);
  });

  // 50 cm: trees 80+120+48 = 248, shrubs 130, herbs 30+10+2 = 42 → sum = 420.
  it("50 cm: % of terrestrial sum 420", () => {
    expect(col(out, "Pinus")[4]).toBeCloseTo(28.571429, 5); // 120/420 = 2/7
    expect(col(out, "Corylus")[4]).toBeCloseTo(30.952381, 5); // 130/420
    expect(col(out, "Artemisia")[4]).toBeCloseTo(0.476190, 5); // 2/420
  });

  it("50 cm: Sphagnum is % of (sum + spores) = 38 / 458", () => {
    expect(col(out, "Sphagnum")[4]).toBeCloseTo(8.296943, 5);
  });

  it("terrestrial percentages add up to 100 in every sample", () => {
    const terrestrial = out.variables.map((v) => v.group !== "spores");
    for (const row of out.values) {
      const total = row.reduce<number>((acc, x, j) => (terrestrial[j] ? acc + (x ?? 0) : acc), 0);
      expect(total).toBeCloseTo(100, 10);
    }
  });

  it("keeps null vs zero at 100 cm", () => {
    expect(col(out, "Sphagnum")[9]).toBeNull(); // not assessed
    expect(col(out, "Quercus")[9]).toBe(0); // looked, none found
  });

  it("does not mutate the input dataset", () => {
    expect(demo.values[0]).toEqual([120, 85, 40, 60, 55, 20, 0, 14]);
    expect(demo.variables[0]!.kind).toBe("count");
  });

  it("without outsideSum, Sphagnum is plain % of the sum (14 / 380)", () => {
    const plain = percentTransform.apply(demo, { type: "percent", sum: "terrestrial" }, ctxWith({ sums: entry.sums }));
    expect(col(plain, "Sphagnum")[0]).toBeCloseTo(3.684211, 5);
  });
});

describe("percent — small fixtures", () => {
  const ds = importDelimited(
    ["depth,A,B,C,LOI", "group,g1,g1,g2,", "kind,count,count,count,continuous", "1,1,3,4,50", "2,0,0,5,60", "3,,,2,70", "4,2,,2,"].join("\n"),
  ).datasets[0]!;

  it("includeAll: % of all count variables; non-count passes through", () => {
    const ctx = ctxWith({ sums: { all: { includeAll: true } } });
    const out = percentTransform.apply(ds, { type: "percent", sum: "all" }, ctx);
    expect(out.values[0]).toEqual([12.5, 37.5, 50, 50]); // sum 8
    expect(out.values[3]).toEqual([50, null, 50, null]); // sum 4
    expect(out.variables[3]!.kind).toBe("continuous");
  });

  it("sum of 0 → null for that sample plus a warning; no assessed values → null plus a warning", () => {
    const ctx = ctxWith({ sums: { g1: { includeGroups: ["g1"] } } });
    const out = percentTransform.apply(ds, { type: "percent", sum: "g1" }, ctx);
    expect(out.values[0]).toEqual([25, 75, 100, 50]); // sum 4; C = 4/4 (plain sum basis)
    expect(out.values[1]).toEqual([null, null, null, 60]); // sum 0
    expect(out.values[2]).toEqual([null, null, null, 70]); // sum not assessed
    expect(ctx.warnings).toEqual([
      expect.stringContaining("depth 2 has sum \"g1\" = 0"),
      expect.stringContaining("depth 3 has no assessed values"),
    ]);
  });

  it("includeVariables, and sumPlusGroup for an outside group", () => {
    const ctx = ctxWith({ sums: { s: { includeVariables: ["A", "B"] } }, outsideSum: { groups: ["g2"], basis: "sumPlusGroup" } });
    const out = percentTransform.apply(ds, { type: "percent", sum: "s" }, ctx);
    expect(out.values[0]).toEqual([25, 75, 50, 50]); // C = 4 / (4 + 4)
  });

  it("warns and skips on an undefined sum or bad params", () => {
    const ctx = ctxWith({ sums: {} });
    expect(percentTransform.apply(ds, { type: "percent", sum: "x" }, ctx)).toBe(ds);
    expect(percentTransform.apply(ds, { type: "percent" }, ctx)).toBe(ds);
    expect(ctx.warnings).toHaveLength(2);
  });

  it("warns about unknown and non-count members", () => {
    const ctx = ctxWith({ sums: { s: { includeVariables: ["A", "LOI", "Z"], includeGroups: ["nope"] } } });
    percentTransform.apply(ds, { type: "percent", sum: "s" }, ctx);
    expect(ctx.warnings.slice(0, 3)).toEqual([
      'Sum "s": group "nope" has no variables.',
      'Sum "s": variable "LOI" is "continuous", not "count"; left out.',
      'Sum "s": variable "Z" not found.',
    ]);
  });
});
