import { describe, expect, it } from "vitest";
import { parsePreset, parseSpec, specJsonSchema } from "../src/io/spec.js";
import { readRepoFile, readRepoJson } from "./fixtures.js";

describe("parseSpec", () => {
  it("accepts the demo spec (as string or object)", () => {
    const text = readRepoFile("examples/demo-pollen.spec.json");
    const fromString = parseSpec(text);
    expect(fromString.ok).toBe(true);
    expect(parseSpec(JSON.parse(text))).toEqual(fromString);
    if (fromString.ok) expect(fromString.value.panels[1]!.type).toBe("taxonCurves");
  });

  it("reports invalid JSON", () => {
    const r = parseSpec("{ specVersion: 1");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatch(/^Invalid JSON/);
  });

  it("reports errors with readable paths", () => {
    const r = parseSpec({
      specVersion: 1,
      panels: [{ type: "yAxis" }, { type: "taxonCurves", dataset: "p", style: { mode: "wiggly" } }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toHaveLength(1);
      expect(r.errors[0]).toMatch(/^panels\[1\]\.style\.mode: /);
    }
  });

  it("reports missing fields, wrong version, unknown keys and unknown panel types", () => {
    const r = parseSpec({ specVersion: 2, page: { widht: 100 }, panels: [{ type: "pie" }] });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const paths = r.errors.map((e) => e.split(":")[0]);
      expect(paths).toEqual(expect.arrayContaining(["specVersion", "page", "panels[0].type"]));
      expect(r.errors.join("\n")).toContain("widht");
    }
    const missing = parseSpec({ specVersion: 1 });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.errors[0]).toMatch(/^panels: /);
  });

  it("rejects a malformed percent transform", () => {
    const r = parseSpec({ specVersion: 1, panels: [], datasets: [{ dataset: "p", transforms: [{ type: "percent" }] }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatch(/^datasets\[0\]\.transforms\[0\]\.sum: /);
  });
});

describe("parsePreset", () => {
  it.each(["pollen-percent", "testate-percent", "diatom-percent", "macrofossil-counts"])("accepts presets/%s.json", (name) => {
    const r = parsePreset(readRepoJson(`presets/${name}.json`));
    expect(r.ok).toBe(true);
  });
});

describe("specJsonSchema", () => {
  it("exports a JSON Schema for the spec", () => {
    const schema = specJsonSchema() as { type: string; required: string[]; properties: Record<string, unknown> };
    expect(schema.type).toBe("object");
    expect(schema.required).toEqual(expect.arrayContaining(["specVersion", "panels"]));
    expect(Object.keys(schema.properties)).toEqual(
      expect.arrayContaining(["page", "yAxis", "datasets", "panels", "overlays"]),
    );
    expect(JSON.parse(JSON.stringify(schema))).toEqual(schema);
  });
});
