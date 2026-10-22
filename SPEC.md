# Linden — Specification

> Working name: **Linden** (*Tilia* is the linden/lime tree — a nod to Eric Grimm's program). Rename freely.

A free, browser-based, scriptable tool for drawing publication-quality stratigraphic diagrams of palaeoecological and palaeoenvironmental data: pollen, spores, non-pollen palynomorphs, plant macrofossils, testate amoebae, diatoms, chironomids, charcoal, geochemistry, physical properties, and inferred reconstructions.

This document is the source of truth for architecture. Code follows the spec; if the spec is wrong, update the spec first, then the code.

---

## 1. Principles

1. **Proxy-agnostic core.** Nothing in `core` knows what pollen is. Proxy conventions (pollen sums, macrofossil abundance scales, diatom groupings) live in **presets** — plain JSON files — never in code paths.
2. **Declarative.** A diagram is fully described by `data + spec`. The UI edits the spec, and the data only through pure edit operations (§5.4). The same `data + spec` always produces the same SVG, byte-for-byte.
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
  io/           importers (csv, xlsx, tilia-tlx, neotoma), clipboard tables, CSV export + spec (de)serialisation
  edit/         pure data edit operations, ids, provenance, dangling spec references (§5.4)
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
  id: string;              // stable key, unique within dataset; never changes (§5.4). Import: header without markup
  name: string;            // display name, may contain italics markup (see §7.4)
  kind: MeasurementKind;
  unit?: string;
  group?: string;          // refers to Group.id
  meta?: Record<string, unknown>; // e.g. ecological group code from Tilia, Neotoma taxon id
  codes?: string[];        // text codes of an ordinal column (DAFOR letters, "+"); values index into it until a scaleMap maps them
  scaleLabels?: { value: number; label: string }[]; // axis labels at plotted values, set by scaleMap (e.g. the DAFOR letters)
  companion?: { errorOf: string; role: "lower" | "upper" | "se" | "sd" }; // this column is an error of another variable (below)
}

interface Group {
  id: string;
  name: string;            // "Trees & shrubs", "Testate amoebae — Hyalospheniidae", ...
  colour?: string;
  order: number;
}

