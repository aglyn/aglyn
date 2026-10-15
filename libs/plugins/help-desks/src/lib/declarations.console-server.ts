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
import { HELP_DESKS_PLUGIN_ID, HELP_DESKS_SYNC_JOB_ID } from './constants'

/**
 * The sync job (AGL-3824), on the CONSOLE's server only: it opens the sealed
 * merchant credentials, and only the console holds the key they are sealed
 * under. Every tick runs each due connection: buyers and recent orders on
 * its first runs, then what changed since, the orders commerce's events
 * brought, and the contact form messages owed.
 */
export function registerHelpDesksConsoleServerDeclarations(): void {
  registerPluginConsoleCron(
    {
      id: HELP_DESKS_SYNC_JOB_ID,
      label: 'Help desk sync',
      drives:
        'Copies each connected site’s buyers and their recent orders to Gorgias, Re:amaze, Kustomer, Gladly or Richpanel, and opens the contact form messages a site chose to send there as tickets. If it stops, agents see no new orders beside a ticket, and contact form messages wait in the Inbox only.',
      run: async (context) => {
        const [{ runSyncTick }, { platformSyncDeps }, { readHelpDesksConfig }] = await Promise.all([
          import('./server/sync-engine'),
          import('./server/platform-deps'),
          import('./server/config'),
        ])
        // Nothing can be opened without the key: nothing to run, and nothing failed.
        if (!readHelpDesksConfig().keyring) return { connections: 0, configured: false }
        return runSyncTick(platformSyncDeps(), { deadlineMs: context.deadlineMs })
      },
    },
    { pluginId: HELP_DESKS_PLUGIN_ID },
  )
}
