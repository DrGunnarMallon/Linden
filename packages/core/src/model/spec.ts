// Diagram spec and preset schemas — see SPEC.md §4 and §8.
// Only the M1 subset. No defaults here: defaults are applied by resolveSpec (core → preset → spec → override).

import { z } from "zod/v4";

export const SPEC_VERSION = 8;
export const PRESET_VERSION = 2;

export const MeasurementKindSchema = z.enum([
  "count",
  "percent",
  "concentration",
  "influx",
  "abundanceClass",
  "presence",
  "volumePercent",
  "continuous",
]);

/** Named ordinal scale: class code (e.g. "3", "D", "+") → plotted value; null = treat as not assessed. */
export const ScaleSchema = z.record(z.string(), z.number().nullable());

export const SumSchema = z.strictObject({
  includeGroups: z.array(z.string()).optional(),
  includeVariables: z.array(z.string()).optional(),
  includeAll: z.boolean().optional(),
});

export const OutsideSumSchema = z.strictObject({
  groups: z.array(z.string()),
  basis: z.enum(["sum", "sumPlusGroup"]),
});

export const PageSchema = z.strictObject({
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  units: z.literal("mm").optional(),
  font: z
    .strictObject({
      family: z.string().optional(),
      size: z.number().positive().optional(),
    })
    .optional(),
});

export const YAxisSchema = z.strictObject({
  primary: z.enum(["depth", "age"]).optional(),
  secondary: z.enum(["depth", "age"]).optional(),
  reverse: z.boolean().optional(),
  /** null = data extent. */
  range: z.tuple([z.number(), z.number()]).nullable().optional(),
  ticks: z
    .strictObject({
      major: z.number().positive().optional(),
      minor: z.number().positive().optional(),
    })
    .optional(),
  /** Axis titles; default from the dataset units ("Depth (cm)", "Age (cal BP)"); "" = no title. */
  titles: z.strictObject({ depth: z.string().optional(), age: z.string().optional() }).optional(),
});

export const PercentTransformSchema = z.strictObject({
  type: z.literal("percent"),
  /** Named sum; omitted = every variable of kind "count" in the dataset. */
  sum: z.string().optional(),
});

/** Sums several variables into one, per sample. Must come before "percent". */
export const MergeTransformSchema = z.strictObject({
  type: z.literal("merge"),
  id: z.string().min(1),
  name: z.string(),
  from: z.array(z.string()).min(1),
  /** Group of the merged variable; default = group of the first source. */
  group: z.string().optional(),
  keepSources: z.boolean().optional(),
});

/**
 * Maps ordinal classes / presence codes to plotted values. Give `scale` (a named scale, or a list:
 * each variable uses the first listed scale containing all of its codes) or an inline `map`.
 */
export const ScaleMapTransformSchema = z.strictObject({
  type: z.literal("scaleMap"),
  scale: z.union([z.string(), z.array(z.string()).min(1)]).optional(),
  map: ScaleSchema.optional(),
  /** Variables of these kinds are mapped; default ["abundanceClass", "presence"]. Ignored if `variables` is given. */
  kinds: z.array(MeasurementKindSchema).optional(),
  variables: z.array(z.string()).optional(),
});

export const TransformSpecSchema = z.discriminatedUnion("type", [PercentTransformSchema, MergeTransformSchema, ScaleMapTransformSchema]);

/** Dataset group: defines a new group or renames / recolours / reorders one from the data (e.g. a CSV group row). */
export const SpecGroupSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().optional(),
  colour: z.string().optional(),
  /** Lower first; columns follow group order. */
  order: z.number().optional(),
});

export const DatasetEntrySchema = z.strictObject({
  dataset: z.string(),
  transforms: z.array(TransformSpecSchema).optional(),
  sums: z.record(z.string(), SumSchema).optional(),
  scales: z.record(z.string(), ScaleSchema).optional(),
  outsideSum: OutsideSumSchema.optional(),
  /** The dataset's groups (user-defined); overlay the data's groups by id, may add empty ones. */
  groups: z.array(SpecGroupSchema).optional(),
  /** variable id → group id; overrides the dataset's group (applied before transforms). */
  assignments: z.record(z.string(), z.string()).optional(),
  /** Explicit column order within each group; unlisted variables follow in the panel's order. */
  order: z.array(z.string()).optional(),
});

