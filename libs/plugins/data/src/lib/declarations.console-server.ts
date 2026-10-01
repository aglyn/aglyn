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

// The registry's own module, not the data layer's barrel: boot needs one
// registry, not the whole server surface.
import {
  registerApiV1Resource,
  registerApiV1UsageFigures,
} from '@aglyn/tenant-data-admin/server/api-v1-resources'
import { BUNDLE_ID } from './constants/bundle-common'

/**
 * The data plugin's CONSOLE-ONLY server declarations, named under
 * `consoleServerDeclarations` in `plugins.config.json` and run at the
 * console's boot.
 *
 * It serves the organization's datasets on the customer REST API,
 * `/v1/datasets/…`: the console's router owns the pipeline in front — the
 * key, the plan's API access, the quota, the rate limit, the error envelope —
 * and hands every request under `/v1/datasets` here once the key is
 * authenticated. No plan feature is named on the registration: the handler
 * answers reads on every plan and refuses a create the plan does not carry
 * (`dataStore`) with its own sentence, as it always has. The resource brings
 * its description for the API's OpenAPI document, and the datasets band
 * joins `GET /v1/usage`. The API is the console's alone, so the tenant
 * runtime does not register them.
 *
 * Light at boot: the handler is imported with its first request, the
 * description when the document is first built, and the usage reader with
 * the first usage call. Registering again replaces this plugin's own entries.
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
}
