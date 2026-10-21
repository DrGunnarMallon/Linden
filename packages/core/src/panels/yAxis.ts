// yAxis panel — SPEC.md §7.1. Depth axis with major/minor ticks and title; optional secondary
// age axis whose ticks are placed by interpolating sample depth–age pairs (never by re-scaling).

import { interpolate, formatNumber, niceStep, ticksAt } from "../layout/scales.js";
import { estimateTextWidth } from "../layout/theme.js";
import type { SvgGroup } from "../render/svg.js";
import { rotate, translate } from "../render/svg.js";
import type { Panel, PanelContext } from "./types.js";

interface Tick {
  /** Position in depth units. */
  depth: number;
  label?: string;
}

interface Axis {
  title: string;
  major: Tick[];
  minor: Tick[];
  /** Depth range covered by the axis line. */
  from: number;
  to: number;
}

function depthAxis(ctx: PanelContext): Axis {
  const [d0, d1] = ctx.y.domain;
  const major = ctx.yAxis.ticks?.major ?? niceStep(d1 - d0, 6);
  const minor = ctx.yAxis.ticks?.minor;
  const majors = ticksAt(d0, d1, major);
  const unit = ctx.data?.dataset.depthUnit ?? "cm";
  return {
    title: `Depth (${unit})`,
    major: majors.map((d) => ({ depth: d, label: formatNumber(d) })),
    minor: minor ? ticksAt(d0, d1, minor).filter((d) => !majors.includes(d)).map((d) => ({ depth: d })) : [],
    from: d0,
    to: d1,
  };
}

function ageAxis(ctx: PanelContext): Axis | undefined {
  const ds = ctx.data?.dataset;
  const pairs = (ds?.samples ?? [])
    .filter((s) => s.age !== undefined)
    .map((s) => ({ depth: s.depth, age: s.age! }))
    .sort((a, b) => a.depth - b.depth);
  if (pairs.length < 2) {
    ctx.warn("Secondary age axis requested but fewer than two samples have ages; age axis omitted.");
    return undefined;
  }
  const depths = pairs.map((p) => p.depth);
  const ages = pairs.map((p) => p.age);
  if (ages.some((a, i) => i > 0 && a < ages[i - 1]!)) {
    ctx.warn("Ages do not increase with depth; age axis omitted.");
    return undefined;
  }

  const [d0, d1] = ctx.y.domain;
  const from = Math.max(d0, depths[0]!);
  const to = Math.min(d1, depths[depths.length - 1]!);
  if (from >= to) return undefined;
  const a0 = interpolate(depths, ages, from)!;
  const a1 = interpolate(depths, ages, to)!;
  const major: Tick[] = [];
  for (const age of ticksAt(a0, a1, niceStep(a1 - a0, 6))) {
    const depth = interpolate(ages, depths, age);
    if (depth !== undefined) major.push({ depth, label: formatNumber(age) });
  }
  const unit = ds?.ageUnit;
  return { title: unit ? `Age (${unit})` : "Age", major, minor: [], from, to };
}

function axes(ctx: PanelContext): Axis[] {
  if (ctx.yAxis.primary !== "depth") ctx.warn(`Primary y-axis "${ctx.yAxis.primary}" is not supported yet; using depth.`);
  const out = [depthAxis(ctx)];
  if (ctx.yAxis.secondary === "age") {
    const age = ageAxis(ctx);
    if (age) out.push(age);
  } else if (ctx.yAxis.secondary !== undefined) {
    ctx.warn(`Secondary y-axis "${ctx.yAxis.secondary}" is not supported yet; omitted.`);
  }
  return out;
}

function axisWidth(ctx: PanelContext, axis: Axis): number {
  const { theme } = ctx;
  const labelWidth = axis.major.reduce((w, t) => Math.max(w, estimateTextWidth(t.label ?? "", theme.tickFontSize)), 0);
  return theme.fontSize + 1 + labelWidth + 0.6 + theme.tickLength;
}

export const yAxisPanel: Panel = {
  type: "yAxis",

  measure(ctx) {
    const natural = axes(ctx).reduce((w, a, i) => w + axisWidth(ctx, a) + (i > 0 ? ctx.theme.panelGap : 0), 0);
    const width = ctx.spec.type === "yAxis" && ctx.spec.width !== undefined ? ctx.spec.width : natural;
    return { width, headerHeight: 0 };
  },

  render(ctx, g: SvgGroup) {
    const { theme, y } = ctx;
    const stroke = { stroke: theme.stroke, "stroke-width": theme.lineWidth };
    let x = 0;
    axes(ctx).forEach((axis, i) => {
      const w = axisWidth(ctx, axis);
      const ag = g.group({ class: i === 0 ? "axis-primary" : "axis-secondary", transform: translate(x, 0) });
      const tx = theme.fontSize * 0.8;
      const ty = (y.toMm(axis.from) + y.toMm(axis.to)) / 2;
      ag.text(tx, ty, axis.title, { transform: rotate(-90, tx, ty), "text-anchor": "middle" });
      ag.line(w, y.toMm(axis.from), w, y.toMm(axis.to), stroke);
      for (const t of axis.minor) {
        ag.line(w - theme.minorTickLength, y.toMm(t.depth), w, y.toMm(t.depth), stroke);
      }
      for (const t of axis.major) {
        const ty2 = y.toMm(t.depth);
        ag.line(w - theme.tickLength, ty2, w, ty2, stroke);
        ag.text(w - theme.tickLength - 0.6, ty2 + 0.35 * theme.tickFontSize, t.label ?? "", {
          "font-size": theme.tickFontSize,
          "text-anchor": "end",
        });
      }
      x += w + theme.panelGap;
    });
  },
};
