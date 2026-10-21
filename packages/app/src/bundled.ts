// Files bundled at build time: the presets from /presets and the example projects from /examples.

import { loadPresets, type Preset } from "@linden/core";
import demoCsv from "../../../examples/demo-pollen.csv?raw";
import demoSpec from "../../../examples/demo-pollen.spec.json?raw";
import macrofossilCsv from "../../../examples/macrofossil-counts.csv?raw";
import macrofossilSpec from "../../../examples/macrofossil-counts.spec.json?raw";
import testateCsv from "../../../examples/testate-percent.csv?raw";
import testateSpec from "../../../examples/testate-percent.spec.json?raw";

const presetFiles = import.meta.glob<string>("../../../presets/*.json", { eager: true, query: "?raw", import: "default" });

export function loadBundledPresets(): { presets: Preset[]; warnings: string[] } {
  const { presets, errors } = loadPresets(Object.keys(presetFiles).map((path) => ({ file: path.split("/").pop()!, text: presetFiles[path]! })));
  return { presets, warnings: errors };
}

export interface Example {
  /** Dataset name (= the id the example spec refers to). */
  name: string;
  label: string;
  description: string;
  csv: string;
  specText: string;
}

export const examples: Example[] = [
  { name: "testate-percent", label: "Testate amoebae", description: "Percentages, synthetic peat core", csv: testateCsv, specText: testateSpec },
  { name: "macrofossil-counts", label: "Plant macrofossils", description: "Counts by habitat group", csv: macrofossilCsv, specText: macrofossilSpec },
  { name: "demo-pollen", label: "Pollen", description: "Percentage diagram with groups", csv: demoCsv, specText: demoSpec },
];
