// Full pipeline — SPEC.md §5: resolve → transforms → selection → layout → panels → SVG.
// Pure: same inputs → identical SVG string. Problems become warnings.

import { autoGroupSpans, groupRowHeight, groupSpans, groupSpansExtent, layoutLabels, renderGroupHeaders, type HeaderColumn } from "./layout/header.js";
import { ageAtDepth, ageDepthPairs, ageInversionAt, samplePosition, type AxisKind } from "./layout/ageDepth.js";
import { computeLayout, type FitState, type Rect } from "./layout/layout.js";
import { makeYScale, referenceRange, scaleKey, type YScale } from "./layout/scales.js";
import { columnMax, selectVariables } from "./layout/select.js";
import { makeTheme } from "./layout/theme.js";
import { layoutTitle, renderTitle } from "./layout/title.js";
import { applyGroups } from "./model/groups.js";
import { resolveSpec, type ResolvedSpec } from "./model/resolve.js";
import type { Preset, Spec } from "./model/spec.js";
import type { Dataset } from "./model/types.js";
import type { ColumnLayout, PanelContext, PanelData } from "./panels/types.js";
import { overlays, panels, transforms } from "./registry.js";
import { specHash } from "./io/hash.js";
import { svgDocument, translate } from "./render/svg.js";
import { mergedTwice } from "./transforms/merge.js";
import { LINDEN_VERSION } from "./version.js";

export interface RenderResult {
  svg: string;
  warnings: string[];
  /** Adjustments made to fit the page (e.g. "minWidth reduced from 4 to 2.6 mm …"); not problems. */
  info: string[];
  /** Where things were drawn, for hit-testing and direct manipulation in the app (no DOM needed). */
  layout: DiagramLayout;
}

export interface PanelLayout {
  index: number;
  type: string;
  /** Page mm: the panel's width, from the top of the header band to the bottom of the footer band. */
  box: Rect;
  /** Column geometry (panels with columns only), x relative to the panel. */
  columns: ColumnLayout[];
}

/** Layout metadata of a render, all in page mm (SPEC §5.1). */
export interface DiagramLayout {
  page: { width: number; height: number };
  margin: { top: number; right: number; bottom: number; left: number };
  /** Plot area: x = first panel's left edge, width = panels incl. gaps, height = y-scale range. */
  plot: Rect;
  headerHeight: number;
  footerHeight: number;
  /** Global x factor (mm per %): spec value before fitting and the one used. */
  xScale: { natural: number; used: number };
  /** Page width left before fitting would start; 0 once fitted, negative if the diagram does not fit. */
  slack: number;
  panelGap: number;
  panels: PanelLayout[];
  /** Shared y scale in primary-axis units (depth or age): domain[0] at the plot top unless reverse is false. */
  y: { domain: [number, number]; reverse: boolean; primary: AxisKind };
  /** Distinct sample depths of the plotted datasets, ascending. */
  depths: number[];
}

function applyTransforms(datasets: readonly Dataset[], rs: ResolvedSpec, warn: (m: string) => void): Map<string, Dataset> {
  const byId = new Map<string, Dataset>();
  for (const ds of datasets) {
    if (byId.has(ds.id)) warn(`Duplicate dataset id "${ds.id}"; the first one is used.`);
    else byId.set(ds.id, ds);
  }
  // Effective groups and assignments first, so sums in the transforms see them.
  for (const [id, ds] of byId) {
    const entry = rs.datasets.find((e) => e.dataset === id);
    byId.set(id, applyGroups(ds, entry?.groups ?? [], entry?.assignments ?? {}, warn));
  }
  for (const entry of rs.datasets) {
    let ds = byId.get(entry.dataset);
    if (!ds) {
      warn(`Dataset "${entry.dataset}" not found.`);
      continue;
    }
    for (const id of mergedTwice(entry.transforms)) warn(`Variable "${id}" is merged more than once in dataset "${entry.dataset}".`);
    let percentDone = false;
    for (const t of entry.transforms) {
      if (!transforms.has(t.type)) {
        warn(`Unknown transform "${t.type}"; skipped.`);
        continue;
      }
      if (t.type === "merge" && percentDone) {
        warn(`merge "${t.id}" comes after a percent transform; merges must run first so merged taxa share the same sum. Merge skipped.`);
        continue;
      }
      if (t.type === "percent") percentDone = true;
      const ctx = { sums: entry.sums, scales: entry.scales, warn, ...(entry.outsideSum ? { outsideSum: entry.outsideSum } : {}) };
      ds = transforms.get(t.type).apply(ds, t, ctx);
    }
    for (const id of entry.order) {
      if (!ds.variables.some((v) => v.id === id)) warn(`Order list of dataset "${entry.dataset}": unknown variable "${id}".`);
    }
    byId.set(ds.id, ds);
  }
  return byId;
}

