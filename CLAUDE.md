# CLAUDE.md

Working rules for Claude Code in this repository. Read `SPEC.md` before starting any task; it is the source of truth for architecture.

## Project in one paragraph

Linden is a free, client-side web app (plus a headless TypeScript core) for publication-quality stratigraphic diagrams of palaeoecological data — pollen, testate amoebae, diatoms, plant macrofossils, chironomids, charcoal, geochemistry. A diagram = `data + spec (JSON)`. The UI only edits the spec.

## Hard rules

1. **Proxy-agnostic core.** Never write proxy-specific logic (`if pollen…`) in `packages/core`. Proxy conventions belong in `/presets/*.json`. If a preset can't express something, add a _generic_ transform or panel and update `SPEC.md`.
2. **`packages/core` has no DOM, browser or React imports.** It must run in Node. Browser-only export (PDF/PNG) sits behind the `Exporter` interface and lives in `app` or a browser-only module.
3. **Pure and deterministic.** Transforms, analyses, layout and rendering are pure functions. No `Math.random`, no `Date.now`, no iteration over unordered keys when producing output. Same input → identical SVG.
4. **Physical units.** Layout is in millimetres. Convert to px only at the export boundary.
5. **Zero ≠ null.** `0` = looked and found none; `null` = not assessed. Keep the distinction through every stage.
6. **Never silently break the common x-scale** in percentage diagrams; emit a warning instead.
7. **Spec changes are versioned.** Any change to the spec shape bumps `specVersion` and adds a migration with a test.

## How to work

- **Minimal, targeted patches.** Change only what the task needs, in the existing files. Do not restructure, rename or reformat code you weren't asked to touch — the maintainer wants to keep an overview of his own codebase. If a refactor seems worthwhile, propose it in a sentence and wait.
- Spec first: if a task contradicts `SPEC.md`, stop and say so; if the spec needs to change, edit `SPEC.md` in the same change and point it out.
- New module = register it in `core/src/registry.ts`, export it from `core/src/index.ts`, add tests.
- Ask before adding a new runtime dependency. Current allowed deps: `d3-scale`, `d3-shape`, `zod` (core); `react`, `react-dom`, `zustand`, `jspdf`, `svg2pdf.js`, `xlsx`, `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` (app).
- Keep functions small and typed; no `any` in `core` public APIs.
- After a change, summarise in 2–4 lines what changed and which files — no long recap.

## Commands

```bash
npm install            # from repo root (npm workspaces)
npm run build          # build all packages
npm test               # vitest across workspaces
npm run test -w @linden/core -- --update   # update golden SVG snapshots (only when change is intentional)
npm run dev -w @linden/app                 # run the app (Vite) once the app package exists
npm run typecheck
```

## Testing expectations

- Every transform and analysis has unit tests with hand-checkable fixtures.
- Every panel has at least one golden SVG snapshot test from `examples/`.
- CONISS is validated against reference results (see SPEC §12).
- Do not update golden snapshots to make a failing test pass unless the visual change was intended; say so explicitly.

## Domain notes (for correct defaults)

- Depth axis increases downwards; age axis is derived from depth–age pairs by interpolation.
- Percentage diagrams: column width ∝ max value with one common scale; exaggeration curves (typically ×10) drawn behind the main curve in a lighter fill; values < 0.5% often shown as `+`.
- Pollen sum usually excludes aquatics and spores; those are shown as % of (sum + their group). This is a preset choice, not core logic.
- Taxon names use `*italic*` for genera/species; family names upright; `-type` suffix upright.
- CONISS: Grimm (1987), _Computers & Geosciences_ 13: 13–35. Broken-stick for zones: Bennett (1996), _New Phytologist_ 132: 155–170.

## Out of scope

Age–depth modelling, transfer-function calibration, servers/accounts, uploading user data anywhere.
