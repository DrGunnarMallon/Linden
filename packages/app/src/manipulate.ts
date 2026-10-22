// Direct manipulation in the preview (SPEC §11): hit-testing on core's layout metadata (render().layout,
// page mm) and pure models of a resize or zone drag. The preview draws outlines from these while
// dragging and writes the result into the spec once, on release.

import { PanelSchema, type DiagramLayout, type ResolvedSpec, type Spec } from "@linden/core";
import { setIn } from "./form/paths";

/** Snapping grid, mm (also the "mm per 10 %" grid of the x-scale). */
export const SNAP_MM = 0.5;
/** Precision without snapping (Alt), mm. */
const FREE_MM = 0.01;

export interface Box {
  x: number;
  width: number;
}

export interface PanelGeometry extends Box {
  /** Page mm. */
  columns: Box[];
}

/** What dragging a panel's right edge changes in the spec. */
export type ResizeKind =
  /** Global x factor (mm per %): every common-scale column, in every panel, scales together. */
  | "xScale"
  /** taxonCurves style.columnWidth: columns without a common scale. */
  | "columnWidth"
  /** The panel's own width in mm. */
  | "width";

export interface ResizeTarget {
  panel: number;
  kind: ResizeKind;
  /** Value at the start of the drag, as drawn (x-scale: the factor used after fitting). */
  start: number;
}

export interface ResizeResult {
  value: number;
  /** All panels at `value` (page mm). */
  panels: PanelGeometry[];
  /** Why the drag stopped short of the pointer, if it did. */
  limit?: string;
}

const round = (v: number, step: number) => Number((Math.round(v / step) * step).toFixed(6));
const floor = (v: number, step: number) => Number((Math.floor(v / step + 1e-9) * step).toFixed(6));
const fmt = (n: number) => String(Number(n.toFixed(2)));

/** Index of the panel whose box contains the page point (mm), or null. */
export function hitPanel(layout: DiagramLayout, x: number, y: number): number | null {
  const p = layout.panels.find((p) => x >= p.box.x && x <= p.box.x + p.box.width && y >= p.box.y && y <= p.box.y + p.box.height);
  return p ? p.index : null;
}

/** What a click in the preview selects: a curve column, a group header, or the panel itself. */
export type PreviewHit = { kind: "curve"; panel: number; id: string } | { kind: "group"; panel: number; group: string } | { kind: "panel"; panel: number };

export interface HitOptions {
  /** Current group of a column (variable id) of a panel; undefined = ungrouped. */
  groupOf(panel: number, id: string): string | undefined;
  /** Height of the group header row at the top of the header band (mm); 0 = no group headers. */
  groupRow: number;
  /** Taxon label angle (°, headerBand.angle): labels rise to the right from their column's centre. */
  labelAngle: number;
}

/** Runs of adjacent columns of one group within a panel (x relative to the panel), as the group headers span them. */
export function groupRuns(layout: DiagramLayout, panel: number, groupOf: HitOptions["groupOf"]): { group: string; x0: number; x1: number }[] {
  const runs: { group: string; x0: number; x1: number }[] = [];
  let prev: string | undefined;
  for (const c of layout.panels[panel]?.columns ?? []) {
    const g = groupOf(panel, c.id);
    const last = runs[runs.length - 1];
    if (g !== undefined && g === prev && last) last.x1 = c.x + c.width;
    else if (g !== undefined) runs.push({ group: g, x0: c.x, x1: c.x + c.width });
    prev = g;
  }
  return runs;
}

/**
 * What a click at a page point (mm) hits (SPEC §11, hit-testing on layout metadata): in a panel with
 * columns, a column's plot area, axis or rotated label selects that curve and the group header row
 * selects the group under it; anything else in the panel (gaps, other panels) selects the panel.
 */