/** Dataset for the y axis (units, ages): first spec dataset with ages, else the first available. */
function axisDataset(byId: Map<string, Dataset>, rs: ResolvedSpec): Dataset | undefined {
  const ordered = [...rs.datasets.map((d) => byId.get(d.dataset)), ...byId.values()].filter(
    (d): d is Dataset => d !== undefined,
  );
  return ordered.find((d) => d.samples.some((s) => s.age !== undefined)) ?? ordered[0];
}

/** Datasets the y range comes from: those of the taxonCurves panels, else all. */
function plottedDatasets(rs: ResolvedSpec, data: (PanelData | undefined)[], byId: Map<string, Dataset>): Dataset[] {
  const used = rs.panels.flatMap((p, i) => (p.type === "taxonCurves" && data[i] ? [data[i]!.dataset] : []));
  return used.length ? used : [...byId.values()];
}

/**
 * The primary y axis actually used: "age" needs sample ages in the plotted datasets (else depth, with
 * a warning). On an age axis, samples without an age are left out and ages that decrease with depth
 * are reported.
 */
function primaryAxis(rs: ResolvedSpec, plotted: readonly Dataset[], warn: (m: string) => void): AxisKind {
  if (rs.yAxis.primary !== "age") return "depth";
  if (!plotted.some((d) => d.samples.some((s) => s.age !== undefined))) {
    warn('Primary y axis "age" needs sample ages (an age column or an imported age–depth model); depth used.');
    return "depth";
  }
  for (const ds of plotted) {
    const missing = ds.samples.filter((s) => s.age === undefined).length;
    if (missing > 0) warn(`Dataset "${ds.id}": ${missing} sample(s) without an age are not drawn on the age axis.`);
    const at = ageInversionAt(ageDepthPairs(ds));
    if (at !== undefined) warn(`Dataset "${ds.id}": ages do not increase with depth (at ${at} ${ds.depthUnit}); samples are placed by their ages.`);
  }
  return "age";
}

function yDomain(rs: ResolvedSpec, plotted: readonly Dataset[], primary: AxisKind, warn: (m: string) => void): [number, number] {
  if (rs.yAxis.range) return rs.yAxis.range;
  const values = plotted.flatMap((d) => d.samples.map((s) => samplePosition(s, primary))).filter((v): v is number => v !== undefined);
  if (values.length === 0) {
    warn("No samples to plot; y-axis range set to 0–1.");
    return [0, 1];
  }
  return [Math.min(...values), Math.max(...values)];
}

/**
 * One ratio per scale family (kind|unit) over every selected variable: 100 / reference range, so
 * percentages keep xScale and e.g. counts get their own scale. Presence has no scale.
 */
