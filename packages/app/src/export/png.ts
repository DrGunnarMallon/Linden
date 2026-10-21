// PNG export: core's SVG rasterised by the browser at a chosen dpi, with the bundled font embedded
// in the SVG (an SVG drawn as an image cannot use page or system fonts reliably). SPEC.md §10.

import type { Exporter } from "@linden/core";
import { EMBEDDED_FONT, loadFontFiles, svgSizeMm, toBase64, useEmbeddedFont, type FontFiles } from "./fonts";

export const PNG_DPIS = [300, 600, 1200] as const;

export interface PngOptions {
  dpi: number;
  /** true = opaque white background; false = transparent. */
  background: boolean;
}

/** Pixel size of a page: mm / 25.4 × dpi, rounded to whole pixels. */
export function pngSize(widthMm: number, heightMm: number, dpi: number): { width: number; height: number } {
  return { width: Math.round((widthMm / 25.4) * dpi), height: Math.round((heightMm / 25.4) * dpi) };
}

/** The SVG as rasterised: fonts inlined as data URLs, kerning off (as in core's metrics and the PDF), size in px. */
export function rasterSvg(svg: string, fonts: FontFiles, px: { width: number; height: number }): string {
  const face = (bytes: Uint8Array, style: string) =>
    `@font-face{font-family:"${EMBEDDED_FONT}";font-style:${style};font-weight:400;src:url(data:font/ttf;base64,${toBase64(bytes)}) format("truetype")}`;
  const style = `<style>${face(fonts.regular, "normal")}${face(fonts.italic, "italic")}text{font-kerning:none}</style>`;
  return useEmbeddedFont(svg).replace(/<svg\b[^>]*>/, (open) =>
    open.replace(/\bwidth="[^"]*"/, `width="${px.width}"`).replace(/\bheight="[^"]*"/, `height="${px.height}"`) + style,
  );
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Inserts (or replaces) the pHYs chunk so the file records its resolution (dots per metre). */
export function setPngDpi(png: Uint8Array, dpi: number): Uint8Array<ArrayBuffer> {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const chunks: Uint8Array[] = [png.subarray(0, 8)];
  let ihdrEnd = -1;
  for (let off = 8; off < png.length; ) {
    const len = view.getUint32(off);
    const type = String.fromCharCode(...png.subarray(off + 4, off + 8));
    const end = off + 12 + len;
    if (type !== "pHYs") chunks.push(png.subarray(off, end));
    if (type === "IHDR") ihdrEnd = chunks.length;
    off = end;
  }
  if (ihdrEnd < 0) throw new Error("Not a PNG file.");
  const ppm = Math.round(dpi / 0.0254);
  const phys = new Uint8Array(21);
  const pv = new DataView(phys.buffer);
  pv.setUint32(0, 9);
  phys.set([0x70, 0x48, 0x59, 0x73], 4); // "pHYs"
  pv.setUint32(8, ppm);
  pv.setUint32(12, ppm);
  phys[16] = 1; // unit: metre
  pv.setUint32(17, crc32(phys.subarray(4, 17)));
  chunks.splice(ihdrEnd, 0, phys);
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** Rasterises in the browser (Image + canvas). */
export async function svgToPng(svg: string, fonts: FontFiles, opts: PngOptions): Promise<Blob> {
  const mm = svgSizeMm(svg);
  const px = pngSize(mm.width, mm.height, opts.dpi);
  const url = URL.createObjectURL(new Blob([rasterSvg(svg, fonts, px)], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = px.width;
    canvas.height = px.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No 2D canvas available.");
    if (opts.background) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, px.width, px.height);
    }
    ctx.drawImage(img, 0, 0, px.width, px.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error(`The browser could not create a ${px.width} × ${px.height} px image; try a lower dpi.`);
    return new Blob([setPngDpi(new Uint8Array(await blob.arrayBuffer()), opts.dpi)], { type: "image/png" });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export const pngExporter: Exporter = {
  type: "png",
  async export(svg, opts) {
    return svgToPng(svg, await loadFontFiles(), opts as PngOptions);
  },
};
