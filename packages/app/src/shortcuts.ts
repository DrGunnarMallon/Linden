// Keyboard shortcut labels, shown in tooltips and menus. The handlers live in App.tsx.

import { MOD_KEY } from "./ui";

const mac = MOD_KEY === "⌘";
/** macOS modifier order (⌥⇧⌘), then the key. */
const MAC_ORDER = ["⌥", "⇧", "⌘"];
const macRank = (p: string) => (MAC_ORDER.includes(p) ? MAC_ORDER.indexOf(p) : MAC_ORDER.length);
/** keys("mod", "shift", "Z") → "⇧⌘Z" on macOS, "Ctrl+Shift+Z" elsewhere. */
function keys(...parts: string[]): string {
  if (mac) return parts.map((p) => ({ mod: "⌘", shift: "⇧", alt: "⌥" })[p] ?? p).sort((a, b) => macRank(a) - macRank(b)).join("");
  return parts.map((p) => ({ mod: "Ctrl", shift: "Shift", alt: "Alt" })[p] ?? p).join("+");
}

export const SHORTCUTS = {
  undo: keys("mod", "Z"),
  redo: keys("mod", "shift", "Z"),
  zoomIn: keys("mod", "+"),
  zoomOut: keys("mod", "−"),
  zoomFit: keys("shift", "1"),
  zoom100: keys("shift", "0"),
  zoom200: keys("shift", "2"),
  copyStyle: keys("mod", "alt", "C"),
  pasteStyle: keys("mod", "alt", "V"),
};
