import { TriangleAlert } from "lucide-react";
import { useStore } from "./store";
import { Badge, cn, Popover, PopoverContent, PopoverTrigger } from "./ui";

function useWarnings(): [string, string[]][] {
  const { importWarnings, renderWarnings, presetWarnings, storageWarnings, exportWarnings } = useStore();
  return [
    ["Import", importWarnings],
    ["Render", renderWarnings],
    ["Presets", presetWarnings],
    ["Storage", storageWarnings],
    ["Export", exportWarnings],
  ];
}

/** Status-bar button with the warning count; opens the list as a popover. */
export function Warnings() {
  const sections = useWarnings();
  const total = sections.reduce((n, [, w]) => n + w.length, 0);
  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          "flex h-6 items-center gap-1.5 rounded px-1.5 transition-colors duration-150 hover:bg-surface-3 data-[state=open]:bg-surface-3",
          total ? "text-warning-text" : "text-fg-muted",
        )}
      >
        <TriangleAlert className="size-3.5" />
        <span className="tabular-nums">
          {total} warning{total === 1 ? "" : "s"}
        </span>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="w-[28rem] max-w-[calc(100vw-16px)]">
        <div className="border-b border-border px-3 py-2 text-xs font-semibold">Warnings</div>
        <div className="max-h-80 overflow-auto p-1">
          {total === 0 && <p className="px-2 py-3 text-xs text-fg-muted">No warnings.</p>}
          <ul>
            {sections.flatMap(([label, list]) =>
              list.map((w, i) => (
                <li key={`${label}-${i}`} className="flex items-start gap-2 rounded px-2 py-1.5 text-xs text-fg hover:bg-surface-3">
                  <Badge variant="warning" className="mt-px w-16 justify-center">
                    {label}
                  </Badge>
                  <span className="min-w-0 flex-1 break-words">{w}</span>
                </li>
              )),
            )}
          </ul>
        </div>
      </PopoverContent>
    </Popover>
  );
}
