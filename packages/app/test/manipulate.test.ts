import { groupRowHeight, makeTheme, render, resolveSpec, type Dataset, type Spec } from "@linden/core";
import { describe, expect, it } from "vitest";
import {
  applyResize,
  applyZoneDepth,
  depthAtY,
  geometryAt,
  groupRuns,
  hitPanel,
  hitPreview,
  hitZone,
  resizeLabel,
  resizeTarget,
  resizeTo,
  snapDepth,
  yOfDepth,
} from "../src/manipulate";

/** Two percent taxa (max 40 and 10 %) and one count taxon at depths 10, 20, 30, 40. */
const ds: Dataset = {
  id: "d",
  name: "d",
  depthUnit: "cm",
  samples: [10, 20, 30, 40].map((depth) => ({ id: String(depth), depth })),
  variables: [
    { id: "A", name: "A", kind: "percent", unit: "%" },
    { id: "B", name: "B", kind: "percent", unit: "%" },
    { id: "S", name: "S", kind: "count" },
  ],
  groups: [],
  values: [
    [40, 5, 2],
    [20, 10, 1],
    [10, 0, 0],
    [0, 2, 3],
  ],
};

const percent = { type: "taxonCurves", dataset: "d", variables: { kinds: ["percent"] }, style: { minWidth: 0 } } as const;
const counts = { type: "taxonCurves", dataset: "d", variables: { kinds: ["count"] }, style: { commonScale: false, minWidth: 0 } } as const;
const base: Spec = {
  specVersion: 7,
  page: { width: 120, height: 80 },
  panels: [{ type: "yAxis" }, percent, counts],
  overlays: [{ type: "zones", manual: [{ depth: 25, label: "Z" }] }],
};

const setup = (spec: Spec = base) => ({ spec, layout: render([ds], spec).layout, rs: resolveSpec(spec).spec });
const rightOf = (p: { x: number; width: number }) => p.x + p.width;

describe("hit-testing on the layout metadata", () => {
  it("finds the panel under a page point, null outside every panel", () => {
    const { layout } = setup();
    for (const p of layout.panels) expect(hitPanel(layout, p.box.x + p.box.width / 2, p.box.y + 1)).toBe(p.index);
    expect(hitPanel(layout, 1, 1)).toBeNull(); // page margin
  });

  it("grabs a zone line within the tolerance, across the panels only", () => {
    const { layout, spec } = setup();
    const y = yOfDepth(layout, 25);
    expect(hitZone(layout, spec, layout.plot.x + 5, y + 0.5, 1)).toEqual({ overlay: 0, index: 0, depth: 25 });
    expect(hitZone(layout, spec, layout.plot.x + 5, y + 2, 1)).toBeNull();
    expect(hitZone(layout, spec, layout.plot.x - 1, y, 1)).toBeNull();
    expect(depthAtY(layout, y)).toBeCloseTo(25, 9);
  });
});

