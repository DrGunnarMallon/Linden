import { CircleCheck, CircleX } from "lucide-react";
import { useStore } from "./store";
import { cn } from "./ui";

export function SpecEditor() {
  const { specText, specErrors } = useStore();
  const setSpecText = useStore.getState().setSpecText;
  return (
    <div className="flex h-full flex-col gap-2 p-3">
      <textarea
        spellCheck={false}
        aria-label="Spec (JSON)"
        aria-invalid={specErrors.length > 0}
        value={specText}
        onChange={(e) => setSpecText(e.target.value, { typing: true })}
        className={cn(
          "min-h-0 flex-1 resize-none rounded-md border bg-surface-2 p-2.5 font-mono text-xs leading-relaxed text-fg [tab-size:2]",
          "transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2",
          specErrors.length ? "border-danger-text focus-visible:ring-danger-text/30" : "border-border-strong focus-visible:border-focus focus-visible:ring-focus/30",
        )}
      />
      {specErrors.length > 0 ? (
        <div className="max-h-[35%] shrink-0 overflow-auto rounded-md bg-danger-subtle p-2.5 text-xs" role="alert">
          <div className="mb-1 flex items-center gap-1.5 font-medium text-danger-text">
            <CircleX className="size-4" /> {specErrors.length} error{specErrors.length > 1 ? "s" : ""} — the preview shows the last valid spec
          </div>
          <ul className="list-disc space-y-0.5 pl-5 text-fg">
            {specErrors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="flex shrink-0 items-center gap-1.5 text-xs text-fg-muted">
          <CircleCheck className="size-4 text-accent-text" /> Valid spec
        </div>
      )}
    </div>
  );
}
