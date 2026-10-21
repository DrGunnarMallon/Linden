import { resolveSpec } from "@linden/core";
import { Braces, SlidersHorizontal } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { SpecEditor } from "./SpecEditor";
import { matchPagePreset, PAGE_PRESETS } from "./specEdit";
import { useStore } from "./store";
import { CollapsibleSection, NumberInput, Select, Tabs, TabsContent, TabsList, TabsTrigger } from "./ui";
import { useView, type InspectorTab } from "./view";

const NO_PRESET = "__none__"; // Radix Select cannot use "" as a value

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[72px_1fr] items-center gap-2">
      <span className="text-xs text-fg-secondary">{label}</span>
      {children}
    </div>
  );
}

function DiagramProperties() {
  const { spec, presets } = useStore();
  const store = useStore.getState();
  const page = useMemo(() => resolveSpec(spec, presets).spec.page, [spec, presets]);
  const unknownPreset = spec.preset !== undefined && !presets.some((p) => p.name === spec.preset);
  const presetOptions = [
    { value: NO_PRESET, label: "None" },
    ...presets.map((p) => ({ value: p.name, label: p.name, title: p.description })),
    ...(unknownPreset ? [{ value: spec.preset!, label: `${spec.preset} (not found)` }] : []),
  ];
  return (
    <div className="h-full overflow-auto">
      <CollapsibleSection title="Preset">
        <div className="space-y-2 px-3 pb-3">
          <Field label="Preset">
            <Select
              label="Preset"
              value={spec.preset ?? NO_PRESET}
              onValueChange={(v) => store.setPreset(v === NO_PRESET ? undefined : v)}
              options={presetOptions}
            />
          </Field>
          {spec.preset && <p className="text-xs text-fg-muted">{presets.find((p) => p.name === spec.preset)?.description}</p>}
        </div>
      </CollapsibleSection>
      <CollapsibleSection title="Page">
        <div className="space-y-2 px-3 pb-3">
          <Field label="Size">
            <Select
              label="Page size"
              value={matchPagePreset(page)}
              onValueChange={(v) => v !== "custom" && store.applyPagePreset(v)}
              options={[...PAGE_PRESETS.map((p) => ({ value: p.id, label: p.label })), { value: "custom", label: "Custom" }]}
            />
          </Field>
          <Field label="Width">
            <NumberInput label="Page width" unit="mm" min={1} step={0.5} value={page.width} onCommit={(width) => store.setPageSize({ width })} />
          </Field>
          <Field label="Height">
            <NumberInput label="Page height" unit="mm" min={1} step={0.5} value={page.height} onCommit={(height) => store.setPageSize({ height })} />
          </Field>
        </div>
      </CollapsibleSection>
      <p className="px-4 py-3 text-xs text-fg-muted">Panel, axis and style properties: edit them in the JSON tab for now.</p>
    </div>
  );
}

export function Inspector() {
  const { inspectorTab, showInspector } = useView();
  return (
    <Tabs value={inspectorTab} onValueChange={(v) => showInspector(v as InspectorTab)} className="flex h-full flex-col">
      <TabsList aria-label="Inspector">
        <TabsTrigger value="diagram">
          <SlidersHorizontal /> Diagram
        </TabsTrigger>
        <TabsTrigger value="json">
          <Braces /> JSON
        </TabsTrigger>
      </TabsList>
      <TabsContent value="diagram">
        <DiagramProperties />
      </TabsContent>
      <TabsContent value="json">
        <SpecEditor />
      </TabsContent>
    </Tabs>
  );
}
