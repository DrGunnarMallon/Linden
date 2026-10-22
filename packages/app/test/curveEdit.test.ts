import { readFileSync } from "node:fs";
import { importDelimited, parsePreset, parseSpec, prepareDatasets, render, type Preset, type Spec } from "@linden/core";
import { describe, expect, it } from "vitest";
import {
  applyCurveStyle,
  availableApplyTo,
  copyCurveStyle,
  curveTargets,
  curveView,
  editTargets,
  importLibraryStyles,
  leafChanges,
  MIXED,
  overriddenCount,
  removeLibraryStyle,
  resetCurveTargets,
  saveLibraryStyle,
  setCurveOption,
  toggleCurve,
  type ApplyTo,
  type CurveEnv,
  type CurveSelection,
} from "../src/curveEdit";
import { setIn } from "../src/form/paths";

const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8");
const preset = parsePreset(read("presets/pollen-percent.json"));
const presets: Preset[] = preset.ok ? [preset.value] : [];
const ds = importDelimited(read("examples/demo-pollen.csv"), { name: "demo-pollen" }).datasets[0]!;
const base = (() => {
  const r = parseSpec(read("examples/demo-pollen.spec.json"));
  if (!r.ok) throw new Error(r.errors.join("\n"));
  return r.value;
})();

function valid(spec: Spec): Spec {
  const r = parseSpec(JSON.stringify(spec));
  if (!r.ok) throw new Error(r.errors.join("\n"));
  return r.value;
}

const envOf = (spec: Spec): CurveEnv => ({ spec, presets, prepared: prepareDatasets([ds], spec, presets).datasets, layout: render([ds], spec, presets).layout });
const curves = (...ids: string[]): CurveSelection => ({ kind: "curves", curves: ids.map((id) => ({ dataset: "demo-pollen", id, panel: null })) });
const group = (g: string): CurveSelection => ({ kind: "group", dataset: "demo-pollen", group: g, panel: null });

/** What the Curve tab does for one edit: targets at the level, merged view, leaf edit written to all targets. */
function edit(spec: Spec, sel: CurveSelection, applyTo: ApplyTo, change: (level: Record<string, unknown>) => unknown): Spec {
  const env = envOf(spec);
  const targets = curveTargets(env, sel, applyTo);
  const next = editTargets(spec, targets, curveView(targets, spec), change);
  return valid(next ?? spec);
}
const viewOf = (spec: Spec, sel: CurveSelection, applyTo: ApplyTo) => {
  const targets = curveTargets(envOf(spec), sel, applyTo);
  return curveView(targets, spec);
};
/** Element drawn for a variable's curve ("path" polygon/line, "rect" bars …) and its stroke-dasharray. */
const drawn = (spec: Spec, id: string) => {
  const col = render([ds], spec, presets).svg.split(`-taxonCurves-${id}" class="column"`)[1]!;
  const m = col.match(/<g class="curve">\s*<(\w+)([^>]*)>/);
  return { el: m?.[1], dash: m?.[2]?.match(/stroke-dasharray="([^"]+)"/)?.[1] };
};

