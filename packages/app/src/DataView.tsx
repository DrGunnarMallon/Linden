// Data tab (SPEC §11): the dataset as an editable sheet (Glide Data Grid). Rows are samples; the depth
// (and age) columns are frozen; every variable has a three-tier header: group ▾, kind ▾ and its name
// (double-click to rename). Every edit is one store edit (one undo step) through core's edit operations;
// the figure follows debounced. null shows as a muted "—", 0 as 0; edited cells carry an accent mark.
// A column can be declared the error of another ("Use as error for…"); ages can come from an imported
// age–depth model (toolbar "Age model…").

import "@glideapps/glide-data-grid/dist/index.css";
import {
  DataEditor,
  GridCellKind,
  type DataEditorRef,
  type DrawCellCallback,
  type DrawHeaderCallback,
  type EditListItem,
  type GridCell,
  type GridColumn,
  type GridSelection,
  type Item,
  type Rectangle,
  type Theme as GlideTheme,
} from "@glideapps/glide-data-grid";
import {
  addSample,
  addVariable,
  applyAgeModel,
  cleanupSpec,
  danglingReferences,
  datasetFromClipboard,
  deleteSample,
  deleteVariable,
  markupRuns,
  MeasurementKindSchema,
  parseAgeModel,
  parseClipboard,
  provenance,
  renameVariable,
  revertCell,
  setCompanion,
  setVariableKind,
  setVariableUnit,
  sortSamplesByDepth,
  stripMarkup,
  type ClipboardImport,
  type ClipboardTable,
  type Dataset,
  type EditResult,
  type ErrorRole,
  type MeasurementKind,
  type Variable,
} from "@linden/core";
import { ArrowDownWideNarrow, ClipboardPaste, Columns3, Download, History, Rows3 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent as ReactClipboardEvent, type RefObject } from "react";
import { exportData } from "./actions";
import { AgeModelDialog, type PendingAgeModel } from "./AgeModelDialog";
import { assignGroup, editSheetCell, effectiveGroup, hasAgeColumn, insertDepth, pasteIntoSheet, pasteNeeds, sheetColumns, type SheetColumn } from "./dataEdit";
import { PasteDialog } from "./PasteDialog";
import { variableTree } from "./specEdit";
import { useStore } from "./store";
import { useTheme } from "./theme";
import {
  Button,
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
  MenuTrigger,
  MOD_KEY,
  Select,
  toast,
} from "./ui";
import { useView } from "./view";

/** Height of one header tier (group, kind, name) in px. */
const TIER = 22;
const KINDS = MeasurementKindSchema.options;
const NEW_GROUP = "__new__";
const ERROR_ROLES: { role: ErrorRole; label: string }[] = [
  { role: "se", label: "± SE" },
  { role: "sd", label: "± SD" },
  { role: "lower", label: "Lower bound" },
  { role: "upper", label: "Upper bound" },
];

/** "se of WTD" for the header's kind tier. */
function companionText(ds: Dataset, v: Variable): string {
  if (!v.companion) return "";
  const target = ds.variables.find((x) => x.id === v.companion!.errorOf);
  const role = ERROR_ROLES.find((r) => r.role === v.companion!.role)?.label ?? v.companion.role;
  return ` · ${role} of ${target ? stripMarkup(target.name) : v.companion.errorOf}`;
}

/** Shows edit warnings: the first one, and how many more. */
function report(warnings: readonly string[]): void {
  if (warnings.length === 0) return;
  toast(warnings[0]!, { description: warnings.length > 1 ? `…and ${warnings.length - 1} more.` : undefined });
}

