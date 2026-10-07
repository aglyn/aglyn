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

// The seam from its own module, not the plugin-manager barrel: boot needs the
// registry and nothing else.
import { registerPluginCatalogFeed } from '@aglyn/aglyn/plugin-manager/plugin-product-catalog'
import { BUNDLE_ID } from './constants/bundle-common'

/**
 * Sales channels' SERVER declarations (AGL-3637), loaded by both apps'
 * servers before any route runs: the catalog's feed publisher, which the
 * catalog's owner answers its pre-channels Google address through
 * (`/api/commerce/feed?hostId=`). A request for that address reaches the
 * owner's routes, not this plugin's, so the publisher is registered here and
 * its module arrives with the first such request.
 */
export function registerSalesChannelsServerDeclarations(): void {
  registerPluginCatalogFeed(
    {
      serveLegacyFeed: async (request, hostId) =>
        (await import('./server/feed-route')).legacyGoogleFeedRoute(request, hostId),
    },
    { pluginId: BUNDLE_ID },
  )
}
