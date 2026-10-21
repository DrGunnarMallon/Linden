import { readFileSync } from "node:fs";
import { importDelimited, parsePreset, parseSpec, render, type Preset, type Spec } from "@linden/core";
import { describe, expect, it } from "vitest";
import { ensureDatasetInSpec, removeDatasetFromSpec, setVariableVisible, variableVisibility } from "../src/specEdit";

const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8");
const ds = importDelimited(read("examples/demo-pollen.csv"), { name: "demo-pollen" }).datasets[0]!;
const preset = parsePreset(read("presets/pollen-percent.json"));
const presets: Preset[] = preset.ok ? [preset.value] : [];
const parsed = parseSpec(read("examples/demo-pollen.spec.json"));
if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
const demo: Spec = parsed.value;

const curves = (s: Spec) => s.panels.filter((p) => p.type === "taxonCurves");
const shown = (s: Spec) => [...variableVisibility(s, presets, ds)].filter(([, v]) => v.visible).map(([id]) => id);

describe("variable visibility edits", () => {
  it("reads visibility from the panel's group selection", () => {
    expect(shown(demo)).toEqual(ds.variables.map((v) => v.id));
  });

  it("hiding a group-selected variable expands the groups into ids; showing it again appends to ids", () => {
    const hidden = setVariableVisible(demo, presets, ds, "Pinus", false);
    expect(curves(hidden)[0]).toMatchObject({ variables: { groups: [], ids: ["Betula", "Quercus", "Corylus", "Poaceae", "Cyperaceae", "Artemisia", "Sphagnum"] } });
    expect(shown(hidden)).not.toContain("Pinus");
    expect(render([ds], hidden, presets).svg).not.toContain(">Pinus<");

    const back = setVariableVisible(hidden, presets, ds, "Pinus", true);
    expect(shown(back)).toEqual(ds.variables.map((v) => v.id));
  });

  it("removes an explicit id without touching groups", () => {
    const spec: Spec = { ...demo, panels: [{ type: "taxonCurves", dataset: "demo-pollen", variables: { groups: ["trees"], ids: ["Poaceae"] } }] };
    const out = setVariableVisible(spec, presets, ds, "Poaceae", false);
    expect(out.panels[0]).toMatchObject({ variables: { groups: ["trees"], ids: [] } });
  });

  it("never empties a panel (empty selection would mean all)", () => {
    const spec: Spec = { ...demo, panels: [{ type: "taxonCurves", dataset: "demo-pollen", variables: { ids: ["Pinus"] } }] };
    expect(variableVisibility(spec, presets, ds).get("Pinus")).toEqual({ visible: true, canHide: false });
    expect(setVariableVisible(spec, presets, ds, "Pinus", false)).toEqual(spec);
  });

  it("does not mutate its input", () => {
    const before = JSON.stringify(demo);
    setVariableVisible(demo, presets, ds, "Pinus", false);
    expect(JSON.stringify(demo)).toBe(before);
  });
});

describe("dataset wiring", () => {
  it("adds entry, y axis and panel for a new dataset, and removes them again", () => {
    const empty: Spec = { specVersion: 1, panels: [] };
    const coreA = { ...ds, id: "core-a", groups: [] };
    const added = ensureDatasetInSpec(empty, coreA);
    expect(added).toEqual({ specVersion: 1, datasets: [{ dataset: "core-a" }], panels: [{ type: "yAxis" }, { type: "taxonCurves", dataset: "core-a" }] });
    expect(ensureDatasetInSpec(added, coreA)).toBe(added);
    expect(removeDatasetFromSpec(added, "core-a")).toEqual({ specVersion: 1, datasets: [], panels: [{ type: "yAxis" }] });
  });

  it("the CSV group row seeds the new entry's groups on import; an existing entry keeps its own", () => {
    const empty: Spec = { specVersion: 5, panels: [] };
    const added = ensureDatasetInSpec(empty, ds);
    expect(added.datasets![0]!.groups).toEqual(ds.groups.map((g) => ({ id: g.id, name: g.name, order: g.order })));
    expect(added.datasets![0]!.groups!.map((g) => g.id)).toEqual(["trees", "shrubs", "herbs", "spores"]);
    const own: Spec = { specVersion: 5, datasets: [{ dataset: ds.id, groups: [{ id: "x", name: "X" }] }], panels: [] };
    expect(ensureDatasetInSpec(own, ds).datasets![0]!.groups).toEqual([{ id: "x", name: "X" }]);
  });
});
