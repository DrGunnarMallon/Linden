// Curve tab of the inspector (SPEC §4 curve style cascade, §11): the style of the selected curves or
// group, generated from the curve style schema with the generic form controls. Every option shows
// whether it is inherited (and from where) or set at the level being edited; edits go to that level
// (curveStyles, groupStyles or the panel's style.curve) for every selected item, through the store.

import { CURVE_FORM_SECTIONS, parseSpec, prepareDatasets, specForm, type CurveType, type Dataset, type FormNode, type ObjectNode, type Spec } from "@linden/core";
import { BookmarkPlus, Download, Ellipsis, RotateCcw, Trash, Upload } from "lucide-react";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { exportStyles, importStyles, saveStyleAs } from "./actions";
import {
  availableApplyTo,
  curveTargets,
  curveView,
  defaultApplyTo,
  editTargets,
  isCurveType,
  MIXED,
  overriddenCount,
  resetCurveTargets,
  unflatten,
  type ApplyTo,
  type CurveEnv,
  type CurveSelection,
} from "./curveEdit";
import { FormContext, type CascadeState, type FormContextValue } from "./form/context";
import { Control, Field } from "./form/controls";
import { fieldLabel, isBlock } from "./form/model";
import { getIn, pathString, removeIn, setIn, type Path } from "./form/paths";
import { WIDGETS } from "./form/SpecForm";
import { GroupColourContext, MIXED_LABEL } from "./form/widgets";
import { useStore } from "./store";
import { Badge, Button, CollapsibleSection, IconButton, Menu, MenuContent, MenuItem, MenuSeparator, MenuSub, MenuSubContent, MenuSubTrigger, MenuTrigger, Segmented } from "./ui";
import { TaxonName } from "./VariableList";
import { useView } from "./view";

/** Root of the virtual spec the controls edit: { curve: <the merged level> }. */
const ROOT = "curve";

/** The curve style override node (one cascade level, every option of every type, all optional). */
function curveNode(): ObjectNode {
  const root = specForm() as ObjectNode;
  const record = root.fields.find((f) => f.key === "curveStyles")?.node;
  if (record?.kind !== "record" || record.value.kind !== "object") throw new Error("curveStyles is not a record of objects");
  return record.value;
}

/** Curve types with their labels from the form hints, in schema order (the context menu's Type submenu). */
export function curveTypeOptions(): { type: CurveType; label: string }[] {
  const node = curveNode().fields.find((f) => f.key === "type")?.node;
  if (node?.kind !== "enum") return [];
  return node.options.filter(isCurveType).map((type) => ({ type, label: node.hint.optionLabels?.[type] ?? type }));
}

// ── Type icons: a curve drawn down a depth axis (value to the right) ─────────────────────────────

const PTS: [number, number][] = [
  [5, 1.5],
  [10, 4],
  [7, 7],
  [13, 10],
  [6, 12.5],
  [9, 14.5],
];
const line = PTS.map(([x, y]) => `${x},${y}`).join(" ");
const dots = (r: number) => PTS.map(([x, y]) => <circle key={y} cx={x} cy={y} r={r} fill="currentColor" />);

const TYPE_ICONS: Record<CurveType, ReactNode> = {
  polygon: <polygon points={`2,1.5 ${line} 2,14.5`} fill="currentColor" fillOpacity="0.4" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />,
  line: <polyline points={line} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />,
  linePoints: (
    <>
      <polyline points={line} fill="none" stroke="currentColor" strokeWidth="1" />
      {dots(1.3)}
    </>
  ),
  points: <>{dots(1.5)}</>,
  bars: <>{PTS.map(([x, y]) => <rect key={y} x="2" y={y - 0.8} width={x - 2} height="1.6" fill="currentColor" />)}</>,
  presence: <>{[2.5, 6.5, 10.5, 14].map((y) => <circle key={y} cx="8" cy={y} r="1.4" fill="currentColor" />)}</>,
  none: <line x1="3" y1="13" x2="13" y2="3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />,
};

export function TypeIcon({ type }: { type: CurveType }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden>
      {type !== "presence" && type !== "none" && <line x1="2" y1="0.5" x2="2" y2="15.5" stroke="currentColor" strokeOpacity="0.45" strokeWidth="1" />}
      {TYPE_ICONS[type]}
    </svg>
  );
}

// ── Selection header ───────────────────────────────────────────────────────────

