// Minimal TrueType reader for tests: advance widths per character (cmap format 4 + hmtx).

import { readFileSync } from "node:fs";

export interface TtfMetrics {
  unitsPerEm: number;
  /** Advance width of a BMP character in font units, or undefined if the font has no glyph. */
  advance(ch: string): number | undefined;
}

export function readTtfMetrics(path: URL): TtfMetrics {
  const buf = readFileSync(path);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const tables = new Map<string, number>();
  const numTables = view.getUint16(4);
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    tables.set(buf.toString("latin1", rec, rec + 4), view.getUint32(rec + 8));
  }
  const table = (tag: string) => {
    const off = tables.get(tag);
    if (off === undefined) throw new Error(`TTF table ${tag} missing`);
    return off;
  };

  const unitsPerEm = view.getUint16(table("head") + 18);
  const numHMetrics = view.getUint16(table("hhea") + 34);
  const hmtx = table("hmtx");
  const advanceOf = (glyph: number) => view.getUint16(hmtx + 4 * Math.min(glyph, numHMetrics - 1));

  // Unicode BMP subtable (platform 3, encoding 1), format 4.
  const cmap = table("cmap");
  let sub = -1;
  for (let i = 0; i < view.getUint16(cmap + 2); i++) {
    const rec = cmap + 4 + i * 8;
    if (view.getUint16(rec) === 3 && view.getUint16(rec + 2) === 1) sub = cmap + view.getUint32(rec + 4);
  }
  if (sub < 0 || view.getUint16(sub) !== 4) throw new Error("No format-4 Unicode cmap");
  const segX2 = view.getUint16(sub + 6);
  const ends = sub + 14;
  const starts = ends + segX2 + 2;
  const deltas = starts + segX2;
  const rangeOffsets = deltas + segX2;

  const glyphOf = (code: number): number => {
    for (let s = 0; s < segX2; s += 2) {
      if (code > view.getUint16(ends + s)) continue;
      const start = view.getUint16(starts + s);
      if (code < start) return 0;
      const delta = view.getInt16(deltas + s);
      const ro = view.getUint16(rangeOffsets + s);
      if (ro === 0) return (code + delta) & 0xffff;
      const g = view.getUint16(rangeOffsets + s + ro + 2 * (code - start));
      return g === 0 ? 0 : (g + delta) & 0xffff;
    }
    return 0;
  };

  return {
    unitsPerEm,
    advance(ch) {
      const g = glyphOf(ch.codePointAt(0)!);
      return g === 0 ? undefined : advanceOf(g);
    },
  };
}
