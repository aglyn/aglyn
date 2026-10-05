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

It also keeps the `datasetSchema` installable artifact type (`artifactTypes` in `plugins.config.json`, registered from `registerDataConsoleServerDeclarations`): a dataset's schema published to a marketplace, installed as a new, empty dataset, and updated in place. The installer asks this plugin through `@aglyn/aglyn/plugin-manager/plugin-artifact-types` and never reads the datasets collection; the schema's model (`sanitizeDatasetSchema`, `resolveInstalledDatasetSchema`, `summarizeSchemaChange`) is `@aglyn/plugins-data/artifact/dataset-schema`.

On the server, `registerDataServerDeclarations()` also registers the two automation steps that write a dataset record, `datasetAppend` and `updateDataset` (`server/dataset-steps.server.ts`). The Workflows engine runs them through the platform's server-step seam (`registerServerStepExecutor`), and `plugins.config.json` declares them under `serverSteps`. A record a step writes refreshes the live pages that repeat over its dataset (`server/dataset-live-pages.ts`).

### Entry points

| import | contents |
| -- | -- |
| `@aglyn/plugins-data` | `BUNDLE_ID`, `registerDataConsole`, `HostDatasetsCard`, and the transfer resource a dataset's records move as: `DATASET_TRANSFER_RESOURCE` (`data.dataset`) and `datasetTransferResourceKey(datasetId)` |
| `@aglyn/plugins-data/*` | any module under `src/lib/`, for example `@aglyn/plugins-data/model/dataset-record-view` (`datasetRecordFields`, `describeDatasetValue`) |

## Usage

The registrar is normally called by Aglyn's generated console loader. Called directly:

```ts
import { registerDataConsole } from '@aglyn/plugins-data'
registerDataConsole()
```

Import and export run on the platform's transfer framework (AGL-3530). The plugin declares `data.dataset` under `transferResources` with `instances`, so each dataset is its own resource, `data.dataset:<datasetId>`; it registers the server half from `registerDataConsoleServerDeclarations` (`transfer/dataset-transfer.server.ts`: the field catalog, match keys, the export's pages and count, the dry run held to the dataset's model, the writes and their undo) and the client half from `registerDataConsole`. The Data card opens the wizard and the export dialog through the console's launcher:

```ts
import { useTransferLauncher } from '@aglyn/aglyn'
import { datasetTransferResourceKey } from '@aglyn/plugins-data'

useTransferLauncher()?.openImport({ resource: datasetTransferResourceKey(datasetId), scope: 'org' })
```

## How it fits

A plugin may import the tenant runtime, the renderer, the Besigner logic, the core and the shared packages. It never imports another plugin, and the core never imports a plugin. Data depends on `@aglyn/aglyn` (which owns the dataset model and the CSV helpers), `@aglyn/tenant-runtime`, `@aglyn/tenant-feature-instance` and a few `@aglyn/shared-*` packages. Other plugins that need CSV parsing take it from the core, not from this package.

## License

Apache-2.0. Source: https://github.com/aglyn/aglyn/tree/main/libs/plugins/data
