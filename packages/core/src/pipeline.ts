// Full pipeline — SPEC.md §5: resolve → transforms → selection → layout → panels → SVG.
// Pure: same inputs → identical SVG string. Problems become warnings.

import { autoGroupSpans, groupRowHeight, groupSpans, groupSpansExtent, layoutLabels, renderGroupHeaders, type HeaderColumn } from "./layout/header.js";
import { computeLayout, type FitState } from "./layout/layout.js";
import { makeYScale, referenceRange, scaleKey, type YScale } from "./layout/scales.js";
import { columnMax, selectVariables } from "./layout/select.js";
import { makeTheme } from "./layout/theme.js";
import { applyGroups } from "./model/groups.js";
import { resolveSpec, type ResolvedSpec } from "./model/resolve.js";
import type { Preset, Spec } from "./model/spec.js";
import type { Dataset } from "./model/types.js";
import type { PanelContext, PanelData } from "./panels/types.js";
import { overlays, panels, transforms } from "./registry.js";
import { svgDocument, translate } from "./render/svg.js";
import { mergedTwice } from "./transforms/merge.js";

export interface RenderResult {
  svg: string;
  warnings: string[];
  /** Adjustments made to fit the page (e.g. "minWidth reduced from 4 to 2.6 mm …"); not problems. */
  info: string[];
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

function yDomain(rs: ResolvedSpec, data: (PanelData | undefined)[], byId: Map<string, Dataset>, warn: (m: string) => void): [number, number] {
  if (rs.yAxis.range) return rs.yAxis.range;
  const used = rs.panels.flatMap((p, i) => (p.type === "taxonCurves" && data[i] ? [data[i]!.dataset] : []));
  const sources = used.length ? used : [...byId.values()];
  const depths = sources.flatMap((d) => d.samples.map((s) => s.depth));
  if (depths.length === 0) {
    warn("No samples to plot; y-axis range set to 0–1.");
    return [0, 1];
  }
  return [Math.min(...depths), Math.max(...depths)];
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
  const theme = makeTheme(rs.page);
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

  const domain = yDomain(rs, data, byId, warn);
  const scaleRatios = commonScaleRatios(data);
  const provisionalHeader = { fontSize: theme.fontSize, angle: rs.headerBand.angle };
  const ctxFor = (i: number, fit: FitState, y: YScale, header = provisionalHeader): PanelContext => ({
    id: `panel-${i}-${rs.panels[i]!.type}`,
    spec: rs.panels[i]!,
    data: data[i],
    y,
    yAxis: rs.yAxis,
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
  const overlayCtx = (i: number, y: YScale, width: number) => ({ spec: rs.overlays[i]!, y, theme, width, warn });
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
  const labelOptions = {
    angle: rs.headerBand.angle,
    fontSize: rs.page.font.size,
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
  const layout = computeLayout(
    rs.page,
    theme,
    rs.panels.map((p, i) => (fit: FitState) => panels.get(p.type).measure(ctxFor(i, fit, provisionalY))),
    { extraRight, header: headerAt, labelFont: { base: rs.page.font.size, min: rs.headerBand.minFontSize }, minWidths },
  );
  layout.warnings.forEach(warn);
  const header = headerAt(layout.fit);
  header.labels.warnings.forEach(warn);
  const spans = spansAt(header.cols, warn);
  const labelStyle = { fontSize: header.labels.fontSize, angle: header.labels.angle };

  const y = makeYScale(domain, layout.plot.height, rs.yAxis.reverse);
  const svg = svgDocument(rs.page.width, rs.page.height, (root) => {
    const body = root.group({ "font-family": theme.fontFamily, "font-size": theme.fontSize });
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
  });

  return { svg, warnings: [...warnings], info: layout.info };
}
