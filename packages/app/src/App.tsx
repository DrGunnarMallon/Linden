import { ChartColumnBig, Sheet, TreeDeciduous } from "lucide-react";
import { lazy, Suspense, useEffect, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { copyStyle, pasteStyle } from "./actions";
import { Inspector } from "./Inspector";
import { NewProjectDialog } from "./NewProjectDialog";
import { Preview } from "./Preview";
import { StatusBar } from "./StatusBar";
import { useStore } from "./store";
import { TopBar } from "./TopBar";
import { cn, Tabs, TabsList, TabsTrigger, Toaster, TooltipProvider } from "./ui";
import { VariableList } from "./VariableList";
import { SIDEBAR_WIDTH, useView, type Side } from "./view";

function isTextField(el: Element | null): boolean {
  return el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement || el instanceof HTMLSelectElement;
}

/** Arrow-key step (px) of a focused sidebar resize handle; Shift = ×4. */
const SIDEBAR_KEY_STEP = 16;

/**
 * Drag handle on a sidebar's inner edge: drag to resize, double-click for the default width,
 * arrow keys when focused. The width is stored when the drag ends.
 */
function SidebarResizer({ side, width, label, onDragging }: { side: Side; width: number; label: string; onDragging(dragging: boolean): void }) {
  const [drag, setDrag] = useState<{ startX: number; startWidth: number } | null>(null);
  const setWidth = useView((s) => s.setSidebarWidth);
  // Dragging away from the sidebar's own side makes it wider.
  const dir = side === "left" ? 1 : -1;
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ startX: e.clientX, startWidth: width });
    onDragging(true);
  };
  const end = () => {
    if (!drag) return;
    setDrag(null);
    onDragging(false);
    setWidth(side, useView.getState()[side === "left" ? "leftWidth" : "rightWidth"], true);
  };
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = (e.shiftKey ? 4 : 1) * SIDEBAR_KEY_STEP;
    if (e.key === "ArrowLeft") setWidth(side, width - dir * step, true);
    else if (e.key === "ArrowRight") setWidth(side, width + dir * step, true);
    else return;
    e.preventDefault();
  };
  const { min, max } = SIDEBAR_WIDTH[side];
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      className={cn(
        "group absolute top-0 z-20 flex h-full w-2 cursor-col-resize justify-center outline-none",
        side === "left" ? "-right-1" : "-left-1",
      )}
      onPointerDown={onPointerDown}
      onPointerMove={(e) => drag && setWidth(side, drag.startWidth + dir * (e.clientX - drag.startX))}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={() => setWidth(side, SIDEBAR_WIDTH[side].default, true)}
      onKeyDown={onKeyDown}
    >
      <div className={cn("h-full w-0.5 transition-colors group-hover:bg-accent group-focus-visible:bg-focus", drag && "bg-accent")} />
    </div>
  );
}

/**
 * Collapsible, resizable sidebar: animates its width when opening/closing (not while dragging); the
 * content keeps its width and becomes inert when closed.
 */
function Sidebar({ open, side, width, label, children }: { open: boolean; side: Side; width: number; label: string; children: ReactNode }) {
  const [dragging, setDragging] = useState(false);
  return (
    <aside
      aria-label={label}
      inert={!open}
      style={{ width: open ? width : 0 }}
      className={cn(
        "relative shrink-0 bg-surface-1",
        !dragging && "transition-[width] duration-200 ease-out",
        open && (side === "left" ? "border-r border-border" : "border-l border-border"),
      )}
    >
      <div className="h-full overflow-hidden">
        <div className="h-full" style={{ width }}>
          {children}
        </div>
      </div>
      {open && <SidebarResizer side={side} width={width} label={`Resize ${label.toLowerCase()}`} onDragging={setDragging} />}
      {/* Keeps the col-resize cursor and stops text selection while the pointer is over the canvas. */}
      {dragging && <div className="fixed inset-0 z-10 cursor-col-resize" />}
    </aside>
  );
}

/** The data sheet (and its grid library) loads on first use of the Data tab. */
const DataView = lazy(() => import("./DataView").then((m) => ({ default: m.DataView })));

/**
 * Diagram | Data tabs. The preview stays mounted while the sheet is shown and the sheet once opened;
 * the hidden one keeps its size (visibility, not display), so switching is instant and keeps zoom,
 * scroll and selections.
 */