export const SelectionSchema = z.strictObject({
  ids: z.array(z.string()).optional(),
  groups: z.array(z.string()).optional(),
  /** Keep only variables of these kinds (after transforms). */
  kinds: z.array(MeasurementKindSchema).optional(),
  minMax: z.number().min(0).optional(),
  order: z
    .union([z.enum(["data", "alphabetical", "weightedAverageDepth", "firstOccurrence"]), z.array(z.string())])
    .optional(),
});

/** Per-column x-axis ticks. */
export const XTicksSchema = z.strictObject({
  /** Tick interval in data units; null = smallest 1–2–5 step at least `minSpacing` mm wide. */
  step: z.number().positive().nullable().optional(),
  /** Minimum distance between ticks in mm (automatic step only). */
  minSpacing: z.number().positive().optional(),
  /** Append the unit to the last tick label, e.g. "40%". */
  unitSuffix: z.boolean().optional(),
});

/** x-axis title under the columns. */
export const XTitleSchema = z.strictObject({
  /** Default from the variables' kind and unit, e.g. "%", "Counts (n/20 cm³)", "Abundance class"; "" = none. */
  text: z.string().optional(),
  /** Once per panel (per run of one scale family), under every column, or not at all. */
  show: z.enum(["panel", "column", "none"]).optional(),
});

// Curve styles — SPEC.md §4 "Curve styles". CurveStyleSchema is the full (resolved) style of one
// curve; the spec stores only partial overrides (CurveStyleOverrideSchema) at each cascade level.
// Colours: a CSS colour or "group" (the variable's group colour); exaggeration.colour may also be
// "curve" (the main curve's colour) and baseline.colour "axis" (the figure's axis colour).
// Line widths: null = the figure's curve line width (baseline: its axis line width).

/** "solid" | "dashed" | "dotted" or a custom dash array in mm. */
export const DashSchema = z.union([z.enum(["solid", "dashed", "dotted"]), z.array(z.number().positive()).min(1)]);

/** Fill pattern for black-and-white figures; angle in degrees, spacing in mm. */
export const FillPatternSchema = z.strictObject({
  type: z.enum(["solid", "hatch", "crosshatch", "dots"]),
  angle: z.number(),
  spacing: z.number().positive(),
});

export const FillSchema = z.strictObject({
  colour: z.string(),
  opacity: z.number().min(0).max(1),
  pattern: FillPatternSchema,
});

export const OutlineSchema = z.strictObject({
  show: z.boolean(),
  colour: z.string(),
  width: z.number().positive().nullable(),
  dash: DashSchema,
});

export const LineStyleSchema = z.strictObject({
  colour: z.string(),
  width: z.number().positive().nullable(),
  dash: DashSchema,
});

/** Point mark at each sample; size = diameter / side in mm. */
export const PointMarkSchema = z.strictObject({
  shape: z.enum(["circle", "square", "triangle", "diamond", "cross"]),
  size: z.number().positive(),
  filled: z.boolean(),
  colour: z.string(),
});

/** Options every curve type has. */
const curveShared = {
  /** Lighter curve at value × factor behind the main one. */
  exaggeration: z.strictObject({
    show: z.boolean(),
    factor: z.number().positive(),
    style: z.enum(["filled", "line"]),
    colour: z.string(),
    opacity: z.number().min(0).max(1),
  }),
  /** Zero line at x = 0 along each run of values. */
  baseline: z.strictObject({
    show: z.boolean(),
    colour: z.string(),
    width: z.number().positive().nullable(),
    dash: DashSchema,
  }),
  /** null values: break the curve ("gap") or join the neighbouring values ("connect"). */
  nulls: z.enum(["gap", "connect"]),
  /** "+" right of non-zero values below the threshold; size in mm. */
  plus: z.strictObject({ show: z.boolean(), threshold: z.number().min(0), size: z.number().positive() }),
  /** Value text right of each value; "{value}" in `format` is replaced by the number. */
  valueLabels: z.strictObject({
    show: z.enum(["off", "all", "aboveThreshold"]),
    threshold: z.number(),
    format: z.string(),
    decimals: z.number().int().min(0).max(6),
  }),
};

