# @aglyn/plugins-calculator

The Calculators plugin for Aglyn: the canvas elements that put one of a site's no-code functions on a page, and turn what it works out into a receipt, an invoice or a quote. Install it if you run Aglyn's site runtime and Besigner; it is a first-party plugin, not a standalone library.

> Beta, and not yet published to npm: the package is marked `private` until its name is created on the registry and trusted for publishing.

## What's in it

**Canvas elements** (`registerCalculatorPlugin`, the `site` registrar in `plugins.config.json`):

- `functionWidget` — **Function Widget**: a whole calculator in one block (inputs, a button, the result).
- `functionScope` — **Calculator**: a container bound to one site function. Everything below sits inside one.
- `functionInput` — **Calculator Input**: asks one parameter, as a number box, a list, a switch or quick picks.
- `functionOutput` — **Calculator Result**: shows one value of the function.
- `functionShow` — **Show When**: a container that appears only while a value is true.
- `functionDocument` — **Calculator Document**: a receipt, invoice or quote laid out on the canvas, filled by results.
- `functionSave` — **Calculator Save Button**: saves the document as a PDF (the browser's print-to-PDF, scoped to the document), shares it, or copies it as text.

**Exports from `.`**: `registerCalculatorPlugin`, `CALCULATOR_BUNDLE` and `BUNDLE_ID` (`'calculator'`).

## How it fits

A plugin package (`scope:plugin`). It depends on the core (`@aglyn/aglyn`) and `@aglyn/shared-data-mdi`, and imports no other plugin. The functions and variables a calculator runs are authored in the Logic plugin's console, which is why the catalog row declares `requires: ["logic"]`; a function's definition reaches a Calculator through core's compose step, not through an import.

The elements were registered by `@aglyn/plugins-mui` until AGL-3387; `tools/scripts/backfill-node-plugin-ids.mjs` moves saved nodes' `pluginId` from `mui` to `calculator`.

## License

Apache-2.0. Source: https://github.com/aglyn/aglyn/tree/main/libs/plugins/calculator
