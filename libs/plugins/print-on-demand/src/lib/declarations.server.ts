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

import { subscribePluginDomainEvent } from '@aglyn/aglyn/plugin-manager/plugin-domain-events'
import { registerPluginFulfillmentProvider } from '@aglyn/aglyn/plugin-manager/plugin-fulfillment-providers'
import { POD_PLUGIN_ID } from './constants/bundle-common'
import { POD_PROVIDER_LABELS, POD_PROVIDERS } from './model/print-on-demand'

/**
 * Print-on-demand's SERVER declarations (AGL-3641), loaded by both apps'
 * servers before any plugin handler, cron or webhook runs: the subscriptions
 * that send a paid order's lines to the service that makes them, and cancel
 * them when the store cancels or refunds the order in full — by the events'
 * names, so the seller that raises them is never imported. Delivered by the
 * event outbox wherever it drains, which retries a handler that throws.
 *
 * And each service as a fulfillment provider (`core.fulfillment-providers`):
 * the units of an order it holds and has not shipped, so a label bought for
 * the rest of the order leaves them off.
 *
 * Light on purpose: the handlers and the adapters load with the first event,
 * so a process that never sells never loads them.
 */
export function registerPrintOnDemandServerDeclarations(): void {
  const handlers = () => import('./server/orders')
  subscribePluginDomainEvent<any>('order.paid', async (envelope) => (await handlers()).onOrderPaid(envelope), {
    pluginId: POD_PLUGIN_ID,
  })
  subscribePluginDomainEvent<any>('order.cancelled', async (envelope) => (await handlers()).onOrderCancelled(envelope), {
    pluginId: POD_PLUGIN_ID,
  })
  subscribePluginDomainEvent<any>('order.refunded', async (envelope) => (await handlers()).onOrderRefunded(envelope), {
    pluginId: POD_PLUGIN_ID,
  })
  for (const provider of POD_PROVIDERS) {
    registerPluginFulfillmentProvider(
      {
        id: provider,
        label: POD_PROVIDER_LABELS[provider],
        holds: async (hostId, recordId) => (await handlers()).podFulfillmentHolds(hostId, recordId, provider),
      },
      { pluginId: POD_PLUGIN_ID },
    )
  }
}
