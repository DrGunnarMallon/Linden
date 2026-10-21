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
  examples/          ← example datasets + specs used in docs and tests
```

`core` internal layout:

```
core/src/
  model/        types for Dataset, Variable, Sample, Spec
  io/           importers (csv, xlsx, tilia-tlx, neotoma) + spec (de)serialisation
  transforms/   percentage, concentration, influx, scale-mapping, smoothing
  analyses/     coniss, broken-stick, (later) pca, rarefaction
  layout/       page, columns, scales, label placement
  panels/       one file per panel type
  render/       SVG builder (string-based, no DOM)
  export/       svg, pdf, png (pdf/png may need browser APIs → kept behind interfaces)
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
  "specVersion": 4,
  "page": { "width": 180, "height": 240, "units": "mm", "font": { "family": "Arial", "size": 7 } },
  "headerBand": { "angle": 60, "minFontSize": 5, "height": null },   // taxon labels; height null = fit
  "yAxis": {
    "primary": "depth",               // "depth" | "age"
    "secondary": "age",               // optional second axis column
    "reverse": true,                  // depth increasing downwards
    "range": null,                    // null = data extent
    "ticks": { "major": 50, "minor": 10 }
  },
  "groups": [                                          // define / rename / recolour / order groups
    { "id": "bryophytes", "name": "Bryophytes", "colour": "#6b7f2a", "order": 6 },
    { "id": "herbs", "name": "Herbs (upland)" }
  ],
  "datasets": [
    {
      "dataset": "pollen",
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
      "style": { "mode": "silhouette", "fill": "group", "exaggeration": 10, "commonScale": true, "minWidth": 4,
                 "groupGap": 2, "xTicks": { "step": null, "minSpacing": 6 } },
      "overrides": { "Pinus": { "exaggeration": 0 } } },
    { "type": "summary", "dataset": "pollen", "groups": ["trees", "shrubs", "herbs"], "width": 25 },
    { "type": "dendrogram", "analysis": "zones", "width": 15 }
  ],
  "overlays": [
    { "type": "zones", "from": "analysis:zones", "n": 4, "labels": ["P1", "P2", "P3", "P4"] }
  ],
  "headers": [
    { "label": "Trees & shrubs", "spans": { "groups": ["trees", "shrubs"] } },
    { "spans": { "groups": ["herbs"] } }               // label defaults to the group name(s)
  ],
  "preset": "pollen-percent"
}
```

Key rules:
- **Groups.** The dataset's groups (e.g. a CSV group row) are only defaults. Effective groups = dataset groups, overlaid field by field by preset `groups`, then by spec `groups` (same id); groups that exist only in the preset or spec are added, even when empty (so users can create e.g. "Bryophytes"). `order` decides group order (lower first; groups without one come last, in spec order).
- **Assignments** (`datasets[].assignments`: variable id → group id) override a variable's group. Groups and assignments are applied **before transforms**, so they also change sum membership (moving a taxon out of a sum group takes it out of the sum). An assignment to a group that does not exist, or of an unknown variable, is ignored with a warning; merged variables take their group from the merge transform.
- **Column order**: group order first; within each group the dataset's explicit `order` list (variable ids), then every unlisted variable in the panel's `variables.order` — new taxa never disappear silently. Ungrouped variables come last. An unknown id in `order` is a warning.
- **Variable selection** is declarative: by explicit ids, by groups (union of both; neither = all), by threshold (`minMax`: include if max ≥ x), plus ordering:
  - `data` — dataset column order;
  - `alphabetical` — display name without markup, case-insensitive;
  - `weightedAverageDepth` — abundance-weighted mean depth of non-zero values, shallowest first;
  - `firstOccurrence` — depth of the deepest (oldest) non-zero value, i.e. stratigraphic first appearance, deepest first;
  - explicit list of ids — listed variables first in list order, the rest after.
  Variables with no non-zero value go last. These panel orders apply within groups (see column order). All orders except `data` break ties by variable id (code-unit comparison, locale-independent).
- **Per-variable overrides** are allowed (`overrides: { "Pinus": { "exaggeration": 0 } }`) but discouraged. Panel-level layout keys (`groupGap`) cannot be overridden; overrides for ids not in the dataset produce a warning.
- **Group headers** (`headers`): a bracket with a label above exactly the columns whose group is in `spans.groups` or whose id is in `spans.ids`, across all panels. `label` defaults to the spanned group names joined by " & ". If the matching columns are not adjacent, one bracket is drawn per run (label on the first) and a warning is emitted; overlapping headers warn. `style.groupGap` (mm) adds space between adjacent columns of different groups.
- **Spec versions**: `parseSpec` migrates older versions before validation (`model/migrate.ts`). v2 added `headerBand`, `headers`, `style.groupGap` and `style.xTicks`; v3 added top-level `groups`, `datasets[].assignments` / `order` and the `merge` transform; v4 added the `scaleMap` transform, `datasets[].scales`, `variables.kinds` and `style.presence` (all optional, so each migration only bumps the number).
- **Presets** provide defaults; explicit spec values always win. Resolution order: core defaults → preset → spec → per-variable override. Objects merge deeply; arrays and `null` replace. Named sums and named scales replace whole (a spec sum/scale with the same name as a preset one wins entirely); `outsideSum` comes from the dataset entry, else from the preset; a dataset entry without `transforms` uses the preset's `transforms` (so `"preset": "testate-percent"` alone gives percentages of total tests).
- **Dataset entries** may define named ordinal `scales` (`{ "dafor": { "-": 0, "R": 1, …, "D": 5 } }`, code → plotted value, `null` = not assessed), referenced by the `scaleMap` transform.
- **Selection by kind**: `variables.kinds` keeps only variables of these measurement kinds (after transforms), e.g. one panel each for counts, abundance classes and presence.
- **Dataset entries** may carry `outsideSum: { "groups": [...], "basis": "sum" | "sumPlusGroup" }` (same shape as in presets).
- **Zones overlay**: `{ "type": "zones", "manual": [{ "depth": 65, "label": "P1/P2" }] }` draws boundaries at given depths (M1). Zones from an analysis (`from`, `n`, `labels`) follow in M3.
- Spec objects are strict: unknown keys are validation errors (catches typos). `parseSpec` returns readable errors with paths, e.g. `panels[1].style.mode: …`.

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

- Coordinates in mm. Page = plot area + header band (taxon labels) + footer band (x-axis scales). The SVG viewBox is in mm; `page.font.size` is in points (converted to mm) and is the base size for all text. No DOM: text widths come from a deterministic per-character metrics table for Helvetica/Arial (`layout/metrics.ts`, unknown characters ≈ 0.556 em); the app may later substitute real measurement behind the same function.
- `measure()` must not depend on the plot height; it may grow with the fit state (x factor, compaction, label font) but never shrink when they grow. Panels report what they draw beyond their own width (`PanelMeasure.overhang`: edge tick and unit labels, markers) so the layout can reserve it.
- **Everything drawn is reserved; nothing is drawn outside the page.** The panels stay inside the page margins; ink beyond them — rotated taxon labels (their full rotated glyph box: baseline offset 0.35 em, ascent 0.75 em, descent 0.25 em), group-header labels, zone labels, edge tick/unit labels — may use the margins but never leaves the page. If ink sticks out left of the first panel, the diagram shifts right.
- Columns are laid out left to right in panel order. Each taxon column's width is proportional to its maximum value **when `commonScale` is true** (the standard convention for percentage diagrams: 10% is the same width in every column). `minWidth` stops rare taxa from vanishing.
- **Scale families.** A common scale is shared only by columns of the same kind and unit (`kind|unit`), across all panels — percentages and counts never share one. Percent kinds (`percent`, `volumePercent`) use the global x-scale (natural 0.4 mm per %); any other family is scaled so that its maximum, rounded up to a 1–2–5 value, is as wide as 100 %. One global factor shrinks all families together when fitting the page. A panel mixing kinds gets a warning (use `variables.kinds`).
- **Independent scales** (`commonScale: false`): fixed column width, own scale from 0 to the column maximum rounded up to a whole tick step (class scales: up to the top class), so the axis ends on a labelled tick; labels stay inside the column (first left-aligned, last right-aligned).
- **Unit labels** below the tick labels: every independent-scale column with a `unit`; common-scale columns only when the diagram has more than one scale family, once per run of one family (`unit`, else the kind). The footer grows by one line only when unit labels are shown.
- **Presence** (kind `presence`): no scale; a fixed-width column (`max(minWidth, 3 mm)`) with a dot (`style.presence: "dot"`, default) or a full-width bar (`"bar"`) at each sample with value > 0; 0 and `null` draw nothing.
- **Fitting the page width.** If the natural layout is too wide, these steps apply in order, each only as far as needed (bisection), the next only if the previous one at its floor is not enough:
  a. shrink the global x factor (all scale families together, so common scales stay common; independent-scale columns shrink with it), down to 25 % of natural (0.1 mm per %);
  b. compact every column `minWidth` (towards 0.5 mm) and the column and group gaps (towards 0.3 mm) proportionally;
  c. reduce the taxon-label font cap in 0.25 pt steps, down to `headerBand.minFontSize`;
  d. warn: "does not fit the page width", with the page width needed, the parts (panels, labels left/right) and how many mm are missing.
  Each applied step is reported as an **info** message (`RenderResult.info`, e.g. "minWidth reduced from 4 to 2.6 mm, column gaps from 1 to 0.73 mm to fit the page."), not as a warning. Never silently break the common scale.
- Tick labels are placed left to right across a whole panel: a label (even a column's "0") is skipped if it would touch the previous one, so compacted columns thin their labels instead of overlapping them.
- Header labels: rotated (`headerBand.angle`, default 60°), anchored at column centre. One header band is laid out for all panels (from their `columns()`), so every taxon label has the same font size. Adjacent labels collide when their perpendicular distance (pitch × sin θ) is under 1 em while they overlap along the text (pitch × cos θ < label length). Resolution order: reduce the font in 0.25 pt steps from `page.font.size` down to `headerBand.minFontSize`; then grow the band beyond `headerBand.height` (if set; warns); labels that still overlap produce a warning — never silently. Both ends of the labels are reserved in the page fit (see "Fitting the page width"), so labels never run off the page.
- Group headers sit in a row above the taxon labels (§4 `headers`).
- Per-column x axes: tick step = `style.xTicks.step`, or automatically the smallest 1–2–5 × 10ⁿ step at least `xTicks.minSpacing` mm long at the column's scale (with a common scale, the same step in every column — e.g. 20 % at 0.4 mm/%). Tick labels are placed left to right and skipped if they would touch the previous label or the next column's "0", so narrow columns keep a single label.
- One shared y-scale for all panels; secondary axis (age) drawn by interpolation from sample depth–age pairs, never by re-scaling.
- Zone overlays draw across all panels; zone labels sit in a narrow column right of the last panel.
- The secondary age axis uses the first spec dataset with sample ages; ages must not decrease with depth, and ticks are never extrapolated beyond the dated range.
- SVG output is deterministic: coordinates rounded to 0.01 mm, attributes in a fixed canonical order.

## 7. Panels (catalogue)

### 7.1 MVP
- `yAxis` — depth and/or age axis with ticks and label.
- `taxonCurves` — one column per variable. Modes: `silhouette` (filled), `bars`, `line`, `linePoints`. Options: exaggeration curve (×n, lighter fill), zero line, `null` gaps, x-axis ticks per column, `+` marker for values below a threshold (e.g. < 0.5%), presence marks (§6), class-code axes after a `scaleMap`.
- `zones` overlay — horizontal lines + labels.

### 7.2 Next
- `summary` — cumulative group curve (e.g. AP/NAP, trees/shrubs/herbs).
- `dendrogram` — from a CONISS result, x = total sum of squares.
- `lithology` — Troels-Smith or simple hatch patterns from `extra.lithology`.
- `dates` — markers for dated levels with labels.
- `continuous` — LOI, magnetic susceptibility, inferred WTD/pH, with optional error envelope.
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
- Default font: a widely available sans (Arial/Helvetica fallback). Fonts embedded in PDF export.

## 8. Presets

JSON files in `/presets`, same shape as a partial spec plus metadata: `presetVersion`, `name` (must equal the file name), `description`, `page`, `yAxis`, `headerBand`, `groups`, `sums`, `scales`, `outsideSum`, default dataset `transforms`, `selectionDefaults`, `panelDefaults` (strict: only implemented panel types). `loadPresets(files)` validates them (JSON, schema, name = file name, unique names) and reports readable errors prefixed with the file name; it never throws.

- `pollen-percent` — terrestrial sum, groups trees/shrubs/herbs/aquatics/spores, aquatics/spores as % of (sum + group), percent transform, exaggeration ×10, silhouettes, `+` below 0.5 %. (Summary panel: M3.)
- `testate-percent` — percent transform of total tests, bars, common scale. (Inferred WTD panel: M3, continuous panel.)
- `diatom-percent` — percent transform of total valves, `minMax` threshold 2%, weighted-average-depth ordering.
- `macrofossil-counts` — groups terrestrial/wetland/aquatic/other, named scales `classes` (0–5), `dafor` (`-` R O F A D) and `presence` (`-` `+`), a default scaleMap trying them in that order, bars, independent scales, presence dots.
- `geochem` — continuous line panels (M3).

Examples (synthetic data, marked as such in the CSV header): `examples/{testate-percent,diatom-percent,macrofossil-counts}.{csv,spec.json}`; `npm run demo -w @linden/core` renders every example to `examples/out/`.

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

- **SVG** (native): clean, grouped (`<g id="panel-…">`), text as text (editable in Inkscape/Illustrator).
- **PDF**: svg2pdf.js + jsPDF, fonts embedded, exact page size.
- **PNG/TIFF**: raster at chosen dpi (default 600).
- **Project bundle**: `.linden.json` = spec + embedded data, for sharing and archiving.

## 11. App (UI) outline

- Left: data & variable list (grouping, kind, visibility, drag to reorder).
- Centre: live SVG preview at true page size, zoomable.
- Right: properties of the selected panel / variable / overlay.
- Top: import, presets, export, undo/redo (spec history).
- A raw spec editor (JSON with schema validation) for power users — this is the "scriptable" path in the UI.
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
- **M3 — analysis**: CONISS + dendrogram + broken-stick, summary panel, continuous panel, age axis.
- **M4 — interoperability**: Tilia `.tlx` import, xlsx, multiple datasets on one diagram, lithology and dates panels.
- **M5 — headless**: CLI, Python wrapper, documentation site with gallery.

## 14. Non-goals (for now)

- Age–depth modelling (users bring ages from Bacon/rbacon/clam/OxCal).
- Transfer-function calibration (users bring reconstructed values; we plot them).
- Database management / Neotoma upload.
- Collaborative editing, accounts, servers.
