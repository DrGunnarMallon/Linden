import { X } from "lucide-react";
import { Dialog as D } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "./cn";
import { IconButton } from "./IconButton";

// Modal dialog: same surface as menus and popovers, centred over a dimmed workspace.

export const Dialog = D.Root;
export const DialogClose = D.Close;

export function DialogContent({ title, description, className, children, ...props }: ComponentProps<typeof D.Content> & { title: string; description?: ReactNode }) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-black/40" />
      <D.Content
        className={cn(
          "animate-pop-in fixed top-1/2 left-1/2 z-50 flex max-h-[85vh] w-[min(92vw,28rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-border bg-surface-raised p-5 shadow-overlay focus-visible:outline-none",
          className,
        )}
        {...props}
      >
        <div className="mb-3 flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <D.Title className="text-base font-semibold tracking-tight">{title}</D.Title>
            {description ? <D.Description className="mt-1 text-sm text-fg-secondary">{description}</D.Description> : <D.Description className="sr-only">{title}</D.Description>}
          </div>
          <D.Close asChild>
            <IconButton label="Close" icon={<X />} size="sm" />
          </D.Close>
        </div>
        {children}
      </D.Content>
    </D.Portal>
  );
}