describe("clicks on curves, group headers and panel backgrounds", () => {
  // A and B in group "g" (drawn with a group header), S ungrouped.
  const grouped: Dataset = { ...ds, groups: [{ id: "g", name: "G", order: 1 }], variables: ds.variables.map((v) => (v.id === "S" ? v : { ...v, group: "g" })) };
  const layout = render([grouped], base).layout;
  const rs = resolveSpec(base).spec;
  const opts = {
    groupOf: (_: number, id: string) => grouped.variables.find((v) => v.id === id)?.group,
    groupRow: groupRowHeight(makeTheme(rs.page, rs.style, rs.xScale)),
    labelAngle: rs.headerBand.angle,
  };
  const panel = layout.panels[1]!;
  const col = (id: string) => panel.columns.find((c) => c.id === id)!;
  const centre = (id: string) => panel.box.x + col(id).x + col(id).width / 2;

  it("a column's plot area or axis selects its curve; a gap between columns selects the panel", () => {
    expect(hitPreview(layout, centre("A"), layout.plot.y + 5, opts)).toEqual({ kind: "curve", panel: 1, id: "A" });
    expect(hitPreview(layout, centre("B"), layout.plot.y + layout.plot.height + 1, opts)).toEqual({ kind: "curve", panel: 1, id: "B" });
    const gap = panel.box.x + col("A").x + col("A").width + 0.3;
    expect(gap).toBeLessThan(panel.box.x + col("B").x);
    expect(hitPreview(layout, gap, layout.plot.y + 5, opts)).toEqual({ kind: "panel", panel: 1 });
    expect(hitPreview(layout, layout.panels[0]!.box.x + 1, layout.plot.y + 5, opts)).toEqual({ kind: "panel", panel: 0 });
    expect(hitPreview(layout, 1, 1, opts)).toBeNull();
  });

  it("a rotated taxon label selects its column; the group row selects the group", () => {
    const angle = (rs.headerBand.angle * Math.PI) / 180;
    const up = 2; // mm above the plot, along B's label (below the group row)
    expect(hitPreview(layout, centre("B") + up / Math.tan(angle), layout.plot.y - up, opts)).toEqual({ kind: "curve", panel: 1, id: "B" });
    expect(hitPreview(layout, centre("A"), panel.box.y + opts.groupRow / 2, opts)).toEqual({ kind: "group", panel: 1, group: "g" });
    expect(groupRuns(layout, 1, opts.groupOf)).toEqual([{ group: "g", x0: col("A").x, x1: col("B").x + col("B").width }]);
    // Ungrouped columns have no group header.
    const s = layout.panels[2]!;
    expect(hitPreview(layout, s.box.x + s.columns[0]!.x + 1, s.box.y + opts.groupRow / 2, opts)).toEqual({ kind: "panel", panel: 2 });
  });
});

describe("what a resize changes", () => {
  it("common scale → the global x-scale; independent → columnWidth; other panels → width", () => {
    const { layout, rs } = setup();
    expect(resizeTarget(rs, layout, 0)).toEqual({ panel: 0, kind: "width", start: layout.panels[0]!.box.width });
    expect(resizeTarget(rs, layout, 1)).toEqual({ panel: 1, kind: "xScale", start: 0.4 });
    expect(resizeTarget(rs, layout, 2)).toEqual({ panel: 2, kind: "columnWidth", start: 15 });
  });

  it("writes only the one value into the spec", () => {
    const { layout, rs } = setup();
    expect(applyResize(base, resizeTarget(rs, layout, 1)!, 0.5)).toEqual({ ...base, xScale: 0.5 });
    expect(applyResize(base, resizeTarget(rs, layout, 2)!, 12).panels[2]).toEqual({ ...counts, style: { ...counts.style, columnWidth: 12 } });
    expect(applyResize(base, resizeTarget(rs, layout, 0)!, 9).panels[0]).toEqual({ type: "yAxis", width: 9 });
  });
});

