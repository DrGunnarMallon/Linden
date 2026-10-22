import { describe, expect, it } from "vitest";
import { deleteVariable } from "../src/edit/dataset.js";
import { cleanupSpec, danglingReferences } from "../src/edit/references.js";
import { importDelimited } from "../src/io/delimited.js";
import { parseSpec } from "../src/io/spec.js";
import type { Spec } from "../src/model/spec.js";
import { readRepoFile } from "./fixtures.js";

const ds = importDelimited(readRepoFile("examples/demo-bryophytes.csv"), { name: "bryo" }).datasets[0]!;

const spec: Spec = {
  specVersion: 9,
  datasets: [
    {
      dataset: "bryo",
      assignments: { Sphagnum: "herbs", Pinus: "trees" },
      order: ["Pinus", "Calliergon", "Betula"],
      transforms: [
        { type: "merge", id: "Calliergon", name: "*Calliergon*", from: ["Calliergon giganteum", "Calliergon cordifolium"] },
        { type: "merge", id: "Moss", name: "Moss", from: ["Sphagnum"] },
        { type: "percent" },
      ],
    },
  ],
  panels: [
    { type: "yAxis" },
    { type: "taxonCurves", dataset: "bryo", variables: { ids: ["Pinus", "Betula"] }, overrides: { Pinus: { minWidth: 2 } } },
  ],
  headers: [{ spans: { ids: ["Pinus", "Calliergon"] } }],
  curveStyles: { Pinus: { type: "bars" }, Calliergon: { type: "line" }, Moss: { type: "line" } },
};

describe("dangling references", () => {
  it("finds none in a consistent spec (merged ids count)", () => {
    expect(danglingReferences(spec, [ds])).toEqual([]);
    expect(cleanupSpec(spec, [ds])).toBe(spec);
  });

  it("reports every reference to a deleted variable, in spec order", () => {
    const after = deleteVariable(ds, "Pinus").dataset;
    expect(danglingReferences(spec, [after])).toEqual([
      { path: "datasets[0].assignments.Pinus", id: "Pinus" },
      { path: "datasets[0].order", id: "Pinus" },
      { path: "panels[1].variables.ids", id: "Pinus" },
      { path: "panels[1].overrides.Pinus", id: "Pinus" },
      { path: "headers[0].spans.ids", id: "Pinus" },
      { path: "curveStyles.Pinus", id: "Pinus" },
    ]);
  });

  it("reports merge sources, and the merged id once a merge has no source left", () => {
    const after = deleteVariable(deleteVariable(ds, "Calliergon giganteum").dataset, "Sphagnum").dataset;
    expect(danglingReferences(spec, [after])).toEqual([
      { path: "datasets[0].assignments.Sphagnum", id: "Sphagnum" },
      { path: "datasets[0].transforms[0].from", id: "Calliergon giganteum" },
      { path: "datasets[0].transforms[1].from", id: "Sphagnum" },
      { path: "curveStyles.Moss", id: "Moss" },
    ]);
  });
});

describe("cleanupSpec", () => {
  it("removes exactly the dangling references and stays a valid spec", () => {
    const after = deleteVariable(deleteVariable(ds, "Pinus").dataset, "Sphagnum").dataset;
    const clean = cleanupSpec(spec, [after]);
    expect(danglingReferences(clean, [after])).toEqual([]);
    expect(clean.datasets![0]!.assignments).toBeUndefined();
    expect(clean.datasets![0]!.order).toEqual(["Calliergon", "Betula"]);
    expect(clean.datasets![0]!.transforms!.map((t) => t.type === "merge" && t.id)).toEqual(["Calliergon", false]);
    expect(clean.panels[1]).toEqual({ type: "taxonCurves", dataset: "bryo", variables: { ids: ["Betula"] } });
    expect(clean.headers).toEqual([{ spans: { ids: ["Calliergon"] } }]);
    expect(clean.curveStyles).toEqual({ Calliergon: { type: "line" } });
    expect(parseSpec(JSON.stringify(clean)).ok).toBe(true);
    // The input is untouched.
    expect(spec.curveStyles).toHaveProperty("Pinus");
  });

  it("keeps curve styles another dataset still uses", () => {
    const other = { ...ds, id: "other" };
    const after = deleteVariable(ds, "Pinus").dataset;
    expect(cleanupSpec(spec, [after, other]).curveStyles).toHaveProperty("Pinus");
  });
});
