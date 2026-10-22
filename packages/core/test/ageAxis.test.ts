// Age axis (SPEC §6) and age–depth model import (SPEC §9): samples placed by age with depth as the
// interpolated secondary axis, and ages interpolated from a model (never extrapolated).

import { describe, expect, it } from "vitest";
import { applyAgeModel, parseAgeModel } from "../src/io/ageModel.js";
import { importDelimited } from "../src/io/delimited.js";
import { SPEC_VERSION, type Spec } from "../src/model/spec.js";
import type { Dataset } from "../src/model/types.js";
import { render } from "../src/pipeline.js";
import { readRepoFile } from "./fixtures.js";

describe("parseAgeModel", () => {
  it("Bacon's *_ages.txt (tab separated): depth and the median ages by default", () => {
    const t = parseAgeModel("depth\tmin\tmax\tmedian\tmean\n0\t-70\t-48\t-60\t-60\n5\t-4\t31.5\t12\t13.5\n");
    expect(t.columns).toEqual(["depth", "min", "max", "median", "mean"]);
    expect([t.depthColumn, t.ageColumn]).toEqual([0, 3]);
    expect(t.rows).toEqual([
      [0, -70, -48, -60, -60],
      [5, -4, 31.5, 12, 13.5],
    ]);
    expect(t.warnings).toEqual([]);
  });

  it("R's write.table (quoted header, row names, spaces); mean when there is no median; an age column", () => {
    const r = parseAgeModel('"depth" "mean"\n"1" 10 100\n"2" 20 300\n');
    expect(r.columns).toEqual(["depth", "mean"]);
    expect(r.rows).toEqual([
      [10, 100],
      [20, 300],
    ]);
    expect([r.depthColumn, r.ageColumn]).toEqual([0, 1]);
    expect(parseAgeModel("cal BP;depth (cm)\n100;1,5\n").depthColumn).toBe(1);
    expect(parseAgeModel("cal BP;depth (cm)\n100;1,5\n").rows).toEqual([[100, 1.5]]); // ; = decimal commas
  });
});

describe("applyAgeModel", () => {
  const model = parseAgeModel("depth,age\n0,0\n10,100\n20,300\n");
  const ds: Dataset = {
    id: "d",
    name: "d",
    depthUnit: "cm",
    samples: [
      { id: "a", depth: 5 },
      { id: "b", depth: 15, age: 9999, ageError: [1, 2] },
      { id: "c", depth: 25, age: 1 },
      { id: "e", depth: -1 },
    ],
    variables: [],
    groups: [],
    values: [[], [], [], []],
  };

  it("interpolates linearly to the sample depths; outside the model: no age (no extrapolation) and a warning", () => {
    const r = applyAgeModel(ds, model, { depthColumn: 0, ageColumn: 1, source: "bacon_ages.txt", ageUnit: "cal BP" });
    expect(r.dataset.samples).toEqual([
      { id: "a", depth: 5, age: 50 },
      { id: "b", depth: 15, age: 200 },
      { id: "c", depth: 25 },
      { id: "e", depth: -1 },
    ]);
    expect(r.warnings).toEqual(["2 samples lie outside the age model's depth range (0–20 cm) and got no age (no extrapolation): 25, -1 cm."]);
    expect(r.dataset.ageUnit).toBe("cal BP");
    expect(r.dataset.ageSource).toBe('bacon_ages.txt, column "age", interpolated linearly to the sample depths');
    expect(ds.samples[1]!.age).toBe(9999); // input not mutated
  });

  it("reports ages that decrease with depth; refuses a model with fewer than two usable rows", () => {
    const bad = parseAgeModel("depth,age\n0,0\n10,100\n20,50\n");
    expect(applyAgeModel(ds, bad, { depthColumn: 0, ageColumn: 1, source: "m" }).warnings[0]).toBe('The age model\'s ages ("age") decrease with depth at 20 cm.');
    const one = applyAgeModel(ds, parseAgeModel("depth,age\n0,0\n10,\n"), { depthColumn: 0, ageColumn: 1, source: "m" });
    expect(one.dataset).toBe(ds);
    expect(one.warnings).toEqual(['The age model has fewer than two rows with a depth and an age ("age"); no ages set.']);
  });

  it("the testate example's ages are its age model's medians interpolated to the sample depths", () => {
    const withAges = importDelimited(readRepoFile("examples/testate-percent.csv"), { name: "t" }).datasets[0]!;
    expect(withAges.ageUnit).toBe("cal BP");
    const table = parseAgeModel(readRepoFile("examples/testate-age-model.csv"));
    expect(table.columns[table.ageColumn]).toBe("median");
    const r = applyAgeModel({ ...withAges, samples: withAges.samples.map(({ age: _a, ...s }) => s) }, table, { depthColumn: table.depthColumn, ageColumn: table.ageColumn, source: "testate-age-model.csv" });
    expect(r.warnings).toEqual([]);
    r.dataset.samples.forEach((s, i) => expect(s.age).toBeCloseTo(withAges.samples[i]!.age!, 9));
  });
});

