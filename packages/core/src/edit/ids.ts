// Deterministic ids for variables and samples created by edits — SPEC.md §5.4.
// An id never changes once given; names are display only. No randomness, no clock.

import { stripMarkup } from "../render/svg.js";

/** "*Alnus glutinosa*-type" → "alnus-glutinosa-type"; diacritics dropped; "" → `fallback`. */
export function slugify(name: string, fallback = "variable"): string {
  const slug = stripMarkup(name)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || fallback;
}

/** `base`, else `base-2`, `base-3`, … — the first one not in `taken`. */
export function uniqueId(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  let k = 2;
  while (taken.has(`${base}-${k}`)) k++;
  return `${base}-${k}`;
}

/** Id for a new variable: slug of its first name, unique among `taken`. */
export function variableId(name: string, taken: ReadonlySet<string>): string {
  return uniqueId(slugify(name), taken);
}

/** Id for a new sample: its depth as text (as the CSV importer does), `#2`, `#3`, … on collision. */
export function sampleId(depth: number, taken: ReadonlySet<string>): string {
  const base = String(depth);
  if (!taken.has(base)) return base;
  let k = 2;
  while (taken.has(`${base}#${k}`)) k++;
  return `${base}#${k}`;
}
