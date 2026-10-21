// Pure helpers of the graphical spec editor: what is laid out as a block, sections, labels.

import { humanize, SPEC_FORM_SECTIONS, type FormNode, type FormSection, type ObjectNode } from "@linden/core";

/** Nodes drawn as a heading with an indented body (rather than a label + control row). */
export function isBlock(node: FormNode): boolean {
  if (node.kind === "nullable") return isBlock(node.inner);
  return node.kind === "object" || node.kind === "array" || node.kind === "record" || node.kind === "variants" || node.kind === "union";
}

export function fieldLabel(key: string, node: FormNode): string {
  return node.hint.label ?? humanize(key);
}

/** Display label of an enum value or variant type. */
export function optionLabel(node: FormNode, value: string): string {
  return node.hint.optionLabels?.[value] ?? humanize(value);
}

/**
 * The configured sections (only fields the schema has and does not hide), then one section per
 * remaining top-level field — so a new top-level spec key (e.g. `analyses`) shows up on its own.
 */
export function formSections(root: ObjectNode, sections: readonly FormSection[] = SPEC_FORM_SECTIONS): FormSection[] {
  const visible = root.fields.filter((f) => !f.node.hint.hidden);
  const keys = new Set(visible.map((f) => f.key));
  const listed = sections.map((s) => ({ ...s, fields: s.fields.filter((k) => keys.has(k)) })).filter((s) => s.fields.length > 0);
  const used = new Set(listed.flatMap((s) => s.fields));
  const rest = visible.filter((f) => !used.has(f.key)).map((f) => ({ id: f.key, title: fieldLabel(f.key, f.node), fields: [f.key] }));
  return [...listed, ...rest];
}

/** Card title of an array item: "2. Taxon curves · demo-pollen", from the array's `itemTitle` fields. */
export function itemTitle(array: FormNode & { kind: "array" }, value: unknown, index: number): string {
  const item = array.item;
  const obj = typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const parts = (array.hint.itemTitle ?? [])
    .map((key) => {
      const v = obj[key];
      if (v === undefined || v === null || v === "") return undefined;
      return item.kind === "variants" && key === item.discriminator ? optionLabel(item, String(v)) : String(v);
    })
    .filter((p): p is string => p !== undefined);
  const noun = array.hint.itemLabel ?? "item";
  return `${index + 1}. ${parts.length > 0 ? parts.join(" · ") : humanize(noun)}`;
}
