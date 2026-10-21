import { resolveSpec } from "@linden/core";
import { CircleX, LoaderCircle } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { matchPagePreset, PAGE_PRESETS } from "./specEdit";
import { useStore } from "./store";
import { useView } from "./view";
import { Warnings } from "./Warnings";

function Item({ children }: { children: ReactNode }) {
  return <span className="flex items-center gap-1.5 px-1.5">{children}</span>;
}

export function StatusBar() {
  const { spec, presets, specErrors, exporting } = useStore();
  const hasData = useStore((s) => s.datasets.length > 0);
  const scale = useView((s) => s.scale);
  const showInspector = useView((s) => s.showInspector);
  const page = useMemo(() => resolveSpec(spec, presets).spec.page, [spec, presets]);
  const presetLabel = PAGE_PRESETS.find((p) => p.id === matchPagePreset(page))?.label.replace(/ \(.*\)$/, "") ?? "Custom";

  return (
    <footer className="flex h-7 shrink-0 items-center gap-1 border-t border-border bg-surface-1 px-1.5 text-2xs text-fg-muted">
      <Item>
        <span className="tabular-nums text-fg-secondary">
          {page.width} × {page.height} mm
        </span>
        <span>{presetLabel}</span>
      </Item>
      {hasData && (
        <>
          <span className="h-3 w-px bg-border" aria-hidden />
          <Item>
            <span className="tabular-nums">{Math.round(scale * 100)}%</span>
          </Item>
        </>
      )}
      {specErrors.length > 0 && (
        <>
          <span className="h-3 w-px bg-border" aria-hidden />
          <button type="button" onClick={() => showInspector("json")} className="flex h-6 items-center gap-1.5 rounded px-1.5 text-danger-text hover:bg-surface-3">
            <CircleX className="size-3.5" /> {specErrors.length} spec error{specErrors.length > 1 ? "s" : ""}
          </button>
        </>
      )}
      <span className="flex-1" />
      {exporting && (
        <Item>
          <LoaderCircle className="size-3.5 animate-spin" /> Exporting…
        </Item>
      )}
      <Warnings />
    </footer>
  );
}
