# @aglyn/plugins-logic

The Logic plugin for Aglyn: the console surface for a site's variables and no-code functions, and the audit that finds references pointing at something that no longer exists. Install it if you run the Aglyn console and want that section; it is a first-party plugin, not a standalone library.

> Beta. Published from the Aglyn monorepo under the `beta` dist-tag; APIs can change between beta releases.

## Install

    npm install @aglyn/plugins-logic@beta

Peer dependencies: `react`, `@mui/material`, `firebase`.

## What's in it

The plugin is console-only. Variables and functions resolve when a page renders, through the tenant runtime's compose pipeline, so the plugin adds no element to a published site and registers no API route.

**Console** (`registerLogicConsole`, the `console` registrar in `plugins.config.json`):

- A `Logic` nav item at `/logic`, whose page is headed "Functions & Variables". The page is code-split and loads when opened.
- Two widgets in the `besignerFunctions` slot, the variables card and the functions card, which the Besigner's functions drawer draws.
- A widget in the `workflowUsage` slot: the "where used" dialog, drawn in the zone the Automation page hosts for one workflow's dependents.

**Exports from `.`**

- `registerLogicConsole` and `BUNDLE_ID` (`'logic'`).
- `HostVariablesCard`, `HostFunctionsCard` and their props types, for an app that opens the cards itself.
- `auditHostReferences` with `ReferenceIssue`, `ReferenceAuditInput` and `ScreenAuditEntry`: a pure check of every reference an action, workflow, computed variable or screen holds against the ids and names that still exist.
- `parseParameterOptions` and `formatParameterOptions`: a function parameter's choice list as one line of text. The grammar itself lives in `@aglyn/aglyn`; these are the function builder's names for it.

## Usage

The plugin is loaded through Aglyn's plugin manager: the console's generated loader manifest imports the package and calls the registrar named in `plugins.config.json`. An app that wires plugins by hand calls it once at startup:

```ts
import { registerLogicConsole } from '@aglyn/plugins-logic'

registerLogicConsole()
```

The audit is usable on its own:

```ts
import { auditHostReferences, type ReferenceIssue } from '@aglyn/plugins-logic'
```

## How it fits

A plugin package (`scope:plugin`). It depends on the core (`@aglyn/aglyn`), the tenant client hooks (`@aglyn/tenant-feature-instance`) and generic `@aglyn/shared-*` packages. It imports no other plugin: what it shares with the workflows plugin goes through a core seam and a console zone. The core never imports it; the console reaches it only through the loader manifest and the slots it fills.

## License

Apache-2.0. Source: https://github.com/aglyn/aglyn/tree/main/libs/plugins/logic