export function hitPreview(layout: DiagramLayout, x: number, y: number, opts: HitOptions): PreviewHit | null {
  const headerTop = layout.plot.y - layout.headerHeight;
  if (y < layout.plot.y && y > headerTop + opts.groupRow) {
    // Rotated labels rise to the right, often past their panel: follow the label back down to the
    // column it is anchored on (its centre), in whichever panel that is.
    const angle = (Math.min(90, Math.max(1, opts.labelAngle)) * Math.PI) / 180;
    const x0 = x - (layout.plot.y - y) / Math.tan(angle);
    let best: { hit: PreviewHit; d: number } | undefined;
    for (const p of layout.panels) {
      for (const c of p.columns) {
        const d = Math.abs(p.box.x + c.x + c.width / 2 - x0);
        if (d <= Math.max(c.width / 2, 1.5) && (!best || d < best.d)) best = { hit: { kind: "curve", panel: p.index, id: c.id }, d };
      }
    }
    if (best) return best.hit;
  }
  const panel = hitPanel(layout, x, y);
  if (panel === null) return null;
  const p = layout.panels[panel]!;
  const rx = x - p.box.x;
  if (y >= layout.plot.y) {
    const c = p.columns.find((c) => rx >= c.x && rx <= c.x + c.width);
    if (c) return { kind: "curve", panel, id: c.id };
  } else if (y <= headerTop + opts.groupRow) {
    const run = groupRuns(layout, panel, opts.groupOf).find((r) => rx >= r.x0 && rx <= r.x1);
    if (run) return { kind: "group", panel, group: run.group };
  }
  return { kind: "panel", panel };
}

/** Panel types whose schema has a `width` (mm). */
function hasWidth(type: string): boolean {
  return PanelSchema.options.some((o) => o.shape.type.value === type && "width" in o.shape);
}

/** How the selected panel resizes, or null if it cannot. taxonCurves follow the x-scale or their column width. */
export function resizeTarget(rs: ResolvedSpec, layout: DiagramLayout, panel: number): ResizeTarget | null {
  const p = rs.panels[panel];
  const box = layout.panels[panel];
  if (!p || !box) return null;
  if (p.type === "taxonCurves") {
    if (p.style.commonScale) return box.columns.some((c) => c.sizing === "scale") ? { panel, kind: "xScale", start: layout.xScale.used } : null;
    return box.columns.some((c) => c.sizing === "column") ? { panel, kind: "columnWidth", start: p.style.columnWidth } : null;
  }
  return hasWidth(p.type) ? { panel, kind: "width", start: box.box.width } : null;
}

/** Every panel's geometry if the target's value were `v`; panel gaps and column gaps stay. */
export function geometryAt(layout: DiagramLayout, t: ResizeTarget, v: number): PanelGeometry[] {
  const fitted = layout.xScale.used / layout.xScale.natural;
  let x = layout.panels[0]?.box.x ?? layout.plot.x;
  return layout.panels.map((p) => {
    const left = x;
    let width = p.box.width;
    const columns: Box[] = [];
    if (p.columns.length > 0) {
      let cx = 0;
      let prevEnd = 0;
      for (const c of p.columns) {
        cx += c.x - prevEnd; // the gap before this column
        prevEnd = c.x + c.width;
        let w = c.width;
        if (t.kind === "xScale" && c.sizing === "scale") w = Math.max(c.minWidth, c.extent * v);
        if (t.kind === "columnWidth" && c.sizing === "column" && p.index === t.panel) w = Math.max(c.minWidth, v * fitted);
        columns.push({ x: left + cx, width: w });
        cx += w;
      }
      width = cx;
    }
    if (t.kind === "width" && p.index === t.panel) width = v;
    x += width + layout.panelGap;
    return { x: left, width, columns };
  });
}

const totalWidth = (g: readonly PanelGeometry[]) => g.reduce((s, p) => s + p.width, 0);

