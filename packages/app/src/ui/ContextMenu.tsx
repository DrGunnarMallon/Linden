import { Check, ChevronRight, Minus } from "lucide-react";
import { ContextMenu as C } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "./cn";
import { menuItemClass as item, menuPanelClass as panel } from "./Menu";

// Right-click menu: the same look as Menu (dropdown), opened at the pointer.

export const ContextMenu = C.Root;
export const ContextMenuTrigger = C.Trigger;
export const ContextMenuSub = C.Sub;
export const ContextMenuRadioGroup = C.RadioGroup;

export function ContextMenuContent({ className, ...props }: ComponentProps<typeof C.Content>) {
  return (
    <C.Portal>
      <C.Content collisionPadding={8} className={cn(panel, className)} {...props} />
    </C.Portal>
  );
}

export function ContextMenuItem({ className, shortcut, children, ...props }: ComponentProps<typeof C.Item> & { shortcut?: string }) {
  return (
    <C.Item className={cn(item, className)} {...props}>
      {children}
      {shortcut && <span className="ml-auto pl-4 text-xs text-fg-muted">{shortcut}</span>}
    </C.Item>
  );
}

export function ContextMenuCheckboxItem({ className, children, ...props }: ComponentProps<typeof C.CheckboxItem>) {
  return (
    <C.CheckboxItem className={cn(item, "pl-7", className)} {...props}>
      <C.ItemIndicator className="absolute left-2 inline-flex">
        {props.checked === "indeterminate" ? <Minus className="!text-accent-text" /> : <Check className="!text-accent-text" />}
      </C.ItemIndicator>
      {children}
    </C.CheckboxItem>
  );
}

export function ContextMenuRadioItem({ className, children, ...props }: ComponentProps<typeof C.RadioItem>) {
  return (
    <C.RadioItem className={cn(item, "pl-7", className)} {...props}>
      <C.ItemIndicator className="absolute left-2 inline-flex">
        <Check className="!text-accent-text" />
      </C.ItemIndicator>
      {children}
    </C.RadioItem>
  );
}

export function ContextMenuSubTrigger({ className, children, ...props }: ComponentProps<typeof C.SubTrigger>) {
  return (
    <C.SubTrigger className={cn(item, "data-[state=open]:bg-surface-3", className)} {...props}>
      {children}
      <ChevronRight className="ml-auto" />
    </C.SubTrigger>
  );
}

export function ContextMenuSubContent({ className, ...props }: ComponentProps<typeof C.SubContent>) {
  return (
    <C.Portal>
      <C.SubContent sideOffset={4} collisionPadding={8} className={cn(panel, className)} {...props} />
    </C.Portal>
  );
}

export function ContextMenuSeparator() {
  return <C.Separator className="-mx-1 my-1 h-px bg-border" />;
}

export function ContextMenuLabel({ children }: { children: ReactNode }) {
  return <C.Label className="px-2 pt-1.5 pb-1 text-2xs font-medium tracking-wide text-fg-muted uppercase">{children}</C.Label>;
}
