import { ChevronRight } from "lucide-react";
import { Collapsible as C } from "radix-ui";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "./cn";

/**
 * Section with a clickable header that folds its content; `actions` sit on the right of the header.
 * Each new non-zero `reveal` value opens the section and scrolls it into view (unless `scrollOnReveal` is false).
 */
export function CollapsibleSection(props: {
  title: ReactNode;
  actions?: ReactNode;
  defaultOpen?: boolean;
  reveal?: number;
  scrollOnReveal?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(props.defaultOpen ?? true);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!props.reveal) return;
    setOpen(true);
    if (props.scrollOnReveal === false) return;
    // After the open animation (180 ms), so the section has its final height.
    const t = setTimeout(() => root.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }), 200);
    return () => clearTimeout(t);
  }, [props.reveal, props.scrollOnReveal]);
  return (
    <C.Root ref={root} open={open} onOpenChange={setOpen} className={cn("border-b border-border", props.className)}>
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
