import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Dataset, Variable } from "@linden/core";
import { ChevronRight, FolderPlus, GripVertical, Merge, Pencil, Trash, Upload, X } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { importData } from "./actions";
import { toggleCurve, type CurveSelection } from "./curveEdit";
import { CurveContextMenu } from "./CurveMenu";
import { variableTree, variableVisibility, type GroupNode } from "./specEdit";
import { useStore } from "./store";
import { Badge, Button, Checkbox, cn, CollapsibleSection, IconButton, Tooltip } from "./ui";
import { useView } from "./view";

/** "*Alnus*-type" → <i>Alnus</i>-type */
export function TaxonName({ name }: { name: string }) {
  return (
    <>
      {name.split(/(\*[^*]+\*)/).map((part, i) =>
        /^\*[^*]+\*$/.test(part) ? <i key={i}>{part.slice(1, -1)}</i> : <Fragment key={i}>{part}</Fragment>,
      )}
    </>
  );
}

/** Commits on the native "change" event (picker closed), not on every move, so one pick = one undo step. */
function ColourInput({ value, onCommit, disabled }: { value: string | undefined; onCommit: (c: string) => void; disabled: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const commit = useRef(onCommit);
  commit.current = onCommit;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onChange = () => commit.current(el.value);
    el.addEventListener("change", onChange);
    return () => el.removeEventListener("change", onChange);
  }, []);
  const hex = value && /^#[0-9a-f]{6}$/i.test(value) ? value : "#808080";
  return (
    <Tooltip content="Group colour">
      <input
        ref={ref}
        key={hex}
        type="color"
        defaultValue={hex}
        disabled={disabled}
        aria-label="Group colour"
        className="size-3.5 shrink-0 cursor-pointer appearance-none overflow-hidden rounded-[3px] border border-border-strong p-0 disabled:cursor-default [&::-moz-color-swatch]:border-0 [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch-wrapper]:p-0"
      />
    </Tooltip>
  );
}

// Drag ids: "g:<group id>" for groups, "v:<variable id>" for variables.
const gid = (id: string | undefined) => `g:${id ?? ""}`;
const vid = (id: string) => `v:${id}`;

const handleClass =
  "flex w-4 shrink-0 cursor-grab touch-none items-center justify-center rounded text-fg-muted opacity-0 transition-opacity duration-150 select-none " +
  "group-hover/row:opacity-100 focus-visible:opacity-100 active:cursor-grabbing [&_svg]:size-3.5";

function SortableGroup(props: { node: GroupNode; locked: boolean; highlight: boolean; header: ReactNode; children: ReactNode }) {
  const { node, locked } = props;
  const s = useSortable({ id: gid(node.id), disabled: locked || node.id === undefined });
  return (
    <div
      ref={s.setNodeRef}
      className={cn(
        "mb-1 rounded-md border border-dashed border-transparent pb-1 transition-colors duration-150",
        props.highlight && "border-accent-text bg-accent-subtle",
        s.isDragging && "opacity-40",
      )}
      style={{ transform: CSS.Translate.toString(s.transform), transition: s.transition }}
    >
      <div className="group/row flex h-7 items-center gap-1.5 pr-1">
        {node.id !== undefined ? (
          <span ref={s.setActivatorNodeRef} className={handleClass} aria-label="Drag to reorder groups" {...s.attributes} {...s.listeners}>
            <GripVertical />
          </span>
        ) : (
          <span className="w-4 shrink-0" />
        )}
        {props.header}
      </div>
      {props.children}
      {node.members.length === 0 && <div className="py-1 pl-10 text-xs text-fg-muted italic">Drop taxa here</div>}
    </div>
  );
}

function SortableVariable(props: { v: Variable; locked: boolean; children: ReactNode; below?: ReactNode }) {
  const s = useSortable({ id: vid(props.v.id), disabled: props.locked });
  return (
    <div
      ref={s.setNodeRef}
      className={cn(s.isDragging && "opacity-40")}
      style={{ transform: CSS.Translate.toString(s.transform), transition: s.transition }}
    >
      <div className="group/row flex h-7 items-center gap-1.5 rounded-md pr-1 transition-colors duration-150 hover:bg-surface-3">
        <span ref={s.setActivatorNodeRef} className={handleClass} aria-label="Drag to reorder or move to another group" {...s.attributes} {...s.listeners}>
          <GripVertical />
        </span>
        {props.children}
      </div>
      {props.below}
    </div>
  );
}

