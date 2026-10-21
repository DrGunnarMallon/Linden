import { describe, expect, it } from "vitest";
import { selectVariables } from "../src/layout/select.js";
import type { ResolvedSelection } from "../src/model/defaults.js";
import type { Dataset } from "../src/model/types.js";

// Ungrouped, so these tests see the panel orders alone (group order comes first; see below).
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
    { id: "Pinus", name: "*Pinus*", kind: "percent" },
    { id: "Zeta", name: "zeta", kind: "percent" },
    { id: "Corylus", name: "*Corylus*", kind: "percent" },
    { id: "Delta", name: "Delta", kind: "percent" },
    { id: "Empty", name: "Empty", kind: "percent" },
    { id: "Beta", name: "*Beta*", kind: "percent" },
  ],
  groups: [],
  values: [
    [10, 0, 2, 0, 0, 0],
    [0, 5, 2, 0, 0, 1],
    [0, 5, null, 6, 0, 1],
  ],
};

function ids(sel: Partial<ResolvedSelection>, d: Dataset = ds, explicit: string[] = []): { ids: string[]; warnings: string[] } {
  const warnings: string[] = [];
  const idx = selectVariables(d, { minMax: 0, order: "data", ...sel }, (m) => warnings.push(m), explicit);
  return { ids: idx.map((j) => d.variables[j]!.id), warnings };
}

describe("selection", () => {
  it("defaults to every variable in data order", () => {
    expect(ids({}).ids).toEqual(["Pinus", "Zeta", "Corylus", "Delta", "Empty", "Beta"]);
  });

  it("selects by explicit ids and by group (union), warning about unknown ids", () => {
    const grouped: Dataset = { ...ds, variables: ds.variables.map((v) => (v.id === "Pinus" || v.id === "Beta" ? { ...v, group: "trees" } : v)) };
    const r = ids({ ids: ["Corylus", "Nope"], groups: ["trees"] }, grouped);
    expect(r.ids).toEqual(["Pinus", "Beta", "Corylus"]); // grouped first, ungrouped last
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

describe("group order and the dataset's explicit order", () => {
  // Groups: herbs (order 1) before trees (order 2); Corylus ungrouped.
  const grouped: Dataset = {
    ...ds,
    groups: [
      { id: "trees", name: "Trees", order: 2 },
      { id: "herbs", name: "Herbs", order: 1 },
    ],
    variables: ds.variables.map((v) => {
      const group = { Pinus: "trees", Beta: "trees", Zeta: "herbs", Delta: "herbs", Empty: "herbs" }[v.id];
      return group ? { ...v, group } : v;
    }),
  };

  it("group order decides columns across groups; ungrouped last; panel order within groups", () => {
    expect(ids({}, grouped).ids).toEqual(["Zeta", "Delta", "Empty", "Pinus", "Beta", "Corylus"]);
    expect(ids({ order: "alphabetical" }, grouped).ids).toEqual(["Delta", "Empty", "Zeta", "Beta", "Pinus", "Corylus"]);
  });

  it("explicit order applies within each group; unlisted (e.g. new) taxa follow in the panel order", () => {
    // "Empty" listed first, then "Beta"; "Zeta"/"Delta"/"Pinus" are not listed.
    expect(ids({}, grouped, ["Empty", "Beta"]).ids).toEqual(["Empty", "Zeta", "Delta", "Beta", "Pinus", "Corylus"]);
    expect(ids({ order: "weightedAverageDepth" }, grouped, ["Empty", "Beta"]).ids).toEqual(["Empty", "Zeta", "Delta", "Beta", "Pinus", "Corylus"]);
    expect(ids({ order: "alphabetical" }, grouped, ["Zeta"]).ids).toEqual(["Zeta", "Delta", "Empty", "Beta", "Pinus", "Corylus"]);
  });

  it("an explicit list never moves a taxon out of its group", () => {
    expect(ids({}, grouped, ["Pinus", "Zeta"]).ids).toEqual(["Zeta", "Delta", "Empty", "Pinus", "Beta", "Corylus"]);
  });
});
