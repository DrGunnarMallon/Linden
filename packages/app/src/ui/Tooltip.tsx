import { Tooltip as T } from "radix-ui";
import type { ReactNode } from "react";

export const TooltipProvider = T.Provider;

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-border-strong bg-surface-3 px-1 font-sans text-2xs text-fg-secondary">{children}</kbd>
  );
}

/** Hover/focus tooltip; `shortcut` is shown as a key hint next to the text. */
export function Tooltip(props: { content: ReactNode; shortcut?: string; side?: "top" | "bottom" | "left" | "right"; children: ReactNode }) {
  return (
    <T.Root>
      <T.Trigger asChild>{props.children}</T.Trigger>
      <T.Portal>
        <T.Content
          side={props.side ?? "bottom"}
          sideOffset={6}
          collisionPadding={8}
          className="animate-pop-in z-50 flex max-w-72 items-center gap-2 rounded-md border border-border bg-surface-2 px-2 py-1 text-xs text-fg shadow-overlay"
        >
          {props.content}
          {props.shortcut && <Kbd>{props.shortcut}</Kbd>}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}
