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

import { registerPluginConsoleCron } from '@aglyn/aglyn/plugin-manager/plugin-console-crons'
import { MARKETING_PLATFORMS_PLUGIN_ID, MARKETING_PLATFORMS_SYNC_JOB_ID } from './constants'

/**
 * The sync job (AGL-3639), on the CONSOLE's server only: it opens the sealed
 * merchant credentials, and only the console holds the key they are sealed
 * under. Every tick runs each due connection: the backfill on its first
 * runs, then what changed since, both ways, and the commerce events owed.
 */
export function registerMarketingPlatformsConsoleServerDeclarations(): void {
  registerPluginConsoleCron(
    {
      id: MARKETING_PLATFORMS_SYNC_JOB_ID,
      label: 'Email platform sync',
      drives:
        'Copies each connected site’s contacts and their consent to Mailchimp, Klaviyo, Omnisend, Attentive or Constant Contact, reads unsubscribes made there back to the site, and delivers order events for their flows. If it stops, an unsubscribe made in the outside platform does not reach the site’s own sends, and abandoned-cart and post-purchase flows stop firing.',
      run: async (context) => {
        const [{ runSyncTick }, { platformSyncDeps }, { readMarketingPlatformsConfig }] = await Promise.all([
          import('./server/sync-engine'),
          import('./server/platform-deps'),
          import('./server/config'),
        ])
        // Nothing can be opened without the key: nothing to run, and nothing failed.
        if (!readMarketingPlatformsConfig().keyring) return { connections: 0, configured: false }
        return runSyncTick(platformSyncDeps(), { deadlineMs: context.deadlineMs })
      },
    },
    { pluginId: MARKETING_PLATFORMS_PLUGIN_ID },
  )
}
