import { describe, expect, it } from "vitest";
import { applyGroups, groupOrder } from "../src/model/groups.js";
import { resolveSpec } from "../src/model/resolve.js";
import type { Preset, Spec } from "../src/model/spec.js";
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
      'Assignment of "Polytrichum" to group "mosses": no such group in dataset "d" or the spec; ignored.',
      'Assignment of "Nope" in dataset "d": no such variable (merged variables take their group from the merge transform); ignored.',
    ]);
  });
});

describe("resolution core → preset → spec for groups", () => {
  const preset: Preset = {
    presetVersion: 1,
    name: "p",
    groups: [
      { id: "trees", name: "Trees", colour: "#2f6b3a", order: 1 },
      { id: "herbs", name: "Herbs", colour: "#c9a227", order: 3 },
    ],
  };

  it("spec groups overlay preset groups by field; spec-only groups are appended", () => {
    const spec: Spec = { specVersion: 3, preset: "p", panels: [], groups: [{ id: "herbs", name: "Grasses & herbs" }, { id: "bryophytes", name: "Bryophytes", order: 2 }] };
    expect(resolveSpec(spec, [preset]).spec.groups).toEqual([
      { id: "trees", name: "Trees", colour: "#2f6b3a", order: 1 },
      { id: "herbs", name: "Grasses & herbs", colour: "#c9a227", order: 3 },
      { id: "bryophytes", name: "Bryophytes", order: 2 },
    ]);
  });

  it("columns follow the resolved group order; new taxa missing from the order list still appear", () => {
    const spec: Spec = {
      specVersion: 3,
      preset: "p",
      groups: [{ id: "bryophytes", name: "Bryophytes", order: 2 }],
      datasets: [{ dataset: "d", assignments: { Sphagnum: "bryophytes", Polytrichum: "bryophytes" }, order: ["Polytrichum"] }],
      panels: [{ type: "taxonCurves", dataset: "d" }],
    };
    const { svg, warnings } = render([ds], spec, [preset]);
    expect(warnings).toEqual([]);
    const columns = [...svg.matchAll(/id="panel-0-taxonCurves-([^"]+)" class="column"/g)].map((m) => m[1]);
    // trees (1), bryophytes (2: Polytrichum listed, Sphagnum follows), herbs (3)
    expect(columns).toEqual(["Pinus", "Polytrichum", "Sphagnum", "Poaceae"]);
    // Group colour and name come from the effective groups.
    const prepared = prepareDatasets([ds], spec, [preset]).datasets[0]!;
    expect(prepared.groups.find((g) => g.id === "herbs")).toEqual({ id: "herbs", name: "Herbs", colour: "#c9a227", order: 3 });
  });
});
