// Spec migrations — CLAUDE.md rule 7. Run on raw JSON before validation so old spec files keep loading.
// steps[n] turns a version-n spec into a version-(n+1) spec.

import { SPEC_VERSION } from "./spec.js";

type JsonObject = Record<string, unknown>;

const steps: Record<number, (spec: JsonObject) => JsonObject> = {
  // v2 added headerBand, headers and taxonCurves style.groupGap / style.xTicks, all optional.
  1: (spec) => ({ ...spec, specVersion: 2 }),
  // v3 added top-level groups, dataset assignments / order and the merge transform, all optional.
  2: (spec) => ({ ...spec, specVersion: 3 }),
};

/** Migrates an older spec to SPEC_VERSION. Anything else (unknown versions, non-objects) is returned unchanged for validation to report. */
export function migrateSpec(input: unknown): unknown {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return input;
  let spec = input as JsonObject;
  while (typeof spec.specVersion === "number" && spec.specVersion < SPEC_VERSION) {
    const step = steps[spec.specVersion];
    if (!step) break;
    spec = step(spec);
  }
  return spec;
}
