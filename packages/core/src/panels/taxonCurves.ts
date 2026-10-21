// taxonCurves panel — SPEC.md §7.1. One column per selected variable.
// Common scale: column width = max(minWidth, max value × scale); the curve always uses that scale,
// so minWidth widens the column but never distorts it. The scale is shared only within a scale
// family (kind|unit, see scaleKey): percentages and counts never share one.
// Kind "presence" has no scale: a fixed-width column with a dot or bar where the value is > 0.
// x-axis titles sit under the tick labels: once per run of one scale family, or under every column.

import { clean, formatNumber, scaleKey, ticksAt } from "../layout/scales.js";
import { estimateTextWidth, familyAttr, footerHeight, footerHeightWithTitle } from "../layout/theme.js";
import type { ResolvedTaxonCurvesStyle } from "../model/defaults.js";
import { resolveVariableStyle, type ResolvedTaxonCurvesPanel } from "../model/resolve.js";
import type { MeasurementKind, Variable } from "../model/types.js";
import { columnMax } from "../layout/select.js";
import { PathBuilder, rotate, translate, type SvgGroup } from "../render/svg.js";
import { LABEL_OFFSET, TEXT_ASCENT, type HeaderColumn } from "../layout/header.js";
import { compactLength, GAP_FLOOR, MIN_WIDTH_FLOOR } from "../layout/layout.js";
import type { ColumnLayout, Panel, PanelContext, PanelMeasure } from "./types.js";

export interface TaxonColumn {
  index: number;
  variable: Variable;
  style: ResolvedTaxonCurvesStyle;
  max: number;
  /** Left edge relative to the panel. */
  x: number;
  width: number;
  /** mm per data unit for this column; 0 = no scale (presence, unmapped codes). */
  scale: number;
  /** Scale family (kind|unit). */
  key: string;
  /** Tick step the geometry was rounded to (independent scales). */
  step?: number;
}

/**
 * Width and scale of one column. Independent scales span 0 to `max` rounded up to a whole tick step
 * (so the axis ends on a labelled tick), unless `exact` (e.g. a class scale's top class). Exported for tests.
 */
export function columnGeometry(
  max: number,
  style: ResolvedTaxonCurvesStyle,
  xScale: number,
  independentWidth: number,
  exact = false,
  integer = false,
): { width: number; scale: number; step?: number } {
  if (style.commonScale) return { width: Math.max(style.minWidth, max * xScale), scale: xScale };
  const width = Math.max(style.minWidth, independentWidth);
  if (!(max > 0)) return { width, scale: 0 };
  if (exact) return { width, scale: width / max };
  const step = style.xTicks.step ?? autoTickStep(width / max, style.xTicks.minSpacing, integer);
  return { width, scale: width / (Math.ceil(max / step - 1e-9) * step), step };
}

function panelSpec(ctx: PanelContext): ResolvedTaxonCurvesPanel | undefined {
  return ctx.spec.type === "taxonCurves" ? ctx.spec : undefined;
}

/** Column gap after fitting (SPEC §6 step b). */
function columnGap(ctx: PanelContext): number {
  return compactLength(ctx.theme.columnGap, GAP_FLOOR, ctx.fit.compact);
}

