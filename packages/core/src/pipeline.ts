// Full pipeline — SPEC.md §5: resolve → transforms → selection → layout → panels → SVG.
// Pure: same inputs → identical SVG string. Problems become warnings.

import { computeLayout } from "./layout/layout.js";
import { makeYScale, type YScale } from "./layout/scales.js";
import { selectVariables } from "./layout/select.js";
import { makeTheme } from "./layout/theme.js";
import { resolveSpec, type ResolvedSpec } from "./model/resolve.js";
import type { Preset, Spec } from "./model/spec.js";
import type { Dataset } from "./model/types.js";
import type { PanelContext, PanelData } from "./panels/types.js";
import { overlays, panels, transforms } from "./registry.js";
import { svgDocument, translate } from "./render/svg.js";

export interface RenderResult {
  svg: string;
  warnings: string[];
}

function applyTransforms(datasets: readonly Dataset[], rs: ResolvedSpec, warn: (m: string) => void): Map<string, Dataset> {
  const byId = new Map<string, Dataset>();
  for (const ds of datasets) {
    if (byId.has(ds.id)) warn(`Duplicate dataset id "${ds.id}"; the first one is used.`);
    else byId.set(ds.id, ds);
  }
  for (const entry of rs.datasets) {
    let ds = byId.get(entry.dataset);
    if (!ds) {
      warn(`Dataset "${entry.dataset}" not found.`);
      continue;
    }
    for (const t of entry.transforms) {
      if (!transforms.has(t.type)) {
        warn(`Unknown transform "${t.type}"; skipped.`);
        continue;
      }
      const ctx = { sums: entry.sums, warn, ...(entry.outsideSum ? { outsideSum: entry.outsideSum } : {}) };
      ds = transforms.get(t.type).apply(ds, t, ctx);
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
    return { dataset: ds, variables: selectVariables(ds, p.variables, warn) };
  });

  const domain = yDomain(rs, data, byId, warn);
  const ctxFor = (i: number, xScale: number, y: YScale): PanelContext => ({
    id: `panel-${i}-${rs.panels[i]!.type}`,
    spec: rs.panels[i]!,
    data: data[i],
    y,
    yAxis: rs.yAxis,
    xScale,
    page: rs.page,
    theme,
    groups: rs.groups,
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
  const layout = computeLayout(
    rs.page,
    theme,
    rs.panels.map((p, i) => (xScale: number) => panels.get(p.type).measure(ctxFor(i, xScale, provisionalY))),
    extraRight,
  );
  layout.warnings.forEach(warn);

  const y = makeYScale(domain, layout.plot.height, rs.yAxis.reverse);
  const svg = svgDocument(rs.page.width, rs.page.height, (root) => {
    const body = root.group({ "font-family": theme.fontFamily, "font-size": theme.fontSize });
    rs.panels.forEach((p, i) => {
      const ctx = ctxFor(i, layout.xScale, y);
      const g = body.group({ id: ctx.id, transform: translate(layout.panels[i]!.x, layout.plot.y) });
      panels.get(p.type).render(ctx, g);
    });
    rs.overlays.forEach((o, i) => {
      const g = body.group({ id: `overlay-${i}-${o.type}`, transform: translate(layout.plot.x, layout.plot.y) });
      overlays.get(o.type).render(overlayCtx(i, y, layout.panelsWidth), g);
    });
  });

  return { svg, warnings: [...warnings] };
}
