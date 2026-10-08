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
import { POD_PLUGIN_ID, POD_SYNC_JOB_ID } from './constants/bundle-common'

/**
 * The job (AGL-3641), on the CONSOLE's server: every tick it sends the
 * orders still owed to a service (a retry after a failure that may pass),
 * cancels what the store canceled while a send was in flight, asks after
 * what was sent so shipments reach the order even when a service's notice
 * never arrives, and re-syncs imported products that are due.
 */
export function registerPrintOnDemandConsoleServerDeclarations(): void {
  registerPluginConsoleCron(
    {
      id: POD_SYNC_JOB_ID,
      label: 'Print-on-demand sync',
      drives:
        'Retries paid orders that could not reach Printful or Printify, asks after the orders they are making so their shipments and tracking reach the store’s orders, and keeps imported products’ costs and availability current. If it stops, an order a service did not take the first time is never sent, and a shipment whose notice was lost never reaches the order.',
      run: async (context) => {
        const [{ runPodOrderTick }, { runPodLinkTick }, { readPodKeyring }] = await Promise.all([
          import('./server/orders'),
          import('./server/catalog'),
          import('./server/config'),
        ])
        // Nothing can be opened without the key: nothing to run, and nothing failed.
        if (!readPodKeyring()) return { configured: false }
        const orders = await runPodOrderTick(context)
        const links = await runPodLinkTick(context)
        return { configured: true, ...orders, ...links }
      },
    },
    { pluginId: POD_PLUGIN_ID },
  )
}
