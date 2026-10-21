// Workspace view state (zoom, sidebars). Not part of the spec and not in the undo history.

import { create } from "zustand";

export type Zoom = "fit" | number;
export type InspectorTab = "diagram" | "json";

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
  zoom: Zoom;
  /** Scale actually used for the page (resolves "fit"); set by the canvas. */
  scale: number;
  leftOpen: boolean;
  rightOpen: boolean;
  inspectorTab: InspectorTab;
  setZoom(zoom: Zoom): void;
  zoomBy(dir: 1 | -1): void;
  setScale(scale: number): void;
  toggleLeft(): void;
  toggleRight(): void;
  /** Opens the inspector on the given tab. */
  showInspector(tab: InspectorTab): void;
}

export const useView = create<ViewState>()((set, get) => ({
  zoom: "fit",
  scale: 1,
  leftOpen: true,
  rightOpen: true,
  inspectorTab: "json",
  setZoom: (zoom) => set({ zoom: zoom === "fit" ? zoom : clampZoom(zoom) }),
  zoomBy: (dir) => set({ zoom: stepZoom(get().scale, dir) }),
  setScale: (scale) => set({ scale }),
  toggleLeft: () => set({ leftOpen: !get().leftOpen }),
  toggleRight: () => set({ rightOpen: !get().rightOpen }),
  showInspector: (tab) => set({ rightOpen: true, inspectorTab: tab }),
}));
