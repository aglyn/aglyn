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
import { MARKETPLACES_JOB_ID, MARKETPLACES_PLUGIN_ID } from './constants'

/**
 * The job (AGL-3638), on the CONSOLE's server only: it opens the sealed
 * grants, and only the console holds the key they are sealed under. Each
 * tick confirms shipments and acknowledges orders, reads each marketplace's
 * new orders into the store, and brings listings in line with the shelf.
 */
export function registerMarketplacesConsoleServerDeclarations(): void {
  registerPluginConsoleCron(
    {
      id: MARKETPLACES_JOB_ID,
      label: 'Marketplaces',
      drives:
        'Brings Amazon, eBay, Etsy, TikTok Shop, Walmart and Faire orders into the store, sends each shipment’s tracking back to the marketplace, and keeps listing quantities and prices in step with the store. If it stops, marketplace orders are not imported, shipments are not confirmed there, and a listing can sell stock the store no longer has.',
      run: async (context) => {
        const [{ runMarketplacesTick }, { createEngine }, deps, { offeredMarketplaces, readMarketplacesConfig }] = await Promise.all([
          import('./server/job'),
          import('./server/engine'),
          import('./server/platform-deps'),
          import('./server/config'),
        ])
        // Nothing can be opened without the key and an app: nothing to run, and nothing failed.
        if (!offeredMarketplaces(readMarketplacesConfig()).length) return { connections: 0, configured: false }
        const engineDeps = deps.platformEngineDeps()
        return runMarketplacesTick(
          { engine: createEngine(engineDeps), store: engineDeps.store, now: Date.now },
          { deadlineMs: context.deadlineMs },
        )
      },
    },
    { pluginId: MARKETPLACES_PLUGIN_ID },
  )
}
