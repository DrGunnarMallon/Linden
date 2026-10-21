import { describe, expect, it } from "vitest";
import { groupSpans, layoutLabels, type HeaderColumn, type LabelOptions } from "../src/layout/header.js";
import { charWidth, textWidthEm } from "../src/layout/metrics.js";
import { estimateTextWidth, makeTheme, PT_TO_MM } from "../src/layout/theme.js";
import { coreDefaults } from "../src/model/defaults.js";
import type { Spec } from "../src/model/spec.js";
import type { Dataset } from "../src/model/types.js";
import { render } from "../src/pipeline.js";

const opts = (o: Partial<LabelOptions> = {}): LabelOptions => ({
  angle: 60,
  fontSize: 7,
  minFontSize: 5,
  height: null,
  step: 0.25,
  thickness: 1,
  ...o,
});

const LONG = "*Pseudoschizaea circula*-type";

/** `n` columns of width `w` at a centre-to-centre spacing of `pitch` mm. */
const columns = (n: number, pitch: number, label = LONG, w = 1): HeaderColumn[] =>
  Array.from({ length: n }, (_, k) => ({ id: `T${k}`, label, x: k * pitch, width: w }));

const sin60 = Math.sin(Math.PI / 3);
const cos60 = Math.cos(Math.PI / 3);

describe("text metrics", () => {
  it("uses per-character Helvetica/Arial widths, ignoring markup", () => {
    // P 667 + o 556 + a 556 + c 500 + e 556 + a 556 + e 556 = 3947
    expect(textWidthEm("Poaceae")).toBeCloseTo(3.947, 10);
    expect(estimateTextWidth("*Poaceae*", 2)).toBeCloseTo(7.894, 10);
    expect(textWidthEm("il")).toBeCloseTo(0.444, 10); // narrow glyphs are narrow
    expect(textWidthEm("MW")).toBeCloseTo(1.777, 10);
    expect(charWidth("é")).toBe(charWidth("e")); // accented → base letter
    expect(charWidth("中")).toBe(0.556); // unknown → average
  });
});

describe("layoutLabels — taxon label band", () => {
  it("keeps the base font when labels are far enough apart", () => {
    const r = layoutLabels(columns(5, 5), opts());
    expect(r.fontSize).toBeCloseTo(7 * PT_TO_MM, 10);
    expect(r.collisions).toBe(0);
    expect(r.warnings).toEqual([]);
    const w = estimateTextWidth(LONG, 7 * PT_TO_MM);
    expect(r.height).toBeCloseTo(w * sin60 + 7 * PT_TO_MM * cos60, 10);
  });

  it("reduces the font size until neighbours no longer collide", () => {
    // Pitch 2.5 mm: perpendicular gap 2.5·sin60 = 2.165 mm → needs em ≤ 2.165 mm → 6.0 pt (6.25 pt = 2.205 mm).
    const r = layoutLabels(columns(10, 2.5), opts());
    expect(r.fontSize).toBeCloseTo(6 * PT_TO_MM, 10);
    expect(r.collisions).toBe(0);
    expect(r.warnings).toEqual([]);
  });

  it("short labels do not collide even when close (no overlap along the text)", () => {
    // Pitch 2 mm → 1 mm along the text; "I" is 0.278 em ≈ 0.69 mm long at 7 pt.
    const r = layoutLabels(columns(5, 2, "I"), opts());
    expect(r.fontSize).toBeCloseTo(7 * PT_TO_MM, 10);
  });

  it("40 long names too close together: minimum font, then a warning — never silent", () => {
    const r = layoutLabels(columns(40, 1.5), opts());
    expect(r.fontSize).toBeCloseTo(5 * PT_TO_MM, 10);
    expect(r.collisions).toBe(39);
    expect(r.warnings).toEqual([expect.stringMatching(/^39 pair\(s\) of taxon labels overlap even at the minimum font size of 5 pt \(first: "T0" and "T1"\)/)]);
  });

  it("any overlap that remains is always reported", () => {
    for (let pitch = 0.5; pitch <= 6; pitch += 0.25) {
      for (const angle of [45, 60, 90]) {
        const r = layoutLabels(columns(8, pitch), opts({ angle }));
        expect(r.collisions === 0 || r.warnings.length > 0).toBe(true);
      }
    }
  });

  it("fixed band height: shrinks the font to fit before growing the band", () => {
    const at = (pt: number) => estimateTextWidth(LONG, pt * PT_TO_MM) * sin60 + pt * PT_TO_MM * cos60;
    const r = layoutLabels(columns(5, 10), opts({ height: at(6) }));
    expect(r.fontSize).toBeCloseTo(6 * PT_TO_MM, 10);
    expect(r.height).toBeCloseTo(at(6), 10);
    expect(r.warnings).toEqual([]);
  });

  it("fixed band height too small even at the minimum font: grows the band and warns", () => {
    const r = layoutLabels(columns(5, 10), opts({ height: 10 }));
    expect(r.fontSize).toBeCloseTo(5 * PT_TO_MM, 10);
    expect(r.height).toBeGreaterThan(10);
    expect(r.warnings).toEqual([expect.stringMatching(/^Taxon labels need [\d.]+ mm at the minimum font size of 5 pt; header band increased from 10 mm\.$/)]);
  });

  it("reports how far right the labels reach", () => {
    const em = 7 * PT_TO_MM;
    const r = layoutLabels([{ id: "a", label: "Poaceae", x: 10, width: 4 }], opts());
    // Bottom-right corner of the rotated glyph box: baseline offset 0.35 em + descent 0.25 em across the text.
    expect(r.right).toBeCloseTo(12 + 3.947 * em * cos60 + 0.6 * em * sin60, 10);
    expect(r.left).toBeCloseTo(12 - 0.4 * em * sin60, 10); // top-left corner: 0.35 − 0.75 em
  });
});

