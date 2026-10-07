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
import { registerPluginEventHandler } from '@aglyn/aglyn/plugin-manager/plugin-events'
import { registerPluginPersonEraser } from '@aglyn/aglyn/plugin-manager/plugin-person-erasure'
import { registerPluginSiteBeacon } from '@aglyn/aglyn/plugin-manager/plugin-site-beacons'
// The registry from its own module, not the runtime barrel: boot needs the
// registry and nothing else.
import { registerHostEventListener } from '@aglyn/tenant-runtime/host-event-listeners'
import { BUNDLE_ID } from './constants/bundle-common'

/**
 * The funnels plugin's server declarations (AGL-3605), in both apps:
 *
 * - it counts the site collector's journey beacons — one step of a recorded
 *   visit each — into the site's `funnelJourneys`;
 * - it hears every host event, and a person's own action that names the
 *   visit it ended (a form submission) identifies that visit;
 * - it hears the platform's `host.email.engaged`, and an email opened or
 *   clicked by a person a visit identified becomes an `email` step;
 * - it erases the visits a person identified, with the person.
 *
 * Every body, and the Admin SDK, loads with the first event that needs it.
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
  registerHostEventListener(BUNDLE_ID, {
    async onEvent(hostId, event, _payload, context) {
      if (!context?.journeyId) return
      const { identifyJourney } = await import('./server/journey-people.platform')
      await identifyJourney(hostId, event, context)
    },
  })
  registerPluginEventHandler(
    'host.email.engaged',
    async ({ hostId, events }) => {
      if (!events.some((one) => one.firstOfType)) return
      const { recordEmailEngagement } = await import('./server/journey-people.platform')
      await recordEmailEngagement(hostId, events)
    },
    { pluginId: BUNDLE_ID },
  )
  registerPluginPersonEraser(
    async (request) => {
      const { eraseFunnelPersonOnPlatform } = await import('./server/journey-people.platform')
      return eraseFunnelPersonOnPlatform(request)
    },
    { pluginId: BUNDLE_ID },
  )
}
