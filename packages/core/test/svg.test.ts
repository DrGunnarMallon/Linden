import { describe, expect, it } from "vitest";
import { PathBuilder, SvgGroup, fmt, markupToSvg, svgDocument } from "../src/render/svg.js";

describe("svg builder", () => {
  it("rounds to 0.01 mm and never prints -0", () => {
    expect(fmt(1.23456)).toBe("1.23");
    expect(fmt(2)).toBe("2");
    expect(fmt(-0.001)).toBe("0");
    expect(() => fmt(Number.NaN)).toThrow();
  });

  it("emits attributes in a fixed order regardless of insertion order", () => {
    const a = new SvgGroup();
    a.line(0, 0, 1, 1, { "stroke-width": 0.1, stroke: "#000", class: "x" });
    const b = new SvgGroup();
    b.line(0, 0, 1, 1, { class: "x", stroke: "#000", "stroke-width": 0.1 });
    expect(a.toString()).toBe(b.toString());
    expect(a.toString()).toContain('<line class="x" x1="0" y1="0" x2="1" y2="1" stroke="#000" stroke-width="0.1"/>');
  });

  it("renders *italic* markup as tspans and escapes text", () => {
    expect(markupToSvg("*Alnus*-type")).toBe('<tspan font-style="italic">Alnus</tspan>-type');
    expect(markupToSvg("Poaceae")).toBe("Poaceae");
    expect(markupToSvg("a < b & *c*")).toBe('a &lt; b &amp; <tspan font-style="italic">c</tspan>');
    expect(markupToSvg("5*")).toBe("5*");
  });

  it("builds paths and nested groups", () => {
    const d = new PathBuilder().moveTo(0, 0).lineTo(1.005, 2.333).close();
    expect(String(d)).toBe("M0,0L1,2.33Z");
    const svg = svgDocument(10, 5, (root) => {
      root.group({ id: "g" }).rect(0, 0, 1, 1).text(1, 2, "*x*");
    });
    expect(svg).toBe(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<svg xmlns="http://www.w3.org/2000/svg" width="10mm" height="5mm" viewBox="0 0 10 5">',
        '  <g id="g">',
        '    <rect x="0" y="0" width="1" height="1"/>',
        '    <text x="1" y="2"><tspan font-style="italic">x</tspan></text>',
        "  </g>",
        "</svg>",
        "",
      ].join("\n"),
    );
  });
});