describe("groupSpans — group headers", () => {
  const theme = makeTheme(coreDefaults.page);
  const cols: HeaderColumn[] = [
    { id: "A", label: "A", group: "trees", x: 0, width: 10 },
    { id: "B", label: "B", group: "trees", x: 11, width: 4 },
    { id: "C", label: "C", group: "herbs", x: 17, width: 20 },
    { id: "D", label: "D", group: "trees", x: 39, width: 6 },
  ];
  const names: Record<string, string> = { trees: "Trees", herbs: "Herbs" };
  const run = (headers: Parameters<typeof groupSpans>[0]) => {
    const warnings: string[] = [];
    const spans = groupSpans(headers, cols, (id) => names[id] ?? id, theme, (m) => warnings.push(m));
    return { spans, warnings };
  };

  it("spans exactly the matching columns, label defaults to the group name", () => {
    expect(run([{ spans: { groups: ["herbs"] } }])).toEqual({ spans: [{ label: "Herbs", x0: 17, x1: 37 }], warnings: [] });
    expect(run([{ label: "Mixed", spans: { ids: ["B", "C"] } }]).spans).toEqual([{ label: "Mixed", x0: 11, x1: 37 }]);
  });

  it("non-adjacent columns: one bracket per run, label on the first, warning", () => {
    const r = run([{ spans: { groups: ["trees"] } }]);
    expect(r.spans).toEqual([
      { label: "Trees", x0: 0, x1: 15 },
      { label: "", x0: 39, x1: 45 },
    ]);
    expect(r.warnings).toEqual(['Header "Trees" spans non-adjacent columns; drawn as 2 brackets. Reorder the variables to keep them together.']);
  });

  it("warns about headers that match nothing or overlap", () => {
    expect(run([{ label: "X", spans: { groups: ["nope"] } }]).warnings).toEqual(['Header "X" matches no columns; omitted.']);
    const r = run([{ spans: { groups: ["herbs"] } }, { label: "Shrubs", spans: { ids: ["B", "C"] } }]);
    expect(r.warnings).toEqual(['Group headers "Herbs" and "Shrubs" overlap; shorten the labels or check the header spans.']);
  });
});

/** 40 taxa with long names; every column max 3 % (1.2 mm at 0.4 mm/%). */
function manyTaxa(groups = false): Dataset {
  const n = 40;
  return {
    id: "many",
    name: "many",
    depthUnit: "cm",
    samples: [{ id: "1", depth: 1 }, { id: "2", depth: 2 }],
    variables: Array.from({ length: n }, (_, j) => ({
      id: `T${String(j).padStart(2, "0")}`,
      name: `*Longgenusname${j} speciesepithet*-type`,
      kind: "percent" as const,
      ...(groups ? { group: j < 15 ? "g1" : "g2" } : {}),
    })),
    groups: [],
    values: [Array(n).fill(3), Array(n).fill(1)],
  };
}

const labelSizes = (svg: string) =>
  [...svg.matchAll(/<text class="label"[^>]*>/g)].map((m) => / font-size="([^"]+)"/.exec(m[0])?.[1]);

