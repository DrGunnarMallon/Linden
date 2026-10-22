// Zones overlay — SPEC.md §7.1. Manual boundaries (depths): horizontal lines across all panels,
// labels in a narrow column right of the last panel.

import { estimateTextWidth } from "../layout/theme.js";
import type { Overlay } from "../panels/types.js";

const LABEL_GAP = 1;

export const zonesOverlay: Overlay = {
  type: "zones",

  measure(ctx) {
    const w = ctx.spec.manual.reduce((m, z) => Math.max(m, estimateTextWidth(z.label ?? "", ctx.theme.fontSize)), 0);
    return { width: w > 0 ? w + LABEL_GAP : 0 };
  },

  render(ctx, g) {
    const { theme, y } = ctx;
    const [d0, d1] = y.domain;
    for (const z of ctx.spec.manual) {
      // Boundaries are depths; on an age axis they sit at the interpolated age.
      const at = ctx.toAxis(z.depth);
      if (at === undefined) {
        ctx.warn(`Zone boundary at depth ${z.depth} cannot be placed on the age axis (outside the dated samples, or ages decrease with depth); omitted.`);
        continue;
      }
      if (at < Math.min(d0, d1) || at > Math.max(d0, d1)) {
        ctx.warn(`Zone boundary at depth ${z.depth} is outside the y-axis range; omitted.`);
        continue;
      }
      const yy = y.toMm(at);
      g.line(0, yy, ctx.width, yy, { class: "zone", stroke: theme.stroke, "stroke-width": theme.zoneLineWidth });
      if (z.label) g.text(ctx.width + LABEL_GAP, yy + 0.35 * theme.fontSize, z.label, { class: "zone-label" });
    }
  },
};
