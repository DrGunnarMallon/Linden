import { describe, expect, it } from "vitest";
import { importDelimited } from "../src/io/delimited.js";
import { parsePreset, parseSpec } from "../src/io/spec.js";
import type { Preset, Spec } from "../src/model/spec.js";
import { render } from "../src/pipeline.js";
import { readRepoFile, readRepoJson } from "./fixtures.js";

function demo() {
  const datasets = importDelimited(readRepoFile("examples/demo-pollen.csv"), { name: "demo-pollen" }).datasets;
  const spec = parseSpec(readRepoFile("examples/demo-pollen.spec.json"));
  const preset = parsePreset(readRepoJson("presets/pollen-percent.json"));
  if (!spec.ok || !preset.ok) throw new Error("fixtures invalid");
  return { datasets, spec: spec.value as Spec, presets: [preset.value as Preset] };
}

describe("render — demo pollen", () => {
  const { datasets, spec, presets } = demo();
  const result = render(datasets, spec, presets);

  it("renders without warnings", () => {
    expect(result.warnings).toEqual([]);
  });

  it("matches the golden SVG", async () => {
    await expect(result.svg).toMatchFileSnapshot("./__snapshots__/demo-pollen.svg");
  });

  it("is deterministic", () => {
    const again = demo();
    expect(render(again.datasets, again.spec, again.presets).svg).toBe(result.svg);
  });

  it("contains one column per selected taxon, italic names, zone and + markers", () => {
    expect(result.svg.match(/class="column"/g)).toHaveLength(8);
    expect(result.svg).toContain('<tspan font-style="italic">Sphagnum</tspan>');
    expect(result.svg).toContain(">Poaceae</text>");
    expect(result.svg).toContain(">P1/P2</text>");
    expect(result.svg).toContain('class="plus"');
  });
});

describe("render — warnings", () => {
  it("reports a zone outside the y range and a missing dataset", () => {
    const { datasets, spec, presets } = demo();
    const s: Spec = {
      ...spec,
      panels: [...spec.panels, { type: "taxonCurves", dataset: "nope" }],
      overlays: [{ type: "zones", manual: [{ depth: 500, label: "X" }] }],
    };
    const { warnings } = render(datasets, s, presets);
    expect(warnings).toEqual([
      'Panel dataset "nope" not found.',
      "Zone boundary at depth 500 is outside the y-axis range; omitted.",
    ]);
  });
});
