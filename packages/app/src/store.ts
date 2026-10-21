// App state. The spec is the single source of truth: the editor text, the variable checkboxes
// and the preset picker all produce new Spec values via commitSpec, which feeds undo/redo.

import { SPEC_VERSION, importers, parseProject, parseSpec, render, resolveSpec, serializeProject, type Dataset, type DiagramLayout, type Preset, type Spec } from "@linden/core";
import { create } from "zustand";
import { examples, loadBundledPresets } from "./bundled";
import { download } from "./download";
import { exporters } from "./export";
import { fontSubstitutionWarning } from "./export/fonts";
import type { PngOptions } from "./export/png";
import { loadProject, saveProject, type Project } from "./persist";
import {
  applyPagePreset,
  createGroup,
  deleteGroup,
  ensureDatasetInSpec,
  mergeVariables,
  moveVariable,
  prettySpec,
  recolourGroup,
  removeDatasetFromSpec,
  renameGroup,
  reorderGroups,
  setPageSize,
  setVariableVisible,
  unmergeVariable,
  variableTree,
} from "./specEdit";

const HISTORY_LIMIT = 200;
/** Valid edits in the text editor closer together than this become one undo step. */
const TYPING_MERGE_MS = 1000;

const EMPTY_SPEC: Spec = { specVersion: SPEC_VERSION, panels: [] };
const DEFAULT_NAME = "Untitled diagram";

/** "My core: 2024" → "my-core-2024"; used for download file names. */
export function fileBase(projectName: string): string {
  const slug = projectName.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");
  return slug || "diagram";
}

interface State {
  ready: boolean;
  projectName: string;
  datasets: Dataset[];
  spec: Spec;
  specText: string;
  specErrors: string[];
  presets: Preset[];
  presetWarnings: string[];
  importWarnings: string[];
  renderWarnings: string[];
  storageWarnings: string[];
  exportWarnings: string[];
  exporting: boolean;
  svg: string;
  /** Layout metadata of the last good render (page mm), for hit-testing in the preview. */
  layout: DiagramLayout | undefined;
  past: Spec[];
  future: Spec[];
  lastTypedAt: number;
  /** Field of the last form edit (see editSpec); undefined after any other edit. */
  lastEditKey: string | undefined;

  init(): Promise<void>;
  /** Replaces the project with a bundled example (by dataset name, see bundled.ts). */
  loadExample(name: string): Promise<void>;
  setProjectName(name: string): void;
  setSpecText(text: string, opts?: { typing?: boolean }): void;
  /** A valid spec from the graphical editor. Edits of the same `mergeKey` (field) in quick succession are one undo step. */
  editSpec(next: Spec, mergeKey?: string): void;
  undo(): void;
  redo(): void;
  setPreset(name: string | undefined): void;
  setVariableVisible(datasetId: string, varId: string, visible: boolean): void;
  /** Resolves to the number of datasets imported (0 = nothing usable; see importWarnings). */
  importFile(file: File): Promise<number>;
  removeDataset(id: string): void;
  moveVariable(datasetId: string, varId: string, toGroup: string, toIndex: number): void;
  reorderGroups(datasetId: string, groupIds: string[]): void;
  createGroup(datasetId: string, name: string): void;
  renameGroup(datasetId: string, id: string, name: string): void;
  recolourGroup(datasetId: string, id: string, colour: string): void;
  deleteGroup(datasetId: string, id: string): void;
  mergeVariables(datasetId: string, ids: string[], name: string): void;
  unmergeVariable(datasetId: string, mergedId: string): void;
  setPageSize(size: { width?: number; height?: number }): void;
  applyPagePreset(presetId: string): void;
  /** Resolves to the downloaded file name, or undefined if nothing was exported (see exportWarnings). */
  exportDiagram(type: "svg" | "pdf" | "png", png?: PngOptions): Promise<string | undefined>;
  saveProjectBundle(): void;
  openProjectBundle(file: File): Promise<boolean>;
}

const bundled = loadBundledPresets();

