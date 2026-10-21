// Renders every examples/<name>.spec.json with examples/<name>.csv to examples/out/<name>.svg
// (gitignored), using the presets in /presets. Run after build: npm run demo -w @linden/core
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { importDelimited, loadPresets, parseSpec, render } from "../dist/index.js";

const root = new URL("../../../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");

const { presets, errors } = loadPresets(
  readdirSync(new URL("presets/", root)).filter((f) => f.endsWith(".json")).map((file) => ({ file, text: read(`presets/${file}`) })),
);
for (const e of errors) console.warn(`warning: ${e}`);

mkdirSync(new URL("examples/out/", root), { recursive: true });
for (const file of readdirSync(new URL("examples/", root)).filter((f) => f.endsWith(".spec.json")).sort()) {
  const name = file.replace(/\.spec\.json$/, "");
  const spec = parseSpec(read(`examples/${file}`));
  if (!spec.ok) throw new Error(`${file}:\n${spec.errors.join("\n")}`);
  const { datasets, warnings: importWarnings } = importDelimited(read(`examples/${name}.csv`), { name });
  const { svg, warnings, info } = render(datasets, spec.value, presets);
  writeFileSync(new URL(`examples/out/${name}.svg`, root), svg);
  for (const i of info) console.log(`info (${name}): ${i}`);
  for (const w of [...importWarnings, ...warnings]) console.warn(`warning (${name}): ${w}`);
  console.log(`wrote examples/out/${name}.svg`);
}
