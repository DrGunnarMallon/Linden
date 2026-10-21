import { TreeDeciduous } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { Inspector } from "./Inspector";
import { Preview } from "./Preview";
import { StatusBar } from "./StatusBar";
import { useStore } from "./store";
import { TopBar } from "./TopBar";
import { cn, Toaster, TooltipProvider } from "./ui";
import { VariableList } from "./VariableList";
import { useView } from "./view";

function isTextField(el: Element | null): boolean {
  return el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement || el instanceof HTMLSelectElement;
}

/** Collapsible sidebar: animates its width; the content keeps its width and becomes inert when closed. */
function Sidebar({ open, side, width, label, children }: { open: boolean; side: "left" | "right"; width: number; label: string; children: ReactNode }) {
  return (
    <aside
      aria-label={label}
      inert={!open}
      style={{ width: open ? width : 0 }}
      className={cn(
        "shrink-0 overflow-hidden bg-surface-1 transition-[width] duration-200 ease-out",
        open && (side === "left" ? "border-r border-border" : "border-l border-border"),
      )}
    >
      <div className="h-full" style={{ width }}>
        {children}
      </div>
    </aside>
  );
}

export function App() {
  const ready = useStore((s) => s.ready);
  const { leftOpen, rightOpen } = useView();

  // Ctrl/Cmd+Z, Shift+Ctrl/Cmd+Z, Ctrl+Y: spec history. Text fields keep their own native undo.
  // Ctrl/Cmd +/−: zoom in/out; Shift+1 / Shift+0 / Shift+2: fit / 100% / 200%.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTextField(document.activeElement)) return;
      const view = useView.getState();
      if (e.ctrlKey || e.metaKey) {
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
          <Sidebar open={leftOpen} side="left" width={272} label="Data and variables">
            <VariableList />
          </Sidebar>
          <main className="min-w-0 flex-1">
            <Preview />
          </main>
          <Sidebar open={rightOpen} side="right" width={384} label="Inspector">
            <Inspector />
          </Sidebar>
        </div>
        <StatusBar />
      </div>
      <Toaster />
    </TooltipProvider>
  );
}
