// @vitest-environment jsdom
// PDF export of the demo, read back with pdf.js: exact page size, selectable text, embedded fonts.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { importDelimited, parsePreset, parseSpec, render, textWidthEm, type Preset, type Spec } from "@linden/core";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { beforeAll, describe, expect, it } from "vitest";
import type { FontFiles } from "../src/export/fonts";
import { svgToPdf } from "../src/export/pdf";
import { setPageSize } from "../src/specEdit";

// Plain paths: jsdom replaces the global URL class, which node:fs does not accept.
const read = (p: string) => readFileSync(resolve(import.meta.dirname, "../../..", p));
const datasets = importDelimited(read("examples/demo-pollen.csv").toString("utf8"), { name: "demo-pollen" }).datasets;
const preset = parsePreset(read("presets/pollen-percent.json").toString("utf8"));
const parsed = parseSpec(read("examples/demo-pollen.spec.json").toString("utf8"));
if (!parsed.ok || !preset.ok) throw new Error("fixtures invalid");
const demo: Spec = parsed.value;
const presets: Preset[] = [preset.value];
const fonts: FontFiles = {
  regular: new Uint8Array(read("fonts/LiberationSans-Regular.ttf")),
  italic: new Uint8Array(read("fonts/LiberationSans-Italic.ttf")),
};

// jsdom cannot measure text; svg2pdf measures through canvas / getBBox. Answer with core's metrics
// table, which equals the bundled font's advance widths (core/test/metrics.test.ts).
beforeAll(() => {
  const px = (s: string) => Number(/([\d.]+)px/.exec(s)?.[1] ?? 0);
  HTMLCanvasElement.prototype.getContext = function () {
    return { font: "", measureText(this: { font: string }, t: string) { return { width: textWidthEm(t) * px(this.font) }; } };
  } as unknown as HTMLCanvasElement["getContext"];
  (SVGElement.prototype as unknown as { getBBox(): { width: number } }).getBBox = function (this: SVGElement) {
    return { width: textWidthEm(this.textContent ?? "") * px(this.getAttribute("font-size") ?? "") };
  };
});

async function exportAndRead(spec: Spec) {
  const svg = render(datasets, spec, presets).svg;
  const bytes = await svgToPdf(svg, fonts);
  const raw = Buffer.from(bytes).toString("latin1");
  const pdf = await getDocument({ data: bytes.slice(), disableFontFace: true, useSystemFonts: false }).promise;
  const page = await pdf.getPage(1);
  const text = (await page.getTextContent()).items.map((i) => ("str" in i ? i.str : "")).join(" ");
  const [x0, y0, x1, y1] = page.view as [number, number, number, number];
  const meta = (await pdf.getMetadata()).info as Record<string, string>;
  return { raw, pages: pdf.numPages, widthMm: ((x1 - x0) * 25.4) / 72, heightMm: ((y1 - y0) * 25.4) / 72, text, meta, svg };
}

describe("PDF export", () => {
  it.each([
    ["demo page", 180, 120],
    ["single column", 85, 120],
    ["A4 portrait", 210, 297],
    ["A4 landscape", 297, 210],
    ["custom", 123.4, 98.7],
  ])("%s: page is exactly %s × %s mm", async (_label, w, h) => {
    const r = await exportAndRead(setPageSize(demo, { width: w, height: h }));
    expect(r.pages).toBe(1);
    expect(Math.abs(r.widthMm - w)).toBeLessThan(0.01);
    expect(Math.abs(r.heightMm - h)).toBeLessThan(0.01);
  });

  it("keeps text as selectable text (Unicode extractable), including italic names", async () => {
    const r = await exportAndRead(demo);
    for (const word of ["Depth", "Pinus", "Betula", "Poaceae", "Sphagnum", "P1/P2"]) expect(r.text).toContain(word);
  });

  it("embeds the bundled font (regular + italic) and uses no standard, non-embedded font", async () => {
    const { raw } = await exportAndRead(demo);
    // Two Type0/CIDFontType2 fonts (normal + italic, both named after the family), each with its TrueType program and a ToUnicode map.
    expect(raw.match(/\/Subtype \/Type0/g)).toHaveLength(2);
    expect(raw.match(/\/FontFile2 /g)).toHaveLength(2);
    expect(raw.match(/\/ToUnicode /g)).toHaveLength(2);
    expect(raw.match(/\/BaseFont \/[^\s/>]+/g)?.every((f) => f === "/BaseFont /Liberation#20Sans")).toBe(true);
    expect(raw).not.toMatch(/\/BaseFont \/(Helvetica|Times|Courier)/);
  });

  it("records the generator and spec hash", async () => {
    const r = await exportAndRead(demo);
    expect(r.meta.Creator).toBe("Linden 0.0.0");
    expect(r.meta.Subject).toMatch(/^generator: Linden 0\.0\.0; spec-sha256: [0-9a-f]{64}$/);
  });
});
