import { Check, ChevronDown } from "lucide-react";
import { Select as S } from "radix-ui";
import { cn } from "./cn";
import { fieldClass } from "./Input";

export interface SelectOption {
  value: string;
  label: string;
  title?: string;
}

export interface SelectProps {
  value: string;
  onValueChange(value: string): void;
  options: SelectOption[];
  /** Accessible name. */
  label: string;
  className?: string;
  disabled?: boolean;
}

/** Note: Radix Select does not allow "" as a value; use a sentinel for "none". */
export function Select({ value, onValueChange, options, label, className, disabled }: SelectProps) {
  return (
    <S.Root value={value} onValueChange={onValueChange} disabled={disabled}>
      <S.Trigger aria-label={label} className={cn(fieldClass, "inline-flex items-center justify-between gap-2 text-left", className)}>
        <span className="truncate">
          <S.Value />
        </span>
        <S.Icon>
          <ChevronDown className="size-4 text-fg-muted" />
        </S.Icon>
      </S.Trigger>
      <S.Portal>
        <S.Content
          position="popper"
          sideOffset={4}
          className="animate-pop-in z-50 max-h-[var(--radix-select-content-available-height)] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-md border border-border bg-surface-raised p-1 shadow-overlay"
        >
          <S.Viewport>
            {options.map((o) => (
              <S.Item
                key={o.value}
                value={o.value}
                title={o.title}
                className="relative flex h-7 cursor-default items-center rounded pr-2 pl-7 text-sm text-fg outline-none select-none data-[highlighted]:bg-surface-3"
              >
                <S.ItemIndicator className="absolute left-2 inline-flex">
                  <Check className="size-3.5 text-accent-text" />
                </S.ItemIndicator>
                <S.ItemText>{o.label}</S.ItemText>
              </S.Item>
            ))}
          </S.Viewport>
        </S.Content>
      </S.Portal>
    </S.Root>
  );
}
