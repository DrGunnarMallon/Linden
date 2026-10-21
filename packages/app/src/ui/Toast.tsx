import { CircleCheck, CircleX, Info, X } from "lucide-react";
import { Toast as T } from "radix-ui";
import { create } from "zustand";
import { cn } from "./cn";

type ToastVariant = "info" | "success" | "error";
interface ToastItem {
  id: number;
  title: string;
  description?: string;
  variant: ToastVariant;
}

const useToasts = create<{ items: ToastItem[] }>()(() => ({ items: [] }));
let nextId = 1;

/** Shows a transient notification (bottom right). */
export function toast(title: string, opts: { description?: string; variant?: ToastVariant } = {}): void {
  const item = { id: nextId++, title, description: opts.description, variant: opts.variant ?? "info" };
  useToasts.setState((s) => ({ items: [...s.items, item] }));
}

const remove = (id: number) => useToasts.setState((s) => ({ items: s.items.filter((t) => t.id !== id) }));

const icons = {
  info: <Info className="size-4 text-fg-secondary" />,
  success: <CircleCheck className="size-4 text-accent-text" />,
  error: <CircleX className="size-4 text-danger-text" />,
};

/** Renders the toast queue; mount once near the root. */
export function Toaster() {
  const items = useToasts((s) => s.items);
  return (
    <T.Provider duration={4000}>
      {items.map((t) => (
        <T.Root
          key={t.id}
          onOpenChange={(open) => !open && remove(t.id)}
          className={cn("animate-slide-in flex w-80 items-start gap-2.5 rounded-lg border border-border bg-surface-raised p-3 shadow-overlay")}
        >
          <span className="mt-0.5">{icons[t.variant]}</span>
          <div className="min-w-0 flex-1">
            <T.Title className="text-sm font-medium text-fg">{t.title}</T.Title>
            {t.description && <T.Description className="mt-0.5 text-xs text-fg-secondary">{t.description}</T.Description>}
          </div>
          <T.Close aria-label="Dismiss" className="rounded p-0.5 text-fg-muted hover:bg-surface-3 hover:text-fg">
            <X className="size-4" />
          </T.Close>
        </T.Root>
      ))}
      <T.Viewport className="fixed right-4 bottom-10 z-50 flex flex-col gap-2 outline-none" />
    </T.Provider>
  );
}
