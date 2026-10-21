import { crc32, deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { fontSubstitutionWarning, svgSizeMm, useEmbeddedFont } from "../src/export/fonts";
import { pngSize, rasterSvg, setPngDpi } from "../src/export/png";

function chunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])));
  return Buffer.concat([head, data, crc]);
}

/** 1×1 RGBA PNG. */
function tinyPng(): Uint8Array {
  const ihdr = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return new Uint8Array(Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.from([0, 255, 255, 255, 255]))), chunk("IEND", new Uint8Array())]));
}

function chunks(png: Uint8Array): { type: string; data: Buffer; crcOk: boolean }[] {
  const b = Buffer.from(png);
  const out = [];
  for (let off = 8; off < b.length; ) {
    const len = b.readUInt32BE(off);
    const data = b.subarray(off + 8, off + 8 + len);
    out.push({ type: b.toString("latin1", off + 4, off + 8), data, crcOk: crc32(b.subarray(off + 4, off + 8 + len)) === b.readUInt32BE(off + 8 + len) });
    off += 12 + len;
  }
  return out;
}

describe("PNG export", () => {
  it("pixel size is mm / 25.4 × dpi", () => {
    expect(pngSize(180, 120, 600)).toEqual({ width: 4252, height: 2835 });
    expect(pngSize(85, 120, 300)).toEqual({ width: 1004, height: 1417 });
    expect(pngSize(297, 210, 1200)).toEqual({ width: 14031, height: 9921 });
    expect(pngSize(25.4, 50.8, 600)).toEqual({ width: 600, height: 1200 });
  });

  it("writes the dpi as a pHYs chunk right after IHDR, replacing an old one", () => {
    const once = setPngDpi(tinyPng(), 600);
    const twice = setPngDpi(once, 1200);
    for (const [png, dpi] of [[once, 600], [twice, 1200]] as const) {
      const c = chunks(png);
      expect(c.map((x) => x.type)).toEqual(["IHDR", "pHYs", "IDAT", "IEND"]);
      expect(c.every((x) => x.crcOk)).toBe(true);
      const phys = c[1]!.data;
      expect([phys.readUInt32BE(0), phys.readUInt32BE(4), phys[8]]).toEqual([Math.round(dpi / 0.0254), Math.round(dpi / 0.0254), 1]);
    }
  });

  it("rasterises an SVG sized in px with the font inlined and kerning off", () => {
    const svg = '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="180mm" height="120mm" viewBox="0 0 180 120">\n  <g font-family="Arial" font-size="2.47"><text>x</text></g>\n</svg>\n';
    const fonts = { regular: new Uint8Array([1, 2, 3]), italic: new Uint8Array([4, 5]) };
    const out = rasterSvg(svg, fonts, { width: 4252, height: 2835 });
    expect(out).toContain('<svg xmlns="http://www.w3.org/2000/svg" width="4252" height="2835" viewBox="0 0 180 120"><style>');
    expect(out).toContain('font-style:normal;font-weight:400;src:url(data:font/ttf;base64,AQID)');
    expect(out).toContain('font-style:italic;font-weight:400;src:url(data:font/ttf;base64,BAU=)');
    expect(out).toContain("text{font-kerning:none}");
    expect(out).toContain('<g font-family="Liberation Sans" font-size="2.47">');
  });
});

describe("export font", () => {
  it("substitutes Arial-compatible families silently and warns for others", () => {
    for (const f of ["Arial", "Helvetica", "'Liberation Sans', sans-serif", "sans-serif"]) expect(fontSubstitutionWarning(f)).toBeNull();
    expect(fontSubstitutionWarning("Times New Roman")).toMatch(/not bundled/);
    expect(useEmbeddedFont('<g font-family="Arial"><g font-family="Helvetica, sans-serif">')).toBe('<g font-family="Liberation Sans"><g font-family="Liberation Sans">');
  });

  it("reads the page size in mm from core's SVG", () => {
    expect(svgSizeMm('<svg xmlns="x" width="123.4mm" height="98.7mm" viewBox="0 0 123.4 98.7">')).toEqual({ width: 123.4, height: 98.7 });
    expect(() => svgSizeMm("<svg>")).toThrow();
  });
});
