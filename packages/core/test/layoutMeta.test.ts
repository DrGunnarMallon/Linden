import { describe, expect, it } from "vitest";
import type { Spec } from "../src/model/spec.js";
import type { Dataset } from "../src/model/types.js";
import { render } from "../src/pipeline.js";

/** Two percent taxa (max 40 and 10 %) and one count taxon at four depths. */
const ds: Dataset = {
  id: "d",
  name: "d",
  depthUnit: "cm",
  samples: [10, 20, 40, 30].map((depth) => ({ id: String(depth), depth })),
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

const spec = (over: Partial<Spec> = {}, style: object = {}): Spec => ({
  specVersion: 7,
  page: { width: 180, height: 100 },
  panels: [{ type: "yAxis" }, { type: "taxonCurves", dataset: "d", variables: { kinds: ["percent"] }, style: { minWidth: 0, ...style } }],
  ...over,
});

/** Left edges of the panel groups in the SVG (translate x). */
function panelXs(svg: string): number[] {
  return [...svg.matchAll(/<g id="panel-\d+-\w+" transform="translate\(([\d.]+),/g)].map((m) => Number(m[1]));
}

describe("layout metadata (render().layout)", () => {
  it("gives each panel's box in page mm, matching where the SVG draws it", () => {
    const { svg, layout } = render([ds], spec());
    expect(layout.panels.map((p) => p.type)).toEqual(["yAxis", "taxonCurves"]);
    expect(layout.panels.map((p) => p.box.x)).toEqual(panelXs(svg).map((x) => expect.closeTo(x, 2)));
    const [axis, curves] = layout.panels;
    expect(curves!.box.x).toBeCloseTo(axis!.box.x + axis!.box.width + layout.panelGap, 9);
    // Box spans header band + plot + footer band.
    expect(curves!.box.y).toBeCloseTo(layout.plot.y - layout.headerHeight, 9);
    expect(curves!.box.height).toBeCloseTo(layout.headerHeight + layout.plot.height + layout.footerHeight, 9);
    expect(layout.plot.width).toBeCloseTo(axis!.box.width + layout.panelGap + curves!.box.width, 9);
  });

  it("describes the columns: common-scale width = extent × x factor; panel width = last column's right edge", () => {
    const { layout } = render([ds], spec());
    const cols = layout.panels[1]!.columns;
    expect(cols.map((c) => [c.id, c.sizing, c.extent])).toEqual([
      ["A", "scale", 40],
      ["B", "scale", 10],
    ]);
    expect(cols[0]!.width).toBeCloseTo(40 * 0.4, 9);
    expect(cols[1]!.x).toBeCloseTo(cols[0]!.width + 1, 9); // column gap 1 mm
    expect(cols[1]!.x + cols[1]!.width).toBeCloseTo(layout.panels[1]!.box.width, 9);
    expect(layout.panels[0]!.columns).toEqual([]); // yAxis: no columns
  });

  it("reports the x factor and the page width left before fitting", () => {
    const roomy = render([ds], spec()).layout;
    expect(roomy.xScale).toEqual({ natural: 0.4, used: 0.4 });
    expect(roomy.slack).toBeGreaterThan(100);
    // Too wide at 4 mm per %: fitted, so nothing is left and the used factor is smaller.
    const tight = render([ds], spec({ xScale: 4 })).layout;
    expect(tight.xScale.natural).toBe(4);
    expect(tight.xScale.used).toBeLessThan(4);
    expect(tight.slack).toBeCloseTo(0, 6);
  });

  it("lists the distinct sample depths (ascending) and the y domain", () => {
    const { layout } = render([ds], spec());
    expect(layout.depths).toEqual([10, 20, 30, 40]);
    expect(layout.y).toEqual({ domain: [10, 40], reverse: true, primary: "depth" });
  });
});

describe("xScale and columnWidth (spec v7)", () => {
  it("xScale sets the natural mm per % of every common-scale column", () => {
    const at = (xScale?: number) => render([ds], spec(xScale === undefined ? {} : { xScale })).layout.panels[1]!.columns;
    expect(at()[0]!.width).toBeCloseTo(16, 9); // default 0.4 mm per %
    expect(at(0.5)[0]!.width).toBeCloseTo(20, 9);
    expect(at(0.5)[1]!.width).toBeCloseTo(5, 9);
  });

  it("fitting still shrinks from the spec's xScale, keeping the common scale", () => {
    const r = render([ds], spec({ xScale: 4 }));
    const [a, b] = r.layout.panels[1]!.columns;
    expect(a!.width / b!.width).toBeCloseTo(4, 6);
    expect(r.info.join(" ")).toMatch(/x-scale reduced from 4 to/);
  });

  it("columnWidth sets the width of columns without a common scale", () => {
    const counts = (style: object) =>
      render([ds], spec({ panels: [{ type: "taxonCurves", dataset: "d", variables: { kinds: ["count"] }, style: { commonScale: false, minWidth: 0, ...style } }] })).layout
        .panels[0]!.columns;
    expect(counts({})[0]).toMatchObject({ id: "S", sizing: "column", extent: 0, width: 15 });
    expect(counts({ columnWidth: 8.5 })[0]!.width).toBe(8.5);
    expect(counts({ columnWidth: 2, minWidth: 6 })[0]!.width).toBe(6); // minWidth still wins
  });

  it("leaves the SVG of a spec without the new fields unchanged", () => {
    const base = spec();
    expect(render([ds], { ...base, xScale: 0.4 }).svg.replace(/spec-sha256: \w+/, "")).toBe(render([ds], base).svg.replace(/spec-sha256: \w+/, ""));
  });
});
