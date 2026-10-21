import { describe, expect, it } from "vitest";
import { csvImporter, detectDelimiter, importDelimited, parseDelimited } from "../src/io/delimited.js";
import { importers } from "../src/registry.js";
import { readRepoFile } from "./fixtures.js";

describe("parseDelimited", () => {
  it("handles quotes, escaped quotes, embedded delimiters and newlines, CRLF", () => {
    const text = 'a,"b,c","say ""hi"""\r\n1,"two\nlines",3\r\n';
    expect(parseDelimited(text, ",")).toEqual([
      ["a", "b,c", 'say "hi"'],
      ["1", "two\nlines", "3"],
    ]);
  });

  it("strips a BOM and keeps a trailing empty field", () => {
    expect(parseDelimited("﻿x,y,\n1,2,", ",")).toEqual([
      ["x", "y", ""],
      ["1", "2", ""],
    ]);
  });

  it("detects comma, tab and semicolon", () => {
    expect(detectDelimiter("depth,a,b\n1,2,3")).toBe(",");
    expect(detectDelimiter("depth\ta\tb\n1\t2\t3")).toBe("\t");
    expect(detectDelimiter('depth;"a,b";c\n1;2;3')).toBe(";");
  });
});

describe("importDelimited — demo-pollen.csv", () => {
  const { datasets, warnings } = importDelimited(readRepoFile("examples/demo-pollen.csv"), { name: "demo-pollen" });
  const ds = datasets[0]!;

  it("imports without warnings", () => {
    expect(warnings).toEqual([]);
    expect(datasets).toHaveLength(1);
    expect(ds.id).toBe("demo-pollen");
    expect(ds.depthUnit).toBe("cm");
  });

  it("reads samples with depth and age", () => {
    expect(ds.samples).toHaveLength(10);
    expect(ds.samples[0]).toEqual({ id: "10", depth: 10, age: 1200 });
    expect(ds.samples[9]).toEqual({ id: "100", depth: 100, age: 11700 });
  });

  it("reads variables with ids stripped of markup, groups and kinds", () => {
    expect(ds.variables.map((v) => v.id)).toEqual([
      "Betula", "Pinus", "Quercus", "Corylus", "Poaceae", "Cyperaceae", "Artemisia", "Sphagnum",
    ]);
    expect(ds.variables[0]).toEqual({ id: "Betula", name: "*Betula*", kind: "count", group: "trees" });
    expect(ds.variables[7]!.group).toBe("spores");
    expect(ds.groups.map((g) => [g.id, g.order])).toEqual([
      ["trees", 1], ["shrubs", 2], ["herbs", 3], ["spores", 4],
    ]);
  });

  it("keeps zero and null apart", () => {
    expect(ds.values[0]).toEqual([120, 85, 40, 60, 55, 20, 0, 14]);
    expect(ds.values[9]![7]).toBeNull(); // Sphagnum at 100 cm: empty cell
    expect(ds.values[9]![2]).toBe(0); // Quercus at 100 cm: "0"
  });
});

describe("importDelimited — recoverable problems give warnings", () => {
  it("duplicate column names are renamed", () => {
    const { datasets, warnings } = importDelimited("depth,A,A\n1,2,3");
    expect(datasets[0]!.variables.map((v) => v.id)).toEqual(["A", "A (2)"]);
    expect(warnings).toEqual([expect.stringContaining('Duplicate column name "A"')]);
  });

  it("non-numeric values become null", () => {
    const { datasets, warnings } = importDelimited("depth,A,B\n1,x,3");
    expect(datasets[0]!.values[0]).toEqual([null, 3]);
    expect(warnings).toEqual([expect.stringContaining('"x" is not a number')]);
  });

  it("unsorted depths are kept in file order", () => {
    const { datasets, warnings } = importDelimited("depth,A\n10,1\n5,2\n20,3");
    expect(datasets[0]!.samples.map((s) => s.depth)).toEqual([10, 5, 20]);
    expect(warnings).toEqual([expect.stringContaining("not in increasing order (first at row 3)")]);
  });

  it("unknown kinds fall back to count", () => {
    const { datasets, warnings } = importDelimited("depth,A,B\nkind,counts,continuous\n1,2,3");
    expect(datasets[0]!.variables.map((v) => v.kind)).toEqual(["count", "continuous"]);
    expect(warnings).toEqual([expect.stringContaining('Unknown kind "counts"')]);
  });

  it("non-numeric depth skips the row", () => {
    const { datasets, warnings } = importDelimited("depth,A\nabc,1\n2,3");
    expect(datasets[0]!.samples.map((s) => s.depth)).toEqual([2]);
    expect(warnings).toHaveLength(1);
  });

  it("empty input returns no datasets", () => {
    expect(importDelimited("")).toEqual({ datasets: [], warnings: ["File contains no data."] });
  });
});

describe("importDelimited — delimiters and decimals", () => {
  it("reads TSV with decimal points", () => {
    const { datasets, warnings } = importDelimited("depth\tage\tLOI\n0.5\t100\t12.25\n1.5\t\t.5");
    expect(warnings).toEqual([]);
    expect(datasets[0]!.samples).toEqual([{ id: "0.5", depth: 0.5, age: 100 }, { id: "1.5", depth: 1.5 }]);
    expect(datasets[0]!.values).toEqual([[12.25], [0.5]]);
  });

  it("reads semicolon files with decimal commas", () => {
    const { datasets, warnings } = importDelimited("depth;A\n1,5;2,25\n2;3");
    expect(warnings).toEqual([]);
    expect(datasets[0]!.samples.map((s) => s.depth)).toEqual([1.5, 2]);
    expect(datasets[0]!.values).toEqual([[2.25], [3]]);
  });
});

describe("csvImporter", () => {
  it("is registered and accepts csv/tsv", () => {
    expect(importers.get("csv")).toBe(csvImporter);
    expect(csvImporter.accepts({ name: "core.CSV" })).toBe(true);
    expect(csvImporter.accepts({ name: "core.tsv" })).toBe(true);
    expect(csvImporter.accepts({ name: "core.xlsx" })).toBe(false);
  });

  it("imports from an ArrayBuffer", async () => {
    const buf = new TextEncoder().encode("depth,A\n1,2").buffer as ArrayBuffer;
    const result = await csvImporter.import(buf, { name: "x" });
    expect(result.datasets[0]!.values).toEqual([[2]]);
  });
});