describe("render — header band with 40 long taxon names", () => {
  const base: Spec = {
    specVersion: 2,
    panels: [{ type: "taxonCurves", dataset: "many", style: { minWidth: 0, groupGap: 0 } }],
  };

  it("shrinks every label to one common size so none overlap, without warnings", () => {
    // Pitch 1.2 + 1 mm gap = 2.2 mm → 2.2·sin60 = 1.905 mm ≥ em → 5.25 pt (5.5 pt = 1.94 mm collides).
    const { svg, warnings } = render([manyTaxa()], base);
    expect(warnings).toEqual([]);
    const sizes = labelSizes(svg);
    expect(sizes).toHaveLength(40);
    expect(new Set(sizes)).toEqual(new Set([String(Math.round(5.25 * PT_TO_MM * 100) / 100)]));
  });

  it("the header band is tall enough for the longest label", () => {
    const { svg } = render([manyTaxa()], base);
    const em = 5.25 * PT_TO_MM;
    const longest = Math.max(...manyTaxa().variables.map((v) => estimateTextWidth(v.name, em)));
    const plotTop = Number(/id="panel-0-taxonCurves" transform="translate\([^,]+,([^)]+)\)"/.exec(svg)![1]);
    expect(plotTop).toBeCloseTo(5 + 1 + longest * sin60 + em * cos60, 1);
  });

  it("warns when even the minimum font size cannot separate the labels", () => {
    const { warnings } = render([manyTaxa()], { ...base, headerBand: { minFontSize: 6 } });
    expect(warnings).toEqual([expect.stringContaining("taxon labels overlap even at the minimum font size of 6 pt")]);
  });

  it("warns when a fixed band height has to grow", () => {
    const { warnings } = render([manyTaxa()], { ...base, headerBand: { height: 8 } });
    expect(warnings).toEqual([expect.stringMatching(/header band increased from 8 mm\.$/)]);
  });

  it("keeps the label ends on the page by shrinking the x-scale", () => {
    const { svg, info } = render([manyTaxa()], { ...base, page: { width: 100 } });
    expect(info.some((w) => w.includes("x-scale reduced"))).toBe(true);
    // Rightmost column: 40 columns must still end well before the page edge to leave room for its label.
    const xs = [...svg.matchAll(/class="column" transform="translate\(([^,]+),0\)"/g)].map((m) => Number(m[1]));
    expect(Math.max(...xs)).toBeLessThan(100 - 5 - 10);
  });
});

