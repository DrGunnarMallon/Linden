import { describe, expect, it } from "vitest";
import { renameVariable, setCell } from "../src/edit/dataset.js";
import { exportDelimited, importDelimited } from "../src/io/delimited.js";
import { datasetFromClipboard, parseClipboard, type ClipboardTable } from "../src/io/paste.js";
import { readRepoFile } from "./fixtures.js";

/** Rows of cells → clipboard text as spreadsheets put it (tabs, CRLF, trailing newline). */
const tsv = (rows: string[][]) => `${rows.map((r) => r.join("\t")).join("\r\n")}\r\n`;

const build = (t: ClipboardTable, depthColumn = t.depthColumn!) =>
  datasetFromClipboard(t, { id: "p", name: "p", depthUnit: "cm", depthColumn, ageColumn: t.ageColumn, columns: t.columns });

describe("parseClipboard", () => {
  it("detects a header row, the depth and age columns, and guesses kinds", () => {
    const t = parseClipboard(
      tsv([
        ["Depth", "Age", "*Pinus*", "LOI", "Moss"],
        ["10", "1200", "12", "3.5", "R"],
        ["20", "", "0", "4", "-"],
        ["30", "2400", "", "5.25", "D"],
      ]),
    );
    expect(t.headerRows).toBe(1);
    expect(t.depthColumn).toBe(0);
    expect(t.depthCertain).toBe(true);
    expect(t.ageColumn).toBe(1);
    expect(t.decimalComma).toBe(false);
    expect(t.columns.map((c) => [c.name, c.kind])).toEqual([
      ["Depth", "count"],
      ["Age", "count"],
      ["*Pinus*", "count"],
      ["LOI", "continuous"],
      ["Moss", "abundanceClass"],
    ]);

    const { dataset, warnings } = build(t);
    expect(warnings).toEqual([]);
    expect(dataset.samples).toEqual([
      { id: "10", depth: 10, age: 1200 },
      { id: "20", depth: 20 },
      { id: "30", depth: 30, age: 2400 },
    ]);
    expect(dataset.variables.map((v) => [v.id, v.name, v.kind])).toEqual([
      ["pinus", "*Pinus*", "count"],
      ["loi", "LOI", "continuous"],
      ["moss", "Moss", "abundanceClass"],
    ]);
    expect(dataset.variables[2]!.codes).toEqual(["R", "-", "D"]);
    // 0 stays 0, empty is null.
    expect(dataset.values).toEqual([
      [12, 3.5, 0],
      [0, 4, 1],
      [null, 5.25, 2],
    ]);
  });

  it("without a header: no header rows, first numeric column as an uncertain depth guess", () => {
    const t = parseClipboard(tsv([["x", "10", "1"], ["y", "20", "2"]]));
    expect(t.headerRows).toBe(0);
    expect(t.depthColumn).toBe(1);
    expect(t.depthCertain).toBe(false);
    expect(t.ageColumn).toBeUndefined();
    expect(t.columns.map((c) => c.name)).toEqual(["Column 1", "Column 2", "Column 3"]);
    const { dataset } = build(t);
    expect(dataset.samples.map((s) => s.depth)).toEqual([10, 20]);
    expect(dataset.variables.map((v) => v.id)).toEqual(["column-1", "column-3"]);
  });

  it("reads a single pasted value", () => {
    const t = parseClipboard("4.5");
    expect(t.cells).toEqual([["4.5"]]);
    expect(t.headerRows).toBe(0);
  });

  it("accepts decimal commas when the clipboard clearly uses them, and reports it", () => {
    const t = parseClipboard(tsv([["depth", "LOI"], ["10", "0,5"], ["20,5", "12,25"]]));
    expect(t.decimalComma).toBe(true);
    expect(t.warnings[0]).toMatch(/decimal commas/);
    expect(build(t).dataset.values).toEqual([[0.5], [12.25]]);
    expect(build(t).dataset.samples.map((s) => s.depth)).toEqual([10, 20.5]);
  });

  it("does not guess decimal commas when dots are used too, or when commas look like thousands", () => {
    expect(parseClipboard(tsv([["depth", "a"], ["10", "0,5"], ["20", "1.5"]])).decimalComma).toBe(false);
    const t = parseClipboard(tsv([["depth", "a"], ["10", "1,234"]]));
    expect(t.decimalComma).toBe(false);
    expect(t.warnings[0]).toMatch(/thousands separator/);
  });

  it("reads group / kind / unit rows under the header (e.g. an exported CSV)", () => {
    const t = parseClipboard(tsv([["depth", "A", "B"], ["group", "trees", ""], ["kind", "percent", "count"], ["unit", "%", ""], ["10", "1", "2"]]));
    expect(t.headerRows).toBe(4);
    expect(t.columns[1]).toEqual({ index: 1, name: "A", kind: "percent", unit: "%", group: "trees" });
    const ds = build(t).dataset;
    expect(ds.groups).toEqual([{ id: "trees", name: "trees", order: 1 }]);
    expect(ds.values).toEqual([[1, 2]]);
  });

  it("skips rows without a numeric depth with a warning", () => {
    const t = parseClipboard(tsv([["depth", "a"], ["10", "1"], ["n/a", "2"]]));
    const r = build(t);
    expect(r.dataset.samples).toHaveLength(1);
    expect(r.warnings).toContain('Row 3: depth "n/a" is not a number; row skipped.');
  });
});

describe("CSV export", () => {
  const ds = importDelimited(readRepoFile("examples/demo-pollen.csv"), { name: "demo-pollen" }).datasets[0]!;

  it("round-trips an imported dataset exactly (0 and null kept apart)", () => {
    const text = exportDelimited(ds);
    expect(text.split("\n").slice(0, 3)).toEqual([
      "depth,age,*Betula*,*Pinus*,*Quercus*,*Corylus*,Poaceae,Cyperaceae,*Artemisia*,*Sphagnum*",
      "group,,trees,trees,trees,shrubs,herbs,herbs,herbs,spores",
      "kind,,count,count,count,count,count,count,count,count",
    ]);
    const back = importDelimited(text, { name: "demo-pollen" });
    expect(back.warnings).toEqual([]);
    expect(back.datasets[0]).toEqual(ds);
  });

  it("round-trips edits: renamed ids (id row), units, quoting, codes, decimals", () => {
    let edited = renameVariable(ds, "Betula", '*Betula* "tree", birch').dataset;
    edited = setCell(edited, "10", "Pinus", 0.125).dataset;
    edited = { ...edited, variables: edited.variables.map((v) => (v.id === "Poaceae" ? { ...v, unit: "grains" } : v)) };
    const macro = importDelimited(readRepoFile("examples/macrofossil-counts.csv"), { name: "macro" }).datasets[0]!;
    for (const d of [edited, macro]) {
      const text = exportDelimited(d);
      const back = importDelimited(text, { name: d.id }).datasets[0]!;
      expect(back.variables).toEqual(d.variables);
      expect(back.values).toEqual(d.values);
      expect(back.samples.map((s) => [s.depth, s.age])).toEqual(d.samples.map((s) => [s.depth, s.age]));
    }
    expect(exportDelimited(edited).split("\n")[1]).toMatch(/^id,,Betula,Pinus,/);
  });
});
