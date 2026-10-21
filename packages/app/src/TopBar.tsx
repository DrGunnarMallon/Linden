import { useRef, useState } from "react";
import { download } from "./download";
import { PNG_DPIS } from "./export/png";
import { prettySpec } from "./specEdit";
import { useStore } from "./store";

export function TopBar() {
  const csvInput = useRef<HTMLInputElement>(null);
  const specInput = useRef<HTMLInputElement>(null);
  const projectInput = useRef<HTMLInputElement>(null);
  const [dpi, setDpi] = useState(600);
  const [whiteBackground, setWhiteBackground] = useState(true);
  const { spec, presets, svg, past, future, specErrors, exporting } = useStore();
  const { importFile, setSpecText, setPreset, undo, redo, loadDemo, exportDiagram, saveProjectBundle, openProjectBundle } = useStore.getState();
  const unknownPreset = spec.preset !== undefined && !presets.some((p) => p.name === spec.preset);

  return (
    <header className="top">
      <strong className="brand">Linden</strong>

      <button onClick={() => projectInput.current?.click()} title="Open a .linden.json project (spec + data)">
        Open project…
      </button>
      <input
        ref={projectInput}
        type="file"
        accept=".linden.json,.json,application/json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file && confirm("Replace the current project with this file? This cannot be undone.")) void openProjectBundle(file);
          e.target.value = "";
        }}
      />
      <button onClick={saveProjectBundle} title="Save spec + embedded data as one .linden.json file">
        Save project
      </button>

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

      <span className="export">
        Export
        <button onClick={() => void exportDiagram("svg")} disabled={!svg || exporting}>
          SVG
        </button>
        <button onClick={() => void exportDiagram("pdf")} disabled={!svg || exporting}>
          PDF
        </button>
        <button onClick={() => void exportDiagram("png", { dpi, background: whiteBackground })} disabled={!svg || exporting}>
          PNG
        </button>
        <select value={dpi} onChange={(e) => setDpi(Number(e.target.value))} title="PNG resolution">
          {PNG_DPIS.map((d) => (
            <option key={d} value={d}>
              {d} dpi
            </option>
          ))}
        </select>
        <label title="Unchecked: transparent background">
          <input type="checkbox" checked={whiteBackground} onChange={(e) => setWhiteBackground(e.target.checked)} /> white
        </label>
        {exporting && <span className="muted">exporting…</span>}
      </span>

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