/** Largest v in [lo, hi] with ok(v), for monotone ok and ok(lo). */
function bisect(ok: (v: number) => boolean, lo: number, hi: number): number {
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (ok(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * Resize so the target panel's right edge goes to `right` (page mm). Snaps to 0.5 mm (x-scale: 0.5 mm
 * per 10 %) unless `snap` is false. Never grows the diagram beyond the page width left before fitting
 * would start (SPEC §6), so the common scale is never broken behind the user's back; says why when it stops.
 */
export function resizeTo(layout: DiagramLayout, t: ResizeTarget, right: number, snap: boolean): ResizeResult {
  const xs = t.kind === "xScale";
  // x-scale in mm per %; its grid is SNAP_MM per 10 %.
  const step = (snap ? SNAP_MM : FREE_MM) / (xs ? 10 : 1);
  const lo = step;
  const hi = xs ? 10 : layout.page.width;
  const geo = (v: number) => geometryAt(layout, t, v);
  const rightAt = (v: number) => {
    const p = geo(v)[t.panel]!;
    return p.x + p.width;
  };
  const base = totalWidth(geo(t.start));
  const room = Math.max(0, layout.slack);
  const fits = (v: number) => totalWidth(geo(v)) - base <= room + 1e-6;
  const max = fits(hi) ? hi : bisect(fits, Math.min(lo, t.start), hi);

  let limit: string | undefined;
  let value: number;
  const smallest = rightAt(lo);
  if (right <= smallest) {
    // Below the smallest size: stop where the panel stops shrinking (columns held at minWidth),
    // rather than collapsing the value to the floor while nothing moves.
    value = bisect((v) => rightAt(v) <= smallest + 1e-6, lo, hi);
    limit = value <= lo + 1e-9 ? "Smallest size." : "Columns are at their minimum width (style.minWidth).";
  } else value = bisect((v) => rightAt(v) <= right, lo, hi);
  if (value > max) {
    value = max;
    limit =
      layout.slack <= 0.05
        ? `The diagram already fills the page width (${fmt(layout.page.width)} mm).`
        : `Limited by the page width: ${fmt(layout.page.width)} mm, margins ${fmt(layout.margin.left)} + ${fmt(layout.margin.right)} mm.`;
  }
  value = round(value, step);
  if (value > max + 1e-9) value = floor(max, step);
  value = Math.max(lo, value);
  const panels = geo(value);
  return limit ? { value, panels, limit } : { value, panels };
}

/** Live readout of a resize value. */
export function resizeLabel(kind: ResizeKind, value: number): string {
  if (kind === "xScale") return `${fmt(value * 10)} mm per 10 %`;
  if (kind === "columnWidth") return `Column width ${fmt(value)} mm`;
  return `Width ${fmt(value)} mm`;
}

/** The spec with the resize applied (one undo step when committed). */
export function applyResize(spec: Spec, t: ResizeTarget, value: number): Spec {
  if (t.kind === "xScale") return setIn(spec, ["xScale"], value);
  if (t.kind === "columnWidth") return setIn(spec, ["panels", t.panel, "style", "columnWidth"], value);
  return setIn(spec, ["panels", t.panel, "width"], value);
}

// ── Zones ──────────────────────────────────────────────────────────────────────

/** Page y (mm) of a depth on the shared y scale. */
export function yOfDepth(layout: DiagramLayout, depth: number): number {
  const [d0, d1] = layout.y.domain;
  const t = (depth - d0) / (d1 - d0 || 1);
  return layout.plot.y + (layout.y.reverse ? t : 1 - t) * layout.plot.height;
}

/** Depth at a page y (mm), inverse of yOfDepth. */
export function depthAtY(layout: DiagramLayout, y: number): number {
  const [d0, d1] = layout.y.domain;
  const t = (y - layout.plot.y) / layout.plot.height;
  return d0 + (layout.y.reverse ? t : 1 - t) * (d1 - d0);
}

export interface ZoneRef {
  overlay: number;
  index: number;
  depth: number;
}

/** Manual zone boundaries of the spec, in drawing order. */
export function manualZones(spec: Spec): ZoneRef[] {
  return (spec.overlays ?? []).flatMap((o, overlay) => (o.type === "zones" ? o.manual.map((z, index) => ({ overlay, index, depth: z.depth })) : []));
}

/** Zone boundary within `tolerance` mm of the page point (across the panels), nearest first. */
export function hitZone(layout: DiagramLayout, spec: Spec, x: number, y: number, tolerance: number): ZoneRef | null {
  if (x < layout.plot.x || x > layout.plot.x + layout.plot.width) return null;
  const [lo, hi] = [Math.min(...layout.y.domain), Math.max(...layout.y.domain)];
  let best: ZoneRef | null = null;
  let bestD = tolerance;
  for (const z of manualZones(spec)) {
    if (z.depth < lo || z.depth > hi) continue;
    const d = Math.abs(yOfDepth(layout, z.depth) - y);
    if (d <= bestD) [best, bestD] = [z, d];
  }
  return best;
}

/** Depth snapped to the nearest midpoint between adjacent samples (unless !snap), kept within the y range. */
export function snapDepth(layout: DiagramLayout, depth: number, snap: boolean): number {
  const [lo, hi] = [Math.min(...layout.y.domain), Math.max(...layout.y.domain)];
  const d = Math.min(hi, Math.max(lo, depth));
  const mids = layout.depths.slice(1).map((v, i) => (layout.depths[i]! + v) / 2);
  if (!snap || mids.length === 0) return Number(d.toFixed(2));
  return mids.reduce((best, m) => (Math.abs(m - d) < Math.abs(best - d) ? m : best));
}

export function applyZoneDepth(spec: Spec, z: ZoneRef, depth: number): Spec {
  return setIn(spec, ["overlays", z.overlay, "manual", z.index, "depth"], depth);
}
