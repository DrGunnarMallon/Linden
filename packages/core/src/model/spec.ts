// Diagram spec and preset schemas — see SPEC.md §4 and §8.
// Only the M1 subset. No defaults here: defaults are applied by resolveSpec (core → preset → spec → override).

import { z } from "zod/v4";

export const SPEC_VERSION = 1;

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

export const TransformSpecSchema = z.discriminatedUnion("type", [PercentTransformSchema]);

export const DatasetEntrySchema = z.strictObject({
  dataset: z.string(),
  transforms: z.array(TransformSpecSchema).optional(),
  sums: z.record(z.string(), SumSchema).optional(),
  outsideSum: OutsideSumSchema.optional(),
});

export const SelectionSchema = z.strictObject({
  ids: z.array(z.string()).optional(),
  groups: z.array(z.string()).optional(),
  minMax: z.number().min(0).optional(),
  order: z
    .union([z.enum(["data", "alphabetical", "weightedAverageDepth", "firstOccurrence"]), z.array(z.string())])
    .optional(),
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
  overrides: z.record(z.string(), TaxonCurvesStyleSchema).optional(),
  width: z.number().positive().optional(),
});

export const PanelSchema = z.discriminatedUnion("type", [YAxisPanelSchema, TaxonCurvesPanelSchema]);

export const ZonesOverlaySchema = z.strictObject({
  type: z.literal("zones"),
  manual: z.array(z.strictObject({ depth: z.number(), label: z.string().optional() })),
});

export const OverlaySchema = z.discriminatedUnion("type", [ZonesOverlaySchema]);

export const SpecSchema = z.strictObject({
  specVersion: z.literal(SPEC_VERSION),
  preset: z.string().optional(),
  page: PageSchema.optional(),
  yAxis: YAxisSchema.optional(),
  datasets: z.array(DatasetEntrySchema).optional(),
  panels: z.array(PanelSchema),
  overlays: z.array(OverlaySchema).optional(),
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
  groups: z.array(GroupSpecSchema).optional(),
  sums: z.record(z.string(), SumSchema).optional(),
  outsideSum: OutsideSumSchema.optional(),
  selectionDefaults: SelectionSchema.optional(),
  // Defaults for panel types not yet in the schema are kept as-is.
  panelDefaults: z
    .object({ taxonCurves: TaxonCurvesStyleSchema.optional() })
    .catchall(z.record(z.string(), z.unknown()))
    .optional(),
});

export type Spec = z.infer<typeof SpecSchema>;
export type Preset = z.infer<typeof PresetSchema>;
export type PageSpec = z.infer<typeof PageSchema>;
export type YAxisSpec = z.infer<typeof YAxisSchema>;
export type DatasetEntry = z.infer<typeof DatasetEntrySchema>;
export type TransformSpec = z.infer<typeof TransformSpecSchema>;
export type PercentTransformParams = z.infer<typeof PercentTransformSchema>;
export type Selection = z.infer<typeof SelectionSchema>;
export type TaxonCurvesStyle = z.infer<typeof TaxonCurvesStyleSchema>;
export type PanelSpec = z.infer<typeof PanelSchema>;
export type YAxisPanelSpec = z.infer<typeof YAxisPanelSchema>;
export type TaxonCurvesPanelSpec = z.infer<typeof TaxonCurvesPanelSchema>;
export type OverlaySpec = z.infer<typeof OverlaySchema>;
export type GroupSpec = z.infer<typeof GroupSpecSchema>;
