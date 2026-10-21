import { Switch as S } from "radix-ui";

export interface SwitchProps {
  checked: boolean;
  onCheckedChange(checked: boolean): void;
  id?: string;
  disabled?: boolean;
  "aria-label"?: string;
}

export function Switch(props: SwitchProps) {
  return (
    <S.Root
      {...props}
      className="relative inline-flex h-4.5 w-8 shrink-0 items-center rounded-full border border-border-strong bg-surface-3 transition-colors duration-150 data-[state=checked]:border-accent data-[state=checked]:bg-accent disabled:opacity-(--disabled-opacity)"
    >
      <S.Thumb className="block size-3.5 translate-x-0.5 rounded-full bg-fg-secondary shadow transition-transform duration-150 data-[state=checked]:translate-x-[15px] data-[state=checked]:bg-on-accent" />
    </S.Root>
  );
}
