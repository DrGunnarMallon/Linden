// Effective groups of a dataset — SPEC.md §4. Groups are user-defined per dataset (`datasets[].groups`);
// the data's groups (e.g. a CSV group row) only seed them: spec groups rename, recolour and reorder
// them or add new ones, and assignments move variables between groups. Runs before transforms, so
// sums see the effective groups.

import type { SpecGroup } from "./spec.js";
import type { Dataset, Group } from "./types.js";

/**
 * Returns a new dataset whose `groups` are the dataset groups overlaid with `specGroups` (plus every
 * spec group not in the data, even if empty) and whose variables carry their assigned group. Data
 * groups not in `specGroups` are dropped once no variable is left in them (so a deleted group stays
 * deleted). Assignments to unknown groups or variables are ignored with a warning.
 */
export function applyGroups(
  ds: Dataset,
  specGroups: readonly SpecGroup[],
  assignments: Readonly<Record<string, string>>,
  warn: (m: string) => void,
): Dataset {
  const groups: Group[] = ds.groups.map((g) => ({ ...g }));
  for (const sg of specGroups) {
    const g = groups.find((x) => x.id === sg.id);
    if (g) {
      if (sg.name !== undefined) g.name = sg.name;
      if (sg.colour !== undefined) g.colour = sg.colour;
      if (sg.order !== undefined) g.order = sg.order;
    } else {
      const added: Group = { id: sg.id, name: sg.name ?? sg.id, order: sg.order ?? Number.POSITIVE_INFINITY };
      if (sg.colour !== undefined) added.colour = sg.colour;
      groups.push(added);
    }
  }

  const known = new Set(groups.map((g) => g.id));
  const valid = new Map<string, string>();
  for (const [varId, groupId] of Object.entries(assignments)) {
    if (!ds.variables.some((v) => v.id === varId)) {
      warn(`Assignment of "${varId}" in dataset "${ds.id}": no such variable (merged variables take their group from the merge transform); ignored.`);
    } else if (!known.has(groupId)) {
      warn(`Assignment of "${varId}" to group "${groupId}": no such group in dataset "${ds.id}"; ignored.`);
    } else valid.set(varId, groupId);
  }
  const variables = ds.variables.map((v) => {
    const g = valid.get(v.id);
    return g === undefined || g === v.group ? v : { ...v, group: g };
  });
  const listed = new Set(specGroups.map((g) => g.id));
  const kept = groups.filter((g) => listed.has(g.id) || variables.some((v) => v.group === g.id));
  return { ...ds, groups: kept, variables };
}

/** Group ids in display order: by `order`, ties in list order. */
export function groupOrder(ds: Dataset): string[] {
  return ds.groups
    .map((g, i) => ({ id: g.id, order: g.order, i }))
    .sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : a.i - b.i))
    .map((g) => g.id);
}
