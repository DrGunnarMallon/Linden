// Panel and overlay interfaces — see SPEC.md §5.1.

import type { HeaderColumn } from "../layout/header.js";
import type { YScale } from "../layout/scales.js";
import type { Theme } from "../layout/theme.js";
import type { ResolvedPage, ResolvedYAxis } from "../model/defaults.js";
import type { ResolvedPanel } from "../model/resolve.js";
import type { GroupSpec, OverlaySpec } from "../model/spec.js";
import type { Dataset } from "../model/types.js";
import type { SvgGroup } from "../render/svg.js";

export interface PanelData {
  /** Dataset after transforms. */
  dataset: Dataset;
  /** Selected variable indices in display order. */
  variables: number[];
}

export interface PanelContext {
  /** SVG id of the panel group, e.g. "panel-1-taxonCurves"; prefix for child ids. */
  id: string;
  spec: ResolvedPanel;
  data: PanelData | undefined;
  y: YScale;
  /** Resolved y-axis settings (ticks, secondary axis). */
  yAxis: ResolvedYAxis;
  /** Global common x-scale in mm per data unit (after any shrinking). */
  xScale: number;
  page: ResolvedPage;
  theme: Theme;
  /** Group display metadata (colours) from the resolved spec. */
  groups: GroupSpec[];
  /** Taxon label font size (mm) and angle, shared by all panels; final only in render(). */
  header: { fontSize: number; angle: number };
  analyses: Record<string, unknown>;
  warn(message: string): void;
}

export interface PanelMeasure {
  width: number;
  headerHeight: number;
}

export interface Panel {
  type: string;
  /** Natural width in mm; must not depend on ctx.y.height. Width may grow with ctx.xScale. */
  measure(ctx: PanelContext): PanelMeasure;
  /** Draws into a group whose origin is the panel's top-left plot corner (header at y < 0). */
  render(ctx: PanelContext, g: SvgGroup): void;
  /** Labelled columns (x relative to the panel) for the shared header band; omit if none. */
  columns?(ctx: PanelContext): HeaderColumn[];
}

export interface OverlayContext {
  spec: OverlaySpec;
  y: YScale;
  theme: Theme;
  /** Width of all panels, from the left plot edge. */
  width: number;
  warn(message: string): void;
}

export interface Overlay {
  type: string;
  /** Extra width reserved right of the panels (e.g. for labels). */
  measure(ctx: OverlayContext): { width: number };
  /** Origin = top-left plot corner of the first panel. */
  render(ctx: OverlayContext, g: SvgGroup): void;
}
