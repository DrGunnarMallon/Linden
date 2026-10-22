import { describe, expect, it } from "vitest";
import { importDelimited } from "../src/io/delimited.js";
import { parseProject, serializeProject } from "../src/io/project.js";
import { parseSpec } from "../src/io/spec.js";
import { SPEC_VERSION } from "../src/model/spec.js";
import { readRepoFile } from "./fixtures.js";

const datasets = importDelimited(readRepoFile("examples/demo-pollen.csv"), { name: "demo-pollen" }).datasets;
const spec = parseSpec(readRepoFile("examples/demo-pollen.spec.json"));
if (!spec.ok) throw new Error("fixture invalid");

describe("project bundle (.linden.json)", () => {
  it("round-trips spec and data exactly, keeping 0 and null apart", () => {
    const ds = { ...datasets[0]!, values: datasets[0]!.values.map((r, i) => (i === 0 ? [0, null, ...r.slice(2)] : r)) };
    const text = serializeProject({ spec: spec.value, datasets: [ds] });
    const back = parseProject(text);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.value.spec).toEqual(spec.value);
    expect(back.value.datasets).toEqual([ds]);
    expect(back.value.datasets[0]!.values[0]!.slice(0, 2)).toEqual([0, null]);
    expect(JSON.parse(text)).toMatchObject({ format: "linden-project", bundleVersion: 2, generator: "Linden 0.0.0" });
  });

  it("keeps the imported snapshot apart from the edited data (bundle v2)", () => {
    const edited = { ...datasets[0]!, values: datasets[0]!.values.map((r, i) => (i === 0 ? [7, ...r.slice(1)] : r)) };
    const back = parseProject(serializeProject({ spec: spec.value, datasets: [edited], imported: datasets }));
    expect(back.ok && back.value.datasets).toEqual([edited]);
    expect(back.ok && back.value.imported).toEqual(datasets);
    // A blank project has an empty snapshot.
    const blank = parseProject(serializeProject({ spec: spec.value, datasets: [edited], imported: [] }));
    expect(blank.ok && blank.value.imported).toEqual([]);
  });

  it("migrates a version-1 bundle: its datasets become the imported snapshot", () => {
    const v1 = { format: "linden-project", bundleVersion: 1, spec: spec.value, datasets };
    const back = parseProject(JSON.stringify(v1));
    expect(back.ok && back.value.imported).toEqual(datasets);
    expect(back.ok && back.value.datasets).toEqual(datasets);
  });

  it("migrates an old spec inside a bundle", () => {
    const old = { format: "linden-project", bundleVersion: 1, spec: { specVersion: 1, panels: [] }, datasets: [] };
    const back = parseProject(old);
    expect(back.ok && back.value.spec.specVersion).toBe(SPEC_VERSION);
  });

  it("reports readable errors", () => {
    expect(parseProject("{")).toMatchObject({ ok: false });
    expect(parseProject({ spec: {}, datasets: [] })).toMatchObject({ ok: false, errors: expect.arrayContaining([expect.stringContaining("format")]) });
    const ds = { ...datasets[0]!, values: [[1]] };
    const bad = parseProject({ format: "linden-project", bundleVersion: 1, spec: spec.value, datasets: [ds] });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors).toContain(`datasets[0].values: 1 rows for ${ds.samples.length} samples`);
    const badSpec = parseProject({ format: "linden-project", bundleVersion: 1, spec: { specVersion: 5, panels: 3 }, datasets: [] });
    expect(badSpec.ok || badSpec.errors[0]).toMatch(/^spec\.panels: /);
  });

  it("refuses non-finite values instead of turning them into null", () => {
    const ds = { ...datasets[0]!, values: [[Number.NaN]] };
    expect(() => serializeProject({ spec: spec.value, datasets: [ds] })).toThrow(/non-finite/);
  });
});
