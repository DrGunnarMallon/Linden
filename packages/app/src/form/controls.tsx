// Generic form controls, one per FormNode kind (CONTROLS). Built only from ./ui; every edit goes
// through the form context to the store.

import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { defaultValue, humanize, matchesNode, type FormNodeKind } from "@linden/core";
import { CircleHelp, GripVertical, Plus, RotateCcw, X } from "lucide-react";
import { useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { Badge, Button, Checkbox, cn, CollapsibleSection, IconButton, Input, Menu, MenuContent, MenuItem, MenuTrigger, NumberInput, Select, Tooltip } from "../ui";
import { useView } from "../view";
import { FormContext, useForm, type ControlOf, type ControlProps, type FormContextValue } from "./context";
import { fieldLabel, isBlock, itemTitle, optionLabel } from "./model";
import { getIn, moveItem, pathString, removeIn, renameKey, setIn, type Path } from "./paths";

/** Text and number fields commit this long after typing stops. */
export const TYPING_DEBOUNCE_MS = 300;
const DEFAULT = "__default__"; // Radix Select cannot use "" as a value

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x);

function useEffective(path: Path): unknown {
  return getIn(useForm().effective, path);
}

/** Sets the value at `path`; `typing` edits of one field merge into one undo step. */
function useSet(path: Path) {
  const ctx = useForm();
  return (value: unknown, typing = false) => ctx.apply((s) => setIn(s, path, value), typing ? pathString(path) : undefined);
}

function placeholderFor(value: unknown, effective: unknown, optional: boolean): string | undefined {
  if (value !== undefined) return undefined;
  if (typeof effective === "string" || typeof effective === "number") return String(effective);
  return optional ? "Default" : undefined;
}

/** Child edits of a missing object / tuple first create it from `init`, so required siblings exist. */
function Ensure({ path, value, init, children }: { path: Path; value: unknown; init(): unknown; children: ReactNode }) {
  const parent = useForm();
  if (value !== undefined) return <>{children}</>;
  const ctx: FormContextValue = {
    ...parent,
    apply: (edit, key) => parent.apply((s) => edit(getIn(s, path) === undefined ? setIn(s, path, init()) : s), key),
  };
  return <FormContext.Provider value={ctx}>{children}</FormContext.Provider>;
}

// ---------------------------------------------------------------------------------------------
// Leaf controls

function DebouncedText({ value, onCommit, label, placeholder }: { value: string | undefined; onCommit(text: string): void; label: string; placeholder?: string }) {
  const [text, setText] = useState(value ?? "");
  const pending = useRef<string | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const latest = useRef({ value, onCommit });
  latest.current = { value, onCommit };
  const flush = () => {
    clearTimeout(timer.current);
    const t = pending.current;
    pending.current = undefined;
    if (t !== undefined && t !== (latest.current.value ?? "")) latest.current.onCommit(t);
  };
  // Follow outside changes (undo, JSON edits) unless the user has uncommitted typing.
  useEffect(() => {
    if (pending.current === undefined) setText(value ?? "");
  }, [value]);
  useEffect(() => flush, []);
  return (
    <Input
      aria-label={label}
      value={text}
      placeholder={placeholder}
      className="w-full min-w-0"
      onChange={(e) => {
        setText(e.target.value);
        pending.current = e.target.value;
        clearTimeout(timer.current);
        timer.current = setTimeout(flush, TYPING_DEBOUNCE_MS);
      }}
      onBlur={flush}
      onKeyDown={(e) => e.key === "Enter" && flush()}
    />
  );
}

function StringControl({ path, value, optional, label }: ControlOf<"string">) {
  const set = useSet(path);
  const effective = useEffective(path);
  return (
    <DebouncedText
      label={label}
      value={typeof value === "string" ? value : undefined}
      placeholder={value === "" ? "Empty" : placeholderFor(value, effective, optional)}
      onCommit={(t) => set(t, true)}
    />
  );
}

