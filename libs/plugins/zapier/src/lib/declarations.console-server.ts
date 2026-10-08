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
import { ZAPIER_HOOKS_RESOURCE, ZAPIER_PLUGIN_ID } from './constants'

/**
 * The Zapier plugin's CONSOLE-ONLY server declarations (AGL-3643): the REST
 * hooks the Zapier app subscribes, `/v1/sites/{siteId}/hooks`, behind the
 * console's `/v1` pipeline. No plan feature is named on the registration:
 * the handler asks each event's scope and then its feature, the order every
 * resource asks them in. No description either, so the OpenAPI document
 * leaves it out until the app is published.
 */
export function registerZapierConsoleServerDeclarations(): void {
  registerApiV1SiteResource(
    ZAPIER_HOOKS_RESOURCE,
    {
      handle: async (request, context, segments) =>
        (await import('./server/platform-deps')).zapierHooksHandler()(request, context, segments),
    },
    { pluginId: ZAPIER_PLUGIN_ID },
  )
}
