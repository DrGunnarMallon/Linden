// taxonCurves panel — SPEC.md §7.1. One column per selected variable.
// Common scale: column width = max(minWidth, max value × scale); the curve always uses that scale,
// so minWidth widens the column but never distorts it. The scale is shared only within a scale
// family (kind|unit, see scaleKey): percentages and counts never share one.
// Kind "presence" has no scale: a fixed-width column with presence marks where the value is > 0.
// The curve style (type, colours, exaggeration, …) comes from the curve cascade and only changes
// what is drawn inside the columns, never their widths or the x-scale — except its `axis` options
// (range, reverse, log, step, width), which set the x axis of a column without a common scale.
// Continuous columns span their data extent (with error bounds); other kinds start at 0.
// Error columns (variable.companion) are drawn with their variable as an envelope or error bars.
// x-axis titles sit under the tick labels: once per run of one scale family, or under every column.
// Samples sit at their depth, or at their age when age is the primary y axis.

import { samplePosition } from "../layout/ageDepth.js";
import { clean, formatNumber, scaleKey, ticksAt } from "../layout/scales.js";
import { estimateTextWidth, familyAttr, footerHeight, footerHeightWithTitle } from "../layout/theme.js";
import { coreDefaults, type ResolvedTaxonCurvesStyle } from "../model/defaults.js";
import { resolveColumnCurve, resolveVariableStyle, type ResolvedTaxonCurvesPanel } from "../model/resolve.js";
import type { CurveStyle, Dash, FillStyle, PointMark } from "../model/spec.js";
import type { Dataset, MeasurementKind, Variable } from "../model/types.js";
import { columnMax } from "../layout/select.js";
import { fmt, PathBuilder, rotate, translate, type Attrs, type SvgGroup } from "../render/svg.js";
import { LABEL_OFFSET, TEXT_ASCENT, type HeaderColumn } from "../layout/header.js";
import { compactLength, GAP_FLOOR, MIN_WIDTH_FLOOR } from "../layout/layout.js";
import type { ColumnLayout, Panel, PanelContext, PanelMeasure } from "./types.js";

export interface TaxonColumn {
  index: number;
  variable: Variable;
  style: ResolvedTaxonCurvesStyle;
  /** Resolved curve style (cascade, SPEC §4); never affects the geometry. */
  curve: CurveStyle;
  max: number;
  /** Left edge relative to the panel. */
  x: number;
  width: number;
  /** mm per data unit for this column (linear); 0 = no scale (presence, unmapped codes). */
  scale: number;
  /** Axis domain in data units: lo at the left edge (right edge if reversed), hi at the other. */
  lo: number;
  hi: number;
  log: boolean;
  reverse: boolean;
  /** Scale family (kind|unit). */
  key: string;
  /** Tick step the geometry was rounded to (independent scales). */
  step?: number;
  /** Error bounds per sample (from companion columns); absent = the variable has none. */
  errors?: ErrorBounds;
}

/** Lower and upper error bound per sample (index = sample row); undefined = none for that sample. */
export interface ErrorBounds {
  lo: (number | undefined)[];
  hi: (number | undefined)[];
}

/**
 * Error bounds of variable j from its companion columns: lower / upper bounds, else value ± SE (or
 * ± SD). A missing bound falls back to the value itself, so a lower bound alone still draws.
 */
export function errorBounds(ds: Dataset, j: number): ErrorBounds | undefined {
  const id = ds.variables[j]!.id;
  const find = (role: string) => ds.variables.findIndex((v) => v.companion?.errorOf === id && v.companion.role === role);
  const lower = find("lower");
  const upper = find("upper");
  const se = find("se");
  const half = se !== -1 ? se : find("sd");
  if (lower === -1 && upper === -1 && half === -1) return undefined;
  const at = (row: readonly (number | null)[], k: number) => (k === -1 ? undefined : (row[k] ?? undefined));
  const out: ErrorBounds = { lo: [], hi: [] };
  for (const row of ds.values) {
    const v = row[j];
    const e = at(row, half);
    let lo = at(row, lower) ?? (v != null && e !== undefined ? v - Math.abs(e) : undefined);
    let hi = at(row, upper) ?? (v != null && e !== undefined ? v + Math.abs(e) : undefined);
    if (lo === undefined && hi !== undefined && v != null) lo = v;
    if (hi === undefined && lo !== undefined && v != null) hi = v;
    out.lo.push(lo);
    out.hi.push(hi);
  }
  return out;
}

/** Axis of a column without a common scale (see columnAxis). */
export interface ColumnAxis {
  scale: number;
  lo: number;
  hi: number;
  log: boolean;
  step?: number;
}

export interface AxisRequest {
  /** Data extent (values and error bounds); undefined = no values. */
  lo?: number;
  hi?: number;
  /** Smallest positive value (log axes). */
  minPositive?: number;
  /** Fixed axis ends (curve style axis.min / max); null = automatic. */
  min: number | null;
  max: number | null;
  /** Log axis; the caller checks that the ends are positive. */
  log: boolean;
  /** Tick step; null = automatic (1–2–5 at least minSpacing mm). */
  step: number | null;
  minSpacing: number;
  integer: boolean;
  /** The axis starts at 0 (abundances); otherwise at the data minimum (continuous values). */
  fromZero: boolean;
  /** Use the extent as it is, without rounding to ticks (class scales: up to the top class). */
  exact: boolean;
}

/**
 * Axis of a column without a common scale, `width` mm wide. Linear: from 0 (or the data minimum) to
 * the data maximum, each rounded out to a whole tick step so the axis ends on labelled ticks; fixed
 * ends are used as given. Log: whole decades around the data. scale 0 = nothing to draw.
 */
