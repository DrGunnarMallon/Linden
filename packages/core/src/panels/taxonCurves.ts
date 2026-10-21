// taxonCurves panel — SPEC.md §7.1. One column per selected variable.
// Common scale: column width = max(minWidth, max value × xScale); the curve always uses xScale,
// so minWidth widens the column but never distorts the scale.

import { clean, formatNumber, ticksAt } from "../layout/scales.js";
import { estimateTextWidth } from "../layout/theme.js";
import type { ResolvedTaxonCurvesStyle } from "../model/defaults.js";
import { resolveVariableStyle, type ResolvedTaxonCurvesPanel } from "../model/resolve.js";
import type { Variable } from "../model/types.js";
import { columnMax } from "../layout/select.js";
import { PathBuilder, rotate, translate, type SvgGroup } from "../render/svg.js";
import type { HeaderColumn } from "../layout/header.js";
import type { Panel, PanelContext } from "./types.js";

export interface TaxonColumn {
  index: number;
  variable: Variable;
  style: ResolvedTaxonCurvesStyle;
  max: number;
  /** Left edge relative to the panel. */
  x: number;
  width: number;
  /** mm per data unit for this column. */
  scale: number;
}

/** Width and scale of one column. Exported for tests. */
export function columnGeometry(
  max: number,
  style: ResolvedTaxonCurvesStyle,
  xScale: number,
  independentWidth: number,
): { width: number; scale: number } {
  if (style.commonScale) return { width: Math.max(style.minWidth, max * xScale), scale: xScale };
  const width = Math.max(style.minWidth, independentWidth);
  return { width, scale: max > 0 ? width / max : 0 };
}

function panelSpec(ctx: PanelContext): ResolvedTaxonCurvesPanel | undefined {
  return ctx.spec.type === "taxonCurves" ? ctx.spec : undefined;
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
    if (prev && prev.variable.group !== variable.group) x += spec.style.groupGap;
    const style = resolveVariableStyle(spec, variable.id);
    const max = columnMax(data.dataset, j);
    const { width, scale } = columnGeometry(max, style, ctx.xScale, ctx.theme.independentColumnWidth);
    cols.push({ index: j, variable, style, max, x, width, scale });
    x += width + ctx.theme.columnGap;
  }
  return cols;
}

/** Smallest 1, 2 or 5 × 10^k step (data units) that is at least `minSpacing` mm long at `scale` mm per unit. */
export function autoTickStep(scale: number, minSpacing: number): number {
  const raw = minSpacing / scale;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const f = [1, 2, 5].find((m) => m * mag >= raw * (1 - 1e-9)) ?? 10;
  return clean(f * mag);
}

/**
 * Tick positions (data units) and which of them get a label. Labels are placed left to right and
 * skipped when they would touch the previous label or reach the next column's "0", so narrow
 * columns keep only one. `room` = free space right of the column.
 */
export function columnTicks(col: TaxonColumn, room: number, tickFontSize: number, pad: number): { value: number; label: boolean }[] {
  if (!(col.scale > 0)) return [];
  const extent = col.width / col.scale;
  const step = col.style.xTicks.step ?? autoTickStep(col.scale, col.style.xTicks.minSpacing);
  const values = extent / step <= 100 ? ticksAt(0, extent, step) : [0];
  const half = (v: number) => estimateTextWidth(formatNumber(v), tickFontSize) / 2;
  const rightLimit = col.width + room - half(0) - pad;
  let lastRight = Number.NEGATIVE_INFINITY;
  return values.map((value, i) => {
    const x = value * col.scale;
    const label = i === 0 || (x - half(value) >= lastRight + pad && x + half(value) <= rightLimit);
    if (label) lastRight = x + half(value);
    return { value, label };
  });
}

function fillColour(ctx: PanelContext, col: TaxonColumn): string {
  if (col.style.fill !== "group") return col.style.fill;
  const g = col.variable.group;
  if (g === undefined) return ctx.theme.defaultFill;
  return (
    ctx.groups.find((x) => x.id === g)?.colour ??
    ctx.data?.dataset.groups.find((x) => x.id === g)?.colour ??
    ctx.theme.defaultFill
  );
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

function renderColumn(ctx: PanelContext, g: SvgGroup, col: TaxonColumn, room: number): void {
  const { theme, y } = ctx;
  const h = y.height;
  const fill = fillColour(ctx, col);
  const line = { stroke: theme.stroke, "stroke-width": theme.lineWidth };
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
  for (const t of columnTicks(col, room, theme.tickFontSize, theme.tickLabelPad)) {
    const x = t.value * col.scale;
    xg.line(x, h, x, h + theme.tickLength, line);
    if (t.label) {
      xg.text(x, h + theme.tickLength + 0.5 + theme.tickFontSize * 0.8, formatNumber(t.value), {
        "font-size": theme.tickFontSize,
        "text-anchor": "middle",
      });
    }
  }

  // Name in the header band, rotated, anchored at the column centre; size and angle are shared by all panels.
  const { fontSize, angle } = ctx.header;
  const a = (angle * Math.PI) / 180;
  const off = 0.35 * fontSize;
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
    const last = cols[cols.length - 1];
    // Labels live in the shared header band (layout/header.ts), not in this panel's header height.
    return { width: last ? last.x + last.width : 0, headerHeight: 0 };
  },

  columns(ctx) {
    return taxonColumns(ctx).map((c) => {
      const col: HeaderColumn = { id: c.variable.id, label: c.variable.name, x: c.x, width: c.width };
      if (c.variable.group !== undefined) col.group = c.variable.group;
      return col;
    });
  },

  render(ctx, g) {
    const cols = taxonColumns(ctx);
    cols.forEach((col, i) => {
      const next = cols[i + 1];
      const room = next ? next.x - col.x - col.width : ctx.theme.columnGap;
      const cg = g.group({ id: `${ctx.id}-${slug(col.variable.id)}`, class: "column", transform: translate(col.x, 0) });
      renderColumn(ctx, cg, col, room);
    });
  },
};
