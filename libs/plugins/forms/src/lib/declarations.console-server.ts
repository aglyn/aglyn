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

// The registry's own module, not the data layer's barrel: boot needs the
// registry, not the whole server surface.
import { registerApiV1SiteResource } from '@aglyn/tenant-data-admin/server/api-v1-resources'
import { BUNDLE_ID } from './constants/bundle-common'

/**
 * The forms plugin's CONSOLE-ONLY server declarations, named under
 * `consoleServerDeclarations` in `plugins.config.json` and run at the
 * console's boot. The tenant runtime registers none of it.
 *
 * It serves a site's form submissions on the customer REST API,
 * `/v1/sites/{siteId}/form-submissions/…`: the console's router owns the
 * pipeline in front — the key, the plan's API access, the quota, the rate
 * limit, the error envelope — and the site's ownership, and hands every
 * request under the resource here. No plan feature is named: submissions are
 * read and marked on every plan, as they always were. The resource brings its
 * description for the API's OpenAPI document.
 *
 * Light at boot: the handler is imported with its first request and the
 * description when the document is first built. Registering again replaces
 * this plugin's own entry.
 */
export function registerFormsConsoleServerDeclarations(): void {
  registerApiV1SiteResource(
    'form-submissions',
    {
      handle: async (...args) =>
        (await import('./server/api-v1/form-submissions')).handleFormSubmissions(...args),
      describe: async () =>
        (await import('./server/api-v1/openapi')).FORM_SUBMISSIONS_API_V1_DESCRIPTION,
    },
    { pluginId: BUNDLE_ID },
  )
}
