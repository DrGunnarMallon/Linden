// SVG export: the rendered document as is — one <g id="panel-…"> per panel, text as text,
// <metadata> with the Linden version and spec hash (SPEC.md §10).

import type { Exporter } from "../model/types.js";

export const svgExporter: Exporter = {
  type: "svg",
  export: (svg) => Promise.resolve(svg),
};
