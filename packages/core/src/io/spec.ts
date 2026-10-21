// Spec / preset (de)serialisation with readable validation errors — see SPEC.md §4.

import { z } from "zod/v4";
import { migrateSpec } from "../model/migrate.js";
import { PresetSchema, SpecSchema, type Preset, type Spec } from "../model/spec.js";

export type ParseResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

/** "panels[1].style.mode" style path. */
export function formatPath(path: readonly PropertyKey[]): string {
  let out = "";
  for (const key of path) {
    if (typeof key === "number") out += `[${key}]`;
    else out += out === "" ? String(key) : `.${String(key)}`;
  }
  return out === "" ? "(root)" : out;
}

function parseWith<T>(schema: z.ZodType<T>, json: unknown, migrate: (x: unknown) => unknown = (x) => x): ParseResult<T> {
  let input = json;
  if (typeof json === "string") {
    try {
      input = JSON.parse(json);
    } catch (e) {
      return { ok: false, errors: [`Invalid JSON: ${(e as Error).message}`] };
    }
  }
  const result = schema.safeParse(migrate(input));
  if (result.success) return { ok: true, value: result.data };
  return {
    ok: false,
    errors: result.error.issues.map((issue) => `${formatPath(issue.path)}: ${issue.message}`),
  };
}

/** Accepts a JSON string or an already-parsed object. Older spec versions are migrated first. */
export function parseSpec(json: unknown): ParseResult<Spec> {
  return parseWith(SpecSchema, json, migrateSpec);
}

export function parsePreset(json: unknown): ParseResult<Preset> {
  return parseWith(PresetSchema, json);
}

/** JSON Schema (draft 2020-12) of the spec, e.g. for editor validation. */
export function specJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(SpecSchema) as Record<string, unknown>;
}
