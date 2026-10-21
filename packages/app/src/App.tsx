import { useEffect } from "react";
import { Preview } from "./Preview";
import { SpecEditor } from "./SpecEditor";
import { useStore } from "./store";
import { TopBar } from "./TopBar";
import { VariableList } from "./VariableList";
import { Warnings } from "./Warnings";

function isTextField(el: Element | null): boolean {
  return el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement || el instanceof HTMLSelectElement;
}

export function App() {
  const ready = useStore((s) => s.ready);

  // Ctrl/Cmd+Z, Shift+Ctrl/Cmd+Z, Ctrl+Y: spec history. Text fields keep their own native undo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || isTextField(document.activeElement)) return;
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) useStore.getState().undo();
      else if ((key === "z" && e.shiftKey) || key === "y") useStore.getState().redo();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!ready) return <div className="loading">Loading…</div>;
  return (
    <div className="app">
      <TopBar />
      <aside className="left">
        <VariableList />
      </aside>
      <main className="centre">
        <Preview />
        <Warnings />
      </main>
      <aside className="right">
        <SpecEditor />
      </aside>
    </div>
  );
}