export function taxonColumns(ctx: PanelContext): TaxonColumn[] {
  const spec = panelSpec(ctx);
  const data = ctx.data;
  if (!spec || !data) return [];
  const cols: TaxonColumn[] = [];
  let x = 0;
  for (const j of data.variables) {
    const variable = data.dataset.variables[j]!;
    const prev = cols[cols.length - 1];
    if (prev && prev.variable.group !== variable.group) x += compactLength(spec.style.groupGap, GAP_FLOOR, ctx.fit.compact);
    // Fitting may compact minWidth (step b); the curve scale itself is never distorted.
    const resolved = resolveVariableStyle(spec, variable.id);
    const style = { ...resolved, minWidth: compactLength(resolved.minWidth, MIN_WIDTH_FLOOR, ctx.fit.compact) };
    const key = scaleKey(variable);
    if (variable.kind === "presence" || variable.codes) {
      // No scale: presence marks, or text codes no scaleMap has mapped (drawn empty, see measure).
      const width = compactLength(Math.max(resolved.minWidth, ctx.theme.presenceWidth), MIN_WIDTH_FLOOR, ctx.fit.compact);
      cols.push({ index: j, variable, style, max: 0, x, width, scale: 0, key });
    } else {
      // Class scales span the whole scale (top class), so all class columns read alike.
      const top = variable.scaleLabels?.reduce((m, l) => Math.max(m, l.value), 0);
      const max = Math.max(columnMax(data.dataset, j), top ?? 0);
      const common = ctx.xScale * (ctx.scaleRatios.get(key) ?? 1);
      // Independent columns shrink with the global x factor like everything else.
      const independent = resolved.columnWidth * (ctx.xScale / ctx.theme.naturalXScale);
      const { width, scale, step } = columnGeometry(max, style, common, independent, top !== undefined, integerKind(variable.kind));
      const col: TaxonColumn = { index: j, variable, style, max, x, width, scale, key };
      if (step !== undefined) col.step = step;
      cols.push(col);
    }
    x += cols[cols.length - 1]!.width + columnGap(ctx);
  }
  return cols;
}

/**
 * Smallest 1, 2 or 5 × 10^k step (data units) that is at least `minSpacing` mm long at `scale` mm
 * per unit; at least 1 if `integer` (whole-number data such as counts).
 */
export function autoTickStep(scale: number, minSpacing: number, integer = false): number {
  const raw = minSpacing / scale;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const f = [1, 2, 5].find((m) => m * mag >= raw * (1 - 1e-9)) ?? 10;
  return integer ? Math.max(1, clean(f * mag)) : clean(f * mag);
}

/** Kinds whose values are whole numbers, so ticks never fall between them. */
function integerKind(kind: MeasurementKind): boolean {
  return kind === "count" || kind === "abundanceClass";
}

/** x-axis title for a variable's kind and unit, e.g. "%", "Counts (n/20 cm³)", "Abundance class"; "" = none. */
export function defaultXTitle(v: { kind: MeasurementKind; unit?: string }): string {
  const unit = v.unit ? ` (${v.unit})` : "";
  switch (v.kind) {
    case "percent":
      return v.unit ?? "%";
    case "volumePercent":
      return `Volume (${v.unit ?? "%"})`;
    case "count":
      return `Counts${unit}`;
    case "concentration":
      return `Concentration${unit}`;
    case "influx":
      return `Influx${unit}`;
    case "abundanceClass":
      return "Abundance class";
    case "presence":
      return "Presence";
    case "continuous":
      return v.unit ?? "";
  }
}

/** Suffix for the last tick label ("%" without a space, other units with one); none for class scales. */
function unitSuffix(v: Variable): string | undefined {
  if (v.scaleLabels) return undefined;
  const unit = v.unit ?? (v.kind === "percent" || v.kind === "volumePercent" ? "%" : undefined);
  if (!unit) return undefined;
  return unit === "%" || unit === "‰" ? unit : ` ${unit}`;
}

/**
 * Tick positions (data units) and which of them get a label. Labels are placed left to right and
 * skipped when they would touch the previous label or reach the next column's "0", so narrow
 * columns keep only one. `room` = free space right of the column. `after` = right end of the
 * previous column's last label (column-relative), so even a "0" is skipped where columns are too
 * narrow for it. Variables with `scaleLabels` (e.g. class codes from a scaleMap) get ticks at those
 * values with those labels.
 */
