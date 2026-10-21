import { readFileSync } from "node:fs";
import { defaultValue, formNodes, matchesNode, parseSpec, specForm, type FormNode, type ObjectNode, type Spec } from "@linden/core";
import { describe, expect, it } from "vitest";
import { CONTROLS } from "../src/form/controls";
import { formSections, isBlock, itemTitle } from "../src/form/model";
import { getIn, moveItem, pathString, removeIn, renameKey, setIn, type Path } from "../src/form/paths";
import { WIDGETS } from "../src/form/SpecForm";
import { prettySpec } from "../src/specEdit";

const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8");
const root = specForm() as ObjectNode;

/** A spec using every part of the schema: all transforms, nullables, unions, records, overrides. */
const complex = (() => {
  const demo = JSON.parse(read("examples/demo-pollen.spec.json")) as Record<string, unknown>;
  const parsed = parseSpec({
    ...demo,
    specVersion: 6,
    title: { text: "Lake *Linden*", subtitle: "Pollen", align: "centre", size: 11 },
    style: {
      background: null,
      fonts: { title: { family: "Arial", size: 10 }, ticks: { size: 6 } },
      lineWidths: { axis: 0.2, curve: 0.1 },
      tickLength: 1.5,
      colours: { axis: "#333333", text: "#000000" },
    },
    yAxis: { primary: "depth", secondary: "age", reverse: true, range: null, ticks: { major: 20, minor: 10 }, titles: { depth: "Depth (cm)", age: "" } },
    headerBand: { angle: 45, minFontSize: 5, height: null },
    datasets: [
      {
        dataset: "demo-pollen",
        groups: [{ id: "trees", name: "Trees", colour: "#2f6b3a", order: 1 }, { id: "bryophytes" }],
        assignments: { Sphagnum: "bryophytes" },
        order: ["Pinus", "Betula"],
        transforms: [
          { type: "merge", id: "Cereals", name: "Cereals", from: ["Avena", "Triticum"], keepSources: false },
          { type: "scaleMap", scale: ["classes", "dafor"], kinds: ["abundanceClass"] },
          { type: "scaleMap", map: { "+": 1, "-": null } },
          { type: "percent", sum: "terrestrial" },
        ],
        sums: { terrestrial: { includeGroups: ["trees"], includeVariables: ["Poaceae"] }, all: { includeAll: true } },
        scales: { dafor: { "-": 0, R: 1, D: 5, "?": null } },
        outsideSum: { groups: ["spores"], basis: "sumPlusGroup" },
      },
    ],
    panels: [
      { type: "yAxis", width: 12 },
      {
        type: "taxonCurves",
        dataset: "demo-pollen",
        variables: { groups: ["trees"], ids: ["Poaceae"], kinds: ["percent"], minMax: 2, order: ["Pinus", "Betula"] },
        style: { mode: "bars", exaggeration: 10, xTicks: { step: null, minSpacing: 6, unitSuffix: true }, xTitle: { text: "", show: "column" }, presence: "bar" },
        overrides: { Pinus: { exaggeration: 0, mode: "line" } },
      },
      { type: "taxonCurves", dataset: "demo-pollen", variables: { order: "alphabetical" } },
    ],
  });
  if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
  return parsed.value;
})();

/**
 * What the form shows, field by field: walks the spec the way the controls do (objects by field,
 * array items, record entries, the matching variant / union option, nullables).
 */
function formView(node: FormNode, value: unknown, path: Path = []): [string, unknown][] {
  const here: [string, unknown][] = [];
  const obj = (v: unknown) => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined);
  switch (node.kind) {
    case "object":
      return node.fields.flatMap((f) => (obj(value)?.[f.key] === undefined ? [[pathString([...path, f.key]), "(default)"] as [string, unknown]] : formView(f.node, obj(value)![f.key], [...path, f.key])));
    case "array":
      return Array.isArray(value) ? value.flatMap((v, i) => formView(node.item, v, [...path, i])) : here;
    case "tuple":
      return Array.isArray(value) ? node.items.flatMap((n, i) => formView(n, value[i], [...path, i])) : here;
    case "record":
      return Object.entries(obj(value) ?? {}).flatMap(([k, v]) => [[`${pathString(path)} key`, k] as [string, unknown], ...formView(node.value, v, [...path, k])]);
    case "nullable":
      return value === null ? [[pathString(path), null]] : formView(node.inner, value, path);
    case "union": {
      const i = node.options.findIndex((o) => matchesNode(o, value));
      return [[`${pathString(path)} option`, i], ...(i >= 0 ? formView(node.options[i]!, value, path) : [])];
    }
    case "variants": {
      const tag = obj(value)?.[node.discriminator];
      const variant = node.variants.find((v) => v.value === tag);
      return variant ? formView(variant.node, value, path) : [[pathString(path), "(unknown type)"]];
    }
    default:
      return [[pathString(path), value]];
  }
}

/** Every leaf the form shows, as concrete paths. */
const leafPaths = (node: FormNode, value: unknown, path: Path = []): Path[] =>
  formView(node, value, path)
    .filter(([p]) => !p.endsWith(" key") && !p.endsWith(" option"))
    .map(([p]) => p);

const roundTrip = (spec: Spec): Spec => {
  const parsed = parseSpec(prettySpec(spec));
  if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
  return parsed.value;
};

