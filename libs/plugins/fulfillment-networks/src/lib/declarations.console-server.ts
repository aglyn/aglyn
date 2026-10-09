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
import { FULFILLMENT_NETWORKS_JOB_ID, FULFILLMENT_NETWORKS_PLUGIN_ID } from './constants'

/**
 * The job (AGL-3634), on the CONSOLE's server only: it opens the sealed
 * grants, and only the console holds the key they are sealed under. Each
 * tick sends the paid orders queued for a network, reads back what the
 * networks shipped, follows parcels, cancels on request, and counts stock.
 */
export function registerFulfillmentNetworksConsoleServerDeclarations(): void {
  registerPluginConsoleCron(
    {
      id: FULFILLMENT_NETWORKS_JOB_ID,
      label: 'Fulfillment networks',
      drives:
        'Sends paid orders to ShipBob, ShipMonk or Amazon Multi-Channel Fulfillment, writes the shipments and tracking they report back onto the orders, cancels what a merchant canceled, and keeps stock counts in step. If it stops, orders wait unsent and customers get no shipping emails for them.',
      run: async (context) => {
        const [{ runNetworksTick }, { createEngine }, deps, { offeredNetworks, readFulfillmentNetworksConfig }] =
          await Promise.all([
            import('./server/job'),
            import('./server/engine'),
            import('./server/platform-deps'),
            import('./server/config'),
          ])
        // Nothing can be opened without the key and an app: nothing to run, and nothing failed.
        if (!offeredNetworks(readFulfillmentNetworksConfig()).length) return { orders: 0, configured: false }
        const engineDeps = deps.platformEngineDeps()
        return runNetworksTick(
          { engine: createEngine(engineDeps), store: engineDeps.store, now: Date.now },
          { deadlineMs: context.deadlineMs },
        )
      },
    },
    { pluginId: FULFILLMENT_NETWORKS_PLUGIN_ID },
  )
}
