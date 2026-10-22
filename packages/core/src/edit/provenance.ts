// Provenance — SPEC.md §5.4. A project keeps its datasets as imported (an immutable snapshot) next
// to the edited ones, so edited cells can be marked and reverted. Cells are matched by sample and
// variable id, so sorting, moving and inserting rows or columns do not make cells look edited.
// Samples and variables added after the import have no imported value.

import type { Dataset } from "../model/types.js";
import { setCell, type CellInput, type EditResult } from "./dataset.js";

/** An imported cell: its value, and its text code for ordinal columns of text codes. */
export interface ImportedCell {
  value: number | null;
  code?: string;
}

export interface Provenance {
  /** The imported cell, or undefined if the sample or variable was not imported. */
  imported(sampleId: string, variableId: string): ImportedCell | undefined;
  /** True if the cell exists in the import and its current value differs from it. */
  isEdited(ds: Dataset, sampleIndex: number, variableIndex: number): boolean;
}

function cellOf(ds: Dataset, i: number, j: number): ImportedCell {
  const value = ds.values[i]?.[j] ?? null;
  const codes = ds.variables[j]?.codes;
  return codes && value !== null ? { value, code: codes[value] } : { value };
}

/** Index of the imported snapshot of one dataset; `snapshot` undefined (blank project) = nothing imported. */
export function provenance(snapshot: Dataset | undefined): Provenance {
  const rows = new Map(snapshot?.samples.map((s, i) => [s.id, i]));
  const cols = new Map(snapshot?.variables.map((v, j) => [v.id, j]));
  const imported = (sampleId: string, variableId: string): ImportedCell | undefined => {
    const i = rows.get(sampleId);
    const j = cols.get(variableId);
    return snapshot && i !== undefined && j !== undefined ? cellOf(snapshot, i, j) : undefined;
  };
  return {
    imported,
    isEdited(ds, i, j) {
      const s = ds.samples[i];
      const v = ds.variables[j];
      const before = s && v ? imported(s.id, v.id) : undefined;
      if (!before) return false;
      const now = cellOf(ds, i, j);
      // Text codes compare as text: a column's code list may have grown since the import.
      return before.code !== undefined || now.code !== undefined ? before.code !== now.code : before.value !== now.value;
    },
  };
}

/** Sets a cell back to its imported value; unchanged (with a warning) if the cell was not imported. */
export function revertCell(ds: Dataset, snapshot: Dataset | undefined, sampleId: string, variableId: string): EditResult {
  const before = provenance(snapshot).imported(sampleId, variableId);
  if (!before) return { dataset: ds, warnings: ["This cell has no imported value."] };
  const input: CellInput = before.code ?? before.value;
  return setCell(ds, sampleId, variableId, input);
}