const curveLine = { line: LineStyleSchema, interpolation: z.enum(["linear", "step"]) };

export const PolygonCurveSchema = z.strictObject({
  type: z.literal("polygon"),
  ...curveShared,
  filled: z.boolean(),
  fill: FillSchema,
  outline: OutlineSchema,
  /** "step": each sample a block reaching halfway to its neighbours (histogram). */
  shape: z.enum(["linear", "step"]),
});

export const LineCurveSchema = z.strictObject({
  type: z.literal("line"),
  ...curveShared,
  ...curveLine,
  points: PointMarkSchema.extend({ show: z.boolean() }),
});

export const LinePointsCurveSchema = z.strictObject({ type: z.literal("linePoints"), ...curveShared, ...curveLine, points: PointMarkSchema });

export const PointsCurveSchema = z.strictObject({ type: z.literal("points"), ...curveShared, points: PointMarkSchema });

export const BarsCurveSchema = z.strictObject({
  type: z.literal("bars"),
  ...curveShared,
  /** Bar thickness along the depth axis: fixed mm, or a fraction of the local sample spacing. */
  barWidth: z.strictObject({ mode: z.enum(["mm", "fraction"]), value: z.number().positive() }),
  fill: FillSchema,
  outline: OutlineSchema,
  /** Bars are centred on the sample depth. */
  align: z.literal("centre"),
});

/** Presence/absence marks where the value is > 0; size in mm. */
export const PresenceCurveSchema = z.strictObject({
  type: z.literal("presence"),
  ...curveShared,
  presence: z.strictObject({ symbol: z.enum(["dot", "plus", "bar", "square"]), size: z.number().positive(), colour: z.string() }),
});

/** No curve; the column (width, axis, label, value labels) stays. */
export const NoneCurveSchema = z.strictObject({ type: z.literal("none"), ...curveShared });

export const CurveStyleSchema = z.discriminatedUnion("type", [
  PolygonCurveSchema,
  LineCurveSchema,
  LinePointsCurveSchema,
  PointsCurveSchema,
  BarsCurveSchema,
  PresenceCurveSchema,
  NoneCurveSchema,
]);

export const CURVE_TYPES = ["polygon", "line", "linePoints", "points", "bars", "presence", "none"] as const;

/** Every key at every depth optional; objects stay strict. */
function partialDeep(schema: z.ZodType): z.ZodType {
  if (!(schema instanceof z.ZodObject)) return schema;
  const shape = schema.shape as Record<string, z.ZodType>;
  return z.strictObject(Object.fromEntries(Object.keys(shape).map((k) => [k, partialDeep(shape[k]!).optional()])));
}

/**
 * One cascade level (preset, panel, group, variable): options of any type, all optional. Options the
 * resolved type lacks are ignored; a `type` discards inherited options the new type lacks.
 */
export const CurveStyleOverrideSchema = partialDeep(
  z.strictObject({
    type: z.enum(CURVE_TYPES),
    ...curveShared,
    ...PolygonCurveSchema.omit({ type: true }).shape,
    ...BarsCurveSchema.omit({ type: true }).shape,
    ...PresenceCurveSchema.omit({ type: true }).shape,
    // Last, so `points` is the line variant's (with `show`), a superset of the others.
    ...LineCurveSchema.omit({ type: true }).shape,
  }),
) as z.ZodType<CurveStyleOverride>;

