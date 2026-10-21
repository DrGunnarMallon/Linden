// Files bundled at build time: the presets from /presets and the demo project from /examples.

import { parsePreset, type Preset } from "@linden/core";
import demoCsv from "../../../examples/demo-pollen.csv?raw";
import demoSpec from "../../../examples/demo-pollen.spec.json?raw";

const presetFiles = import.meta.glob<string>("../../../presets/*.json", { eager: true, query: "?raw", import: "default" });

export function loadBundledPresets(): { presets: Preset[]; warnings: string[] } {
  const presets: Preset[] = [];
  const warnings: string[] = [];
  for (const path of Object.keys(presetFiles).sort()) {
    const file = path.split("/").pop()!;
    const parsed = parsePreset(presetFiles[path]!);
    if (parsed.ok) presets.push(parsed.value);
    else warnings.push(...parsed.errors.map((e) => `Preset ${file}: ${e}`));
  }
  return { presets, warnings };
}

export const demo = { name: "demo-pollen", csv: demoCsv, specText: demoSpec };
