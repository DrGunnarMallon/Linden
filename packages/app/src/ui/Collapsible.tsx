import { ChevronRight } from "lucide-react";
import { Collapsible as C } from "radix-ui";
import { useState, type ReactNode } from "react";
import { cn } from "./cn";

/** Section with a clickable header that folds its content; `actions` sit on the right of the header. */
export function CollapsibleSection(props: { title: ReactNode; actions?: ReactNode; defaultOpen?: boolean; className?: string; children: ReactNode }) {
  const [open, setOpen] = useState(props.defaultOpen ?? true);
  return (
    <C.Root open={open} onOpenChange={setOpen} className={cn("border-b border-border", props.className)}>
      <div className="flex h-9 items-center gap-1 pr-2 pl-1">
        <C.Trigger className="flex min-w-0 flex-1 items-center gap-1 rounded px-1 py-1 text-left text-xs font-semibold text-fg hover:text-fg">
          <ChevronRight className={cn("size-4 shrink-0 text-fg-muted transition-transform duration-150", open && "rotate-90")} />
          <span className="truncate">{props.title}</span>
        </C.Trigger>
        {props.actions}
      </div>
      <C.Content className="collapsible-content overflow-hidden">{props.children}</C.Content>
    </C.Root>
  );
}