export const TaxonCurvesStyleSchema = z.strictObject({
  /** Curve style of every column (cascade level "panel"). */
  curve: CurveStyleOverrideSchema.optional(),
  commonScale: z.boolean().optional(),
  minWidth: z.number().min(0).optional(),
  /** Column width in mm for columns without a common scale (before page fitting). */
  columnWidth: z.number().positive().optional(),
  /** Extra space in mm between adjacent columns of different groups. */
  groupGap: z.number().min(0).optional(),
  xTicks: XTicksSchema.optional(),
  xTitle: XTitleSchema.optional(),
});

export const YAxisPanelSchema = z.strictObject({
  type: z.literal("yAxis"),
  width: z.number().positive().optional(),
});

export const TaxonCurvesPanelSchema = z.strictObject({
  type: z.literal("taxonCurves"),
  dataset: z.string(),
  variables: SelectionSchema.optional(),
  style: TaxonCurvesStyleSchema.optional(),
  /** Per-variable column layout overrides (panel-level keys excluded; curve styles: spec.curveStyles). */
  overrides: z.record(z.string(), TaxonCurvesStyleSchema.omit({ curve: true, groupGap: true, xTitle: true })).optional(),
  width: z.number().positive().optional(),
});

export const PanelSchema = z.discriminatedUnion("type", [YAxisPanelSchema, TaxonCurvesPanelSchema]);

export const ZonesOverlaySchema = z.strictObject({
  type: z.literal("zones"),
  manual: z.array(z.strictObject({ depth: z.number(), label: z.string().optional() })),
});

export const OverlaySchema = z.discriminatedUnion("type", [ZonesOverlaySchema]);

/** Taxon label band above the columns. */
export const HeaderBandSchema = z.strictObject({
  /** Label angle in degrees from horizontal. */
  angle: z.number().min(10).max(90).optional(),
  /** Smallest label font size (pt) before the band grows. */
  minFontSize: z.number().positive().optional(),
  /** Label band height in mm; null = fit the labels. */
  height: z.number().positive().nullable().optional(),
});

/** Group headers above the taxon labels: on/off and line style. */
export const GroupHeadersSchema = z.strictObject({
  show: z.boolean().optional(),
  /** "line" = horizontal line, "bracket" = line with end ticks, "none" = label only. */
  line: z.enum(["line", "bracket", "none"]).optional(),
});

/** Group header: a line with a label spanning the matching columns. */
export const HeaderSchema = z.strictObject({
  /** Defaults to the names of the spanned groups. */
  label: z.string().optional(),
  spans: z.strictObject({
    groups: z.array(z.string()).optional(),
    ids: z.array(z.string()).optional(),
  }),
});

/** Diagram title and subtitle, in a band above the header band. */
export const TitleSchema = z.strictObject({
  text: z.string().optional(),
  subtitle: z.string().optional(),
  align: z.enum(["left", "centre"]).optional(),
  /** Title font size in pt; overrides style.fonts.title.size. */
  size: z.number().positive().optional(),
});

const FontSchema = z.strictObject({ family: z.string().optional(), size: z.number().positive().optional() });

/** The figure's own style (independent of the app theme). Lengths in mm, font sizes in pt. */
export const FigureStyleSchema = z.strictObject({
  /** Page background; null = transparent. Default white. */
  background: z.string().nullable().optional(),
  fonts: z
    .strictObject({
      title: FontSchema.optional(),
      /** Taxon labels, group headers, axis titles, zone labels. */
      labels: FontSchema.optional(),
      ticks: FontSchema.optional(),
    })
    .optional(),
  lineWidths: z.strictObject({ axis: z.number().positive().optional(), curve: z.number().positive().optional() }).optional(),
  tickLength: z.number().min(0).optional(),
  colours: z.strictObject({ axis: z.string().optional(), text: z.string().optional() }).optional(),
});

