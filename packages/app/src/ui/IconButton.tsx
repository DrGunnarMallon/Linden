import type { ComponentProps, ReactNode } from "react";
import { buttonClass, type ButtonVariant } from "./Button";
import { cn } from "./cn";
import { Tooltip } from "./Tooltip";

export interface IconButtonProps extends Omit<ComponentProps<"button">, "children"> {
  /** Accessible name and tooltip text. */
  label: string;
  shortcut?: string;
  icon: ReactNode;
  variant?: ButtonVariant;
  size?: "sm" | "md";
  /** Pressed/selected look (toggle buttons). */
  active?: boolean;
  tooltipSide?: "top" | "bottom" | "left" | "right";
}

/** Square icon-only button with a tooltip. */
export function IconButton({ label, shortcut, icon, variant = "ghost", size = "md", active, tooltipSide, className, type = "button", ...props }: IconButtonProps) {
  return (
    <Tooltip content={label} shortcut={shortcut} side={tooltipSide}>
      <button
        type={type}
        aria-label={label}
        aria-pressed={active}
        className={cn(buttonClass(variant, size), size === "sm" ? "w-7 px-0" : "w-8 px-0", active && "bg-accent-subtle text-accent-text hover:bg-accent-subtle", className)}
        {...props}
      >
        {icon}
      </button>
    </Tooltip>
  );
}
