import { Check } from "lucide-react";
import { Checkbox as C } from "radix-ui";
import { cn } from "./cn";

export interface CheckboxProps {
  checked: boolean;
  onCheckedChange(checked: boolean): void;
  disabled?: boolean;
  title?: string;
  "aria-label"?: string;
  id?: string;
  className?: string;
}

export function Checkbox({ checked, onCheckedChange, className, ...props }: CheckboxProps) {
  return (
    <C.Root
      checked={checked}
      onCheckedChange={(c) => onCheckedChange(c === true)}
      className={cn(
        "inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-border-strong bg-surface-2 transition-colors duration-150",
        "hover:border-fg-muted data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=checked]:text-on-accent disabled:opacity-45",
        className,
      )}
      {...props}
    >
      <C.Indicator>
        <Check className="size-3" strokeWidth={3} />
      </C.Indicator>
    </C.Root>
  );
}
