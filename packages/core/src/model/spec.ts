// Diagram spec and preset schemas — see SPEC.md §4 and §8.
// Only the M1 subset. No defaults here: defaults are applied by resolveSpec (core → preset → spec → override).

import { z } from "zod/v4";

export const SPEC_VERSION = 4;

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
});

export const PercentTransformSchema = z.strictObject({
  type: z.literal("percent"),
  sum: z.string(),
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

export const DatasetEntrySchema = z.strictObject({
  dataset: z.string(),
  transforms: z.array(TransformSpecSchema).optional(),
  sums: z.record(z.string(), SumSchema).optional(),
  scales: z.record(z.string(), ScaleSchema).optional(),
  outsideSum: OutsideSumSchema.optional(),
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
});

export const TaxonCurvesStyleSchema = z.strictObject({
  mode: z.enum(["silhouette", "bars", "line", "linePoints"]).optional(),
  /** "group" = group colour, otherwise a CSS colour. */
  fill: z.string().optional(),
  exaggeration: z.number().min(0).optional(),
  commonScale: z.boolean().optional(),
  minWidth: z.number().min(0).optional(),
  /** Draw "+" for non-zero values below this; 0 = off. */
  plusBelow: z.number().min(0).optional(),
  /** Extra space in mm between adjacent columns of different groups. */
  groupGap: z.number().min(0).optional(),
  xTicks: XTicksSchema.optional(),
  /** Mark for kind "presence" (value > 0): a dot or a full-width bar. */
  presence: z.enum(["dot", "bar"]).optional(),
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
  /** Per-variable style overrides (panel-level layout keys excluded). */
  overrides: z.record(z.string(), TaxonCurvesStyleSchema.omit({ groupGap: true })).optional(),
  width: z.number().positive().optional(),
});

export const PanelSchema = z.discriminatedUnion("type", [YAxisPanelSchema, TaxonCurvesPanelSchema]);

export const ZonesOverlaySchema = z.strictObject({
  type: z.literal("zones"),
  manual: z.array(z.strictObject({ depth: z.number(), label: z.string().optional() })),
});

export const OverlaySchema = z.discriminatedUnion("type", [ZonesOverlaySchema]);

/** Spec-level group: defines a new group or renames / recolours / reorders an existing one. */
export const SpecGroupSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().optional(),
  colour: z.string().optional(),
  /** Lower first; columns follow group order. */
  order: z.number().optional(),
});

/** Taxon label band above the columns. */
export const HeaderBandSchema = z.strictObject({
  /** Label angle in degrees from horizontal. */
  angle: z.number().min(10).max(90).optional(),
  /** Smallest label font size (pt) before the band grows. */
  minFontSize: z.number().positive().optional(),
  /** Label band height in mm; null = fit the labels. */
  height: z.number().positive().nullable().optional(),
});

/** Group header: a bracket with a label spanning the matching columns. */
export const HeaderSchema = z.strictObject({
  /** Defaults to the names of the spanned groups. */
  label: z.string().optional(),
  spans: z.strictObject({
    groups: z.array(z.string()).optional(),
    ids: z.array(z.string()).optional(),
  }),
});

export const SpecSchema = z.strictObject({
  specVersion: z.literal(SPEC_VERSION),
  preset: z.string().optional(),
  page: PageSchema.optional(),
  yAxis: YAxisSchema.optional(),
  groups: z.array(SpecGroupSchema).optional(),
  datasets: z.array(DatasetEntrySchema).optional(),
  panels: z.array(PanelSchema),
  overlays: z.array(OverlaySchema).optional(),
  headerBand: HeaderBandSchema.optional(),
  headers: z.array(HeaderSchema).optional(),
});

export const GroupSpecSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  colour: z.string().optional(),
  order: z.number(),
});

export const PresetSchema = z.strictObject({
  presetVersion: z.literal(1),
  name: z.string(),
  description: z.string().optional(),
  page: PageSchema.optional(),
  yAxis: YAxisSchema.optional(),
  headerBand: HeaderBandSchema.optional(),
  groups: z.array(GroupSpecSchema).optional(),
  sums: z.record(z.string(), SumSchema).optional(),
  scales: z.record(z.string(), ScaleSchema).optional(),
  outsideSum: OutsideSumSchema.optional(),
  /** Default transforms for dataset entries that do not list their own. */
  transforms: z.array(TransformSpecSchema).optional(),
  selectionDefaults: SelectionSchema.optional(),
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
export type XTicks = z.infer<typeof XTicksSchema>;
export type HeaderBandSpec = z.infer<typeof HeaderBandSchema>;
export type HeaderSpec = z.infer<typeof HeaderSchema>;
export type PanelSpec = z.infer<typeof PanelSchema>;
export type YAxisPanelSpec = z.infer<typeof YAxisPanelSchema>;
export type TaxonCurvesPanelSpec = z.infer<typeof TaxonCurvesPanelSchema>;
export type OverlaySpec = z.infer<typeof OverlaySchema>;
export type GroupSpec = z.infer<typeof GroupSpecSchema>;
