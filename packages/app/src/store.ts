// App state. The spec is the single source of truth: the editor text, the variable checkboxes
// and the preset picker all produce new Spec values via commitSpec, which feeds undo/redo.

import { SPEC_VERSION, importers, parseSpec, render, type Dataset, type Preset, type Spec } from "@linden/core";
import { create } from "zustand";
import { demo, loadBundledPresets } from "./bundled";
import { loadProject, saveProject, type Project } from "./persist";
import { ensureDatasetInSpec, prettySpec, removeDatasetFromSpec, setVariableVisible } from "./specEdit";

const HISTORY_LIMIT = 200;
/** Valid edits in the text editor closer together than this become one undo step. */
const TYPING_MERGE_MS = 1000;

const EMPTY_SPEC: Spec = { specVersion: SPEC_VERSION, panels: [] };

interface State {
  ready: boolean;
  datasets: Dataset[];
  spec: Spec;
  specText: string;
  specErrors: string[];
  presets: Preset[];
  presetWarnings: string[];
  importWarnings: string[];
  renderWarnings: string[];
  storageWarnings: string[];
  svg: string;
  past: Spec[];
  future: Spec[];
  lastTypedAt: number;

  init(): Promise<void>;
  loadDemo(): Promise<void>;
  setSpecText(text: string, opts?: { typing?: boolean }): void;
  undo(): void;
  redo(): void;
  setPreset(name: string | undefined): void;
  setVariableVisible(datasetId: string, varId: string, visible: boolean): void;
  importFile(file: File): Promise<void>;
  removeDataset(id: string): void;
}

const bundled = loadBundledPresets();

function renderWith(datasets: Dataset[], spec: Spec, presets: Preset[]): { svg?: string; renderWarnings: string[] } {
  try {
    const r = render(datasets, spec, presets);
    return { svg: r.svg, renderWarnings: r.warnings };
  } catch (e) {
    return { renderWarnings: [`Render failed: ${(e as Error).message}`] };
  }
}

