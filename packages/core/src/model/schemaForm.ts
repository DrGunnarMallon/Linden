// Schema → form description — SPEC.md §11. Walks a zod schema into a plain FormNode tree that a UI
// (the app's graphical spec editor) renders generically, so every schema field gets a control.
// Hints (labels, units, sections, …) are plain data keyed by path pattern, see specForm.ts.

import type { z } from "zod/v4";

/** UI metadata for one schema node. Plain data; no rendering code. */
export interface FormHint {
  label?: string;
  help?: string;
  /** Shown inside number fields, e.g. "mm", "pt", "°". */
  unit?: string;
  /** Folded into the object's "Advanced" part by default. */
  advanced?: boolean;
  /** Not shown in the form (still kept in the spec). */
  hidden?: boolean;
  /** Objects: field order; unlisted fields follow in schema order. */
  order?: string[];
  /** Number input step. */
  step?: number;
  /** Nullable: label of the null choice, e.g. "Fit labels". */
  nullLabel?: string;
  /** Enums and discriminated unions: display labels by value. */
  optionLabels?: Record<string, string>;
  /** Plain unions: display label per option, in schema order. */
  unionLabels?: string[];
  /** Arrays: noun for one item ("panel" → "Add panel"). */
  itemLabel?: string;
  /** Arrays of objects: fields whose values make up an item's title. */
  itemTitle?: string[];
  /** Name of an app-provided control replacing the default one (falls back to the default). */
  widget?: string;
}

export interface FormSection {
  id: string;
  title: string;
  /** Top-level spec keys shown in this section, in order. */
  fields: string[];
}

export interface FormField {
  key: string;
  optional: boolean;
  node: FormNode;
}

interface NodeBase {
  /** Path pattern: `page.width`, `panels[].style`, `datasets[].sums{}`; "" = root. */
  path: string;
  hint: FormHint;
}

export type ObjectNode = NodeBase & { kind: "object"; fields: FormField[] };
export type FormNode =
  | ObjectNode
  | (NodeBase & { kind: "array"; item: FormNode; minItems: number })
  | (NodeBase & { kind: "tuple"; items: FormNode[] })
  | (NodeBase & { kind: "record"; value: FormNode })
  | (NodeBase & { kind: "string"; minLength: number })
  | (NodeBase & { kind: "number"; min?: number; max?: number; exclusiveMin?: number; exclusiveMax?: number; int: boolean })
  | (NodeBase & { kind: "boolean" })
  | (NodeBase & { kind: "enum"; options: string[] })
  | (NodeBase & { kind: "literal"; value: string | number | boolean | null })
  | (NodeBase & { kind: "nullable"; inner: FormNode })
  | (NodeBase & { kind: "union"; options: FormNode[] })
  | (NodeBase & { kind: "variants"; discriminator: string; variants: { value: string; node: ObjectNode }[] })
  /** A zod type the walker does not know; the UI points to the JSON editor. */
  | (NodeBase & { kind: "unsupported"; zodType: string });

export type FormNodeKind = FormNode["kind"];

export interface FormHints {
  hints: Record<string, FormHint>;
  /** Path prefix → prefix whose hints it reuses, e.g. "panels[].overrides{}" → "panels[].style". */
  aliases?: Record<string, string>;
}

/** Internal view of zod v4's definition objects (only what the walker reads). */
interface ZodDef {
  type: string;
  innerType?: z.ZodType;
  shape?: Record<string, z.ZodType>;
  element?: z.ZodType;
  items?: z.ZodType[];
  valueType?: z.ZodType;
  options?: z.ZodType[];
  discriminator?: string;
  entries?: Record<string, string>;
  values?: unknown[];
}

interface ZodBag {
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  format?: string;
}

const internals = (s: z.ZodType) => s._zod as unknown as { def: ZodDef; bag: ZodBag };

