// Browser-only exporters, registered into core's exporter registry next to core's "svg".

import { exporters, type Exporter } from "@linden/core";
import { pdfExporter } from "./pdf";
import { pngExporter } from "./png";

for (const e of [pdfExporter, pngExporter] satisfies Exporter[]) if (!exporters.has(e.type)) exporters.register(e);

export { exporters };
