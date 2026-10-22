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
  // v6 added title, style, yAxis.titles and taxonCurves style.xTitle / xTicks.unitSuffix, all optional.
  5: (spec) => ({ ...spec, specVersion: 6 }),
  // v7 added the global xScale and taxonCurves style.columnWidth, both optional (defaults = the former constants).
  6: (spec) => ({ ...spec, specVersion: 7 }),
  7: toV8,
};

const MODE_TYPES: Record<string, string> = { silhouette: "polygon", bars: "bars", line: "line", linePoints: "linePoints" };

/**
 * Splits a v7 taxonCurves style (panel style, per-variable override or preset panelDefaults) into the
 * v8 curve style and the remaining layout keys. Only keys that were set are written; values the old
 * schema would not accept stay where they were, so validation still reports them.
 */
function splitV7Style(style: JsonObject): { curve: JsonObject; rest: JsonObject } {
  const { mode, fill, exaggeration, plusBelow, presence, ...rest } = style;
  const curve: JsonObject = {};
  const type = typeof mode === "string" ? MODE_TYPES[mode] : undefined;
  if (type) curve.type = type;
  else if (mode !== undefined) rest.mode = mode;
  if (typeof fill === "string") {
    // `fill` coloured the mode's shape and the presence marks.
    if (type === "line" || type === "linePoints") curve.line = { colour: fill };
    else curve.fill = { colour: fill };
    if (type === "linePoints") curve.points = { colour: fill };
    curve.presence = { colour: fill };
  } else if (fill !== undefined) rest.fill = fill;
  if (typeof exaggeration === "number") curve.exaggeration = exaggeration > 1 ? { show: true, factor: exaggeration } : { show: false };
  else if (exaggeration !== undefined) rest.exaggeration = exaggeration;
  if (typeof plusBelow === "number") curve.plus = plusBelow > 0 ? { show: true, threshold: plusBelow } : { show: false };
  else if (plusBelow !== undefined) rest.plusBelow = plusBelow;
  // The old presence bar was 0.6 mm thick (the new presence size default fits the dot).
  if (presence === "dot" || presence === "bar") curve.presence = { ...(curve.presence as JsonObject | undefined), symbol: presence, ...(presence === "bar" ? { size: 0.6 } : {}) };
  else if (presence !== undefined) rest.presence = presence;
  return { curve, rest };
}

/** Deep merge of plain JSON objects; `b` wins. */
function mergeJson(a: JsonObject, b: JsonObject): JsonObject {
  const out: JsonObject = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = isObject(out[k]) && isObject(v) ? mergeJson(out[k] as JsonObject, v) : v;
  return out;
}

/**
 * v8: curve styles (SPEC §4 "Curve styles"). taxonCurves `style.mode`, `fill`, `exaggeration`,
 * `plusBelow` and `presence` move into `style.curve`; the same keys in per-variable `overrides` move
 * into top-level `curveStyles` (variable id → style; for a variable overridden in several panels,
 * later panels win); the layout keys stay in `overrides`.
 */
function toV8(spec: JsonObject): JsonObject {
  const curveStyles: JsonObject = isObject(spec.curveStyles) ? { ...spec.curveStyles } : {};
  const panels = Array.isArray(spec.panels)
    ? spec.panels.map((p) => {
        if (!isObject(p) || p.type !== "taxonCurves") return p;
        const out: JsonObject = { ...p };
        if (isObject(p.style)) {
          const { curve, rest } = splitV7Style(p.style);
          out.style = Object.keys(curve).length > 0 ? { ...rest, curve } : rest;
        }
        if (isObject(p.overrides)) {
          const overrides: JsonObject = {};
          for (const [id, o] of Object.entries(p.overrides)) {
            if (!isObject(o)) {
              overrides[id] = o;
              continue;
            }
            const { curve, rest } = splitV7Style(o);
            if (Object.keys(curve).length > 0) curveStyles[id] = mergeJson(isObject(curveStyles[id]) ? curveStyles[id] : {}, curve);
            if (Object.keys(rest).length > 0) overrides[id] = rest;
          }
          if (Object.keys(overrides).length > 0) out.overrides = overrides;
          else delete out.overrides;
        }
        return out;
      })
    : spec.panels;
  const out: JsonObject = { ...spec, panels, specVersion: 8 };
  if (Object.keys(curveStyles).length > 0) out.curveStyles = curveStyles;
  return out;
}

/** Preset v2 (spec v8): curve keys of `panelDefaults.taxonCurves` move into its `curve`. */
export function migratePreset(input: unknown): unknown {
  if (!isObject(input) || input.presetVersion !== 1) return input;
  const out: JsonObject = { ...input, presetVersion: 2 };
  const defaults = input.panelDefaults;
  if (isObject(defaults) && isObject(defaults.taxonCurves)) {
    const { curve, rest } = splitV7Style(defaults.taxonCurves);
    out.panelDefaults = { ...defaults, taxonCurves: Object.keys(curve).length > 0 ? { ...rest, curve } : rest };
  }
  return out;
}

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
