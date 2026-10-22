# Linden — Specification

> Working name: **Linden** (*Tilia* is the linden/lime tree — a nod to Eric Grimm's program). Rename freely.

A free, browser-based, scriptable tool for drawing publication-quality stratigraphic diagrams of palaeoecological and palaeoenvironmental data: pollen, spores, non-pollen palynomorphs, plant macrofossils, testate amoebae, diatoms, chironomids, charcoal, geochemistry, physical properties, and inferred reconstructions.

This document is the source of truth for architecture. Code follows the spec; if the spec is wrong, update the spec first, then the code.

---

## 1. Principles

1. **Proxy-agnostic core.** Nothing in `core` knows what pollen is. Proxy conventions (pollen sums, macrofossil abundance scales, diatom groupings) live in **presets** — plain JSON files — never in code paths.
2. **Declarative.** A diagram is fully described by `data + spec`. The UI only edits the spec. The same `data + spec` always produces the same SVG, byte-for-byte.
3. **Modular by registry.** Importers, transforms, analyses, panels and exporters are plugins registered by `type` string. Adding a feature means adding a module, not editing the engine.
4. **Vector-first, physical units.** Layout is computed in millimetres on a defined page. SVG is the native output; PDF and PNG are derived from it.
5. **Client-side only.** No server, no upload of user data. Hostable as static files (e.g. GitHub Pages).
6. **Reproducible and citable.** The spec is a versioned JSON file users can save next to their data and archive with a paper.
7. **Headless-capable.** `core` has no DOM or React dependency, so the same code can later power a CLI and a Python wrapper.

## 2. Repository layout

```
linden/
  SPEC.md            ← this file
  CLAUDE.md          ← working rules for Claude Code
  package.json       ← npm workspaces root
  tsconfig.base.json
  packages/
    core/            ← pure TS: model, transforms, analyses, layout, panels, SVG
    app/             ← React UI (Vite); depends on core
    cli/             ← (later) Node CLI: linden render data.csv spec.json -o fig.svg
  presets/           ← proxy presets (JSON)
  fonts/             ← bundled export font (Liberation Sans regular + italic, SIL OFL 1.1)
  examples/          ← example datasets + specs used in docs and tests
```

`core` internal layout:

```
core/src/
  model/        types for Dataset, Variable, Sample, Spec; spec form description + UI hints (§11)
  io/           importers (csv, xlsx, tilia-tlx, neotoma) + spec (de)serialisation
  transforms/   percentage, concentration, influx, scale-mapping, smoothing
  analyses/     coniss, broken-stick, (later) pca, rarefaction
  layout/       page, columns, scales, label placement
  panels/       one file per panel type
  render/       SVG builder (string-based, no DOM)
  export/       svg exporter (pdf/png need browser APIs → app/src/export, registered into `exporters`)
  registry.ts   plugin registries
  index.ts      public API
```

## 3. Data model

Data are a samples × variables table plus metadata. Every variable carries a **measurement kind** so that transforms and panels can behave correctly without knowing the proxy.

```ts
type MeasurementKind =
  | "count"          // raw counts (pollen grains, tests, valves, seeds, head capsules)
  | "percent"        // already-expressed percentages
  | "concentration"  // per volume or per mass (e.g. grains/cm³)
  | "influx"         // per area per year
  | "abundanceClass" // ordinal scale, e.g. macrofossils 1–5, DAFOR
  | "presence"       // 0/1 or "+"
  | "volumePercent"  // e.g. macrofossil QLCMA % volume estimates
  | "continuous";    // LOI, magnetic susceptibility, δ13C, inferred WTD/pH/temperature

interface Variable {
  id: string;              // stable key, unique within dataset (column header by default)
  name: string;            // display name, may contain italics markup (see §7.4)
  kind: MeasurementKind;
  unit?: string;
  group?: string;          // refers to Group.id
  meta?: Record<string, unknown>; // e.g. ecological group code from Tilia, Neotoma taxon id
  codes?: string[];        // text codes of an ordinal column (DAFOR letters, "+"); values index into it until a scaleMap maps them
  scaleLabels?: { value: number; label: string }[]; // axis labels at plotted values, set by scaleMap (e.g. the DAFOR letters)
}

interface Group {
  id: string;
  name: string;            // "Trees & shrubs", "Testate amoebae — Hyalospheniidae", ...
  colour?: string;
  order: number;
}

interface Sample {
  id: string;
  depth: number;           // primary y; unit given by dataset.depthUnit
  age?: number;            // optional, from chronology
  ageError?: [number, number];
  label?: string;
}

interface Dataset {
  id: string;
  name: string;
  depthUnit: "cm" | "m" | "mm";
  ageUnit?: "cal BP" | "BP" | "CE/BCE" | "b2k";
  samples: Sample[];
  variables: Variable[];
  groups: Group[];
  values: (number | null)[][]; // [sampleIndex][variableIndex]; null = not counted / missing
  extra?: {                    // optional side tables
    lithology?: LithologyUnit[];
    dates?: DatingPoint[];     // radiocarbon / other dates for display
    spikes?: SpikeInfo[];      // Lycopodium etc. per sample for concentration
  };
}
```

Zero and `null` are different: zero means "looked, found none"; `null` means "not assessed". Panels must render them differently (gap vs. zero line).

Multiple datasets (e.g. pollen + macrofossils + LOI from the same core) are combined in one diagram by sharing a y-axis (§5).

## 4. The diagram spec

The spec is JSON, validated with a schema (zod in `core`, exported as JSON Schema). It has a `specVersion` so old files keep working via migrations.

```jsonc
{
  "specVersion": 8,
  "page": { "width": 180, "height": 240, "units": "mm", "font": { "family": "Arial", "size": 7 } },
  "title": { "text": "Lake *Linden*", "subtitle": "Pollen percentages", "align": "left", "size": 10 }, // optional
  "style": {                                   // the figure's own style; fonts default from page.font
    "background": "#ffffff",                   // null = transparent
    "fonts": { "title": { "family": "Arial", "size": 10 }, "labels": { "size": 7 }, "ticks": { "size": 6 } },
    "lineWidths": { "axis": 0.15, "curve": 0.1 }, "tickLength": 1,
    "colours": { "axis": "#000000", "text": "#000000" }
  },
  "xScale": 0.4,                               // global x factor, mm per % before page fitting (§6)
  "headerBand": { "angle": 60, "minFontSize": 5, "height": null },   // taxon labels; height null = fit
  "yAxis": {
    "primary": "depth",               // "depth" | "age"
    "secondary": "age",               // optional second axis column
    "reverse": true,                  // depth increasing downwards
    "range": null,                    // null = data extent
    "ticks": { "major": 50, "minor": 10 },
    "titles": { "depth": "Depth (cm)", "age": "Age (cal BP)" } // default from the dataset units; "" = none
  },
  "datasets": [
    {
      "dataset": "pollen",
      "groups": [                                        // this dataset's groups: define / rename / recolour / order
        { "id": "bryophytes", "name": "Bryophytes", "colour": "#6b7f2a", "order": 6 },
        { "id": "herbs", "name": "Herbs (upland)" }
      ],
      "assignments": { "Sphagnum": "bryophytes" },       // variable id → group id
      "order": ["Sphagnum", "Calliergon"],                // explicit order within each group
      "transforms": [
        { "type": "merge", "id": "Calliergon", "name": "*Calliergon*",
          "from": ["Calliergon giganteum", "Calliergon cordifolium"], "group": "bryophytes" },
        { "type": "percent", "sum": "terrestrial" }
      ],
      "sums": {
        "terrestrial": { "includeGroups": ["trees", "shrubs", "herbs"] }
      }
    }
  ],
  "analyses": [
    { "id": "zones", "type": "coniss", "input": { "dataset": "pollen", "groups": ["trees", "shrubs", "herbs"] }, "transform": "sqrt" }
  ],
  "panels": [
    { "type": "lithology", "width": 8 },
    { "type": "dates", "width": 6 },
    { "type": "taxonCurves",
      "dataset": "pollen",
      "variables": { "groups": ["trees", "shrubs"], "minMax": 2, "order": "data" },
      "style": { "curve": { "type": "polygon", "exaggeration": { "show": true, "factor": 10 } },   // curve style (below)
                 "commonScale": true, "minWidth": 4,
                 "groupGap": 2, "xTicks": { "step": null, "minSpacing": 6, "unitSuffix": false },
                 "xTitle": { "text": "%", "show": "panel" } },
      "overrides": { "Pinus": { "minWidth": 2 } } },               // per-variable column layout
    { "type": "summary", "dataset": "pollen", "groups": ["trees", "shrubs", "herbs"], "width": 25 },
    { "type": "dendrogram", "analysis": "zones", "width": 15 }
  ],
  "overlays": [
    { "type": "zones", "from": "analysis:zones", "n": 4, "labels": ["P1", "P2", "P3", "P4"] }
  ],
  "groupHeaders": { "show": true, "line": "line" },  // default: one header per group
  "headers": [                                       // optional explicit headers instead
    { "label": "Trees & shrubs", "spans": { "groups": ["trees", "shrubs"] } },
    { "spans": { "groups": ["herbs"] } }               // label defaults to the group name(s)
  ],
  "groupStyles": { "herbs": { "type": "bars" } },      // curve style per group id
  "curveStyles": { "Pinus": { "exaggeration": { "show": false } },   // curve style per variable id
                   "Betula": { "fill": { "colour": "#000000", "pattern": { "type": "hatch", "angle": 45, "spacing": 0.8 } } } },
  "preset": "pollen-percent"
}
```

Key rules:
- **Groups** are user-defined per dataset and stored in the spec (`datasets[].groups`, so in the `.linden.json` project with that dataset); presets define none. The data's groups (e.g. a CSV group row) only seed them: the app writes them into the new dataset entry on import. Effective groups = the data's groups overlaid field by field by the entry's `groups` (same id); groups only in the entry are added, even when empty (so users can create e.g. "Bryophytes"); a data group the entry does not list is dropped once no variable is left in it (so a deleted group stays deleted). `order` decides group order (lower first; groups without one come last, in list order). Groups of one dataset never apply to another.
- **Empty groups** are never drawn: no columns, no gap, no header. The app lists them greyed out with a delete action, so taxa can still be dragged into them.
- **Assignments** (`datasets[].assignments`: variable id → group id) override a variable's group. Groups and assignments are applied **before transforms**, so they also change sum membership (moving a taxon out of a sum group takes it out of the sum). An assignment to a group that does not exist, or of an unknown variable, is ignored with a warning; merged variables take their group from the merge transform.
- **Column order**: group order first; within each group the dataset's explicit `order` list (variable ids), then every unlisted variable in the panel's `variables.order` — new taxa never disappear silently. Ungrouped variables come last. An unknown id in `order` is a warning.
- **Variable selection** is declarative: by explicit ids, by groups (union of both; neither = all), by threshold (`minMax`: include if max ≥ x), plus ordering:
  - `data` — dataset column order;
  - `alphabetical` — display name without markup, case-insensitive;
  - `weightedAverageDepth` — abundance-weighted mean depth of non-zero values, shallowest first;
  - `firstOccurrence` — depth of the deepest (oldest) non-zero value, i.e. stratigraphic first appearance, deepest first;
  - explicit list of ids — listed variables first in list order, the rest after.
  Variables with no non-zero value go last. These panel orders apply within groups (see column order). All orders except `data` break ties by variable id (code-unit comparison, locale-independent).
- **Per-variable overrides** of the column layout are allowed (`overrides: { "Pinus": { "minWidth": 2 } }`: `commonScale`, `minWidth`, `columnWidth`, `xTicks`) but discouraged. Panel-level keys (`curve`, `groupGap`, `xTitle`) cannot be overridden there (per-variable curve styles live in `curveStyles`); overrides for ids not in the dataset produce a warning.
- **Curve styles** decide how each taxonCurves column's values are drawn. A curve style (`CurveStyleSchema`, a discriminated union on `type`) is one of:
  - `polygon` — `filled`, `fill` (`colour`, `opacity`, `pattern`: `type` `solid` | `hatch` | `crosshatch` | `dots` for black-and-white journals, `angle` °, `spacing` mm), `outline` (`show`, `colour`, `width`, `dash`), `shape` `linear` | `step` (each sample a block reaching halfway to its neighbours);
  - `line` — `line` (`colour`, `width`, `dash`: `solid` | `dashed` | `dotted` | custom array in mm), `interpolation` `linear` | `step`, `points` (as below, plus `show`, default off);
  - `linePoints` / `points` — `points` (`shape` `circle` | `square` | `triangle` | `diamond` | `cross`, `size` mm, `filled` (open marks are filled with the page background), `colour`), plus the line options for `linePoints`;
  - `bars` — `barWidth` (`mode` `mm` | `fraction` of the local sample spacing = the distance to the nearest neighbouring sample, `value`; fraction bars never overlap and stay inside the plot), `fill` and `outline` as polygon, `align` `centre` (on the sample depth);
  - `presence` — `presence` (`symbol` `dot` | `plus` | `bar` | `square`, `size` mm, `colour`): a mark at the column centre (bar: full width) where the value is > 0; marks never exceed the column;
  - `none` — no curve; the column, its axis, label and value labels stay (spacing or label-only columns).

  Every type also has: `exaggeration` (`show`, `factor`, `style` `filled` | `line`, `colour`, `opacity`; drawn behind the curve, capped at the column width), `baseline` (zero line: `show`, `colour`, `width`, `dash`), `nulls` `gap` | `connect`, `plus` (`+` right of non-zero values below `threshold`: `show`, `threshold`, `size`) and `valueLabels` (`show` `off` | `all` | `aboveThreshold`, `threshold`, `format` with `{value}`, `decimals`). `presence` and `none` draw no exaggeration, zero line or `+`. Colours are CSS colours or `"group"` (the variable's group colour); `exaggeration.colour` may be `"curve"` (the curve's own colour, default), `baseline.colour` `"axis"` (default). A `width` of `null` = the figure's curve line width (baseline: axis line width). Core defaults reproduce the former look: group-coloured polygons with a black outline, 0.6 mm bars, exaggeration ×10 at 0.35 opacity when shown.
- **Curve style cascade**: core defaults (per type) → preset (`panelDefaults.taxonCurves.curve`) → panel (`style.curve`) → group (`groupStyles[group id]`, in every dataset with that group) → variable (`curveStyles[variable id]`). Each level is a partial override (any option of any type, all optional, `CurveStyleOverrideSchema`) and is deep-merged; the type is the last one set (default `polygon`). A level that changes the type first discards the collected options the new type does not have — shared options and options both types have (e.g. `fill` from polygon to bars, `line` from line to linePoints) are kept; options of a type that is not chosen are ignored. Variables of kind `presence` are drawn as presence marks whatever their type, unless it is `none`. `resolveCurveStyle(spec, variableId, { panel?, group?, kind?, presets? })` returns `{ style, source }`, where `source` maps every option path (`"type"`, `"fill.colour"`, …) to the level it came from (`default`, `preset`, `panel`, `group`, `variable`, `kind`), for the app's inspector. The spec stores only what the user set, never resolved defaults. `curveStyles` / `groupStyles` keys that are no variable / group of any dataset produce a warning.
- **The curve style never changes the layout**: column widths, the common x-scale and page fitting depend only on the data, kinds and the layout keys; what is reserved beyond a column (tick labels, `+` markers, value labels) only on options every type shares. Changing a curve's type leaves every column exactly where it was.
- **Group headers** are drawn by default: a horizontal line above each group's columns, spanning exactly those columns, with the group name centred above it — one per run of adjacent columns of the same group within a panel (never across panels; ungrouped columns get none). `groupHeaders.show` (default `true`) turns all group headers off; `groupHeaders.line` is `"line"` (default), `"bracket"` (line with end ticks) or `"none"` (label only). Explicit `headers` replace the automatic ones: each spans exactly the columns whose group is in `spans.groups` or whose id is in `spans.ids`, across all panels; `label` defaults to the spanned group names joined by " & ". If the matching columns are not adjacent, one line is drawn per run (label on the first) and a warning is emitted; overlapping headers warn. `style.groupGap` (mm, default 2) is the gap between adjacent columns of different groups.
- **Spec versions**: `parseSpec` migrates older versions before validation (`model/migrate.ts`). v2 added `headerBand`, `headers`, `style.groupGap` and `style.xTicks`; v3 added top-level `groups`, `datasets[].assignments` / `order` and the `merge` transform; v4 added the `scaleMap` transform, `datasets[].scales`, `variables.kinds` and `style.presence` (all optional, so these migrations only bump the number). v5 moved groups into `datasets[].groups`, added `groupHeaders` (headers on by default) and made the percent transform's `sum` optional; presets lost `groups`, `sums` and `outsideSum`. The v4→v5 migration copies top-level `groups` and the groups, sums, `outsideSum` and default transforms the bundled presets used to define (a frozen copy in `migrate.ts`) into the dataset entries (creating entries without transforms for panel datasets that had none), and gives explicit `headers` `groupHeaders.line: "bracket"`, so old diagrams look the same apart from the new default group headers. v6 added `title`, `style`, `yAxis.titles`, taxonCurves `style.xTitle` and `style.xTicks.unitSuffix` (all optional, so the migration only bumps the number); old diagrams gain the default x-axis titles (which replace the former unit labels) and a white background. v7 added the global `xScale` and taxonCurves `style.columnWidth` (optional, defaults equal to the former fixed constants, so the migration only bumps the number and diagrams look the same). v8 added curve styles (`style.curve`, `groupStyles`, `curveStyles`) and removed taxonCurves `style.mode`, `fill`, `exaggeration`, `plusBelow` and `presence`: the migration moves them into `style.curve` (`mode` → `type`: `silhouette` → `polygon`, `bars`, `line`, `linePoints`; `fill` → `fill.colour` (line modes: `line.colour`, linePoints also `points.colour`) and `presence.colour`; `exaggeration` n → `{ show: n > 1, factor: n }`; `plusBelow` p → `{ show: p > 0, threshold: p }`; `presence` → `presence.symbol`, a bar keeping its 0.6 mm size), writing only the keys that were set. The same keys in per-variable `overrides` move into `curveStyles` (a variable overridden in several panels: later panels win); the layout keys stay. Presets went to `presetVersion` 2 the same way (`parsePreset` migrates v1). Diagrams look the same, except that `line` / `linePoints`, formerly drawn as silhouettes, are now drawn as lines.
- **Presets** provide styling/behaviour defaults; explicit spec values always win. Resolution order: core defaults → preset → spec → per-variable override. Objects merge deeply; arrays and `null` replace. Named scales replace whole (a spec scale with the same name as a preset one wins entirely); a dataset entry without `transforms` uses the preset's `transforms` (so `"preset": "testate-percent"` alone gives percentages of total tests).
- **Sums** are the dataset entry's own (`datasets[].sums`, e.g. a pollen sum of user-defined groups). A percent transform without `sum` uses the default sum: every variable of kind `count` in the dataset (before selection, so thresholds never change the sum).
- **Dataset entries** may define named ordinal `scales` (`{ "dafor": { "-": 0, "R": 1, …, "D": 5 } }`, code → plotted value, `null` = not assessed), referenced by the `scaleMap` transform.
- **Selection by kind**: `variables.kinds` keeps only variables of these measurement kinds (after transforms), e.g. one panel each for counts, abundance classes and presence.
- **Dataset entries** may carry `outsideSum: { "groups": [...], "basis": "sum" | "sumPlusGroup" }`.
- **Zones overlay**: `{ "type": "zones", "manual": [{ "depth": 65, "label": "P1/P2" }] }` draws boundaries at given depths (M1). Zones from an analysis (`from`, `n`, `labels`) follow in M5.
- **x-scale** (`xScale`, mm per %, default 0.4): the global x factor before page fitting (§6). It is one value for the whole diagram, not per panel, so common scales stay common across panels; other scale families follow it. taxonCurves `style.columnWidth` (mm, default 15) is the width of columns without a common scale. Both are what the app's resize handles write (§11).
- **Title** (`title`): optional `text` and `subtitle` (both may use `*italic*` markup), `align` `"left"` (default, aligned with the first panel) or `"centre"` (over the panels), `size` in pt (default `style.fonts.title.size`; subtitle 0.8 × title). Drawn in a title band above the header band (§6).
- **Figure style** (`style`) is the figure's own look, independent of the app's light/dark theme: `background` (default white `#ffffff`; `null` = transparent), fonts for `title` (default labels size + 3 pt), `labels` (taxon labels, group headers, axis titles, zone labels; default `page.font`) and `ticks` (default 0.85 × labels size), each `{ family, size }` in pt; `lineWidths.axis` / `.curve` and `tickLength` (minor ticks 0.6 ×) in mm; `colours.axis` (axis lines, ticks, zero lines, group-header lines) and `colours.text`. Curve outlines and zone lines keep their own colour.
- Spec objects are strict: unknown keys are validation errors (catches typos). `parseSpec` returns readable errors with paths, e.g. `panels[1].style.curve.type: …`.

## 5. Pipeline

```
Importer → Dataset(s) → Groups & assignments → Transforms → Analyses → Layout → Panels → SVG → Exporter
```

`prepareDatasets(datasets, spec, presets)` exposes the datasets after groups, assignments and transforms (what the panels see), e.g. for the app's variable list.

All stages are pure functions of their inputs. Results are memoised by input hash so the UI stays fast.

### 5.1 Interfaces

```ts
interface Importer {
  type: string;                        // "csv", "xlsx", "tilia-tlx", "neotoma"
  accepts(file: { name: string; mime?: string }): boolean;
  import(input: ArrayBuffer | string, options?: unknown): Promise<ImportResult>;
}
interface ImportResult { datasets: Dataset[]; warnings: string[]; suggestedSpec?: Partial<Spec>; }

interface Transform {
  type: string;                        // "percent", "concentration", "influx", "scaleMap", ...
  apply(ds: Dataset, params: unknown, ctx: TransformContext): Dataset; // returns a NEW dataset
}

interface Analysis<R = unknown> {
  type: string;                        // "coniss", "brokenStick", ...
  run(input: number[][], params: unknown): R;   // heavy ones run in a Web Worker in app
}

interface Panel {
  type: string;
  /** Natural width in mm given data and style; layout may scale it. */
  measure(ctx: PanelContext): { width: number; headerHeight: number };
  /** Draw into an SVG group whose origin is the panel's top-left plot corner. */
  render(ctx: PanelContext, g: SvgGroup): void;
  /** Labelled columns (x relative to the panel) for the shared header band (§6). Optional. */
  columns?(ctx: PanelContext): { id: string; label: string; group?: string; x: number; width: number }[];
  /** Column geometry for the app's resize handles: x, width, minWidth and how the width follows a resize
   *  ("scale": max(minWidth, extent × x factor) | "column": style.columnWidth | "fixed"). Optional. */
  columnLayout?(ctx: PanelContext): ColumnLayout[];
}

interface PanelContext {
  id: string;                // SVG id of the panel group, prefix for child ids
  spec: ResolvedPanelSpec;
  data: ResolvedData;        // transformed values, selected variables
  y: YScale;                 // shared y scale (mm ↔ depth/age)
  yAxis: ResolvedYAxis;      // ticks, secondary axis
  xScale: number;            // global common x-scale, mm per data unit (after shrinking)
  page: PageMetrics;
  theme: Theme;
  groups: GroupSpec[];       // group colours/names from the resolved spec
  header: { fontSize: number; angle: number }; // shared taxon-label font size (mm) and angle; final in render()
  analyses: Record<string, unknown>;
  warn(message: string): void;
}

interface Overlay {          // drawn across all panels, after them
  type: string;              // "zones"
  measure(ctx: OverlayContext): { width: number };   // extra width right of the panels (labels)
  render(ctx: OverlayContext, g: SvgGroup): void;
}

interface Exporter { type: string; export(svg: string, opts: unknown): Promise<Blob | string>; }
```

`render(datasets, spec, presets)` returns `{ svg, warnings, info, layout }`. `layout` is plain layout metadata in page mm, so the app can hit-test and resize without reading the SVG: page size and margins, plot rectangle, header and footer heights, the x factor (`natural` = spec `xScale`, `used` after fitting), `slack` (page width left before fitting would start; 0 once fitted, negative if it does not fit), the panel gap, per panel its index, type, box (panel width × header band top … footer bottom) and `columnLayout()`, the y domain and direction, and the distinct sample depths.

Core registers the `svg` exporter in `exporters`; the app registers its browser-only `pdf` and `png` exporters into the same registry.

### 5.2 Transforms (initial set)

| type            | purpose |
|-----------------|---------|
| `percent`       | counts → % of a named sum; sum defined by `includeGroups` / `includeVariables` / `includeAll`; excluded groups expressed as % of (sum + group) — a preset choice, not hard-coded |
| `concentration` | via exotic marker spikes (Lycopodium/microspheres) or volume/mass |
| `influx`        | concentration × accumulation rate (needs ages) |
| `scaleMap`      | `{ scale: name \| [names] }` or `{ map: {code: value} }`, optional `kinds` (default `abundanceClass`, `presence`) or `variables`. Maps ordinal classes / presence codes (1–5, DAFOR, `+`) to plotted values. With a list of named scales each variable uses the first scale that contains every code it uses. Unmapped codes → `null` + warning; an unmapped numeric 0 stays 0. Sets `scaleLabels` to the whole chosen scale, so class axes show the codes. Text codes no scaleMap has mapped are never plotted (warning). |
| `merge`         | `{ id, name, from: [ids], group?, keepSources: false }` — sums the sources per sample into one variable placed where the first source was; null + number = number, all null = null, 0 stays 0. Sources of different kinds are refused (warning); different units warn. Must come before `percent` (a merge after a percent transform is skipped with a warning), so merged taxa are percentages of the same sum. A variable used by two merges is a warning. |
| `log` / `sqrt`  | for analyses or display |

`percent` rules: only `kind: "count"` variables take part (others pass through unchanged); converted variables become `kind: "percent"`, `unit: "%"`. Variables outside the sum are % of the sum unless their group is in `outsideSum` with basis `sumPlusGroup`. `null` stays `null`; a sample whose sum is 0, or has no assessed sum members, gives `null` for all converted variables plus a warning.

### 5.3 Analyses

- **CONISS** (Grimm 1987): constrained incremental sum of squares on chosen variables, with optional sqrt/chord transform. Returns the merge tree and dispersion per merge.
- **Broken-stick** (Bennett 1996): suggested number of significant zones.
- Later: PCA/DCA axis scores as a `continuous` variable, rarefaction, CONISS on combined proxies.

## 6. Layout engine

- Coordinates in mm. Page = title band (title, subtitle) + header band (taxon labels) + plot area + footer band (x-axis scales and titles). The SVG viewBox is in mm; font sizes are in points (converted to mm); `page.font` is the base for all text unless `style.fonts` says otherwise (§4). The page background is a full-page `<rect id="background">` unless `style.background` is `null`.
- **Title band**: above the header band, its height (title line + subtitle line + 2 mm gap) reserved and taken from the plot height; the width fit below is unaffected. A title wider than the space between the margins is set smaller in 0.25 pt steps, down to the labels font size (info message), then reported as a warning. No DOM: text widths come from a deterministic per-character metrics table (`layout/metrics.ts`, unknown characters ≈ 0.556 em) holding the advance widths of the bundled font, Liberation Sans (metrically compatible with Arial/Helvetica; a test checks the table against `fonts/*.ttf`). No kerning.
- `measure()` must not depend on the plot height; it may grow with the fit state (x factor, compaction, label font) but never shrink when they grow. Panels report what they draw beyond their own width (`PanelMeasure.overhang`: edge tick labels, x-axis titles, markers) so the layout can reserve it.
- **Everything drawn is reserved; nothing is drawn outside the page.** The panels stay inside the page margins; ink beyond them — rotated taxon labels (their full rotated glyph box: baseline offset 0.35 em, ascent 0.75 em, descent 0.25 em), group-header labels, zone labels, edge tick labels and x-axis titles — may use the margins but never leaves the page. If ink sticks out left of the first panel, the diagram shifts right.
- Columns are laid out left to right in panel order. Each taxon column's width is proportional to its maximum value **when `commonScale` is true** (the standard convention for percentage diagrams: 10% is the same width in every column). `minWidth` stops rare taxa from vanishing.
- **Scale families.** A common scale is shared only by columns of the same kind and unit (`kind|unit`), across all panels — percentages and counts never share one. Percent kinds (`percent`, `volumePercent`) use the global x-scale (natural = spec `xScale`, default 0.4 mm per %); any other family is scaled so that its maximum, rounded up to a 1–2–5 value, is as wide as 100 %. One global factor shrinks all families together when fitting the page. A panel mixing kinds gets a warning (use `variables.kinds`).
- **Independent scales** (`commonScale: false`): fixed column width (`style.columnWidth`, default 15 mm; never below `minWidth`), own scale from 0 to the column maximum rounded up to a whole tick step (class scales: up to the top class), so the axis ends on a labelled tick; labels stay inside the column (first left-aligned, last right-aligned).
- **x-axis titles** below the tick labels (labels font), per taxonCurves panel (`style.xTitle`): `show: "panel"` (default) = one title per run of adjacent columns of one scale family, centred under the run; `"column"` = under every column; `"none"`. Text = `xTitle.text`, else from the kind and unit: `%` (percent: the unit), `Counts (unit)`, `Concentration (unit)`, `Influx (unit)`, `Volume (%)`, `Abundance class`, `Presence`, the unit (continuous); `""` = none. Titles are placed left to right; one that would touch the previous is skipped with a warning. The footer grows by one line only when titles are shown. Titles and edge tick labels reaching into a neighbouring panel's ink produce a warning.
- **Presence** (kind `presence`): no scale; a fixed-width column (`max(minWidth, 3 mm)`) with presence marks (curve style `presence`, §4: dot by default) at each sample with value > 0; 0 and `null` draw nothing.
- **Fitting the page width.** If the natural layout is too wide, these steps apply in order, each only as far as needed (bisection), the next only if the previous one at its floor is not enough:
  a. shrink the global x factor (all scale families together, so common scales stay common; independent-scale columns shrink with it), down to 25 % of natural (`xScale`; 0.1 mm per % at the default);
  b. compact every column `minWidth` (towards 0.5 mm) and the column and group gaps (towards 0.3 mm) proportionally;
  c. reduce the taxon-label font cap in 0.25 pt steps, down to `headerBand.minFontSize`;
  d. warn: "does not fit the page width", with the page width needed, the parts (panels, labels left/right) and how many mm are missing.
  Each applied step is reported as an **info** message (`RenderResult.info`, e.g. "minWidth reduced from 4 to 2.6 mm, column gaps from 1 to 0.73 mm to fit the page."), not as a warning. Never silently break the common scale.
- Tick labels are placed left to right across a whole panel: a label (even a column's "0") is skipped if it would touch the previous one, so compacted columns thin their labels instead of overlapping them.
- Header labels: rotated (`headerBand.angle`, default 60°), anchored at column centre. One header band is laid out for all panels (from their `columns()`), so every taxon label has the same font size. Adjacent labels collide when their perpendicular distance (pitch × sin θ) is under 1 em while they overlap along the text (pitch × cos θ < label length). Resolution order: reduce the font in 0.25 pt steps from `page.font.size` down to `headerBand.minFontSize`; then grow the band beyond `headerBand.height` (if set; warns); labels that still overlap produce a warning — never silently. Both ends of the labels are reserved in the page fit (see "Fitting the page width"), so labels never run off the page.
- Group headers sit in a row above the taxon labels (§4 group headers).
- Per-column x axes: tick step = `style.xTicks.step`, or automatically the smallest 1–2–5 × 10ⁿ step at least `xTicks.minSpacing` mm long at the column's scale (with a common scale, the same step in every column — e.g. 20 % at 0.4 mm/%); never below 1 for whole-number kinds (`count`, `abundanceClass`). Class scales are labelled with their codes (`scaleLabels`). Tick labels are placed left to right and skipped if they would touch the previous label or the next column's "0", so narrow columns keep a single label. `xTicks.unitSuffix` appends the unit to the last label (`40%`; other units after a space; none on class scales), with the number kept on its tick, only where it still fits.
- One shared y-scale for all panels; secondary axis (age) drawn by interpolation from sample depth–age pairs, never by re-scaling.
- y-axis titles (`yAxis.titles.depth` / `.age`, default `Depth (<depthUnit>)` and `Age (<ageUnit>)`, or `Age` without a unit) are rotated 90° in their own 1 em + 1 mm strip left of the tick labels; `""` removes the title and its strip. A title longer than its axis is a warning.
- Zone overlays draw across all panels; zone labels sit in a narrow column right of the last panel.
- The secondary age axis uses the first spec dataset with sample ages; ages must not decrease with depth, and ticks are never extrapolated beyond the dated range.
- SVG output is deterministic: coordinates rounded to 0.01 mm, attributes in a fixed canonical order. The root carries `<metadata id="linden-metadata">generator: Linden <version>; spec-sha256: <hash></metadata>`, the hash being SHA-256 of the input spec's canonical JSON (keys sorted).

## 7. Panels (catalogue)

### 7.1 MVP
- `yAxis` — depth and/or age axis with ticks and editable titles (§6).
- `taxonCurves` — one column per variable, each drawn with its resolved curve style (§4 "Curve styles"): `polygon` (filled silhouette, optionally hatched / cross-hatched / dotted, linear or stepped), `line`, `linePoints`, `points`, `bars` (fixed mm or a fraction of the sample spacing), `presence` or `none`, with an exaggeration curve (×n, filled or line), zero line, `null` gaps or connections, `+` marker for values below a threshold (e.g. < 0.5%) and value labels. The style comes from the cascade preset → panel `style.curve` → `groupStyles` → `curveStyles`; there is no separate styling panel. Also: x-axis ticks per column, x-axis titles (§6), presence columns (§6), class-code axes after a `scaleMap`. The curve style never changes column widths or the x-scale.
- `zones` overlay — horizontal lines + labels.

### 7.2 Next
- `summary` — cumulative group curve (e.g. AP/NAP, trees/shrubs/herbs).
- `dendrogram` — from a CONISS result, x = total sum of squares.
- `lithology` — Troels-Smith or simple hatch patterns from `extra.lithology`.
- `dates` — markers for dated levels with labels.
- `continuous` — LOI, magnetic susceptibility, inferred WTD/pH, with optional error envelope; x-axis ticks and titles as taxonCurves (`xTicks`, `xTitle`).
- `abundanceSymbols` — macrofossil ordinal classes as bars or symbols of graded size.
- `text` — sample labels, count sums.

### 7.3 Proxy coverage check

| proxy | typical kind | panels |
|---|---|---|
| Pollen, spores, NPPs | count → percent / concentration / influx | taxonCurves, summary, dendrogram |
| Testate amoebae | count → percent; inferred WTD | taxonCurves, continuous (with error) |
| Diatoms | count → percent; inferred pH/TP | taxonCurves (many taxa: ordering + thresholds matter), continuous |
| Plant macrofossils | count per volume, abundanceClass, volumePercent, presence | taxonCurves (bars), abundanceSymbols |
| Chironomids | count (head capsules) → percent; inferred temp | taxonCurves, continuous |
| Charcoal | concentration / influx | taxonCurves (bars), continuous |
| Geochemistry / physical | continuous | continuous |

Any new proxy should be expressible by a preset alone. If it needs code, it needs a new transform or panel — generic, not proxy-named.

### 7.4 Typography
- Taxon names support `*italic*` markup and `type` suffixes (e.g. `*Quercus*`, `Poaceae`, `*Alnus*-type`). A `-type` / ` type` suffix is always upright, even when written inside the asterisks (`*Alnus-type*`).
- Default font: Arial (`page.font.family`); title, labels and ticks may use their own family and size (`style.fonts`, §4). PDF and PNG export replace Arial/Helvetica/sans-serif with the bundled, metrically identical Liberation Sans and embed it, so exports look the same on every OS; any other family is substituted too, with a warning. SVG export keeps the spec's family.

## 8. Presets

JSON files in `/presets`, same shape as a partial spec plus metadata: `presetVersion` (2; version-1 presets are migrated, §4 spec versions), `name` (must equal the file name), `description`, `page`, `yAxis`, `headerBand`, `scales`, default dataset `transforms`, `selectionDefaults` (thresholds, ordering; no `groups`), `panelDefaults` (taxonCurves: `curve` — the preset level of the curve style cascade —, commonScale, minWidth, …; strict: only implemented panel types). Presets hold only styling/behaviour defaults: **no groups, sums or `outsideSum`** — groups are user-defined per dataset and sums belong to the dataset entry (§4); a preset percent transform has no `sum`, so it uses the default sum (all count variables). `loadPresets(files)` validates them (JSON, schema, name = file name, unique names) and reports readable errors prefixed with the file name; it never throws.

- `pollen-percent` — percent transform, exaggeration ×10, silhouettes, group colours, common scale, `+` below 0.5 %. The terrestrial sum and aquatics/spores as % of (sum + group) are set per dataset (`sums`, `outsideSum`; see `examples/demo-pollen.spec.json`). (Summary panel: M3.)
- `testate-percent` — percent transform of total tests, bars, common scale, x-axis title "% of total tests". (Inferred WTD panel: M3, continuous panel.)
- `diatom-percent` — percent transform of total valves, `minMax` threshold 2%, weighted-average-depth ordering.
- `macrofossil-counts` — named scales `classes` (0–5), `dafor` (`-` R O F A D) and `presence` (`-` `+`), a default scaleMap trying them in that order, bars, independent scales, presence dots.
- `geochem` — continuous line panels (M3).

Examples (synthetic data, marked as such in the CSV header): `examples/{testate-percent,diatom-percent,macrofossil-counts,curve-styles}.{csv,spec.json}` (`curve-styles`: every curve style family in one diagram, no preset); `npm run demo -w @linden/core` renders every example to `examples/out/`.

Users can save their own presets.

## 9. Importers

| priority | type | notes |
|---|---|---|
| MVP | `csv` / `tsv` | wide format: first columns depth[, age], then one column per variable. Optional header rows starting with `group`, `kind` and/or `unit` (or sidecar JSON, later). Lines starting with `#` before the header are comments. Delimiter `,` / tab / `;` auto-detected; `;` files may use decimal commas. Variable id = header without `*` markup; name = header. Empty cell → `null`, missing kind → `count`. Ordinal columns (`abundanceClass`, `presence`) with any non-numeric cell keep their cells as text codes (`variable.codes`, first-seen order) for a `scaleMap`; text in other kinds → `null` + warning. |
| MVP | `xlsx` | same layout; via SheetJS. |
| 2 | `tilia-tlx` | Tilia XML: variables, ecological groups, units, chronology, lithology. Map Tilia ecological group codes (TRSH, UPHE, AQVP, VACR, …) to Groups. |
| 3 | `neotoma` | download dataset by ID via the Neotoma API. |
| later | long format | sample, variable, value rows. |

Importers never throw on recoverable problems: they return warnings.

## 10. Export

- **SVG** (native): clean, one `<g id="panel-<i>-<type>">` per panel, text as text (editable in Inkscape/Illustrator), `<metadata>` with Linden version and spec hash (§6).
- **PDF**: svg2pdf.js + jsPDF, vector, page = `page.width × page.height` mm exactly, Liberation Sans regular + italic embedded (subset, with ToUnicode, so text is selectable); document Creator/Subject carry the version and spec hash.
- **PNG**: rasterised in the browser at 300 / 600 (default) / 1200 dpi, pixels = round(mm / 25.4 × dpi), white or transparent background, resolution recorded in a `pHYs` chunk. (TIFF: later.)
- **Page presets** (app): single column 85 mm, 1.5 column 120 mm, double column 180 mm (width only, height kept), A4 portrait / landscape, or custom width × height; they only change `spec.page`.
- **Project bundle**: `.linden.json` = spec + embedded data, for sharing and archiving: `{ "format": "linden-project", "bundleVersion": 1, "generator": "Linden <version>", "spec": {…}, "datasets": [Dataset, …] }` (`core/io/project.ts`: `serializeProject` / `parseProject`). Datasets are stored as imported (§3), so 0 and `null` stay distinct; non-finite values are refused. The spec is migrated like any spec file; the data are validated (shape, values matrix = samples × variables).

## 11. App (UI) outline

- Left (collapsible): data & variable list (grouping, kind, visibility, drag to reorder).
- Centre: live SVG preview at true page size on a workspace canvas, zoomable (fit / 100% / 200%, Ctrl+scroll).
- Right (collapsible inspector): the spec editor, with a **Form | JSON** switch at the top (see "Graphical spec editor" below).
- Top: project name and file menu (open/save project, load/save spec, examples), import, export, undo/redo (spec history), UI theme.
- Bottom status bar: page size, zoom, spec errors, warnings (as a popover).
- A raw spec editor (JSON with schema validation) for power users — this is the "scriptable" path in the UI.
- **Graphical spec editor** (Form), switchable with the JSON editor. Both edit the one spec in the store; neither keeps its own copy, so switching is instant and lossless.
  - The form is **generated from the zod spec schema**, never written per panel: `describeSchema` (`core/model/schemaForm.ts`) turns the schema into a plain `FormNode` tree, and the app renders one control per node kind — boolean → checkbox, enum → dropdown, number → number field (min/max from the schema), string → text field, array → list with add / remove / drag to reorder, record → key/value list, tuple → fields side by side, nullable → control plus a "none" checkbox (e.g. "Fit labels"), plain union → form dropdown plus its control, discriminated union (panel / transform / overlay `type`) → type dropdown plus its sub-form. New panels, transforms, overlays and fields get a form automatically; a test fails if any schema node lacks a control.
  - **UI hints** live in core next to the schema as plain data (`core/model/specForm.ts`, no UI code), keyed by path pattern (`page.width`, `panels[].style.curve.type`, `datasets[].sums{}`): `label`, `help`, `unit` ("mm", "pt", "°"), `advanced`, field `order`, `hidden`, `nullLabel`, `optionLabels`, `itemLabel` / `itemTitle` (card titles) and `widget` (an app-provided control, e.g. dataset and preset pickers). Fields without hints get a label from their key. A test fails on hints for paths that no longer exist.
  - **Sections**: Preset, Page (page, title, figure style; plus page-size presets), Y axis, Headers, Datasets & transforms, Panels (one collapsible card per panel, drag to reorder, add / remove), Overlays. A top-level spec key in no section gets a section of its own (so `analyses`, M5, appears without UI work). Advanced fields sit in a folded "Advanced" part of their object.
  - Unset optional fields show the effective value (after preset and defaults) as a placeholder; a reset button removes the key. Form edits change only the edited value (key order kept), so form → JSON → form round-trips unchanged.
  - Every edit goes through the store (undo/redo, live preview). Text and number fields commit 300 ms after typing stops (and on blur / Enter); a burst of typing in one field is one undo step. An edit that would make the spec invalid is not applied; its errors show at the field.
  - Switching: Form → JSON always works. JSON → Form only when the JSON is valid; otherwise the JSON editor stays with its errors. The choice is remembered in localStorage.
- **Direct manipulation in the preview.** Hit-testing uses `render().layout` (§5.1), never the SVG. Clicking a panel selects it (accent outline) and opens its card in the form (switching to Form if the JSON is valid); clicking outside the panels or Esc deselects. The selected panel has a resize handle on its right edge: common-scale taxonCurves change the global `xScale` (all common-scale columns in every panel scale together; readout "mm per 10 %"), taxonCurves without a common scale change `style.columnWidth`, any other panel with a `width` changes `width`. Snap 0.5 mm (x-scale: 0.5 mm per 10 %); Alt disables snapping. A drag never grows the diagram beyond the page width left before fitting (`slack`): it stops there and says why. Manual zone boundaries can be dragged up and down, snapping to midpoints between samples. While dragging, only outlines are drawn over the dimmed figure; on release the spec changes once (one undo step) and the figure is rendered. Selection is view state, not part of the spec or the undo history.
- Empty project: a welcome screen (import CSV, open project, load an example).
- UI theme: dark (default), light or system, remembered in localStorage; it never affects the figure (§4 `style`).
- Persist work in IndexedDB; never auto-upload.

## 12. Testing & validation

- Unit tests (Vitest) for transforms and analyses with hand-computed fixtures.
- **CONISS**: validate against a reference implementation's output on a public dataset (e.g. rioja's Abernethy Forest data), merge order and dispersions within tolerance.
- **Golden SVG tests**: `examples/*` render to SVG and are compared against committed snapshots; intentional changes update snapshots in the same commit.
- Determinism test: rendering twice gives identical output.

## 13. Roadmap

- **M0 — skeleton**: workspaces, core builds, app shell renders a hard-coded SVG.
- **M1 — MVP diagram**: CSV import, percent transform, `yAxis` + `taxonCurves` (silhouette/bars), manual zones, SVG export, spec save/load.
- **M2 — publication**: exaggeration, common scale + min width, header labels and group headers, PDF/PNG export, presets for pollen/testate/diatoms/macrofossils.
- **M3 — visual elements, UI design, graphical spec editor and mouse resizing**: diagram title, axis titles, x-axis tick labels, figure style (`style`), summary panel, continuous panel, age axis; app UI design, a graphical editor for the spec, resizing columns and panels with the mouse.
- **M4 — interoperability**: Tilia `.tlx` import, xlsx, multiple datasets on one diagram, lithology and dates panels.
- **M5 — analysis**: CONISS + dendrogram + broken-stick, zones from an analysis.
- **M6 — headless**: CLI, Python wrapper, documentation site with gallery.

## 14. Non-goals (for now)

- Age–depth modelling (users bring ages from Bacon/rbacon/clam/OxCal).
- Transfer-function calibration (users bring reconstructed values; we plot them).
- Database management / Neotoma upload.
- Collaborative editing, accounts, servers.
