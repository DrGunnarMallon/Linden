import { useEffect, useState } from "react";
import { cn } from "./cn";
import { fieldClass } from "./Input";

export interface NumberInputProps {
  value: number;
  onCommit(value: number): void;
  /** Accessible name. */
  label: string;
  /** Unit suffix shown inside the field, e.g. "mm" or "%". */
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
  disabled?: boolean;
}

/** Number field that commits on Enter or blur (so typing makes one undo step); invalid input reverts. */
export function NumberInput({ value, onCommit, label, unit, min, max, step = 1, className, disabled }: NumberInputProps) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const v = Number(text);
    const ok = text.trim() !== "" && Number.isFinite(v) && (min === undefined || v >= min) && (max === undefined || v <= max);
    if (ok && v !== value) onCommit(v);
    else setText(String(value));
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
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setText(String(value));
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
