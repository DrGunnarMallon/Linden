// Depth and age on the y axis — SPEC.md §6. Samples are placed by their own depth or age (the
// primary axis); the other axis is interpolated between the samples' depth–age pairs, never
// extrapolated and never rescaled to fit.

import type { Dataset, Sample } from "../model/types.js";
import { interpolate } from "./scales.js";

export type AxisKind = "depth" | "age";

/** Where a sample sits on the primary axis; undefined = it has no age (age axis). */
export function samplePosition(s: Sample, primary: AxisKind): number | undefined {
  return primary === "age" ? s.age : s.depth;
}

export interface AgeDepthPairs {
  /** Ascending (stable for equal depths). */
  depths: number[];
  /** Age of each depth. */
  ages: number[];
}

/** Depth–age pairs of the samples with an age, sorted by depth. */
export function ageDepthPairs(ds: Dataset | undefined): AgeDepthPairs {
  const pairs = (ds?.samples ?? [])
    .map((s, i) => ({ depth: s.depth, age: s.age, i }))
    .filter((p): p is { depth: number; age: number; i: number } => p.age !== undefined)
    .sort((a, b) => a.depth - b.depth || a.i - b.i);
  return { depths: pairs.map((p) => p.depth), ages: pairs.map((p) => p.age) };
}

/** First depth at which the age decreases (going down); undefined if ages never decrease with depth. */
export function ageInversionAt(pairs: AgeDepthPairs): number | undefined {
  const k = pairs.ages.findIndex((a, i) => i > 0 && a < pairs.ages[i - 1]!);
  return k === -1 ? undefined : pairs.depths[k];
}

/** Depth → age by linear interpolation between the pairs; undefined outside them or if ages decrease. */
export function ageAtDepth(pairs: AgeDepthPairs, depth: number): number | undefined {
  if (ageInversionAt(pairs) !== undefined) return undefined;
  return interpolate(pairs.depths, pairs.ages, depth);
}