function NumberControl({ node, path, value, optional, label }: ControlOf<"number">) {
  const ctx = useForm();
  const set = useSet(path);
  return (
    <NumberInput
      label={label}
      value={typeof value === "number" ? value : undefined}
      placeholder={placeholderFor(value, useEffective(path), optional)}
      unit={node.hint.unit}
      min={node.min ?? node.exclusiveMin}
      max={node.max ?? node.exclusiveMax}
      step={node.hint.step ?? 1}
      commitDelay={TYPING_DEBOUNCE_MS}
      onCommit={(v) => set(v, true)}
      onClear={optional ? () => ctx.apply((s) => removeIn(s, path)) : undefined}
      className="w-full"
    />
  );
}

function BooleanControl({ path, value, label }: ControlOf<"boolean">) {
  const set = useSet(path);
  const effective = useEffective(path);
  const checked = typeof value === "boolean" ? value : effective === true;
  return <Checkbox aria-label={label} checked={checked} onCheckedChange={(c) => set(c)} className={cn(value === undefined && "opacity-60")} />;
}

function EnumControl({ node, path, value, optional, label }: ControlOf<"enum">) {
  const ctx = useForm();
  const set = useSet(path);
  const effective = useEffective(path);
  const options = node.options.map((o) => ({ value: o, label: optionLabel(node, o) }));
  if (optional) {
    const eff = typeof effective === "string" && node.options.includes(effective) ? ` (${optionLabel(node, effective)})` : "";
    options.unshift({ value: DEFAULT, label: `${ctx.unsetLabel ?? "Default"}${eff}` });
  }
  return (
    <Select
      label={label}
      className="w-full min-w-0"
      value={typeof value === "string" ? value : DEFAULT}
      options={options}
      onValueChange={(v) => (v === DEFAULT ? ctx.apply((s) => removeIn(s, path)) : set(v))}
    />
  );
}

function LiteralControl({ node }: ControlOf<"literal">) {
  return <span className="text-xs text-fg-muted">{String(node.value)}</span>;
}

function NullableControl({ node, path, value, optional, label }: ControlOf<"nullable">) {
  const set = useSet(path);
  const effective = useEffective(path);
  const isNull = value === null || (value === undefined && effective === null);
  const nullLabel = node.hint.nullLabel ?? "None";
  const start = () => (effective !== undefined && effective !== null && matchesNode(node.inner, effective) ? effective : defaultValue(node.inner));
  return (
    <div className={cn("flex gap-2", isBlock(node.inner) ? "flex-col" : "items-center")}>
      {!isNull && (
        <div className="min-w-0 flex-1">
          <Control node={node.inner} path={path} value={value ?? undefined} optional={optional} label={label} />
        </div>
      )}
      <label className={cn("flex shrink-0 items-center gap-1.5 text-xs text-fg-secondary", isNull && "flex-1")}>
        <Checkbox aria-label={`${label}: ${nullLabel}`} checked={isNull} onCheckedChange={(c) => set(c ? null : start())} className={cn(value === undefined && "opacity-60")} />
        {nullLabel}
      </label>
    </div>
  );
}

function TupleControl({ node, path, value, label }: ControlOf<"tuple">) {
  const effective = useEffective(path);
  const arr = Array.isArray(value) ? value : undefined;
  const init = () => (Array.isArray(effective) && matchesNode(node, effective) ? effective : defaultValue(node));
  return (
    <Ensure path={path} value={arr} init={init}>
      <div className="grid auto-cols-fr grid-flow-col gap-2">
        {node.items.map((item, i) => (
          <Control key={i} node={item} path={[...path, i]} value={arr?.[i]} optional={false} label={item.hint.label ?? `${label} ${i + 1}`} />
        ))}
      </div>
    </Ensure>
  );
}

// ---------------------------------------------------------------------------------------------
// Layout: a field is a label + control row, or a heading with an indented block

