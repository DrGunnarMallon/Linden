// Graphical spec editor (SPEC.md §11): generated from the spec schema + core's UI hints. It holds no
// copy of the spec — it reads the store's spec and writes every edit back through the store.

import { parseSpec, resolveSpec, specForm, type Spec } from "@linden/core";
import { useCallback, useMemo, useState, type ComponentType } from "react";
import { matchPagePreset, PAGE_PRESETS } from "../specEdit";
import { useStore } from "../store";
import { CollapsibleSection, Select } from "../ui";
import { useView } from "../view";
import { FormContext, useForm, type ControlProps, type FormContextValue } from "./context";
import { Control, CONTROLS, Field } from "./controls";
import { fieldLabel, formSections, isBlock } from "./model";
import { removeIn, setIn } from "./paths";

const NONE = "__none__"; // Radix Select cannot use "" as a value
/** Sections open on first show; the rest start folded. */
const OPEN_SECTIONS = new Set(["preset", "page", "panels"]);

function PresetWidget({ path, value, label }: ControlProps) {
  const ctx = useForm();
  const presets = useStore((s) => s.presets);
  const name = typeof value === "string" ? value : undefined;
  const options = [
    { value: NONE, label: "None" },
    ...presets.map((p) => ({ value: p.name, label: p.name, title: p.description })),
    ...(name !== undefined && !presets.some((p) => p.name === name) ? [{ value: name, label: `${name} (not found)` }] : []),
  ];
  return (
    <div className="w-full min-w-0 space-y-1">
      <Select label={label} className="w-full" value={name ?? NONE} options={options} onValueChange={(v) => ctx.apply((s) => (v === NONE ? removeIn(s, path) : setIn(s, path, v)))} />
      {name && <p className="text-xs text-fg-muted">{presets.find((p) => p.name === name)?.description}</p>}
    </div>
  );
}

/** Dataset id: a choice of the loaded datasets (free text when none is loaded). */
function DatasetWidget(props: ControlProps) {
  const ctx = useForm();
  const datasets = useStore((s) => s.datasets);
  const value = typeof props.value === "string" ? props.value : "";
  if (datasets.length === 0 || props.node.kind !== "string") {
    const C = CONTROLS[props.node.kind] as ComponentType<ControlProps>;
    return <C {...props} />;
  }
  const options = datasets.map((d) => ({ value: d.id, label: d.name === d.id ? d.id : `${d.name} (${d.id})` }));
  if (value !== "" && !datasets.some((d) => d.id === value)) options.push({ value, label: `${value} (not loaded)` });
  return <Select label={props.label} className="w-full min-w-0" value={value} options={options} onValueChange={(v) => ctx.apply((s) => setIn(s, props.path, v))} />;
}

export const WIDGETS: Record<string, ComponentType<ControlProps>> = { preset: PresetWidget, dataset: DatasetWidget };

/** Journal / A4 page sizes; only change spec.page (through the store). */
function PageSizePreset({ page }: { page: { width: number; height: number } | undefined }) {
  if (!page) return null;
  return (
    <div className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)_1.75rem] items-center gap-2">
      <span className="text-xs text-fg-secondary">Size</span>
      <Select
        label="Page size"
        className="w-full min-w-0"
        value={matchPagePreset(page)}
        onValueChange={(v) => v !== "custom" && useStore.getState().applyPagePreset(v)}
        options={[...PAGE_PRESETS.map((p) => ({ value: p.id, label: p.label })), { value: "custom", label: "Custom" }]}
      />
    </div>
  );
}

export function SpecForm() {
  const spec = useStore((s) => s.spec);
  const presets = useStore((s) => s.presets);
  const [errors, setErrors] = useState<string[]>([]);
  // A panel selected in the preview opens the Panels section (its card opens itself, see ArrayControl).
  const reveal = useView((s) => s.selection?.seq);
  const effective = useMemo(() => {
    try {
      return resolveSpec(spec, presets).spec;
    } catch {
      return undefined;
    }
  }, [spec, presets]);

  const apply = useCallback((edit: (spec: Spec) => unknown, mergeKey?: string) => {
    const next = edit(useStore.getState().spec);
    const parsed = parseSpec(next);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return false;
    }
    setErrors([]);
    useStore.getState().editSpec(next as Spec, mergeKey);
    return true;
  }, []);
  const ctx = useMemo<FormContextValue>(() => ({ apply, effective, errors, widgets: WIDGETS }), [apply, effective, errors]);

  const root = specForm();
  if (root.kind !== "object") return null;
  const values = spec as Record<string, unknown>;
  return (
    <FormContext.Provider value={ctx}>
      <div className="h-full overflow-auto">
        {errors.length > 0 && (
          <div className="sticky top-0 z-20 m-3 rounded-md bg-danger-subtle p-2.5 text-xs" role="alert">
            <div className="mb-1 font-medium text-danger-text">Change not applied — the spec would be invalid:</div>
            <ul className="list-disc space-y-0.5 pl-5 text-fg">
              {errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </div>
        )}
        {formSections(root).map((section) => {
          const fields = section.fields.map((key) => root.fields.find((f) => f.key === key)!);
          const only = fields.length === 1 ? fields[0] : undefined;
          return (
            <CollapsibleSection
              key={section.id}
              title={section.title}
              defaultOpen={OPEN_SECTIONS.has(section.id)}
              reveal={section.fields.includes("panels") ? reveal : undefined}
              scrollOnReveal={false}
            >
              <div className="space-y-3 px-3 pb-3">
                {section.id === "page" && <PageSizePreset page={effective?.page} />}
                {only && isBlock(only.node) ? (
                  <>
                    {only.node.hint.help && <p className="text-xs text-fg-muted">{only.node.hint.help}</p>}
                    <Control node={only.node} path={[only.key]} value={values[only.key]} optional={only.optional} label={section.title} />
                  </>
                ) : (
                  fields.map((f) => <Field key={f.key} node={f.node} path={[f.key]} value={values[f.key]} optional={f.optional} label={fieldLabel(f.key, f.node)} />)
                )}
              </div>
            </CollapsibleSection>
          );
        })}
      </div>
    </FormContext.Provider>
  );
}
