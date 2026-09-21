# @aglyn/plugins-data

The Data plugin for Aglyn: datasets, their records, and CSV or JSON import and export, managed in the Aglyn console. Install it if you are running or building on the Aglyn platform and want datasets.

> Beta. Published from the Aglyn monorepo under the `beta` dist-tag; APIs can change between beta releases.

## Install

    npm install @aglyn/plugins-data@beta

Peer dependencies:

- `@mui/material`
- `firebase`
- `react`

None is optional.

## What's in it

This package is a first-party Aglyn plugin. It is loaded through Aglyn's plugin manager: the apps read its entry in the monorepo's `plugins.config.json`, import the module each surface names, and call the registrar declared for that surface. It is not a standalone library; installing it on its own loads nothing.

The plugin is console-only and declares one registrar, `registerDataConsole` (the `console` surface). Datasets are organization-shared collections that repeatable components read at render time through bindings; they are not a canvas component, so there is no `site` registrar and no server entry point in this package.

`registerDataConsole()` registers:

- A **Data** nav item and page at `/data`, behind the `dataStore` feature flag. The page is code-split.
- The organization datasets card, `HostDatasetsCard`, as a widget in the `orgData` slot.
- Datasets as a repeat source (`DATASET_REPEAT_SOURCE`), which is what offers "Repeat over dataset" on an element in Besigner and draws a repeat's copies from real rows on the canvas.

### Entry points

| import | contents |
| -- | -- |
| `@aglyn/plugins-data` | `BUNDLE_ID`, `registerDataConsole`, `HostDatasetsCard`, and the import/export model: `parseImportRows`, `mapImportColumns`, plus the CSV helpers re-exported from the core (`parseCsv`, `datasetRecordsToCsv`, `datasetCsvHeader`, `datasetCsvRow`, `datasetRecordToJson`, `serializeDatasetValue`, `countCsvDataRows`, `exportShortfall`) |
| `@aglyn/plugins-data/*` | any module under `src/lib/`, for example `@aglyn/plugins-data/model/dataset-record-view` (`datasetRecordFields`, `describeDatasetValue`) |

## Usage

The registrar is normally called by Aglyn's generated console loader. Called directly:

```ts
import { registerDataConsole } from '@aglyn/plugins-data'
registerDataConsole()
```

The import helpers are pure functions:

```ts
import { parseImportRows } from '@aglyn/plugins-data'

// A JSON array of objects, or CSV with a header row.
// Returns string maps keyed by source column name, or null.
const rows = parseImportRows('name,city\nAda,London')
```

## How it fits

A plugin may import the tenant runtime, the renderer, the Besigner logic, the core and the shared packages. It never imports another plugin, and the core never imports a plugin. Data depends on `@aglyn/aglyn` (which owns the dataset model and the CSV helpers), `@aglyn/tenant-runtime`, `@aglyn/tenant-feature-instance` and a few `@aglyn/shared-*` packages. Other plugins that need CSV parsing take it from the core, not from this package.

## License

Apache-2.0. Source: https://github.com/aglyn/aglyn/tree/main/libs/plugins/data
