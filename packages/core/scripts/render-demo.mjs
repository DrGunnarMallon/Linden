// Renders examples/demo-pollen.* to examples/out/demo-pollen.svg (gitignored). Run after build.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { importDelimited, parsePreset, parseSpec, render } from "../dist/index.js";

const root = new URL("../../../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");

const { datasets, warnings: importWarnings } = importDelimited(read("examples/demo-pollen.csv"), { name: "demo-pollen" });
const spec = parseSpec(read("examples/demo-pollen.spec.json"));
const preset = parsePreset(read("presets/pollen-percent.json"));
if (!spec.ok) throw new Error(spec.errors.join("\n"));
if (!preset.ok) throw new Error(preset.errors.join("\n"));

const { svg, warnings } = render(datasets, spec.value, [preset.value]);
mkdirSync(new URL("examples/out/", root), { recursive: true });
writeFileSync(new URL("examples/out/demo-pollen.svg", root), svg);
for (const w of [...importWarnings, ...warnings]) console.warn(`warning: ${w}`);
console.log("wrote examples/out/demo-pollen.svg");
