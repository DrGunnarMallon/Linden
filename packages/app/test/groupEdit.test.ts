import { readFileSync } from "node:fs";
import { importDelimited, parsePreset, parseSpec, render, type Preset, type Spec } from "@linden/core";
import { describe, expect, it } from "vitest";
import {
  createGroup,
  mergeVariables,
  moveVariable,
  recolourGroup,
  renameGroup,
  reorderGroups,
  unmergeVariable,
  variableTree,
  variableVisibility,
} from "../src/specEdit";

const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8");
const preset = parsePreset(read("presets/pollen-percent.json"));
const presets: Preset[] = preset.ok ? [preset.value] : [];
const load = (name: string) => {
  const ds = importDelimited(read(`examples/${name}.csv`), { name }).datasets[0]!;
  const spec = parseSpec(read(`examples/${name}.spec.json`));
  if (!spec.ok) throw new Error(spec.errors.join("\n"));
  return { ds, spec: spec.value };
};

/** Every edit must still be a valid spec (strict schema) and round-trip through JSON. */
function valid(spec: Spec): Spec {
  const r = parseSpec(JSON.stringify(spec));
  if (!r.ok) throw new Error(r.errors.join("\n"));
  expect(r.value).toEqual(spec);
  return spec;
}

const pollen = load("demo-pollen");
const tree = (s: Spec, ds = pollen.ds) => variableTree(s, presets, ds);
const groupsOf = (s: Spec, ds = pollen.ds) => tree(s, ds).groups.map((g) => [g.id, g.members.map((m) => m.id)]);
const columns = (s: Spec, ds = pollen.ds) => [...render([ds], s, presets).svg.matchAll(/id="panel-1-taxonCurves-([^"]+)" class="column"/g)].map((m) => m[1]);
const visible = (s: Spec, ds = pollen.ds) => variableVisibility(s, presets, tree(s, ds).prepared);

describe("variable tree", () => {
  it("lists effective groups in order (preset groups included, even empty) with members in display order", () => {
    expect(groupsOf(pollen.spec)).toEqual([
      ["trees", ["Betula", "Pinus", "Quercus"]],
      ["shrubs", ["Corylus"]],
      ["herbs", ["Poaceae", "Cyperaceae", "Artemisia"]],
      ["aquatics", []],
      ["spores", ["Sphagnum"]],
    ]);
  });
});

describe("moving taxa", () => {
  it("within a group: writes that group's arrangement to the dataset order list", () => {
    const s = valid(moveVariable(pollen.spec, presets, pollen.ds, "Quercus", "trees", 0));
    expect(s.datasets![0]!.order).toEqual(["Quercus", "Betula", "Pinus"]);
    expect(columns(s).slice(0, 3)).toEqual(["Quercus", "Betula", "Pinus"]);
    // Moving down: dropped on Pinus (index 1) → Betula ends at index 1.
    expect(valid(moveVariable(s, presets, pollen.ds, "Betula", "trees", 2)).datasets![0]!.order).toEqual(["Quercus", "Pinus", "Betula"]);
  });

  it("between groups: becomes an assignment, stays visible, and moving back removes it", () => {
    const { spec: withGroup, id } = createGroup(pollen.spec, "Bryophytes", tree(pollen.spec).prepared.groups);
    expect(id).toBe("bryophytes");
    expect(withGroup.groups).toEqual([{ id: "bryophytes", name: "Bryophytes", order: 6 }]);
    const moved = valid(moveVariable(withGroup, presets, pollen.ds, "Sphagnum", "bryophytes", 0));
    expect(moved.datasets![0]!.assignments).toEqual({ Sphagnum: "bryophytes" });
    expect(groupsOf(moved).at(-1)).toEqual(["bryophytes", ["Sphagnum"]]);
    // The panel selects groups without "bryophytes"; the move keeps Sphagnum shown.
    expect(visible(moved).get("Sphagnum")?.visible).toBe(true);
    expect(columns(moved)).toContain("Sphagnum");

    const back = valid(moveVariable(moved, presets, pollen.ds, "Sphagnum", "spores", 0));
    expect(back.datasets![0]!.assignments).toBeUndefined();
    expect(groupsOf(back).find(([g]) => g === "spores")).toEqual(["spores", ["Sphagnum"]]);
  });

  it("a taxon added to the data later (not in the order list) still shows, after the listed ones", () => {
    const s = moveVariable(pollen.spec, presets, pollen.ds, "Quercus", "trees", 0);
    const ds = { ...pollen.ds, variables: [...pollen.ds.variables, { id: "Ulmus", name: "*Ulmus*", kind: "count" as const, group: "trees" }], values: pollen.ds.values.map((r) => [...r, 3]) };
    expect(groupsOf(s, ds)[0]).toEqual(["trees", ["Quercus", "Betula", "Pinus", "Ulmus"]]);
    expect(columns(s, ds).slice(0, 4)).toEqual(["Quercus", "Betula", "Pinus", "Ulmus"]);
  });
});

