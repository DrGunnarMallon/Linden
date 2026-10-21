// Preset loading with readable errors — SPEC.md §8. Core never reads files: callers pass
// { file, text } pairs (bundled at build time in the app, read from /presets in tests and the CLI).

import type { Preset } from "../model/spec.js";
import { parsePreset } from "./spec.js";

export interface PresetFile {
  /** File name, e.g. "pollen-percent.json"; the preset's name must match it without ".json". */
  file: string;
  text: string;
}

/**
 * Validates every file (JSON, schema, name = file name, unique names). Valid presets are returned in
 * file-name order; every problem becomes an error prefixed with the file name. Never throws.
 */
export function loadPresets(files: readonly PresetFile[]): { presets: Preset[]; errors: string[] } {
  const presets: Preset[] = [];
  const errors: string[] = [];
  const sorted = [...files].sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  for (const { file, text } of sorted) {
    const parsed = parsePreset(text);
    if (!parsed.ok) {
      errors.push(...parsed.errors.map((e) => `Preset ${file}: ${e}`));
      continue;
    }
    const expected = file.replace(/^.*\//, "").replace(/\.json$/i, "");
    if (parsed.value.name !== expected) {
      errors.push(`Preset ${file}: name "${parsed.value.name}" does not match the file name; expected "${expected}".`);
      continue;
    }
    if (presets.some((p) => p.name === parsed.value.name)) {
      errors.push(`Preset ${file}: duplicate preset name "${parsed.value.name}"; ignored.`);
      continue;
    }
    presets.push(parsed.value);
  }
  return { presets, errors };
}