export function columnAxis(width: number, r: AxisRequest): ColumnAxis {
  if (r.log) {
    const lo = r.min ?? 10 ** Math.floor(Math.log10(r.minPositive!) + 1e-9);
    let hi = r.max ?? 10 ** Math.ceil(Math.log10(r.hi!) - 1e-9);
    if (!(hi > lo)) hi = lo * 10;
    return { scale: width / (hi - lo), lo: clean(lo), hi: clean(hi), log: true };
  }
  const none: ColumnAxis = { scale: 0, lo: 0, hi: 0, log: false };
  if (r.hi === undefined && (r.min === null || r.max === null)) return none;
  let lo0 = r.min ?? (r.fromZero ? 0 : r.lo!);
  let hi0 = r.max ?? r.hi!;
  if (r.fromZero && r.max === null && !(hi0 > 0)) return none;
  if (!(hi0 > lo0)) {
    // A constant continuous column: a little room either side.
    const pad = Math.abs(lo0) > 0 ? Math.abs(lo0) / 10 : 1;
    if (r.min === null) lo0 -= pad;
    if (r.max === null) hi0 += pad;
  }
  if (!(hi0 > lo0)) return none;
  if (r.exact && r.min === null && r.max === null) return { scale: width / (hi0 - lo0), lo: lo0, hi: hi0, log: false };
  const step = r.step ?? autoTickStep(width / (hi0 - lo0), r.minSpacing, r.integer);
  const lo = r.min ?? Math.floor(lo0 / step + 1e-9) * step;
  const hi = r.max ?? Math.ceil(hi0 / step - 1e-9) * step;
  return { scale: width / (hi - lo), lo, hi, log: false, step };
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
  const { minSpacing, step: fixed } = style.xTicks;
  const { scale, step } = columnAxis(width, { hi: max, min: null, max: null, log: false, step: fixed, minSpacing, integer, fromZero: true, exact });
  return step === undefined ? { width, scale } : { width, scale, step };
}

/** x of a value in the column, mm from its left edge (unclamped; log: values ≤ 0 lie beyond the start). */
export function valueX(col: Pick<TaxonColumn, "lo" | "hi" | "log" | "reverse" | "scale" | "width">, v: number): number {
  let x: number;
  if (col.log) x = v > 0 ? (col.width * (Math.log10(v) - Math.log10(col.lo))) / (Math.log10(col.hi) - Math.log10(col.lo)) : Number.NEGATIVE_INFINITY;
  else x = (v - col.lo) * col.scale;
  return col.reverse ? col.width - x : x;
}

/** x of a value, kept inside the column. */
function xAt(col: TaxonColumn, v: number): number {
  return Math.min(Math.max(valueX(col, v), 0), col.width);
}

/** x where filled areas and bars start: the value 0, or the axis start if 0 is not on the axis. */
function baseX(col: TaxonColumn): number {
  return xAt(col, col.log ? col.lo : 0);
}

/** x of the zero line; undefined when 0 is not on the axis (or the axis is logarithmic). */
function zeroX(col: TaxonColumn): number | undefined {
  if (col.log || col.lo > 1e-12 || col.hi < -1e-12) return undefined;
  return valueX(col, 0);
}

/** Axis options other than the title, which only a column without a common scale can use. */
function axisOptionsSet(a: CurveStyle["axis"]): boolean {
  return a.min !== null || a.max !== null || a.reverse || a.scale === "log" || a.step !== null || a.width !== null;
}

