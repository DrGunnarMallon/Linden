// Keyboard shortcut labels, shown in tooltips and menus. The handlers live in App.tsx.

import { MOD_KEY } from "./ui";

const mac = MOD_KEY === "⌘";
/** keys("mod", "shift", "Z") → "⇧⌘Z" on macOS, "Ctrl+Shift+Z" elsewhere. */
function keys(...parts: string[]): string {
  if (mac) return parts.map((p) => ({ mod: "⌘", shift: "⇧" })[p] ?? p).sort((a, b) => (a === "⇧" ? -1 : b === "⇧" ? 1 : 0)).join("");
  return parts.map((p) => ({ mod: "Ctrl", shift: "Shift" })[p] ?? p).join("+");
}

export const SHORTCUTS = {
  undo: keys("mod", "Z"),
  redo: keys("mod", "shift", "Z"),
  zoomIn: keys("mod", "+"),
  zoomOut: keys("mod", "−"),
  zoomFit: keys("shift", "1"),
  zoom100: keys("shift", "0"),
  zoom200: keys("shift", "2"),
};
