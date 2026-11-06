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

/**
 * The marketplace's CONSOLE-ONLY server declarations (AGL-4194), named under
 * `consoleServerDeclarations` in `plugins.config.json` and run at the
 * console's boot. The tenant runtime never bundles this module.
 *
 * - The declared-connection sync, on the console's fifteen-minute
 *   `plugin-console-crons` tick (`server/connections/sync.ts`): it opens
 *   each site's sealed grant with `PLUGIN_CONNECTIONS_TOKEN_KEY`, which only
 *   the console holds. Without the key every tick returns at once.
 *
 * Light at boot: the job's body is imported the first time a tick runs it.
 */

import { registerPluginConsoleCron } from '@aglyn/aglyn/plugin-manager/plugin-console-crons'
import { BUNDLE_ID } from './constants/bundle-common'

/** The sync job's id; `sync.ts` exports the same literal. */
const CONNECTION_SYNC_JOB_ID = 'marketplace-connection-sync'

export function registerMarketplaceConsoleServerDeclarations(): void {
  registerPluginConsoleCron(
    {
      id: CONNECTION_SYNC_JOB_ID,
      label: 'Plugin connection sync',
      drives:
        'Runs the scheduled fetch each installed marketplace plugin declares for its connection (Google reviews, for one) and writes the record the site’s pages show. If it stops, those pages keep showing the last record they had, which grows stale.',
      run: async (context) => (await import('./server/connections/sync')).runPluginConnectionSyncJob(context),
    },
    { pluginId: BUNDLE_ID },
  )
}
