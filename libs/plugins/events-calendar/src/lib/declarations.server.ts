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
// registry and nothing else, and the barrel reaches the client contexts.
import { registerPluginConfigSchema } from '@aglyn/aglyn/plugin-manager/plugin-config'
import {
  registerPluginSiteSearchSource,
  type PluginSiteSearchSource,
} from '@aglyn/aglyn/plugin-manager/plugin-site-search'
import { BUNDLE_ID } from './constants/bundle-common'
import { EVENTS_CONFIG_SCHEMA } from './plugin-config'

/**
 * The events plugin's server declarations (AGL-4252): the light
 * registrations core reads at boot. Its events in the site's own search page
 * — each published event's next date, where calendar v2 is on — and its
 * settings, which say where an event's link opens. The reads and the Admin
 * SDK arrive with the first search, not with the boot.
 */
export function registerEventsCalendarServerDeclarations(): void {
  registerPluginConfigSchema(EVENTS_CONFIG_SCHEMA)
  registerPluginSiteSearchSource(lazySiteSearch, { pluginId: BUNDLE_ID })
}

const lazySiteSearch: PluginSiteSearchSource = {
  key: 'events',
  label: 'Events',
  items: async (request) =>
    (await import('./server/event-site-search')).eventsSiteSearch.items(
      request,
    ),
}
