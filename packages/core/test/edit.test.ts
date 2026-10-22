import { describe, expect, it } from "vitest";
import {
  addSample,
  addVariable,
  deleteSample,
  deleteVariable,
  moveVariable,
  parseCellText,
  renameVariable,
  setCell,
  setCells,
  setSampleAge,
  setSampleDepth,
  setVariableKind,
  setVariableUnit,
  sortSamplesByDepth,
} from "../src/edit/dataset.js";
import { sampleId, slugify, uniqueId, variableId } from "../src/edit/ids.js";
import { provenance, revertCell } from "../src/edit/provenance.js";
import { importDelimited } from "../src/io/delimited.js";
import { parseSpec } from "../src/io/spec.js";
import { prepareDatasets, render } from "../src/pipeline.js";
import { resolveCurveStyle } from "../src/model/resolve.js";
import type { Dataset } from "../src/model/types.js";
import { readRepoFile } from "./fixtures.js";

/** depth | A (count) | B (count, group g) | C (abundanceClass, codes) */
function small(): Dataset {
  return {
    id: "core",
    name: "core",
    depthUnit: "cm",
    samples: [
      { id: "10", depth: 10 },
      { id: "20", depth: 20 },
      { id: "30", depth: 30 },
    ],
    variables: [
      { id: "A", name: "*Alnus*", kind: "count" },
      { id: "B", name: "Betula", kind: "count", group: "g" },
      { id: "C", name: "Moss", kind: "abundanceClass", codes: ["-", "R", "D"] },
    ],
    groups: [{ id: "g", name: "g", order: 1 }],
    values: [
      [1, 0, 0],
      [2, null, 1],
      [3, 5, 2],
    ],
  };
}

const deepFreeze = <T>(x: T): T => {
  if (x && typeof x === "object") {
    Object.values(x).forEach(deepFreeze);
    Object.freeze(x);
  }
  return x;
};

describe("ids", () => {
  it("slugs names deterministically, without markup and diacritics", () => {
    expect(slugify("*Alnus glutinosa*-type")).toBe("alnus-glutinosa-type");
    expect(slugify("Poaceae (wild grass)")).toBe("poaceae-wild-grass");
    expect(slugify("Äpfel")).toBe("apfel");
    expect(slugify("***")).toBe("variable");
  });

  it("adds a counter on collision, the same every time", () => {
    const taken = new Set(["pinus", "pinus-2"]);
    expect(uniqueId("pinus", taken)).toBe("pinus-3");
    expect(variableId("*Pinus*", taken)).toBe("pinus-3");
    expect(variableId("*Pinus*", taken)).toBe("pinus-3");
    expect(variableId("Betula", taken)).toBe("betula");
    expect(sampleId(10, new Set(["10"]))).toBe("10#2");
  });

  it("gives new variables and samples ids that never change when renamed", () => {
    const a = addVariable(small(), { name: "*Pinus*" });
    expect(a.id).toBe("pinus");
    const b = addVariable(a.dataset, { name: "Pinus" });
    expect(b.id).toBe("pinus-2");
    const renamed = renameVariable(b.dataset, "pinus", "*Pinus sylvestris*").dataset;
    expect(renamed.variables.find((v) => v.id === "pinus")!.name).toBe("*Pinus sylvestris*");
    const s = addSample(renamed, { depth: 20 });
    expect(s.id).toBe("20#2");
  });
});

