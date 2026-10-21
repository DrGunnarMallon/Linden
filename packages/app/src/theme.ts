// UI theme (system / dark / light), remembered in localStorage. This is the app's look only;
// the figure's own colours come from the spec (`style`) and never follow the theme.

import { create } from "zustand";

export type ThemePreference = "system" | "dark" | "light";
export type Theme = "dark" | "light";

export const THEME_STORAGE_KEY = "linden.theme";

/** Dark is the default: an unknown or missing preference follows the system, which falls back to dark. */
export function resolveTheme(pref: ThemePreference, systemPrefersLight: boolean): Theme {
  if (pref === "system") return systemPrefersLight ? "light" : "dark";
  return pref;
}

export function parsePreference(value: string | null): ThemePreference {
  return value === "dark" || value === "light" || value === "system" ? value : "system";
}

const lightQuery = (): MediaQueryList | undefined =>
  typeof window === "undefined" ? undefined : window.matchMedia("(prefers-color-scheme: light)");

function readPreference(): ThemePreference {
  try {
    return parsePreference(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "system";
  }
}

function apply(theme: Theme, animate: boolean): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (root.dataset.theme === theme) return;
  if (animate) {
    root.classList.add("theme-transition");
    setTimeout(() => root.classList.remove("theme-transition"), 220);
  }
  root.dataset.theme = theme;
}

interface ThemeState {
  preference: ThemePreference;
  theme: Theme;
  setPreference(pref: ThemePreference): void;
}

export const useTheme = create<ThemeState>()((set) => {
  const preference = readPreference();
  const theme = resolveTheme(preference, lightQuery()?.matches ?? false);
  apply(theme, false);
  lightQuery()?.addEventListener("change", (e) => {
    const { preference: pref } = useTheme.getState();
    const next = resolveTheme(pref, e.matches);
    apply(next, true);
    set({ theme: next });
  });
  return {
    preference,
    theme,
    setPreference(pref) {
      try {
        localStorage.setItem(THEME_STORAGE_KEY, pref);
      } catch {
        // Private mode etc.: the choice just isn't remembered.
      }
      const next = resolveTheme(pref, lightQuery()?.matches ?? false);
      apply(next, true);
      set({ preference: pref, theme: next });
    },
  };
});
