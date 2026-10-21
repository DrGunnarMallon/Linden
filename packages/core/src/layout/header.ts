// Header band — SPEC.md §6. Rotated taxon labels anchored at column centres, and group header
// brackets above them. Laid out once for all panels so every label shares one font size.
// Coordinates in mm relative to the plot's top-left corner; the header band is at y < 0.

import type { HeaderSpec } from "../model/spec.js";
import { PathBuilder, type SvgGroup } from "../render/svg.js";
import { formatNumber } from "./scales.js";
import { estimateTextWidth, PT_TO_MM, type Theme } from "./theme.js";

/** One labelled column, as exposed by a panel's `columns()`; `x` from the plot's left edge. */
export interface HeaderColumn {
  id: string;
  /** Display name; may contain *italic* markup. */
  label: string;
  group?: string;
  x: number;
  width: number;
}

export interface LabelOptions {
  /** Degrees from horizontal. */
  angle: number;
  /** Base and minimum font size in pt. */
  fontSize: number;
  minFontSize: number;
  /** Target label band height in mm; null = fit the labels. */
  height: number | null;
  /** Font-size step in pt. */
  step: number;
  /** Perpendicular space a label needs, in em. */
  thickness: number;
}

/** Rotated taxon labels: baseline shifted by OFFSET em across the text (so the glyphs centre on the
 * column), glyph box ASCENT em above and DESCENT em below the baseline. Shared with the renderer. */
export const LABEL_OFFSET = 0.35;
export const TEXT_ASCENT = 0.75;
export const TEXT_DESCENT = 0.25;

export interface LabelLayout {
  /** Label font size in mm. */
  fontSize: number;
  angle: number;
  /** Height of the label band in mm (without the gap above the plot). */
  height: number;
  /** Left end of the leftmost / right end of the rightmost label, from the plot's left edge. */
  left: number;
  right: number;
  /** Adjacent label pairs that still overlap. */
  collisions: number;
  warnings: string[];
}

interface Fit {
  height: number;
  left: number;
  right: number;
  collisions: [string, string][];
}

const pt = (mm: number) => formatNumber(Math.round((mm / PT_TO_MM) * 100) / 100);
const mm1 = (n: number) => formatNumber(Math.round(n * 10) / 10);

/** Label band height, right extent and overlapping neighbours at font size `em` (mm). */
function fitAt(cols: readonly HeaderColumn[], em: number, opts: LabelOptions): Fit {
  const a = (opts.angle * Math.PI) / 180;
  const sin = Math.sin(a);
  const cos = Math.cos(a);
  const widths = cols.map((c) => estimateTextWidth(c.label, em));
  let height = 0;
  let left = Number.POSITIVE_INFINITY;
  let right = 0;
  const collisions: [string, string][] = [];
  cols.forEach((c, i) => {
    const w = widths[i]!;
    if (w === 0) return;
    const centre = c.x + c.width / 2;
    height = Math.max(height, w * sin + em * cos);
    // Corners of the rotated glyph box (see LABEL_OFFSET / TEXT_ASCENT / TEXT_DESCENT).
    left = Math.min(left, centre + (LABEL_OFFSET - TEXT_ASCENT) * em * sin);
    right = Math.max(right, centre + w * cos + (LABEL_OFFSET + TEXT_DESCENT) * em * sin);
    // Parallel neighbours: d·sinθ apart across the text, d·cosθ along it.
    const next = cols[i + 1];
    if (next && widths[i + 1]! > 0) {
      const d = next.x + next.width / 2 - centre;
      if (d * sin < opts.thickness * em && d * cos < w) collisions.push([c.id, next.id]);
    }
  });
  return { height, left: Number.isFinite(left) ? left : 0, right, collisions };
}

/**
 * Picks the label font size: the largest size, in `step` pt decrements from `fontSize` down to
 * `minFontSize`, at which no labels overlap and the labels fit `height`. If none works, uses the
 * minimum, grows the band to fit and warns about anything still overlapping.
 */