function renderWith(datasets: Dataset[], spec: Spec, presets: Preset[]): { svg?: string; layout?: DiagramLayout; renderWarnings: string[] } {
  try {
    const r = render(datasets, spec, presets);
    return { svg: r.svg, layout: r.layout, renderWarnings: r.warnings };
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
    set({ ...patch, renderWarnings: r.renderWarnings, ...(r.svg !== undefined ? { svg: r.svg, layout: r.layout } : {}) });
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
      // Typing callers set these again after committing; any other edit ends a typing burst.
      lastTypedAt: 0,
      lastEditKey: undefined,
    });
  };

  /** Commits `next` as one undo step if it differs from the current spec. */
  const edit = (next: Spec) => {
    if (!sameSpec(next, get().spec)) commitSpec(next);
  };
  const rawDataset = (id: string) => get().datasets.find((d) => d.id === id);

  const setProject = (p: Project) => {
    rerender({ projectName: p.name ?? DEFAULT_NAME, datasets: p.datasets, spec: p.spec, specText: p.specText, importWarnings: p.importWarnings, past: [], future: [] });
    const parsed = parseSpec(p.specText);
    set({ specErrors: parsed.ok ? [] : parsed.errors });
  };

  return {
    ready: false,
    projectName: DEFAULT_NAME,
    datasets: [],
    spec: EMPTY_SPEC,
    specText: prettySpec(EMPTY_SPEC),
    specErrors: [],
    presets: bundled.presets,
    presetWarnings: bundled.warnings,
    importWarnings: [],
    renderWarnings: [],
    storageWarnings: [],
    exportWarnings: [],
    exporting: false,
    svg: "",
    layout: undefined,
    past: [],
    future: [],
    lastTypedAt: 0,
    lastEditKey: undefined,

    async init() {
      let saved: Project | undefined;
      try {
        saved = await loadProject();
      } catch (e) {
        set({ storageWarnings: [`Could not read the saved project from browser storage: ${(e as Error).message}`] });
      }
      const spec = saved ? parseSpec(saved.spec) : undefined;
      // A project saved with an older spec version is migrated; show the migrated spec in the editor.
      const migrated = saved && spec?.ok && saved.spec.specVersion !== SPEC_VERSION;
      // First launch (or an unreadable save) starts empty: the app shows its welcome screen.
      if (saved && spec?.ok) setProject({ ...saved, spec: spec.value, specText: migrated ? prettySpec(spec.value) : saved.specText });
      set({ ready: true });
      startAutosave();
    },

    async loadExample(name) {
      const example = examples.find((e) => e.name === name);
      if (!example) return;
      const { datasets, warnings } = await importers.get("csv").import(example.csv, { name: example.name });
      const parsed = parseSpec(example.specText);
      setProject({
        name: `${example.label} example`,
        datasets,
        spec: parsed.ok ? parsed.value : EMPTY_SPEC,
        specText: example.specText,
        importWarnings: warnings.map((w) => `${example.name}.csv: ${w}`),
      });
    },

    setProjectName(name) {
      set({ projectName: name.trim() || DEFAULT_NAME });
    },

    setSpecText(text, opts = {}) {
      const parsed = parseSpec(text);
      if (!parsed.ok) {
        set({ specText: text, specErrors: parsed.errors });
        return;
      }
      const now = Date.now();
      const merge = opts.typing === true && get().lastEditKey === undefined && now - get().lastTypedAt < TYPING_MERGE_MS && get().past.length > 0;
      if (sameSpec(parsed.value, get().spec)) set({ specText: text, specErrors: [] });
      else commitSpec(parsed.value, text, merge);
      set({ lastTypedAt: opts.typing ? now : 0, lastEditKey: undefined });
    },

    editSpec(next, mergeKey) {
      if (sameSpec(next, get().spec)) return;
      const now = Date.now();
      const merge = mergeKey !== undefined && mergeKey === get().lastEditKey && now - get().lastTypedAt < TYPING_MERGE_MS && get().past.length > 0;
      commitSpec(next, undefined, merge);
      set({ lastTypedAt: mergeKey !== undefined ? now : 0, lastEditKey: mergeKey });
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
      const { spec, presets } = get();
      const raw = rawDataset(datasetId);
      if (!raw) return;
      // Visibility is about the variables the diagram sees (merged ones included).
      edit(setVariableVisible(spec, presets, variableTree(spec, presets, raw).prepared, varId, visible));
    },

    moveVariable(datasetId, varId, toGroup, toIndex) {
      const raw = rawDataset(datasetId);
      if (raw) edit(moveVariable(get().spec, get().presets, raw, varId, toGroup, toIndex));
    },

    reorderGroups(datasetId, groupIds) {
      edit(reorderGroups(get().spec, datasetId, groupIds));
    },

    createGroup(datasetId, name) {
      const raw = rawDataset(datasetId);
      if (!raw) return;
      const existing = variableTree(get().spec, get().presets, raw).prepared.groups;
      edit(createGroup(get().spec, datasetId, name, existing).spec);
    },

    renameGroup(datasetId, id, name) {
      edit(renameGroup(get().spec, datasetId, id, name));
    },

    recolourGroup(datasetId, id, colour) {
      edit(recolourGroup(get().spec, datasetId, id, colour));
    },

    deleteGroup(datasetId, id) {
      const raw = rawDataset(datasetId);
      if (raw) edit(deleteGroup(get().spec, get().presets, raw, id));
    },

    mergeVariables(datasetId, ids, name) {
      const raw = rawDataset(datasetId);
      if (raw) edit(mergeVariables(get().spec, get().presets, raw, ids, name).spec);
    },

    unmergeVariable(datasetId, mergedId) {
      const raw = rawDataset(datasetId);
      if (raw) edit(unmergeVariable(get().spec, get().presets, raw, mergedId));
    },

    setPageSize(size) {
      edit(setPageSize(get().spec, size));
    },

    applyPagePreset(presetId) {
      const { spec, presets } = get();
      edit(applyPagePreset(spec, presetId, resolveSpec(spec, presets).spec.page.height));
    },

    async exportDiagram(type, png) {
      const { svg, spec, presets, projectName } = get();
      if (!svg || get().exporting) return undefined;
      const fontWarning = type === "svg" ? null : fontSubstitutionWarning(resolveSpec(spec, presets).spec.page.font.family);
      set({ exporting: true, exportWarnings: fontWarning ? [fontWarning] : [] });
      try {
        const out = await exporters.get(type).export(svg, png);
        const mime = { svg: "image/svg+xml", pdf: "application/pdf", png: "image/png" }[type];
        const filename = type === "png" ? `${fileBase(projectName)}-${png?.dpi ?? 600}dpi.png` : `${fileBase(projectName)}.${type}`;
        download(filename, out, mime);
        return filename;
      } catch (e) {
        set({ exportWarnings: [...get().exportWarnings, `${type.toUpperCase()} export failed: ${(e as Error).message}`] });
        return undefined;
      } finally {
        set({ exporting: false });
      }
    },

    saveProjectBundle() {
      const { spec, datasets, projectName } = get();
      download(`${fileBase(projectName)}.linden.json`, serializeProject({ spec, datasets }), "application/json");
    },

    async openProjectBundle(file) {
      const parsed = parseProject(await file.text());
      if (!parsed.ok) {
        set({ importWarnings: parsed.errors.map((e) => `${file.name}: ${e}`) });
        return false;
      }
      setProject({ name: file.name.replace(/(\.linden)?\.json$/i, ""), datasets: parsed.value.datasets, spec: parsed.value.spec, specText: prettySpec(parsed.value.spec), importWarnings: [] });
      return true;
    },

    async importFile(file) {
      const importer = importers.types().map((t) => importers.get(t)).find((imp) => imp.accepts({ name: file.name, mime: file.type }));
      if (!importer) {
        set({ importWarnings: [`${file.name}: no importer accepts this file type.`] });
        return 0;
      }
      const name = file.name.replace(/\.[^.]+$/, "");
      // The first import into an empty project names it after the file.
      if (get().datasets.length === 0 && get().projectName === DEFAULT_NAME) set({ projectName: name });
      const { datasets: imported, warnings } = await importer.import(await file.arrayBuffer(), { name });
      const ids = new Set(imported.map((d) => d.id));
      rerender({
        datasets: [...get().datasets.filter((d) => !ids.has(d.id)), ...imported],
        importWarnings: warnings.map((w) => `${file.name}: ${w}`),
      });
      const spec = imported.reduce((s, d) => ensureDatasetInSpec(s, d), get().spec);
      if (!sameSpec(spec, get().spec)) commitSpec(spec);
      return imported.length;
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
    if (s.datasets === prev.datasets && s.spec === prev.spec && s.specText === prev.specText && s.importWarnings === prev.importWarnings && s.projectName === prev.projectName) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      const { projectName: name, datasets, spec, specText, importWarnings } = useStore.getState();
      saveProject({ name, datasets, spec, specText, importWarnings }).then(
        () => useStore.setState({ storageWarnings: [] }),
        (e: unknown) => useStore.setState({ storageWarnings: [`Could not save the project in browser storage: ${(e as Error).message}`] }),
      );
    }, 500);
  });
  // Save once right away so a migrated project is persisted too.
  const { projectName: name, datasets, spec, specText, importWarnings } = useStore.getState();
  void saveProject({ name, datasets, spec, specText, importWarnings }).catch(() => undefined);
}
