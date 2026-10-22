// Confirmation before a paste fills an empty sheet (SPEC §11): the detected depth / age columns and,
// per variable column, its name, kind, unit and group, all editable. Applying is one undo step.

import { MeasurementKindSchema, type ClipboardColumn, type ClipboardImport, type ClipboardTable } from "@linden/core";
import { TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, cn, Dialog, DialogClose, DialogContent, Input, Select } from "./ui";

const NONE = "__none__";
const KIND_OPTIONS = MeasurementKindSchema.options.map((k) => ({ value: k, label: k }));

export function PasteDialog({ table, onApply, onCancel }: { table: ClipboardTable | null; onApply(choice: Omit<ClipboardImport, "id" | "name" | "depthUnit">): void; onCancel(): void }) {
  const [depth, setDepth] = useState<number | undefined>(undefined);
  const [age, setAge] = useState<number | undefined>(undefined);
  const [columns, setColumns] = useState<ClipboardColumn[]>([]);

  useEffect(() => {
    if (!table) return;
    setDepth(table.depthColumn);
    setAge(table.ageColumn);
    setColumns(table.columns);
  }, [table]);

  if (!table) return null;
  const options = table.columns.map((c) => ({ value: String(c.index), label: c.name }));
  const variables = columns.filter((c) => c.index !== depth && c.index !== age);
  const update = (index: number, patch: Partial<ClipboardColumn>) => setColumns((cs) => cs.map((c) => (c.index === index ? { ...c, ...patch } : c)));
  const rows = table.cells.length - table.headerRows;

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent
        title="Paste data"
        description={`${rows} sample${rows === 1 ? "" : "s"} × ${variables.length} variable${variables.length === 1 ? "" : "s"}${table.headerRows > 0 ? ", names from the first row" : ", no header row found"}. Check the columns before applying.`}
        className="w-[min(94vw,44rem)]"
      >
        <div className="flex flex-col gap-3 overflow-hidden">
          {table.warnings.map((w) => (
            <p key={w} className="rounded-md bg-warning-subtle px-2.5 py-1.5 text-xs text-warning-text">
              {w}
            </p>
          ))}
          <div className="flex gap-3">
            <label className="flex flex-1 flex-col gap-1.5 text-xs font-medium text-fg-secondary">
              <span className="flex items-center gap-1">
                Depth column
                {!table.depthCertain && (
                  <span className="inline-flex items-center gap-1 text-warning-text">
                    <TriangleAlert className="size-3.5" /> guessed — please check
                  </span>
                )}
              </span>
              <Select
                label="Depth column"
                value={depth === undefined ? NONE : String(depth)}
                onValueChange={(v) => setDepth(v === NONE ? undefined : Number(v))}
                options={depth === undefined ? [{ value: NONE, label: "Choose…" }, ...options] : options}
                className={cn(!table.depthCertain && "border-warning-text")}
              />
            </label>
            <label className="flex flex-1 flex-col gap-1.5 text-xs font-medium text-fg-secondary">
              Age column
              <Select label="Age column" value={age === undefined ? NONE : String(age)} onValueChange={(v) => setAge(v === NONE ? undefined : Number(v))} options={[{ value: NONE, label: "None" }, ...options.filter((o) => o.value !== String(depth))]} />
            </label>
          </div>
          <div className="min-h-0 overflow-auto rounded-md border border-border">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-surface-2 text-left text-fg-muted">
                <tr>
                  <th className="px-2 py-1.5 font-medium">Name</th>
                  <th className="px-2 py-1.5 font-medium">Kind</th>
                  <th className="px-2 py-1.5 font-medium">Unit</th>
                  <th className="px-2 py-1.5 font-medium">Group</th>
                </tr>
              </thead>
              <tbody>
                {variables.map((c) => (
                  <tr key={c.index} className="border-t border-border">
                    <td className="px-1 py-1">
                      <Input aria-label={`Name of column ${c.index + 1}`} value={c.name} onChange={(e) => update(c.index, { name: e.target.value })} className="h-7 w-full" />
                    </td>
                    <td className="px-1 py-1">
                      <Select label={`Kind of ${c.name}`} value={c.kind} onValueChange={(k) => update(c.index, { kind: MeasurementKindSchema.parse(k) })} options={KIND_OPTIONS} className="h-7 w-full" />
                    </td>
                    <td className="px-1 py-1">
                      <Input aria-label={`Unit of ${c.name}`} value={c.unit ?? ""} onChange={(e) => update(c.index, { unit: e.target.value })} className="h-7 w-24" />
                    </td>
                    <td className="px-1 py-1">
                      <Input aria-label={`Group of ${c.name}`} value={c.group ?? ""} onChange={(e) => update(c.index, { group: e.target.value })} className="h-7 w-28" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button variant="primary" disabled={depth === undefined} onClick={() => depth !== undefined && onApply({ depthColumn: depth, ...(age !== undefined ? { ageColumn: age } : {}), columns })}>
              Apply
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
