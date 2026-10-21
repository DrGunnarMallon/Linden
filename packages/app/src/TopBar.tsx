import { useRef } from "react";
import { download } from "./download";
import { prettySpec } from "./specEdit";
import { useStore } from "./store";

export function TopBar() {
  const csvInput = useRef<HTMLInputElement>(null);
  const specInput = useRef<HTMLInputElement>(null);
  const { spec, presets, svg, past, future, specErrors } = useStore();
  const { importFile, setSpecText, setPreset, undo, redo, loadDemo } = useStore.getState();
  const unknownPreset = spec.preset !== undefined && !presets.some((p) => p.name === spec.preset);

  return (
    <header className="top">
      <strong className="brand">Linden</strong>

      <button onClick={() => csvInput.current?.click()}>Import CSV…</button>
      <input
        ref={csvInput}
        type="file"
        accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void importFile(file);
          e.target.value = "";
        }}
      />

      <button onClick={() => specInput.current?.click()}>Load spec…</button>
      <input
        ref={specInput}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void file.text().then((text) => setSpecText(text));
          e.target.value = "";
        }}
      />
      <button
        onClick={() => download("diagram.spec.json", prettySpec(spec), "application/json")}
        title={specErrors.length ? "The editor has errors; the last valid spec is saved." : undefined}
      >
        Save spec
      </button>

      <label>
        Preset{" "}
        <select value={spec.preset ?? ""} onChange={(e) => setPreset(e.target.value || undefined)}>
          <option value="">(none)</option>
          {presets.map((p) => (
            <option key={p.name} value={p.name} title={p.description}>
              {p.name}
            </option>
          ))}
          {unknownPreset && <option value={spec.preset}>{spec.preset} (not found)</option>}
        </select>
      </label>

      <button onClick={undo} disabled={past.length === 0} title="Undo spec change (Ctrl/Cmd+Z)">
        Undo
      </button>
      <button onClick={redo} disabled={future.length === 0} title="Redo spec change (Shift+Ctrl/Cmd+Z)">
        Redo
      </button>

      <button onClick={() => download("diagram.svg", svg, "image/svg+xml")} disabled={!svg}>
        Export SVG
      </button>

      <span className="spacer" />
      <button
        onClick={() => {
          if (confirm("Replace the current project with the demo? This cannot be undone.")) void loadDemo();
        }}
      >
        Reset to demo
      </button>
    </header>
  );
}