describe("resize model", () => {
  it("reproduces the rendered geometry at the start value", () => {
    const { layout, rs } = setup();
    for (const i of [0, 1, 2]) {
      const t = resizeTarget(rs, layout, i)!;
      geometryAt(layout, t, t.start).forEach((g, j) => {
        expect(g.x).toBeCloseTo(layout.panels[j]!.box.x, 6);
        expect(g.width).toBeCloseTo(layout.panels[j]!.box.width, 6);
      });
    }
  });

  it("x-scale: snaps to 0.5 mm per 10 %, moves later panels, and matches a real render", () => {
    const { layout, rs } = setup();
    const t = resizeTarget(rs, layout, 1)!;
    const start = layout.panels[1]!.box;
    // Drag the right edge 5.2 mm right: 50 % of extent → +0.104 mm/% → snapped to 0.5 mm per 10 %.
    const r = resizeTo(layout, t, rightOf(start) + 5.2, true);
    expect(r.value).toBe(0.5);
    expect(resizeLabel("xScale", r.value)).toBe("5 mm per 10 %");
    expect(r.limit).toBeUndefined();
    const after = render([ds], applyResize(base, t, r.value)).layout;
    r.panels.forEach((g, j) => {
      expect(g.x).toBeCloseTo(after.panels[j]!.box.x, 6);
      expect(g.width).toBeCloseTo(after.panels[j]!.box.width, 6);
    });
  });

  it("Alt (no snapping) keeps 0.01 mm per 10 %", () => {
    const { layout, rs } = setup();
    const t = resizeTarget(rs, layout, 1)!;
    const r = resizeTo(layout, t, rightOf(layout.panels[1]!.box) + 5.2, false);
    expect(r.value * 10).toBeCloseTo(5.04, 6);
  });

  it("width and column width snap to 0.5 mm", () => {
    const { layout, rs } = setup();
    const axis = resizeTarget(rs, layout, 0)!;
    expect(resizeTo(layout, axis, rightOf(layout.panels[0]!.box) + 3.3, true).value % 0.5).toBe(0);
    const col = resizeTarget(rs, layout, 2)!;
    const r = resizeTo(layout, col, rightOf(layout.panels[2]!.box) - 2.8, true);
    expect(r.value).toBe(12);
    expect(resizeLabel("columnWidth", r.value)).toBe("Column width 12 mm");
  });

  it("clamps at the page width and says why; the clamped spec still renders without fitting", () => {
    const { layout, rs } = setup();
    const t = resizeTarget(rs, layout, 1)!;
    const r = resizeTo(layout, t, rightOf(layout.panels[1]!.box) + 500, true);
    expect(r.limit).toMatch(/^Limited by the page width: 120 mm, margins 5 \+ 5 mm\.$/);
    const grown = r.panels.reduce((s, p) => s + p.width, 0) - layout.panels.reduce((s, p) => s + p.box.width, 0);
    expect(grown).toBeLessThanOrEqual(layout.slack + 1e-6);
    const after = render([ds], applyResize(base, t, r.value));
    expect(after.layout.xScale.used).toBe(r.value); // no shrinking by the fit
    expect(after.info).toEqual([]);
  });

  it("a diagram that already fills the page can only shrink", () => {
    const full = setup({ ...base, xScale: 3 });
    expect(full.layout.slack).toBeCloseTo(0, 6);
    const t = resizeTarget(full.rs, full.layout, 1)!;
    const r = resizeTo(full.layout, t, rightOf(full.layout.panels[1]!.box) + 20, true);
    expect(r.limit).toMatch(/already fills the page width/);
    expect(r.value).toBeLessThanOrEqual(full.layout.xScale.used + 1e-9);
  });

  it("stops where columns are held at minWidth instead of collapsing the x-scale", () => {
    const spec: Spec = { ...base, panels: [{ ...percent, style: { minWidth: 6 } }] };
    const { layout, rs } = setup(spec);
    const t = resizeTarget(rs, layout, 0)!;
    const r = resizeTo(layout, t, layout.panels[0]!.box.x, true);
    expect(r.limit).toMatch(/minimum width/);
    expect(r.value).toBeCloseTo(0.15, 6); // the 40 % column reaches 6 mm at 0.15 mm/%
  });
});

describe("zone drag", () => {
  it("snaps to midpoints between samples, kept in the y range", () => {
    const { layout } = setup();
    expect(snapDepth(layout, 23, true)).toBe(25);
    expect(snapDepth(layout, 28, true)).toBe(25);
    expect(snapDepth(layout, 33, true)).toBe(35);
    expect(snapDepth(layout, 33.333, false)).toBe(33.33);
    expect(snapDepth(layout, 99, false)).toBe(40);
    expect(applyZoneDepth(base, { overlay: 0, index: 0, depth: 25 }, 35).overlays).toEqual([{ type: "zones", manual: [{ depth: 35, label: "Z" }] }]);
  });
});
