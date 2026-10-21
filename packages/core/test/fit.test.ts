import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { importDelimited } from "../src/io/delimited.js";
import { loadPresets } from "../src/io/presets.js";
import { parseSpec } from "../src/io/spec.js";
import type { Spec } from "../src/model/spec.js";
import type { Dataset } from "../src/model/types.js";
import { render } from "../src/pipeline.js";
import { readRepoFile } from "./fixtures.js";
import { outsidePage, svgBounds } from "./svgBounds.js";

/** Pairs of x-axis tick labels whose boxes overlap. */
function overlappingTickLabels(svg: string): [string, string][] {
  const labels = svgBounds(svg).boxes.filter((b) => b.tag === "text" && b.cls === "x-axis").sort((a, b) => a.x0 - b.x0);
  const out: [string, string][] = [];
  labels.forEach((a, i) => {
    for (const b of labels.slice(i + 1)) if (b.x0 < a.x1 - 1e-6 && b.y0 < a.y1 && a.y0 < b.y1) out.push([a.where, b.where]);
  });
  return out;
}

const { presets } = loadPresets(
  readdirSync(new URL("../../../presets/", import.meta.url))
    .filter((f) => f.endsWith(".json"))
    .map((file) => ({ file, text: readRepoFile(`presets/${file}`) })),
);

/** Writes a test diagram to examples/out/ for inspection. */
function save(name: string, svg: string): void {
  const dir = new URL("../../../examples/out/", import.meta.url);
  mkdirSync(dir, { recursive: true });
  writeFileSync(new URL(`${name}.svg`, dir), svg);
}

// 60 pollen-type taxa (synthetic counts, deterministic): 15 trees, 6 shrubs, 30 herbs, 5 aquatics, 4 spores.
const TAXA = [
  "*Betula*", "*Pinus*", "*Quercus*", "*Ulmus*", "*Tilia*", "*Fraxinus*", "*Alnus*", "*Fagus*", "*Carpinus*", "*Picea*",
  "*Abies*", "*Acer*", "*Populus*", "*Sorbus*", "*Taxus*",
  "*Corylus avellana*-type", "*Salix*", "*Juniperus*", "*Hedera*", "*Ilex*", "*Calluna vulgaris*",
  "Poaceae", "Cyperaceae", "*Artemisia*", "Chenopodiaceae", "*Plantago lanceolata*", "*Plantago major/media*",
  "*Rumex acetosa*-type", "*Rumex acetosella*", "*Ranunculus acris*-type", "*Filipendula*", "*Potentilla*-type",
  "Rosaceae undiff.", "Apiaceae", "Asteroideae", "Cichorioideae", "*Centaurea nigra*", "*Succisa pratensis*",
  "*Galium*-type", "*Urtica*", "*Melampyrum*", "Brassicaceae", "Caryophyllaceae", "Fabaceae undiff.",
  "*Trifolium*-type", "*Thalictrum*", "*Helianthemum*", "*Saxifraga*", "Cerealia-type", "*Secale cereale*", "*Cannabis/Humulus*",
  "*Typha latifolia*", "*Sparganium*-type", "*Potamogeton*", "*Nymphaea*", "*Menyanthes trifoliata*",
  "*Sphagnum*", "*Polypodium*", "*Pteridium aquilinum*", "Monolete spores",
];
const group = (k: number) => (k < 15 ? "trees" : k < 21 ? "shrubs" : k < 51 ? "herbs" : k < 56 ? "aquatics" : "spores");

function sixtyTaxa(): Dataset {
  const depths = Array.from({ length: 20 }, (_, i) => 10 + i * 10);
  return {
    id: "sixty",
    name: "sixty",
    depthUnit: "cm",
    samples: depths.map((depth) => ({ id: String(depth), depth })),
    variables: TAXA.map((name, k) => ({ id: name.replace(/\*/g, ""), name, kind: "count" as const, group: group(k) })),
    groups: [],
    // A few abundant taxa, many rare ones; smooth trends over depth.
    values: depths.map((_, i) => TAXA.map((_, k) => Math.round((k < 3 ? 120 : k % 7 === 0 ? 40 : 4) * (1 + Math.sin(i / 3 + k)) ))),
  };
}

const sixtySpec = (width: number): Spec => ({
  specVersion: 4,
  preset: "pollen-percent",
  page: { width, height: 120 },
  datasets: [{ dataset: "sixty" }],
  panels: [{ type: "yAxis" }, { type: "taxonCurves", dataset: "sixty" }],
  overlays: [{ type: "zones", manual: [{ depth: 105, label: "P1/P2" }] }],
  headers: [
    { label: "Trees & shrubs", spans: { groups: ["trees", "shrubs"] } },
    { spans: { groups: ["herbs"] } },
    { spans: { groups: ["aquatics"] } },
    { spans: { groups: ["spores"] } },
  ],
});