export function columnTicks(
  col: TaxonColumn,
  room: number,
  tickFontSize: number,
  pad: number,
  after = Number.NEGATIVE_INFINITY,
): Tick[] {
  if (!(col.scale > 0)) return [];
  const extent = col.width / col.scale;
  let ticks: { value: number; text: string }[];
  if (col.variable.scaleLabels) {
    ticks = col.variable.scaleLabels.filter((l) => l.value >= 0 && l.value <= extent + 1e-9).map((l) => ({ value: l.value, text: l.label }));
  } else {
    const step = col.step ?? col.style.xTicks.step ?? autoTickStep(col.scale, col.style.xTicks.minSpacing, integerKind(col.variable.kind));
    const values = extent / step <= 100 ? ticksAt(0, extent, step) : [0];
    ticks = values.map((value) => ({ value, text: formatNumber(value) }));
  }
  const w = (t: string) => estimateTextWidth(t, tickFontSize);
  // Common scale: labels centred, kept clear of the next column's "0". Independent scales: labels
  // stay inside the column — the first starts at 0, one at the column end ends there.
  const inside = !col.style.commonScale;
  const rightLimit = inside ? col.width : col.width + room - w("0") / 2 - pad;
  // The end label first, so it wins over a crowded neighbour.
  const endAt = inside ? ticks.findIndex((t) => Math.abs(t.value * col.scale - col.width) < 1e-6) : -1;
  const extentOf = (i: number): [number, number, "start" | "middle" | "end"] => {
    const x = ticks[i]!.value * col.scale;
    const tw = w(ticks[i]!.text);
    if (inside && i === 0) return [x, x + tw, "start"];
    if (i === endAt) return [x - tw, x, "end"];
    return [x - tw / 2, x + tw / 2, "middle"];
  };
  const endLeft = endAt > 0 ? extentOf(endAt)[0] : Number.POSITIVE_INFINITY;
  let lastRight = after;
  let prevRight = after;
  const out: Tick[] = ticks.map(({ value, text }, i) => {
    const [l, r, anchor] = extentOf(i);
    const clear = l >= lastRight + pad - 1e-9;
    const label = (i === 0 && clear) || i === endAt || (clear && r <= Math.min(rightLimit, endLeft - pad));
    if (label) [prevRight, lastRight] = [lastRight, r];
    return { value, label, text, anchor };
  });
  // Unit suffix on the last label, only where it still fits ("40%": the number stays on its tick).
  const suffix = col.style.xTicks.unitSuffix ? unitSuffix(col.variable) : undefined;
  const last = out.map((t) => t.label).lastIndexOf(true);
  if (suffix && last >= 0) {
    const t = out[last]!;
    const x = t.value * col.scale;
    const text = t.text + suffix;
    const shift = t.anchor === "middle" ? -w(t.text) / 2 : 0;
    const l = t.anchor === "end" ? x - w(text) : x + shift;
    if (l >= prevRight + pad - 1e-9 && l + w(text) <= rightLimit + 1e-9) {
      out[last] = t.anchor === "middle" ? { ...t, text, anchor: "start", shift } : { ...t, text };
    }
  }
  return out;
}

export interface Tick {
  value: number;
  label: boolean;
  text: string;
  anchor: "start" | "middle" | "end";
  /** Label offset from the tick, mm (a suffixed label starts where the bare number would). */
  shift?: number;
}

/** Horizontal extent of a tick label, column-relative. */
function tickExtent(t: Tick, col: TaxonColumn, tickFontSize: number): [number, number] {
  const x = t.value * col.scale + (t.shift ?? 0);
  const tw = estimateTextWidth(t.text, tickFontSize);
  return t.anchor === "start" ? [x, x + tw] : t.anchor === "end" ? [x - tw, x] : [x - tw / 2, x + tw / 2];
}

/** Ticks of every column, labels placed left to right across the whole panel (never overlapping). */
function panelTicks(ctx: PanelContext, cols: readonly TaxonColumn[]): Tick[][] {
  const { theme } = ctx;
  let lastRight = Number.NEGATIVE_INFINITY;
  return cols.map((col, i) => {
    const next = cols[i + 1];
    const room = next ? next.x - col.x - col.width : columnGap(ctx);
    const ticks = columnTicks(col, room, theme.tickFontSize, theme.tickLabelPad, lastRight - col.x);
    for (const t of ticks) if (t.label) lastRight = Math.max(lastRight, col.x + tickExtent(t, col, theme.tickFontSize)[1]);
    return ticks;
  });
}

export interface XAxisTitle {
  text: string;
  /** Centre, panel-relative. */
  x: number;
  width: number;
}

/**
 * x-axis titles (style.xTitle): "panel" = one per run of adjacent columns of one scale family,
 * centred under the run; "column" = one per column. Text = xTitle.text, else from the kind and unit.
 * Placed left to right; a title that would touch the previous one is skipped (counted in `skipped`).
 */
