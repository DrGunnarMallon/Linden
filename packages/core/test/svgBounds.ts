// Test helper: page-space bounding boxes of every drawn element in a Linden SVG string.
// Composes translate/rotate transforms; text boxes use the same width estimate and glyph box as the
// layout (ascent 0.75 em, descent 0.25 em), so this checks the geometry, not real font rendering.

import { TEXT_ASCENT, TEXT_DESCENT } from "../src/layout/header.js";
import { estimateTextWidth } from "../src/layout/theme.js";

type Matrix = [number, number, number, number, number, number];
export interface Box {
  tag: string;
  where: string;
  /** Class of the element or its nearest classed ancestor group. */
  cls: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const mul = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m: Matrix, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

function parseTransform(t: string | undefined): Matrix {
  let m = IDENTITY;
  for (const [, fn, args] of (t ?? "").matchAll(/(translate|rotate)\(([^)]*)\)/g)) {
    const a = args!.split(/[ ,]+/).map(Number);
    if (fn === "translate") m = mul(m, [1, 0, 0, 1, a[0]!, a[1] ?? 0]);
    else {
      const r = (a[0]! * Math.PI) / 180;
      const [cx, cy] = [a[1] ?? 0, a[2] ?? 0];
      m = mul(m, mul([1, 0, 0, 1, cx, cy], mul([Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0], [1, 0, 0, 1, -cx, -cy])));
    }
  }
  return m;
}

const attrs = (s: string) => Object.fromEntries([...s.matchAll(/([\w:-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
const decode = (s: string) => s.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

export function svgBounds(svg: string): { width: number; height: number; boxes: Box[] } {
  const root = attrs(/<svg([^>]*)>/.exec(svg)![1]!);
  const width = parseFloat(root.width!);
  const height = parseFloat(root.height!);
  const boxes: Box[] = [];
  const stack: { m: Matrix; fontSize: number; id: string; cls: string }[] = [{ m: IDENTITY, fontSize: 0, id: "svg", cls: "" }];
  const tagRe = /<(\/?)(g|line|rect|circle|path|text)\b([^>]*?)(\/?)>/g;
  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(svg))) {
    const [, close, tag, rawAttrs, selfClose] = match;
    const top = stack[stack.length - 1]!;
    if (close) {
      if (tag === "g") stack.pop();
      continue;
    }
    const a = attrs(rawAttrs!);
    const m = mul(top.m, parseTransform(a.transform));
    const fontSize = a["font-size"] ? Number(a["font-size"]) : top.fontSize;
    const where = a.id ?? top.id;
    const cls = a.class ?? top.cls;
    if (tag === "g") {
      if (!selfClose) stack.push({ m, fontSize, id: where, cls });
      continue;
    }
    const sw = Number(a["stroke-width"] ?? 0) / 2;
    let pts: [number, number][] = [];
    if (tag === "line") pts = [[+a.x1!, +a.y1!], [+a.x2!, +a.y2!]];
    else if (tag === "rect") pts = [[+a.x!, +a.y!], [+a.x! + +a.width!, +a.y! + +a.height!], [+a.x!, +a.y! + +a.height!], [+a.x! + +a.width!, +a.y!]];
    else if (tag === "circle") pts = [[+a.cx! - +a.r!, +a.cy! - +a.r!], [+a.cx! + +a.r!, +a.cy! + +a.r!]];
    else if (tag === "path") pts = [...a.d!.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((p) => [Number(p[1]), Number(p[2])]);
    else if (tag === "text") {
      const end = svg.indexOf("</text>", tagRe.lastIndex);
      const content = decode(svg.slice(tagRe.lastIndex, end));
      tagRe.lastIndex = end + "</text>".length;
      const w = estimateTextWidth(content, fontSize);
      const x = +a.x!;
      const xl = a["text-anchor"] === "middle" ? x - w / 2 : a["text-anchor"] === "end" ? x - w : x;
      const y = +a.y!;
      pts = [[xl, y - TEXT_ASCENT * fontSize], [xl + w, y - TEXT_ASCENT * fontSize], [xl, y + TEXT_DESCENT * fontSize], [xl + w, y + TEXT_DESCENT * fontSize]];
    }
    const page = pts.map(([x, y]) => apply(m, x, y));
    boxes.push({
      tag: tag!,
      where,
      cls,
      x0: Math.min(...page.map((p) => p[0])) - sw,
      y0: Math.min(...page.map((p) => p[1])) - sw,
      x1: Math.max(...page.map((p) => p[0])) + sw,
      y1: Math.max(...page.map((p) => p[1])) + sw,
    });
  }
  return { width, height, boxes };
}

/** Elements whose box leaves the page (tolerance for 0.01 mm output rounding). */
export function outsidePage(svg: string, tolerance = 0.02): Box[] {
  const { width, height, boxes } = svgBounds(svg);
  return boxes.filter((b) => b.x0 < -tolerance || b.y0 < -tolerance || b.x1 > width + tolerance || b.y1 > height + tolerance);
}
