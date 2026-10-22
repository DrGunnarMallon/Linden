// Saved curve styles as a small file of their own (.linden-styles.json), to reuse them across projects — SPEC.md §4.

import { z } from "zod/v4";
import { StyleLibrarySchema, type SavedCurveStyle } from "../model/spec.js";
import { LINDEN_VERSION } from "../version.js";
import { formatPath, type ParseResult } from "./spec.js";

export const STYLE_LIBRARY_FORMAT = "linden-curve-styles";
export const STYLE_LIBRARY_VERSION = 1;

const StyleLibraryFileSchema = z.object({
  format: z.literal(STYLE_LIBRARY_FORMAT),
  version: z.literal(STYLE_LIBRARY_VERSION),
  generator: z.string().optional(),
  styles: StyleLibrarySchema,
});

/** Pretty-printed style library file. */
export function serializeStyleLibrary(styles: readonly SavedCurveStyle[]): string {
  const out = { format: STYLE_LIBRARY_FORMAT, version: STYLE_LIBRARY_VERSION, generator: `Linden ${LINDEN_VERSION}`, styles };
  return `${JSON.stringify(out, null, 2)}\n`;
}

/** Accepts a JSON string or parsed object; errors name the offending path ("styles[0].style.type: …"). */
export function parseStyleLibrary(json: unknown): ParseResult<SavedCurveStyle[]> {
  let input = json;
  if (typeof json === "string") {
    try {
      input = JSON.parse(json);
    } catch (e) {
      return { ok: false, errors: [`Invalid JSON: ${(e as Error).message}`] };
    }
  }
  const r = StyleLibraryFileSchema.safeParse(input);
  if (!r.success) return { ok: false, errors: r.error.issues.map((i) => `${formatPath(i.path)}: ${i.message}`) };
  return { ok: true, value: r.data.styles };
}