describe("curve inspector: edits land at the chosen cascade level only", () => {
  it("dashed line on one curve, bars on a group, one taxon of it back to polygon → exactly three overrides", () => {
    // 1. One curve: line type, dashed (the default level for a curve is the curve itself).
    let s = edit(base, curves("Betula"), "curve", (l) => setIn(l, ["type"], "line"));
    s = edit(s, curves("Betula"), "curve", (l) => setIn(l, ["line", "dash"], "dashed"));
    // 2. A group selected: bars for every member.
    s = edit(s, group("herbs"), "group", (l) => setIn(l, ["type"], "bars"));
    // 3. One taxon of that group back to a polygon.
    s = edit(s, curves("Poaceae"), "curve", (l) => setIn(l, ["type"], "polygon"));

    expect(s.curveStyles).toEqual({ Betula: { type: "line", line: { dash: "dashed" } }, Poaceae: { type: "polygon" } });
    expect(s.groupStyles).toEqual({ herbs: { type: "bars" } });
    // Nothing else in the spec changed.
    const { curveStyles: _c, groupStyles: _g, ...rest } = s;
    expect(rest).toEqual(base);

    expect(drawn(s, "Betula")).toMatchObject({ el: "path" });
    expect(drawn(s, "Betula").dash).toBeDefined();
    expect(drawn(s, "Cyperaceae").el).toBe("rect");
    expect(drawn(s, "Poaceae").el).toBe("path");
    expect(drawn(s, "Pinus").el).toBe("path");
  });

  it("'Apply to' writes to the group or the panel instead of the curve", () => {
    const g = edit(base, curves("Pinus"), "group", (l) => setIn(l, ["fill", "colour"], "#aa0000"));
    expect(g.groupStyles).toEqual({ trees: { fill: { colour: "#aa0000" } } });
    expect(g.curveStyles).toBeUndefined();
    const p = edit(base, curves("Pinus"), "panel", (l) => setIn(l, ["outline", "show"], false));
    expect(p.panels[1]).toMatchObject({ style: { curve: { type: "polygon", exaggeration: { show: true, factor: 10 }, outline: { show: false } } } });
    expect(p.curveStyles).toBeUndefined();
    expect(p.groupStyles).toBeUndefined();
  });

  it("resetting an option or the whole level removes it and leaves no empty objects behind", () => {
    let s = edit(base, curves("Betula"), "curve", (l) => setIn(l, ["fill", "pattern", "type"], "hatch"));
    expect(s.curveStyles).toEqual({ Betula: { fill: { pattern: { type: "hatch" } } } });
    s = edit(s, curves("Betula"), "curve", (l) => setIn(l, ["fill", "pattern", "type"], undefined));
    expect(s).toEqual(base);

    s = edit(base, curves("Betula", "Pinus"), "curve", (l) => setIn(l, ["outline", "width"], 0.3));
    const targets = curveTargets(envOf(s), curves("Betula", "Pinus"), "curve");
    expect(valid(resetCurveTargets(s, targets.map((t) => t.path)))).toEqual(base);
    // A panel level emptied by a reset drops style.curve (and an empty style), never the panel.
    const p = edit({ ...base, panels: [base.panels[0]!, { type: "taxonCurves", dataset: "demo-pollen" }] }, curves("Pinus"), "panel", (l) => setIn(l, ["nulls"], "connect"));
    expect(p.panels[1]).toEqual({ type: "taxonCurves", dataset: "demo-pollen", style: { curve: { nulls: "connect" } } });
    const back = edit(p, curves("Pinus"), "panel", (l) => setIn(l, ["nulls"], undefined));
    expect(back.panels[1]).toEqual({ type: "taxonCurves", dataset: "demo-pollen" });
  });
});

describe("curve inspector: cascade awareness", () => {
  it("inherited options name their level; options set here count per section", () => {
    const s = edit(edit(base, group("herbs"), "group", (l) => setIn(l, ["type"], "bars")), curves("Poaceae"), "curve", (l) => setIn(l, ["plus", "threshold"], 1));
    const v = viewOf(s, curves("Poaceae"), "curve");
    expect(v.type).toBe("bars");
    expect(v.sources.get("type")).toBe("from group Herbs");
    expect(v.sources.get("exaggeration.factor")).toBe("from panel 2");
    expect(v.sources.get("plus.show")).toBe("from preset pollen-percent");
    expect(v.sources.get("barWidth.value")).toBe("default");
    expect(v.own).toEqual(new Map([["plus.threshold", 1]]));
    expect(overriddenCount(v, ["presence", "plus", "valueLabels", "baseline"])).toBe(1);
    // Options of the type only: bars have no line, polygon outline yes.
    expect(v.keys.has("barWidth") && v.keys.has("outline") && !v.keys.has("line") && !v.keys.has("shape")).toBe(true);

    // The group level sees what it inherits (panel, preset), not the curve's own options.
    const gv = viewOf(s, group("herbs"), "group");
    expect(gv.own).toEqual(new Map([["type", "bars"]]));
    expect(gv.sources.get("plus.threshold")).toBe("from preset pollen-percent");
  });

  it("a presence variable is drawn with presence marks: its type comes from the data", () => {
    const pres = { ...ds, variables: ds.variables.map((v) => (v.id === "Betula" ? { ...v, kind: "presence" as const } : v)) };
    const env: CurveEnv = { spec: base, presets, prepared: prepareDatasets([pres], base, presets).datasets, layout: undefined };
    const v = curveView(curveTargets(env, curves("Betula"), "curve"), base);
    expect(v.type).toBe("presence");
    expect(v.sources.get("type")).toBe("from the data's kind");
  });
});

