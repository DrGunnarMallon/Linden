import { ToggleGroup as T } from "radix-ui";
import type { ReactNode } from "react";
import { cn } from "./cn";
import { Tooltip } from "./Tooltip";

export interface SegmentedOption {
  value: string;
  /** Accessible name; the visible text unless `icon` is given (then the tooltip). */
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
}

export interface SegmentedProps {
  /** undefined = none pressed (e.g. mixed values). */
  value: string | undefined;
  onValueChange(value: string): void;
  options: SegmentedOption[];
  /** Accessible name of the group. */
  label: string;
  /** The value is inherited, not set here: the pressed item is drawn outlined instead of filled. */
  inherited?: boolean;
  className?: string;
}

/** Single-choice segmented control (same look as the inspector's Form | JSON switch); icon items get tooltips. */
export function Segmented({ value, onValueChange, options, label, inherited, className }: SegmentedProps) {
  return (
    <T.Root
      type="single"
      aria-label={label}
      value={value ?? ""}
      // Clicking the pressed item reports ""; a segmented control always keeps a choice.
      onValueChange={(v) => v !== "" && onValueChange(v)}
      className={cn("inline-flex gap-0.5 rounded-lg border border-border bg-surface-2 p-0.5", className)}
    >
      {options.map((o) => {
        const item = (
          <T.Item
            key={o.value}
            value={o.value}
            aria-label={o.label}
            disabled={o.disabled}
            className={cn(
              "inline-flex h-7 min-w-7 flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-2 text-xs font-medium whitespace-nowrap text-fg-muted transition-colors duration-150",
              "hover:text-fg disabled:pointer-events-none disabled:opacity-(--disabled-opacity) [&_svg]:size-4 [&_svg]:shrink-0",
              inherited ? "aria-checked:border-dashed aria-checked:border-fg-muted aria-checked:text-fg-secondary" : "aria-checked:bg-surface-3 aria-checked:text-fg",
              o.icon !== undefined && "px-1.5",
            )}
          >
            {o.icon ?? o.label}
          </T.Item>
        );
        return o.icon !== undefined ? (
          <Tooltip key={o.value} content={o.label} side="bottom">
            {item}
          </Tooltip>
        ) : (
          item
        );
      })}
    </T.Root>
  );
}
