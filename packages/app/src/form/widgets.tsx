// App widgets for curve style fields, named by `hint.widget` in core's spec hints: colour picker
// (group colour, recent colours, hex), dash and fill pattern pickers with small previews. Used by
// the spec form and the Curve tab; edits go through the form context like every control.

import { createContext, useContext, useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { cn, fieldClass, Input, Popover, PopoverContent, PopoverTrigger, Segmented } from "../ui";
import { useView } from "../view";
import { TYPING_DEBOUNCE_MS } from "./controls";
import { useForm, type ControlProps } from "./context";
import { getIn, setIn } from "./paths";

/** Colour of the selected curve's group, for the "Group" swatch (Curve tab); unknown in the spec form. */
export const GroupColourContext = createContext<string | undefined>(undefined);

/** Shown for options that differ across the selection. */
export const MIXED_LABEL = "Mixed";

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

function isCssColour(text: string): boolean {
  if (HEX.test(text)) return true;
  return typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("color", text);
}

/** "#abc" → "#aabbcc" (the native colour input needs six digits). */
function sixDigit(hex: string): string | undefined {
  if (!HEX.test(hex)) return undefined;
  return hex.length === 4 ? `#${[...hex.slice(1)].map((c) => c + c).join("")}`.toLowerCase() : hex.toLowerCase();
}

function useValue(path: ControlProps["path"]) {
  const ctx = useForm();
  const effective = getIn(ctx.effective, path);
  return {
    ctx,
    effective,
    mixed: ctx.cascade?.(path)?.mixed === true,
    set: (v: unknown, typing = false) => ctx.apply((s) => setIn(s, path, v), typing ? `widget:${path.join(".")}` : undefined),
  };
}

function Swatch({ colour, className }: { colour: string | undefined; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block size-4 shrink-0 rounded-[3px] border border-border-strong", colour === undefined && "bg-[repeating-linear-gradient(45deg,var(--border-strong)_0_2px,transparent_2px_4px)]", className)}
      style={colour !== undefined ? { background: colour } : undefined}
    />
  );
}

/** Native picker that commits when it closes (one pick = one undo step), not on every move. */
function NativeColour({ value, onCommit }: { value: string; onCommit(hex: string): void }) {
  const ref = useRef<HTMLInputElement>(null);
  const commit = useRef(onCommit);
  commit.current = onCommit;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onChange = () => commit.current(el.value);
    el.addEventListener("change", onChange);
    return () => el.removeEventListener("change", onChange);
  }, []);
  return (
    <input
      ref={ref}
      key={value}
      type="color"
      defaultValue={value}
      aria-label="Pick a colour"
      className="h-8 w-10 shrink-0 cursor-pointer rounded-md border border-border-strong bg-surface-raised p-0.5 [&::-moz-color-swatch]:rounded-[3px] [&::-moz-color-swatch]:border-0 [&::-webkit-color-swatch]:rounded-[3px] [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch-wrapper]:p-0"
    />
  );
}

/** Hex / CSS colour text field: commits valid colours 300 ms after typing stops, on Enter and on blur. */
function ColourText({ value, onCommit }: { value: string; onCommit(c: string): void }) {
  const [text, setText] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => setText(value), [value]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const commit = (t: string) => {
    clearTimeout(timer.current);
    if (t !== value && isCssColour(t.trim())) onCommit(t.trim());
  };
  return (
    <Input
      aria-label="Colour (hex or CSS)"
      aria-invalid={text !== "" && !isCssColour(text.trim())}
      value={text}
      placeholder="#2f6b3a"
      className="w-full min-w-0 font-mono text-xs aria-invalid:border-danger-text"
      onChange={(e) => {
        const t = e.target.value;
        setText(t);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => commit(t), TYPING_DEBOUNCE_MS);
      }}
      onBlur={() => commit(text)}
      onKeyDown={(e) => e.key === "Enter" && commit(text)}
    />
  );
}

interface Keyword {
  value: string;
  label: string;
}

