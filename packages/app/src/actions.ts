// User actions shared by the top bar, the welcome screen and the sidebar: file picking,
// confirmation before replacing a project, and toasts reporting the outcome.

import { examples } from "./bundled";
import { download } from "./download";
import type { PngOptions } from "./export/png";
import { prettySpec } from "./specEdit";
import { fileBase, useStore } from "./store";
import { toast } from "./ui";

export const DATA_ACCEPT = ".csv,.tsv,.txt,text/csv,text/tab-separated-values";

/** Opens the browser's file picker; resolves to undefined if cancelled. */
function pickFile(accept: string): Promise<File | undefined> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.hidden = true;
    const done = (file: File | undefined) => {
      input.remove();
      resolve(file);
    };
    input.addEventListener("change", () => done(input.files?.[0]));
    input.addEventListener("cancel", () => done(undefined));
    document.body.append(input); // some browsers only fire "change" for inputs in the document
    input.click();
  });
}

/** Asks before replacing a project that has data; an empty project is replaced silently. */
function confirmReplace(what: string): boolean {
  return useStore.getState().datasets.length === 0 || confirm(`Replace the current project with ${what}? This cannot be undone.`);
}

export async function importData(): Promise<void> {
  const file = await pickFile(DATA_ACCEPT);
  if (!file) return;
  const n = await useStore.getState().importFile(file);
  const warnings = useStore.getState().importWarnings.length;
  if (n === 0) toast(`Could not import ${file.name}`, { variant: "error", description: "See the warnings in the status bar." });
  else toast(`Imported ${file.name}`, { variant: "success", description: warnings ? `${warnings} warning${warnings > 1 ? "s" : ""} — see the status bar.` : undefined });
}

export async function openProject(): Promise<void> {
  const file = await pickFile(".linden.json,.json,application/json");
  if (!file || !confirmReplace("this file")) return;
  if (await useStore.getState().openProjectBundle(file)) toast(`Opened ${file.name}`, { variant: "success" });
  else toast(`Could not open ${file.name}`, { variant: "error", description: "See the warnings in the status bar." });
}

export function saveProject(): void {
  useStore.getState().saveProjectBundle();
  toast("Project saved", { variant: "success", description: `${fileBase(useStore.getState().projectName)}.linden.json` });
}

export async function loadSpecFile(): Promise<void> {
  const file = await pickFile(".json,application/json");
  if (file) useStore.getState().setSpecText(await file.text());
}

export function saveSpecFile(): void {
  const { spec, projectName } = useStore.getState();
  download(`${fileBase(projectName)}.spec.json`, prettySpec(spec), "application/json");
}

export async function loadExample(name: string): Promise<void> {
  const example = examples.find((e) => e.name === name);
  if (!example || !confirmReplace(`the ${example.label.toLowerCase()} example`)) return;
  await useStore.getState().loadExample(name);
}

export async function exportAs(type: "svg" | "pdf" | "png", png?: PngOptions): Promise<void> {
  const file = await useStore.getState().exportDiagram(type, png);
  if (file) toast(`Exported ${file}`, { variant: "success" });
  else if (useStore.getState().exportWarnings.length) toast(`${type.toUpperCase()} export failed`, { variant: "error", description: "See the warnings in the status bar." });
}