function FieldLabel({ label, help }: { label: string; help?: string }) {
  return (
    <span className="flex min-w-0 items-center gap-1 text-xs text-fg-secondary">
      <span className="truncate" title={label}>
        {label}
      </span>
      {help && (
        <Tooltip content={help} side="left">
          <span tabIndex={0} aria-label={`About ${label}`} className="inline-flex shrink-0 rounded text-fg-muted hover:text-fg focus-visible:text-fg focus-visible:outline-none">
            <CircleHelp className="size-3.5" />
          </span>
        </Tooltip>
      )}
    </span>
  );
}

function Row({ label, help, children, end, note, muted }: { label: string; help?: string; children: ReactNode; end?: ReactNode; note?: string; muted?: boolean }) {
  return (
    <div className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)_1.75rem] items-start gap-2">
      <div className={cn("flex min-h-8 min-w-0 flex-col justify-center", muted && "opacity-75")}>
        <FieldLabel label={label} help={help} />
        {note && (
          <span className="truncate text-2xs text-fg-muted italic" title={note}>
            {note}
          </span>
        )}
      </div>
      <div className="flex min-h-8 min-w-0 items-center">{children}</div>
      <div className="flex h-8 items-center justify-end">{end}</div>
    </div>
  );
}

function FieldErrors({ path }: { path: Path }) {
  const prefix = `${pathString(path)}: `;
  const errors = useForm().errors.filter((e) => e.startsWith(prefix));
  if (errors.length === 0) return null;
  return (
    <ul className="mt-1 space-y-0.5 text-xs text-danger-text" role="alert">
      {errors.map((e, i) => (
        <li key={i}>{e.slice(prefix.length)}</li>
      ))}
    </ul>
  );
}