function commonScaleRatios(data: readonly (PanelData | undefined)[]): Map<string, number> {
  const max = new Map<string, { kind: string; max: number }>();
  for (const d of data) {
    for (const j of d?.variables ?? []) {
      const v = d!.dataset.variables[j]!;
      if (v.kind === "presence") continue;
      const key = scaleKey(v);
      const m = columnMax(d!.dataset, j);
      max.set(key, { kind: v.kind, max: Math.max(m, max.get(key)?.max ?? 0) });
    }
  }
  return new Map([...max].map(([key, { kind, max: m }]) => [key, 100 / referenceRange(kind, m)]));
}

/** Display name of a group: from the first dataset (in spec order) that has it. */
function groupName(rs: ResolvedSpec, byId: Map<string, Dataset>, id: string): string {
  const ordered = [...rs.datasets.map((d) => byId.get(d.dataset)), ...byId.values()].filter((d): d is Dataset => d !== undefined);
  for (const ds of ordered) {
    const g = ds.groups.find((x) => x.id === id);
    if (g) return g.name;
  }
  return id;
}

/**
 * Datasets as the diagram uses them: effective groups and assignments applied, then transforms.
 * Same order as `datasets`; e.g. for the app's variable list.
 */
export function prepareDatasets(datasets: readonly Dataset[], spec: Spec, presets: readonly Preset[] = []): { datasets: Dataset[]; warnings: string[] } {
  const warnings = new Set<string>();
  const warn = (m: string) => {
    warnings.add(m);
  };
  const resolved = resolveSpec(spec, presets);
  const byId = applyTransforms(datasets, resolved.spec, warn);
  const out = [...new Set(datasets.map((d) => d.id))].map((id) => byId.get(id)!);
  return { datasets: out, warnings: [...warnings] };
}

/** Text of the SVG <metadata> element: generator version and the hash of the input spec. */
export function svgMetadata(spec: Spec): string {
  return `generator: Linden ${LINDEN_VERSION}; spec-sha256: ${specHash(spec)}`;
}

