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
import { DELIVERY_APPS_JOB_ID, DELIVERY_APPS_PLUGIN_ID } from './constants'

/**
 * The job (AGL-3644), on the CONSOLE's server only, where the deployment's
 * partner credentials are: each tick sends again what a service did not
 * take — an acceptance, a rejection, a "ready" — and closes ready orders the
 * courier has long since collected.
 */
export function registerDeliveryAppsConsoleServerDeclarations(): void {
  registerPluginConsoleCron(
    {
      id: DELIVERY_APPS_JOB_ID,
      label: 'Delivery apps',
      drives:
        'Sends DoorDash, Uber Eats and Grubhub again any acceptance, rejection or "ready" they did not take the first time, and closes ready delivery orders as picked up two hours on. If it stops, an order the service did not hear about waits until staff press Send again, and ready orders stay open on the register.',
      run: async (context) => {
        const [{ runDeliveryAppsTick }, { createEngine }, deps, { offeredServices, readDeliveryAppsConfig }] = await Promise.all([
          import('./server/job'),
          import('./server/engine'),
          import('./server/platform-deps'),
          import('./server/config'),
        ])
        // No service configured: nothing to run, and nothing failed.
        if (!offeredServices(readDeliveryAppsConfig()).length) return { orders: 0, configured: false }
        const engineDeps = deps.platformEngineDeps()
        return runDeliveryAppsTick(
          { engine: createEngine(engineDeps), store: engineDeps.store, now: Date.now },
          { deadlineMs: context.deadlineMs },
        )
      },
    },
    { pluginId: DELIVERY_APPS_PLUGIN_ID },
  )
}