export function selectionTitle(sel: CurveSelection, prepared: readonly Dataset[]): ReactNode {
  const ds = (id: string) => prepared.find((d) => d.id === id);
  if (sel.kind === "group") return `Group ${ds(sel.dataset)?.groups.find((g) => g.id === sel.group)?.name ?? sel.group}`;
  if (sel.curves.length > 1) return `${sel.curves.length} curves`;
  const c = sel.curves[0]!;
  return <TaxonName name={ds(c.dataset)?.variables.find((v) => v.id === c.id)?.name ?? c.id} />;
}

/** Keeps only curves / groups that still exist (after undo, merges, removed datasets). */
function liveSelection(sel: CurveSelection | null, prepared: readonly Dataset[]): CurveSelection | null {
  if (!sel) return null;
  const ds = (id: string) => prepared.find((d) => d.id === id);
  if (sel.kind === "group") return ds(sel.dataset)?.groups.some((g) => g.id === sel.group) ? sel : null;
  const curves = sel.curves.filter((c) => ds(c.dataset)?.variables.some((v) => v.id === c.id));
  return curves.length === 0 ? null : curves.length === sel.curves.length ? sel : { kind: "curves", curves };
}

const APPLY_LABELS: Record<ApplyTo, (n: number) => string> = {
  curve: (n) => (n > 1 ? "These curves" : "This curve"),
  group: (n) => (n > 1 ? "Their groups" : "Its group"),
  panel: () => "Whole panel",
};