function DatasetBlock({ ds }: { ds: Dataset }) {
  const { spec, presets, specErrors } = useStore();
  const store = useStore.getState();
  const tree = useMemo(() => variableTree(spec, presets, ds), [spec, presets, ds]);
  const visibility = useMemo(() => variableVisibility(spec, presets, tree.prepared), [spec, presets, tree]);
  const locked = specErrors.length > 0;
  // Shared with the preview: the selection the Curve tab styles (and merge acts on).
  const curveSelection = useView((s) => s.curveSelection);
  const selectCurves = useView((s) => s.selectCurves);
  const selected = curveSelection?.kind === "curves" ? curveSelection.curves.filter((c) => c.dataset === ds.id).map((c) => c.id) : [];
  const groupSelected = (id: string | undefined) => curveSelection?.kind === "group" && curveSelection.dataset === ds.id && curveSelection.group === id;
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [active, setActive] = useState<string | null>(null);
  const [overGroup, setOverGroup] = useState<string | undefined>();

  // Drop selections that no longer exist (after merge, undo, …).
  const present = new Set(tree.prepared.variables.map((v) => v.id));
  const sel = selected.filter((id) => present.has(id));

  const groupOf = (varId: string) => tree.groups.find((g) => g.members.some((m) => m.id === varId));
  const groupIds = tree.groups.flatMap((g) => (g.id === undefined ? [] : [g.id]));

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Groups only collide with groups. Variables prefer the variable under the pointer, then the
  // group under the pointer (e.g. an empty group), then the nearest variable.
  const collisions: CollisionDetection = (args) => {
    const of = (prefix: string) => args.droppableContainers.filter((c) => String(c.id).startsWith(prefix));
    if (String(args.active.id).startsWith("g:")) return closestCenter({ ...args, droppableContainers: of("g:") });
    const onVariable = pointerWithin({ ...args, droppableContainers: of("v:") });
    if (onVariable.length) return onVariable;
    const onGroup = pointerWithin({ ...args, droppableContainers: of("g:") });
    return onGroup.length ? onGroup : closestCenter({ ...args, droppableContainers: of("v:") });
  };

  /** Target group (and variable, if dropped on one) of a drop. */
  const target = (overId: string): { group: GroupNode | undefined; varId?: string } =>
    overId.startsWith("v:") ? { group: groupOf(overId.slice(2)), varId: overId.slice(2) } : { group: tree.groups.find((g) => gid(g.id) === overId) };

  const onDragEnd = ({ active: a, over }: DragEndEvent) => {
    setActive(null);
    setOverGroup(undefined);
    if (!over || locked) return;
    const activeId = String(a.id);
    const { group, varId } = target(String(over.id));
    if (group?.id === undefined) return; // "Ungrouped" cannot be targeted: assignments name a group
    if (activeId.startsWith("g:")) {
      const from = groupIds.indexOf(activeId.slice(2));
      const to = groupIds.indexOf(group.id);
      if (from !== -1 && from !== to) store.reorderGroups(ds.id, arrayMove(groupIds, from, to));
      return;
    }
    const moving = activeId.slice(2);
    const index = varId === undefined ? group.members.length : group.members.findIndex((m) => m.id === varId);
    store.moveVariable(ds.id, moving, group.id, index);
  };

  /** Click: this taxon in the Curve tab; Shift / Ctrl / Cmd-click adds or removes it. */
  const toggleSelect = (id: string, additive: boolean) => {
    if (!locked) selectCurves(toggleCurve(curveSelection, { dataset: ds.id, id, panel: null }, additive));
  };

  /** Right-click on a taxon name or a group name (context menu). */
  const menuTarget = (e: ReactMouseEvent): CurveSelection | null => {
    const el = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-curve],[data-group]") : null;
    if (locked || !el) return null;
    if (el.dataset.curve !== undefined) return { kind: "curves", curves: [{ dataset: ds.id, id: el.dataset.curve, panel: null }] };
    return { kind: "group", dataset: ds.id, group: el.dataset.group!, panel: null };
  };

  const activeLabel = active?.startsWith("v:")
    ? tree.prepared.variables.find((v) => v.id === active.slice(2))?.name
    : tree.groups.find((g) => gid(g.id) === active)?.name;

  return (
    <CollapsibleSection
      title={ds.name}
      actions={
        <>
          <IconButton
            label="New group"
            icon={<FolderPlus />}
            size="sm"
            disabled={locked}
            onClick={() => {
              const name = prompt("Name of the new group:");
              if (name?.trim()) store.createGroup(ds.id, name.trim());
            }}
          />
          <IconButton
            label={sel.length < 2 ? "Merge taxa (select two or more: Ctrl/Cmd-click the names)" : `Merge ${sel.length} taxa into…`}
            icon={<Merge />}
            size="sm"
            disabled={locked || sel.length < 2}
            onClick={() => {
              const first = tree.prepared.variables.find((v) => v.id === sel[0]);
              const name = prompt(`Merge ${sel.length} taxa into (name; *italic* allowed):`, first?.name ?? "");
              if (name?.trim()) {
                store.mergeVariables(ds.id, sel, name.trim());
                selectCurves(null);
              }
            }}
          />
          <IconButton
            label="Remove dataset and its panels"
            icon={<X />}
            size="sm"
            onClick={() => {
              if (confirm(`Remove dataset "${ds.name}" and its panels?`)) store.removeDataset(ds.id);
            }}
          />
        </>
      }
    >
      <CurveContextMenu targetAt={menuTarget}>
        <div className="px-2 pb-3">
          <p className="mb-2 px-1 text-2xs text-fg-muted tabular-nums">
            {ds.samples.length} samples · {ds.variables.length} variables · depth in {ds.depthUnit}
          </p>

          <DndContext
            sensors={sensors}
            collisionDetection={collisions}
            onDragStart={(e) => setActive(String(e.active.id))}
            onDragOver={(e) => setOverGroup(e.over && String(e.active.id).startsWith("v:") ? target(String(e.over.id)).group?.id : undefined)}
            onDragEnd={onDragEnd}
            onDragCancel={() => {
              setActive(null);
              setOverGroup(undefined);
            }}
          >
            <SortableContext items={tree.groups.map((g) => gid(g.id))} strategy={verticalListSortingStrategy}>
              {tree.groups.map((g) => (
                <SortableGroup
                  key={gid(g.id)}
                  node={g}
                  locked={locked}
                  highlight={overGroup !== undefined && overGroup === g.id && groupOf(active?.slice(2) ?? "")?.id !== g.id}
                  header={
                    <>
                      {g.id !== undefined && <ColourInput value={g.colour} disabled={locked} onCommit={(c) => store.recolourGroup(ds.id, g.id!, c)} />}
                      {g.id !== undefined && g.members.length > 0 ? (
                        <button
                          type="button"
                          aria-pressed={groupSelected(g.id)}
                          disabled={locked}
                          data-group={g.id}
                          title="Click to style the group's curves, right-click for quick actions"
                          onClick={() => selectCurves({ kind: "group", dataset: ds.id, group: g.id!, panel: null })}
                          className={cn(
                            "min-w-0 flex-1 truncate rounded px-1 text-left text-2xs font-semibold tracking-wide uppercase transition-colors duration-150",
                            groupSelected(g.id) ? "bg-accent-subtle text-accent-text" : "text-fg-secondary hover:text-fg",
                          )}
                        >
                          {g.name}
                        </button>
                      ) : (
                        <span className={cn("min-w-0 flex-1 truncate text-2xs font-semibold tracking-wide uppercase", g.members.length ? "text-fg-secondary" : "text-fg-muted")}>{g.name}</span>
                      )}
                      {g.id !== undefined && (
                        <span className="flex opacity-0 transition-opacity duration-150 group-hover/row:opacity-100 focus-within:opacity-100">
                          <IconButton
                            label="Rename group"
                            icon={<Pencil />}
                            size="sm"
                            className="size-6 [&_svg]:size-3.5"
                            disabled={locked}
                            onClick={() => {
                              const name = prompt("Rename group:", g.name);
                              if (name?.trim() && name.trim() !== g.name) store.renameGroup(ds.id, g.id!, name.trim());
                            }}
                          />
                          {g.members.length === 0 && (
                            <IconButton
                              label="Delete empty group (empty groups are not drawn)"
                              icon={<Trash />}
                              size="sm"
                              className="size-6 [&_svg]:size-3.5"
                              disabled={locked}
                              onClick={() => store.deleteGroup(ds.id, g.id!)}
                            />
                          )}
                        </span>
                      )}
                      <Badge>{g.members.length}</Badge>
                    </>
                  }
                >
                  <SortableContext items={g.members.map((v) => vid(v.id))} strategy={verticalListSortingStrategy}>
                    {g.members.map((v) => {
                      const vis = visibility.get(v.id);
                      const disabled = locked || (vis?.visible === true && !vis.canHide);
                      const sources = tree.merges.get(v.id);
                      const open = expanded.has(v.id);
                      return (
                        <SortableVariable
                          key={v.id}
                          v={v}
                          locked={locked}
                          below={
                            sources &&
                            open && (
                              <div className="mb-1 ml-[46px] border-l border-border pl-2.5">
                                {sources.map((s) => (
                                  <div key={s.id} className="py-0.5 text-xs text-fg-secondary">
                                    <TaxonName name={s.name} />
                                  </div>
                                ))}
                                <Button variant="ghost" size="sm" className="-ml-2.5 h-6" disabled={locked} onClick={() => store.unmergeVariable(ds.id, v.id)}>
                                  Unmerge
                                </Button>
                              </div>
                            )
                          }
                        >
                          <Checkbox
                            checked={vis?.visible ?? false}
                            disabled={disabled}
                            aria-label={`Show ${v.name.replace(/\*/g, "")} in the diagram`}
                            title={locked ? "Fix the spec errors first" : disabled ? "A panel needs at least one variable" : "Show in the diagram"}
                            onCheckedChange={(c) => store.setVariableVisible(ds.id, v.id, c)}
                          />
                          <span
                            role="button"
                            tabIndex={0}
                            aria-pressed={sel.includes(v.id)}
                            data-curve={v.id}
                            className={cn(
                              "min-w-0 flex-1 cursor-pointer truncate rounded px-1 text-sm transition-colors duration-150",
                              sel.includes(v.id) ? "bg-accent-subtle text-accent-text" : "text-fg",
                            )}
                            title={`${v.id} · ${v.kind} — click to style its curve, Shift/Ctrl/Cmd-click to add to the selection, right-click for quick actions`}
                            onClick={(e) => toggleSelect(v.id, e.ctrlKey || e.metaKey || e.shiftKey)}
                            onKeyDown={(e) => {
                              if (e.key !== "Enter" && e.key !== " ") return;
                              e.preventDefault();
                              toggleSelect(v.id, e.ctrlKey || e.metaKey || e.shiftKey);
                            }}
                          >
                            <TaxonName name={v.name} />
                          </span>
                          {sources && (
                            <button
                              type="button"
                              className="flex items-center gap-0.5 rounded"
                              aria-expanded={open}
                              title={open ? "Hide merged sources" : "Show merged sources"}
                              onClick={() => setExpanded(new Set(open ? [...expanded].filter((x) => x !== v.id) : [...expanded, v.id]))}
                            >
                              <Badge variant="accent">
                                merged
                                <ChevronRight className={cn("transition-transform duration-150", open && "rotate-90")} />
                              </Badge>
                            </button>
                          )}
                        </SortableVariable>
                      );
                    })}
                  </SortableContext>
                </SortableGroup>
              ))}
            </SortableContext>
            <DragOverlay>
              {activeLabel !== undefined ? (
                <div className="flex h-7 items-center gap-1.5 rounded-md border border-border-strong bg-surface-raised px-2 text-sm shadow-overlay">
                  <GripVertical className="size-3.5 text-fg-muted" />
                  <TaxonName name={activeLabel} />
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        </div>
      </CurveContextMenu>
    </CollapsibleSection>
  );
}

export function VariableList() {
  const datasets = useStore((s) => s.datasets);
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-border pr-2 pl-3">
        <h2 className="text-xs font-semibold">Data</h2>
        <IconButton label="Import CSV" icon={<Upload />} size="sm" onClick={() => void importData()} />
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {datasets.length === 0 ? (
          <div className="p-4 text-xs text-fg-muted">
            <p>No data yet.</p>
            <Button variant="secondary" size="sm" className="mt-3" onClick={() => void importData()}>
              <Upload /> Import CSV
            </Button>
          </div>
        ) : (
          datasets.map((ds) => <DatasetBlock key={ds.id} ds={ds} />)
        )}
      </div>
    </div>
  );
}
