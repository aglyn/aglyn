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
import { registerOperatorAlerts } from '@aglyn/aglyn/plugin-manager/operator-alerts'
import { registerPluginSiteBeacon } from '@aglyn/aglyn/plugin-manager/plugin-site-beacons'
import { BUNDLE_ID } from './constants/bundle-common'
import { MARKETING_OPERATOR_ALERTS } from './constants/operator-alerts'

/**
 * The marketing plugin's server declarations: the light registrations core
 * reads at boot, before any surface loads — its operator alerts (AGL-3377),
 * so Staff → Operator alerts lists them before the first one is raised, and
 * its overlay beacons, which the site collector hands it on any published
 * page. The counting code and the Admin SDK load with the first beacon.
 */
export function registerMarketingServerDeclarations(): void {
  registerOperatorAlerts(MARKETING_OPERATOR_ALERTS, { pluginId: BUNDLE_ID })
  registerPluginSiteBeacon(
    {
      field: 'overlay',
      async count(request) {
        const [{ countOverlayBeacon }, { default: firebaseAdmin }] = await Promise.all([
          import('./server/overlay-beacon'),
          import('@aglyn/tenant-data-admin/server/firebase-admin'),
        ])
        await countOverlayBeacon(request, firebaseAdmin.app().firestore())
      },
    },
    { pluginId: BUNDLE_ID },
  )
}
