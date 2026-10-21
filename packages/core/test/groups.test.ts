import { describe, expect, it } from "vitest";
import { applyGroups, groupOrder } from "../src/model/groups.js";
import type { Spec } from "../src/model/spec.js";
import type { Dataset } from "../src/model/types.js";
import { prepareDatasets, render } from "../src/pipeline.js";

// As imported from a CSV group row: groups in column order.
const ds: Dataset = {
  id: "d",
  name: "d",
  depthUnit: "cm",
  samples: [{ id: "1", depth: 1 }, { id: "2", depth: 2 }],
  variables: [
    { id: "Pinus", name: "*Pinus*", kind: "percent", group: "trees" },
    { id: "Poaceae", name: "Poaceae", kind: "percent", group: "herbs" },
    { id: "Sphagnum", name: "*Sphagnum*", kind: "percent", group: "spores" },
    { id: "Polytrichum", name: "*Polytrichum*", kind: "percent", group: "spores" },
  ],
  groups: [
    { id: "trees", name: "trees", order: 1 },
    { id: "herbs", name: "herbs", order: 2 },
    { id: "spores", name: "spores", order: 3 },
  ],
  values: [
    [10, 20, 30, 40],
    [11, 21, 31, 41],
  ],
};

describe("applyGroups", () => {
  it("spec groups rename, recolour and reorder dataset groups and add new (even empty) ones", () => {
    const warnings: string[] = [];
    const out = applyGroups(
      ds,
      [
        { id: "spores", name: "Spores", colour: "#8a6a9a" },
        { id: "trees", order: 9 },
        { id: "bryophytes", name: "Bryophytes" },
        { id: "aquatics", name: "Aquatics", order: 0 },
      ],
      {},
      (m) => warnings.push(m),
    );
    expect(warnings).toEqual([]);
    expect(out.groups).toEqual([
      { id: "trees", name: "trees", order: 9 },
      { id: "herbs", name: "herbs", order: 2 },
      { id: "spores", name: "Spores", colour: "#8a6a9a", order: 3 },
      { id: "bryophytes", name: "Bryophytes", order: Number.POSITIVE_INFINITY },
      { id: "aquatics", name: "Aquatics", order: 0 },
    ]);
    expect(groupOrder(out)).toEqual(["aquatics", "herbs", "spores", "trees", "bryophytes"]);
    expect(ds.groups[0]).toEqual({ id: "trees", name: "trees", order: 1 }); // input untouched
  });

  it("assignments override a variable's group; unknown groups / variables are ignored with a warning", () => {
    const warnings: string[] = [];
    const out = applyGroups(
      ds,
      [{ id: "bryophytes", name: "Bryophytes" }],
      { Sphagnum: "bryophytes", Polytrichum: "mosses", Nope: "herbs" },
      (m) => warnings.push(m),
    );
    expect(out.variables.map((v) => v.group)).toEqual(["trees", "herbs", "bryophytes", "spores"]);
    expect(warnings).toEqual([
      'Assignment of "Polytrichum" to group "mosses": no such group in dataset "d"; ignored.',
      'Assignment of "Nope" in dataset "d": no such variable (merged variables take their group from the merge transform); ignored.',
    ]);
  });

  it("drops data groups the spec does not list once they are empty (a deleted group stays deleted)", () => {
    // All spores moved out; "spores" not listed → gone. Listed "aquatics" stays although empty.
    const out = applyGroups(ds, [{ id: "bryophytes", name: "Bryophytes" }, { id: "aquatics", name: "Aquatics" }], { Sphagnum: "bryophytes", Polytrichum: "bryophytes" }, () => undefined);
    expect(out.groups.map((g) => g.id)).toEqual(["trees", "herbs", "bryophytes", "aquatics"]);
  });
});

describe("groups per dataset (datasets[].groups)", () => {
  it("columns follow the dataset's group order; new taxa missing from the order list still appear", () => {
    const spec: Spec = {
      specVersion: 5,
      datasets: [
        {
          dataset: "d",
          groups: [{ id: "bryophytes", name: "Bryophytes", order: 1.5 }, { id: "herbs", name: "Herbs", colour: "#c9a227" }],
          assignments: { Sphagnum: "bryophytes", Polytrichum: "bryophytes" },
          order: ["Polytrichum"],
        },
      ],
      panels: [{ type: "taxonCurves", dataset: "d" }],
    };
    const { svg, warnings } = render([ds], spec);
    expect(warnings).toEqual([]);
    const columns = [...svg.matchAll(/id="panel-0-taxonCurves-([^"]+)" class="column"/g)].map((m) => m[1]);
    // trees (1), bryophytes (1.5: Polytrichum listed, Sphagnum follows), herbs (2); spores is empty → dropped
    expect(columns).toEqual(["Pinus", "Polytrichum", "Sphagnum", "Poaceae"]);
    const prepared = prepareDatasets([ds], spec).datasets[0]!;
    expect(prepared.groups.find((g) => g.id === "herbs")).toEqual({ id: "herbs", name: "Herbs", colour: "#c9a227", order: 2 });
    expect(prepared.groups.map((g) => g.id)).toEqual(["trees", "herbs", "bryophytes"]);
    // Default group headers use the dataset's group names.
    expect([...svg.matchAll(/class="group-header"[^>]*>([^<]+)</g)].map((m) => m[1])).toEqual(["trees", "Bryophytes", "Herbs"]);
  });

  it("groups of one dataset do not leak into another", () => {
    const other: Dataset = { ...ds, id: "e", name: "e" };
    const spec: Spec = { specVersion: 5, datasets: [{ dataset: "d", groups: [{ id: "bryophytes", name: "Bryophytes" }] }], panels: [] };
    const [d, e] = prepareDatasets([ds, other], spec).datasets;
    expect(d!.groups.some((g) => g.id === "bryophytes")).toBe(true);
    expect(e!.groups.some((g) => g.id === "bryophytes")).toBe(false);
  });
});
