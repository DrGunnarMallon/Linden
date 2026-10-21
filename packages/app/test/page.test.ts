import { SPEC_VERSION, type Spec } from "@linden/core";
import { describe, expect, it } from "vitest";
import { applyPagePreset, matchPagePreset, setPageSize } from "../src/specEdit";

const spec: Spec = {
  specVersion: SPEC_VERSION,
  page: { width: 180, height: 240, font: { family: "Arial", size: 7 } },
  panels: [{ type: "yAxis" }],
  preset: "pollen-percent",
};

describe("page presets", () => {
  it("column presets set the width and keep the height; nothing outside spec.page changes", () => {
    const s = applyPagePreset(spec, "single", 240);
    expect(s.page).toEqual({ width: 85, height: 240, font: { family: "Arial", size: 7 } });
    expect({ ...s, page: spec.page }).toEqual(spec);
    expect(applyPagePreset(spec, "oneHalf", 240).page).toMatchObject({ width: 120, height: 240 });
    expect(applyPagePreset(spec, "double", 240).page).toMatchObject({ width: 180, height: 240 });
  });

  it("A4 presets set both sides", () => {
    expect(applyPagePreset(spec, "a4Portrait", 240).page).toMatchObject({ width: 210, height: 297 });
    expect(applyPagePreset(spec, "a4Landscape", 240).page).toMatchObject({ width: 297, height: 210 });
  });

  it("custom sizes and a spec without page", () => {
    expect(setPageSize(spec, { height: 100 }).page).toMatchObject({ width: 180, height: 100 });
    const { page: _p, ...noPage } = spec;
    expect(applyPagePreset(noPage, "single", 240).page).toEqual({ width: 85, height: 240 });
    expect(applyPagePreset(spec, "nope", 240)).toBe(spec);
  });

  it("recognises the preset of a page", () => {
    expect(matchPagePreset({ width: 85, height: 300 })).toBe("single");
    expect(matchPagePreset({ width: 297, height: 210 })).toBe("a4Landscape");
    expect(matchPagePreset({ width: 210, height: 297 })).toBe("a4Portrait");
    expect(matchPagePreset({ width: 210, height: 240 })).toBe("custom");
  });
});
