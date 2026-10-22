// Workspace view state (zoom, sidebars). Not part of the spec and not in the undo history.

import { create } from "zustand";
import type { CurveStyleOverride } from "@linden/core";
import type { CurveSelection } from "./curveEdit";

export type Zoom = "fit" | number;
/** Workspace tab: the figure or the data sheet. Switching keeps zoom and selections (view state). */
export type WorkspaceTab = "diagram" | "data";
/** The inspector's spec editor: generated form or raw JSON. Remembered in localStorage. */
export type InspectorTab = "form" | "json";

export const INSPECTOR_STORAGE_KEY = "linden.inspector";

export function parseInspectorTab(value: string | null): InspectorTab {
  return value === "json" ? "json" : "form";
}

function readInspectorTab(): InspectorTab {
  try {
    return parseInspectorTab(localStorage.getItem(INSPECTOR_STORAGE_KEY));
  } catch {
    return "form";
  }
}

export type Side = "left" | "right";
export const SIDEBAR_STORAGE_KEY = "linden.sidebars";
/** Sidebar widths in px: default and the range a drag may set. */
export const SIDEBAR_WIDTH: Record<Side, { default: number; min: number; max: number }> = {
  left: { default: 272, min: 200, max: 480 },
  right: { default: 384, min: 300, max: 720 },
};

export function clampSidebar(side: Side, width: number): number {
  const { min, max, default: d } = SIDEBAR_WIDTH[side];
  return Number.isFinite(width) ? Math.round(Math.min(max, Math.max(min, width))) : d;
}

/** Stored widths ('{"left":300,"right":420}'); anything unreadable falls back to the defaults. */
export function parseSidebarWidths(value: string | null): Record<Side, number> {
  let raw: Partial<Record<Side, unknown>> = {};
  try {
    raw = JSON.parse(value ?? "{}") ?? {};
  } catch {
    // keep defaults
  }
  const width = (side: Side) => (typeof raw[side] === "number" ? clampSidebar(side, raw[side] as number) : SIDEBAR_WIDTH[side].default);
  return { left: width("left"), right: width("right") };
}

function readSidebarWidths(): Record<Side, number> {
  try {
    return parseSidebarWidths(localStorage.getItem(SIDEBAR_STORAGE_KEY));
  } catch {
    return parseSidebarWidths(null);
  }
}

export const RECENT_COLOURS_KEY = "linden.recentColours";
const RECENT_COLOURS_MAX = 8;

/** Most recent first, unique (case-insensitive), at most 8; `colour` (if any) goes in front. */
export function pushRecentColour(recent: readonly string[], colour: string): string[] {
  return [colour, ...recent.filter((c) => c.toLowerCase() !== colour.toLowerCase())].slice(0, RECENT_COLOURS_MAX);
}

function readRecentColours(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(RECENT_COLOURS_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((c): c is string => typeof c === "string").slice(0, RECENT_COLOURS_MAX) : [];
  } catch {
    return [];
  }
}

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 8;
const STEPS = [0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8];

export const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

/** Next preset zoom step above (dir 1) or below (dir -1) the current scale. */
export function stepZoom(scale: number, dir: 1 | -1): number {
  const next = dir > 0 ? STEPS.find((s) => s > scale + 1e-6) : [...STEPS].reverse().find((s) => s < scale - 1e-6);
  return next ?? (dir > 0 ? MAX_ZOOM : MIN_ZOOM);
}