/** "minFontSize" → "Min font size". */
export function humanize(key: string): string {
  const words = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function hintAt(path: string, h: FormHints): FormHint {
  let hint = h.hints[path];
  for (const [from, to] of Object.entries(h.aliases ?? {})) {
    if (path === from || path.startsWith(`${from}.`) || path.startsWith(`${from}[`) || path.startsWith(`${from}{`)) {
      hint = { ...h.hints[to + path.slice(from.length)], ...hint };
    }
  }
  return hint ?? {};
}

const join = (path: string, key: string) => (path === "" ? key : `${path}.${key}`);

/** Describes `schema` as a FormNode tree. Pure; the same schema always gives the same tree. */
export function describeSchema(schema: z.ZodType, hints: FormHints, path = ""): FormNode {
  const { def, bag } = internals(schema);
  const base = { path, hint: hintAt(path, hints) };
  switch (def.type) {
    case "object": {
      const shape = def.shape ?? {};
      const order = base.hint.order ?? [];
      const keys = [...order.filter((k) => k in shape), ...Object.keys(shape).filter((k) => !order.includes(k))];
      const fields = keys.map((key): FormField => {
        let s = shape[key]!;
        const optional = internals(s).def.type === "optional";
        if (optional) s = internals(s).def.innerType!;
        return { key, optional, node: describeSchema(s, hints, join(path, key)) };
      });
      return { ...base, kind: "object", fields };
    }
    case "optional":
      return describeSchema(def.innerType!, hints, path);
    case "nullable":
      return { ...base, kind: "nullable", inner: describeSchema(def.innerType!, hints, path) };
    case "array":
      return { ...base, kind: "array", item: describeSchema(def.element!, hints, `${path}[]`), minItems: bag.minimum ?? 0 };
    case "tuple":
      return { ...base, kind: "tuple", items: (def.items ?? []).map((s, i) => describeSchema(s, hints, `${path}[${i}]`)) };
    case "record":
      return { ...base, kind: "record", value: describeSchema(def.valueType!, hints, `${path}{}`) };
    case "string":
      return { ...base, kind: "string", minLength: bag.minimum ?? 0 };
    case "number": {
      const int = bag.format === "safeint" || bag.format === "int32";
      const n: FormNode = { ...base, kind: "number", int };
      // Integer formats carry the safe-integer range as min/max; those are no real limits.
      if (bag.minimum !== undefined && !(int && bag.minimum <= Number.MIN_SAFE_INTEGER)) n.min = bag.minimum;
      if (bag.maximum !== undefined && !(int && bag.maximum >= Number.MAX_SAFE_INTEGER)) n.max = bag.maximum;
      if (bag.exclusiveMinimum !== undefined) n.exclusiveMin = bag.exclusiveMinimum;
      if (bag.exclusiveMaximum !== undefined) n.exclusiveMax = bag.exclusiveMaximum;
      return n;
    }
    case "boolean":
      return { ...base, kind: "boolean" };
    case "enum":
      return { ...base, kind: "enum", options: Object.values(def.entries ?? {}) };
    case "literal": {
      const v = def.values?.[0];
      return { ...base, kind: "literal", value: typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? v : null };
    }
    case "union": {
      const options = (def.options ?? []).map((s) => describeSchema(s, hints, path));
      const d = def.discriminator;
      if (d !== undefined && options.every((o) => o.kind === "object")) {
        const variants = (options as ObjectNode[]).map((node) => {
          const tag = node.fields.find((f) => f.key === d)?.node;
          return { value: tag?.kind === "literal" ? String(tag.value) : "", node };
        });
        return { ...base, kind: "variants", discriminator: d, variants };
      }
      return { ...base, kind: "union", options };
    }
    default:
      return { ...base, kind: "unsupported", zodType: def.type };
  }
}

/** Every node of the tree, depth first (root included). */
export function formNodes(node: FormNode): FormNode[] {
  const children: FormNode[] = (() => {
    switch (node.kind) {
      case "object":
        return node.fields.map((f) => f.node);
      case "array":
        return [node.item];
      case "tuple":
        return node.items;
      case "record":
        return [node.value];
      case "nullable":
        return [node.inner];
      case "union":
        return node.options;
      case "variants":
        return node.variants.map((v) => v.node);
      default:
        return [];
    }
  })();
  return [node, ...children.flatMap(formNodes)];
}

/** A valid starting value for a new item of this node (required fields filled, optional ones left out). */
export function defaultValue(node: FormNode): unknown {
  switch (node.kind) {
    case "object":
      return Object.fromEntries(node.fields.filter((f) => !f.optional).map((f) => [f.key, defaultValue(f.node)]));
    case "array":
      return Array.from({ length: node.minItems }, () => defaultValue(node.item));
    case "tuple":
      return node.items.map(defaultValue);
    case "record":
      return {};
    case "string":
      return node.minLength > 0 ? "new".padEnd(node.minLength, "_") : "";
    case "number": {
      if (node.exclusiveMin !== undefined) return node.exclusiveMin + 1;
      const v = node.min ?? 0;
      return node.max !== undefined ? Math.min(v, node.max) : v;
    }
    case "boolean":
      return false;
    case "enum":
      return node.options[0];
    case "literal":
      return node.value;
    case "nullable":
      return null;
    case "union":
      return node.options[0] ? defaultValue(node.options[0]) : undefined;
    case "variants":
      return node.variants[0] ? defaultValue(node.variants[0].node) : undefined;
    case "unsupported":
      return undefined;
  }
}

const isPlainObject = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

/** Shallow structural check: could `value` belong to this node? Picks the branch of a union. */
export function matchesNode(node: FormNode, value: unknown): boolean {
  switch (node.kind) {
    case "object":
    case "record":
      return isPlainObject(value);
    case "array":
      return Array.isArray(value);
    case "tuple":
      return Array.isArray(value) && value.length === node.items.length;
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number";
    case "boolean":
      return typeof value === "boolean";
    case "enum":
      return typeof value === "string" && node.options.includes(value);
    case "literal":
      return value === node.value;
    case "nullable":
      return value === null || matchesNode(node.inner, value);
    case "union":
      return node.options.some((o) => matchesNode(o, value));
    case "variants":
      return isPlainObject(value) && node.variants.some((v) => v.value === value[node.discriminator]);
    case "unsupported":
      return false;
  }
}
