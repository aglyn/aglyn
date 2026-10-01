/**
 * @license
 * Copyright 2026 Aglyn LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// The registries' own modules, not the data layer's or the plugin-manager's
// barrel: boot needs these registries, not the whole server surface or the
// console's client contexts.
import {
  registerArtifactTypeOwner,
  type PluginArtifactOwner,
} from '@aglyn/aglyn/plugin-manager/plugin-artifact-types'
import {
  registerPluginRecordIndex,
  type PluginRecordIndex,
} from '@aglyn/aglyn/plugin-manager/plugin-record-index'
import {
  registerApiV1Resource,
  registerApiV1UsageFigures,
} from '@aglyn/tenant-data-admin/server/api-v1-resources'
import { firebaseAdmin } from '@aglyn/tenant-data-admin/server/firebase-admin'
import { BUNDLE_ID, DATASET_SCHEMA_ARTIFACT_TYPE } from './constants/bundle-common'
import { registerDatasetFigureReaders } from './server/dataset-figures'

/**
 * The data plugin's CONSOLE-ONLY server declarations, named under
 * `consoleServerDeclarations` in `plugins.config.json` and run at the
 * console's boot. Everything here is the console's alone, so the tenant
 * runtime does not register any of it.
 *
 * It serves the organization's datasets on the customer REST API,
 * `/v1/datasets/…`: the console's router owns the pipeline in front — the
 * key, the plan's API access, the quota, the rate limit, the error envelope —
 * and hands every request under `/v1/datasets` here once the key is
 * authenticated. No plan feature is named on the registration: the handler
 * answers reads on every plan and refuses a create the plan does not carry
 * (`dataStore`) with its own sentence, as it always has. The resource brings
 * its description for the API's OpenAPI document, and the datasets band
 * joins `GET /v1/usage`.
 *
 * And another plugin that works over the workspace's datasets — an AI job
 * naming a dataset in an automation, a planner listing what a site already
 * has, an insight summarizing a dataset's fields — runs on the console's
 * server, and reads them here rather than from the datasets collection:
 * through the `dataset` record index, and through the dataset figure readers
 * an insight asks.
 *
 * And a dataset's schema is an installable artifact: published from a
 * dataset, installed as a new one, updated in place. The installer that
 * sells it asks this plugin for each of those through the artifact type it
 * declares (`artifactTypes`), so it never reads the datasets collection. A
 * boot that skipped this refuses the install rather than reading it as a type
 * nobody keeps.
 *
 * Light at boot: the API handler is imported with its first request, the
 * description when the document is first built, the usage reader with the
 * first usage call, the index's reader with its first read and the schema's
 * answers with the first publish, install or update; the figure
 * readers reach Firestore only when one is asked. Registering again replaces
 * this plugin's own entries, so a second call (a hot reload, a spec) is
 * harmless.
 */
export function registerDataConsoleServerDeclarations(): void {
  registerApiV1Resource(
    'datasets',
    {
      handle: async (...args) =>
        (await import('./server/api-v1/datasets')).handleDatasets(...args),
      describe: async () =>
        (await import('./server/api-v1/openapi')).DATASETS_API_V1_DESCRIPTION,
    },
    { pluginId: BUNDLE_ID },
  )
  registerApiV1UsageFigures(
    async (ctx) => (await import('./server/api-v1/usage')).datasetUsageFigures(ctx),
    { pluginId: BUNDLE_ID },
  )
  registerPluginRecordIndex('dataset', lazyDatasetIndex, { pluginId: BUNDLE_ID })
  registerDatasetFigureReaders(() => firebaseAdmin.app().firestore())
  registerArtifactTypeOwner(DATASET_SCHEMA_ARTIFACT_TYPE, lazyDatasetSchemaOwner, {
    pluginId: BUNDLE_ID,
  })
}

const loadDatasetIndex = async () => (await import('./server/dataset-record-index')).datasetRecordIndex

const lazyDatasetIndex: PluginRecordIndex = {
  list: async (request) => (await loadDatasetIndex()).list(request),
  get: async (request) => (await loadDatasetIndex()).get(request),
}

const loadDatasetSchemaOwner = async () =>
  (await import('./artifact/dataset-schema-artifact.server')).datasetSchemaArtifactOwner

const lazyDatasetSchemaOwner: PluginArtifactOwner = {
  snapshot: async (request) => (await loadDatasetSchemaOwner()).snapshot(request),
  admits: async (workspace) => (await loadDatasetSchemaOwner()).admits(workspace),
  prepare: async (request) => (await loadDatasetSchemaOwner()).prepare(request),
  locate: async (request) => (await loadDatasetSchemaOwner()).locate(request),
}