describe("cells: null vs 0", () => {
  it("parses typed text", () => {
    expect(parseCellText("")).toBeNull();
    expect(parseCellText("—")).toBeNull();
    expect(parseCellText("0")).toBe(0);
    expect(parseCellText("1.5")).toBe(1.5);
    expect(parseCellText("1,5")).toBe("1,5");
    expect(parseCellText("1,5", true)).toBe(1.5);
    expect(parseCellText("-")).toBe("-");
  });

  it("keeps 0 as 0 and turns empty, '-' and null into null", () => {
    const ds = deepFreeze(small());
    expect(setCell(ds, "20", "B", 0).dataset.values[1]![1]).toBe(0);
    expect(setCell(ds, "10", "B", null).dataset.values[0]![1]).toBeNull();
    expect(setCell(ds, "10", "B", "-").dataset.values[0]![1]).toBeNull();
    expect(setCell(ds, "10", "B", "").dataset.values[0]![1]).toBeNull();
    expect(setCell(ds, "10", "A", "7").dataset.values[0]![0]).toBe(7);
  });

  it("returns the same dataset when nothing changes, a new one otherwise (never mutating)", () => {
    const ds = deepFreeze(small());
    expect(setCell(ds, "10", "A", 1).dataset).toBe(ds);
    const r = setCell(ds, "10", "A", 4);
    expect(r.dataset).not.toBe(ds);
    expect(r.dataset.values[1]).toBe(ds.values[1]); // untouched rows are shared
    expect(ds.values[0]![0]).toBe(1);
  });

  it("refuses text in numeric columns and non-finite numbers", () => {
    const ds = small();
    const r = setCell(ds, "10", "A", "abc");
    expect(r.dataset).toBe(ds);
    expect(r.warnings[0]).toMatch(/not a number/);
    expect(setCell(ds, "10", "A", Number.NaN).warnings[0]).toMatch(/finite/);
  });

  it("maps text in coded columns to codes, adding new ones; '-' stays a code where used", () => {
    const ds = small();
    expect(setCell(ds, "10", "C", "D").dataset.values[0]![2]).toBe(2);
    expect(setCell(ds, "20", "C", "-").dataset.values[1]![2]).toBe(0);
    const r = setCell(ds, "10", "C", "F");
    expect(r.dataset.variables[2]!.codes).toEqual(["-", "R", "D", "F"]);
    expect(r.dataset.values[0]![2]).toBe(3);
  });

  it("writes a block (one edit) and ignores cells outside the table", () => {
    const r = setCells(small(), { sampleId: "20", variableId: "B" }, [
      ["7", "R"],
      [null, "D", "x"],
      [1, 1],
    ]);
    expect(r.dataset.values).toEqual([
      [1, 0, 0],
      [2, 7, 1],
      [3, null, 2],
    ]);
    expect(r.warnings).toEqual(["3 cells outside the table ignored."]);
  });
});

describe("variables", () => {
  it("renames only the display name", () => {
    const r = renameVariable(small(), "A", "*Alnus glutinosa*");
    expect(r.dataset.variables[0]).toEqual({ id: "A", name: "*Alnus glutinosa*", kind: "count" });
    expect(renameVariable(small(), "A", "  ").warnings[0]).toMatch(/empty/);
  });

  it("sets kind and unit", () => {
    expect(setVariableKind(small(), "A", "percent").dataset.variables[0]!.kind).toBe("percent");
    expect(setVariableUnit(small(), "A", "grains").dataset.variables[0]!.unit).toBe("grains");
    const noUnit = setVariableUnit(setVariableUnit(small(), "A", "x").dataset, "A", "").dataset;
    expect(noUnit.variables[0]).not.toHaveProperty("unit");
  });

  it("converts text codes when a coded column becomes numeric", () => {
    const ds = { ...small(), variables: small().variables.map((v) => (v.id === "C" ? { ...v, codes: ["0", "R", "2"] } : v)) };
    const r = setVariableKind(ds, "C", "count");
    expect(r.dataset.values.map((row) => row[2])).toEqual([0, null, 2]);
    expect(r.dataset.variables[2]).not.toHaveProperty("codes");
    expect(r.warnings[0]).toMatch(/1 text code is not a number/);
  });

  it("adds an all-null column, adding its group to the data", () => {
    const r = addVariable(small(), { name: "Sphagnum", kind: "count", group: "mosses" }, 1);
    expect(r.dataset.variables.map((v) => v.id)).toEqual(["A", "sphagnum", "B", "C"]);
    expect(r.dataset.values.map((row) => row[1])).toEqual([null, null, null]);
    expect(r.dataset.groups.map((g) => [g.id, g.order])).toEqual([["g", 1], ["mosses", 2]]);
  });

  it("deletes and moves columns with their values", () => {
    expect(deleteVariable(small(), "B").dataset.values).toEqual([[1, 0], [2, 1], [3, 2]]);
    const m = moveVariable(small(), "C", 0).dataset;
    expect(m.variables.map((v) => v.id)).toEqual(["C", "A", "B"]);
    expect(m.values[1]).toEqual([1, 2, null]);
  });
});

