// Title band — SPEC.md §6. Diagram title and subtitle in a band above the header band.
// The band's height is reserved (the plot gets shorter); a title too wide for the page is set
// smaller in steps (info), down to the labels font size, then reported (warning).

import type { ResolvedTitle } from "../model/defaults.js";
import type { SvgGroup } from "../render/svg.js";
import { TEXT_ASCENT, TEXT_DESCENT } from "./header.js";
import { formatNumber } from "./scales.js";
import { estimateTextWidth, familyAttr, PT_TO_MM, type Theme } from "./theme.js";

/** Subtitle size relative to the title. */
export const SUBTITLE_RATIO = 0.8;
/** Space between the band and the header band below, mm. */
export const TITLE_GAP = 2;
/** Extra space between title and subtitle, in em of the subtitle. */
export const TITLE_LEADING = 0.3;

export interface TitleLine {
  text: string;
  class: "title" | "subtitle";
  /** Font size, mm. */
  size: number;
  /** Baseline, mm below the top of the band. */
  baseline: number;
}

export interface TitleLayout {
  /** Band height including the gap below; 0 = no band. */
  height: number;
  /** Widest line, mm. */
  width: number;
  /** Title font size used, pt. */
  size: number;
  lines: TitleLine[];
  info: string[];
  warnings: string[];
}

const NO_TITLE: TitleLayout = { height: 0, width: 0, size: 0, lines: [], info: [], warnings: [] };
const mm1 = (n: number) => formatNumber(Math.round(n * 10) / 10);

function linesAt(title: ResolvedTitle, sizePt: number): TitleLine[] {
  const lines: TitleLine[] = [];
  let y = 0;
  const add = (text: string | undefined, cls: TitleLine["class"], size: number) => {
    if (!text) return;
    if (lines.length > 0) y += TITLE_LEADING * size;
    lines.push({ text, class: cls, size, baseline: y + TEXT_ASCENT * size });
    y += (TEXT_ASCENT + TEXT_DESCENT) * size;
  };
  add(title.text, "title", sizePt * PT_TO_MM);
  add(title.subtitle, "subtitle", sizePt * SUBTITLE_RATIO * PT_TO_MM);
  return lines;
}

const widthOf = (lines: readonly TitleLine[]) => lines.reduce((w, l) => Math.max(w, estimateTextWidth(l.text, l.size)), 0);
const bottomOf = (lines: readonly TitleLine[]) => {
  const last = lines[lines.length - 1];
  return last ? last.baseline + TEXT_DESCENT * last.size : 0;
};

/**
 * Lays out the title band for `available` mm between the page margins. The title size (pt) is
 * reduced in `step` pt decrements, down to `minSize`, until the widest line fits.
 */
export function layoutTitle(title: ResolvedTitle | undefined, available: number, minSize: number, step: number): TitleLayout {
  if (!title || (!title.text && !title.subtitle)) return NO_TITLE;
  const floor = Math.min(minSize, title.size);
  let size = title.size;
  while (widthOf(linesAt(title, size)) > available + 1e-9 && size - step >= floor - 1e-9) size -= step;
  const lines = linesAt(title, size);
  const width = widthOf(lines);
  const info: string[] = [];
  const warnings: string[] = [];
  if (size < title.size) info.push(`Title font reduced from ${formatNumber(title.size)} to ${formatNumber(size)} pt to fit the page width.`);
  if (width > available + 1e-9) {
    warnings.push(
      `Title is ${mm1(width)} mm wide at ${formatNumber(size)} pt but the page has ${mm1(available)} mm between the margins; shorten the title or subtitle.`,
    );
  }
  return { height: bottomOf(lines) + TITLE_GAP, width, size, lines, info, warnings };
}

/**
 * Draws the band with its top at y = `top` (page mm). "left": aligned with the plot's left edge;
 * "centre": centred over the panels. Kept between the page margins where it fits.
 */
export function renderTitle(
  g: SvgGroup,
  layout: TitleLayout,
  align: ResolvedTitle["align"],
  top: number,
  plot: { x: number; width: number },
  page: { width: number },
  theme: Theme,
): void {
  if (layout.lines.length === 0) return;
  const lo = theme.margin.left;
  const hi = page.width - theme.margin.right;
  const left = Math.max(lo, Math.min(align === "centre" ? plot.x + plot.width / 2 - layout.width / 2 : plot.x, hi - layout.width));
  const x = align === "centre" ? left + layout.width / 2 : left;
  const tg = g.group({ id: "title", "font-family": familyAttr(theme.titleFontFamily, theme.fontFamily) });
  for (const l of layout.lines) {
    tg.text(x, top + l.baseline, l.text, { class: l.class, "font-size": l.size, "text-anchor": align === "centre" ? "middle" : undefined });
  }
}