describe("curve inspector: multi-select", () => {
  it("equal options show their value, differing ones are Mixed; an edit sets the option on every curve", () => {
    const s = edit(base, curves("Betula"), "curve", (l) => setIn(l, ["exaggeration", "factor"], 5));
    const v = viewOf(s, curves("Betula", "Pinus"), "curve");
    expect(v.effective.get("exaggeration.factor")).toBe(MIXED);
    expect(v.own.get("exaggeration.factor")).toBe(MIXED);
    expect(v.effective.get("exaggeration.show")).toBe(true);
    expect(v.type).toBe("polygon");

    const both = edit(s, curves("Betula", "Pinus"), "curve", (l) => setIn(l, ["fill", "opacity"], 0.5));
    expect(both.curveStyles).toEqual({ Betula: { exaggeration: { factor: 5 }, fill: { opacity: 0.5 } }, Pinus: { fill: { opacity: 0.5 } } });
    // Editing one option leaves the mixed one alone; resetting the mixed one clears it everywhere.
    const reset = edit(both, curves("Betula", "Pinus"), "curve", (l) => setIn(l, ["exaggeration", "factor"], undefined));
    expect(reset.curveStyles).toEqual({ Betula: { fill: { opacity: 0.5 } }, Pinus: { fill: { opacity: 0.5 } } });
  });

  it("curves of different types show only their shared options; their groups are distinct targets", () => {
    const s = edit(base, curves("Betula"), "curve", (l) => setIn(l, ["type"], "line"));
    const v = viewOf(s, curves("Betula", "Pinus"), "curve");
    expect(v.type).toBe(MIXED);
    expect([...v.keys].sort()).toEqual(["axis", "baseline", "error", "exaggeration", "nulls", "plus", "valueLabels"]);
    expect(curveTargets(envOf(s), curves("Betula", "Pinus", "Poaceae"), "group").map((t) => t.path)).toEqual([
      ["groupStyles", "trees"],
      ["groupStyles", "herbs"],
    ]);
    expect(availableApplyTo(envOf(s), curves("Betula"))).toEqual({ curve: true, group: true, panel: true });
    expect(availableApplyTo(envOf(s), group("trees"))).toEqual({ curve: false, group: true, panel: true });
  });

  it("leaf changes ignore untouched MIXED leaves", () => {
    expect(leafChanges({ a: MIXED, b: { c: 1 } }, { a: MIXED, b: { c: 2 } })).toEqual([{ path: ["b", "c"], value: 2 }]);
    expect(leafChanges({ a: MIXED }, {})).toEqual([{ path: ["a"], value: undefined }]);
  });

  it("click selects one curve; Shift/Ctrl-click adds or removes", () => {
    const a = { dataset: "d", id: "A", panel: 1 };
    const b = { dataset: "d", id: "B", panel: 1 };
    const one = toggleCurve(null, a, false);
    expect(one).toEqual({ kind: "curves", curves: [a] });
    const two = toggleCurve(one, b, true);
    expect(two).toEqual({ kind: "curves", curves: [a, b] });
    expect(toggleCurve(two, a, true)).toEqual({ kind: "curves", curves: [b] });
    expect(toggleCurve(toggleCurve(two, a, true), b, true)).toBeNull();
    expect(toggleCurve(two, b, false)).toEqual({ kind: "curves", curves: [b] });
    expect(toggleCurve({ kind: "group", dataset: "d", group: "g", panel: null }, a, true)).toEqual({ kind: "curves", curves: [a] });
  });
});

