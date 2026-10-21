import type { ComponentProps } from "react";
import { cn } from "./cn";

export const fieldClass =
  "h-8 rounded-md border border-border-strong bg-surface-raised px-2 text-sm text-fg placeholder:text-fg-muted " +
  "transition-colors duration-150 hover:border-fg-muted focus-visible:border-focus focus-visible:outline-none " +
  "focus-visible:ring-2 focus-visible:ring-focus/30 disabled:opacity-(--disabled-opacity)";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(fieldClass, className)} {...props} />;
}
