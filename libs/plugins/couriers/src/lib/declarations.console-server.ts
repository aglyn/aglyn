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
import { COURIERS_JOB_ID, COURIERS_PLUGIN_ID } from './constants'

/**
 * The job (AGL-3695), on the CONSOLE's server only: it opens the merchants'
 * sealed keys, and only the console holds the key they are sealed under.
 * Each tick calls off the couriers a refund or a cancel marked, settles a
 * booking whose answer was lost, and reads each open run the courier has not
 * reported on lately.
 */
export function registerCouriersConsoleServerDeclarations(): void {
  registerPluginConsoleCron(
    {
      id: COURIERS_JOB_ID,
      label: 'Couriers',
      drives:
        'Calls off the DoorDash couriers on orders that were canceled or refunded, and keeps each courier’s progress, tracking link and arrival estimate on its order when a webhook is missed. If it stops, a refunded order’s courier still comes, and orders without webhooks stop updating.',
      run: async (context) => {
        const [{ runCouriersTick }, { createEngine }, deps, { readCouriersKeyring }] = await Promise.all([
          import('./server/job'),
          import('./server/engine'),
          import('./server/platform-deps'),
          import('./server/config'),
        ])
        // No key: nothing can be opened, nothing to run, and nothing failed.
        if (!readCouriersKeyring()) return { runs: 0, configured: false }
        const engineDeps = deps.platformEngineDeps()
        return runCouriersTick(
          { engine: createEngine(engineDeps), store: engineDeps.store, now: Date.now },
          { deadlineMs: context.deadlineMs },
        )
      },
    },
    { pluginId: COURIERS_PLUGIN_ID },
  )
}
