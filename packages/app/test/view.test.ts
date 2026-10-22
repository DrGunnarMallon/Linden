import { describe, expect, it } from "vitest";
import { fileBase } from "../src/store";
import { parsePreference, resolveTheme } from "../src/theme";
import { clampSidebar, clampZoom, MAX_ZOOM, MIN_ZOOM, parseSidebarWidths, pushRecentColour, SIDEBAR_WIDTH, stepZoom } from "../src/view";

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

describe("sidebar widths", () => {
  it("clamps a dragged width to the sidebar's range, in whole px", () => {
    expect(clampSidebar("left", 300.6)).toBe(301);
    expect(clampSidebar("left", 50)).toBe(SIDEBAR_WIDTH.left.min);
    expect(clampSidebar("right", 5000)).toBe(SIDEBAR_WIDTH.right.max);
    expect(clampSidebar("right", Number.NaN)).toBe(SIDEBAR_WIDTH.right.default);
  });

  it("reads stored widths, falling back to the defaults for anything unreadable", () => {
    expect(parseSidebarWidths('{"left":300,"right":500}')).toEqual({ left: 300, right: 500 });
    expect(parseSidebarWidths('{"left":10}')).toEqual({ left: SIDEBAR_WIDTH.left.min, right: SIDEBAR_WIDTH.right.default });
    expect(parseSidebarWidths(null)).toEqual({ left: 272, right: 384 });
    expect(parseSidebarWidths("not json")).toEqual({ left: 272, right: 384 });
    expect(parseSidebarWidths('{"left":"wide"}')).toEqual({ left: 272, right: 384 });
  });
});

describe("recent colours", () => {
  it("most recent first, unique regardless of case, at most 8", () => {
    expect(pushRecentColour(["#aa0000", "#00bb00"], "#00BB00")).toEqual(["#00BB00", "#aa0000"]);
    const many = Array.from({ length: 8 }, (_, i) => `#00000${i}`);
    expect(pushRecentColour(many, "#ffffff")).toEqual(["#ffffff", ...many.slice(0, 7)]);
  });
});