function sameSpec(a: Spec, b: Spec): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export const useStore = create<State>()((set, get) => {
  /** Re-renders after datasets/spec change. Keeps the last good SVG if rendering throws. */
  const rerender = (patch: Partial<State>) => {
    const s = { ...get(), ...patch };
    const r = renderWith(s.datasets, s.spec, s.presets);
    set({ ...patch, renderWarnings: r.renderWarnings, ...(r.svg !== undefined ? { svg: r.svg } : {}) });
  };

  /** New spec as one undo step. `text` keeps the user's formatting; otherwise the spec is pretty-printed. */
  const commitSpec = (spec: Spec, text?: string, mergeWithLast = false) => {
    const { spec: current, past } = get();
    rerender({
      spec,
      specText: text ?? prettySpec(spec),
      specErrors: [],
      past: mergeWithLast ? past : [...past, current].slice(-HISTORY_LIMIT),
      future: [],
    });
  };

  const setProject = (p: Project) => {
    rerender({ datasets: p.datasets, spec: p.spec, specText: p.specText, importWarnings: p.importWarnings, past: [], future: [] });
    const parsed = parseSpec(p.specText);
    set({ specErrors: parsed.ok ? [] : parsed.errors });
  };

  return {
    ready: false,
    datasets: [],
    spec: EMPTY_SPEC,
    specText: prettySpec(EMPTY_SPEC),
    specErrors: [],
    presets: bundled.presets,
    presetWarnings: bundled.warnings,
    importWarnings: [],
    renderWarnings: [],
    storageWarnings: [],
    svg: "",
    past: [],
    future: [],
    lastTypedAt: 0,

    async init() {
      let saved: Project | undefined;
      try {
        saved = await loadProject();
      } catch (e) {
        set({ storageWarnings: [`Could not read the saved project from browser storage: ${(e as Error).message}`] });
      }
      const spec = saved ? parseSpec(saved.spec) : undefined;
      if (saved && spec?.ok) setProject({ ...saved, spec: spec.value });
      else await get().loadDemo();
      set({ ready: true });
      startAutosave();
    },

    async loadDemo() {
      const { datasets, warnings } = await importers.get("csv").import(demo.csv, { name: demo.name });
      const parsed = parseSpec(demo.specText);
      setProject({
        datasets,
        spec: parsed.ok ? parsed.value : EMPTY_SPEC,
        specText: demo.specText,
        importWarnings: warnings.map((w) => `${demo.name}.csv: ${w}`),
      });
    },

    setSpecText(text, opts = {}) {
      const parsed = parseSpec(text);
      if (!parsed.ok) {
        set({ specText: text, specErrors: parsed.errors });
        return;
      }
      const now = Date.now();
      const merge = opts.typing === true && now - get().lastTypedAt < TYPING_MERGE_MS && get().past.length > 0;
      set({ lastTypedAt: opts.typing ? now : 0 });
      if (sameSpec(parsed.value, get().spec)) set({ specText: text, specErrors: [] });
      else commitSpec(parsed.value, text, merge);
    },

    undo() {
      const { past, future, spec } = get();
      const prev = past[past.length - 1];
      if (!prev) return;
      rerender({ spec: prev, specText: prettySpec(prev), specErrors: [], past: past.slice(0, -1), future: [spec, ...future], lastTypedAt: 0 });
    },

    redo() {
      const { past, future, spec } = get();
      const next = future[0];
      if (!next) return;
      rerender({ spec: next, specText: prettySpec(next), specErrors: [], past: [...past, spec], future: future.slice(1), lastTypedAt: 0 });
    },

    setPreset(name) {
      const { preset: _old, ...rest } = get().spec;
      commitSpec(name === undefined ? rest : { ...rest, preset: name });
    },

    setVariableVisible(datasetId, varId, visible) {
      const { spec, presets, datasets } = get();
      const ds = datasets.find((d) => d.id === datasetId);
      if (!ds) return;
      const next = setVariableVisible(spec, presets, ds, varId, visible);
      if (!sameSpec(next, spec)) commitSpec(next);
    },

    async importFile(file) {
      const importer = importers.types().map((t) => importers.get(t)).find((imp) => imp.accepts({ name: file.name, mime: file.type }));
      if (!importer) {
        set({ importWarnings: [`${file.name}: no importer accepts this file type.`] });
        return;
      }
      const name = file.name.replace(/\.[^.]+$/, "");
      const { datasets: imported, warnings } = await importer.import(await file.arrayBuffer(), { name });
      const ids = new Set(imported.map((d) => d.id));
      rerender({
        datasets: [...get().datasets.filter((d) => !ids.has(d.id)), ...imported],
        importWarnings: warnings.map((w) => `${file.name}: ${w}`),
      });
      const spec = imported.reduce((s, d) => ensureDatasetInSpec(s, d.id), get().spec);
      if (!sameSpec(spec, get().spec)) commitSpec(spec);
    },

    removeDataset(id) {
      rerender({ datasets: get().datasets.filter((d) => d.id !== id) });
      const spec = removeDatasetFromSpec(get().spec, id);
      if (!sameSpec(spec, get().spec)) commitSpec(spec);
    },
  };
});

let autosaveStarted = false;

/** Debounced save of data + spec to IndexedDB whenever they change. */
function startAutosave(): void {
  if (autosaveStarted) return;
  autosaveStarted = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  useStore.subscribe((s, prev) => {
    if (s.datasets === prev.datasets && s.spec === prev.spec && s.specText === prev.specText && s.importWarnings === prev.importWarnings) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      const { datasets, spec, specText, importWarnings } = useStore.getState();
      saveProject({ datasets, spec, specText, importWarnings }).then(
        () => useStore.setState({ storageWarnings: [] }),
        (e: unknown) => useStore.setState({ storageWarnings: [`Could not save the project in browser storage: ${(e as Error).message}`] }),
      );
    }, 500);
  });
  // Save once right away so a first-launch demo is persisted too.
  const { datasets, spec, specText, importWarnings } = useStore.getState();
  void saveProject({ datasets, spec, specText, importWarnings }).catch(() => undefined);
}
