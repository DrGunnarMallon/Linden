import { z } from "zod/v4";
import { describe, expect, it } from "vitest";
import { defaultValue, describeSchema, formNodes, humanize, matchesNode } from "../src/model/schemaForm.js";
import { SpecSchema } from "../src/model/spec.js";
import { SPEC_FORM_HINTS, SPEC_FORM_SECTIONS, specForm } from "../src/model/specForm.js";

const nodes = formNodes(specForm());
const byPath = (path: string) => nodes.filter((n) => n.path === path);

describe("spec form description", () => {
  it("describes every schema node (no unsupported zod types)", () => {
    expect(nodes.filter((n) => n.kind === "unsupported").map((n) => n.path)).toEqual([]);
  });

  it("every hint refers to a path that exists in the schema (no stale hints)", () => {
    const paths = new Set(nodes.map((n) => n.path));
    expect(Object.keys(SPEC_FORM_HINTS.hints).filter((p) => !paths.has(p))).toEqual([]);
    for (const [from, to] of Object.entries(SPEC_FORM_HINTS.aliases ?? {})) {
      expect(paths.has(from) && paths.has(to)).toBe(true);
    }
  });

  it("every hinted field order names existing fields (of any variant at that path)", () => {
    // Only orders hinted at the path itself: an aliased one may name keys the target omits.
    for (const [path, hint] of Object.entries(SPEC_FORM_HINTS.hints)) {
      if (!hint.order) continue;
      const keys = byPath(path).flatMap((o) => (o.kind === "object" ? o.fields.map((f) => f.key) : []));
      expect(hint.order.filter((k) => !keys.includes(k)), path).toEqual([]);
    }
  });

  it("sections name only top-level fields, each at most once", () => {
    const root = specForm();
    if (root.kind !== "object") throw new Error("root is not an object");
    const top = root.fields.map((f) => f.key);
    const listed = SPEC_FORM_SECTIONS.flatMap((s) => s.fields);
    expect(listed.filter((k) => !top.includes(k))).toEqual([]);
    expect(new Set(listed).size).toBe(listed.length);
  });

  it("reads limits, enums, literals and discriminated unions from the schema", () => {
    expect(byPath("headerBand.angle")[0]).toMatchObject({ kind: "number", min: 10, max: 90, hint: { unit: "°" } });
    expect(byPath("page.width")[0]).toMatchObject({ kind: "number", exclusiveMin: 0, hint: { unit: "mm" } });
    expect(byPath("groupHeaders.line")[0]).toMatchObject({ kind: "enum", options: ["line", "bracket", "none"] });
    const panels = byPath("panels[]").find((n) => n.kind === "variants");
    expect(panels).toMatchObject({ discriminator: "type" });
    if (panels?.kind === "variants") expect(panels.variants.map((v) => v.value)).toEqual(["yAxis", "taxonCurves"]);
    expect(byPath("yAxis.range")[0]).toMatchObject({ kind: "nullable", inner: { kind: "tuple" } });
  });

  it("overrides reuse the panel style hints through the alias", () => {
    expect(byPath("panels[].overrides{}.mode")[0]?.hint.optionLabels).toMatchObject({ silhouette: "Silhouette" });
  });

  it("orders object fields by hint, then schema order", () => {
    const yAxis = byPath("yAxis")[0];
    if (yAxis?.kind !== "object") throw new Error("yAxis is not an object");
    expect(yAxis.fields.map((f) => f.key)).toEqual(["primary", "secondary", "reverse", "range", "ticks", "titles"]);
  });
});

describe("defaultValue", () => {
  it("gives a valid new item for every array and record in the spec", () => {
    for (const n of nodes) {
      if (n.kind !== "variants") continue;
      for (const v of n.variants) expect(matchesNode(n, defaultValue(v.node)), `${n.path} ${v.value}`).toBe(true);
    }
    // A new panel / overlay / transform of each type validates in a spec.
    const panels = byPath("panels[]").find((n) => n.kind === "variants")!;
    const overlays = byPath("overlays[]").find((n) => n.kind === "variants")!;
    const transforms = byPath("datasets[].transforms[]").find((n) => n.kind === "variants")!;
    if (panels.kind !== "variants" || overlays.kind !== "variants" || transforms.kind !== "variants") throw new Error();
    const spec = {
      specVersion: 6,
      panels: panels.variants.map((v) => defaultValue(v.node)),
      overlays: overlays.variants.map((v) => defaultValue(v.node)),
      datasets: [{ dataset: "d", transforms: transforms.variants.map((v) => defaultValue(v.node)) }],
    };
    expect(SpecSchema.safeParse(spec).error?.issues).toBeUndefined();
  });

  it("respects lower bounds and minimum lengths", () => {
    const hints = { hints: {} };
    expect(defaultValue(describeSchema(z.number().positive(), hints))).toBe(1);
    expect(defaultValue(describeSchema(z.number().min(10).max(90), hints))).toBe(10);
    expect(defaultValue(describeSchema(z.array(z.string()).min(1), hints))).toEqual([""]);
    expect(defaultValue(describeSchema(z.strictObject({ a: z.string().min(1), b: z.number().optional() }), hints))).toEqual({ a: "new" });
  });
});

describe("helpers", () => {
  it("humanizes keys", () => {
    expect(humanize("minFontSize")).toBe("Min font size");
    expect(humanize("page")).toBe("Page");
  });

  it("matches union branches structurally", () => {
    const order = byPath("panels[].variables.order").find((n) => n.kind === "union")!;
    if (order.kind !== "union") throw new Error();
    expect(order.options.findIndex((o) => matchesNode(o, "alphabetical"))).toBe(0);
    expect(order.options.findIndex((o) => matchesNode(o, ["Pinus"]))).toBe(1);
  });

  it("reports zod types it does not know as unsupported instead of throwing", () => {
    expect(describeSchema(z.date(), { hints: {} })).toMatchObject({ kind: "unsupported", zodType: "date" });
  });
});