export function layoutLabels(cols: readonly HeaderColumn[], opts: LabelOptions): LabelLayout {
  const min = Math.min(opts.minFontSize, opts.fontSize);
  const sizes: number[] = [];
  for (let k = 0; opts.fontSize - k * opts.step > min + 1e-9; k++) sizes.push(opts.fontSize - k * opts.step);
  sizes.push(min);

  const fits = (f: Fit) => f.collisions.length === 0 && (opts.height === null || f.height <= opts.height + 1e-9);
  let em = min * PT_TO_MM;
  let fit: Fit | undefined;
  for (const size of sizes) {
    const f = fitAt(cols, size * PT_TO_MM, opts);
    if (fits(f)) {
      em = size * PT_TO_MM;
      fit = f;
      break;
    }
  }
  fit ??= fitAt(cols, em, opts);

  const warnings: string[] = [];
  if (opts.height !== null && fit.height > opts.height + 1e-9) {
    warnings.push(
      `Taxon labels need ${mm1(fit.height)} mm at the minimum font size of ${pt(em)} pt; ` +
        `header band increased from ${mm1(opts.height)} mm.`,
    );
  }
  if (fit.collisions.length > 0) {
    const [a, b] = fit.collisions[0]!;
    warnings.push(
      `${fit.collisions.length} pair(s) of taxon labels overlap even at the minimum font size of ${pt(em)} pt ` +
        `(first: "${a}" and "${b}"). Select fewer variables, widen the columns, or change headerBand.angle / minFontSize.`,
    );
  }
  return {
    fontSize: em,
    angle: opts.angle,
    height: opts.height === null ? fit.height : Math.max(opts.height, fit.height),
    left: fit.left,
    right: fit.right,
    collisions: fit.collisions.length,
    warnings,
  };
}

export interface GroupSpan {
  label: string;
  /** Horizontal extent from the plot's left edge. */
  x0: number;
  x1: number;
}

/** Height of the group header row (bracket + label). */
export function groupRowHeight(theme: Theme): number {
  return theme.bracketGap + 0.5 + theme.fontSize;
}

/**
 * One bracket per header spanning exactly its matching columns (by group or id). Matching columns
 * that are not adjacent give one bracket per run (label on the first) and a warning.
 */
export function groupSpans(
  headers: readonly HeaderSpec[],
  cols: readonly HeaderColumn[],
  groupName: (id: string) => string,
  theme: Theme,
  warn: (m: string) => void,
): GroupSpan[] {
  const spans: GroupSpan[] = [];
  for (const h of headers) {
    const groups = h.spans.groups ?? [];
    const ids = h.spans.ids ?? [];
    const label = h.label ?? groups.map(groupName).join(" & ");
    const name = label || [...groups, ...ids].join(", ");
    const hit = cols.map((c) => (c.group !== undefined && groups.includes(c.group)) || ids.includes(c.id));
    const runs: [number, number][] = [];
    hit.forEach((on, i) => {
      if (!on) return;
      const last = runs[runs.length - 1];
      if (last && last[1] === i - 1) last[1] = i;
      else runs.push([i, i]);
    });
    if (runs.length === 0) {
      warn(`Header "${name}" matches no columns; omitted.`);
      continue;
    }
    if (runs.length > 1) {
      warn(`Header "${name}" spans non-adjacent columns; drawn as ${runs.length} brackets. Reorder the variables to keep them together.`);
    }
    runs.forEach(([i, j], k) => {
      spans.push({ label: k === 0 ? label : "", x0: cols[i]!.x, x1: cols[j]!.x + cols[j]!.width });
    });
  }

  // Never overlap silently: brackets or labels on the shared row.
  const extent = (s: GroupSpan): [number, number] => {
    const half = estimateTextWidth(s.label, theme.fontSize) / 2;
    const c = (s.x0 + s.x1) / 2;
    return [Math.min(s.x0, c - half), Math.max(s.x1, c + half)];
  };
  for (let i = 0; i < spans.length; i++) {
    for (let j = i + 1; j < spans.length; j++) {
      const [a0, a1] = extent(spans[i]!);
      const [b0, b1] = extent(spans[j]!);
      if (a0 < b1 && b0 < a1) {
        const names = [spans[i]!, spans[j]!].map((s) => s.label || "(bracket)");
        warn(`Group headers "${names[0]}" and "${names[1]}" overlap; shorten the labels or check the header spans.`);
      }
    }
  }
  return spans;
}

/** Horizontal extent of the group header row (brackets and centred labels). */
export function groupSpansExtent(spans: readonly GroupSpan[], theme: Theme): { left: number; right: number } {
  let left = 0;
  let right = 0;
  for (const s of spans) {
    const half = estimateTextWidth(s.label, theme.fontSize) / 2;
    const c = (s.x0 + s.x1) / 2;
    left = Math.min(left, s.x0, c - half);
    right = Math.max(right, s.x1, c + half);
  }
  return { left, right };
}

/** Draws brackets whose line sits `bracketGap` above `top` (the top of the label band). */
export function renderGroupHeaders(g: SvgGroup, spans: readonly GroupSpan[], top: number, theme: Theme): void {
  const y = top - theme.bracketGap;
  const t = theme.bracketTick;
  for (const s of spans) {
    const d = new PathBuilder().moveTo(s.x0, y + t).lineTo(s.x0, y).lineTo(s.x1, y).lineTo(s.x1, y + t);
    g.path(d, { class: "bracket", fill: "none", stroke: theme.stroke, "stroke-width": theme.lineWidth });
    if (s.label) g.text((s.x0 + s.x1) / 2, y - 0.5, s.label, { class: "group-header", "text-anchor": "middle" });
  }
}
