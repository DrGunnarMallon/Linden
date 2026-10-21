import { Check, ChevronRight } from "lucide-react";
import { DropdownMenu as M } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "./cn";

export const Menu = M.Root;
export const MenuTrigger = M.Trigger;
export const MenuSub = M.Sub;
export const MenuRadioGroup = M.RadioGroup;

const panel = "animate-pop-in z-50 min-w-48 rounded-lg border border-border bg-surface-raised p-1 shadow-overlay";
const item =
  "relative flex h-8 cursor-default items-center gap-2 rounded-md px-2 text-sm text-fg outline-none select-none " +
  "data-[highlighted]:bg-surface-3 data-[disabled]:opacity-(--disabled-opacity) [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-fg-secondary";

export function MenuContent({ className, align = "start", ...props }: ComponentProps<typeof M.Content>) {
  return (
    <M.Portal>
      <M.Content sideOffset={6} align={align} collisionPadding={8} className={cn(panel, className)} {...props} />
    </M.Portal>
  );
}

export function MenuItem({ className, shortcut, children, ...props }: ComponentProps<typeof M.Item> & { shortcut?: string }) {
  return (
    <M.Item className={cn(item, className)} {...props}>
      {children}
      {shortcut && <span className="ml-auto pl-4 text-xs text-fg-muted">{shortcut}</span>}
    </M.Item>
  );
}

export function MenuRadioItem({ className, children, ...props }: ComponentProps<typeof M.RadioItem>) {
  return (
    <M.RadioItem className={cn(item, "pl-7", className)} {...props}>
      <M.ItemIndicator className="absolute left-2 inline-flex">
        <Check className="!text-accent-text" />
      </M.ItemIndicator>
      {children}
    </M.RadioItem>
  );
}

export function MenuSubTrigger({ className, children, ...props }: ComponentProps<typeof M.SubTrigger>) {
  return (
    <M.SubTrigger className={cn(item, "data-[state=open]:bg-surface-3", className)} {...props}>
      {children}
      <ChevronRight className="ml-auto" />
    </M.SubTrigger>
  );
}

export function MenuSubContent({ className, ...props }: ComponentProps<typeof M.SubContent>) {
  return (
    <M.Portal>
      <M.SubContent sideOffset={4} collisionPadding={8} className={cn(panel, className)} {...props} />
    </M.Portal>
  );
}

export function MenuSeparator() {
  return <M.Separator className="-mx-1 my-1 h-px bg-border" />;
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <M.Label className="px-2 pt-1.5 pb-1 text-2xs font-medium tracking-wide text-fg-muted uppercase">{children}</M.Label>;
}