export function render(datasets: readonly Dataset[], spec: Spec, presets: readonly Preset[] = []): RenderResult {
  // A Set keeps first-seen order and drops repeats (measure runs many times while fitting).
  const warnings = new Set<string>();
  const warn = (m: string) => {
    warnings.add(m);
  };

  const resolved = resolveSpec(spec, presets);
  resolved.warnings.forEach(warn);
  const rs = resolved.spec;
  const byId = applyTransforms(datasets, rs, warn);
  // Curve styles for variables / groups no dataset has (typos) do nothing.
  const all = [...byId.values()];
  for (const id of Object.keys(spec.curveStyles ?? {})) {
    if (!all.some((d) => d.variables.some((v) => v.id === id))) warn(`curveStyles: "${id}" is not a variable of any dataset.`);
  }
  for (const id of Object.keys(spec.groupStyles ?? {})) {
    if (!all.some((d) => d.groups.some((g) => g.id === id))) warn(`groupStyles: "${id}" is not a group of any dataset.`);
  }
  const theme = makeTheme(rs.page, rs.style, rs.xScale);
  const axisDs = axisDataset(byId, rs);

  const data: (PanelData | undefined)[] = rs.panels.map((p) => {
    if (p.type === "yAxis") return axisDs ? { dataset: axisDs, variables: [] } : undefined;
    const ds = byId.get(p.dataset);
    if (!ds) {
      warn(`Panel dataset "${p.dataset}" not found.`);
      return undefined;
    }
    const order = rs.datasets.find((e) => e.dataset === p.dataset)?.order ?? [];
    return { dataset: ds, variables: selectVariables(ds, p.variables, warn, order) };
  });

  const plotted = plottedDatasets(rs, data, byId);
  const primary = primaryAxis(rs, plotted, warn);
  const yAxis = { ...rs.yAxis, primary };
  const domain = yDomain(rs, plotted, primary, warn);
  const scaleRatios = commonScaleRatios(data);
  const provisionalHeader = { fontSize: theme.fontSize, angle: rs.headerBand.angle };
  const ctxFor = (i: number, fit: FitState, y: YScale, header = provisionalHeader): PanelContext => ({
    id: `panel-${i}-${rs.panels[i]!.type}`,
    spec: rs.panels[i]!,
    data: data[i],
    y,
    yAxis,
    xScale: fit.xScale,
    scaleRatios,
    fit,
    page: rs.page,
    theme,
    header,
    analyses: {},
    warn,
  });

  // Measuring never depends on the y range's height, so a provisional scale is enough.
  const provisionalY = makeYScale(domain, 100, rs.yAxis.reverse);
  // Overlays give depths (zone boundaries); on an age axis they sit at the interpolated age.
  const pairs = ageDepthPairs(axisDs);
  const toAxis = (depth: number) => (primary === "depth" ? depth : ageAtDepth(pairs, depth));
  const overlayCtx = (i: number, y: YScale, width: number) => ({ spec: rs.overlays[i]!, y, theme, width, toAxis, warn });
  const extraRight = rs.overlays.reduce(
    (m, o, i) => Math.max(m, overlays.get(o.type).measure(overlayCtx(i, provisionalY, 0)).width),
    0,
  );

  // Shared header band: every panel's labelled columns, x from the plot's left edge.
  const columnsAt = (fit: FitState): HeaderColumn[] => {
    const out: HeaderColumn[] = [];
    let x = 0;
    rs.panels.forEach((p, i) => {
      const panel = panels.get(p.type);
      const ctx = ctxFor(i, fit, provisionalY);
      const groups = data[i]?.dataset.groups ?? [];
      for (const c of panel.columns?.(ctx) ?? []) {
        const name = groups.find((g) => g.id === c.group)?.name;
        out.push({ ...c, x: x + c.x, panel: i, ...(name !== undefined ? { groupName: name } : {}) });
      }
      x += panel.measure(ctx).width + theme.panelGap;
    });
    return out;
  };
  const labelFontSize = rs.style.fonts.labels.size;
  const labelOptions = {
    angle: rs.headerBand.angle,
    fontSize: labelFontSize,
    minFontSize: rs.headerBand.minFontSize,
    height: rs.headerBand.height,
    step: theme.headerFontStep,
    thickness: theme.labelThickness,
  };
  const nameOf = (id: string) => groupName(rs, byId, id);
  // Group headers (§4): explicit `headers`, else one per group; none when switched off.
  const spansAt = (cols: readonly HeaderColumn[], w: (m: string) => void) =>
    !rs.groupHeaders.show ? [] : rs.headers.length > 0 ? groupSpans(rs.headers, cols, nameOf, theme, w) : autoGroupSpans(cols, theme, w);
  const grouped = data.some((d) => d?.variables.some((j) => d.dataset.variables[j]!.group !== undefined));
  const groupRow = rs.groupHeaders.show && (rs.headers.length > 0 || grouped) ? groupRowHeight(theme) : 0;
  // Label font capped by the fit (step c); the label layout may go smaller to avoid collisions.
  const headerAt = (fit: FitState) => {
    const cols = columnsAt(fit);
    const labels = layoutLabels(cols, { ...labelOptions, fontSize: Math.min(labelOptions.fontSize, fit.labelFont) });
    const height = cols.length > 0 ? theme.headerGap + labels.height + groupRow : groupRow;
    const groups = groupSpansExtent(spansAt(cols, () => undefined), theme);
    return { cols, labels, height, left: Math.min(labels.left, groups.left), right: Math.max(labels.right, groups.right) };
  };

  const minWidths = rs.panels.flatMap((p) =>
    p.type === "taxonCurves" ? [p.style.minWidth, ...Object.values(p.overrides).flatMap((o) => (o.minWidth === undefined ? [] : [o.minWidth]))] : [],
  );
  // Title band (§6): its height is reserved above the header band; too wide → smaller, then a warning.
  const title = layoutTitle(rs.title, rs.page.width - theme.margin.left - theme.margin.right, labelFontSize, theme.headerFontStep);
  title.warnings.forEach(warn);
  const measureAt = (i: number, fit: FitState) => panels.get(rs.panels[i]!.type).measure(ctxFor(i, fit, provisionalY));
  const layout = computeLayout(
    rs.page,
    theme,
    rs.panels.map((_, i) => (fit: FitState) => measureAt(i, fit)),
    { extraRight, header: headerAt, labelFont: { base: labelFontSize, min: rs.headerBand.minFontSize }, minWidths, titleHeight: title.height },
  );
  layout.warnings.forEach(warn);
  // Ink between adjacent panels (x-axis titles, edge tick labels) must not meet.
  const measured = rs.panels.map((_, i) => measureAt(i, layout.fit));
  measured.slice(1).forEach((m, k) => {
    const overlap = (measured[k]!.overhang?.right ?? 0) + (m.overhang?.left ?? 0) - theme.panelGap;
    if (overlap > 0.05) {
      warn(`Panels ${k} and ${k + 1}: x-axis titles or tick labels overlap by ${Math.round(overlap * 10) / 10} mm; shorten the x-axis title (style.xTitle.text) or hide it.`);
    }
  });
  const header = headerAt(layout.fit);
  header.labels.warnings.forEach(warn);
  const spans = spansAt(header.cols, warn);
  const labelStyle = { fontSize: header.labels.fontSize, angle: header.labels.angle };

  const y = makeYScale(domain, layout.plot.height, rs.yAxis.reverse);
  const svg = svgDocument(rs.page.width, rs.page.height, (root) => {
    if (theme.background !== null) root.rect(0, 0, rs.page.width, rs.page.height, { id: "background", fill: theme.background });
    const body = root.group({ fill: theme.textColour, "font-family": theme.fontFamily, "font-size": theme.fontSize });
    renderTitle(body, title, rs.title?.align ?? "left", theme.margin.top, layout.plot, rs.page, theme);
    rs.panels.forEach((p, i) => {
      const ctx = ctxFor(i, layout.fit, y, labelStyle);
      const g = body.group({ id: ctx.id, transform: translate(layout.panels[i]!.x, layout.plot.y) });
      panels.get(p.type).render(ctx, g);
    });
    if (spans.length > 0) {
      const g = body.group({ id: "headers", transform: translate(layout.plot.x, layout.plot.y) });
      renderGroupHeaders(g, spans, -(header.height - groupRow), theme, rs.groupHeaders.line);
    }
    rs.overlays.forEach((o, i) => {
      const g = body.group({ id: `overlay-${i}-${o.type}`, transform: translate(layout.plot.x, layout.plot.y) });
      overlays.get(o.type).render(overlayCtx(i, y, layout.panelsWidth), g);
    });
  }, svgMetadata(spec));

  const meta: DiagramLayout = {
    page: { width: rs.page.width, height: rs.page.height },
    margin: theme.margin,
    plot: layout.plot,
    headerHeight: layout.headerHeight,
    footerHeight: layout.footerHeight,
    xScale: { natural: rs.xScale, used: layout.xScale },
    slack: layout.slack,
    panelGap: theme.panelGap,
    panels: rs.panels.map((p, i) => ({
      index: i,
      type: p.type,
      box: {
        x: layout.panels[i]!.x,
        y: layout.plot.y - layout.headerHeight,
        width: layout.panels[i]!.width,
        height: layout.headerHeight + layout.plot.height + layout.footerHeight,
      },
      columns: panels.get(p.type).columnLayout?.(ctxFor(i, layout.fit, y, labelStyle)) ?? [],
    })),
    y: { domain, reverse: rs.yAxis.reverse, primary },
    depths: [...new Set(plotted.flatMap((d) => d.samples.map((s) => s.depth)))].sort((a, b) => a - b),
  };

  return { svg, warnings: [...warnings], info: [...title.info, ...layout.info], layout: meta };
}
