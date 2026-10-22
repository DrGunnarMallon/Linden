// Data tab (SPEC §11): sheet helpers and data edits through the store (undo, debounced render).
import { datasetFromClipboard, parseClipboard, renameVariable, setCell, type Dataset } from "@linden/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assignGroup, editSheetCell, insertDepth, pasteIntoSheet, pasteNeeds, sheetColumns } from "../src/dataEdit";
import { useStore } from "../src/store";

const tsv = (rows: string[][]) => rows.map((r) => r.join("\t")).join("\n");

function sheet(): Dataset {
  return {
    id: "d",
    name: "d",
    depthUnit: "cm",
    samples: [
      { id: "10", depth: 10 },
      { id: "20", depth: 20 },
    ],
    variables: [
      { id: "a", name: "A", kind: "count" },
      { id: "b", name: "B", kind: "count" },
    ],
    groups: [],
    values: [
      [1, 2],
      [3, 4],
    ],
  };
}

describe("sheet columns and typed cells", () => {
  it("maps depth, optional age and variables", () => {
    expect(sheetColumns(sheet()).map((c) => c.kind)).toEqual(["depth", "variable", "variable"]);
    const aged = { ...sheet(), samples: [{ id: "10", depth: 10, age: 100 }, { id: "20", depth: 20 }] };
    expect(sheetColumns(aged).map((c) => c.kind)).toEqual(["depth", "age", "variable", "variable"]);
  });

  it("types null with '-' or an empty cell, keeps 0, reads a decimal comma", () => {
    expect(editSheetCell(sheet(), { row: 0, col: 1 }, "-").dataset.values[0]![0]).toBeNull();
    expect(editSheetCell(sheet(), { row: 0, col: 1 }, "").dataset.values[0]![0]).toBeNull();
    expect(editSheetCell(sheet(), { row: 0, col: 1 }, "0").dataset.values[0]![0]).toBe(0);
    expect(editSheetCell(sheet(), { row: 0, col: 2 }, "0,5").dataset.values[0]![1]).toBe(0.5);
    expect(editSheetCell(sheet(), { row: 0, col: 2 }, "1,234").warnings[0]).toMatch(/not a number/);
  });

  it("never empties a depth", () => {
    const r = editSheetCell(sheet(), { row: 0, col: 0 }, "");
    expect(r.dataset).toEqual(sheet());
    expect(r.warnings[0]).toMatch(/needs a depth/);
    expect(editSheetCell(sheet(), { row: 0, col: 0 }, "12,5").dataset.samples[0]).toEqual({ id: "10", depth: 12.5 });
  });

  it("puts inserted samples halfway between neighbours or one step beyond the ends", () => {
    expect(insertDepth(sheet(), 1)).toBe(15);
    expect(insertDepth(sheet(), 2)).toBe(30);
    expect(insertDepth(sheet(), 0)).toBe(0);
    expect(insertDepth({ ...sheet(), samples: [] }, 0)).toBe(0);
  });
});

describe("paste into an existing sheet", () => {
  it("pastes at the selected cell, adding samples (pasted depths) and, if allowed, variables", () => {
    const table = parseClipboard(tsv([["20", "7", "8", "9"], ["30", "0", "", "1"]]));
    expect(pasteNeeds(sheet(), { row: 1, col: 0 }, table)).toEqual({ rows: 1, columns: 1 });
    const r = pasteIntoSheet(sheet(), { row: 1, col: 0 }, table, { addColumns: true });
    expect(r.dataset.samples.map((s) => s.depth)).toEqual([10, 20, 30]);
    expect(r.dataset.variables.map((v) => v.id)).toEqual(["a", "b", "variable-3"]);
    expect(r.dataset.values).toEqual([
      [1, 2, null],
      [7, 8, 9],
      [0, null, 1],
    ]);
    expect(r.warnings).toEqual([]);
  });

  it("drops columns that do not fit when not allowed to add them", () => {
    const table = parseClipboard(tsv([["5", "6", "7"]]));
    const r = pasteIntoSheet(sheet(), { row: 0, col: 1 }, table, { addColumns: false });
    expect(r.dataset.values[0]).toEqual([5, 6]);
    expect(r.warnings).toContain("1 pasted column outside the table ignored.");
  });

  it("continues the depth spacing for new samples without pasted depths, and says so", () => {
    const table = parseClipboard(tsv([["1"], ["2"], ["3"]]));
    const r = pasteIntoSheet(sheet(), { row: 1, col: 1 }, table, { addColumns: false });
    expect(r.dataset.samples.map((s) => s.depth)).toEqual([10, 20, 30, 40]);
    expect(r.dataset.values.map((row) => row[0])).toEqual([1, 1, 2, 3]);
    expect(r.warnings[0]).toMatch(/2 new samples were given depths/);
  });

  it("reads decimal commas when the clipboard clearly uses them", () => {
    const r = pasteIntoSheet(sheet(), { row: 0, col: 1 }, parseClipboard(tsv([["0,5", "1,25"]])), { addColumns: false });
    expect(r.dataset.values[0]).toEqual([0.5, 1.25]);
    expect(r.warnings[0]).toMatch(/decimal commas/);
  });
});