export function xAxisTitles(ctx: PanelContext, cols: readonly TaxonColumn[]): { titles: XAxisTitle[]; skipped: number } {
  const { xTitle } = panelSpec(ctx)?.style ?? { xTitle: { show: "none" } };
  if (xTitle.show === "none") return { titles: [], skipped: 0 };
  const spans: { text: string; x0: number; x1: number; key: string }[] = [];
  cols.forEach((c, i) => {
    if (c.variable.codes) return; // unmapped codes: nothing plotted
    const prev = spans[spans.length - 1];
    if (xTitle.show === "panel" && prev && prev.key === c.key && !cols[i - 1]!.variable.codes) prev.x1 = c.x + c.width;
    else spans.push({ text: xTitle.text ?? defaultXTitle(c.variable), x0: c.x, x1: c.x + c.width, key: c.key });
  });
  const titles: XAxisTitle[] = [];
  let skipped = 0;
  let lastRight = Number.NEGATIVE_INFINITY;
  for (const s of spans) {
    if (!s.text) continue;
    const width = estimateTextWidth(s.text, ctx.theme.fontSize);
    const x = (s.x0 + s.x1) / 2;
    if (x - width / 2 < lastRight + ctx.theme.tickLabelPad - 1e-9) {
      skipped++;
      continue;
    }
    titles.push({ text: s.text, x, width });
    lastRight = x + width / 2;
  }
  return { titles, skipped };
}

function fillColour(ctx: PanelContext, col: TaxonColumn): string {
  if (col.style.fill !== "group") return col.style.fill;
  const g = col.variable.group;
  if (g === undefined) return ctx.theme.defaultFill;
  return ctx.data?.dataset.groups.find((x) => x.id === g)?.colour ?? ctx.theme.defaultFill;
}

interface Point {
  y: number;
  v: number;
}

/** Runs of consecutive non-null values in depth order; null breaks a run (gap). */
function runs(ctx: PanelContext, j: number): Point[][] {
  const ds = ctx.data!.dataset;
  const order = ds.samples.map((s, i) => ({ d: s.depth, i })).sort((a, b) => a.d - b.d || a.i - b.i);
  const out: Point[][] = [];
  let cur: Point[] = [];
  for (const { d, i } of order) {
    const v = ds.values[i]![j];
    if (v === null || v === undefined) {
      if (cur.length) out.push(cur);
      cur = [];
    } else cur.push({ y: ctx.y.toMm(d), v });
  }
  if (cur.length) out.push(cur);
  return out;
}

/** Silhouette or bars for one run; `factor` = exaggeration (1 for the main curve). x is capped at the column width. */
function drawShape(
  g: SvgGroup,
  ctx: PanelContext,
  col: TaxonColumn,
  run: Point[],
  factor: number,
  attrs: Record<string, string | number>,
): void {
  const t = ctx.theme.barThickness;
  const xOf = (v: number) => Math.min(v * factor * col.scale, col.width);
  if (col.style.mode === "bars" || run.length === 1) {
    for (const p of run) {
      if (p.v > 0) g.rect(0, p.y - t / 2, xOf(p.v), t, attrs);
    }
    return;
  }
  const d = new PathBuilder().moveTo(0, run[0]!.y);
  for (const p of run) d.lineTo(xOf(p.v), p.y);
  d.lineTo(0, run[run.length - 1]!.y).close();
  g.path(d, attrs);
}

/** Presence: a dot at the column centre, or a full-width bar, where the value is > 0. */
function renderPresence(ctx: PanelContext, g: SvgGroup, col: TaxonColumn, fill: string): void {
  const { theme } = ctx;
  const mg = g.group({ class: "presence" });
  for (const run of runs(ctx, col.index)) {
    for (const p of run) {
      if (!(p.v > 0)) continue;
      if (col.style.presence === "bar") mg.rect(0, p.y - theme.barThickness / 2, col.width, theme.barThickness, { fill });
      else mg.circle(col.width / 2, p.y, theme.presenceDotRadius, { fill, stroke: theme.stroke, "stroke-width": theme.curveLineWidth });
    }
  }
}

