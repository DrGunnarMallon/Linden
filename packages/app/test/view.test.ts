import { describe, expect, it } from "vitest";
import { fileBase } from "../src/store";
import { parsePreference, resolveTheme } from "../src/theme";
import { clampZoom, MAX_ZOOM, MIN_ZOOM, stepZoom } from "../src/view";

describe("theme", () => {
  it("defaults to following the system, which falls back to dark", () => {
    expect(parsePreference(null)).toBe("system");
    expect(parsePreference("purple")).toBe("system");
    expect(resolveTheme("system", false)).toBe("dark");
    expect(resolveTheme("system", true)).toBe("light");
  });

  it("an explicit choice wins over the system setting", () => {
    expect(resolveTheme("dark", true)).toBe("dark");
    expect(resolveTheme("light", false)).toBe("light");
  });
});

describe("zoom", () => {
  it("steps to the next preset above or below the current scale", () => {
    expect(stepZoom(1, 1)).toBe(1.25);
    expect(stepZoom(1, -1)).toBe(0.75);
    expect(stepZoom(1.1, 1)).toBe(1.25); // from a fit scale
    expect(stepZoom(1.1, -1)).toBe(1);
  });

  it("stays within the limits", () => {
    expect(stepZoom(MAX_ZOOM, 1)).toBe(MAX_ZOOM);
    expect(stepZoom(MIN_ZOOM, -1)).toBe(MIN_ZOOM);
    expect(clampZoom(100)).toBe(MAX_ZOOM);
    expect(clampZoom(0)).toBe(MIN_ZOOM);
  });
});

describe("download file names", () => {
  it("are a slug of the project name", () => {
    expect(fileBase("Testate amoebae example")).toBe("testate-amoebae-example");
    expect(fileBase("  Loch Ness: core 2 / 2024 ")).toBe("loch-ness-core-2-2024");
    expect(fileBase("Ödmarksmossen")).toBe("ödmarksmossen");
    expect(fileBase("  ")).toBe("diagram");
  });
});
