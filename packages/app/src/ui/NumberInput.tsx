import { useEffect, useRef, useState } from "react";
import { cn } from "./cn";
import { fieldClass } from "./Input";

export interface NumberInputProps {
  /** undefined = empty field (shows `placeholder`). */
  value: number | undefined;
  onCommit(value: number): void;
  /** Called when the field is emptied; without it, an empty field reverts. */
  onClear?(): void;
  /** Accessible name. */
  label: string;
  /** Unit suffix shown inside the field, e.g. "mm" or "%". */
  unit?: string;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
  /** Also commit this many ms after typing stops (valid input only), not just on Enter / blur. */
  commitDelay?: number;
  className?: string;
  disabled?: boolean;
}

const show = (v: number | undefined) => (v === undefined ? "" : String(v));

/** Number field that commits on Enter or blur (so typing makes one undo step); invalid input reverts. */
export function NumberInput({ value, onCommit, onClear, label, unit, placeholder, min, max, step = 1, commitDelay, className, disabled }: NumberInputProps) {
  const [text, setText] = useState(show(value));
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  /** Delayed commit not yet run; flushed on unmount so no typed value is lost. */
  const pending = useRef<(() => void) | undefined>(undefined);
  useEffect(() => setText(show(value)), [value]);
  useEffect(() => () => {
    clearTimeout(timer.current);
    pending.current?.();
  }, []);
  const valid = (t: string) => {
    const v = Number(t);
    return t.trim() !== "" && Number.isFinite(v) && (min === undefined || v >= min) && (max === undefined || v <= max);
  };
  const commit = () => {
    clearTimeout(timer.current);
    pending.current = undefined;
    if (text.trim() === "" && onClear) {
      if (value !== undefined) onClear();
    } else if (valid(text)) {
      if (Number(text) !== value) onCommit(Number(text));
    } else setText(show(value));
  };
  return (
    <div className={cn("relative inline-flex items-center", className)}>
      <input
        type="number"
        inputMode="decimal"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        placeholder={placeholder}
        value={text}
        onChange={(e) => {
          const t = e.target.value;
          setText(t);
          clearTimeout(timer.current);
          pending.current = undefined;
          if (commitDelay !== undefined && valid(t) && Number(t) !== value) {
            pending.current = () => {
              pending.current = undefined;
              onCommit(Number(t));
            };
            timer.current = setTimeout(pending.current, commitDelay);
          }
        }}
        onBlur={() => commit()}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setText(show(value));
        }}
        className={cn(
          fieldClass,
          "w-full text-right tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
          unit ? "pr-8" : "pr-2",
        )}
      />
      {unit && <span className="pointer-events-none absolute right-2 text-xs text-fg-muted">{unit}</span>}
    </div>
  );
}