export function CurveInspector() {
  const spec = useStore((s) => s.spec);
  const presets = useStore((s) => s.presets);
  const datasets = useStore((s) => s.datasets);
  const layout = useStore((s) => s.layout);
  const selection = useView((s) => s.curveSelection);
  const [errors, setErrors] = useState<string[]>([]);
  /** "Apply to" chosen for one selection; a new selection starts at its default level. */
  const [choice, setChoice] = useState<{ key: string; applyTo: ApplyTo } | null>(null);

  const prepared = useMemo(() => {
    try {
      return prepareDatasets(datasets, spec, presets).datasets;
    } catch {
      return [];
    }
  }, [datasets, spec, presets]);
  const sel = liveSelection(selection, prepared);
  const env: CurveEnv = { spec, presets, prepared, layout };
  const selKey = JSON.stringify(sel);
  const available = sel ? availableApplyTo(env, sel) : undefined;
  const wanted = choice?.key === selKey ? choice.applyTo : sel ? defaultApplyTo(sel) : "curve";
  const applyTo: ApplyTo = available?.[wanted] ? wanted : sel ? defaultApplyTo(sel) : "curve";
  const targets = useMemo(() => (sel ? curveTargets(env, sel, applyTo) : []), [selKey, applyTo, spec, presets, prepared, layout]); // eslint-disable-line react-hooks/exhaustive-deps
  const view = useMemo(() => curveView(targets, spec), [targets, spec]);
  const node = useMemo(curveNode, []);

  // The controls edit a virtual spec { curve: merged level } (see editTargets): the leaf difference is
  // written to every target.
  const shown = useMemo(() => unflatten(new Map([...view.own].filter(([, v]) => v !== MIXED))), [view]);
  const effective = useMemo(() => ({ [ROOT]: unflatten(new Map([...view.effective].map(([k, v]) => [k, v === MIXED ? MIXED_LABEL : v]))) }), [view]);

  const apply = useCallback(
    (edit: (spec: Spec) => unknown, mergeKey?: string) => {
      const next = editTargets(useStore.getState().spec, targets, view, (level) => getIn(edit({ [ROOT]: level } as unknown as Spec), [ROOT]));
      if (next === undefined) return true;
      const paths = targets.map((t) => t.path);
      const parsed = parseSpec(next);
      if (!parsed.ok) {
        // Errors at the (first) target's path, shown at the field: "curveStyles.Pinus.fill.colour: …" → "curve.fill.colour: …".
        const prefix = `${pathString(paths[0] ?? [])}.`;
        setErrors(parsed.errors.map((e) => (e.startsWith(prefix) ? `${ROOT}.${e.slice(prefix.length)}` : e)));
        return false;
      }
      setErrors([]);
      useStore.getState().editSpec(next, mergeKey === undefined ? undefined : `curve:${JSON.stringify(paths)}:${mergeKey}`);
      return true;
    },
    [view, targets],
  );

  const cascade = useCallback(
    (path: Path): CascadeState | undefined => {
      if (path[0] !== ROOT) return undefined;
      const key = path.slice(1).join(".");
      if (!view.effective.has(key) && !view.own.has(key)) {
        // An object: overridden if any option below it is set here.
        return { overridden: [...view.own.keys()].some((k) => k.startsWith(`${key}.`)), mixed: false };
      }
      const own = view.own.get(key);
      const source = view.sources.get(key);
      const state: CascadeState = { overridden: own !== undefined, mixed: own === MIXED || view.effective.get(key) === MIXED };
      if (source !== undefined) state.source = source === MIXED ? "inherited from several levels" : source;
      return state;
    },
    [view],
  );

  const ctx = useMemo<FormContextValue>(() => ({ apply, effective, errors, widgets: WIDGETS, cascade, unsetLabel: "Inherited" }), [apply, effective, errors, cascade]);

  if (!sel || !available) {
    return <p className="p-4 text-xs text-fg-muted">Click a curve in the preview or a taxon in the variable list to style it.</p>;
  }

  const count = sel.kind === "curves" ? sel.curves.length : 1;
  const levelOptions = (sel.kind === "group" ? (["group", "panel"] as const) : (["curve", "group", "panel"] as const)).map((a) => ({
    value: a,
    label: sel.kind === "group" && a === "group" ? "Group" : APPLY_LABELS[a](count),
    disabled: !available[a],
  }));
  const library = spec.styleLibrary ?? [];
  const typeOverridden = view.own.has("type");
  const typeSource = view.sources.get("type");
  const groupColours = [...new Set(sel.kind === "group" ? [prepared.find((d) => d.id === sel.dataset)?.groups.find((g) => g.id === sel.group)?.colour] : sel.curves.map((c) => {
    const ds = prepared.find((d) => d.id === c.dataset);
    const g = ds?.variables.find((v) => v.id === c.id)?.group;
    return ds?.groups.find((x) => x.id === g)?.colour;
  }))];
  const resetLabel = applyTo === "curve" ? (count > 1 ? "Reset curves to inherited" : "Reset curve to inherited") : applyTo === "group" ? "Reset group style to inherited" : "Reset panel curve style";
  const values = shown as Record<string, unknown>;
  const field = (key: string) => node.fields.find((f) => f.key === key);
  const typeNode = field("type")?.node;
  const typeOptions = (typeNode?.kind === "enum" ? typeNode.options : []).filter(isCurveType);
  const renderField = (key: string, only: boolean): ReactNode => {
    const f = field(key);
    if (!f) return null;
    const path = [ROOT, key];
    // A section of one object (Outline, Points, …): its options directly, without a second heading.
    if (only && isBlock(f.node)) return <Control key={key} node={f.node as FormNode} path={path} value={values[key]} optional label={fieldLabel(key, f.node)} />;
    return <Field key={key} node={f.node} path={path} value={values[key]} optional label={fieldLabel(key, f.node)} />;
  };

  return (
    <FormContext.Provider value={ctx}>
      <GroupColourContext.Provider value={groupColours.length === 1 ? groupColours[0] : undefined}>
        <div className="h-full overflow-auto">
          <div className="space-y-3 border-b border-border p-3">
            <div className="flex items-center gap-2">
              <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">{selectionTitle(sel, prepared)}</h3>
              <IconButton
                label={resetLabel}
                icon={<RotateCcw />}
                size="sm"
                tooltipSide="left"
                disabled={view.own.size === 0}
                onClick={() => useStore.getState().editSpec(resetCurveTargets(useStore.getState().spec, targets.map((t) => t.path)))}
              />
            </div>
            <div className="space-y-1">
              <span className="text-xs text-fg-secondary">Apply to</span>
              <Segmented label="Apply edits to" className="w-full" value={applyTo} options={levelOptions} onValueChange={(v) => setChoice({ key: selKey, applyTo: v as ApplyTo })} />
            </div>
            <div className="space-y-1">
              <div className="flex h-5 items-center gap-2">
                <span className="text-xs text-fg-secondary">Type</span>
                <span className="min-w-0 flex-1 truncate text-2xs text-fg-muted italic">
                  {view.type === MIXED ? MIXED_LABEL : !typeOverridden && typeSource !== undefined ? (typeSource === MIXED ? "inherited from several levels" : typeSource) : ""}
                </span>
                {typeOverridden && (
                  <IconButton label="Reset type to inherited" icon={<RotateCcw />} size="sm" className="size-5 [&_svg]:size-3.5" tooltipSide="left" onClick={() => apply((s) => removeIn(s, [ROOT, "type"]))} />
                )}
              </div>
              <Segmented
                label="Curve type"
                className="w-full"
                value={view.type === MIXED ? undefined : view.type}
                inherited={!typeOverridden}
                onValueChange={(t) => {
                  // Picking the inherited type changes nothing (the spec stays minimal); reset un-pins an override.
                  if (isCurveType(t) && (typeOverridden || t !== view.type)) apply((s) => setIn(s, [ROOT, "type"], t));
                }}
                options={typeOptions.map((t) => ({ value: t, label: typeNode?.hint.optionLabels?.[t] ?? t, icon: <TypeIcon type={t} /> }))}
              />
            </div>
            <div className="space-y-1">
              <div className="flex h-5 items-center gap-2">
                <span className="flex-1 text-xs text-fg-secondary">Saved styles</span>
                <Menu>
                  <MenuTrigger asChild>
                    <IconButton label="Saved styles" icon={<Ellipsis />} size="sm" className="size-5 [&_svg]:size-3.5" tooltipSide="left" />
                  </MenuTrigger>
                  <MenuContent align="end">
                    <MenuItem onSelect={() => saveStyleAs(sel)}>
                      <BookmarkPlus /> Save style as…
                    </MenuItem>
                    <MenuSeparator />
                    <MenuItem disabled={library.length === 0} onSelect={exportStyles}>
                      <Download /> Export saved styles…
                    </MenuItem>
                    <MenuItem onSelect={() => void importStyles()}>
                      <Upload /> Import styles…
                    </MenuItem>
                    {library.length > 0 && (
                      <MenuSub>
                        <MenuSubTrigger>
                          <Trash /> Delete
                        </MenuSubTrigger>
                        <MenuSubContent>
                          {library.map((s) => (
                            <MenuItem key={s.name} onSelect={() => useStore.getState().removeCurveStyle(s.name)}>
                              {s.name}
                            </MenuItem>
                          ))}
                        </MenuSubContent>
                      </MenuSub>
                    )}
                  </MenuContent>
                </Menu>
              </div>
              {library.length === 0 ? (
                <p className="text-2xs text-fg-muted">None yet. “Save style as…” keeps this style in the project, to apply it to other curves in one click.</p>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {library.map((s) => (
                    <Button
                      key={s.name}
                      size="sm"
                      variant="secondary"
                      className="h-6 px-2 [&_svg]:size-3.5"
                      title={`Apply “${s.name}” to ${levelOptions.find((o) => o.value === applyTo)?.label.toLowerCase()}`}
                      onClick={() => useStore.getState().applyCurveStyle(sel, s.style, applyTo)}
                    >
                      {s.style.type && <TypeIcon type={s.style.type} />}
                      {s.name}
                    </Button>
                  ))}
                </div>
              )}
            </div>
            {errors.length > 0 && !errors.some((e) => e.startsWith(`${ROOT}.`)) && (
              <ul className="space-y-0.5 rounded-md bg-danger-subtle p-2 text-xs text-danger-text" role="alert">
                {errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            )}
          </div>
          {CURVE_FORM_SECTIONS.map((section) => {
            const keys = section.fields.filter((k) => view.keys.has(k));
            if (keys.length === 0) return null;
            const n = overriddenCount(view, keys);
            return (
              <CollapsibleSection
                key={section.id}
                defaultOpen={section.id !== "nulls"}
                title={
                  <span className="flex items-center gap-1.5">
                    {section.title}
                    {n > 0 && <Badge variant="accent" title={`${n} option${n > 1 ? "s" : ""} set here`}>{n}</Badge>}
                  </span>
                }
              >
                <div className="space-y-2 px-3 pb-3">{keys.map((k) => renderField(k, keys.length === 1))}</div>
              </CollapsibleSection>
            );
          })}
          {view.type === MIXED && <p className="p-3 text-xs text-fg-muted">The selected curves have different types: only their shared options are shown. Pick a type to edit all of its options.</p>}
        </div>
      </GroupColourContext.Provider>
    </FormContext.Provider>
  );
}