/** One field of an object: label, control, reset-to-default and errors. */
export function Field({ node, path, value, optional, label }: ControlProps) {
  const ctx = useForm();
  // Cascade-aware (Curve tab): reset = back to the inherited value; inherited options are muted and say where they come from.
  const state = ctx.cascade?.(path);
  const reset =
    (state ? state.overridden : optional && value !== undefined) ? (
      <IconButton
        label={state ? "Reset to inherited" : "Reset to default"}
        icon={<RotateCcw />}
        size="sm"
        tooltipSide="left"
        onClick={() => ctx.apply((s) => removeIn(s, path))}
      />
    ) : undefined;
  const note = state?.mixed ? "Mixed" : state && !state.overridden ? state.source : undefined;
  const control = <Control node={node} path={path} value={value} optional={optional} label={label} />;
  if (!isBlock(node)) {
    return (
      <div>
        <Row label={label} help={node.hint.help} end={reset} note={note} muted={state !== undefined && !state.overridden}>
          {control}
        </Row>
        <FieldErrors path={path} />
      </div>
    );
  }
  return (
    <div>
      <div className="flex h-7 items-center gap-2">
        <span className={cn("min-w-0 flex-1 text-xs font-medium text-fg", state && !state.overridden && "opacity-75")}>
          <FieldLabel label={label} help={node.hint.help} />
        </span>
        {reset}
      </div>
      <FieldErrors path={path} />
      <div className="ml-0.5 border-l border-border pl-3">{control}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Containers

export function ObjectControl({ node, path, value, skip }: ControlOf<"object"> & { skip?: string }) {
  const obj = isObj(value) ? value : undefined;
  const fields = node.fields.filter((f) => !f.node.hint.hidden && f.key !== skip);
  const basic = fields.filter((f) => !f.node.hint.advanced);
  const advanced = fields.filter((f) => f.node.hint.advanced);
  const setCount = advanced.filter((f) => obj?.[f.key] !== undefined).length;
  const field = (f: (typeof fields)[number]) => <Field key={f.key} node={f.node} path={[...path, f.key]} value={obj?.[f.key]} optional={f.optional} label={fieldLabel(f.key, f.node)} />;
  return (
    <Ensure path={path} value={obj} init={() => defaultValue(node)}>
      <div className="space-y-2 py-1">
        {basic.map(field)}
        {advanced.length > 0 && (
          <CollapsibleSection
            defaultOpen={false}
            className="rounded-md border"
            title={
              <span className="flex items-center gap-1.5 font-medium text-fg-secondary">
                Advanced {setCount > 0 && <Badge title={`${setCount} set`}>{setCount}</Badge>}
              </span>
            }
          >
            <div className="space-y-2 px-2.5 pb-2.5">{advanced.map(field)}</div>
          </CollapsibleSection>
        )}
      </div>
    </Ensure>
  );
}

function VariantsControl({ node, path, value, label }: ControlOf<"variants">) {
  const set = useSet(path);
  const obj = isObj(value) ? value : {};
  const tag = obj[node.discriminator];
  const variant = node.variants.find((v) => v.value === tag);
  const changeType = (type: string) => {
    const target = node.variants.find((v) => v.value === type);
    if (!target) return;
    // Keep the fields the new type also has (e.g. width), take defaults for the rest.
    const keys = new Set(target.node.fields.map((f) => f.key));
    const kept = Object.fromEntries(Object.entries(obj).filter(([k]) => keys.has(k) && k !== node.discriminator));
    set({ ...(defaultValue(target.node) as Obj), ...kept });
  };
  return (
    <div className="space-y-2">
      <Row label={humanize(node.discriminator)}>
        <Select
          label={`${label}: ${node.discriminator}`}
          className="w-full min-w-0"
          value={typeof tag === "string" ? tag : ""}
          options={node.variants.map((v) => ({ value: v.value, label: optionLabel(node, v.value) }))}
          onValueChange={changeType}
        />
      </Row>
      {variant ? (
        <ObjectControl node={variant.node} path={path} value={obj} optional={false} label={label} skip={node.discriminator} />
      ) : (
        <p className="text-xs text-fg-muted">Unknown {node.discriminator} — edit it in the JSON editor.</p>
      )}
    </div>
  );
}

const KIND_LABELS: Partial<Record<FormNodeKind, string>> = { string: "Text", number: "Number", boolean: "Yes / no", enum: "Choice", array: "List", object: "Fields", record: "Table" };

function UnionControl({ node, path, value, optional, label }: ControlOf<"union">) {
  const set = useSet(path);
  const effective = useEffective(path);
  const current = value ?? effective;
  const index = Math.max(0, node.options.findIndex((o) => matchesNode(o, current)));
  const option = node.options[index];
  const labels = node.options.map((o, i) => node.hint.unionLabels?.[i] ?? KIND_LABELS[o.kind] ?? humanize(o.kind));
  const choose = (i: number) => {
    const o = node.options[i];
    if (o) set(effective !== undefined && matchesNode(o, effective) ? effective : defaultValue(o));
  };
  return (
    <div className="space-y-2 py-1">
      <Row label="Form">
        <Select label={`${label}: form`} className="w-full min-w-0" value={String(index)} options={labels.map((l, i) => ({ value: String(i), label: l }))} onValueChange={(v) => choose(Number(v))} />
      </Row>
      {option && (isBlock(option) ? <Control node={option} path={path} value={matchesNode(option, value) ? value : undefined} optional={optional} label={label} /> : (
        <Row label={labels[index] ?? label}>
          <Control node={option} path={path} value={matchesNode(option, value) ? value : undefined} optional={optional} label={label} />
        </Row>
      ))}
    </div>
  );
}

/** Stable React keys for array items across moves, adds and removes (index keys would move local state). */
function useItemKeys(length: number) {
  const ref = useRef({ keys: [] as number[], next: 0 });
  const r = ref.current;
  while (r.keys.length < length) r.keys.push(r.next++);
  if (r.keys.length > length) r.keys.length = length;
  return {
    keys: r.keys,
    move(from: number, to: number) {
      const [k] = r.keys.splice(from, 1);
      r.keys.splice(to, 0, k!);
    },
    remove(i: number) {
      r.keys.splice(i, 1);
    },
    /** Key the next appended item will get. */
    peekNext: () => r.next,
  };
}

function Sortable({ id, children }: { id: string; children(handle: ReactNode, dragging: boolean): ReactNode }) {
  const s = useSortable({ id });
  const handle = (
    <span
      ref={s.setActivatorNodeRef}
      aria-label="Drag to reorder"
      className="flex w-4 shrink-0 cursor-grab touch-none items-center justify-center rounded text-fg-muted hover:text-fg active:cursor-grabbing [&_svg]:size-3.5"
      {...s.attributes}
      {...s.listeners}
    >
      <GripVertical />
    </span>
  );
  return (
    <div ref={s.setNodeRef} className={cn(s.isDragging && "relative z-10 opacity-60")} style={{ transform: CSS.Translate.toString(s.transform), transition: s.transition }}>
      {children(handle, s.isDragging)}
    </div>
  );
}

function ArrayControl({ node, path, value, label }: ControlOf<"array">) {
  const ctx = useForm();
  const items = Array.isArray(value) ? value : [];
  const keys = useItemKeys(items.length);
  const [added, setAdded] = useState<ReadonlySet<number>>(new Set());
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const id = (k: number) => `${pathString(path)}#${k}`;
  const ids = keys.keys.map(id);
  const item = node.item;
  const noun = node.hint.itemLabel ?? "item";
  const cards = isBlock(item);
  // The panel selected in the preview: its card opens, scrolls into view and is outlined.
  const isPanels = pathString(path) === "panels";
  const selected = useView((s) => (isPanels ? s.selection?.panel : undefined));
  const reveal = useView((s) => (isPanels ? s.selection?.seq : undefined));

  const add = (v: unknown) => {
    const k = keys.peekNext();
    if (ctx.apply((s) => setIn(s, [...path, items.length], v))) setAdded((a) => new Set(a).add(k));
  };
  const remove = (i: number) => {
    keys.remove(i);
    ctx.apply((s) => removeIn(s, [...path, i]));
  };
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const from = ids.indexOf(String(active.id));
    const to = over ? ids.indexOf(String(over.id)) : -1;
    if (from < 0 || to < 0 || from === to) return;
    keys.move(from, to);
    ctx.apply((s) => moveItem(s, path, from, to));
  };
  const removeButton = (i: number) => (
    <IconButton label={`Remove ${noun}`} icon={<X />} size="sm" tooltipSide="left" disabled={items.length <= node.minItems} onClick={() => remove(i)} />
  );

  return (
    <div className="space-y-1.5 py-1">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          {items.map((v, i) => (
            <Sortable key={ids[i]} id={ids[i]!}>
              {(handle) =>
                cards ? (
                  <CollapsibleSection
                    className={cn("rounded-md border bg-surface-2", selected === i && "border-accent")}
                    defaultOpen={added.has(keys.keys[i]!)}
                    reveal={selected === i ? reveal : undefined}
                    title={itemTitle(node, v, i)}
                    actions={
                      <>
                        {handle}
                        {removeButton(i)}
                      </>
                    }
                  >
                    <div className="px-3 pb-2">
                      <Control node={item} path={[...path, i]} value={v} optional={false} label={itemTitle(node, v, i)} />
                    </div>
                  </CollapsibleSection>
                ) : (
                  <div className="flex items-center gap-1.5">
                    {handle}
                    <div className="min-w-0 flex-1">
                      <Control node={item} path={[...path, i]} value={v} optional={false} label={`${label} ${i + 1}`} />
                    </div>
                    {removeButton(i)}
                  </div>
                )
              }
            </Sortable>
          ))}
        </SortableContext>
      </DndContext>
      {item.kind === "variants" ? (
        <Menu>
          <MenuTrigger asChild>
            <Button variant="ghost" size="sm">
              <Plus /> Add {noun}
            </Button>
          </MenuTrigger>
          <MenuContent>
            {item.variants.map((v) => (
              <MenuItem key={v.value} onSelect={() => add(defaultValue(v.node))}>
                {optionLabel(item, v.value)}
              </MenuItem>
            ))}
          </MenuContent>
        </Menu>
      ) : (
        <Button variant="ghost" size="sm" onClick={() => add(defaultValue(item))}>
          <Plus /> Add {noun}
        </Button>
      )}
    </div>
  );
}

function KeyInput({ value, onRename, label }: { value: string; onRename(key: string): boolean; label: string }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => {
    if (text === value) return;
    if (text.trim() === "" || !onRename(text)) setText(value);
  };
  return <Input aria-label={label} value={text} className="w-full min-w-0 font-mono text-xs" onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} />;
}