describe("curve quick actions: copy, paste, apply, set one option", () => {
  const line = edit(base, curves("Betula"), "curve", (l) => setIn(l, ["type"], "line"));

  it("copy takes the type and the options set along the curve's cascade (not defaults); paste on three curves writes only the type", () => {
    const style = copyCurveStyle(envOf(line), curves("Betula", "Pinus"))!;
    // From the curve (type) and the panel (exaggeration); the first selected curve is copied.
    expect(style).toEqual({ type: "line", exaggeration: { show: true, factor: 10 } });
    const s = valid(applyCurveStyle(envOf(line), curves("Pinus", "Quercus", "Poaceae"), style, "curve"));
    expect(s.curveStyles).toEqual({ Betula: { type: "line" }, Pinus: { type: "line" }, Quercus: { type: "line" }, Poaceae: { type: "line" } });
    const { curveStyles: _c, ...rest } = s;
    expect(rest).toEqual(base);
    expect(drawn(s, "Poaceae").el).toBe("path");
  });

  it("paste replaces the curve's own level; options it would inherit anyway are not written", () => {
    let s = edit(base, curves("Pinus"), "curve", (l) => setIn(setIn(l, ["type"], "line"), ["line", "dash"], "dashed"));
    s = valid(applyCurveStyle(envOf(s), curves("Pinus"), { type: "bars", exaggeration: { show: true } }, "curve"));
    expect(s.curveStyles).toEqual({ Pinus: { type: "bars" } });
    // Pasting the inherited style removes the level.
    s = valid(applyCurveStyle(envOf(s), curves("Pinus"), { type: "polygon" }, "curve"));
    expect(s.curveStyles).toBeUndefined();
  });

  it("a type change compares the options with the new type's defaults", () => {
    const s = valid(applyCurveStyle(envOf(base), curves("Pinus"), { type: "bars", fill: { opacity: 0.25 } }, "curve"));
    const env = envOf(s);
    const bars = curveTargets(env, curves("Pinus"), "curve")[0]!.resolved.style;
    expect(bars).toMatchObject({ type: "bars", fill: { opacity: 0.25 } });
  });

  it("apply to group: the group gets the style and its members' own styles go, other groups keep theirs", () => {
    let s = edit(line, curves("Betula"), "curve", (l) => setIn(l, ["line", "dash"], "dashed"));
    s = edit(s, curves("Quercus"), "curve", (l) => setIn(l, ["type"], "bars"));
    s = edit(s, curves("Poaceae"), "curve", (l) => setIn(l, ["type"], "points"));
    const style = copyCurveStyle(envOf(s), curves("Betula"))!;
    s = valid(applyCurveStyle(envOf(s), curves("Betula"), style, "group"));
    expect(s.groupStyles).toEqual({ trees: { type: "line", line: { dash: "dashed" } } });
    expect(s.curveStyles).toEqual({ Poaceae: { type: "points" } });
    expect(drawn(s, "Quercus")).toMatchObject({ el: "path" });
    expect(drawn(s, "Quercus").dash).toBeDefined();
  });

  it("apply to the whole panel: the panel level gets the style, the panel's group and curve levels go", () => {
    let s = edit(line, curves("Betula"), "curve", (l) => setIn(l, ["line", "dash"], "dashed"));
    s = edit(s, group("herbs"), "group", (l) => setIn(l, ["type"], "bars"));
    s = valid(applyCurveStyle(envOf(s), curves("Betula"), copyCurveStyle(envOf(s), curves("Betula"))!, "panel"));
    expect((s.panels[1] as { style: { curve: unknown } }).style.curve).toMatchObject({ type: "line", line: { dash: "dashed" } });
    expect(s.curveStyles).toBeUndefined();
    expect(s.groupStyles).toBeUndefined();
    expect(drawn(s, "Cyperaceae").el).toBe("path");
  });

  it("copying a group copies the group's style", () => {
    const s = edit(base, group("herbs"), "group", (l) => setIn(l, ["type"], "bars"));
    expect(copyCurveStyle(envOf(s), group("herbs"))).toEqual({ type: "bars", exaggeration: { show: true, factor: 10 } });
  });

  it("set one option (Type, Hide, Exaggeration): written where it differs from the inherited value, removed where it does not", () => {
    let s = valid(setCurveOption(envOf(base), curves("Betula", "Pinus"), "curve", "type", "none"));
    expect(s.curveStyles).toEqual({ Betula: { type: "none" }, Pinus: { type: "none" } });
    s = valid(setCurveOption(envOf(s), curves("Betula", "Pinus"), "curve", "type", "polygon"));
    expect(s.curveStyles).toBeUndefined();
    s = valid(setCurveOption(envOf(s), group("herbs"), "group", "exaggeration.show", false));
    expect(s.groupStyles).toEqual({ herbs: { exaggeration: { show: false } } });
    s = valid(setCurveOption(envOf(s), group("herbs"), "group", "exaggeration.show", true));
    expect(s.groupStyles).toBeUndefined();
    expect(s).toEqual(base);
  });
});

describe("saved curve styles (spec.styleLibrary)", () => {
  it("save adds or replaces by name, remove drops the entry (and the empty library), import merges", () => {
    let s = saveLibraryStyle(base, "Moss line", { type: "line" });
    s = saveLibraryStyle(s, "Bars", { type: "bars" });
    s = saveLibraryStyle(s, "Moss line", { type: "line", line: { colour: "group" } });
    expect(valid(s).styleLibrary).toEqual([
      { name: "Moss line", style: { type: "line", line: { colour: "group" } } },
      { name: "Bars", style: { type: "bars" } },
    ]);
    s = importLibraryStyles(s, [{ name: "Bars", style: { type: "points" } }, { name: "Dots", style: { type: "presence" } }]);
    expect(s.styleLibrary?.map((x) => `${x.name}:${x.style.type}`)).toEqual(["Moss line:line", "Bars:points", "Dots:presence"]);
    s = ["Moss line", "Bars", "Dots"].reduce(removeLibraryStyle, s);
    expect(s).toEqual(base);
  });
});