function renderColumn(ctx: PanelContext, g: SvgGroup, col: TaxonColumn, ticks: readonly Tick[]): void {
  const { theme, y } = ctx;
  const h = y.height;
  const fill = fillColour(ctx, col);
  const line = { stroke: theme.axisColour, "stroke-width": theme.lineWidth };
  if (col.variable.kind === "presence" && !col.variable.codes) {
    renderPresence(ctx, g, col, fill);
    g.group({ class: "x-axis" }).line(0, h, col.width, h, line);
    renderLabel(ctx, g, col);
    return;
  }
  if (col.variable.codes) {
    g.group({ class: "x-axis" }).line(0, h, col.width, h, line);
    renderLabel(ctx, g, col);
    return;
  }
  const rs = runs(ctx, col.index);

  if (col.style.mode !== "silhouette" && col.style.mode !== "bars") {
    ctx.warn(`taxonCurves mode "${col.style.mode}" is not supported yet; using silhouette.`);
  }

  // Exaggeration behind the main curve, lighter fill.
  const exag = col.style.exaggeration;
  if (exag > 1) {
    const eg = g.group({ class: "exaggeration" });
    for (const run of rs) drawShape(eg, ctx, col, run, exag, { fill, "fill-opacity": theme.exaggerationOpacity });
  }

  const mg = g.group({ class: "curve" });
  for (const run of rs) {
    drawShape(mg, ctx, col, run, 1, { fill, stroke: theme.stroke, "stroke-width": theme.curveLineWidth });
  }

  // Zero baseline over each run; nulls leave a gap.
  for (const run of rs) {
    if (run.length > 1) g.line(0, run[0]!.y, 0, run[run.length - 1]!.y, line);
  }

  // "+" for small non-zero values.
  if (col.style.plusBelow > 0) {
    const s = theme.plusSize;
    const d = new PathBuilder();
    for (const run of rs) {
      for (const p of run) {
        if (p.v > 0 && p.v < col.style.plusBelow) {
          const x = theme.plusOffset + p.v * col.scale;
          d.moveTo(x - s, p.y).lineTo(x + s, p.y).moveTo(x, p.y - s).lineTo(x, p.y + s);
        }
      }
    }
    if (!d.isEmpty()) g.path(d, { class: "plus", fill: "none", ...line });
  }

  // x axis in the footer band.
  const xg = g.group({ class: "x-axis" });
  xg.line(0, h, col.width, h, line);
  const tickY = h + theme.tickLength + 0.5 + theme.tickFontSize * 0.8;
  const family = familyAttr(theme.tickFontFamily, theme.fontFamily);
  for (const t of ticks) {
    const x = t.value * col.scale;
    xg.line(x, h, x, h + theme.tickLength, line);
    if (t.label) xg.text(x + (t.shift ?? 0), tickY, t.text, { "font-family": family, "font-size": theme.tickFontSize, "text-anchor": t.anchor });
  }
  renderLabel(ctx, g, col);
}

/** Horizontal extent (relative to the column) of everything renderColumn draws below the header band. */
function columnInk(ctx: PanelContext, col: TaxonColumn, ticks: readonly Tick[]): [number, number] {
  const { theme } = ctx;
  let left = 0;
  let right = col.width;
  if (col.variable.kind === "presence" && col.style.presence === "dot") {
    left = Math.min(left, col.width / 2 - theme.presenceDotRadius);
    right = Math.max(right, col.width / 2 + theme.presenceDotRadius);
  }
  for (const t of ticks) {
    if (!t.label) continue;
    const [l, r] = tickExtent(t, col, theme.tickFontSize);
    left = Math.min(left, l);
    right = Math.max(right, r);
  }
  if (col.style.plusBelow > 0 && col.scale > 0) {
    right = Math.max(right, theme.plusOffset + col.style.plusBelow * col.scale + theme.plusSize);
  }
  return [left, right];
}

function renderLabel(ctx: PanelContext, g: SvgGroup, col: TaxonColumn): void {
  const { theme } = ctx;
  // Name in the header band, rotated, anchored at the column centre; size and angle are shared by all panels.
  const { fontSize, angle } = ctx.header;
  const a = (angle * Math.PI) / 180;
  const off = LABEL_OFFSET * fontSize;
  const lx = col.width / 2 + off * Math.sin(a);
  const ly = -theme.headerGap + off * Math.cos(a);
  g.text(lx, ly, col.variable.name, {
    class: "label",
    transform: rotate(-angle, lx, ly),
    "font-size": fontSize === theme.fontSize ? undefined : fontSize,
  });
}

