// yAxis panel — SPEC.md §7.1. The primary axis (depth, or age: samples placed by their age) with
// major/minor ticks and title; an optional secondary axis (age, or depth) whose ticks are placed by
// interpolating the samples' depth–age pairs (never by re-scaling, never extrapolated).
// Titles (yAxis.titles, default from the dataset units) are rotated 90°, left of the tick labels.

import { ageDepthPairs, ageInversionAt, type AxisKind } from "../layout/ageDepth.js";
import { interpolate, formatNumber, niceStep, ticksAt } from "../layout/scales.js";
import { estimateTextWidth, familyAttr } from "../layout/theme.js";
import type { SvgGroup } from "../render/svg.js";
import { rotate, translate } from "../render/svg.js";
import type { Panel, PanelContext } from "./types.js";

interface Tick {
  /** Position in primary-axis units. */
  pos: number;
  label?: string;
}

interface Axis {
  title: string;
  major: Tick[];
  minor: Tick[];
  /** Range covered by the axis line, in primary-axis units. */
  from: number;
  to: number;
}

/** Axis title: yAxis.titles, else from the dataset's units ("Depth (cm)", "Age (cal BP)", "Age"). */
function titleOf(ctx: PanelContext, kind: AxisKind): string {
  const ds = ctx.data?.dataset;
  if (kind === "depth") return ctx.yAxis.titles.depth ?? `Depth (${ds?.depthUnit ?? "cm"})`;
  return ctx.yAxis.titles.age ?? (ds?.ageUnit ? `Age (${ds.ageUnit})` : "Age");
}

function primaryAxis(ctx: PanelContext): Axis {
  const [d0, d1] = ctx.y.domain;
  const major = ctx.yAxis.ticks?.major ?? niceStep(d1 - d0, 6);
  const minor = ctx.yAxis.ticks?.minor;
  const majors = ticksAt(d0, d1, major);
  return {
    title: titleOf(ctx, ctx.yAxis.primary),
    major: majors.map((d) => ({ pos: d, label: formatNumber(d) })),
    minor: minor ? ticksAt(d0, d1, minor).filter((d) => !majors.includes(d)).map((d) => ({ pos: d })) : [],
    from: d0,
    to: d1,
  };
}

/** The other axis (age on a depth axis, depth on an age axis), interpolated between depth–age pairs. */
function secondaryAxis(ctx: PanelContext, kind: AxisKind): Axis | undefined {
  const pairs = ageDepthPairs(ctx.data?.dataset);
  if (pairs.depths.length < 2) {
    ctx.warn(`Secondary ${kind} axis requested but fewer than two samples have ages; ${kind} axis omitted.`);
    return undefined;
  }
  if (ageInversionAt(pairs) !== undefined) {
    ctx.warn(`Ages do not increase with depth; ${kind} axis omitted.`);
    return undefined;
  }
  // p = primary-axis values, s = secondary-axis values; both ascending.
  const [ps, ss] = kind === "age" ? [pairs.depths, pairs.ages] : [pairs.ages, pairs.depths];
  const [d0, d1] = ctx.y.domain;
  const from = Math.max(d0, ps[0]!);
  const to = Math.min(d1, ps[ps.length - 1]!);
  if (from >= to) return undefined;
  const s0 = interpolate(ps, ss, from)!;
  const s1 = interpolate(ps, ss, to)!;
  const major: Tick[] = [];
  for (const v of ticksAt(s0, s1, niceStep(s1 - s0, 6))) {
    const pos = interpolate(ss, ps, v);
    if (pos !== undefined) major.push({ pos, label: formatNumber(v) });
  }
  return { title: titleOf(ctx, kind), major, minor: [], from, to };
}

function axes(ctx: PanelContext): Axis[] {
  const out = [primaryAxis(ctx)];
  const secondary = ctx.yAxis.secondary;
  if (secondary === ctx.yAxis.primary) ctx.warn(`Secondary y-axis "${secondary}" is the primary axis already; omitted.`);
  else if (secondary !== undefined) {
    const axis = secondaryAxis(ctx, secondary);
    if (axis) out.push(axis);
  }
  return out;
}

/** Title (1 em of the labels font + 1 mm clearance, none if the title is ""), tick labels, ticks. */
function axisWidth(ctx: PanelContext, axis: Axis): number {
  const { theme } = ctx;
  const labelWidth = axis.major.reduce((w, t) => Math.max(w, estimateTextWidth(t.label ?? "", theme.tickFontSize)), 0);
  return (axis.title ? theme.fontSize + 1 : 0) + labelWidth + 0.6 + theme.tickLength;
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
    const stroke = { stroke: theme.axisColour, "stroke-width": theme.lineWidth };
    const family = familyAttr(theme.tickFontFamily, theme.fontFamily);
    let x = 0;
    axes(ctx).forEach((axis, i) => {
      const w = axisWidth(ctx, axis);
      const ag = g.group({ class: i === 0 ? "axis-primary" : "axis-secondary", transform: translate(x, 0) });
      const tx = theme.fontSize * 0.8;
      const ty = (y.toMm(axis.from) + y.toMm(axis.to)) / 2;
      if (axis.title) {
        ag.text(tx, ty, axis.title, { transform: rotate(-90, tx, ty), "text-anchor": "middle" });
        const length = Math.abs(y.toMm(axis.to) - y.toMm(axis.from));
        if (estimateTextWidth(axis.title, theme.fontSize) > length) {
          ctx.warn(`y-axis title "${axis.title}" is longer than its axis (${formatNumber(Math.round(length * 10) / 10)} mm); shorten it in yAxis.titles.`);
        }
      }
      ag.line(w, y.toMm(axis.from), w, y.toMm(axis.to), stroke);
      for (const t of axis.minor) {
        ag.line(w - theme.minorTickLength, y.toMm(t.pos), w, y.toMm(t.pos), stroke);
      }
      for (const t of axis.major) {
        const ty2 = y.toMm(t.pos);
        ag.line(w - theme.tickLength, ty2, w, ty2, stroke);
        ag.text(w - theme.tickLength - 0.6, ty2 + 0.35 * theme.tickFontSize, t.label ?? "", {
          "font-family": family,
          "font-size": theme.tickFontSize,
          "text-anchor": "end",
        });
      }
      x += w + theme.panelGap;
    });
  },
};
