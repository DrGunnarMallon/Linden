// String-based SVG builder — no DOM. Deterministic output:
// numbers rounded to 0.01, attributes emitted in a fixed canonical order.

export type AttrValue = string | number | undefined;
export type Attrs = Record<string, AttrValue>;

/** Canonical attribute order; attributes not listed follow alphabetically. */
const ATTR_ORDER = [
  "xmlns",
  "id",
  "class",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "width",
  "height",
  "viewBox",
  "d",
  "transform",
  "fill",
  "fill-opacity",
  "stroke",
  "stroke-width",
  "stroke-dasharray",
  "font-family",
  "font-size",
  "font-style",
  "font-weight",
  "text-anchor",
];

function rank(name: string): number {
  const i = ATTR_ORDER.indexOf(name);
  return i === -1 ? ATTR_ORDER.length : i;
}

/** Rounds to 0.01 and prints without trailing zeros; never "-0". */
export function fmt(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`Non-finite coordinate: ${n}`);
  const r = Math.round(n * 100) / 100;
  return String(r === 0 ? 0 : r);
}

export function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function attrString(attrs: Attrs): string {
  const keys = Object.keys(attrs).filter((k) => attrs[k] !== undefined);
  keys.sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0));
  return keys
    .map((k) => {
      const v = attrs[k]!;
      return ` ${k}="${typeof v === "number" ? fmt(v) : escapeXml(v)}"`;
    })
    .join("");
}

/** "*Alnus*-type" → <tspan font-style="italic">Alnus</tspan>-type. Unpaired "*" stays literal. */
export function markupToSvg(text: string): string {
  let out = "";
  let last = 0;
  for (const m of text.matchAll(/\*([^*]+)\*/g)) {
    out += escapeXml(text.slice(last, m.index));
    out += `<tspan font-style="italic">${escapeXml(m[1]!)}</tspan>`;
    last = m.index + m[0].length;
  }
  return out + escapeXml(text.slice(last));
}

/** Plain text of a label with markup removed (for width estimates). */
export function stripMarkup(text: string): string {
  return text.replace(/\*([^*]+)\*/g, "$1");
}

export function translate(x: number, y: number): string {
  return `translate(${fmt(x)},${fmt(y)})`;
}

export function rotate(angle: number, cx: number, cy: number): string {
  return `rotate(${fmt(angle)},${fmt(cx)},${fmt(cy)})`;
}

/** Path data with rounded coordinates. */
export class PathBuilder {
  private readonly parts: string[] = [];

  moveTo(x: number, y: number): this {
    this.parts.push(`M${fmt(x)},${fmt(y)}`);
    return this;
  }

  lineTo(x: number, y: number): this {
    this.parts.push(`L${fmt(x)},${fmt(y)}`);
    return this;
  }

  close(): this {
    this.parts.push("Z");
    return this;
  }

  isEmpty(): boolean {
    return this.parts.length === 0;
  }

  toString(): string {
    return this.parts.join("");
  }
}

export class SvgGroup {
  private readonly children: (string | SvgGroup)[] = [];

  constructor(
    private readonly attrs: Attrs = {},
    private readonly tag = "g",
  ) {}

  /** Appends a child group and returns it. */
  group(attrs: Attrs = {}): SvgGroup {
    const g = new SvgGroup(attrs);
    this.children.push(g);
    return g;
  }

  path(d: string | PathBuilder, attrs: Attrs = {}): this {
    this.children.push(`<path${attrString({ ...attrs, d: String(d) })}/>`);
    return this;
  }

  line(x1: number, y1: number, x2: number, y2: number, attrs: Attrs = {}): this {
    this.children.push(`<line${attrString({ ...attrs, x1, y1, x2, y2 })}/>`);
    return this;
  }

  rect(x: number, y: number, width: number, height: number, attrs: Attrs = {}): this {
    this.children.push(`<rect${attrString({ ...attrs, x, y, width, height })}/>`);
    return this;
  }

  /** `content` may contain *italic* markup. */
  text(x: number, y: number, content: string, attrs: Attrs = {}): this {
    this.children.push(`<text${attrString({ ...attrs, x, y })}>${markupToSvg(content)}</text>`);
    return this;
  }

  toString(indent = ""): string {
    const open = `${indent}<${this.tag}${attrString(this.attrs)}`;
    if (this.children.length === 0) return `${open}/>`;
    const inner = this.children
      .map((c) => (typeof c === "string" ? `${indent}  ${c}` : c.toString(`${indent}  `)))
      .join("\n");
    return `${open}>\n${inner}\n${indent}</${this.tag}>`;
  }
}

/** Root document in mm: user units = mm via viewBox. */
export function svgDocument(widthMm: number, heightMm: number, build: (root: SvgGroup) => void): string {
  const root = new SvgGroup(
    {
      xmlns: "http://www.w3.org/2000/svg",
      width: `${fmt(widthMm)}mm`,
      height: `${fmt(heightMm)}mm`,
      viewBox: `0 0 ${fmt(widthMm)} ${fmt(heightMm)}`,
    },
    "svg",
  );
  build(root);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${root.toString()}\n`;
}
