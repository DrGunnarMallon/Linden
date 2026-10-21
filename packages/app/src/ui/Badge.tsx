import type { ComponentProps } from "react";
import { cn } from "./cn";

export type BadgeVariant = "neutral" | "accent" | "warning" | "danger";

const variants: Record<BadgeVariant, string> = {
  neutral: "bg-surface-3 text-fg-secondary",
  accent: "bg-accent-subtle text-accent-text",
  warning: "bg-warning-subtle text-warning-text",
  danger: "bg-danger-subtle text-danger-text",
};

export function Badge({ variant = "neutral", className, ...props }: ComponentProps<"span"> & { variant?: BadgeVariant }) {
  return (
    <span
      className={cn("inline-flex h-4.5 shrink-0 items-center gap-1 rounded px-1.5 text-2xs font-medium tabular-nums [&_svg]:size-3", variants[variant], className)}
      {...props}
    />
  );
}