describe("form generator coverage", () => {
  it("every schema node maps to a control (new schema fields cannot silently lack a form)", () => {
    const nodes = formNodes(root);
    expect(nodes.length).toBeGreaterThan(100);
    for (const n of nodes) {
      expect(n.kind, n.path).not.toBe("unsupported");
      expect(CONTROLS[n.kind], `${n.path} (${n.kind})`).toBeTypeOf("function");
    }
  });

  it("every widget named in the hints exists in the app", () => {
    const named = formNodes(root).flatMap((n) => (n.hint.widget ? [n.hint.widget] : []));
    expect(named.length).toBeGreaterThan(0);
    expect(named.filter((w) => !(w in WIDGETS))).toEqual([]);
  });

  it("every visible top-level field is in a section; a new one gets its own", () => {
    const shown = formSections(root).flatMap((s) => s.fields);
    expect(new Set(shown)).toEqual(new Set(root.fields.filter((f) => !f.node.hint.hidden).map((f) => f.key)));
    expect(shown).not.toContain("specVersion");

    const analyses: FormNode = { kind: "array", path: "analyses", hint: {}, minItems: 0, item: { kind: "object", path: "analyses[]", hint: {}, fields: [] } };
    const future: ObjectNode = { ...root, fields: [...root.fields, { key: "analyses", optional: true, node: analyses }] };
    expect(formSections(future).at(-1)).toEqual({ id: "analyses", title: "Analyses", fields: ["analyses"] });
  });

  it("panels are cards titled by type and dataset", () => {
    const panels = root.fields.find((f) => f.key === "panels")!.node;
    if (panels.kind !== "array") throw new Error("panels is not an array");
    expect(isBlock(panels.item)).toBe(true);
    expect(itemTitle(panels, complex.panels[1], 1)).toBe("2. Taxon curves · demo-pollen");
    expect(itemTitle(panels, complex.panels[0], 0)).toBe("1. Y axis");
  });
});

describe("form → JSON → form", () => {
  it("re-entering every value the form shows leaves the spec and the form unchanged", () => {
    let edited: Spec = complex;
    for (const p of leafPaths(root, complex)) {
      const v = getIn(complex, p);
      if (v !== undefined) edited = setIn(edited, p, v);
    }
    // Drag a panel down and back up.
    edited = moveItem(moveItem(edited, ["panels"], 0, 2), ["panels"], 2, 0);
    expect(prettySpec(edited)).toBe(prettySpec(complex)); // same JSON text, key order included
    const back = roundTrip(edited);
    expect(back).toEqual(complex);
    expect(formView(root, back)).toEqual(formView(root, complex));
  });

  it("form edits reach the JSON and come back exactly, touching nothing else", () => {
    const panels = root.fields.find((f) => f.key === "panels")!.node;
    if (panels.kind !== "array" || panels.item.kind !== "variants") throw new Error("panels is not a list of variants");
    const newPanel = { ...(defaultValue(panels.item.variants.find((v) => v.value === "taxonCurves")!.node) as object), dataset: "demo-pollen" };

    let s: Spec = complex;
    s = setIn(s, ["panels", 1, "style", "exaggeration"], 5);
    s = setIn(s, ["title", "text"], "Lake *Linden* (rev.)");
    s = removeIn(s, ["style", "background"]);
    s = setIn(s, ["yAxis", "range"], [0, 200]);
    s = renameKey(s, ["datasets", 0, "sums"], "all", "everything");
    s = setIn(s, ["panels", 3], newPanel);
    s = moveItem(s, ["panels"], 3, 1);
    s = removeIn(s, ["overlays", 0]);
    const parsed = parseSpec(s);
    expect(parsed.ok).toBe(true);

    const back = roundTrip(s);
    expect(back).toEqual(s);
    expect(formView(root, back)).toEqual(formView(root, s));
    expect(back.panels.map((p) => p.type)).toEqual(["yAxis", "taxonCurves", "taxonCurves", "taxonCurves"]);
    expect(Object.keys(back.datasets![0]!.sums!)).toEqual(["terrestrial", "everything"]);
    expect(back.style).not.toHaveProperty("background");
    // Everything not edited is as before.
    expect(back.datasets![0]!.transforms).toEqual(complex.datasets![0]!.transforms);
    expect(back.headers).toEqual(complex.headers);
  });
});

describe("path edits", () => {
  const base = { a: { b: 1, c: [1, 2, 3] }, d: "x" };

  it("set creates missing containers and keeps key order", () => {
    expect(Object.keys(setIn(base, ["a", "b"], 2).a)).toEqual(["b", "c"]);
    expect(setIn({}, ["p", "q", 0], "v")).toEqual({ p: { q: ["v"] } });
    expect(setIn(base, ["a", "c", 1], 9).a.c).toEqual([1, 9, 3]);
    expect(base.a.c).toEqual([1, 2, 3]); // immutable
  });

  it("removes keys and array items", () => {
    expect(removeIn(base, ["a", "b"])).toEqual({ a: { c: [1, 2, 3] }, d: "x" });
    expect(removeIn(base, ["a", "c", 0]).a.c).toEqual([2, 3]);
  });

  it("moves items and renames keys in place", () => {
    expect(moveItem(base, ["a", "c"], 0, 2).a.c).toEqual([2, 3, 1]);
    expect(Object.keys(renameKey(base, [], "a", "z"))).toEqual(["z", "d"]);
    expect(renameKey(base, [], "a", "d")).toBe(base); // target exists: no-op
  });

  it("formats paths like parseSpec errors", () => {
    expect(pathString(["panels", 1, "style", "mode"])).toBe("panels[1].style.mode");
  });
});