function Workspace() {
  const tab = useView((s) => s.workspaceTab);
  const setTab = useView((s) => s.setWorkspaceTab);
  const hasData = useStore((s) => s.datasets.length > 0);
  const current = hasData ? tab : "diagram";
  const [dataOpened, setDataOpened] = useState(current === "data");
  useEffect(() => {
    if (current === "data") setDataOpened(true);
  }, [current]);
  return (
    <Tabs value={current} onValueChange={(v) => setTab(v === "data" ? "data" : "diagram")} className="flex h-full flex-col">
      {hasData && (
        <TabsList className="bg-surface-1">
          <TabsTrigger value="diagram">
            <ChartColumnBig /> Diagram
          </TabsTrigger>
          <TabsTrigger value="data">
            <Sheet /> Data
          </TabsTrigger>
        </TabsList>
      )}
      <div className="relative min-h-0 flex-1">
        <div role="tabpanel" aria-label="Diagram" inert={current !== "diagram"} className={cn("absolute inset-0", current !== "diagram" && "invisible")}>
          <Preview />
        </div>
        {dataOpened && hasData && (
          <div role="tabpanel" aria-label="Data" inert={current !== "data"} className={cn("absolute inset-0", current !== "data" && "invisible")}>
            <Suspense fallback={<p className="p-8 text-sm text-fg-muted">Loading the data sheet…</p>}>
              <DataView />
            </Suspense>
          </div>
        )}
      </div>
    </Tabs>
  );
}

export function App() {
  const ready = useStore((s) => s.ready);
  const { leftOpen, rightOpen, leftWidth, rightWidth } = useView();

  // Ctrl/Cmd+Z, Shift+Ctrl/Cmd+Z, Ctrl+Y: spec history. Text fields keep their own native undo.
  // Ctrl/Cmd +/−: zoom in/out; Shift+1 / Shift+0 / Shift+2: fit / 100% / 200%.
  // Ctrl/Cmd+Alt+C / V: copy / paste the curve style of the selected curves or group.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTextField(document.activeElement)) return;
      const view = useView.getState();
      // In the data sheet, keys type into cells: only undo / redo stay global.
      if (view.workspaceTab === "data" && !((e.ctrlKey || e.metaKey) && !e.altKey && ["z", "y"].includes(e.key.toLowerCase()))) return;
      if ((e.ctrlKey || e.metaKey) && e.altKey) {
        // By key position: with Alt (Option) held, e.key is another character on many layouts.
        if (e.code !== "KeyC" && e.code !== "KeyV") return;
        if (view.curveSelection && useStore.getState().specErrors.length === 0) (e.code === "KeyC" ? copyStyle : pasteStyle)(view.curveSelection);
      } else if (e.ctrlKey || e.metaKey) {
        const key = e.key.toLowerCase();
        if (key === "z" && !e.shiftKey) useStore.getState().undo();
        else if ((key === "z" && e.shiftKey) || key === "y") useStore.getState().redo();
        else if (key === "=" || key === "+") view.zoomBy(1);
        else if (key === "-" || key === "_") view.zoomBy(-1);
        else return;
      } else if (e.shiftKey && !e.altKey) {
        if (e.code === "Digit1") view.setZoom("fit");
        else if (e.code === "Digit0") view.setZoom(1);
        else if (e.code === "Digit2") view.setZoom(2);
        else return;
      } else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-fg-muted">
        <TreeDeciduous className="size-5 animate-pulse text-accent-text" /> Loading…
      </div>
    );
  }
  return (
    <TooltipProvider delayDuration={400} skipDelayDuration={200}>
      <div className="flex h-full flex-col">
        <TopBar />
        <div className="flex min-h-0 flex-1">
          <Sidebar open={leftOpen} side="left" width={leftWidth} label="Data and variables">
            <VariableList />
          </Sidebar>
          <main className="min-w-0 flex-1">
            <Workspace />
          </main>
          <Sidebar open={rightOpen} side="right" width={rightWidth} label="Inspector">
            <Inspector />
          </Sidebar>
        </div>
        <StatusBar />
      </div>
      <NewProjectDialog />
      <Toaster />
    </TooltipProvider>
  );
}
