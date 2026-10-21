// Plugin registries — see SPEC.md §5.1. Every module registers itself by `type`.

import { csvImporter } from "./io/delimited.js";
import type { Importer, Transform } from "./model/types.js";
import { zonesOverlay } from "./overlays/zones.js";
import { taxonCurvesPanel } from "./panels/taxonCurves.js";
import type { Overlay, Panel } from "./panels/types.js";
import { yAxisPanel } from "./panels/yAxis.js";
import { mergeTransform } from "./transforms/merge.js";
import { percentTransform } from "./transforms/percent.js";
import { scaleMapTransform } from "./transforms/scaleMap.js";

export interface Registered {
  type: string;
}

export class Registry<T extends Registered> {
  private readonly items = new Map<string, T>();

  constructor(private readonly kind: string) {}

  register(item: T): void {
    if (this.items.has(item.type)) {
      throw new Error(`${this.kind} "${item.type}" is already registered`);
    }
    this.items.set(item.type, item);
  }

  get(type: string): T {
    const item = this.items.get(type);
    if (!item) throw new Error(`Unknown ${this.kind}: "${type}"`);
    return item;
  }

  has(type: string): boolean {
    return this.items.has(type);
  }

  /** Sorted for deterministic output. */
  types(): string[] {
    return [...this.items.keys()].sort();
  }
}

export const importers = new Registry<Importer>("importer");
importers.register(csvImporter);

export const transforms = new Registry<Transform>("transform");
transforms.register(percentTransform);
transforms.register(mergeTransform);
transforms.register(scaleMapTransform);

export const panels = new Registry<Panel>("panel");
panels.register(yAxisPanel);
panels.register(taxonCurvesPanel);

export const overlays = new Registry<Overlay>("overlay");
overlays.register(zonesOverlay);