const KEYWORDS: Record<string, Keyword[]> = {
  curveColour: [{ value: "group", label: "Group colour" }],
  exaggerationColour: [
    { value: "curve", label: "Curve colour" },
    { value: "group", label: "Group colour" },
  ],
  baselineColour: [
    { value: "axis", label: "Axis colour" },
    { value: "group", label: "Group colour" },
  ],
};

/** Colour field: group colour (and "curve" / "axis" where allowed), recent colours, native picker and hex input. */
function colourWidget(keywords: Keyword[]): ComponentType<ControlProps> {
  return function ColourWidget({ path, value, label }: ControlProps) {
    const { effective, mixed, set } = useValue(path);
    const groupColour = useContext(GroupColourContext);
    const recent = useView((s) => s.recentColours);
    const addRecent = useView((s) => s.addRecentColour);
    const [open, setOpen] = useState(false);
    const current = typeof value === "string" ? value : !mixed && typeof effective === "string" ? effective : undefined;
    const keyword = keywords.find((k) => k.value === current);
    const shown = current === "group" ? groupColour : keyword ? undefined : current;
    const pick = (c: string, close = true) => {
      if (HEX.test(c)) addRecent(sixDigit(c)!);
      set(c);
      if (close) setOpen(false);
    };
    const chip = (k: Keyword) => (
      <button
        key={k.value}
        type="button"
        aria-pressed={current === k.value}
        onClick={() => pick(k.value)}
        className={cn(
          "inline-flex h-7 items-center gap-1.5 rounded-md border border-border-strong px-2 text-xs text-fg-secondary transition-colors hover:bg-surface-3 hover:text-fg",
          current === k.value && "border-accent text-fg",
        )}
      >
        <Swatch colour={k.value === "group" ? groupColour : undefined} className="size-3.5" />
        {k.label}
      </button>
    );
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button type="button" aria-label={label} className={cn(fieldClass, "inline-flex w-full min-w-0 items-center gap-2 text-left", value === undefined && "text-fg-muted")}>
            <Swatch colour={shown} />
            <span className="truncate font-mono text-xs">{mixed && value === undefined ? MIXED_LABEL : (keyword?.label ?? current ?? "")}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-60 space-y-3 p-3" align="start">
          <div className="flex flex-wrap gap-1.5">{keywords.map(chip)}</div>
          {recent.length > 0 && (
            <div>
              <div className="mb-1.5 text-2xs font-medium text-fg-muted">Recent</div>
              <div className="flex flex-wrap gap-1.5">
                {recent.map((c) => (
                  <button
                    key={c}
                    type="button"
                    title={c}
                    aria-label={`Use ${c}`}
                    onClick={() => pick(c)}
                    className={cn("rounded-[4px] p-0.5 ring-accent hover:ring-1", current?.toLowerCase() === c && "ring-2")}
                  >
                    <Swatch colour={c} className="size-5" />
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="flex items-center gap-2">
            <NativeColour value={sixDigit(shown ?? "") ?? sixDigit(groupColour ?? "") ?? "#808080"} onCommit={(c) => pick(c, false)} />
            <ColourText value={keyword || current === undefined ? "" : current} onCommit={(c) => pick(c, false)} />
          </div>
        </PopoverContent>
      </Popover>
    );
  };
}

/** Previews: stroke-dasharray in px, scaled from core's mm dashes. */
const DASHES: { value: string; label: string; array?: string }[] = [
  { value: "solid", label: "Solid" },
  { value: "dashed", label: "Dashed", array: "5 2.5" },
  { value: "dotted", label: "Dotted", array: "1.2 2" },
];
const CUSTOM = "custom";

function DashPreview({ array }: { array?: string | undefined }) {
  return (
    <svg viewBox="0 0 24 8" className="h-2! w-6!" aria-hidden>
      <line x1="1" y1="4" x2="23" y2="4" stroke="currentColor" strokeWidth="1.6" strokeDasharray={array} />
    </svg>
  );
}

/** Dash style: solid / dashed / dotted with previews, or a custom dash array in mm. */
function DashWidget({ path, value, label }: ControlProps) {
  const { effective, mixed, set } = useValue(path);
  const current = value ?? (mixed ? undefined : effective);
  const choice = Array.isArray(current) ? CUSTOM : typeof current === "string" ? current : undefined;
  const custom = Array.isArray(current) ? current.join(" ") : "";
  const [text, setText] = useState(custom);
  useEffect(() => setText(custom), [custom]);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const parse = (t: string) => {
    const nums = t.trim().split(/[\s,]+/).map(Number);
    return t.trim() !== "" && nums.every((n) => Number.isFinite(n) && n > 0) ? nums : undefined;
  };
  const commit = (t: string) => {
    clearTimeout(timer.current);
    const nums = parse(t);
    if (nums && nums.join(" ") !== custom) set(nums, true);
  };
  return (
    <div className="w-full min-w-0 space-y-1.5">
      <Segmented
        label={label}
        className="w-full"
        value={choice}
        inherited={value === undefined}
        onValueChange={(v) => set(v === CUSTOM ? (parse(text) ?? [1, 0.5]) : v)}
        options={[
          ...DASHES.map((d) => ({ value: d.value, label: d.label, icon: <DashPreview array={d.array} /> })),
          { value: CUSTOM, label: "Custom dash (mm)", icon: <span className="text-2xs">mm</span> },
        ]}
      />
      {choice === CUSTOM && (
        <Input
          aria-label={`${label}: dash and gap lengths (mm)`}
          aria-invalid={parse(text) === undefined}
          value={text}
          placeholder="1 0.5"
          className="w-full font-mono text-xs aria-invalid:border-danger-text"
          onChange={(e) => {
            const t = e.target.value;
            setText(t);
            clearTimeout(timer.current);
            timer.current = setTimeout(() => commit(t), TYPING_DEBOUNCE_MS);
          }}
          onBlur={() => commit(text)}
          onKeyDown={(e) => e.key === "Enter" && commit(text)}
        />
      )}
    </div>
  );
}

const PATTERNS: Record<string, { label: string; draw: ReactNode }> = {
  solid: { label: "Solid", draw: <rect x="0" y="0" width="14" height="14" fill="currentColor" opacity="0.6" /> },
  hatch: {
    label: "Hatch",
    draw: [-8, -3, 2, 7, 12].map((o) => <line key={o} x1={o} y1="14" x2={o + 14} y2="0" stroke="currentColor" strokeWidth="1.2" />),
  },
  crosshatch: {
    label: "Crosshatch",
    draw: [-8, -3, 2, 7, 12].flatMap((o) => [
      <line key={`a${o}`} x1={o} y1="14" x2={o + 14} y2="0" stroke="currentColor" strokeWidth="1" />,
      <line key={`b${o}`} x1={o} y1="0" x2={o + 14} y2="14" stroke="currentColor" strokeWidth="1" />,
    ]),
  },
  dots: {
    label: "Dots",
    draw: [2.5, 7, 11.5].flatMap((x) => [2.5, 7, 11.5].map((y) => <circle key={`${x},${y}`} cx={x} cy={y} r="1.2" fill="currentColor" />)),
  },
};

/** Fill pattern type with small previews. */
function PatternWidget({ node, path, value, label }: ControlProps) {
  const { effective, mixed, set } = useValue(path);
  const options = node.kind === "enum" ? node.options : Object.keys(PATTERNS);
  const current = typeof value === "string" ? value : !mixed && typeof effective === "string" ? effective : undefined;
  return (
    <Segmented
      label={label}
      className="w-full"
      value={current}
      inherited={value === undefined}
      onValueChange={(v) => set(v)}
      options={options.map((o) => ({
        value: o,
        label: node.hint.optionLabels?.[o] ?? PATTERNS[o]?.label ?? o,
        icon: (
          <svg viewBox="0 0 14 14" className="rounded-[2px] border border-current/40" aria-hidden>
            {PATTERNS[o]?.draw}
          </svg>
        ),
      }))}
    />
  );
}

export const CURVE_WIDGETS: Record<string, ComponentType<ControlProps>> = {
  curveColour: colourWidget(KEYWORDS.curveColour!),
  exaggerationColour: colourWidget(KEYWORDS.exaggerationColour!),
  baselineColour: colourWidget(KEYWORDS.baselineColour!),
  dash: DashWidget,
  pattern: PatternWidget,
};
