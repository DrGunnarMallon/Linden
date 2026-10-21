// Core data model — see SPEC.md §3. Keep in sync with the spec.

export type MeasurementKind =
  | "count"
  | "percent"
  | "concentration"
  | "influx"
  | "abundanceClass"
  | "presence"
  | "volumePercent"
  | "continuous";

export interface Variable {
  id: string;
  name: string;
  kind: MeasurementKind;
  unit?: string;
  group?: string;
  meta?: Record<string, unknown>;
  /** Text codes of an ordinal column (e.g. DAFOR letters, "+"); values are indices into this list until a scaleMap maps them. */
  codes?: string[];
  /** Axis labels at plotted values, e.g. class codes after a scaleMap. */
  scaleLabels?: { value: number; label: string }[];
}

export interface Group {
  id: string;
  name: string;
  colour?: string;
  order: number;
}

export interface Sample {
  id: string;
  depth: number;
  age?: number;
  ageError?: [number, number];
  label?: string;
}

export interface LithologyUnit {
  top: number;
  bottom: number;
  code: string;
  description?: string;
}

export interface DatingPoint {
  depth: number;
  label: string;
  age?: number;
  error?: number;
}

export interface SpikeInfo {
  sampleId: string;
  markerCounted: number;
  markerAdded: number;
  sampleVolume?: number;
  sampleMass?: number;
}

export interface Dataset {
  id: string;
  name: string;
  depthUnit: "cm" | "m" | "mm";
  ageUnit?: "cal BP" | "BP" | "CE/BCE" | "b2k";
  samples: Sample[];
  variables: Variable[];
  groups: Group[];
  /** [sampleIndex][variableIndex]; 0 = looked, none found; null = not assessed. */
  values: (number | null)[][];
  extra?: {
    lithology?: LithologyUnit[];
    dates?: DatingPoint[];
    spikes?: SpikeInfo[];
  };
}

// Plugin interfaces — see SPEC.md §5.1.

export interface ImportResult {
  datasets: Dataset[];
  warnings: string[];
}

export interface Importer {
  type: string;
  accepts(file: { name: string; mime?: string }): boolean;
  import(input: ArrayBuffer | string, options?: unknown): Promise<ImportResult>;
}

/** A named sum: union of the listed groups and variables, or every eligible variable. */
export interface SumDefinition {
  includeGroups?: string[];
  includeVariables?: string[];
  includeAll?: boolean;
}

/** How variables outside the sum are expressed. "sumPlusGroup" = % of (sum + own group total). */
export interface OutsideSum {
  groups: string[];
  basis: "sum" | "sumPlusGroup";
}

export interface TransformContext {
  sums: Record<string, SumDefinition>;
  /** Named ordinal scales (code → plotted value). */
  scales?: Record<string, Record<string, number | null>>;
  outsideSum?: OutsideSum;
  warn(message: string): void;
}

export interface Transform {
  type: string;
  /** Returns a NEW dataset; never mutates `ds`. */
  apply(ds: Dataset, params: unknown, ctx: TransformContext): Dataset;
}
