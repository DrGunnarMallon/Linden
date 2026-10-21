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
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { variableTree, variableVisibility, type GroupNode } from "./specEdit";
import { useStore } from "./store";

/** "*Alnus*-type" → <i>Alnus</i>-type */
function TaxonName({ name }: { name: string }) {
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
  return <input ref={ref} key={hex} type="color" defaultValue={hex} disabled={disabled} title="Group colour" />;
}

// Drag ids: "g:<group id>" for groups, "v:<variable id>" for variables.
const gid = (id: string | undefined) => `g:${id ?? ""}`;
const vid = (id: string) => `v:${id}`;

function SortableGroup(props: { node: GroupNode; locked: boolean; highlight: boolean; header: ReactNode; children: ReactNode }) {
  const { node, locked } = props;
  const s = useSortable({ id: gid(node.id), disabled: locked || node.id === undefined });
  return (
    <div
      ref={s.setNodeRef}
      className={`group${node.members.length === 0 ? " empty-group" : ""}${props.highlight ? " drop-target" : ""}${s.isDragging ? " dragging" : ""}`}
      style={{ transform: CSS.Translate.toString(s.transform), transition: s.transition }}
    >
      <h4>
        {node.id !== undefined && (
          <span ref={s.setActivatorNodeRef} className="handle" title="Drag to reorder groups" {...s.attributes} {...s.listeners}>
            ⠿
          </span>
        )}
        {props.header}
      </h4>
      {props.children}
      {node.members.length === 0 && <div className="muted empty">Drop taxa here</div>}
    </div>
  );
}

function SortableVariable(props: { v: Variable; locked: boolean; children: ReactNode }) {
  const s = useSortable({ id: vid(props.v.id), disabled: props.locked });
  return (
    <div
      ref={s.setNodeRef}
      className={`variable${s.isDragging ? " dragging" : ""}`}
      style={{ transform: CSS.Translate.toString(s.transform), transition: s.transition }}
    >
      <span ref={s.setActivatorNodeRef} className="handle" title="Drag to reorder or move to another group" {...s.attributes} {...s.listeners}>
        ⠿
      </span>
      {props.children}
    </div>
  );
}

function DatasetBlock({ ds }: { ds: Dataset }) {
  const { spec, presets, specErrors } = useStore();
  const store = useStore.getState();
  const tree = useMemo(() => variableTree(spec, presets, ds), [spec, presets, ds]);
  const visibility = useMemo(() => variableVisibility(spec, presets, tree.prepared), [spec, presets, tree]);
  const locked = specErrors.length > 0;
  const [selected, setSelected] = useState<string[]>([]);
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

  const toggleSelect = (id: string, additive: boolean) =>
    setSelected(additive ? (sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]) : sel.length === 1 && sel[0] === id ? [] : [id]);

  const activeLabel = active?.startsWith("v:")
    ? tree.prepared.variables.find((v) => v.id === active.slice(2))?.name
    : tree.groups.find((g) => gid(g.id) === active)?.name;

  return (
    <section className="dataset">
      <h3>
        {ds.name}
        <button
          className="link"
          title="Remove this dataset and its panels"
          onClick={() => {
            if (confirm(`Remove dataset "${ds.name}" and its panels?`)) store.removeDataset(ds.id);
          }}
        >
          ×
        </button>
      </h3>
      <div className="muted">
        {ds.samples.length} samples · {ds.variables.length} variables · depth in {ds.depthUnit}
      </div>
      <div className="actions">
        <button
          disabled={locked}
          onClick={() => {
            const name = prompt("Name of the new group:");
            if (name?.trim()) store.createGroup(ds.id, name.trim());
          }}
        >
          New group
        </button>
        <button
          disabled={locked || sel.length < 2}
          title={sel.length < 2 ? "Select two or more taxa (Ctrl/Cmd-click the names)" : undefined}
          onClick={() => {
            const first = tree.prepared.variables.find((v) => v.id === sel[0]);
            const name = prompt(`Merge ${sel.length} taxa into (name; *italic* allowed):`, first?.name ?? "");
            if (name?.trim()) {
              store.mergeVariables(ds.id, sel, name.trim());
              setSelected([]);
            }
          }}
        >
          Merge into…
        </button>
      </div>

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
                  <span className="name">{g.name}</span>
                  {g.id !== undefined && (
                    <>
                      <button
                        className="link"
                        disabled={locked}
                        onClick={() => {
                          const name = prompt("Rename group:", g.name);
                          if (name?.trim() && name.trim() !== g.name) store.renameGroup(ds.id, g.id!, name.trim());
                        }}
                      >
                        rename
                      </button>
                      <ColourInput value={g.colour} disabled={locked} onCommit={(c) => store.recolourGroup(ds.id, g.id!, c)} />
                      {g.members.length === 0 && (
                        <button className="link" disabled={locked} title="Empty groups are not drawn in the diagram" onClick={() => store.deleteGroup(ds.id, g.id!)}>
                          delete
                        </button>
                      )}
                    </>
                  )}
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
                    <SortableVariable key={v.id} v={v} locked={locked}>
                      <input
                        type="checkbox"
                        checked={vis?.visible ?? false}
                        disabled={disabled}
                        title={locked ? "Fix the spec errors first" : disabled ? "A panel needs at least one variable" : "Show in the diagram"}
                        onChange={(e) => store.setVariableVisible(ds.id, v.id, e.target.checked)}
                      />
                      {sources && (
                        <button
                          className="link expander"
                          title={open ? "Hide sources" : "Show merged sources"}
                          onClick={() => setExpanded(new Set(open ? [...expanded].filter((x) => x !== v.id) : [...expanded, v.id]))}
                        >
                          {open ? "▾" : "▸"}
                        </button>
                      )}
                      <span
                        className={`name${sel.includes(v.id) ? " selected" : ""}`}
                        title={`${v.id} · ${v.kind} — click to select, Ctrl/Cmd-click to add to the selection`}
                        onClick={(e) => toggleSelect(v.id, e.ctrlKey || e.metaKey || e.shiftKey)}
                      >
                        <TaxonName name={v.name} />
                      </span>
                      {sources && <span className="muted"> merged</span>}
                      {sources && open && (
                        <div className="sources">
                          {sources.map((s) => (
                            <div key={s.id} className="muted">
                              <TaxonName name={s.name} />
                            </div>
                          ))}
                          <button className="link" disabled={locked} onClick={() => store.unmergeVariable(ds.id, v.id)}>
                            unmerge
                          </button>
                        </div>
                      )}
                    </SortableVariable>
                  );
                })}
              </SortableContext>
            </SortableGroup>
          ))}
        </SortableContext>
        <DragOverlay>{activeLabel !== undefined ? <div className="drag-overlay"><TaxonName name={activeLabel} /></div> : null}</DragOverlay>
      </DndContext>
    </section>
  );
}

export function VariableList() {
  const datasets = useStore((s) => s.datasets);
  if (datasets.length === 0) return <p className="muted">No data. Use “Import CSV…” above.</p>;
  return (
    <>
      {datasets.map((ds) => (
        <DatasetBlock key={ds.id} ds={ds} />
      ))}
    </>
  );
}
