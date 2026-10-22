// Project bundle (.linden.json) = spec + embedded data — SPEC.md §10.

import { z } from "zod/v4";
import { MeasurementKindSchema, type Spec } from "../model/spec.js";
import type { Dataset } from "../model/types.js";
import { LINDEN_VERSION } from "../version.js";
import { formatPath, parseSpec, type ParseResult } from "./spec.js";

export const BUNDLE_FORMAT = "linden-project";
export const BUNDLE_VERSION = 2;

export interface ProjectBundle {
  spec: Spec;
  /** The data as edited (what is drawn). */
  datasets: Dataset[];
  /**
   * The data as imported (provenance, SPEC §5.4): an immutable snapshot for marking and reverting
   * edited cells; [] for a blank project. serializeProject writes `datasets` when omitted.
   */
  imported?: Dataset[];
}

const VariableSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  kind: MeasurementKindSchema,
  unit: z.string().optional(),
  group: z.string().optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
  codes: z.array(z.string()).optional(),
  scaleLabels: z.array(z.strictObject({ value: z.number(), label: z.string() })).optional(),
  companion: z.strictObject({ errorOf: z.string(), role: z.enum(["lower", "upper", "se", "sd"]) }).optional(),
});

const DatasetSchema = z
  .strictObject({
    id: z.string(),
    name: z.string(),
    depthUnit: z.enum(["cm", "m", "mm"]),
    ageUnit: z.enum(["cal BP", "BP", "CE/BCE", "b2k"]).optional(),
    ageSource: z.string().optional(),
    samples: z.array(
      z.strictObject({
        id: z.string(),
        depth: z.number(),
        age: z.number().optional(),
        ageError: z.tuple([z.number(), z.number()]).optional(),
        label: z.string().optional(),
      }),
    ),
    variables: z.array(VariableSchema),
    groups: z.array(z.strictObject({ id: z.string(), name: z.string(), colour: z.string().optional(), order: z.number() })),
    values: z.array(z.array(z.number().nullable())),
    extra: z
      .strictObject({
        lithology: z
          .array(z.strictObject({ top: z.number(), bottom: z.number(), code: z.string(), description: z.string().optional() }))
          .optional(),
        dates: z
          .array(z.strictObject({ depth: z.number(), label: z.string(), age: z.number().optional(), error: z.number().optional() }))
          .optional(),
        spikes: z
          .array(
            z.strictObject({
              sampleId: z.string(),
              markerCounted: z.number(),
              markerAdded: z.number(),
              sampleVolume: z.number().optional(),
              sampleMass: z.number().optional(),
            }),
          )
          .optional(),
      })
      .optional(),
  })
  .superRefine((ds, ctx) => {
    if (ds.values.length !== ds.samples.length) {
      ctx.addIssue({ code: "custom", path: ["values"], message: `${ds.values.length} rows for ${ds.samples.length} samples` });
    }
    ds.values.forEach((row, i) => {
      if (row.length !== ds.variables.length) {
        ctx.addIssue({ code: "custom", path: ["values", i], message: `${row.length} values for ${ds.variables.length} variables` });
      }
    });
  });

const BundleSchema = z.strictObject({
  format: z.literal(BUNDLE_FORMAT),
  // Version 1 had no `imported`: its datasets were stored as imported.
  bundleVersion: z.union([z.literal(1), z.literal(BUNDLE_VERSION)]),
  generator: z.string().optional(),
  spec: z.unknown(),
  datasets: z.array(DatasetSchema),
  imported: z.array(DatasetSchema).optional(),
});

/**
 * Pretty-printed bundle JSON. Values are written as they are: 0 stays 0, null stays null. Throws on
 * non-finite values, which JSON would silently turn into null ("not assessed").
 */
export function serializeProject(bundle: ProjectBundle): string {
  const imported = bundle.imported ?? bundle.datasets;
  for (const ds of [...bundle.datasets, ...imported]) {
    ds.values.forEach((row, i) =>
      row.forEach((v, j) => {
        if (v !== null && !Number.isFinite(v)) throw new Error(`Dataset "${ds.id}": non-finite value at sample ${i}, variable ${j}.`);
      }),
    );
  }
  const out = {
    format: BUNDLE_FORMAT,
    bundleVersion: BUNDLE_VERSION,
    generator: `Linden ${LINDEN_VERSION}`,
    spec: bundle.spec,
    datasets: bundle.datasets,
    imported,
  };
  return `${JSON.stringify(out, null, 2)}\n`;
}

/**
 * Accepts a JSON string or parsed object. The spec is migrated like any spec file (parseSpec); a
 * version-1 bundle (or one without `imported`) gets its datasets as the imported snapshot.
 */
export function parseProject(json: unknown): ParseResult<ProjectBundle> {
  let input = json;
  if (typeof json === "string") {
    try {
      input = JSON.parse(json);
    } catch (e) {
      return { ok: false, errors: [`Invalid JSON: ${(e as Error).message}`] };
    }
  }
  const bundle = BundleSchema.safeParse(input);
  if (!bundle.success) {
    return { ok: false, errors: bundle.error.issues.map((i) => `${formatPath(i.path)}: ${i.message}`) };
  }
  const spec = parseSpec(bundle.data.spec);
  if (!spec.ok) return { ok: false, errors: spec.errors.map((e) => `spec.${e}`) };
  const datasets = bundle.data.datasets as Dataset[];
  return { ok: true, value: { spec: spec.value, datasets, imported: (bundle.data.imported as Dataset[] | undefined) ?? datasets } };
}
