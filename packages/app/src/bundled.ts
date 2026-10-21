// Files bundled at build time: the presets from /presets and the demo project from /examples.

import { loadPresets, type Preset } from "@linden/core";
import demoCsv from "../../../examples/demo-pollen.csv?raw";
import demoSpec from "../../../examples/demo-pollen.spec.json?raw";

const presetFiles = import.meta.glob<string>("../../../presets/*.json", { eager: true, query: "?raw", import: "default" });

export function loadBundledPresets(): { presets: Preset[]; warnings: string[] } {
  const { presets, errors } = loadPresets(Object.keys(presetFiles).map((path) => ({ file: path.split("/").pop()!, text: presetFiles[path]! })));
  return { presets, warnings: errors };
}

export const demo = { name: "demo-pollen", csv: demoCsv, specText: demoSpec };
