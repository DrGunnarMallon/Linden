// Import an age–depth model (SPEC §9, §11 Data tab): a table with depth and age columns, e.g. Bacon's
// *_ages.txt (depth, min, max, median, mean). The user picks the depth and age columns and the age unit;
// ages are interpolated linearly to the sample depths (no extrapolation) in one undo step.

import { applyAgeModel, type AgeModelChoice, type AgeModelTable, type Dataset } from "@linden/core";
import { useEffect, useMemo, useState } from "react";
import { Button, Dialog, DialogClose, DialogContent, Select } from "./ui";

const AGE_UNITS = ["cal BP", "BP", "CE/BCE", "b2k"] as const;

export interface PendingAgeModel {
  table: AgeModelTable;
  /** File name, kept as the ages' source. */
  source: string;
}

export function AgeModelDialog({ ds, pending, onApply, onCancel }: { ds: Dataset; pending: PendingAgeModel | null; onApply(choice: AgeModelChoice): void; onCancel(): void }) {
  const [depth, setDepth] = useState(0);
  const [age, setAge] = useState(1);
  const [unit, setUnit] = useState<NonNullable<Dataset["ageUnit"]>>(ds.ageUnit ?? "cal BP");

  useEffect(() => {
    if (!pending) return;
    setDepth(pending.table.depthColumn);
    setAge(pending.table.ageColumn);
  }, [pending]);

  const choice: AgeModelChoice | undefined = pending ? { depthColumn: depth, ageColumn: age, source: pending.source, ageUnit: unit } : undefined;
  // What applying would report (samples outside the model, decreasing ages), shown before applying.
  const preview = useMemo(() => (pending && choice ? applyAgeModel(ds, pending.table, choice) : undefined), [ds, pending, depth, age, unit]);
  if (!pending || !choice) return null;

  const options = pending.table.columns.map((c, i) => ({ value: String(i), label: c }));
  const depths = pending.table.rows.map((r) => r[depth]).filter((d): d is number => d !== null && d !== undefined);
  const dated = preview?.dataset.samples.filter((s) => s.age !== undefined).length ?? 0;

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent
        title="Import age–depth model"
        description={`${pending.source}: ${pending.table.rows.length} rows${depths.length ? `, depths ${Math.min(...depths)}–${Math.max(...depths)} ${ds.depthUnit}` : ""}. Ages are interpolated linearly to the sample depths, never extrapolated.`}
        className="w-[min(94vw,32rem)]"
      >
        <div className="flex flex-col gap-3">
          {[...pending.table.warnings, ...(preview?.warnings ?? [])].map((w) => (
            <p key={w} className="rounded-md bg-warning-subtle px-2.5 py-1.5 text-xs text-warning-text">
              {w}
            </p>
          ))}
          <div className="flex gap-3">
            <label className="flex flex-1 flex-col gap-1.5 text-xs font-medium text-fg-secondary">
              Depth column ({ds.depthUnit})
              <Select label="Depth column" value={String(depth)} onValueChange={(v) => setDepth(Number(v))} options={options} />
            </label>
            <label className="flex flex-1 flex-col gap-1.5 text-xs font-medium text-fg-secondary">
              Age column
              <Select label="Age column" value={String(age)} onValueChange={(v) => setAge(Number(v))} options={options.filter((o) => o.value !== String(depth))} />
            </label>
            <label className="flex w-28 flex-col gap-1.5 text-xs font-medium text-fg-secondary">
              Age unit
              <Select label="Age unit" value={unit} onValueChange={(v) => setUnit(AGE_UNITS.find((u) => u === v) ?? "cal BP")} options={AGE_UNITS.map((u) => ({ value: u, label: u }))} />
            </label>
          </div>
          <p className="text-xs text-fg-muted">
            {dated} of {ds.samples.length} samples get an age; existing ages are replaced.
          </p>
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button variant="primary" disabled={depth === age || dated === 0} onClick={() => onApply(choice)}>
              Apply
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
