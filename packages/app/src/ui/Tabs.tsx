import { Tabs as T } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "./cn";

export const Tabs = T.Root;

export function TabsList({ className, ...props }: ComponentProps<typeof T.List>) {
  return <T.List className={cn("flex h-10 shrink-0 items-center gap-1 border-b border-border px-2", className)} {...props} />;
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof T.Trigger>) {
  return (
    <T.Trigger
      className={cn(
        "relative inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-fg-muted transition-colors duration-150",
        "hover:text-fg data-[state=active]:bg-surface-3 data-[state=active]:text-fg [&_svg]:size-4",
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: ComponentProps<typeof T.Content>) {
  return <T.Content className={cn("min-h-0 flex-1 focus-visible:outline-none data-[state=inactive]:hidden", className)} {...props} />;
}