describe("samples", () => {
  it("adds an all-null sample at its depth position", () => {
    const r = addSample(small(), { depth: 15 });
    expect(r.dataset.samples.map((s) => s.id)).toEqual(["10", "15", "20", "30"]);
    expect(r.dataset.values[1]).toEqual([null, null, null]);
    expect(r.warnings).toEqual([]);
  });

  it("deletes a sample with its row", () => {
    expect(deleteSample(small(), "20").dataset.values).toEqual([[1, 0, 0], [3, 5, 2]]);
  });

  it("changes depth keeping the id, warns about order, and sorts stably", () => {
    const r = setSampleDepth(small(), "10", 25);
    expect(r.dataset.samples[0]).toEqual({ id: "10", depth: 25 });
    expect(r.warnings[0]).toMatch(/not in increasing order/);
    const sorted = sortSamplesByDepth(r.dataset).dataset;
    expect(sorted.samples.map((s) => s.id)).toEqual(["20", "10", "30"]);
    expect(sorted.values[1]).toEqual([1, 0, 0]);
    expect(sortSamplesByDepth(sorted).dataset).toBe(sorted);
  });

  it("sets and clears ages", () => {
    const a = setSampleAge(small(), "10", 1200).dataset;
    expect(a.samples[0]!.age).toBe(1200);
    expect(setSampleAge(a, "10", null).dataset.samples[0]).toEqual({ id: "10", depth: 10 });
  });
});

describe("rename keeps spec references (ids are stable)", () => {
  const ds = importDelimited(readRepoFile("examples/demo-pollen.csv"), { name: "demo-pollen" }).datasets[0]!;
  const parsed = parseSpec(readRepoFile("examples/demo-pollen.spec.json"));
  if (!parsed.ok) throw new Error("fixture invalid");
  const spec = {
    ...parsed.value,
    preset: undefined,
    datasets: parsed.value.datasets!.map((e) => ({ ...e, assignments: { Sphagnum: "herbs" } })),
    curveStyles: { Sphagnum: { type: "bars" as const, fill: { colour: "#ff0000" } } },
  };

  it("keeps the variable's own curve style and its group assignment", () => {
    const renamed = renameVariable(ds, "Sphagnum", "*Sphagnum* spp.").dataset;
    const prepared = prepareDatasets([renamed], spec, []).datasets[0]!;
    const v = prepared.variables.find((x) => x.id === "Sphagnum")!;
    expect(v.name).toBe("*Sphagnum* spp.");
    expect(v.group).toBe("herbs");
    const style = resolveCurveStyle(spec, "Sphagnum", { dataset: renamed });
    expect(style.style.type).toBe("bars");
    expect(style.source["fill.colour"]).toBe("variable");
    const svg = render([renamed], spec, []).svg;
    expect(svg).toContain("spp.");
    expect(svg).toContain("#ff0000");
  });
});

describe("provenance", () => {
  it("marks edited cells by id, survives sorting and inserted rows, and reverts", () => {
    const snapshot = deepFreeze(small());
    let ds: Dataset = setCell(snapshot, "20", "A", 9).dataset;
    ds = addSample(ds, { depth: 5 }).dataset; // row 0 is new
    ds = setCell(ds, "20", "C", "F").dataset; // new code
    const p = provenance(snapshot);
    const edited = ds.values.flatMap((row, i) => row.flatMap((_, j) => (p.isEdited(ds, i, j) ? [`${ds.samples[i]!.id}/${ds.variables[j]!.id}`] : [])));
    expect(edited).toEqual(["20/A", "20/C"]);
    expect(p.imported("5", "A")).toBeUndefined();
    expect(p.imported("20", "C")).toEqual({ value: 1, code: "R" });

    const back = revertCell(revertCell(ds, snapshot, "20", "A").dataset, snapshot, "20", "C").dataset;
    expect(back.values[2]).toEqual([2, null, 1]);
    expect(back.values.some((row, i) => row.some((_, j) => p.isEdited(back, i, j)))).toBe(false);
    expect(revertCell(ds, undefined, "20", "A").warnings[0]).toMatch(/no imported value/);
  });
});
