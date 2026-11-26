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

// The seams from their own modules, not the plugin-manager barrel: boot needs
// the registries and nothing else, and the barrel reaches the client contexts.
import {
  registerPluginSiteOffer,
  type PluginSiteOfferSource,
} from '@aglyn/aglyn/plugin-manager/plugin-site-offers'
import {
  registerPluginSiteSearchSource,
  type PluginSiteSearchSource,
} from '@aglyn/aglyn/plugin-manager/plugin-site-search'
import { BUNDLE_ID } from './constants/bundle-common'

/**
 * The bookings plugin's server declarations (AGL-4252): the light
 * registrations core reads at boot. Its services in the site's own search
 * page, and a service as another plugin's "Book" button opens it (an events
 * calendar's). The reads and the Admin SDK arrive with the first call.
 */
export function registerBookingsServerDeclarations(): void {
  registerPluginSiteSearchSource(lazyServicesSearch, { pluginId: BUNDLE_ID })
  registerPluginSiteOffer('service', lazyServiceOffer, { pluginId: BUNDLE_ID })
}

const load = async () => await import('./server/services-site-search')

const lazyServicesSearch: PluginSiteSearchSource = {
  key: 'services',
  label: 'Services',
  items: async (request) =>
    (await load()).bookingsServicesSiteSearch.items(request),
}

const lazyServiceOffer: PluginSiteOfferSource = {
  resolve: async (request) =>
    (await load()).bookingsServiceSiteOffer.resolve(request),
}