/** Glide theme from the app's CSS variables (follows the light/dark UI theme). */
function glideTheme(): Partial<GlideTheme> {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return {
    accentColor: v("--accent"),
    accentFg: v("--on-accent"),
    accentLight: v("--accent-subtle"),
    textDark: v("--text"),
    textMedium: v("--text-secondary"),
    textLight: v("--text-muted"),
    textHeader: v("--text-secondary"),
    textHeaderSelected: v("--on-accent"),
    bgIconHeader: v("--text-muted"),
    fgIconHeader: v("--surface-2"),
    bgCell: v("--surface-2"),
    bgCellMedium: v("--surface-1"),
    bgHeader: v("--surface-1"),
    bgHeaderHasFocus: v("--surface-3"),
    bgHeaderHovered: v("--surface-3"),
    borderColor: v("--border"),
    horizontalBorderColor: v("--border"),
    headerBottomBorderColor: v("--border-strong"),
    linkColor: v("--accent-text"),
    fontFamily: getComputedStyle(document.body).fontFamily,
    baseFontStyle: "13px",
    headerFontStyle: "600 12px",
    editorFontSize: "13px",
  };
}

/** What a menu acts on: a cell, a whole column (header), or a header tier's dropdown. */
type MenuState =
  | { at: Rectangle; part: "cell"; row: number; col: number }
  | { at: Rectangle; part: "column" | "group" | "kind"; col: number };

export function DataView() {
  const datasets = useStore((s) => s.datasets);
  const chosen = useView((s) => s.dataDataset);
  const setChosen = useView((s) => s.setDataDataset);
  const ds = datasets.find((d) => d.id === chosen) ?? datasets[0];
  if (!ds) return <p className="p-8 text-sm text-fg-muted">No data yet: import a file or start a new project.</p>;
  return (
    <div className="flex h-full flex-col">
      <DataToolbar ds={ds} datasets={datasets} onChoose={setChosen} />
      <div className="min-h-0 flex-1">
        <DataSheet key={ds.id} ds={ds} />
      </div>
    </div>
  );
}

function edit(datasetId: string, fn: (ds: Dataset) => EditResult): void {
  report(useStore.getState().editData(datasetId, fn));
}

/** Clipboard text through the async Clipboard API (toolbar button; Ctrl/Cmd+V works without it). */
async function readClipboard(): Promise<string | undefined> {
  try {
    return await navigator.clipboard.readText();
  } catch {
    toast("Could not read the clipboard", { variant: "error", description: "Click into the sheet and press Ctrl/Cmd+V instead." });
    return undefined;
  }
}