describe("render — group headers", () => {
  it("brackets span exactly their columns, with a gap between groups", () => {
    const spec: Spec = {
      specVersion: 5,
      panels: [{ type: "yAxis" }, { type: "taxonCurves", dataset: "many", style: { minWidth: 4, groupGap: 3 } }],
      headers: [{ label: "First", spans: { groups: ["g1"] } }, { label: "Second", spans: { groups: ["g2"] } }],
      groupHeaders: { line: "bracket" },
      page: { width: 300 },
    };
    const { svg, warnings } = render([manyTaxa(true)], spec);
    expect(warnings).toEqual([]);
    const panelX = Number(/id="panel-1-taxonCurves" transform="translate\(([^,]+),/.exec(svg)![1]) - 5; // plot x = margin 5
    const cols = [...svg.matchAll(/class="column" transform="translate\(([^,]+),0\)">\s*(?:<[^>]+>\s*)*?<g class="x-axis">\s*<line x1="0" y1="[^"]+" x2="([^"]+)"/g)].map(
      (m) => ({ x: panelX + Number(m[1]), w: Number(m[2]) }),
    );
    expect(cols).toHaveLength(40);
    const brackets = [...svg.matchAll(/class="bracket" d="M([^,]+),[^L]+L[^L]+L([^,]+),/g)].map((m) => [Number(m[1]), Number(m[2])]);
    expect(brackets).toHaveLength(2);
    expect(brackets[0]![0]).toBeCloseTo(cols[0]!.x, 1);
    expect(brackets[0]![1]).toBeCloseTo(cols[14]!.x + cols[14]!.w, 1);
    expect(brackets[1]![0]).toBeCloseTo(cols[15]!.x, 1);
    expect(brackets[1]![1]).toBeCloseTo(cols[39]!.x + cols[39]!.w, 1);
    // Column gap 1 mm + group gap 3 mm between the groups.
    expect(cols[15]!.x - (cols[14]!.x + cols[14]!.w)).toBeCloseTo(4, 1);
    expect(svg).toContain(">First</text>");
    expect(svg).toContain(">Second</text>");
  });

  // Groups g1 (T00–T14) and g2 (T15–T39) named in the spec, plus an empty group ordered between them.
  const grouped = (extra: Partial<Spec> = {}): Spec => ({
    specVersion: 5,
    datasets: [
      {
        dataset: "many",
        groups: [
          { id: "g1", name: "First", order: 1 },
          { id: "empty", name: "Nothing here", order: 2 },
          { id: "g2", name: "Second", order: 3 },
        ],
      },
    ],
    panels: [{ type: "yAxis" }, { type: "taxonCurves", dataset: "many", style: { minWidth: 4, groupGap: 3 } }],
    page: { width: 300 },
    ...extra,
  });
  const columnsOf = (svg: string) => {
    const panelX = Number(/id="panel-1-taxonCurves" transform="translate\(([^,]+),/.exec(svg)![1]) - 5;
    return [...svg.matchAll(/class="column" transform="translate\(([^,]+),0\)">\s*(?:<[^>]+>\s*)*?<g class="x-axis">\s*<line x1="0" y1="[^"]+" x2="([^"]+)"/g)].map(
      (m) => ({ x: panelX + Number(m[1]), w: Number(m[2]) }),
    );
  };

  it("by default: a horizontal line over exactly each group's columns, the group name centred above it", () => {
    const { svg, warnings } = render([manyTaxa(true)], grouped());
    expect(warnings).toEqual([]);
    const cols = columnsOf(svg);
    const lines = [...svg.matchAll(/class="line" d="M([^,]+),([^L ]+) ?L([^,]+),([^"]+)"/g)].map((m) => m.slice(1, 5).map(Number));
    expect(lines).toHaveLength(2);
    expect(svg).not.toContain('class="bracket"');
    for (const [x0, y0, , y1] of lines) expect(y1).toBe(y0); // horizontal, no end ticks
    expect(lines[0]![0]).toBeCloseTo(cols[0]!.x, 1);
    expect(lines[0]![2]).toBeCloseTo(cols[14]!.x + cols[14]!.w, 1);
    expect(lines[1]![0]).toBeCloseTo(cols[15]!.x, 1);
    expect(lines[1]![2]).toBeCloseTo(cols[39]!.x + cols[39]!.w, 1);
    const labels = [...svg.matchAll(/<text class="group-header" x="([^"]+)" y="([^"]+)"[^>]*>([^<]+)</g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]), text: m[3] }));
    expect(labels.map((l) => l.text)).toEqual(["First", "Second"]);
    labels.forEach((l, i) => {
      expect(l.x).toBeCloseTo((lines[i]![0]! + lines[i]![2]!) / 2, 1);
      expect(l.y).toBeLessThan(lines[i]![1]!);
    });
  });

  it("empty groups are never drawn: no header and no extra gap", () => {
    const { svg } = render([manyTaxa(true)], grouped());
    expect(svg).not.toContain("Nothing here");
    const cols = columnsOf(svg);
    // One column gap (1 mm) + one group gap (3 mm) between g1 and g2, as if the empty group did not exist.
    expect(cols[15]!.x - (cols[14]!.x + cols[14]!.w)).toBeCloseTo(4, 1);
  });

  it("groupHeaders.show = false draws no group headers and reserves no row; line \"none\" draws labels only", () => {
    const on = render([manyTaxa(true)], grouped()).svg;
    const off = render([manyTaxa(true)], grouped({ groupHeaders: { show: false } })).svg;
    expect(off).not.toContain('class="group-header"');
    expect(off).not.toContain('id="headers"');
    const plotTop = (svg: string) => Number(/id="panel-1-taxonCurves" transform="translate\([^,]+,([^)]+)\)"/.exec(svg)![1]);
    expect(plotTop(off)).toBeLessThan(plotTop(on));
    const labelsOnly = render([manyTaxa(true)], grouped({ groupHeaders: { line: "none" } })).svg;
    expect(labelsOnly).toContain(">First</text>");
    expect(labelsOnly).not.toMatch(/class="(line|bracket)"/);
  });

  it("automatic headers never span two panels; ungrouped columns get none", () => {
    const spec = grouped({
      panels: [
        { type: "taxonCurves", dataset: "many", variables: { ids: ["T00", "T01"] } },
        { type: "taxonCurves", dataset: "many", variables: { ids: ["T02", "T03"] } },
      ],
    });
    const { svg } = render([manyTaxa(true)], spec);
    expect([...svg.matchAll(/>First</g)]).toHaveLength(2);
    expect(render([manyTaxa(false)], spec).svg).not.toContain('class="group-header"');
  });
});
