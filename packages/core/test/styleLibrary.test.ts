import { describe, expect, it } from "vitest";
import { parseStyleLibrary, serializeStyleLibrary } from "../src/io/styleLibrary.js";
import type { SavedCurveStyle } from "../src/model/spec.js";

const styles: SavedCurveStyle[] = [
  { name: "Moss line", style: { type: "line", line: { colour: "group", width: 0.3 } } },
  { name: "Hatched", style: { fill: { pattern: { type: "hatch", angle: 45 } } } },
];

describe("style library file", () => {
  it("round-trips the saved styles in order", () => {
    const text = serializeStyleLibrary(styles);
    expect(JSON.parse(text)).toMatchObject({ format: "linden-curve-styles", version: 1, generator: "Linden 0.0.0" });
    expect(parseStyleLibrary(text)).toEqual({ ok: true, value: styles });
  });

  it("reports readable errors", () => {
    expect(parseStyleLibrary("{")).toMatchObject({ ok: false, errors: [expect.stringMatching(/^Invalid JSON/)] });
    expect(parseStyleLibrary({ styles })).toMatchObject({ ok: false, errors: expect.arrayContaining([expect.stringContaining("format")]) });
    const bad = parseStyleLibrary({ format: "linden-curve-styles", version: 1, styles: [{ name: "x", style: { type: "wiggly" } }] });
    expect(bad).toMatchObject({ ok: false, errors: [expect.stringContaining("styles[0].style.type")] });
    const dup = parseStyleLibrary({ format: "linden-curve-styles", version: 1, styles: [styles[0], styles[0]] });
    expect(dup).toMatchObject({ ok: false, errors: [expect.stringContaining("Duplicate style name")] });
  });
});
