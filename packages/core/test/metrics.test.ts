import { describe, expect, it } from "vitest";
import { charWidth } from "../src/layout/metrics.js";
import { readTtfMetrics } from "./ttf.js";

// Every character with an explicit width in metrics.ts.
const TABLE_CHARS = [...Array(95)].map((_, i) => String.fromCharCode(32 + i)).concat([..." °±µ×–—‰"]);

describe("metrics table = bundled font (fonts/LiberationSans-*.ttf)", () => {
  for (const style of ["Regular", "Italic"]) {
    it(`matches LiberationSans-${style} advance widths to 1/1000 em`, () => {
      const font = readTtfMetrics(new URL(`../../../fonts/LiberationSans-${style}.ttf`, import.meta.url));
      const off = TABLE_CHARS.filter((ch) => {
        const adv = font.advance(ch);
        return adv === undefined || Math.abs(Math.round((adv * 1000) / font.unitsPerEm) / 1000 - charWidth(ch)) > 1e-9;
      });
      expect(off).toEqual([]);
    });
  }
});