interface ViewState {
  workspaceTab: WorkspaceTab;
  /** Dataset shown in the Data tab; undefined = the first one. */
  dataDataset: string | undefined;
  /** The New project dialog is open. */
  newProjectOpen: boolean;
  zoom: Zoom;
  /** Scale actually used for the page (resolves "fit"); set by the canvas. */
  scale: number;
  leftOpen: boolean;
  rightOpen: boolean;
  /** Sidebar widths in px (data list left, inspector right). Remembered in localStorage. */
  leftWidth: number;
  rightWidth: number;
  inspectorTab: InspectorTab;
  /** Panel selected in the preview; `seq` grows with every selection so the form reveals its card again. */
  selection: { panel: number; seq: number } | null;
  /** Curves or a group selected in the preview or the variable list (Curve tab). Exclusive with `selection`. */
  curveSelection: CurveSelection | null;
  /** The inspector shows the Curve tab (while there is a curve selection). */
  curveTab: boolean;
  /** Colours recently picked in colour fields, most recent first. Remembered in localStorage. */
  recentColours: string[];
  /** Curve style copied with Copy style (context menu, Ctrl/Cmd+Alt+C); not in the spec. */
  styleClipboard: CurveStyleOverride | null;
  setWorkspaceTab(tab: WorkspaceTab): void;
  setDataDataset(id: string | undefined): void;
  setNewProjectOpen(open: boolean): void;
  setZoom(zoom: Zoom): void;
  zoomBy(dir: 1 | -1): void;
  setScale(scale: number): void;
  toggleLeft(): void;
  toggleRight(): void;
  /** Sets a sidebar's width (clamped); `persist` stores it (at the end of a drag). */
  setSidebarWidth(side: Side, width: number, persist?: boolean): void;
  /** Opens the inspector on the given tab. */
  showInspector(tab: InspectorTab | "curve"): void;
  /** Selects a panel (clearing any curve selection); null clears both. */
  selectPanel(panel: number | null): void;
  /** Selects curves or a group (clearing the panel selection) and opens the Curve tab (`reveal: false`: leaves the inspector as it is); null clears it. */
  selectCurves(sel: CurveSelection | null, opts?: { reveal?: boolean }): void;
  setStyleClipboard(style: CurveStyleOverride | null): void;
  addRecentColour(colour: string): void;
}

export const useView = create<ViewState>()((set, get) => ({
  workspaceTab: "diagram",
  dataDataset: undefined,
  newProjectOpen: false,
  zoom: "fit",
  scale: 1,
  leftOpen: true,
  rightOpen: true,
  ...(({ left, right }) => ({ leftWidth: left, rightWidth: right }))(readSidebarWidths()),
  inspectorTab: readInspectorTab(),
  selection: null,
  curveSelection: null,
  curveTab: false,
  recentColours: readRecentColours(),
  styleClipboard: null,
  setWorkspaceTab: (workspaceTab) => set({ workspaceTab }),
  setDataDataset: (dataDataset) => set({ dataDataset }),
  setNewProjectOpen: (newProjectOpen) => set({ newProjectOpen }),
  setZoom: (zoom) => set({ zoom: zoom === "fit" ? zoom : clampZoom(zoom) }),
  zoomBy: (dir) => set({ zoom: stepZoom(get().scale, dir) }),
  setScale: (scale) => set({ scale }),
  toggleLeft: () => set({ leftOpen: !get().leftOpen }),
  toggleRight: () => set({ rightOpen: !get().rightOpen }),
  setSidebarWidth: (side, width, persist = false) => {
    set(side === "left" ? { leftWidth: clampSidebar(side, width) } : { rightWidth: clampSidebar(side, width) });
    if (!persist) return;
    try {
      localStorage.setItem(SIDEBAR_STORAGE_KEY, JSON.stringify({ left: get().leftWidth, right: get().rightWidth }));
    } catch {
      // Private mode etc.: the width just isn't remembered.
    }
  },
  showInspector: (tab) => {
    // The Curve tab depends on the selection, so it is not remembered.
    if (tab === "curve") {
      set({ rightOpen: true, curveTab: true });
      return;
    }
    try {
      localStorage.setItem(INSPECTOR_STORAGE_KEY, tab);
    } catch {
      // Private mode etc.: the choice just isn't remembered.
    }
    set({ rightOpen: true, inspectorTab: tab, curveTab: false });
  },
  selectPanel: (panel) => set({ selection: panel === null ? null : { panel, seq: (get().selection?.seq ?? 0) + 1 }, curveSelection: null, curveTab: false }),
  selectCurves: (sel, opts = {}) =>
    set(sel === null ? { curveSelection: null, curveTab: false } : opts.reveal === false ? { curveSelection: sel, selection: null } : { curveSelection: sel, selection: null, curveTab: true, rightOpen: true }),
  setStyleClipboard: (styleClipboard) => set({ styleClipboard }),
  addRecentColour: (colour) => {
    const recentColours = pushRecentColour(get().recentColours, colour);
    set({ recentColours });
    try {
      localStorage.setItem(RECENT_COLOURS_KEY, JSON.stringify(recentColours));
    } catch {
      // Private mode etc.: not remembered.
    }
  },
}));
