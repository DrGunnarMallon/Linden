// WCAG contrast audit of the theme tokens in src/styles.css, for both themes. Keeps future tweaks honest:
// change a colour and this fails if any text/surface pair drops below the rule.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type RGBA = [number, number, number, number];

const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`no ${selector} block in styles.css`);
  const body = css.slice(start, css.indexOf("}", start));
  const tokens: Record<string, string> = {};
  for (const m of body.matchAll(/--([\w-]+):\s*([^;]+);/g)) tokens[m[1]] = m[2].trim();
  return tokens;
}

function parse(value: string): RGBA {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)).concat(1) as RGBA;
  const rgb = /^rgb\((\d+) (\d+) (\d+)(?: \/ ([\d.]+))?\)$/.exec(value);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), rgb[4] === undefined ? 1 : Number(rgb[4])];
  throw new Error(`unsupported colour ${value}`);
}

/** `fg` with alpha `a` composited over an opaque `bg`. */
const over = (fg: RGBA, bg: RGBA, a = fg[3]): RGBA => [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a)).concat(1) as RGBA;

function luminance([r, g, b]: RGBA): number {
  const lin = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: RGBA, b: RGBA): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const THEMES = { dark: ':root,\n[data-theme="dark"]', light: '[data-theme="light"]' };
/** Every surface text can sit on, lowest to highest elevation. */
const SURFACES = ["canvas", "bg", "surface-1", "surface-2", "surface-raised", "surface-3"];
const READABLE = ["text", "text-secondary", "text-muted", "accent-text", "danger-text", "warning-text"];

/** Known failures, left as they are on purpose. Exactly these may fail: a new failure fails the test,
 *  and so does a listed one that has been fixed (remove it here then). */
const KNOWN: Record<string, string[]> = {
  dark: [],
  // The light theme predates the disabled/border rules and was kept unchanged when the dark theme was retuned.
  light: [
    "disabled text on bg",
    "disabled text-secondary on bg",
    "disabled text on surface-1",
    "disabled text-secondary on surface-1",
    "disabled text on surface-2",
    "disabled text-secondary on surface-2",
    "disabled text on surface-raised",
    "disabled text-secondary on surface-raised",
    "border on bg",
  ],
};

describe.each(Object.entries(THEMES))("%s theme tokens", (theme, selector) => {
  const t = block(selector);
  const c = (name: string): RGBA => {
    if (!(name in t)) throw new Error(`--${name} missing in ${theme} theme`);
    return parse(t[name]);
  };
  /** Pairs below `min` that aren't known exceptions, plus known exceptions in this set that now pass. */
  const failures = (pairs: [string, string, number][], min: number) =>
    pairs.flatMap(([a, b, r]) => {
      const known = KNOWN[theme].includes(`${a} on ${b}`);
      if (r < min && !known) return [`${a} on ${b}: ${r.toFixed(2)}`];
      if (r >= min && known) return [`${a} on ${b} passes now (${r.toFixed(2)}): remove it from KNOWN`];
      return [];
    });

  it("readable text is ≥ 4.5:1 on every surface", () => {
    const pairs = READABLE.flatMap((fg) => SURFACES.map((bg): [string, string, number] => [fg, bg, contrast(c(fg), c(bg))]));
    expect(failures(pairs, 4.5)).toEqual([]);
  });

  it("text on filled and tinted backgrounds is ≥ 4.5:1", () => {
    const pairs: [string, string, number][] = [
      ["on-accent", "accent", contrast(c("on-accent"), c("accent"))],
      ["on-accent", "accent-hover", contrast(c("on-accent"), c("accent-hover"))],
      ["on-accent", "danger", contrast(c("on-accent"), c("danger"))],
    ];
    for (const bg of ["surface-1", "surface-2", "surface-raised"]) {
      const tint = (name: string) => over(c(name), c(bg));
      pairs.push(
        ["accent-text", `accent-subtle/${bg}`, contrast(c("accent-text"), tint("accent-subtle"))],
        ["text", `accent-subtle/${bg}`, contrast(c("text"), tint("accent-subtle"))],
        ["warning-text", `warning-subtle/${bg}`, contrast(c("warning-text"), tint("warning-subtle"))],
        ["danger-text", `danger-subtle/${bg}`, contrast(c("danger-text"), tint("danger-subtle"))],
        ["text", `danger-subtle/${bg}`, contrast(c("text"), tint("danger-subtle"))],
      );
    }
    expect(failures(pairs, 4.5)).toEqual([]);
  });

  it("disabled controls and the focus ring are ≥ 3:1", () => {
    const fade = Number(t["disabled-opacity"]);
    expect(fade).toBeGreaterThan(0);
    const pairs: [string, string, number][] = [];
    for (const bg of ["bg", "surface-1", "surface-2", "surface-raised"]) {
      for (const fg of ["text", "text-secondary"]) pairs.push([`disabled ${fg}`, bg, contrast(over(c(fg), c(bg), fade), c(bg))]);
    }
    for (const bg of SURFACES) pairs.push(["focus", bg, contrast(c("focus"), c(bg))]);
    expect(failures(pairs, 3)).toEqual([]);
  });

  it("borders stay visible against the surfaces they separate", () => {
    const pairs: [string, string, number][] = [];
    for (const bg of ["bg", "surface-1", "surface-2"]) pairs.push(["border", bg, contrast(c("border"), c(bg))]);
    for (const bg of ["bg", "surface-1", "surface-2", "surface-raised"]) pairs.push(["border-strong", bg, contrast(c("border-strong"), c(bg))]);
    expect(failures(pairs, 1.2)).toEqual([]);
  });

  it("the canvas dot grid is subtle but visible", () => {
    const r = contrast(c("canvas-dot"), c("canvas"));
    expect(r).toBeGreaterThan(1.15);
    expect(r).toBeLessThan(1.6);
  });
});

describe("dark theme elevation", () => {
  it("surfaces get lighter as they rise", () => {
    const t = block(THEMES.dark);
    const lum = SURFACES.map((s) => luminance(parse(t[s])));
    for (let i = 1; i < lum.length; i++) expect(lum[i], SURFACES[i]).toBeGreaterThanOrEqual(lum[i - 1]);
    expect(luminance(parse(t["canvas-dot"]))).toBeGreaterThan(luminance(parse(t.canvas)));
  });
});