/** Extent of a column's values and error bounds. */
function dataExtent(ds: Dataset, j: number, errors: ErrorBounds | undefined): { lo?: number; hi?: number; minPositive?: number } {
  let lo: number | undefined;
  let hi: number | undefined;
  let minPositive: number | undefined;
  const add = (x: number | null | undefined) => {
    if (x === null || x === undefined) return;
    lo = lo === undefined ? x : Math.min(lo, x);
    hi = hi === undefined ? x : Math.max(hi, x);
    if (x > 0) minPositive = minPositive === undefined ? x : Math.min(minPositive, x);
  };
  ds.values.forEach((row, i) => {
    add(row[j]);
    add(errors?.lo[i]);
    add(errors?.hi[i]);
  });
  const out: { lo?: number; hi?: number; minPositive?: number } = {};
  if (lo !== undefined) out.lo = lo;
  if (hi !== undefined) out.hi = hi;
  if (minPositive !== undefined) out.minPositive = minPositive;
  return out;
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
    // Continuous values (LOI, δ13C, WTD) never share a common scale: each has its own x axis.
    const own = resolveVariableStyle(spec, variable.id);
    const resolved = variable.kind === "continuous" ? { ...own, commonScale: false } : own;
    const style = { ...resolved, minWidth: compactLength(resolved.minWidth, MIN_WIDTH_FLOOR, ctx.fit.compact) };
    const key = scaleKey(variable);
    const curve = resolveColumnCurve(spec, variable.id, variable.group, variable.kind).style;
    const unscaled = { lo: 0, hi: 0, log: false, reverse: false };
    if (variable.kind === "presence" || variable.codes) {
      // No scale: presence marks, or text codes no scaleMap has mapped (drawn empty, see measure).
      const width = compactLength(Math.max(resolved.minWidth, ctx.theme.presenceWidth), MIN_WIDTH_FLOOR, ctx.fit.compact);
      cols.push({ index: j, variable, style, curve, max: 0, x, width, scale: 0, key, ...unscaled });
    } else {
      // Class scales span the whole scale (top class), so all class columns read alike.
      const top = variable.scaleLabels?.reduce((m, l) => Math.max(m, l.value), 0);
      const errors = errorBounds(data.dataset, j);
      const extent = dataExtent(data.dataset, j, errors);
      const max = Math.max(columnMax(data.dataset, j), top ?? 0);
      const axis = curve.axis;
      let col: TaxonColumn;
      if (style.commonScale) {
        // Range, reverse, log and width would break the common scale (rule: never silently).
        if (axisOptionsSet(axis)) {
          ctx.warn(`"${variable.id}": x-axis range, reverse, log, step and width apply only to columns without a common scale (commonScale false); ignored to keep the common scale.`);
        }
        const { width, scale } = columnGeometry(max, style, ctx.xScale * (ctx.scaleRatios.get(key) ?? 1), 0);
        col = { index: j, variable, style, curve, max, x, width, scale, key, ...unscaled, hi: scale > 0 ? width / scale : 0 };
      } else {
        // Independent columns shrink with the global x factor like everything else.
        const width = Math.max(style.minWidth, (axis.width ?? resolved.columnWidth) * (ctx.xScale / ctx.theme.naturalXScale));
        let [min, maxEnd] = [axis.min, axis.max];
        if (min !== null && maxEnd !== null && !(maxEnd > min)) {
          ctx.warn(`"${variable.id}": x-axis min ${min} is not below max ${maxEnd}; automatic range used.`);
          [min, maxEnd] = [null, null];
        }
        let log = axis.scale === "log";
        if (log && !((min ?? extent.minPositive ?? 0) > 0 && (maxEnd ?? extent.hi ?? 0) > 0)) {
          ctx.warn(`"${variable.id}": a log x axis needs positive values; linear axis used.`);
          log = false;
        }
        const continuous = variable.kind === "continuous";
        const geo = columnAxis(width, {
          ...extent,
          hi: continuous || log ? extent.hi : Math.max(max, extent.hi ?? 0),
          min,
          max: maxEnd,
          log,
          step: axis.step ?? style.xTicks.step,
          minSpacing: style.xTicks.minSpacing,
          integer: integerKind(variable.kind),
          fromZero: !continuous,
          exact: top !== undefined,
        });
        col = { index: j, variable, style, curve, max, x, width, scale: geo.scale, key, lo: geo.lo, hi: geo.hi, log: geo.log, reverse: axis.reverse };
        if (geo.step !== undefined) col.step = geo.step;
      }
      if (errors) col.errors = errors;
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
  let ticks: { value: number; text: string }[];
  let minor: number[] = [];
  if (col.variable.scaleLabels) {
    ticks = col.variable.scaleLabels.filter((l) => l.value >= col.lo - 1e-9 && l.value <= col.hi + 1e-9).map((l) => ({ value: l.value, text: l.label }));
  } else if (col.log) {
    ({ ticks, minor } = logTicks(col.lo, col.hi));
  } else {
    const step = col.step ?? col.style.xTicks.step ?? autoTickStep(col.scale, col.style.xTicks.minSpacing, integerKind(col.variable.kind));
    const values = (col.hi - col.lo) / step <= 100 ? ticksAt(col.lo, col.hi, step) : [col.lo];
    ticks = values.map((value) => ({ value, text: formatNumber(value) }));
  }
  // Labels are placed left to right (a reversed axis has its largest value on the left).
  if (col.reverse) ticks.reverse();
  const w = (t: string) => estimateTextWidth(t, tickFontSize);
  // Common scale: labels centred, kept clear of the next column's "0". Independent scales: labels
  // stay inside the column — the first starts at 0, one at the column end ends there.
  const inside = !col.style.commonScale;
  const rightLimit = inside ? col.width : col.width + room - w("0") / 2 - pad;
  // The end label first, so it wins over a crowded neighbour.
  const endAt = inside ? ticks.findIndex((t) => Math.abs(valueX(col, t.value) - col.width) < 1e-6) : -1;
  const extentOf = (i: number): [number, number, "start" | "middle" | "end"] => {
    const x = valueX(col, ticks[i]!.value);
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
    const x = valueX(col, t.value);
    const text = t.text + suffix;
    const shift = t.anchor === "middle" ? -w(t.text) / 2 : 0;
    const l = t.anchor === "end" ? x - w(text) : x + shift;
    if (l >= prevRight + pad - 1e-9 && l + w(text) <= rightLimit + 1e-9) {
      out[last] = t.anchor === "middle" ? { ...t, text, anchor: "start", shift } : { ...t, text };
    }
  }
  if (minor.length === 0) return out;
  const all = [...out, ...minor.map((value): Tick => ({ value, label: false, text: "", anchor: "middle", minor: true }))];
  return all.sort((a, b) => valueX(col, a.value) - valueX(col, b.value));
}

/**
 * Log axis ticks: labelled candidates at the powers of ten (also at 2 and 5 × 10ⁿ when the axis spans
 * less than two decades), unlabelled minor ticks at the other whole multiples.
 */
function logTicks(lo: number, hi: number): { ticks: { value: number; text: string }[]; minor: number[] } {
  const few = Math.log10(hi / lo) < 2 - 1e-9;
  const ticks: { value: number; text: string }[] = [];
  const minor: number[] = [];
  for (let k = Math.floor(Math.log10(lo) - 1e-9); k <= Math.ceil(Math.log10(hi) + 1e-9); k++) {
    for (let m = 1; m <= 9; m++) {
      const value = clean(m * 10 ** k);
      if (value < lo * (1 - 1e-9) || value > hi * (1 + 1e-9)) continue;
      if (m === 1 || (few && (m === 2 || m === 5))) ticks.push({ value, text: formatNumber(value) });
      else minor.push(value);
    }
  }
  return { ticks, minor };
}

export interface Tick {
  value: number;
  label: boolean;
  text: string;
  anchor: "start" | "middle" | "end";
  /** Label offset from the tick, mm (a suffixed label starts where the bare number would). */
  shift?: number;
  /** Short unlabelled tick (log axes). */
  minor?: boolean;
}

/** Horizontal extent of a tick label, column-relative. */
function tickExtent(t: Tick, col: TaxonColumn, tickFontSize: number): [number, number] {
  const x = valueX(col, t.value) + (t.shift ?? 0);
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
 * x-axis titles (style.xTitle): "panel" = one per run of adjacent columns of one scale family and
 * title, centred under the run; "column" = one per column. Text = the column's curve style
 * axis.title, else xTitle.text, else from the kind and unit.
 * Placed left to right; a title that would touch the previous one is skipped (counted in `skipped`).
 */
export function xAxisTitles(ctx: PanelContext, cols: readonly TaxonColumn[]): { titles: XAxisTitle[]; skipped: number } {
  const { xTitle } = panelSpec(ctx)?.style ?? { xTitle: { show: "none" } };
  if (xTitle.show === "none") return { titles: [], skipped: 0 };
  const spans: { text: string; x0: number; x1: number; key: string }[] = [];
  cols.forEach((c, i) => {
    if (c.variable.codes) return; // unmapped codes: nothing plotted
    const prev = spans[spans.length - 1];
    const text = c.curve.axis.title ?? xTitle.text ?? defaultXTitle(c.variable);
    if (xTitle.show === "panel" && prev && prev.key === c.key && prev.text === text && !cols[i - 1]!.variable.codes) prev.x1 = c.x + c.width;
    else spans.push({ text, x0: c.x, x1: c.x + c.width, key: c.key });
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

/** The variable's group colour (theme default fill without a group colour). */
function groupColour(ctx: PanelContext, col: TaxonColumn): string {
  const g = col.variable.group;
  if (g === undefined) return ctx.theme.defaultFill;
  return ctx.data?.dataset.groups.find((x) => x.id === g)?.colour ?? ctx.theme.defaultFill;
}

/** A style colour: a CSS colour or "group". */
function colourOf(ctx: PanelContext, col: TaxonColumn, colour: string): string {
  return colour === "group" ? groupColour(ctx, col) : colour;
}

/** Main colour of the curve (what exaggeration colour "curve" means). */
function curveColour(ctx: PanelContext, col: TaxonColumn): string {
  const s = col.curve;
  switch (s.type) {
    case "polygon":
    case "bars":
      return colourOf(ctx, col, s.fill.colour);
    case "line":
    case "linePoints":
      return colourOf(ctx, col, s.line.colour);
    case "points":
      return colourOf(ctx, col, s.points.colour);
    case "presence":
      return colourOf(ctx, col, s.presence.colour);
    case "none":
      return groupColour(ctx, col);
  }
}

/** stroke-dasharray for a dash style (mm); undefined = solid. */
function dashArray(dash: Dash): string | undefined {
  if (dash === "solid") return undefined;
  const d = dash === "dashed" ? [1, 0.5] : dash === "dotted" ? [0.2, 0.4] : dash;
  return d.map(fmt).join(" ");
}

interface Point {
  y: number;
  v: number;
  /** Halfway to the previous and to the next sample (in depth order), clamped to the plot. */
  y0: number;
  y1: number;
  /** Local sample spacing in mm: distance to the nearest neighbouring sample; 0 = single sample. */
  spacing: number;
  /** Error bounds at this sample, if any. */
  lo?: number;
  hi?: number;
}

/**
 * Runs of consecutive non-null values in y order (depth, or age on an age axis; samples without an
 * age are left out there); null breaks a run (gap) unless nulls "connect". On a log axis values ≤ 0
 * count as null.
 */
function runs(ctx: PanelContext, col: TaxonColumn): Point[][] {
  const ds = ctx.data!.dataset;
  const order = ds.samples
    .map((s, i) => ({ d: samplePosition(s, ctx.yAxis.primary), i }))
    .filter((o): o is { d: number; i: number } => o.d !== undefined)
    .sort((a, b) => a.d - b.d || a.i - b.i);
  const depths = [...new Set(order.map((o) => o.d))];
  const h = ctx.y.height;
  const clamp = (y: number) => Math.min(Math.max(y, Math.min(0, h)), Math.max(0, h));
  const extent = new Map<number, [number, number, number]>();
  depths.forEach((d, k) => {
    const y = ctx.y.toMm(d);
    const prev = k > 0 ? ctx.y.toMm(depths[k - 1]!) : undefined;
    const next = k < depths.length - 1 ? ctx.y.toMm(depths[k + 1]!) : undefined;
    const a = prev !== undefined ? (prev + y) / 2 : next !== undefined ? y - (next - y) / 2 : y;
    const b = next !== undefined ? (y + next) / 2 : prev !== undefined ? y + (y - prev) / 2 : y;
    const near = Math.min(prev === undefined ? Infinity : Math.abs(y - prev), next === undefined ? Infinity : Math.abs(next - y));
    extent.set(d, [clamp(a), clamp(b), Number.isFinite(near) ? near : 0]);
  });
  const connect = col.curve.nulls === "connect";
  const out: Point[][] = [];
  let cur: Point[] = [];
  for (const { d, i } of order) {
    const v = ds.values[i]![col.index];
    if (v === null || v === undefined || (col.log && !(v > 0))) {
      if (connect) continue;
      if (cur.length) out.push(cur);
      cur = [];
    } else {
      const [y0, y1, spacing] = extent.get(d)!;
      const p: Point = { y: ctx.y.toMm(d), v, y0, y1, spacing };
      const lo = col.errors?.lo[i];
      const hi = col.errors?.hi[i];
      if (lo !== undefined && hi !== undefined) [p.lo, p.hi] = [lo, hi];
      cur.push(p);
    }
  }
  if (cur.length) out.push(cur);
  return out;
}

/** Bar thickness along the depth axis at a sample. */
function barThickness(ctx: PanelContext, col: TaxonColumn, p: Point): number {
  const s = col.curve;
  if (s.type !== "bars") return ctx.theme.barThickness;
  if (s.barWidth.mode === "mm") return s.barWidth.value;
  return p.spacing > 0 ? s.barWidth.value * p.spacing : ctx.theme.barThickness;
}

/**
 * Bars centred on the sample depth, from the base (0, or the axis start) to the value. Bars as a
 * fraction of the spacing never overlap (fraction ≤ 1) and are kept within the plot.
 */
function drawBars(g: SvgGroup, ctx: PanelContext, col: TaxonColumn, run: Point[], xOf: (v: number) => number, attrs: Attrs): void {
  const fraction = col.curve.type === "bars" && col.curve.barWidth.mode === "fraction";
  const h = ctx.y.height;
  const base = baseX(col);
  for (const p of run) {
    const x = xOf(p.v);
    if (x === base) continue;
    const t = barThickness(ctx, col, p);
    const top = fraction ? Math.max(p.y - t / 2, Math.min(0, h)) : p.y - t / 2;
    const bottom = fraction ? Math.min(p.y + t / 2, Math.max(0, h)) : p.y + t / 2;
    g.rect(Math.min(base, x), top, Math.abs(x - base), bottom - top, attrs);
  }
}

/**
 * Curve path through a run: linear through the samples, or steps reaching halfway to the neighbours.
 * Appends to `d` if given (an area outline), otherwise starts a new path.
 */
function curvePath(run: Point[], xOf: (v: number) => number, step: boolean, d?: PathBuilder): PathBuilder {
  const path = d ?? new PathBuilder();
  run.forEach((p, i) => {
    const to = (x: number, y: number) => (i === 0 && !d ? path.moveTo(x, y) : path.lineTo(x, y));
    if (step) to(xOf(p.v), p.y0).lineTo(xOf(p.v), p.y1);
    else to(xOf(p.v), p.y);
  });
  return path;
}

/** Filled area between the base (0, or the axis start) and the curve; a single linear sample is a thin bar. */
function drawArea(g: SvgGroup, ctx: PanelContext, col: TaxonColumn, run: Point[], xOf: (v: number) => number, step: boolean, attrs: Attrs): void {
  const base = baseX(col);
  if (!step && run.length === 1) {
    const t = ctx.theme.barThickness;
    const x = xOf(run[0]!.v);
    if (x !== base) g.rect(Math.min(base, x), run[0]!.y - t / 2, Math.abs(x - base), t, attrs);
    return;
  }
  const first = run[0]!;
  const last = run[run.length - 1]!;
  const d = new PathBuilder().moveTo(base, step ? first.y0 : first.y);
  curvePath(run, xOf, step, d);
  g.path(d.lineTo(base, step ? last.y1 : last.y).close(), attrs);
}

/**
 * Error of the values (curve style `error`): an envelope between the lower and upper bounds along
 * each run of samples that have both, or horizontal error bars with end caps. Drawn behind the curve.
 */
function renderError(ctx: PanelContext, g: SvgGroup, col: TaxonColumn, rs: Point[][]): void {
  const e = col.curve.error;
  if (e.show === "off" || !col.errors) return;
  const xOf = (v: number) => xAt(col, v);
  const eg = g.group({ class: "error" });
  if (e.show === "envelope") {
    const c = e.envelope.colour === "curve" ? curveColour(ctx, col) : colourOf(ctx, col, e.envelope.colour);
    const step = stepped(col.curve);
    const t = ctx.theme.barThickness;
    // One side of the envelope through the samples (steps: halfway to the neighbours; a lone sample: a thin band).
    const side = (part: Point[], v: (p: Point) => number): [number, number][] =>
      part.flatMap((p): [number, number][] => {
        const x = xOf(v(p));
        if (step) return [[x, p.y0], [x, p.y1]];
        return part.length === 1 ? [[x, p.y - t / 2], [x, p.y + t / 2]] : [[x, p.y]];
      });
    const d = new PathBuilder();
    for (const run of rs) {
      // Sub-runs of samples with both bounds: upper bound down, lower bound back up.
      let part: Point[] = [];
      const flush = () => {
        if (part.length > 0) {
          const ring = [...side(part, (p) => p.hi!), ...side(part, (p) => p.lo!).reverse()];
          ring.forEach(([x, y], k) => (k === 0 ? d.moveTo(x, y) : d.lineTo(x, y)));
          d.close();
        }
        part = [];
      };
      for (const p of run) {
        if (p.lo === undefined) flush();
        else part.push(p);
      }
      flush();
    }
    if (!d.isEmpty()) eg.path(d, { fill: c, "fill-opacity": e.envelope.opacity });
    return;
  }
  const c = e.bars.colour === "curve" ? curveColour(ctx, col) : colourOf(ctx, col, e.bars.colour);
  const cap = e.bars.cap / 2;
  const d = new PathBuilder();
  for (const p of rs.flat()) {
    if (p.lo === undefined) continue;
    const [a, b] = [xOf(p.lo), xOf(p.hi!)];
    d.moveTo(a, p.y).lineTo(b, p.y);
    if (cap > 0) d.moveTo(a, p.y - cap).lineTo(a, p.y + cap).moveTo(b, p.y - cap).lineTo(b, p.y + cap);
  }
  if (!d.isEmpty()) eg.path(d, { fill: "none", stroke: c, "stroke-width": e.bars.width ?? ctx.theme.curveLineWidth });
}

/** Whether the type's curve is stepped (polygon shape, line interpolation). */
function stepped(s: CurveStyle): boolean {
  if (s.type === "polygon") return s.shape === "step";
  if (s.type === "line" || s.type === "linePoints") return s.interpolation === "step";
  return false;
}

/** Fill attribute for a fill style: a colour, or a <pattern> defined in the column's <defs>. */
function fillPaint(ctx: PanelContext, g: SvgGroup, col: TaxonColumn, fill: FillStyle, id: string): string {
  const c = colourOf(ctx, col, fill.colour);
  const { type, angle, spacing: sp } = fill.pattern;
  if (type === "solid") return c;
  const pattern = g.element("defs").element("pattern", {
    id,
    width: sp,
    height: sp,
    patternUnits: "userSpaceOnUse",
    patternTransform: angle === 0 ? undefined : rotate(angle, 0, 0),
  });
  const stroke = { stroke: c, "stroke-width": ctx.theme.curveLineWidth };
  if (type === "dots") pattern.circle(sp / 2, sp / 2, sp * 0.15, { fill: c });
  else pattern.line(0, sp / 2, sp, sp / 2, stroke);
  if (type === "crosshatch") pattern.line(sp / 2, 0, sp / 2, sp, stroke);
  return `url(#${id})`;
}

/** Point marks at the values. Open marks are filled with the page background. */
function drawPoints(ctx: PanelContext, g: SvgGroup, col: TaxonColumn, rs: Point[][], mark: PointMark, xOf: (v: number) => number): void {
  const { theme } = ctx;
  const c = colourOf(ctx, col, mark.colour);
  const pg = g.group({ class: "points" });
  const attrs = { fill: mark.filled ? c : (theme.background ?? "none"), stroke: c, "stroke-width": theme.curveLineWidth };
  const r = mark.size / 2;
  for (const run of rs) {
    for (const p of run) {
      const x = xOf(p.v);
      switch (mark.shape) {
        case "circle":
          pg.circle(x, p.y, r, attrs);
          break;
        case "square":
          pg.rect(x - r, p.y - r, mark.size, mark.size, attrs);
          break;
        case "triangle":
          pg.path(new PathBuilder().moveTo(x, p.y - r).lineTo(x + r, p.y + r).lineTo(x - r, p.y + r).close(), attrs);
          break;
        case "diamond":
          pg.path(new PathBuilder().moveTo(x, p.y - r).lineTo(x + r, p.y).lineTo(x, p.y + r).lineTo(x - r, p.y).close(), attrs);
          break;
        case "cross":
          pg.path(new PathBuilder().moveTo(x - r, p.y - r).lineTo(x + r, p.y + r).moveTo(x - r, p.y + r).lineTo(x + r, p.y - r), { fill: "none", stroke: c, "stroke-width": theme.curveLineWidth });
          break;
      }
    }
  }
}

/** Presence marks at the column centre (bar: full width) where the value is > 0; marks never exceed the column. */
function renderPresence(ctx: PanelContext, g: SvgGroup, col: TaxonColumn, rs: Point[][]): void {
  const { theme } = ctx;
  const style = col.curve.type === "presence" ? col.curve.presence : coreDefaults.curve.presence.presence;
  const c = colourOf(ctx, col, style.colour);
  const size = Math.min(style.size, col.width);
  const x = col.width / 2;
  const mg = g.group({ class: "presence" });
  for (const run of rs) {
    for (const p of run) {
      if (!(p.v > 0)) continue;
      if (style.symbol === "bar") mg.rect(0, p.y - style.size / 2, col.width, style.size, { fill: c });
      else if (style.symbol === "dot") mg.circle(x, p.y, size / 2, { fill: c, stroke: theme.stroke, "stroke-width": theme.curveLineWidth });
      else if (style.symbol === "square") mg.rect(x - size / 2, p.y - size / 2, size, size, { fill: c, stroke: theme.stroke, "stroke-width": theme.curveLineWidth });
      else {
        const d = new PathBuilder().moveTo(x - size / 2, p.y).lineTo(x + size / 2, p.y).moveTo(x, p.y - size / 2).lineTo(x, p.y + size / 2);
        mg.path(d, { fill: "none", stroke: c, "stroke-width": theme.lineWidth });
      }
    }
  }
}

/** Value label text for a value (valueLabels); undefined = none. */
function valueLabel(col: TaxonColumn, v: number): string | undefined {
  const { show, threshold, format, decimals } = col.curve.valueLabels;
  if (show === "off" || (show === "aboveThreshold" && !(v > threshold))) return undefined;
  return format.split("{value}").join(v.toFixed(decimals));
}

/** Left edge of a value label: right of the value (presence columns: right of the column). */
function valueLabelX(ctx: PanelContext, col: TaxonColumn, v: number): number {
  return (col.scale > 0 ? Math.min(valueX(col, v), col.width) : col.width) + ctx.theme.plusOffset;
}

function renderValueLabels(ctx: PanelContext, g: SvgGroup, col: TaxonColumn, rs: Point[][]): void {
  const { theme } = ctx;
  if (col.curve.valueLabels.show === "off") return;
  const lg = g.group({ class: "value-labels", "font-family": familyAttr(theme.tickFontFamily, theme.fontFamily), "font-size": theme.tickFontSize });
  for (const p of rs.flat()) {
    const text = valueLabel(col, p.v);
    if (text !== undefined) lg.text(valueLabelX(ctx, col, p.v), p.y + LABEL_OFFSET * theme.tickFontSize, text);
  }
}

/** Exaggeration (×factor) behind the main curve: filled area (bars for bars) or a line, in a lighter colour. */
function renderExaggeration(ctx: PanelContext, g: SvgGroup, col: TaxonColumn, rs: Point[][]): void {
  const { exaggeration: e } = col.curve;
  if (!e.show) return;
  const c = e.colour === "curve" ? curveColour(ctx, col) : colourOf(ctx, col, e.colour);
  const xOf = (v: number) => xAt(col, v * e.factor);
  const eg = g.group({ class: "exaggeration" });
  const step = stepped(col.curve);
  for (const run of rs) {
    if (e.style === "line") {
      if (run.length > 1 || step) eg.path(curvePath(run, xOf, step), { fill: "none", stroke: c, "stroke-opacity": e.opacity, "stroke-width": ctx.theme.curveLineWidth });
    } else if (col.curve.type === "bars") drawBars(eg, ctx, col, run, xOf, { fill: c, "fill-opacity": e.opacity });
    else drawArea(eg, ctx, col, run, xOf, step, { fill: c, "fill-opacity": e.opacity });
  }
}

/** The main curve of a scaled column. */
function renderCurve(ctx: PanelContext, g: SvgGroup, col: TaxonColumn, rs: Point[][], id: string): void {
  const { theme } = ctx;
  const s = col.curve;
  const xOf = (v: number) => xAt(col, v);
  const mg = g.group({ class: "curve" });
  if (s.type === "polygon" || s.type === "bars") {
    const filled = s.type === "bars" || s.filled;
    const fill = filled ? fillPaint(ctx, g, col, s.fill, `${id}-fill`) : "none";
    const attrs: Attrs = { fill, "fill-opacity": filled && s.fill.opacity < 1 ? s.fill.opacity : undefined };
    if (s.outline.show) {
      attrs.stroke = colourOf(ctx, col, s.outline.colour);
      attrs["stroke-width"] = s.outline.width ?? theme.curveLineWidth;
      attrs["stroke-dasharray"] = dashArray(s.outline.dash);
    }
    for (const run of rs) {
      if (s.type === "bars") drawBars(mg, ctx, col, run, xOf, attrs);
      else drawArea(mg, ctx, col, run, xOf, s.shape === "step", attrs);
    }
    return;
  }
  if (s.type === "line" || s.type === "linePoints") {
    const step = s.interpolation === "step";
    const attrs = { fill: "none", stroke: colourOf(ctx, col, s.line.colour), "stroke-width": s.line.width ?? theme.curveLineWidth, "stroke-dasharray": dashArray(s.line.dash) };
    for (const run of rs) if (run.length > 1 || step) mg.path(curvePath(run, xOf, step), attrs);
  }
  if (s.type === "linePoints" || s.type === "points" || (s.type === "line" && s.points.show)) drawPoints(ctx, mg, col, rs, s.points, xOf);
}

function renderColumn(ctx: PanelContext, g: SvgGroup, col: TaxonColumn, ticks: readonly Tick[], id: string): void {
  const { theme, y } = ctx;
  const h = y.height;
  const s = col.curve;
  const line = { stroke: theme.axisColour, "stroke-width": theme.lineWidth };
  if (col.variable.codes) {
    g.group({ class: "x-axis" }).line(0, h, col.width, h, line);
    renderLabel(ctx, g, col);
    return;
  }
  const rs = runs(ctx, col);
  if (col.variable.kind === "presence") {
    if (s.type !== "none") renderPresence(ctx, g, col, rs);
    renderValueLabels(ctx, g, col, rs);
    g.group({ class: "x-axis" }).line(0, h, col.width, h, line);
    renderLabel(ctx, g, col);
    return;
  }

  // Presence marks and "none" draw no exaggeration, error, baseline or "+".
  const scaled = s.type !== "presence" && s.type !== "none";
  if (scaled) renderExaggeration(ctx, g, col, rs);
  if (scaled) renderError(ctx, g, col, rs);
  if (s.type === "presence") renderPresence(ctx, g, col, rs);
  else if (scaled) renderCurve(ctx, g, col, rs, id);

  // Zero baseline along each run (where 0 is on the axis); nulls leave a gap (unless connected).
  const x0 = zeroX(col);
  if (scaled && s.baseline.show && x0 !== undefined) {
    const step = stepped(s);
    const attrs = {
      stroke: s.baseline.colour === "axis" ? theme.axisColour : colourOf(ctx, col, s.baseline.colour),
      "stroke-width": s.baseline.width ?? theme.lineWidth,
      "stroke-dasharray": dashArray(s.baseline.dash),
    };
    for (const run of rs) {
      const first = run[0]!;
      const last = run[run.length - 1]!;
      if (step) g.line(x0, first.y0, x0, last.y1, attrs);
      else if (run.length > 1) g.line(x0, first.y, x0, last.y, attrs);
    }
  }

  // "+" for small non-zero values.
  if (scaled && s.plus.show && s.plus.threshold > 0) {
    const r = s.plus.size / 2;
    const d = new PathBuilder();
    for (const run of rs) {
      for (const p of run) {
        if (p.v > 0 && p.v < s.plus.threshold) {
          const x = theme.plusOffset + valueX(col, p.v);
          d.moveTo(x - r, p.y).lineTo(x + r, p.y).moveTo(x, p.y - r).lineTo(x, p.y + r);
        }
      }
    }
    if (!d.isEmpty()) g.path(d, { class: "plus", fill: "none", ...line });
  }
  renderValueLabels(ctx, g, col, rs);

  // x axis in the footer band.
  const xg = g.group({ class: "x-axis" });
  xg.line(0, h, col.width, h, line);
  const tickY = h + theme.tickLength + 0.5 + theme.tickFontSize * 0.8;
  const family = familyAttr(theme.tickFontFamily, theme.fontFamily);
  for (const t of ticks) {
    const x = valueX(col, t.value);
    xg.line(x, h, x, h + (t.minor ? theme.minorTickLength : theme.tickLength), line);
    if (t.label) xg.text(x + (t.shift ?? 0), tickY, t.text, { "font-family": family, "font-size": theme.tickFontSize, "text-anchor": t.anchor });
  }
  renderLabel(ctx, g, col);
}

/**
 * Horizontal extent (relative to the column) of what renderColumn draws below the header band and the
 * layout reserves: tick labels, "+" markers and value labels. It depends only on the data, the column
 * geometry and options every curve type shares — never on the type, so a type change never moves a column.
 */
function columnInk(ctx: PanelContext, col: TaxonColumn, ticks: readonly Tick[]): [number, number] {
  const { theme } = ctx;
  let left = 0;
  let right = col.width;
  for (const t of ticks) {
    if (!t.label) continue;
    const [l, r] = tickExtent(t, col, theme.tickFontSize);
    left = Math.min(left, l);
    right = Math.max(right, r);
  }
  const { plus } = col.curve;
  if (plus.show && plus.threshold > 0 && col.scale > 0) {
    right = Math.max(right, theme.plusOffset + (col.reverse ? col.width : valueX(col, plus.threshold)) + plus.size / 2);
  }
  if (!col.variable.codes && ctx.data) {
    for (const row of ctx.data.dataset.values) {
      const v = row[col.index];
      const text = typeof v === "number" ? valueLabel(col, v) : undefined;
      if (text !== undefined) right = Math.max(right, valueLabelX(ctx, col, v!) + estimateTextWidth(text, theme.tickFontSize));
    }
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
    // Independent scales may mix kinds (each column has its own axis); a common scale may not.
    const kinds = [...new Set(cols.filter((c) => c.style.commonScale).map((c) => c.variable.kind))];
    if (kinds.length > 1) {
      ctx.warn(`taxonCurves (${ctx.id}): mixes kinds (${kinds.join(", ")}) on a common scale; each kind gets its own x-scale. Use one panel per kind (selection "kinds") or commonScale false.`);
    }
    for (const c of cols) {
      if (c.variable.codes) {
        ctx.warn(`"${c.variable.id}" has text codes (${c.variable.codes.join(", ")}) but no scaleMap transform maps them; column left empty.`);
      }
      if (!ds || c.style.commonScale || !(c.scale > 0)) continue;
      const vals = ds.values.map((row) => row[c.index]).filter((v): v is number => v !== null && v !== undefined);
      const { min, max } = c.curve.axis;
      const outside = min === null && max === null ? 0 : vals.filter((v) => v < c.lo - 1e-9 || v > c.hi + 1e-9).length;
      if (outside > 0) ctx.warn(`"${c.variable.id}": ${outside} value(s) outside the x-axis range ${formatNumber(c.lo)}–${formatNumber(c.hi)} are drawn at the axis end.`);
      const nonPositive = c.log ? vals.filter((v) => !(v > 0)).length : 0;
      if (nonPositive > 0) ctx.warn(`"${c.variable.id}": ${nonPositive} value(s) ≤ 0 cannot be drawn on a log axis; left out.`);
    }
    const last = cols[cols.length - 1];
    // Skipped titles are reported by render(): measure also runs at trial widths while fitting.
    const { titles } = xAxisTitles(ctx, cols);
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
      // A column with its own width (curve style axis.width) does not follow style.columnWidth.
      const own = !c.style.commonScale && c.curve.axis.width !== null;
      const sizing = c.variable.kind === "presence" || c.variable.codes || own ? "fixed" : c.style.commonScale ? "scale" : "column";
      const extent = sizing === "scale" && ctx.xScale > 0 ? (c.max * c.scale) / ctx.xScale : 0;
      return { id: c.variable.id, x: c.x, width: c.width, sizing, extent, minWidth: c.style.minWidth };
    });
  },

  render(ctx, g) {
    const cols = taxonColumns(ctx);
    const ticks = panelTicks(ctx, cols);
    cols.forEach((col, i) => {
      const id = `${ctx.id}-${slug(col.variable.id)}`;
      const cg = g.group({ id, class: "column", transform: translate(col.x, 0) });
      renderColumn(ctx, cg, col, ticks[i]!, id);
    });
    const { titles, skipped } = xAxisTitles(ctx, cols);
    if (skipped > 0) {
      ctx.warn(`taxonCurves (${ctx.id}): ${skipped} x-axis title(s) omitted where the columns are too narrow; use xTitle.show "panel" or a shorter xTitle.text.`);
    }
    if (titles.length > 0) {
      const tg = g.group({ class: "x-title" });
      const ty = ctx.y.height + footerHeight(ctx.theme) + TEXT_ASCENT * ctx.theme.fontSize;
      for (const t of titles) tg.text(t.x, ty, t.text, { "text-anchor": "middle" });
    }
  },
};