function RecordControl({ node, path, value, label }: ControlOf<"record">) {
  const ctx = useForm();
  const obj = isObj(value) ? value : {};
  const entries = Object.entries(obj);
  const block = isBlock(node.value);
  const add = () => {
    let key = "new";
    for (let n = 2; key in obj; n++) key = `new${n}`;
    ctx.apply((s) => setIn(s, [...path, key], defaultValue(node.value)));
  };
  const rename = (from: string, to: string) => !(to in obj) && ctx.apply((s) => renameKey(s, path, from, to));
  const remove = (key: string) => (
    <IconButton label={`Remove ${key}`} icon={<X />} size="sm" tooltipSide="left" onClick={() => ctx.apply((s) => removeIn(s, [...path, key]))} />
  );
  return (
    <div className="space-y-1.5 py-1">
      {entries.map(([key, v], i) =>
        block ? (
          <div key={i} className="rounded-md border border-border bg-surface-2 px-2.5 py-2">
            <div className="flex items-center gap-1.5">
              <KeyInput label={`${label}: key`} value={key} onRename={(k) => rename(key, k)} />
              {remove(key)}
            </div>
            <Control node={node.value} path={[...path, key]} value={v} optional={false} label={`${label}: ${key}`} />
            <FieldErrors path={[...path, key]} />
          </div>
        ) : (
          <div key={i}>
            <div className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)_1.75rem] items-center gap-2">
              <KeyInput label={`${label}: key`} value={key} onRename={(k) => rename(key, k)} />
              <Control node={node.value} path={[...path, key]} value={v} optional={false} label={`${label}: ${key}`} />
              {remove(key)}
            </div>
            <FieldErrors path={[...path, key]} />
          </div>
        ),
      )}
      <Button variant="ghost" size="sm" onClick={add}>
        <Plus /> Add entry
      </Button>
    </div>
  );
}

function UnsupportedControl({ node }: ControlOf<"unsupported">) {
  return <span className="text-xs text-fg-muted">Edit in JSON ({node.zodType})</span>;
}

/** The control for each schema node kind. Typed as a full map, so a new kind cannot lack a control. */
export const CONTROLS: { [K in FormNodeKind]: ComponentType<ControlOf<K>> } = {
  object: ObjectControl,
  array: ArrayControl,
  tuple: TupleControl,
  record: RecordControl,
  string: StringControl,
  number: NumberControl,
  boolean: BooleanControl,
  enum: EnumControl,
  literal: LiteralControl,
  nullable: NullableControl,
  union: UnionControl,
  variants: VariantsControl,
  unsupported: UnsupportedControl,
};

/** Renders the node's control: an app widget named by `hint.widget` if there is one, else the kind's control. */
export function Control(props: ControlProps) {
  const widgets = useForm().widgets;
  const Widget = props.node.hint.widget ? widgets[props.node.hint.widget] : undefined;
  if (Widget) return <Widget {...props} />;
  const C = CONTROLS[props.node.kind] as ComponentType<ControlProps>;
  return <C {...props} />;
}
