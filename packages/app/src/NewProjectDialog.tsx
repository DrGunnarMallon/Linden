// New project (SPEC §11): name, depth unit and optionally a preset → an empty dataset with a depth
// column, opened in the Data tab, ready for typing or pasting.

import type { Dataset } from "@linden/core";
import { useEffect, useState, type FormEvent } from "react";
import { useStore } from "./store";
import { Button, Dialog, DialogClose, DialogContent, Input, Segmented, Select } from "./ui";
import { useView } from "./view";

const DEPTH_UNITS: Dataset["depthUnit"][] = ["cm", "m", "mm"];
const NO_PRESET = "__none__";

export function NewProjectDialog() {
  const open = useView((s) => s.newProjectOpen);
  const setOpen = useView((s) => s.setNewProjectOpen);
  const presets = useStore((s) => s.presets);
  const [name, setName] = useState("");
  const [depthUnit, setDepthUnit] = useState<Dataset["depthUnit"]>("cm");
  const [preset, setPreset] = useState(NO_PRESET);

  useEffect(() => {
    if (open) {
      setName("");
      setDepthUnit("cm");
      setPreset(NO_PRESET);
    }
  }, [open]);

  const create = (e: FormEvent) => {
    e.preventDefault();
    const store = useStore.getState();
    if (store.datasets.length > 0 && !confirm("Replace the current project with a new, empty one? This cannot be undone.")) return;
    store.newProject({ name: name.trim() || "Untitled diagram", depthUnit, preset: preset === NO_PRESET ? undefined : preset });
    setOpen(false);
    useView.getState().setDataDataset(undefined);
    useView.getState().setWorkspaceTab("data");
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent title="New project" description="Starts with an empty data sheet: type your data or paste it from a spreadsheet.">
        <form onSubmit={create} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5 text-xs font-medium text-fg-secondary">
            Project name
            <Input autoFocus value={name} placeholder="e.g. Lake Linden core A" onChange={(e) => setName(e.target.value)} />
          </label>
          <div className="flex flex-col gap-1.5 text-xs font-medium text-fg-secondary">
            Depth unit
            <Segmented label="Depth unit" value={depthUnit} onValueChange={(v) => setDepthUnit(v as Dataset["depthUnit"])} options={DEPTH_UNITS.map((u) => ({ value: u, label: u }))} />
          </div>
          <div className="flex flex-col gap-1.5 text-xs font-medium text-fg-secondary">
            Preset (optional)
            <Select
              label="Preset"
              value={preset}
              onValueChange={setPreset}
              options={[{ value: NO_PRESET, label: "None" }, ...presets.map((p) => ({ value: p.name, label: p.name, title: p.description }))]}
            />
          </div>
          <div className="mt-2 flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button type="submit" variant="primary">
              Create
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
