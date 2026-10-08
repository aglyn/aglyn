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
import { INVENTORY_SYNC_JOB_ID, INVENTORY_SYNC_PLUGIN_ID } from './constants'

/**
 * The job (AGL-3642), on the CONSOLE's server only: it opens the sealed keys
 * and grants, and only the console holds the key they are sealed under. Each
 * tick sends the paid orders queued for a system, cancels what was canceled,
 * keeps stock counts in step and makes products on the side each connection
 * names.
 */
export function registerInventorySyncConsoleServerDeclarations(): void {
  registerPluginConsoleCron(
    {
      id: INVENTORY_SYNC_JOB_ID,
      label: 'Inventory sync',
      drives:
        'Sends paid orders to each store’s connected Cin7 Core, inFlow or Brightpearl account, keeps stock counts in step in the direction the store chose, and syncs products. If it stops, orders wait unsent and stock counts drift between the store and the system.',
      run: async (context) => {
        const [{ runInventoryTick }, { createEngine }, deps, { offeredProviders, readInventorySyncConfig }] =
          await Promise.all([
            import('./server/job'),
            import('./server/engine'),
            import('./server/platform-deps'),
            import('./server/config'),
          ])
        // Nothing can be opened without the key: nothing to run, and nothing failed.
        if (!offeredProviders(readInventorySyncConfig()).length) return { orders: 0, configured: false }
        const engineDeps = deps.platformEngineDeps()
        return runInventoryTick(
          { engine: createEngine(engineDeps), store: engineDeps.store, now: Date.now },
          { deadlineMs: context.deadlineMs },
        )
      },
    },
    { pluginId: INVENTORY_SYNC_PLUGIN_ID },
  )
}