function slug(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, "_");
}

export const taxonCurvesPanel: Panel = {
  type: "taxonCurves",

  measure(ctx) {
    const spec = panelSpec(ctx);
    if (spec?.width !== undefined) ctx.warn("taxonCurves: \"width\" is ignored; widths follow the common x-scale.");
    const ds = ctx.data?.dataset;
    for (const id of Object.keys(spec?.overrides ?? {})) {
      if (ds && !ds.variables.some((v) => v.id === id)) ctx.warn(`taxonCurves: override for "${id}", which is not in dataset "${ds.id}".`);
    }
    const cols = taxonColumns(ctx);
    if (ds && cols.length === 0) ctx.warn(`taxonCurves: no variables selected from dataset "${ds.id}".`);
    const kinds = [...new Set(cols.map((c) => c.variable.kind))];
    if (kinds.length > 1) {
      ctx.warn(`taxonCurves (${ctx.id}): mixes kinds (${kinds.join(", ")}); each kind gets its own x-scale. Use one panel per kind (selection "kinds").`);
    }
    for (const c of cols) {
      if (c.variable.codes) {
        ctx.warn(`"${c.variable.id}" has text codes (${c.variable.codes.join(", ")}) but no scaleMap transform maps them; column left empty.`);
      }
    }
    const last = cols[cols.length - 1];
    const { titles, skipped } = xAxisTitles(ctx, cols);
    if (skipped > 0) {
      ctx.warn(`taxonCurves (${ctx.id}): ${skipped} x-axis title(s) omitted where the columns are too narrow; use xTitle.show "panel" or a shorter xTitle.text.`);
    }
    // Labels live in the shared header band (layout/header.ts), not in this panel's header height.
    const width = last ? last.x + last.width : 0;
    const m: PanelMeasure = { width, headerHeight: 0 };
    if (titles.length > 0) m.footerHeight = footerHeightWithTitle(ctx.theme);
    // What the columns draw beyond the panel's [0, width]: reserved by the layout.
    let left = 0;
    let right = width;
    const ticks = panelTicks(ctx, cols);
    cols.forEach((col, i) => {
      const [l, r] = columnInk(ctx, col, ticks[i]!);
      left = Math.min(left, col.x + l);
      right = Math.max(right, col.x + r);
    });
    for (const t of titles) {
      left = Math.min(left, t.x - t.width / 2);
      right = Math.max(right, t.x + t.width / 2);
    }
    if (left < 0 || right > width) m.overhang = { left: -left, right: right - width };
    return m;
  },

  columns(ctx) {
    return taxonColumns(ctx).map((c) => {
      const col: HeaderColumn = { id: c.variable.id, label: c.variable.name, x: c.x, width: c.width };
      if (c.variable.group !== undefined) col.group = c.variable.group;
      return col;
    });
  },

  columnLayout(ctx) {
    return taxonColumns(ctx).map((c): ColumnLayout => {
      const sizing = c.variable.kind === "presence" || c.variable.codes ? "fixed" : c.style.commonScale ? "scale" : "column";
      const extent = sizing === "scale" && ctx.xScale > 0 ? (c.max * c.scale) / ctx.xScale : 0;
      return { id: c.variable.id, x: c.x, width: c.width, sizing, extent, minWidth: c.style.minWidth };
    });
  },

  render(ctx, g) {
    const cols = taxonColumns(ctx);
    const ticks = panelTicks(ctx, cols);
    cols.forEach((col, i) => {
      const cg = g.group({ id: `${ctx.id}-${slug(col.variable.id)}`, class: "column", transform: translate(col.x, 0) });
      renderColumn(ctx, cg, col, ticks[i]!);
    });
    const { titles } = xAxisTitles(ctx, cols);
    if (titles.length > 0) {
      const tg = g.group({ class: "x-title" });
      const ty = ctx.y.height + footerHeight(ctx.theme) + TEXT_ASCENT * ctx.theme.fontSize;
      for (const t of titles) tg.text(t.x, ty, t.text, { "text-anchor": "middle" });
    }
  },
};
