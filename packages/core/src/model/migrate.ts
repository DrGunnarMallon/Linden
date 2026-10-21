// Spec migrations — CLAUDE.md rule 7. Run on raw JSON before validation so old spec files keep loading.
// steps[n] turns a version-n spec into a version-(n+1) spec.

import { SPEC_VERSION } from "./spec.js";

type JsonObject = Record<string, unknown>;

const steps: Record<number, (spec: JsonObject) => JsonObject> = {
  // v2 added headerBand, headers and taxonCurves style.groupGap / style.xTicks, all optional.
  1: (spec) => ({ ...spec, specVersion: 2 }),
  // v3 added top-level groups, dataset assignments / order and the merge transform, all optional.
  2: (spec) => ({ ...spec, specVersion: 3 }),
  // v4 added the scaleMap transform, dataset `scales`, selection `kinds` and style `presence`, all optional.
  3: (spec) => ({ ...spec, specVersion: 4 }),
  4: toV5,
};

/**
 * Groups, sums and outsideSum the bundled presets defined up to spec v4 (frozen copy). Presets no
 * longer define them; v4 specs that relied on them get them copied in, so nothing changes visually.
 */
const LEGACY_PRESETS: Record<string, { groups?: JsonObject[]; sums?: JsonObject; outsideSum?: JsonObject; transforms?: JsonObject[] }> = {
  "pollen-percent": {
    groups: [
      { id: "trees", name: "Trees", colour: "#2f6b3a", order: 1 },
      { id: "shrubs", name: "Shrubs", colour: "#7a9a3c", order: 2 },
      { id: "herbs", name: "Herbs", colour: "#c9a227", order: 3 },
      { id: "aquatics", name: "Aquatics", colour: "#3a78a8", order: 4 },
      { id: "spores", name: "Spores", colour: "#8a6a9a", order: 5 },
    ],
    sums: { terrestrial: { includeGroups: ["trees", "shrubs", "herbs"] } },
    outsideSum: { groups: ["aquatics", "spores"], basis: "sumPlusGroup" },
    transforms: [{ type: "percent", sum: "terrestrial" }],
  },
  "macrofossil-counts": {
    groups: [
      { id: "terrestrial", name: "Terrestrial", colour: "#6b5a2e", order: 1 },
      { id: "wetland", name: "Wetland", colour: "#4f7d3a", order: 2 },
      { id: "aquatic", name: "Aquatic", colour: "#3a78a8", order: 3 },
      { id: "other", name: "Other", colour: "#555555", order: 4 },
    ],
  },
  "diatom-percent": { sums: { total: { includeAll: true } } },
  "testate-percent": { sums: { total: { includeAll: true } } },
};

const isObject = (x: unknown): x is JsonObject => typeof x === "object" && x !== null && !Array.isArray(x);
const objects = (x: unknown): JsonObject[] => (Array.isArray(x) ? x.filter(isObject) : []);

/**
 * v5: groups are per dataset (`datasets[].groups`) and presets define no groups or sums. Top-level
 * `groups` and the legacy preset's groups (spec fields win) move into every dataset entry (entries are
 * created, without transforms, for panel datasets that had none); the preset's transforms, the sums
 * they or the entry's transforms name, and its outsideSum are copied into entries lacking them.
 * Explicit `headers` keep their bracket style.
 */
function toV5(spec: JsonObject): JsonObject {
  const { groups: specGroups, ...out } = spec;
  const legacy = typeof spec.preset === "string" ? LEGACY_PRESETS[spec.preset] : undefined;
  const own = objects(specGroups);
  const groups = (legacy?.groups ?? []).map((g) => ({ ...g, ...own.find((o) => o.id === g.id) }));
  for (const g of own) if (!groups.some((x) => x.id === g.id)) groups.push({ ...g });

  const entries = objects(spec.datasets);
  if (groups.length > 0) {
    for (const p of objects(spec.panels)) {
      if (typeof p.dataset === "string" && !entries.some((e) => e.dataset === p.dataset)) entries.push({ dataset: p.dataset, transforms: [] });
    }
  }
  if (Array.isArray(spec.datasets) || entries.length > 0) {
    out.datasets = entries.map((e) => {
      const entry: JsonObject = { ...e };
      if (groups.length > 0) entry.groups = groups.map((g) => ({ ...g }));
      if (entry.transforms === undefined && legacy?.transforms) entry.transforms = legacy.transforms.map((t) => ({ ...t }));
      const used = objects(entry.transforms).flatMap((t) => (t.type === "percent" && typeof t.sum === "string" ? [t.sum] : []));
      const sums: JsonObject = isObject(entry.sums) ? { ...entry.sums } : {};
      for (const name of used) if (!(name in sums) && legacy?.sums?.[name]) sums[name] = legacy.sums[name];
      if (Object.keys(sums).length > 0) entry.sums = sums;
      if (entry.outsideSum === undefined && legacy?.outsideSum && used.length > 0) entry.outsideSum = legacy.outsideSum;
      return entry;
    });
  }
  if (Array.isArray(spec.headers) && spec.headers.length > 0) out.groupHeaders = { line: "bracket" };
  return { ...out, specVersion: 5 };
}

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