const demo = () => {
  const datasets = importDelimited(readRepoFile("examples/demo-pollen.csv"), { name: "demo-pollen" }).datasets;
  const spec = parseSpec(readRepoFile("examples/demo-pollen.spec.json"));
  if (!spec.ok) throw new Error(spec.errors.join("\n"));
  return { datasets, spec: spec.value };
};
const widthWarning = (w: string) => w.startsWith("Diagram does not fit the page width");

describe("fitting the page — nothing is drawn outside it", () => {
  it("60 taxa on an 85 mm page fit: x-scale to its floor, then minWidth/gaps only as far as needed", () => {
    const r = render([sixtyTaxa()], sixtySpec(85), presets);
    save("fit-60-taxa-85mm", r.svg);
    expect(outsidePage(r.svg)).toEqual([]);
    expect(r.info).toEqual([
      "x-scale reduced from 0.4 to 0.1 mm per unit to fit the page (needs 354.9 mm at full size, page is 85 mm; common scale kept).",
      expect.stringMatching(/^minWidth reduced from 4 to 0\.5\d mm, column gaps from 1 to 0\.3\d mm to fit the page\.$/),
    ]);
    expect(r.warnings.filter(widthWarning)).toEqual([]);
    // Compacted columns are too narrow for a "0" each: tick labels are thinned, never overlapped.
    expect(overlappingTickLabels(r.svg)).toEqual([]);
    expect(svgBounds(r.svg).boxes.filter((b) => b.tag === "text" && b.cls === "x-axis").length).toBeGreaterThan(5);
    // At ~0.85 mm per column the rotated labels cannot be kept apart; that is reported, never silent.
    expect(r.warnings).toContainEqual(expect.stringMatching(/taxon labels overlap even at the minimum font size of 5 pt/));
  });

  it("step (a) only: the demo on a 120 mm page shrinks the x-scale and nothing else", () => {
    const { datasets, spec } = demo();
    const r = render(datasets, { ...spec, page: { ...spec.page, width: 120 } }, presets);
    save("fit-demo-120mm", r.svg);
    expect(outsidePage(r.svg)).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.info).toEqual([
      "x-scale reduced from 0.4 to 0.31 mm per unit to fit the page (needs 138.2 mm at full size, page is 120 mm; common scale kept).",
    ]);
    // minWidth (4 mm) untouched: the narrowest columns are still 4 mm.
    const widths = [...r.svg.matchAll(/class="x-axis">\s*<line x1="0" y1="[^"]+" x2="([^"]+)"/g)].map((m) => Number(m[1]));
    expect(Math.min(...widths)).toBe(4);
  });

  it("warns, with the shortfall in mm, only after every step is at its floor", () => {
    const r = render([sixtyTaxa()], sixtySpec(50), presets);
    save("fit-60-taxa-50mm-overflow", r.svg);
    expect(r.info).toEqual([
      expect.stringMatching(/^x-scale reduced from 0\.4 to 0\.1 mm per unit/),
      "minWidth reduced from 4 to 0.5 mm, column gaps from 1 to 0.3 mm to fit the page.",
      "Taxon label font reduced from 7 to 5 pt to fit the page.",
    ]);
    expect(r.warnings.filter(widthWarning)).toEqual([
      "Diagram does not fit the page width: it needs a page 83.2 mm wide (panels 70.4 mm, labels reaching 7.7 mm right of the last panel, margins 5 + 5 mm) but the page is 50 mm — 33.2 mm too wide even at the smallest x-scale, minWidth, gaps and label size. Select fewer variables or use a wider page.",
    ]);
  });

  it("reserves ink left of the first panel (a group header wider than the first column)", () => {
    const spec: Spec = {
      specVersion: 4,
      preset: "pollen-percent",
      page: { width: 70, height: 80 },
      datasets: [{ dataset: "sixty" }],
      panels: [{ type: "taxonCurves", dataset: "sixty", variables: { ids: ["Ulmus", "Tilia", "Fraxinus", "Alnus"] } }],
      headers: [{ label: "A very long group header over one column", spans: { ids: ["Ulmus"] } }],
    };
    const r = render([sixtyTaxa()], spec, presets);
    save("fit-left-overhang", r.svg);
    expect(outsidePage(r.svg)).toEqual([]);
    const x = Number(/id="panel-0-taxonCurves" transform="translate\(([^,]+),/.exec(r.svg)![1]);
    expect(x).toBeGreaterThan(5); // shifted right of the left margin to make room
  });

  it("every example diagram lies within its page", () => {
    for (const f of readdirSync(new URL("./__snapshots__/", import.meta.url))) {
      expect([f, outsidePage(readRepoFile(`packages/core/test/__snapshots__/${f}`))]).toEqual([f, []]);
    }
  });
});
