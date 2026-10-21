# Linden

Free, browser-based, scriptable stratigraphic diagrams for palaeoecology — pollen, testate amoebae, diatoms, plant macrofossils, chironomids, charcoal, geochemistry.

- Architecture and roadmap: [SPEC.md](SPEC.md)
- Working rules for Claude Code: [CLAUDE.md](CLAUDE.md)

## Status
M0 — skeleton. See SPEC §13.

## Getting started
```bash
npm install
npm test
npm run dev        # app at http://localhost:5173 (uses packages/core from source, no build needed)
```

## CSV input format (MVP)
Wide format: `depth[,age]` then one column per variable. Two optional header rows give each variable's `group` and `kind` (see `examples/demo-pollen.csv`). Empty cell = not assessed (`null`); `0` = looked, none found.
