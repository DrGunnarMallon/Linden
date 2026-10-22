import type { FormNode, FormNodeKind, Spec } from "@linden/core";
import { createContext, useContext, type ComponentType } from "react";
import type { Path } from "./paths";

export interface ControlProps<N extends FormNode = FormNode> {
  node: N;
  /** Concrete path of the value in the spec. */
  path: Path;
  value: unknown;
  /** The key may be left out of the spec: show the effective value as placeholder, allow reset. */
  optional: boolean;
  /** Accessible name. */
  label: string;
}

/** Cascade-aware forms (the Curve tab): where the option at a path stands in the style cascade. */
export interface CascadeState {
  /** Set at the level being edited (normal look, reset button); else inherited (muted). */
  overridden: boolean;
  /** Differs across the selection. */
  mixed: boolean;
  /** Where an inherited value comes from, e.g. "from group Bryophytes" (leaf options only). */
  source?: string;
}

export type ControlOf<K extends FormNodeKind> = ControlProps<Extract<FormNode, { kind: K }>>;

export interface FormContextValue {
  /**
   * Applies `edit` to the store's current spec. Commits it (one undo step; edits with the same
   * `mergeKey` in quick succession merge) if it validates, else shows the errors. Returns success.
   */
  apply(edit: (spec: Spec) => unknown, mergeKey?: string): boolean;
  /** The resolved spec (defaults and preset applied): effective values for placeholders. */
  effective: unknown;
  /** Errors of the last rejected edit ("path: message"). */
  errors: string[];
  /** App controls named by `hint.widget`. */
  widgets: Record<string, ComponentType<ControlProps>>;
  /** Cascade state of the option at `path`; absent in the spec form. */
  cascade?(path: Path): CascadeState | undefined;
  /** Label of an unset choice ("Default"; the Curve tab: "Inherited"). */
  unsetLabel?: string;
}

export const FormContext = createContext<FormContextValue | null>(null);

export function useForm(): FormContextValue {
  const ctx = useContext(FormContext);
  if (!ctx) throw new Error("form control outside <SpecForm>");
  return ctx;
}
