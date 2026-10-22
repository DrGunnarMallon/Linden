// UI hints for the graphical spec editor — SPEC.md §11. Plain metadata next to the schema (no UI code):
// labels, help, units, sections, advanced flags and field order, keyed by path pattern (see schemaForm.ts).
// Anything without a hint still gets a control with a label made from its key.

import { describeSchema, type FormHint, type FormHints, type FormNode, type FormSection } from "./schemaForm.js";
import { SpecSchema } from "./spec.js";

/** Sections of the form, top to bottom. Top-level keys not listed here get a section of their own. */
export const SPEC_FORM_SECTIONS: FormSection[] = [
  { id: "preset", title: "Preset", fields: ["preset"] },
  { id: "page", title: "Page", fields: ["page", "title", "style", "xScale"] },
  { id: "yAxis", title: "Y axis", fields: ["yAxis"] },
  { id: "headers", title: "Headers", fields: ["headerBand", "groupHeaders", "headers"] },
  { id: "datasets", title: "Datasets & transforms", fields: ["datasets"] },
  { id: "panels", title: "Panels", fields: ["panels", "groupStyles", "curveStyles"] },
  { id: "overlays", title: "Overlays", fields: ["overlays"] },
];

const mm = { unit: "mm", step: 0.5 } as const;
const pt = { unit: "pt", step: 0.25 } as const;
const colour = { help: "CSS colour, e.g. #2f6b3a." } as const;
const curveColour = { help: "CSS colour, or \"group\" = the group colour." } as const;
const lineWidth = { unit: "mm", step: 0.05, nullLabel: "Figure curve width" } as const;
const dash: FormHint = { unionLabels: ["Style", "Custom (mm)"], optionLabels: { solid: "Solid", dashed: "Dashed", dotted: "Dotted" } };
const pattern = { optionLabels: { solid: "Solid", hatch: "Hatch", crosshatch: "Crosshatch", dots: "Dots" } } as const;

const selectionOrder: FormHint = {
  label: "Order",
  help: "Column order within each group: a rule, or an explicit list of variable ids (listed ones first).",
  unionLabels: ["Rule", "Explicit list"],
  optionLabels: { data: "Data order", alphabetical: "Alphabetical", weightedAverageDepth: "Weighted average depth", firstOccurrence: "First occurrence" },
};