function DataToolbar({ ds, datasets, onChoose }: { ds: Dataset; datasets: Dataset[]; onChoose(id: string): void }) {
  const [ageModel, setAgeModel] = useState<PendingAgeModel | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const addRow = () => edit(ds.id, (d) => addSample(d, { depth: insertDepth(d, d.samples.length) }, d.samples.length));
  const openAgeModel = async (f: File | undefined) => {
    if (!f) return;
    const table = parseAgeModel(await f.text());
    if (table.rows.length === 0 || table.columns.length < 2) {
      toast("Not an age–depth model", { variant: "error", description: table.warnings[0] ?? "Expected a table with a depth and an age column." });
      return;
    }
    setAgeModel({ table, source: f.name });
  };
  const addColumn = () => {
    const name = prompt("Name of the new variable (*italic* for genera and species):")?.trim();
    if (name) edit(ds.id, (d) => addVariable(d, { name }));
  };
  return (
    <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border bg-surface-1 px-2">
      {datasets.length > 1 && (
        <Select label="Dataset" value={ds.id} onValueChange={onChoose} options={datasets.map((d) => ({ value: d.id, label: d.name }))} className="mr-1 h-7 w-48" />
      )}
      <Button variant="ghost" size="sm" onClick={addRow}>
        <Rows3 /> Add sample
      </Button>
      <Button variant="ghost" size="sm" onClick={addColumn}>
        <Columns3 /> Add variable
      </Button>
      <Button variant="ghost" size="sm" onClick={() => edit(ds.id, sortSamplesByDepth)}>
        <ArrowDownWideNarrow /> Sort by depth
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() =>
          void readClipboard().then((text) => {
            if (text) document.dispatchEvent(new CustomEvent("linden:paste", { detail: text }));
          })
        }
      >
        <ClipboardPaste /> Paste
      </Button>
      <Button variant="ghost" size="sm" disabled={ds.samples.length === 0} onClick={() => file.current?.click()} title="Ages from an age–depth model (e.g. Bacon's *_ages.txt), interpolated to the sample depths">
        <History /> Age model…
      </Button>
      <input
        ref={file}
        type="file"
        accept=".csv,.tsv,.txt"
        className="hidden"
        onChange={(e) => {
          void openAgeModel(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <span className="flex-1" />
      <span className="mr-2 truncate text-xs text-fg-muted tabular-nums" title={ds.ageSource ? `Ages: ${ds.ageSource}` : undefined}>
        {ds.samples.length} samples × {ds.variables.length} variables · depth in {ds.depthUnit}
        {ds.ageSource ? " · ages from an age–depth model" : ""}
      </span>
      <Button variant="secondary" size="sm" onClick={exportData} disabled={ds.variables.length === 0 && ds.samples.length === 0}>
        <Download /> Export CSV
      </Button>
      <AgeModelDialog
        ds={ds}
        pending={ageModel}
        onCancel={() => setAgeModel(null)}
        onApply={(choice) => {
          const table = ageModel!.table;
          setAgeModel(null);
          edit(ds.id, (d) => applyAgeModel(d, table, choice));
        }}
      />
    </div>
  );
}

function isTextField(el: EventTarget | null): boolean {
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
}

function DataSheet({ ds }: { ds: Dataset }) {
  const spec = useStore((s) => s.spec);
  const presets = useStore((s) => s.presets);
  const snapshot = useStore((s) => s.imported.find((d) => d.id === ds.id));
  const uiTheme = useTheme((s) => s.theme);
  const theme = useMemo(() => glideTheme(), [uiTheme]);
  const portal = useRef<HTMLDivElement>(null);
  const grid = useRef<DataEditorRef>(null);
  const container = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<GridSelection | undefined>(undefined);
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [renaming, setRenaming] = useState<{ col: number; at: Rectangle } | null>(null);
  const [pending, setPending] = useState<ClipboardTable | null>(null);

  const showAge = hasAgeColumn(ds);
  const cols = useMemo(() => sheetColumns(ds, showAge), [ds, showAge]);
  const prov = useMemo(() => provenance(snapshot), [snapshot]);
  const tree = useMemo(() => {
    try {
      return variableTree(spec, presets, ds);
    } catch {
      return undefined; // unrenderable spec: groups from the data only
    }
  }, [spec, presets, ds]);
  const groupNames = useMemo(() => new Map((tree?.prepared.groups ?? ds.groups).map((g) => [g.id, g.name])), [tree, ds.groups]);

  const columns = useMemo<GridColumn[]>(
    () =>
      cols.map((c) => {
        const id = c.kind === "variable" ? `v:${ds.variables[c.index]!.id}` : c.kind;
        const title = c.kind === "depth" ? "Depth" : c.kind === "age" ? "Age" : stripMarkup(ds.variables[c.index]!.name);
        return { id, title, width: widths[id] ?? (c.kind === "variable" ? 104 : 84) };
      }),
    [cols, ds.variables, widths],
  );

  const variableAt = (col: number) => {
    const c = cols[col];
    return c?.kind === "variable" ? ds.variables[c.index] : undefined;
  };

  const getCellContent = useCallback(
    ([col, row]: Item): GridCell => {
      const c = cols[col];
      const s = ds.samples[row];
      let text = "";
      if (c && s) {
        if (c.kind === "depth") text = String(s.depth);
        else if (c.kind === "age") text = s.age === undefined ? "" : String(s.age);
        else {
          const x = ds.values[row]?.[c.index] ?? null;
          const codes = ds.variables[c.index]!.codes;
          text = x === null ? "" : codes ? (codes[x] ?? "") : String(x);
        }
      }
      return { kind: GridCellKind.Text, data: text, displayData: text, allowOverlay: true, contentAlign: "right" };
    },
    [cols, ds],
  );

  const drawCell = useCallback<DrawCellCallback>(
    (args, drawContent) => {
      drawContent();
      const { ctx, rect, col, row, cell, theme: t } = args;
      const c = cols[col];
      if (!c || c.kind === "depth") return;
      // Glide reuses the context's fill and font for the next cells.
      ctx.save();
      if (cell.kind === GridCellKind.Text && cell.data === "") {
        // null = not assessed: a muted dash (0 is drawn as 0 by Glide).
        ctx.fillStyle = t.textLight;
        ctx.font = `13px ${t.fontFamily}`;
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        ctx.fillText("—", rect.x + rect.width - t.cellHorizontalPadding, rect.y + rect.height / 2);
      }
      if (c.kind === "variable" && prov.isEdited(ds, row, c.index)) {
        ctx.fillStyle = t.accentColor;
        ctx.beginPath();
        ctx.moveTo(rect.x + rect.width - 7, rect.y + 1);
        ctx.lineTo(rect.x + rect.width - 1, rect.y + 1);
        ctx.lineTo(rect.x + rect.width - 1, rect.y + 7);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    },
    [cols, ds, prov],
  );

  const drawHeader = useCallback<DrawHeaderCallback>(
    ({ ctx, columnIndex, rect, theme: t, isSelected }) => {
      const c = cols[columnIndex];
      if (!c) return;
      const fg = isSelected ? t.textHeaderSelected : t.textDark;
      const muted = isSelected ? t.textHeaderSelected : t.textLight;
      const pad = t.cellHorizontalPadding;
      const mid = (tier: number) => rect.y + tier * TIER + TIER / 2;
      ctx.save();
      ctx.beginPath();
      ctx.rect(rect.x, rect.y, rect.width, rect.height);
      ctx.clip();
      ctx.textBaseline = "middle";
      ctx.strokeStyle = t.borderColor;
      ctx.lineWidth = 1;
      for (const tier of [1, 2]) {
        ctx.beginPath();
        ctx.moveTo(rect.x, Math.round(rect.y + tier * TIER) + 0.5);
        ctx.lineTo(rect.x + rect.width, Math.round(rect.y + tier * TIER) + 0.5);
        ctx.stroke();
      }
      const dropdown = (tier: number, text: string, dim: boolean) => {
        ctx.font = `12px ${t.fontFamily}`;
        ctx.fillStyle = dim ? muted : fg;
        ctx.fillText(text, rect.x + pad, mid(tier), rect.width - 2 * pad - 10);
        ctx.fillStyle = muted;
        ctx.fillText("▾", rect.x + rect.width - pad - 7, mid(tier));
      };
      if (c.kind === "variable") {
        const v = ds.variables[c.index]!;
        const group = effectiveGroup(spec, ds.id, ds, v.id);
        dropdown(0, group === undefined ? "no group" : (groupNames.get(group) ?? group), group === undefined);
        dropdown(1, (v.unit ? `${v.kind} · ${v.unit}` : v.kind) + companionText(ds, v), false);
        // The name with *italic* markup rendered.
        let x = rect.x + pad;
        ctx.fillStyle = fg;
        for (const run of markupRuns(v.name)) {
          ctx.font = `${run.italic ? "italic " : ""}600 12px ${t.fontFamily}`;
          ctx.fillText(run.text, x, mid(2));
          x += ctx.measureText(run.text).width;
        }
      } else {
        ctx.font = `600 12px ${t.fontFamily}`;
        ctx.fillStyle = fg;
        const unit = c.kind === "depth" ? ds.depthUnit : ds.ageUnit;
        ctx.fillText(`${c.kind === "depth" ? "Depth" : "Age"}${unit ? ` (${unit})` : ""}`, rect.x + pad, mid(2));
      }
      ctx.restore();
    },
    [cols, ds, spec, groupNames],
  );

  const onCellsEdited = useCallback(
    (items: readonly EditListItem[]) => {
      edit(ds.id, (d0) =>
        items.reduce<EditResult>(
          (acc, { location: [col, row], value }) => {
            const r = editSheetCell(acc.dataset, { row, col }, value.kind === GridCellKind.Text ? value.data : "", showAge);
            return { dataset: r.dataset, warnings: [...acc.warnings, ...r.warnings] };
          },
          { dataset: d0, warnings: [] },
        ),
      );
      return true;
    },
    [ds.id, showAge],
  );

  // ── Paste ────────────────────────────────────────────────────────────────────────────────
  const paste = useCallback(
    (text: string) => {
      const table = parseClipboard(text);
      if (table.cells.length === 0) return;
      const current = useStore.getState().datasets.find((d) => d.id === ds.id) ?? ds;
      if (current.samples.length === 0 && current.variables.length === 0) {
        setPending(table);
        return;
      }
      const [col, row] = selection?.current?.cell ?? [0, 0];
      const needs = pasteNeeds(current, { row, col }, table, showAge);
      const addColumns =
        needs.columns === 0 || confirm(`The pasted block is ${needs.columns} column${needs.columns > 1 ? "s" : ""} wider than the sheet. Add ${needs.columns} new variable${needs.columns > 1 ? "s" : ""}?`);
      edit(ds.id, (d) => pasteIntoSheet(d, { row, col }, table, { addColumns, showAge }));
    },
    [ds, selection, showAge],
  );

  const onPaste = (e: ReactClipboardEvent) => {
    if (isTextField(e.target)) return; // the cell editor pastes natively
    const text = e.clipboardData.getData("text/plain");
    if (!text) return;
    e.preventDefault();
    paste(text);
  };

  // The toolbar's Paste button.
  useEffect(() => {
    const onToolbarPaste = (e: Event) => paste((e as CustomEvent<string>).detail);
    document.addEventListener("linden:paste", onToolbarPaste);
    return () => document.removeEventListener("linden:paste", onToolbarPaste);
  }, [paste]);

  // An empty sheet takes Ctrl/Cmd+V right away.
  const empty = ds.samples.length === 0 && ds.variables.length === 0;
  useEffect(() => {
    if (empty) container.current?.focus();
  }, [empty]);

  const applyPaste = (choice: Omit<ClipboardImport, "id" | "name" | "depthUnit">) => {
    if (!pending) return;
    const r = datasetFromClipboard(pending, { id: ds.id, name: ds.name, depthUnit: ds.depthUnit, ...choice });
    setPending(null);
    useStore.getState().replaceData(r.dataset);
    toast(`Pasted ${r.dataset.samples.length} samples × ${r.dataset.variables.length} variables`, {
      variant: "success",
      description: r.warnings.length ? `${r.warnings[0]}${r.warnings.length > 1 ? ` …and ${r.warnings.length - 1} more.` : ""}` : "Undo removes the whole paste.",
    });
  };

  // ── Header clicks: group / kind dropdowns, double-click the name to rename ───────────────
  const lastNameClick = useRef<{ col: number; time: number } | null>(null);
  const onHeaderClicked = (col: number, e: { localEventY: number; bounds: Rectangle; isDoubleClick?: boolean; preventDefault(): void }) => {
    if (!variableAt(col)) return;
    const tier = Math.min(2, Math.floor(e.localEventY / TIER));
    const at = { x: e.bounds.x, y: e.bounds.y + tier * TIER, width: e.bounds.width, height: TIER };
    if (tier === 0) setMenu({ at, part: "group", col });
    else if (tier === 1) setMenu({ at, part: "kind", col });
    else {
      // Two clicks on the same name within the double-click time.
      const now = performance.now();
      const last = lastNameClick.current;
      lastNameClick.current = { col, time: now };
      if (!e.isDoubleClick && !(last && last.col === col && now - last.time < 500)) return;
      lastNameClick.current = null;
      // After Glide has handled the click (it focuses the grid), or the field would lose focus at once.
      setTimeout(() => setRenaming({ col, at }), 0);
    }
    e.preventDefault();
  };

  const pointerRect = (bounds: Rectangle, lx: number, ly: number): Rectangle => ({ x: bounds.x + lx, y: bounds.y + ly, width: 0, height: 0 });

  return (
    <div ref={container} tabIndex={-1} className="relative h-full outline-none" onPaste={onPaste} aria-label={`Data of ${ds.name}`} role="region">
      <DataEditor
        ref={grid}
        width="100%"
        height="100%"
        columns={columns}
        rows={ds.samples.length}
        getCellContent={getCellContent}
        onCellsEdited={onCellsEdited}
        drawCell={drawCell}
        drawHeader={drawHeader}
        headerHeight={3 * TIER}
        rowHeight={26}
        freezeColumns={showAge ? 2 : 1}
        rowMarkers="none"
        smoothScrollX
        smoothScrollY
        getCellsForSelection
        onPaste={false}
        gridSelection={selection}
        onGridSelectionChange={setSelection}
        onColumnResize={(c, size) => setWidths((w) => ({ ...w, [c.id ?? c.title]: size }))}
        onHeaderClicked={onHeaderClicked}
        onHeaderContextMenu={(col, e) => {
          e.preventDefault();
          if (variableAt(col)) setMenu({ at: pointerRect(e.bounds, e.localEventX, e.localEventY), part: "column", col });
        }}
        onCellContextMenu={([col, row], e) => {
          e.preventDefault();
          setMenu({ at: pointerRect(e.bounds, e.localEventX, e.localEventY), part: "cell", row, col });
        }}
        trailingRowOptions={{ hint: "Add sample", sticky: true, tint: true }}
        onRowAppended={() => edit(ds.id, (d) => addSample(d, { depth: insertDepth(d, d.samples.length) }, d.samples.length))}
        theme={theme}
        portalElementRef={portal as RefObject<HTMLElement>}
      />
      {empty && (
        <p className="pointer-events-none absolute inset-x-0 top-28 text-center text-sm text-fg-muted">
          Empty sheet — paste a block from Excel, LibreOffice or Google Sheets ({MOD_KEY}+V), or add samples and variables.
        </p>
      )}
      <div ref={portal} className="fixed top-0 left-0 z-50" />
      {renaming && (
        <RenameField
          ds={ds}
          variableId={variableAt(renaming.col)?.id}
          at={renaming.at}
          onDone={() => {
            setRenaming(null);
            grid.current?.focus();
          }}
        />
      )}
      <SheetMenu
        ds={ds}
        cols={cols}
        menu={menu}
        onClose={() => setMenu(null)}
        onReturnFocus={() => grid.current?.focus()}
        snapshotEdited={(row, j) => prov.isEdited(ds, row, j)}
        snapshot={snapshot}
      />
      <PasteDialog table={pending} onApply={applyPaste} onCancel={() => setPending(null)} />
    </div>
  );
}

/** Inline editor over the name tier of a header: Enter or blur renames, Escape cancels. */
function RenameField({ ds, variableId, at, onDone }: { ds: Dataset; variableId: string | undefined; at: Rectangle; onDone(): void }) {
  const v = ds.variables.find((x) => x.id === variableId);
  const [text, setText] = useState(v?.name ?? "");
  const done = useRef(false);
  if (!v) return null;
  const commit = () => {
    if (done.current) return;
    done.current = true;
    edit(ds.id, (d) => renameVariable(d, v.id, text));
    onDone();
  };
  return (
    <input
      autoFocus
      aria-label={`Rename ${stripMarkup(v.name)}`}
      title="*italic* for genera and species; the id stays the same"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") {
          done.current = true;
          onDone();
        }
      }}
      style={{ position: "fixed", left: at.x, top: at.y, width: Math.max(at.width, 160), height: at.height }}
      className="z-50 rounded-sm border border-focus bg-surface-raised px-1.5 text-xs font-semibold text-fg outline-none"
    />
  );
}

