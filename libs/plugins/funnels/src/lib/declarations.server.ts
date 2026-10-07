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

import { SITE_JOURNEY_BEACON_FIELD } from '@aglyn/aglyn/app-utils/site-journey'
import { registerPluginSiteBeacon } from '@aglyn/aglyn/plugin-manager/plugin-site-beacons'
import { BUNDLE_ID } from './constants/bundle-common'

/**
 * The funnels plugin's server declarations (AGL-3605): it counts the site
 * collector's journey beacons — one step of a recorded visit each — into the
 * site's `funnelJourneys`. The counting code and the Admin SDK load with the
 * first beacon.
 */
export function registerFunnelsServerDeclarations(): void {
  registerPluginSiteBeacon(
    {
      field: SITE_JOURNEY_BEACON_FIELD,
      async count(request) {
        const { countJourneyBeacon } = await import('./server/journey-beacon')
        await countJourneyBeacon(request)
      },
    },
    { pluginId: BUNDLE_ID },
  )
}
