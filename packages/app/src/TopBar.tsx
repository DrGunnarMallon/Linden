import {
  ChevronDown,
  Download,
  FileCode,
  FilePlus,
  FileSpreadsheet,
  FileImage,
  FileText,
  FolderOpen,
  Monitor,
  Moon,
  PanelLeft,
  PanelRight,
  Redo2,
  Save,
  Sprout,
  Sun,
  TreeDeciduous,
  Undo2,
  Upload,
} from "lucide-react";
import { useEffect, useState, type ReactElement } from "react";
import { exportAs, exportData, importData, loadExample, loadSpecFile, newProject, openProject, saveProject, saveSpecFile } from "./actions";
import { examples } from "./bundled";
import { PNG_DPIS } from "./export/png";
import { SHORTCUTS } from "./shortcuts";
import { useStore } from "./store";
import { useTheme, type ThemePreference } from "./theme";
import {
  Button,
  IconButton,
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
  Switch,
} from "./ui";
import { useView } from "./view";

function Divider() {
  return <span className="mx-1 h-5 w-px bg-border" aria-hidden />;
}

/** Inline-editable project name: commits on Enter or blur, Escape reverts. */
function ProjectName() {
  const name = useStore((s) => s.projectName);
  const [text, setText] = useState(name);
  useEffect(() => setText(name), [name]);
  const commit = () => useStore.getState().setProjectName(text);
  // The invisible copy of the text sizes the field to its content.
  return (
    <span className="inline-grid">
      <span aria-hidden className="invisible col-start-1 row-start-1 max-w-80 overflow-hidden px-2 text-sm font-medium whitespace-pre">
        {text || " "}
      </span>
      <input
        aria-label="Project name"
        value={text}
        spellCheck={false}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setText(name);
            requestAnimationFrame(() => (e.target as HTMLInputElement).blur());
          }
        }}
        className="col-start-1 row-start-1 h-7 w-full max-w-80 min-w-16 rounded-md border border-transparent bg-transparent px-1.5 text-sm font-medium text-fg transition-colors duration-150 hover:border-border-strong focus-visible:border-focus focus-visible:bg-surface-raised focus-visible:outline-none"
      />
    </span>
  );
}

function ProjectMenu() {
  const specErrors = useStore((s) => s.specErrors.length);
  const hasData = useStore((s) => s.datasets.length > 0);
  return (
    <Menu>
      <MenuTrigger asChild>
        <IconButton label="Project menu" icon={<ChevronDown />} size="sm" />
      </MenuTrigger>
      <MenuContent>
        <MenuItem onSelect={newProject}>
          <FilePlus /> New project…
        </MenuItem>
        <MenuItem onSelect={() => void openProject()}>
          <FolderOpen /> Open project…
        </MenuItem>
        <MenuItem onSelect={saveProject}>
          <Save /> Save project
        </MenuItem>
        <MenuItem disabled={!hasData} onSelect={exportData}>
          <FileSpreadsheet /> Export data (CSV)
        </MenuItem>
        <MenuSeparator />
        <MenuItem onSelect={() => void loadSpecFile()}>
          <FileCode /> Load spec…
        </MenuItem>
        <MenuItem onSelect={saveSpecFile} title={specErrors ? "The editor has errors; the last valid spec is saved." : undefined}>
          <FileCode /> Save spec{specErrors > 0 && <span className="ml-auto pl-4 text-xs text-fg-muted">last valid</span>}
        </MenuItem>
        <MenuSeparator />
        <MenuSub>
          <MenuSubTrigger>
            <Sprout /> Load example
          </MenuSubTrigger>
          <MenuSubContent>
            {examples.map((e) => (
              <MenuItem key={e.name} onSelect={() => void loadExample(e.name)}>
                {e.label}
              </MenuItem>
            ))}
          </MenuSubContent>
        </MenuSub>
      </MenuContent>
    </Menu>
  );
}