const SPEC_HINTS: Record<string, FormHint> = {
  specVersion: { hidden: true },
  preset: { label: "Preset", widget: "preset", help: "Styling and behaviour defaults; explicit values in the spec win." },

  page: { label: "Page setup", order: ["width", "height", "font", "units"] },
  "page.width": { ...mm, label: "Width" },
  "page.height": { ...mm, label: "Height" },
  "page.units": { advanced: true },
  "page.font": { label: "Base font", help: "Base for all text unless the figure style says otherwise." },
  "page.font.size": pt,

  title: { label: "Title", order: ["text", "subtitle", "align", "size"] },
  "title.text": { label: "Title", help: "*italic* markup allowed." },
  "title.subtitle": { help: "*italic* markup allowed." },
  "title.align": { optionLabels: { left: "Left", centre: "Centre" } },
  "title.size": { ...pt, advanced: true },

  style: { label: "Figure style", order: ["background", "fonts", "colours", "lineWidths", "tickLength"] },
  "style.background": { ...colour, nullLabel: "Transparent" },
  "style.fonts": { advanced: true },
  "style.fonts.title.size": pt,
  "style.fonts.labels": { help: "Taxon labels, group headers, axis titles, zone labels." },
  "style.fonts.labels.size": pt,
  "style.fonts.ticks.size": pt,
  "style.colours": { advanced: true },
  "style.colours.axis": colour,
  "style.colours.text": colour,
  "style.lineWidths": { advanced: true },
  "style.lineWidths.axis": { unit: "mm", step: 0.05 },
  "style.lineWidths.curve": { unit: "mm", step: 0.05 },
  "style.tickLength": { ...mm, advanced: true },

  xScale: {
    label: "x-scale (mm per %)",
    step: 0.05,
    help: "Width of 1 % in common-scale columns before page fitting (0.4 = 4 mm per 10 %); other scale families follow. Drag a panel's edge in the preview.",
  },

  yAxis: { order: ["primary", "secondary", "reverse", "range", "ticks", "titles"] },
  "yAxis.primary": { optionLabels: { depth: "Depth", age: "Age" } },
  "yAxis.secondary": { label: "Secondary axis", optionLabels: { depth: "Depth", age: "Age" } },
  "yAxis.reverse": { label: "Increase downwards" },
  "yAxis.range": { nullLabel: "Data extent", help: "Top and bottom of the axis in axis units." },
  "yAxis.range[0]": { label: "From" },
  "yAxis.range[1]": { label: "To" },
  "yAxis.ticks.major": { help: "Interval in axis units." },
  "yAxis.ticks.minor": { help: "Interval in axis units." },
  "yAxis.titles": { help: "Default from the dataset units; empty = no title." },

  headerBand: { label: "Taxon labels", order: ["angle", "minFontSize", "height"] },
  "headerBand.angle": { unit: "°", step: 5 },
  "headerBand.minFontSize": { ...pt, label: "Min font size", help: "Labels shrink down to this size before the band grows." },
  "headerBand.height": { ...mm, nullLabel: "Fit labels", advanced: true },
  groupHeaders: { label: "Group headers" },
  "groupHeaders.line": { optionLabels: { line: "Line", bracket: "Bracket", none: "None" } },
  headers: { label: "Explicit headers", itemLabel: "header", itemTitle: ["label"], help: "Replace the automatic group headers." },
  "headers[].spans": { help: "Columns whose group or variable id is listed." },
  "headers[].spans.groups": { itemLabel: "group" },
  "headers[].spans.ids": { label: "Variable ids", itemLabel: "id" },

  datasets: { label: "Datasets", itemLabel: "dataset", itemTitle: ["dataset"] },
  "datasets[]": { order: ["dataset", "transforms", "sums", "outsideSum", "groups", "assignments", "order", "scales"] },
  "datasets[].dataset": { label: "Dataset", widget: "dataset" },
  "datasets[].transforms": { itemLabel: "transform", itemTitle: ["type"], help: "Applied in order; merges before percent." },
  "datasets[].transforms[]": { optionLabels: { percent: "Percent", merge: "Merge", scaleMap: "Scale map" } },
  "datasets[].transforms[].sum": { help: "Named sum; empty = all count variables." },
  "datasets[].transforms[].from": { itemLabel: "variable" },
  "datasets[].transforms[].keepSources": { advanced: true },
  "datasets[].transforms[].scale": { unionLabels: ["One scale", "First matching of"] },
  "datasets[].transforms[].kinds": { itemLabel: "kind", advanced: true },
  "datasets[].transforms[].variables": { itemLabel: "variable", advanced: true },
  "datasets[].transforms[].map": { label: "Inline map", advanced: true },
  "datasets[].transforms[].map{}": { nullLabel: "Not assessed" },
  "datasets[].sums": { help: "Named sums for the percent transform." },
  "datasets[].sums{}.includeGroups": { itemLabel: "group" },
  "datasets[].sums{}.includeVariables": { itemLabel: "variable" },
  "datasets[].outsideSum": { label: "Outside the sum", advanced: true },
  "datasets[].outsideSum.basis": { optionLabels: { sum: "% of sum", sumPlusGroup: "% of sum + group" } },
  "datasets[].groups": { itemLabel: "group", itemTitle: ["name", "id"], advanced: true, help: "Easier to edit in the variable list." },
  "datasets[].groups[].colour": colour,
  "datasets[].assignments": { advanced: true, help: "Variable id → group id." },
  "datasets[].order": { label: "Column order", itemLabel: "variable", advanced: true },
  "datasets[].scales": { label: "Ordinal scales", advanced: true, help: "Named scales: code → plotted value." },
  "datasets[].scales{}{}": { nullLabel: "Not assessed" },

  panels: { itemLabel: "panel", itemTitle: ["type", "dataset"] },
  "panels[]": { optionLabels: { yAxis: "Y axis", taxonCurves: "Taxon curves" }, order: ["type", "dataset", "variables", "style", "width", "overrides"] },
  "panels[].dataset": { widget: "dataset" },
  "panels[].width": { ...mm, advanced: true },
  "panels[].variables": { label: "Variables", order: ["groups", "ids", "minMax", "order", "kinds"] },
  "panels[].variables.groups": { itemLabel: "group", help: "Groups and ids are combined; neither = all variables." },
  "panels[].variables.ids": { itemLabel: "id" },
  "panels[].variables.kinds": { itemLabel: "kind", advanced: true },
  "panels[].variables.minMax": { label: "Min. maximum", help: "Show a variable only if its maximum reaches this value." },
  "panels[].variables.order": selectionOrder,
  "panels[].style": { order: ["curve", "commonScale", "minWidth", "columnWidth", "xTicks", "xTitle", "groupGap"] },
  "panels[].style.commonScale": { help: "One x-scale for all columns (percentage diagrams)." },
  "panels[].style.minWidth": { ...mm, label: "Min. column width" },
  "panels[].style.columnWidth": { ...mm, label: "Column width", help: "Columns without a common scale." },
  "panels[].style.groupGap": { ...mm, advanced: true },
  "panels[].style.xTicks": { label: "x-axis ticks", advanced: true },
  "panels[].style.xTicks.step": { nullLabel: "Automatic", help: "Tick interval in data units." },
  "panels[].style.xTicks.minSpacing": mm,
  "panels[].style.xTicks.unitSuffix": { label: "Unit on last label" },
  "panels[].style.xTitle": { label: "x-axis title", advanced: true },
  "panels[].style.xTitle.text": { help: "Default from kind and unit; empty = none." },
  "panels[].style.xTitle.show": { optionLabels: { panel: "Once per panel", column: "Every column", none: "None" } },
  "panels[].overrides": { label: "Per-variable layout", advanced: true, help: "Variable id → column layout; use sparingly." },

  // Curve style (one cascade level); groupStyles and curveStyles reuse these hints.
  "panels[].style.curve": {
    label: "Curve style",
    order: ["type", "filled", "fill", "outline", "shape", "line", "interpolation", "points", "barWidth", "align", "presence", "exaggeration", "baseline", "plus", "valueLabels", "nulls"],
  },
  "panels[].style.curve.type": {
    optionLabels: { polygon: "Polygon", line: "Line", linePoints: "Line + points", points: "Points", bars: "Bars", presence: "Presence", none: "None (hidden)" },
  },
  "panels[].style.curve.fill.colour": curveColour,
  "panels[].style.curve.fill.pattern.type": pattern,
  "panels[].style.curve.fill.pattern.angle": { unit: "°", step: 15 },
  "panels[].style.curve.fill.pattern.spacing": { unit: "mm", step: 0.25 },
  "panels[].style.curve.outline.colour": colour,
  "panels[].style.curve.outline.width": lineWidth,
  "panels[].style.curve.outline.dash": dash,
  "panels[].style.curve.shape": { help: "Step: each sample a block reaching halfway to its neighbours.", optionLabels: { linear: "Linear", step: "Step (histogram)" } },
  "panels[].style.curve.line.colour": curveColour,
  "panels[].style.curve.line.width": lineWidth,
  "panels[].style.curve.line.dash": dash,
  "panels[].style.curve.interpolation": { optionLabels: { linear: "Linear", step: "Step" } },
  "panels[].style.curve.points.colour": curveColour,
  "panels[].style.curve.points.size": { unit: "mm", step: 0.1 },
  "panels[].style.curve.barWidth": { label: "Bar thickness", help: "Along the depth axis: fixed, or a fraction of the local sample spacing." },
  "panels[].style.curve.barWidth.mode": { optionLabels: { mm: "Fixed (mm)", fraction: "Fraction of spacing" } },
  "panels[].style.curve.align": { advanced: true },
  "panels[].style.curve.presence": { help: "Presence/absence marks (always used for kind presence)." },
  "panels[].style.curve.presence.colour": curveColour,
  "panels[].style.curve.presence.size": { unit: "mm", step: 0.1 },
  "panels[].style.curve.exaggeration": { help: "Lighter curve at value × factor behind the main one." },
  "panels[].style.curve.exaggeration.colour": { help: "CSS colour, \"group\", or \"curve\" = the curve colour." },
  "panels[].style.curve.baseline": { label: "Zero line", advanced: true },
  "panels[].style.curve.baseline.colour": { help: "CSS colour, \"group\", or \"axis\" = the axis colour." },
  "panels[].style.curve.baseline.width": { unit: "mm", step: 0.05, nullLabel: "Figure axis width" },
  "panels[].style.curve.baseline.dash": dash,
  "panels[].style.curve.plus": { label: "\"+\" for small values", help: "\"+\" right of non-zero values below the threshold." },
  "panels[].style.curve.plus.size": { unit: "mm", step: 0.1 },
  "panels[].style.curve.valueLabels": { advanced: true },
  "panels[].style.curve.valueLabels.show": { optionLabels: { off: "Off", all: "All values", aboveThreshold: "Above threshold" } },
  "panels[].style.curve.valueLabels.format": { help: "{value} is replaced by the number, e.g. \"{value}%\"." },
  "panels[].style.curve.nulls": { label: "Missing values", advanced: true, optionLabels: { gap: "Gap", connect: "Connect" } },
  groupStyles: { label: "Group curve styles", advanced: true, help: "Group id → curve style, between the panel and the variable styles." },
  curveStyles: { label: "Variable curve styles", advanced: true, help: "Variable id → curve style; wins over panel and group styles." },

  overlays: { itemLabel: "overlay", itemTitle: ["type"] },
  "overlays[]": { optionLabels: { zones: "Zones" } },
  "overlays[].manual": { label: "Boundaries", itemLabel: "boundary", itemTitle: ["depth", "label"] },
};

/** Hints for the spec form; overrides reuse the panel style hints, group and variable curve styles the panel curve hints. */
export const SPEC_FORM_HINTS: FormHints = {
  hints: SPEC_HINTS,
  aliases: { "panels[].overrides{}": "panels[].style", "groupStyles{}": "panels[].style.curve", "curveStyles{}": "panels[].style.curve" },
};

let cached: FormNode | undefined;

/** The spec schema as a form description (memoised). */
export function specForm(): FormNode {
  cached ??= describeSchema(SpecSchema, SPEC_FORM_HINTS);
  return cached;
}