function SheetMenu({
  ds,
  cols,
  menu,
  onClose,
  onReturnFocus,
  snapshotEdited,
  snapshot,
}: {
  ds: Dataset;
  cols: SheetColumn[];
  menu: MenuState | null;
  onClose(): void;
  /** Focus goes back to the grid, not to the menu's invisible anchor. */
  onReturnFocus(): void;
  snapshotEdited(row: number, j: number): boolean;
  snapshot: Dataset | undefined;
}) {
  const spec = useStore((s) => s.spec);
  const presets = useStore((s) => s.presets);
  const col = menu ? cols[menu.col] : undefined;
  const v = col?.kind === "variable" ? ds.variables[col.index] : undefined;
  const row = menu?.part === "cell" ? menu.row : undefined;
  const sample = row !== undefined ? ds.samples[row] : undefined;

  const groups = useMemo(() => {
    if (!menu) return [];
    try {
      return variableTree(spec, presets, ds).groups.filter((g): g is typeof g & { id: string } => g.id !== undefined);
    } catch {
      return ds.groups.map((g) => ({ id: g.id, name: g.name, members: [] }));
    }
  }, [menu, spec, presets, ds]);

  const setGroup = (variableId: string, value: string) => {
    const store = useStore.getState();
    let groupId = value;
    if (value === NEW_GROUP) {
      const name = prompt("Name of the new group:")?.trim();
      if (!name) return;
      store.createGroup(ds.id, name);
      const created = variableTree(useStore.getState().spec, presets, ds).groups.filter((g) => g.name === name).pop();
      if (!created?.id) return;
      groupId = created.id;
    }
    const tree = variableTree(useStore.getState().spec, presets, ds);
    if (tree.prepared.variables.some((x) => x.id === variableId)) {
      const target = tree.groups.find((g) => g.id === groupId);
      store.moveVariable(ds.id, variableId, groupId, target?.members.length ?? 0);
    } else {
      // A merge source: only its assignment changes.
      store.editSpec(assignGroup(useStore.getState().spec, ds, variableId, groupId));
    }
  };

  const deleteColumn = (variableId: string) => {
    const name = stripMarkup(ds.variables.find((x) => x.id === variableId)?.name ?? variableId);
    edit(ds.id, (d) => deleteVariable(d, variableId));
    const { spec: s, datasets } = useStore.getState();
    const dangling = danglingReferences(s, datasets).filter((r) => r.id === variableId);
    if (dangling.length === 0) return;
    toast(`${dangling.length} spec reference${dangling.length > 1 ? "s" : ""} to "${name}" now point nowhere`, {
      description: dangling.map((r) => r.path).join(", "),
      action: {
        label: "Clean up spec",
        onClick: () => {
          const st = useStore.getState();
          st.editSpec(cleanupSpec(st.spec, st.datasets));
        },
      },
    });
  };

  const insertColumn = (at: number) => {
    const name = prompt("Name of the new variable (*italic* for genera and species):")?.trim();
    if (name) edit(ds.id, (d) => addVariable(d, { name }, at));
  };

  const editUnit = (variableId: string, current: string | undefined) => {
    const unit = prompt("Unit (empty for none):", current ?? "");
    if (unit !== null) edit(ds.id, (d) => setVariableUnit(d, variableId, unit));
  };

  const groupItems = (variableId: string) => (
    <MenuRadioGroup value={effectiveGroup(spec, ds.id, ds, variableId) ?? ""} onValueChange={(g) => setGroup(variableId, g)}>
      {groups.map((g) => (
        <MenuRadioItem key={g.id} value={g.id}>
          {g.name}
        </MenuRadioItem>
      ))}
      <MenuSeparator />
      <MenuRadioItem value={NEW_GROUP}>New group…</MenuRadioItem>
    </MenuRadioGroup>
  );
  const kindItems = (variableId: string, kind: MeasurementKind) => (
    <MenuRadioGroup value={kind} onValueChange={(k) => edit(ds.id, (d) => setVariableKind(d, variableId, MeasurementKindSchema.parse(k)))}>
      {KINDS.map((k) => (
        <MenuRadioItem key={k} value={k}>
          {k}
        </MenuRadioItem>
      ))}
    </MenuRadioGroup>
  );
  const vIndex = v ? ds.variables.indexOf(v) : -1;
  // Columns this one can be an error of: not itself, not other error columns.
  const errorTargets = v ? ds.variables.filter((x) => x.id !== v.id && !x.companion) : [];
  const errorItems = v && (
    <MenuSub>
      <MenuSubTrigger disabled={errorTargets.length === 0 || ds.variables.some((x) => x.companion?.errorOf === v.id)}>Use as error for…</MenuSubTrigger>
      <MenuSubContent className="max-h-80 overflow-y-auto">
        {errorTargets.map((t) => (
          <MenuSub key={t.id}>
            <MenuSubTrigger>{stripMarkup(t.name)}</MenuSubTrigger>
            <MenuSubContent>
              <MenuRadioGroup
                value={v.companion?.errorOf === t.id ? v.companion.role : ""}
                onValueChange={(role) => edit(ds.id, (d) => setCompanion(d, v.id, { errorOf: t.id, role: ERROR_ROLES.find((r) => r.role === role)!.role }))}
              >
                {ERROR_ROLES.map((r) => (
                  <MenuRadioItem key={r.role} value={r.role}>
                    {r.label}
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
            </MenuSubContent>
          </MenuSub>
        ))}
      </MenuSubContent>
    </MenuSub>
  );
  const columnItems = v && (
    <>
      <MenuLabel>
        <span className="normal-case">{stripMarkup(v.name)}</span>
      </MenuLabel>
      <MenuItem onSelect={() => insertColumn(vIndex)}>Insert variable left</MenuItem>
      <MenuItem onSelect={() => insertColumn(vIndex + 1)}>Insert variable right</MenuItem>
      <MenuSub>
        <MenuSubTrigger>Kind</MenuSubTrigger>
        <MenuSubContent>{kindItems(v.id, v.kind)}</MenuSubContent>
      </MenuSub>
      <MenuItem onSelect={() => editUnit(v.id, v.unit)}>Unit…</MenuItem>
      <MenuSub>
        <MenuSubTrigger>Group</MenuSubTrigger>
        <MenuSubContent>{groupItems(v.id)}</MenuSubContent>
      </MenuSub>
      {errorItems}
      {v.companion && <MenuItem onSelect={() => edit(ds.id, (d) => setCompanion(d, v.id, undefined))}>Not an error column</MenuItem>}
      <MenuItem className="text-danger-text" onSelect={() => deleteColumn(v.id)}>
        Delete variable
      </MenuItem>
    </>
  );

  return (
    <Menu open={menu !== null} onOpenChange={(open) => !open && onClose()}>
      <MenuTrigger asChild>
        <span aria-hidden style={{ position: "fixed", left: menu?.at.x ?? 0, top: menu?.at.y ?? 0, width: menu?.at.width ?? 0, height: menu?.at.height ?? 0 }} />
      </MenuTrigger>
      {menu && (
        <MenuContent
          className="min-w-52"
          align="start"
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            onReturnFocus();
          }}
        >
          {menu.part === "group" && v && groupItems(v.id)}
          {menu.part === "kind" && v && kindItems(v.id, v.kind)}
          {menu.part === "column" && columnItems}
          {menu.part === "cell" && (
            <>
              {v && sample && (
                <>
                  <MenuItem disabled={!snapshotEdited(menu.row, vIndex)} onSelect={() => edit(ds.id, (d) => revertCell(d, snapshot, sample.id, v.id))}>
                    Revert to imported value
                  </MenuItem>
                  <MenuSeparator />
                </>
              )}
              {sample && (
                <>
                  <MenuLabel>
                    <span className="normal-case">
                      Sample at {sample.depth} {ds.depthUnit}
                    </span>
                  </MenuLabel>
                  <MenuItem onSelect={() => edit(ds.id, (d) => addSample(d, { depth: insertDepth(d, menu.row) }, menu.row))}>Insert sample above</MenuItem>
                  <MenuItem onSelect={() => edit(ds.id, (d) => addSample(d, { depth: insertDepth(d, menu.row + 1) }, menu.row + 1))}>Insert sample below</MenuItem>
                  <MenuItem onSelect={() => edit(ds.id, sortSamplesByDepth)}>Sort samples by depth</MenuItem>
                  <MenuItem className="text-danger-text" onSelect={() => edit(ds.id, (d) => deleteSample(d, sample.id))}>
                    Delete sample
                  </MenuItem>
                </>
              )}
              {columnItems && (
                <>
                  <MenuSeparator />
                  {columnItems}
                </>
              )}
            </>
          )}
        </MenuContent>
      )}
    </Menu>
  );
}