describe("group assignment of a merge source", () => {
  it("writes and removes an assignment", () => {
    const ds = { ...sheet(), variables: [{ id: "a", name: "A", kind: "count" as const, group: "g" }, sheet().variables[1]!] };
    const spec = assignGroup({ specVersion: 10, panels: [] }, ds, "a", "h");
    expect(spec.datasets).toEqual([{ dataset: "d", assignments: { a: "h" } }]);
    expect(assignGroup(spec, ds, "a", "g").datasets).toEqual([{ dataset: "d" }]);
  });
});

describe("data edits through the store", () => {
  afterEach(() => vi.useRealTimers());

  it("blank project → paste → rename a styled taxon → undo the paste; the figure follows debounced", () => {
    vi.useFakeTimers();
    const store = () => useStore.getState();
    store().newProject({ name: "Core A", depthUnit: "cm" });
    expect(store().datasets).toEqual([{ id: "core-a", name: "Core A", depthUnit: "cm", samples: [], variables: [], groups: [], values: [] }]);
    expect(store().imported).toEqual([]);
    expect(store().past).toEqual([]);
    const blank = store().datasets[0]!;

    // Paste a block from a spreadsheet into the empty sheet: one undo step.
    const table = parseClipboard(tsv([["Depth", "*Pinus*", "*Betula*"], ["10", "12", "3"], ["20", "0", ""], ["30", "8", "5"]]));
    const pasted = datasetFromClipboard(table, { id: blank.id, name: blank.name, depthUnit: "cm", depthColumn: 0, columns: table.columns }).dataset;
    store().replaceData(pasted);
    expect(store().past).toHaveLength(1);
    const svgBefore = store().svg;
    vi.advanceTimersByTime(299);
    expect(store().svg).toBe(svgBefore);
    vi.advanceTimersByTime(1);
    expect(store().svg).not.toBe(svgBefore);
    expect(store().svg).toContain("Pinus");

    // Its own style, then a rename: the id (and so the style) stays.
    store().editSpec({ ...store().spec, curveStyles: { pinus: { type: "bars" } } });
    expect(store().editData(blank.id, (d) => renameVariable(d, "pinus", "*Pinus sylvestris*"))).toEqual([]);
    vi.advanceTimersByTime(300);
    expect(store().svg).toContain("Pinus sylvestris");
    expect(store().spec.curveStyles).toEqual({ pinus: { type: "bars" } });

    // An edit that changes nothing is no undo step and no render.
    const steps = store().past.length;
    const svg = store().svg;
    store().editData(blank.id, (d) => setCell(d, "10", "pinus", 12));
    expect(store().past.length).toBe(steps);
    vi.advanceTimersByTime(300);
    expect(store().svg).toBe(svg);

    // Undo rename, style and paste: back to the blank sheet.
    store().undo();
    store().undo();
    store().undo();
    expect(store().datasets[0]).toEqual(blank);
    expect(store().spec.curveStyles).toBeUndefined();
    store().redo();
    expect(store().datasets[0]).toEqual(pasted);
  });
});