function ExportMenu() {
  const svg = useStore((s) => s.svg);
  const exporting = useStore((s) => s.exporting);
  const [dpi, setDpi] = useState(600);
  const [whiteBackground, setWhiteBackground] = useState(true);
  const disabled = !svg || exporting;
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button variant="primary" size="sm" disabled={!svg}>
          <Download /> {exporting ? "Exporting…" : "Export"}
        </Button>
      </MenuTrigger>
      <MenuContent align="end" className="w-60">
        <MenuItem disabled={disabled} onSelect={() => void exportAs("svg")}>
          <FileCode /> SVG <span className="ml-auto text-xs text-fg-muted">vector, editable</span>
        </MenuItem>
        <MenuItem disabled={disabled} onSelect={() => void exportAs("pdf")}>
          <FileText /> PDF <span className="ml-auto text-xs text-fg-muted">vector</span>
        </MenuItem>
        <MenuItem disabled={disabled} onSelect={() => void exportAs("png", { dpi, background: whiteBackground })}>
          <FileImage /> PNG <span className="ml-auto text-xs text-fg-muted tabular-nums">{dpi} dpi</span>
        </MenuItem>
        <MenuSeparator />
        <MenuLabel>PNG resolution</MenuLabel>
        <MenuRadioGroup value={String(dpi)} onValueChange={(v) => setDpi(Number(v))}>
          {PNG_DPIS.map((d) => (
            <MenuRadioItem key={d} value={String(d)} onSelect={(e) => e.preventDefault()} className="tabular-nums">
              {d} dpi
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
        <MenuSeparator />
        <MenuItem
          onSelect={(e) => {
            e.preventDefault();
            setWhiteBackground(!whiteBackground);
          }}
          title="Off: transparent background"
        >
          PNG white background
          {/* Display only: the menu item does the toggling. */}
          <span className="pointer-events-none ml-auto">
            <Switch checked={whiteBackground} onCheckedChange={setWhiteBackground} aria-label="PNG white background" />
          </span>
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

const THEME_ICONS: Record<ThemePreference, ReactElement> = { system: <Monitor />, dark: <Moon />, light: <Sun /> };

function ThemeMenu() {
  const { preference, setPreference } = useTheme();
  return (
    <Menu>
      <MenuTrigger asChild>
        <IconButton label={`Theme: ${preference}`} icon={THEME_ICONS[preference]} />
      </MenuTrigger>
      <MenuContent align="end" className="min-w-36">
        <MenuRadioGroup value={preference} onValueChange={(v) => setPreference(v as ThemePreference)}>
          <MenuRadioItem value="system">System</MenuRadioItem>
          <MenuRadioItem value="dark">Dark</MenuRadioItem>
          <MenuRadioItem value="light">Light</MenuRadioItem>
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  );
}

export function TopBar() {
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const { undo, redo } = useStore.getState();
  const { leftOpen, rightOpen, toggleLeft, toggleRight } = useView();

  return (
    <header className="flex h-12 shrink-0 items-center gap-1 border-b border-border bg-surface-1 px-2">
      <IconButton label={leftOpen ? "Hide data sidebar" : "Show data sidebar"} icon={<PanelLeft />} active={leftOpen} onClick={toggleLeft} />
      <div className="ml-1 flex items-center gap-1.5 pr-1">
        <TreeDeciduous className="size-5 text-accent-text" aria-hidden />
        <span className="text-base font-semibold tracking-tight">Linden</span>
      </div>
      <span className="text-fg-muted" aria-hidden>
        /
      </span>
      <ProjectName />
      <ProjectMenu />

      <span className="flex-1" />

      <IconButton label="Undo" shortcut={SHORTCUTS.undo} icon={<Undo2 />} onClick={undo} disabled={!canUndo} />
      <IconButton label="Redo" shortcut={SHORTCUTS.redo} icon={<Redo2 />} onClick={redo} disabled={!canRedo} />
      <Divider />
      <Button variant="secondary" size="sm" onClick={() => void importData()}>
        <Upload /> Import CSV
      </Button>
      <ExportMenu />
      <Divider />
      <ThemeMenu />
      <IconButton
        label={rightOpen ? "Hide inspector" : "Show inspector"}
        icon={<PanelRight />}
        active={rightOpen}
        onClick={toggleRight}
      />
    </header>
  );
}