describe("age as the primary y axis", () => {
  // Ages grow faster with depth further down: 0, 10, 40, 100 at 0, 10, 20, 30 cm.
  const ds: Dataset = {
    id: "d",
    name: "d",
    depthUnit: "cm",
    ageUnit: "cal BP",
    samples: [0, 10, 20, 30].map((depth, i) => ({ id: String(depth), depth, age: [0, 10, 40, 100][i]! })),
    variables: [{ id: "LOI", name: "LOI", kind: "continuous", unit: "%" }],
    groups: [],
    values: [[90], [80], [85], [95]],
  };
  const spec = (yAxis: Spec["yAxis"], extra: Partial<Spec> = {}): Spec => ({
    specVersion: SPEC_VERSION,
    page: { width: 90, height: 90 },
    yAxis,
    panels: [{ type: "yAxis" }, { type: "taxonCurves", dataset: "d", style: { commonScale: false } }],
    ...extra,
  });
  const cys = (svg: string) => [...svg.matchAll(/<circle cx="[\d.]+" cy="([\d.]+)"/g)].map((m) => Number(m[1]));
  /** y of an axis tick label (text) in an axis group. */
  const labelY = (svg: string, axis: "primary" | "secondary", text: string) => {
    const g = svg.slice(svg.indexOf(`class="axis-${axis}"`));
    return Number(new RegExp(`<text x="[\\d.]+" y="([\\d.]+)"[^>]*>${text}</text>`).exec(g)![1]);
  };

  it("samples are placed by their ages; the y domain is the age extent", () => {
    const r = render([ds], spec({ primary: "age", secondary: "depth" }));
    expect(r.warnings).toEqual([]);
    expect(r.layout.y).toEqual({ domain: [0, 100], reverse: true, primary: "age" });
    const [y0, y1, y2, y3] = cys(r.svg) as [number, number, number, number];
    expect((y1 - y0) / (y3 - y0)).toBeCloseTo(0.1, 2);
    expect((y2 - y0) / (y3 - y0)).toBeCloseTo(0.4, 2);
  });

  it("the secondary depth axis is interpolated, never rescaled: 20 cm sits at 40 cal BP", () => {
    const svg = render([ds], spec({ primary: "age", secondary: "depth" })).svg;
    expect(labelY(svg, "secondary", "20")).toBe(labelY(svg, "primary", "40"));
    expect(svg).toContain(">Age (cal BP)</text>");
    expect(svg).toContain(">Depth (cm)</text>");
  });

  it("depth primary with age secondary still places samples by depth", () => {
    const r = render([ds], spec({ primary: "depth", secondary: "age" }));
    expect(r.layout.y.primary).toBe("depth");
    const [y0, y1, , y3] = cys(r.svg) as [number, number, number, number];
    expect((y1 - y0) / (y3 - y0)).toBeCloseTo(1 / 3, 2);
    expect(labelY(r.svg, "secondary", "40")).toBe(labelY(r.svg, "primary", "20"));
  });

  it("samples without an age are left out (warning); no ages at all → depth (warning)", () => {
    const partial = { ...ds, samples: ds.samples.map((s, i) => (i === 1 ? { id: s.id, depth: s.depth } : s)) };
    const r = render([partial], spec({ primary: "age" }));
    expect(r.warnings).toEqual(['Dataset "d": 1 sample(s) without an age are not drawn on the age axis.']);
    expect(cys(r.svg)).toHaveLength(3);
    const none = { ...ds, samples: ds.samples.map((s) => ({ id: s.id, depth: s.depth })) };
    const d = render([none], spec({ primary: "age" }));
    expect(d.warnings).toContain('Primary y axis "age" needs sample ages (an age column or an imported age–depth model); depth used.');
    expect(d.layout.y.primary).toBe("depth");
  });

  it("ages that decrease with depth are reported; the depth axis is omitted, never rescaled", () => {
    const inverted = { ...ds, samples: ds.samples.map((s, i) => ({ ...s, age: [0, 50, 40, 100][i]! })) };
    const r = render([inverted], spec({ primary: "age", secondary: "depth" }));
    expect(r.warnings).toEqual(['Dataset "d": ages do not increase with depth (at 20 cm); samples are placed by their ages.', "Ages do not increase with depth; depth axis omitted."]);
    expect(r.svg).not.toContain("axis-secondary");
  });

  it("zone boundaries (depths) sit at their interpolated ages; outside the dated samples they are omitted", () => {
    const zones = (manual: { depth: number }[]) => render([ds], spec({ primary: "age", secondary: "depth" }, { overlays: [{ type: "zones", manual }] }));
    const r = zones([{ depth: 20 }]);
    const zoneY = Number(/class="zone" x1="[\d.]+" y1="([\d.]+)"/.exec(r.svg)![1]);
    expect(zoneY).toBeCloseTo(cys(r.svg)[2]!, 2); // the sample at 20 cm (40 cal BP)
    expect(zones([{ depth: 35 }]).warnings).toEqual([
      "Zone boundary at depth 35 cannot be placed on the age axis (outside the dated samples, or ages decrease with depth); omitted.",
    ]);
  });

  it("golden SVG", async () => {
    const r = render([ds], spec({ primary: "age", secondary: "depth", ticks: { major: 20, minor: 10 } }, { overlays: [{ type: "zones", manual: [{ depth: 15, label: "A/B" }] }] }));
    expect(r.warnings).toEqual([]);
    await expect(r.svg).toMatchFileSnapshot("./__snapshots__/age-primary.svg");
  });
});