interface Sample {
  id: string;              // stable key; import: the depth as written (`#2`… for repeats)
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
  ageSource?: string;        // where the sample ages came from, e.g. an imported age–depth model (§9)
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

**Error columns.** A variable with `companion: { errorOf, role }` holds the error of variable `errorOf` (same dataset): `lower` / `upper` bounds, or `se` / `sd` (± half-width around the value). Error columns are never drawn as curves of their own; their variable draws them as an envelope or error bars (curve style `error`, §4). Bounds per sample: `lower` / `upper` if present, else value ± |SE| (else ± |SD|); a missing side falls back to the value; no bounds where the value is `null`. An error column cannot itself have error columns, nor be an error of itself.

Multiple datasets (e.g. pollen + macrofossils + LOI from the same core) are combined in one diagram by sharing a y-axis (§5).

**Ids and names.** Every variable and sample has an internal `id` that never changes; the display `name` is freely editable. Everything in the spec — assignments, `order`, merges, `curveStyles`, overrides, header spans — refers to ids, so renaming a taxon keeps its style, group and position. Importers derive ids from the file (§9); ids for variables and samples created by edits are generated deterministically (§5.4).

## 4. The diagram spec

The spec is JSON, validated with a schema (zod in `core`, exported as JSON Schema). It has a `specVersion` so old files keep working via migrations.

```jsonc
{
  "specVersion": 10,
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
- **Variable selection** is declarative: by explicit ids, by groups (union of both; neither = all), by threshold (`minMax`: include if max ≥ x; a rare-taxon threshold, not applied to `continuous` variables); error columns (§3) are never selected, even when listed (one whose `errorOf` is not in the dataset gives a warning); plus ordering:
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

  Every type also has: `exaggeration` (`show`, `factor`, `style` `filled` | `line`, `colour`, `opacity`; drawn behind the curve, capped at the column width), `baseline` (zero line: `show`, `colour`, `width`, `dash`; drawn only where 0 is on the column's axis, never on a log axis), `nulls` `gap` | `connect`, `plus` (`+` right of non-zero values below `threshold`: `show`, `threshold`, `size`), `valueLabels` (`show` `off` | `all` | `aboveThreshold`, `threshold`, `format` with `{value}`, `decimals`), `error` (the variable's error columns, §3: `show` `off` | `envelope` | `bars`; `envelope` `colour`, `opacity` — a shaded band between the bounds along each run of samples that have them, stepped like the curve, a lone sample a thin band; `bars` `colour`, `width`, `cap` — a horizontal whisker per sample with end ticks `cap` mm wide, 0 = none; drawn behind the curve, clamped to the column) and `axis` (the column's own x axis: `min` / `max` in data units, `null` = automatic; `reverse` — values increase to the left, e.g. water-table depth; `scale` `linear` | `log`; `step` tick interval, `null` = panel `xTicks`; `width` column width in mm before page fitting, `null` = panel `columnWidth`; `title` x-axis title under this column, `null` = panel `xTitle` / from kind and unit, `""` = none). Range, reverse, log, step and width apply only to columns without a common scale (§6) — `continuous` columns never have one; on any other common-scale column they are ignored with a warning, so the common scale is never broken. `presence` and `none` draw no exaggeration, error, zero line or `+`. Colours are CSS colours or `"group"` (the variable's group colour); `exaggeration.colour` may be `"curve"` (the curve's own colour, default), `baseline.colour` `"axis"` (default). A `width` of `null` = the figure's curve line width (baseline: axis line width). Core defaults reproduce the former look: group-coloured polygons with a black outline, 0.6 mm bars, exaggeration ×10 at 0.35 opacity when shown.
- **Curve style cascade**: core defaults (per type) → preset (`panelDefaults.taxonCurves.curve`) → kind (defaults of the variable's measurement kind, `coreDefaults.kindCurves`: `continuous` → `linePoints`, no exaggeration, no `+`; it wins over the proxy preset, never over what the user set) → panel (`style.curve`) → group (`groupStyles[group id]`, in every dataset with that group) → variable (`curveStyles[variable id]`). Each level is a partial override (any option of any type, all optional, `CurveStyleOverrideSchema`) and is deep-merged; the type is the last one set (default `polygon`). A level that changes the type first discards the collected options the new type does not have — shared options and options both types have (e.g. `fill` from polygon to bars, `line` from line to linePoints) are kept; options of a type that is not chosen are ignored. Variables of kind `presence` are drawn as presence marks whatever their type, unless it is `none`. Curve styles are resolved when rendering and never copied onto variables, groups or the spec: the group level is the variable's **current** group (its assignment, else — merged variables — the merge transform's `group` or its first source's current group, else the data's group, e.g. a CSV group row). Moving a variable to another group (drag and drop or editing `assignments`) changes only the assignment, so its style follows the new group at once while its own `curveStyles` options keep winning for just the options they set; editing a group style changes every member without an override for that option. `curveStyles` works for any variable id, including merged variables (keyed by the merge `id`). `resolveCurveStyle(spec, variableId, { panel?, dataset?, group?, kind?, presets? })` resolves the same way (`dataset` = the panel's dataset, raw or prepared, for the data's groups and kinds; `group` / `kind` override them) and returns `{ style, source }`, where `source` maps every option path (`"type"`, `"fill.colour"`, …) to the level it came from (`default`, `preset`, `kind`, `panel`, `group`, `variable`), for the app's inspector. The spec stores only what the user set, never resolved defaults. `curveStyles` / `groupStyles` keys that are no variable / group of any dataset produce a warning.
- **Saved curve styles** (`styleLibrary`): named curve styles kept in the project file, so they travel with the dataset: `[{ "name": "Moss line", "style": { "type": "line", … } }]`, each `style` one cascade level (`CurveStyleOverrideSchema`), names unique (min. 1 character). The library is never drawn by itself: applying a saved style copies it into a cascade level (as paste does, §11), so editing or deleting a saved style later changes no curve. It can be exported and imported as a small file of its own (`parseStyleLibrary` / `serializeStyleLibrary`: `{ "format": "linden-curve-styles", "version": 1, "styles": [...] }`) to reuse it across projects; an imported style replaces a saved one of the same name.
- **The curve type never changes the layout**: column widths, the common x-scale and page fitting depend only on the data (values and error bounds), kinds, the layout keys and the curve style's `axis` options (which every type shares); what is reserved beyond a column (tick labels, `+` markers, value labels) only on options every type shares. Changing a curve's type leaves every column exactly where it was.
- **Group headers** are drawn by default: a horizontal line above each group's columns, spanning exactly those columns, with the group name centred above it — one per run of adjacent columns of the same group within a panel (never across panels; ungrouped columns get none). Spans come from the final, rendered columns — after selection, ordering and merges — and each column's **current** group (assignments override the data's groups; merged variables take the merge's group). Since columns within a panel are ordered by group first (column order above), a group's columns are contiguous and its header spans exactly them; should a group's columns still be split within a panel, one header is drawn per run and a warning is emitted. `groupHeaders.show` (default `true`) turns all group headers off; `groupHeaders.line` is `"line"` (default), `"bracket"` (line with end ticks) or `"none"` (label only). Explicit `headers` replace the automatic ones: each spans exactly the columns whose group is in `spans.groups` or whose id is in `spans.ids`, across all panels; `label` defaults to the spanned group names joined by " & ". If the matching columns are not adjacent, one line is drawn per run (label on the first) and a warning is emitted; overlapping headers warn. `style.groupGap` (mm, default 2) is the gap between adjacent columns of different groups.
- **Spec versions**: `parseSpec` migrates older versions before validation (`model/migrate.ts`). v2 added `headerBand`, `headers`, `style.groupGap` and `style.xTicks`; v3 added top-level `groups`, `datasets[].assignments` / `order` and the `merge` transform; v4 added the `scaleMap` transform, `datasets[].scales`, `variables.kinds` and `style.presence` (all optional, so these migrations only bump the number). v5 moved groups into `datasets[].groups`, added `groupHeaders` (headers on by default) and made the percent transform's `sum` optional; presets lost `groups`, `sums` and `outsideSum`. The v4→v5 migration copies top-level `groups` and the groups, sums, `outsideSum` and default transforms the bundled presets used to define (a frozen copy in `migrate.ts`) into the dataset entries (creating entries without transforms for panel datasets that had none), and gives explicit `headers` `groupHeaders.line: "bracket"`, so old diagrams look the same apart from the new default group headers. v6 added `title`, `style`, `yAxis.titles`, taxonCurves `style.xTitle` and `style.xTicks.unitSuffix` (all optional, so the migration only bumps the number); old diagrams gain the default x-axis titles (which replace the former unit labels) and a white background. v7 added the global `xScale` and taxonCurves `style.columnWidth` (optional, defaults equal to the former fixed constants, so the migration only bumps the number and diagrams look the same). v8 added curve styles (`style.curve`, `groupStyles`, `curveStyles`) and removed taxonCurves `style.mode`, `fill`, `exaggeration`, `plusBelow` and `presence`: the migration moves them into `style.curve` (`mode` → `type`: `silhouette` → `polygon`, `bars`, `line`, `linePoints`; `fill` → `fill.colour` (line modes: `line.colour`, linePoints also `points.colour`) and `presence.colour`; `exaggeration` n → `{ show: n > 1, factor: n }`; `plusBelow` p → `{ show: p > 0, threshold: p }`; `presence` → `presence.symbol`, a bar keeping its 0.6 mm size), writing only the keys that were set. The same keys in per-variable `overrides` move into `curveStyles` (a variable overridden in several panels: later panels win); the layout keys stay. Presets went to `presetVersion` 2 the same way (`parsePreset` migrates v1). Diagrams look the same, except that `line` / `linePoints`, formerly drawn as silhouettes, are now drawn as lines. v9 added the optional `styleLibrary` (saved curve styles), so the migration only bumps the number. v10 added the curve style options `axis` and `error` (optional; their defaults draw as before), so the migration only bumps the number.
- **Presets** provide styling/behaviour defaults; explicit spec values always win. Resolution order: core defaults → preset → spec → per-variable override. Objects merge deeply; arrays and `null` replace. Named scales replace whole (a spec scale with the same name as a preset one wins entirely); a dataset entry without `transforms` uses the preset's `transforms` (so `"preset": "testate-percent"` alone gives percentages of total tests).
- **Sums** are the dataset entry's own (`datasets[].sums`, e.g. a pollen sum of user-defined groups). A percent transform without `sum` uses the default sum: every variable of kind `count` in the dataset (before selection, so thresholds never change the sum).
- **Dataset entries** may define named ordinal `scales` (`{ "dafor": { "-": 0, "R": 1, …, "D": 5 } }`, code → plotted value, `null` = not assessed), referenced by the `scaleMap` transform.
- **Selection by kind**: `variables.kinds` keeps only variables of these measurement kinds (after transforms), e.g. one common-scale panel per kind (panels with independent scales may mix kinds, §6).
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

`render(datasets, spec, presets)` returns `{ svg, warnings, info, layout }`. `layout` is plain layout metadata in page mm, so the app can hit-test and resize without reading the SVG: page size and margins, plot rectangle, header and footer heights, the x factor (`natural` = spec `xScale`, `used` after fitting), `slack` (page width left before fitting would start; 0 once fitted, negative if it does not fit), the panel gap, per panel its index, type, box (panel width × header band top … footer bottom) and `columnLayout()`, the y domain (in primary-axis units), direction and primary axis (`depth` | `age`), and the distinct sample depths.

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

### 5.4 Data edits and provenance

Data are edited only through pure functions in `core/src/edit` (no DOM): `setCell`, `setCells` (a block, e.g. a paste), `renameVariable`, `setVariableKind`, `setVariableUnit`, `setCompanion`, `addVariable`, `deleteVariable`, `moveVariable`, `addSample`, `deleteSample`, `setSampleDepth`, `setSampleAge`, `sortSamplesByDepth`, `applyAgeModel` (§9). Each takes variables and samples by id and returns `{ dataset, warnings }`: a new dataset, never mutating its input — or the input itself when nothing changed or the edit was refused (e.g. a non-finite number, text in a numeric column, an empty name), so callers can skip work by reference.

- **Cells**: a number, `null` or text. Empty text, "—" and "-" are `null` (not assessed), `0` stays `0`. Text in an ordinal column (`abundanceClass`, `presence`) is a code (`variable.codes`, appended when new; "-" is a code only where the column already uses it, e.g. DAFOR "absent"); an ordinal column without values takes text as its first code. Elsewhere text is refused with a warning. `parseCellText(text, decimalComma)` reads typed or pasted text.
- **Kinds**: a column of text codes changed to a non-ordinal kind keeps the codes that are numbers; the others become `null` (warning).
- **Ids** (`edit/ids.ts`): a new variable's id is the slug of its first name (markup and diacritics removed, lower case, `-` separated; `variable` if empty), with `-2`, `-3`, … on collision; a new sample's id is its depth as text, with `#2`, … on collision. No randomness, no clock. A variable's id is never derived from its name again.
- **Samples**: `addSample` inserts at a given row, by default after the last sample not deeper than it. Depth changes keep the sample's id and row; depths that stop increasing (or repeat) give a warning — `sortSamplesByDepth` sorts stably.
- **Error columns**: `setCompanion(ds, id, { errorOf, role } | undefined)` declares a column an error of another variable (§3) or makes it an ordinary column again; refused for an unknown target, the column itself, a target that is an error column, or a column others are errors of. Deleting a variable turns its error columns into ordinary columns (warning).
- **Dangling references**: deleting a variable never edits the spec. `danglingReferences(spec, datasets)` lists spec references to ids that are no variable (or merge with a source left) of the datasets — dataset entries' `assignments`, `order`, merge `from`, scaleMap `variables`; taxonCurves `variables.ids` / list `order` and `overrides`; `headers[].spans.ids`; `curveStyles` — as `{ path, id }`. `cleanupSpec(spec, datasets)` removes exactly those (a merge with no source left goes; emptied `assignments` / `order` / `overrides` / `curveStyles` are removed, selection lists kept even when empty). Pass all of the project's datasets: `curveStyles` and headers are not per dataset.
- **Provenance**: a project keeps its datasets **as imported** (an immutable snapshot, `[]` for a blank project) next to the edited ones (bundle §10). `provenance(snapshot)` answers whether a cell differs from its imported value, matched by sample and variable id (so sorting and inserting rows or columns mark nothing; cells of added samples or variables have no imported value; text codes compare as text). `revertCell` sets a cell back.

## 6. Layout engine

- Coordinates in mm. Page = title band (title, subtitle) + header band (taxon labels) + plot area + footer band (x-axis scales and titles). The SVG viewBox is in mm; font sizes are in points (converted to mm); `page.font` is the base for all text unless `style.fonts` says otherwise (§4). The page background is a full-page `<rect id="background">` unless `style.background` is `null`.
- **Title band**: above the header band, its height (title line + subtitle line + 2 mm gap) reserved and taken from the plot height; the width fit below is unaffected. A title wider than the space between the margins is set smaller in 0.25 pt steps, down to the labels font size (info message), then reported as a warning. No DOM: text widths come from a deterministic per-character metrics table (`layout/metrics.ts`, unknown characters ≈ 0.556 em) holding the advance widths of the bundled font, Liberation Sans (metrically compatible with Arial/Helvetica; a test checks the table against `fonts/*.ttf`). No kerning.
- `measure()` must not depend on the plot height; it may grow with the fit state (x factor, compaction, label font) but never shrink when they grow. Panels report what they draw beyond their own width (`PanelMeasure.overhang`: edge tick labels, x-axis titles, markers) so the layout can reserve it.
- **Everything drawn is reserved; nothing is drawn outside the page.** The panels stay inside the page margins; ink beyond them — rotated taxon labels (their full rotated glyph box: baseline offset 0.35 em, ascent 0.75 em, descent 0.25 em), group-header labels, zone labels, edge tick labels and x-axis titles — may use the margins but never leaves the page. If ink sticks out left of the first panel, the diagram shifts right.
- Columns are laid out left to right in panel order. Each taxon column's width is proportional to its maximum value **when `commonScale` is true** (the standard convention for percentage diagrams: 10% is the same width in every column). `minWidth` stops rare taxa from vanishing.
- **Scale families.** A common scale is shared only by columns of the same kind and unit (`kind|unit`), across all panels — percentages and counts never share one. Percent kinds (`percent`, `volumePercent`) use the global x-scale (natural = spec `xScale`, default 0.4 mm per %); any other family is scaled so that its maximum, rounded up to a 1–2–5 value, is as wide as 100 %. One global factor shrinks all families together when fitting the page. **`continuous` columns never share a common scale**: they always get their own x axis (as with `commonScale: false`), also in a common-scale panel, where the other columns keep the common scale. A common-scale panel mixing other kinds gets a warning (use `variables.kinds`, or `commonScale: false`). A panel with independent scales (`commonScale: false`) may mix kinds — counts, abundance classes, presence and continuous values — without a warning: every column has its own x scale and tick labels (numbers; class codes for class scales; none for presence), and the x-axis titles are grouped per run of adjacent columns of the same kind and unit (below).
- **Independent scales** (`commonScale: false`): fixed column width (curve style `axis.width`, else `style.columnWidth`, default 15 mm; never below `minWidth`; both shrink with the global x factor when fitting), own scale from 0 to the column maximum rounded up to a whole tick step (class scales: up to the top class), so the axis ends on a labelled tick; labels stay inside the column (first left-aligned, last right-aligned). `continuous` columns span their data extent instead of starting at 0 (e.g. δ13C −28 … −25 ‰), both ends rounded out to whole tick steps (a constant column gets a little room either side). The extent includes the error bounds (§3), whether or not they are drawn. Curve style `axis` (§4) can fix either end (`min` ≥ `max` → automatic, warning; values outside a fixed range are drawn at the axis end, warning), set the tick interval, reverse the axis (largest value on the left; labels still placed left to right) or make it logarithmic: whole decades around the positive values, labels at the powers of ten (also at 2 and 5 × 10ⁿ over less than two decades), unlabelled minor ticks at the other whole multiples; values ≤ 0 are left out (warning); a log axis without positive values falls back to linear (warning). Filled areas and bars start at 0, or at the axis start when 0 is not on the axis.
- **x-axis titles** below the tick labels (labels font), per taxonCurves panel (`style.xTitle`): `show: "panel"` (default) = one title per run of adjacent columns of one scale family and title, centred under the run; `"column"` = under every column; `"none"`. Text = the column's curve style `axis.title` (e.g. "WTD (cm)"), else `xTitle.text`, else from the kind and unit: `%` (percent: the unit), `Counts (unit)`, `Concentration (unit)`, `Influx (unit)`, `Volume (%)`, `Abundance class`, `Presence`, the unit (continuous); `""` = none. Titles are placed left to right; one that would touch the previous is skipped with a warning (for the final layout only, not for the widths tried while fitting). The footer grows by one line only when titles are shown. Titles and edge tick labels reaching into a neighbouring panel's ink produce a warning.
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
- One shared y-scale for all panels, in the units of the primary axis (`yAxis.primary`): **depth** (default; samples at their depths) or **age** (samples at their own ages, from the age column; the y range is the age extent of the plotted datasets). On an age axis, samples without an age are not drawn (warning per dataset), ages that decrease with depth are reported (samples still sit at their ages), and without any sample ages the axis falls back to depth (warning). The secondary axis (`yAxis.secondary`: age on a depth axis, depth on an age axis; the primary again is a warning) is drawn by interpolating the samples' depth–age pairs, never by re-scaling one axis to fit the other.
- y-axis titles (`yAxis.titles.depth` / `.age`, default `Depth (<depthUnit>)` and `Age (<ageUnit>)`, or `Age` without a unit) are rotated 90° in their own 1 em + 1 mm strip left of the tick labels; `""` removes the title and its strip. A title longer than its axis is a warning.
- Zone overlays draw across all panels; zone labels sit in a narrow column right of the last panel. Boundaries are depths: on an age axis they sit at the interpolated age (omitted with a warning outside the dated samples or where ages decrease with depth).
- The secondary axis uses the first spec dataset with sample ages; ages must not decrease with depth (otherwise the secondary axis is omitted with a warning), and ticks are never extrapolated beyond the dated range.
- SVG output is deterministic: coordinates rounded to 0.01 mm, attributes in a fixed canonical order. The root carries `<metadata id="linden-metadata">generator: Linden <version>; spec-sha256: <hash></metadata>`, the hash being SHA-256 of the input spec's canonical JSON (keys sorted).

## 7. Panels (catalogue)

### 7.1 MVP
- `yAxis` — depth and/or age axis with ticks and editable titles (§6).
- `taxonCurves` — one column per variable, each drawn with its resolved curve style (§4 "Curve styles"): `polygon` (filled silhouette, optionally hatched / cross-hatched / dotted, linear or stepped), `line`, `linePoints`, `points`, `bars` (fixed mm or a fraction of the sample spacing), `presence` or `none`, with an exaggeration curve (×n, filled or line), zero line, `null` gaps or connections, `+` marker for values below a threshold (e.g. < 0.5%) and value labels. The style comes from the cascade preset → kind → panel `style.curve` → `groupStyles` → `curveStyles`; there is no separate styling panel. Also: x-axis ticks per column, x-axis titles (§6), presence columns (§6), class-code axes after a `scaleMap`. The curve type never changes column widths or the x-scale.
  **Continuous data** (LOI, magnetic susceptibility, δ13C, inferred water-table depth / pH / temperature) are ordinary columns of kind `continuous` in a taxonCurves panel, not a panel type of their own: each always has its own x axis (also next to common-scale percentages in the same panel) — data extent, reversed (WTD), logarithmic, fixed range, tick interval, width and title per column through the curve style `axis` options — and an error envelope or error bars from its error columns (curve style `error`, §3). By default they are drawn as line + points without exaggeration or `+` (cascade level `kind`). Mixed kinds with independent scales share one panel.
- `zones` overlay — horizontal lines + labels.

### 7.2 Next
- `summary` — cumulative group curve (e.g. AP/NAP, trees/shrubs/herbs).
- `dendrogram` — from a CONISS result, x = total sum of squares.
- `lithology` — Troels-Smith or simple hatch patterns from `extra.lithology`.
- `dates` — markers for dated levels with labels.
- `abundanceSymbols` — macrofossil ordinal classes as bars or symbols of graded size.
- `text` — sample labels, count sums.

### 7.3 Proxy coverage check

| proxy | typical kind | panels |
|---|---|---|
| Pollen, spores, NPPs | count → percent / concentration / influx | taxonCurves, summary, dendrogram |
| Testate amoebae | count → percent; inferred WTD | taxonCurves (taxa; WTD as a continuous column, reversed, with error) |
| Diatoms | count → percent; inferred pH/TP | taxonCurves (many taxa: ordering + thresholds matter; inferred values as continuous columns) |
| Plant macrofossils | count per volume, abundanceClass, volumePercent, presence | taxonCurves (bars), abundanceSymbols |
| Chironomids | count (head capsules) → percent; inferred temp | taxonCurves (taxa; inferred temperature as a continuous column) |
| Charcoal | concentration / influx | taxonCurves (bars) |
| Geochemistry / physical | continuous | taxonCurves (continuous columns, independent scales) |

Any new proxy should be expressible by a preset alone. If it needs code, it needs a new transform or panel — generic, not proxy-named.

### 7.4 Typography
- Taxon names support `*italic*` markup and `type` suffixes (e.g. `*Quercus*`, `Poaceae`, `*Alnus*-type`). A `-type` / ` type` suffix is always upright, even when written inside the asterisks (`*Alnus-type*`).
- Default font: Arial (`page.font.family`); title, labels and ticks may use their own family and size (`style.fonts`, §4). PDF and PNG export replace Arial/Helvetica/sans-serif with the bundled, metrically identical Liberation Sans and embed it, so exports look the same on every OS; any other family is substituted too, with a warning. SVG export keeps the spec's family.

## 8. Presets

JSON files in `/presets`, same shape as a partial spec plus metadata: `presetVersion` (2; version-1 presets are migrated, §4 spec versions), `name` (must equal the file name), `description`, `page`, `yAxis`, `headerBand`, `scales`, default dataset `transforms`, `selectionDefaults` (thresholds, ordering; no `groups`), `panelDefaults` (taxonCurves: `curve` — the preset level of the curve style cascade —, commonScale, minWidth, …; strict: only implemented panel types). Presets hold only styling/behaviour defaults: **no groups, sums or `outsideSum`** — groups are user-defined per dataset and sums belong to the dataset entry (§4); a preset percent transform has no `sum`, so it uses the default sum (all count variables). `loadPresets(files)` validates them (JSON, schema, name = file name, unique names) and reports readable errors prefixed with the file name; it never throws.

- `pollen-percent` — percent transform, exaggeration ×10, silhouettes, group colours, common scale, `+` below 0.5 %. The terrestrial sum and aquatics/spores as % of (sum + group) are set per dataset (`sums`, `outsideSum`; see `examples/demo-pollen.spec.json`). (Summary panel: M3.)
- `testate-percent` — percent transform of total tests, bars, common scale, x-axis title "% of total tests". Inferred WTD and LOI are continuous columns in a second taxonCurves panel (`examples/testate-percent.spec.json`).
- `diatom-percent` — percent transform of total valves, `minMax` threshold 2%, weighted-average-depth ordering.
- `macrofossil-counts` — named scales `classes` (0–5), `dafor` (`-` R O F A D) and `presence` (`-` `+`), a default scaleMap trying them in that order, bars, independent scales, presence dots.
- `geochem` — (later) continuous columns with independent scales.

Examples (synthetic data, marked as such in the CSV header): `examples/{testate-percent,diatom-percent,macrofossil-counts,curve-styles}.{csv,spec.json}` (`curve-styles`: every curve style family in one diagram, no preset; `testate-percent`: also an inferred WTD with ± SE envelope on a reversed axis, LOI and ages); `examples/testate-percent-age.spec.json` plots the testate data on the age axis (ages in the CSV = `examples/testate-age-model.csv`, a Bacon-style model, interpolated to the sample depths). A spec renders the CSV named by its first dataset entry. `npm run demo -w @linden/core` renders every example to `examples/out/`.

Users can save their own presets.

## 9. Importers

| priority | type | notes |
|---|---|---|
| MVP | `csv` / `tsv` | wide format: first columns depth[, age], then one column per variable; the age header may carry the unit, `age (cal BP)` (→ `ageUnit`). Optional header rows starting with `group`, `kind`, `unit`, `id` (variable ids, when they differ from the header without markup) and/or `error` (error columns, §3: `se of WTD` — role `lower` / `upper` / `se` / `sd`, then the variable's id or header; anything else is a warning) (or sidecar JSON, later). Lines starting with `#` before the header are comments. Delimiter `,` / tab / `;` auto-detected; `;` files may use decimal commas. Variable id = header without `*` markup; name = header. Empty cell → `null`, missing kind → `count`. Ordinal columns (`abundanceClass`, `presence`) with any non-numeric cell keep their cells as text codes (`variable.codes`, first-seen order) for a `scaleMap`; text in other kinds → `null` + warning. |
| MVP | `xlsx` | same layout; via SheetJS. |
| 2 | `tilia-tlx` | Tilia XML: variables, ecological groups, units, chronology, lithology. Map Tilia ecological group codes (TRSH, UPHE, AQVP, VACR, …) to Groups. |
| 3 | `neotoma` | download dataset by ID via the Neotoma API. |
| later | long format | sample, variable, value rows. |

Importers never throw on recoverable problems: they return warnings.

**Age–depth model** (`io/ageModel.ts`; age–depth modelling itself is out of scope, §14): `parseAgeModel(text)` reads a table with a depth column and one or more age columns — e.g. Bacon's `*_ages.txt` (`depth min max median mean`), tab-, comma- or semicolon-delimited (`;` with decimal commas) or space-separated with quoted headers and row names (R's `write.table`) — and guesses the depth column (`depth…`, else the first) and the age column (`median`, else `mean`, else one named `age` / `BP` / `b2k`, else the next). `applyAgeModel(ds, table, { depthColumn, ageColumn, source, ageUnit? })` is a data edit (§5.4): every sample's age = linear interpolation of the chosen column between the model's depths (same unit as the dataset's depths; rows sorted by depth); samples outside the model's depth range get **no age** — never extrapolated — with a warning listing them; ages that decrease with depth are reported; existing ages (and age errors) are replaced; `ageSource` notes the file, the column and the method; refused with fewer than two rows having a depth and an age.

**CSV export** (`exportDelimited`): the importer's wide format, so a dataset reads back unchanged — header (`depth`, `age` (with the unit, `age (cal BP)`) if any sample has one, variable names with markup), an `id` row only if some id differs from its name without markup (e.g. after a rename), `group` (if any), `kind`, `unit` (if any), `error` (if any), then one row per sample; `null` → empty cell, `0` → `0`, text codes as text, numbers in their shortest exact form, fields quoted when needed.

**Clipboard** (`io/paste.ts`, tab-separated text from Excel, LibreOffice or Google Sheets): `parseClipboard` reads the cells and guesses — a header row (a first row with text and fewer numbers than the first data row), optional `group` / `kind` / `unit` / `id` rows below it, the depth column (headed `depth…` or `cm`; otherwise the first numeric column, flagged as a guess), an age column (`age…`, `… BP`, `b2k`), decimal commas (only when the cells clearly use them: some `0,5`-style cell, no `0.5`-style cell, not all like `1,234` — reported as a warning, as are ambiguous cells) and a kind per column (text → `abundanceClass`, all whole numbers → `count`, decimals → `continuous`). `datasetFromClipboard(table, choices)` builds the dataset from the confirmed choices (depth / age column; per column name, kind, unit, group) with edit-generated ids; rows without a numeric depth are skipped with a warning.

## 10. Export

- **SVG** (native): clean, one `<g id="panel-<i>-<type>">` per panel, text as text (editable in Inkscape/Illustrator), `<metadata>` with Linden version and spec hash (§6).
- **PDF**: svg2pdf.js + jsPDF, vector, page = `page.width × page.height` mm exactly, Liberation Sans regular + italic embedded (subset, with ToUnicode, so text is selectable); document Creator/Subject carry the version and spec hash.
- **PNG**: rasterised in the browser at 300 / 600 (default) / 1200 dpi, pixels = round(mm / 25.4 × dpi), white or transparent background, resolution recorded in a `pHYs` chunk. (TIFF: later.)
- **Page presets** (app): single column 85 mm, 1.5 column 120 mm, double column 180 mm (width only, height kept), A4 portrait / landscape, or custom width × height; they only change `spec.page`.
- **Project bundle**: `.linden.json` = spec + embedded data, for sharing and archiving: `{ "format": "linden-project", "bundleVersion": 2, "generator": "Linden <version>", "spec": {…}, "datasets": [Dataset, …], "imported": [Dataset, …] }` (`core/io/project.ts`: `serializeProject` / `parseProject`). `datasets` are the data as edited, `imported` the immutable snapshot as imported (§5.4; `[]` for a blank project). 0 and `null` stay distinct; non-finite values are refused. The spec is migrated like any spec file; the data are validated (shape, values matrix = samples × variables). Version-1 bundles (no `imported`) are read with their datasets as the imported snapshot.
- **Data CSV** (app: project menu, Data tab): the edited dataset in the CSV importer's format (§9), so it round-trips.

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
- **Direct manipulation in the preview.** Hit-testing uses `render().layout` (§5.1), never the SVG. Clicking a panel selects it (accent outline) and opens its card in the form (switching to Form if the JSON is valid); clicking outside the panels or Esc deselects. The selected panel has a resize handle on its right edge: common-scale taxonCurves change the global `xScale` (all common-scale columns in every panel scale together; readout "mm per 10 %"), taxonCurves without a common scale change `style.columnWidth`, any other panel with a `width` changes `width`. Snap 0.5 mm (x-scale: 0.5 mm per 10 %); Alt disables snapping. A drag never grows the diagram beyond the page width left before fitting (`slack`): it stops there and says why. Manual zone boundaries can be dragged up and down, snapping to midpoints between samples (on a depth axis only: boundaries are depths, drawn at interpolated ages on an age axis). While dragging, only outlines are drawn over the dimmed figure; on release the spec changes once (one undo step) and the figure is rendered. Selection is view state, not part of the spec or the undo history.
- **Curve inspector** (Curve tab, shown while curves or a group are selected). Clicking a taxon column in the preview (its plot area, axis or rotated label; hit-tested on `layout`) or a taxon in the variable list selects that curve and opens the tab for it; Shift / Ctrl / Cmd-click adds or removes curves; clicking a group header (preview group row or variable list) selects the group. Clicking a panel's background (gaps, panels without columns) still selects the panel and opens its card. The tab is generated from `CurveStyleOverrideSchema` with the form controls: a type selector (segmented, with icons), then only the options of that type plus the shared ones, in the sections of `CURVE_FORM_SECTIONS` (`core/model/specForm.ts`); colours, dashes and fill patterns use app widgets named in the hints (group colour, recent colours, hex; previews). Each option shows whether it is inherited (muted, with its level: "from group Bryophytes", "from preset …", "default") or set at the level being edited (with a reset button); section headers count the options set; "Reset … to inherited" removes the whole level. **Edit target**: the selected curve's `curveStyles[variable id]` by default; a selected group writes `groupStyles[group id]`; "Apply to: this curve | its group | whole panel" switches the level (panel = `panels[i].style.curve`), and the inherited values shown are those of that level. With several curves, options equal across them show their value and differing ones show "Mixed"; an edit sets the option at every target. Edits write only the changed options and drop emptied objects and levels, so the spec holds just what the user set; every edit goes through the store (undo/redo, live preview; text and number fields debounced as in the form). The curve selection is view state, exclusive with the panel selection.
- **Curve quick actions.** Right-clicking a curve (preview column or taxon in the variable list) opens a context menu acting on the whole curve selection if the clicked curve is part of it, else on the clicked curve alone (which becomes the selection without switching the inspector); right-clicking a group header (preview group row or variable list) offers the same actions for the group (written to `groupStyles`). Items: **Type ▸** (the types with their icons, a check on the current type, "Mixed" for mixed selections; then the saved styles), **Copy style**, **Paste style**, **Paste style to group**, **Save style as…**, **Apply this style to ▸ group | whole panel**, **Exaggeration** (on/off; on unless all are on), **Hide curve** (type `none`), **Reset to inherited**, **Open in inspector**. Shortcuts: Ctrl/Cmd+Alt+C / V copy / paste the style of the selection (shown in the menu). *Copied style* = the clicked (else first selected) curve's or the group's type plus every option set at its panel, group or curve level — what the user set, not core or preset defaults (a type that comes from the data, kind `presence`, is not copied). The clipboard is view state. *Applying a style* (paste, saved style, apply this style) at a level makes that level the style, minus the options it would inherit anyway (compared under the style's type), so the spec stays minimal; at group level the members' `curveStyles` are removed, at panel level also the `groupStyles` of the panel's groups and the `curveStyles` of its columns, so every curve there looks like the source. Type, Exaggeration and Hide set one option at the selection's own level (removed where it equals the inherited value). The Curve tab lists the saved styles as one-click buttons (applied at the "Apply to" level) with a menu to save the current style, export / import the library and delete saved styles. Every action is one store edit: one undo step, also for many curves at once.
- **Diagram | Data tabs** at the top of the workspace. Both stay mounted once opened, so switching is instant and keeps zoom, scroll and selections. In the Data tab only undo / redo stay global shortcuts (keys type into cells).
- **Data tab** (Glide Data Grid): one dataset at a time (a picker when there are several); rows are samples, frozen columns depth (and age, if any sample has one), one column per variable. Each variable's header has three tiers: its **group** (dropdown: the dataset's effective groups, "New group…"; writes a spec assignment as dragging in the variable list does), its **kind** (dropdown, shown with the unit) and its **name** with `*italic*` rendered (double-click to rename: the id stays, §5.4). Right-click a column: insert left / right, kind, unit, group, **Use as error for… ▸ variable ▸ ± SE / ± SD / lower / upper bound** (`setCompanion`, §3; the kind tier then reads e.g. "continuous · cm · ± SE of WTD") or **Not an error column**, delete; right-click a cell: revert to imported value, insert sample above / below (halfway between neighbours), sort by depth, delete sample, and the column's items. A trailing row and the toolbar add samples (one step beyond the last spacing); the toolbar also adds variables, sorts, pastes, exports CSV and imports an **age–depth model** ("Age model…", §9): a dialog shows the model's depth range, the guessed depth and age columns and the age unit (all editable), the warnings applying would give (samples outside the model, decreasing ages) and how many samples get an age; applying is one undo step, and the toolbar notes that the ages come from a model (the source on hover).
  - `null` shows as a muted "—", `0` as `0`; typing "-" or deleting a value sets `null` (in ordinal columns that use "-" as a code, it is that code). Typed "0,5" is a decimal comma ("1,234" is refused as ambiguous). A depth cannot be emptied.
  - Cells that differ from the imported value carry a small accent mark; "Revert to imported value" sets them back (§5.4 provenance).
  - Every edit — a cell, a block of cells (Delete), a paste, a rename — is one store edit and one undo step; undo / redo cover spec and data together. The figure re-renders 300 ms after the last data edit, and only if the data or spec actually changed.
  - Deleting a variable that the spec still refers to shows the dangling references with a **Clean up spec** action (`cleanupSpec`, its own undo step); nothing is removed silently.
  - **Paste** (Ctrl/Cmd+V or the toolbar): into an empty sheet, a dialog shows what `parseClipboard` detected — depth column (marked "guessed — please check" when not headed `depth`/`cm`), age column, and per column its name, kind, unit and group, all editable — before applying. Into a sheet with data, the block is pasted at the selected cell; samples are added below as needed (with pasted depths, else continuing the last spacing, with a warning), and variables only after asking. Decimal commas are accepted when the clipboard clearly uses them, and reported.
- **New project** (top bar project menu, welcome screen): asks for a project name, the depth unit and optionally a preset, then creates an empty dataset (depth column only, empty imported snapshot) with a dataset entry, y axis and taxonCurves panel, and opens the Data tab.
- Empty project: a welcome screen (new project, import CSV, open project, load an example).
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
- **M4 — data and interoperability**: data view and editable data (§11 Data tab, §5.4 edit operations), continuous columns and age axis, multiple datasets on one diagram, Excel (xlsx) and Tilia `.tlx` import, lithology, dates and summary panels.
- **M5 — analyses**: CONISS, broken-stick, dendrogram, zones from an analysis.
- **M6 — headless**: CLI, Python wrapper, documentation site with gallery.

## 14. Non-goals (for now)

- Age–depth modelling (users bring ages from Bacon/rbacon/clam/OxCal).
- Transfer-function calibration (users bring reconstructed values; we plot them).
- Database management / Neotoma upload.
- Collaborative editing, accounts, servers.