export const SpecSchema = z.strictObject({
  specVersion: z.literal(SPEC_VERSION),
  preset: z.string().optional(),
  page: PageSchema.optional(),
  title: TitleSchema.optional(),
  style: FigureStyleSchema.optional(),
  /** Global x factor in mm per % before page fitting (other scale families follow); default 0.4. */
  xScale: z.number().positive().optional(),
  yAxis: YAxisSchema.optional(),
  datasets: z.array(DatasetEntrySchema).optional(),
  panels: z.array(PanelSchema),
  overlays: z.array(OverlaySchema).optional(),
  headerBand: HeaderBandSchema.optional(),
  groupHeaders: GroupHeadersSchema.optional(),
  /** Explicit group headers; omitted or empty = one header per group (if groupHeaders.show). */
  headers: z.array(HeaderSchema).optional(),
  /** Curve style per group id (cascade level "group"), in every dataset with that group. */
  groupStyles: z.record(z.string(), CurveStyleOverrideSchema).optional(),
  /** Curve style per variable id (cascade level "variable"). */
  curveStyles: z.record(z.string(), CurveStyleOverrideSchema).optional(),
});

export const PresetSchema = z.strictObject({
  presetVersion: z.literal(PRESET_VERSION),
  name: z.string(),
  description: z.string().optional(),
  page: PageSchema.optional(),
  yAxis: YAxisSchema.optional(),
  headerBand: HeaderBandSchema.optional(),
  scales: z.record(z.string(), ScaleSchema).optional(),
  /** Default transforms for dataset entries that do not list their own. */
  transforms: z.array(TransformSpecSchema).optional(),
  /** Groups are user-defined per dataset, so presets cannot select by group. */
  selectionDefaults: SelectionSchema.omit({ groups: true }).optional(),
  panelDefaults: z.strictObject({ taxonCurves: TaxonCurvesStyleSchema.optional() }).optional(),
});

export type Spec = z.infer<typeof SpecSchema>;
export type Preset = z.infer<typeof PresetSchema>;
export type PageSpec = z.infer<typeof PageSchema>;
export type YAxisSpec = z.infer<typeof YAxisSchema>;
export type DatasetEntry = z.infer<typeof DatasetEntrySchema>;
export type TransformSpec = z.infer<typeof TransformSpecSchema>;
export type PercentTransformParams = z.infer<typeof PercentTransformSchema>;
export type MergeTransformParams = z.infer<typeof MergeTransformSchema>;
export type SpecGroup = z.infer<typeof SpecGroupSchema>;
export type ScaleMapTransformParams = z.infer<typeof ScaleMapTransformSchema>;
export type ScaleSpec = z.infer<typeof ScaleSchema>;
export type Selection = z.infer<typeof SelectionSchema>;
export type TaxonCurvesStyle = z.infer<typeof TaxonCurvesStyleSchema>;
export type CurveStyle = z.infer<typeof CurveStyleSchema>;
export type CurveType = CurveStyle["type"];
export type Dash = z.infer<typeof DashSchema>;
export type FillStyle = z.infer<typeof FillSchema>;
export type PointMark = z.infer<typeof PointMarkSchema>;

type DeepPartial<T> = T extends readonly unknown[] ? T : T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;
type CurveOptions<U> = U extends unknown ? Omit<U, "type"> : never;
type Intersect<U> = (U extends unknown ? (x: U) => void : never) extends (x: infer I) => void ? I : never;
/** One cascade level: any option of any curve type, all optional (see CurveStyleOverrideSchema). */
export type CurveStyleOverride = DeepPartial<Intersect<CurveOptions<CurveStyle>> & { type: CurveType }>;
export type XTicks = z.infer<typeof XTicksSchema>;
export type XTitle = z.infer<typeof XTitleSchema>;
export type TitleSpec = z.infer<typeof TitleSchema>;
export type FigureStyle = z.infer<typeof FigureStyleSchema>;
export type HeaderBandSpec = z.infer<typeof HeaderBandSchema>;
export type HeaderSpec = z.infer<typeof HeaderSchema>;
export type PanelSpec = z.infer<typeof PanelSchema>;
export type YAxisPanelSpec = z.infer<typeof YAxisPanelSchema>;
export type TaxonCurvesPanelSpec = z.infer<typeof TaxonCurvesPanelSchema>;
export type OverlaySpec = z.infer<typeof OverlaySchema>;
export type GroupHeadersSpec = z.infer<typeof GroupHeadersSchema>;