describe("group edits", () => {
  it("reorder, rename and recolour are stored in spec.groups and drive the diagram", () => {
    let s = valid(reorderGroups(pollen.spec, ["herbs", "trees", "shrubs", "aquatics", "spores"]));
    expect(groupsOf(s).map(([g]) => g)).toEqual(["herbs", "trees", "shrubs", "aquatics", "spores"]);
    expect(columns(s).slice(0, 3)).toEqual(["Poaceae", "Cyperaceae", "Artemisia"]);
    s = valid(renameGroup(recolourGroup(s, "herbs", "#aa5500"), "herbs", "Herbs (upland)"));
    expect(s.groups!.find((g) => g.id === "herbs")).toEqual({ id: "herbs", order: 1, colour: "#aa5500", name: "Herbs (upland)" });
    expect(render([pollen.ds], s, presets).svg).toContain('fill="#aa5500"');
    expect(tree(s).groups[0]!.name).toBe("Herbs (upland)");
  });

  it("new group ids are unique", () => {
    const existing = tree(pollen.spec).prepared.groups;
    expect(createGroup(pollen.spec, "Trees", existing).id).toBe("trees-2");
  });
});

describe("merging", () => {
  // The bryophyte example without its merge.
  const bryo = load("demo-bryophytes");
  const entry = bryo.spec.datasets![0]!;
  const unmerged: Spec = {
    ...bryo.spec,
    datasets: [{ ...entry, order: ["Sphagnum", "Calliergon giganteum"], transforms: entry.transforms!.filter((t) => t.type !== "merge") }],
  };

  it("creates a merge before the percent transform; one entry replaces the sources", () => {
    const { spec: s, id } = mergeVariables(unmerged, presets, bryo.ds, ["Calliergon giganteum", "Calliergon cordifolium"], "*Calliergon*");
    valid(s);
    expect(id).toBe("Calliergon");
    expect(s.datasets![0]!.transforms).toEqual([
      { type: "merge", id: "Calliergon", name: "*Calliergon*", from: ["Calliergon giganteum", "Calliergon cordifolium"], group: "spores" },
      { type: "percent", sum: "terrestrial" },
    ]);
    expect(s.datasets![0]!.order).toEqual(["Sphagnum", "Calliergon"]);
    const t = tree(s, bryo.ds);
    expect(t.merges.get("Calliergon")!.map((v) => v.id)).toEqual(["Calliergon giganteum", "Calliergon cordifolium"]);
    expect(t.prepared.variables.some((v) => v.id === "Calliergon giganteum")).toBe(false);
  });

  it("moving a merged taxon edits the merge's group; unmerge restores the spec", () => {
    const { spec: merged } = mergeVariables(unmerged, presets, bryo.ds, ["Calliergon giganteum", "Calliergon cordifolium"], "*Calliergon*");
    const moved = valid(moveVariable(merged, presets, bryo.ds, "Calliergon", "bryophytes", 1));
    expect(moved.datasets![0]!.transforms![0]).toMatchObject({ type: "merge", group: "bryophytes" });
    expect(moved.datasets![0]!.assignments).toEqual(entry.assignments);
    expect(columns(moved, bryo.ds).slice(-3)).toEqual(["Sphagnum", "Calliergon", "Scorpidium_scorpioides"]);
    expect(render([bryo.ds], moved, presets).warnings).toEqual([]);

    // Unmerge: both sources return where the merged taxon was in the order list; nothing else changes.
    const back = valid(unmergeVariable(merged, presets, bryo.ds, "Calliergon"));
    expect(back).toEqual({ ...unmerged, datasets: [{ ...unmerged.datasets![0]!, order: ["Sphagnum", "Calliergon giganteum", "Calliergon cordifolium"] }] });
  });

  it("merging a merged taxon with another dissolves the first merge; group = first selected in display order", () => {
    const { spec: once } = mergeVariables(unmerged, presets, bryo.ds, ["Calliergon giganteum", "Calliergon cordifolium"], "*Calliergon*");
    const { spec: twice } = mergeVariables(once, presets, bryo.ds, ["Calliergon", "Scorpidium scorpioides"], "Brown mosses");
    valid(twice);
    const merges = twice.datasets![0]!.transforms!.filter((t) => t.type === "merge");
    expect(merges).toEqual([
      { type: "merge", id: "Brown mosses", name: "Brown mosses", from: ["Calliergon giganteum", "Calliergon cordifolium", "Scorpidium scorpioides"], group: "spores" },
    ]);
    expect(render([bryo.ds], twice, presets).warnings).toEqual([]);
  });
});

describe("merging with preset default transforms", () => {
  it("keeps the preset's percent transform when the entry lists none", () => {
    const spec: Spec = { ...pollen.spec, datasets: [{ dataset: "demo-pollen" }] };
    expect(render([pollen.ds], spec, presets).svg).toBe(render([pollen.ds], pollen.spec, presets).svg); // preset supplies percent
    const { spec: merged } = mergeVariables(spec, presets, pollen.ds, ["Poaceae", "Cyperaceae"], "Grasses & sedges");
    expect(valid(merged).datasets![0]!.transforms).toEqual([
      { type: "merge", id: "Grasses & sedges", name: "Grasses & sedges", from: ["Poaceae", "Cyperaceae"], group: "herbs" },
      { type: "percent", sum: "terrestrial" },
    ]);
  });
});
