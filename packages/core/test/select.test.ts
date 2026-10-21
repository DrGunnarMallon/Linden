import { describe, expect, it } from "vitest";
import { selectVariables } from "../src/layout/select.js";
import type { ResolvedSelection } from "../src/model/defaults.js";
import type { Dataset } from "../src/model/types.js";

// Depths 10, 20, 30 cm. Hand-checked keys per variable:
//   id       values         max  weighted average depth          deepest non-zero
//   Pinus    10, 0, 0       10   10                              10
//   Zeta     0, 5, 5        5    (5·20 + 5·30) / 10 = 25         30
//   Corylus  2, 2, null     2    (2·10 + 2·20) / 4 = 15          20  (null ignored)
//   Delta    0, 0, 6        6    30                              30
//   Empty    0, 0, 0        0    none → last                     none → last
//   Beta     0, 1, 1        1    25 (ties Zeta → by id)          30
const ds: Dataset = {
  id: "d",
  name: "d",
  depthUnit: "cm",
  samples: [10, 20, 30].map((depth) => ({ id: String(depth), depth })),
  variables: [
    { id: "Pinus", name: "*Pinus*", kind: "percent", group: "trees" },
    { id: "Zeta", name: "zeta", kind: "percent", group: "herbs" },
    { id: "Corylus", name: "*Corylus*", kind: "percent", group: "shrubs" },
    { id: "Delta", name: "Delta", kind: "percent", group: "herbs" },
    { id: "Empty", name: "Empty", kind: "percent", group: "herbs" },
    { id: "Beta", name: "*Beta*", kind: "percent", group: "trees" },
  ],
  groups: [],
  values: [
    [10, 0, 2, 0, 0, 0],
    [0, 5, 2, 0, 0, 1],
    [0, 5, null, 6, 0, 1],
  ],
};

function ids(sel: Partial<ResolvedSelection>, d: Dataset = ds): { ids: string[]; warnings: string[] } {
  const warnings: string[] = [];
  const idx = selectVariables(d, { minMax: 0, order: "data", ...sel }, (m) => warnings.push(m));
  return { ids: idx.map((j) => d.variables[j]!.id), warnings };
}

describe("selection", () => {
  it("defaults to every variable in data order", () => {
    expect(ids({}).ids).toEqual(["Pinus", "Zeta", "Corylus", "Delta", "Empty", "Beta"]);
  });

  it("selects by explicit ids and by group (union), warning about unknown ids", () => {
    const r = ids({ ids: ["Corylus", "Nope"], groups: ["trees"] });
    expect(r.ids).toEqual(["Pinus", "Corylus", "Beta"]);
    expect(r.warnings).toEqual(['Variable "Nope" not found in dataset "d".']);
  });

  it("minMax keeps variables whose max ≥ threshold (inclusive)", () => {
    expect(ids({ minMax: 5 }).ids).toEqual(["Pinus", "Zeta", "Delta"]);
    expect(ids({ minMax: 6.0001 }).ids).toEqual(["Pinus"]);
  });
});

describe("ordering", () => {
  it("weightedAverageDepth: shallowest first, ties by id, never-present last", () => {
    expect(ids({ order: "weightedAverageDepth" }).ids).toEqual(["Pinus", "Corylus", "Beta", "Zeta", "Delta", "Empty"]);
  });

  it("firstOccurrence: deepest (oldest) appearance first, ties by id, never-present last", () => {
    expect(ids({ order: "firstOccurrence" }).ids).toEqual(["Beta", "Delta", "Zeta", "Corylus", "Pinus", "Empty"]);
  });

  it("alphabetical: by display name without markup, case-insensitive", () => {
    expect(ids({ order: "alphabetical" }).ids).toEqual(["Beta", "Corylus", "Delta", "Empty", "Pinus", "Zeta"]);
  });

  it("alphabetical: equal names are ordered by id, not data order", () => {
    const twin: Dataset = {
      ...ds,
      variables: [
        { id: "b-twin", name: "*Same*", kind: "percent" },
        { id: "a-twin", name: "same", kind: "percent" },
      ],
      values: ds.values.map(() => [1, 1]),
    };
    expect(ids({ order: "alphabetical" }, twin).ids).toEqual(["a-twin", "b-twin"]);
  });

  it("explicit list: listed first in list order, the rest after by id", () => {
    expect(ids({ order: ["Delta", "Pinus"] }).ids).toEqual(["Delta", "Pinus", "Beta", "Corylus", "Empty", "Zeta"]);
  });

  it("is independent of data column order", () => {
    const perm = [5, 3, 1, 0, 4, 2];
    const shuffled: Dataset = {
      ...ds,
      variables: perm.map((j) => ds.variables[j]!),
      values: ds.values.map((row) => perm.map((j) => row[j]!)),
    };
    for (const order of ["weightedAverageDepth", "firstOccurrence", "alphabetical"] as const) {
      expect(ids({ order }, shuffled).ids).toEqual(ids({ order }).ids);
    }
  });
});
