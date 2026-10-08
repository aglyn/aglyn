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
import { FULFILLMENT_NETWORKS_PLUGIN_ID } from './constants'
import { NETWORK_PROVIDER_IDS, NETWORK_PROVIDERS } from './model/networks'

/**
 * The plugin's SERVER declarations (AGL-3634), loaded by both apps' servers:
 *
 * - commerce's order events, by the names commerce raises them under. The
 *   outbox drains in the tenant, so the subscribers live here, and they only
 *   QUEUE (`server/intake.ts`): no grant, no network call;
 * - each network as an outside fulfiller on core's
 *   `core.fulfillment-providers`, so a label buyer, another fulfiller and
 *   the merchant see which units a network holds.
 *
 * Light at boot: every body is imported when it is first called.
 */

export const FULFILLMENT_NETWORKS_SUBSCRIBED_EVENTS = ['order.paid', 'order.cancelled', 'order.refunded'] as const

async function intake() {
  const [module, { defaultIntakeDeps }] = await Promise.all([import('./server/intake'), import('./server/intake-deps')])
  return { module, deps: defaultIntakeDeps() }
}

export function registerFulfillmentNetworksServerDeclarations(): void {
  const owner = { pluginId: FULFILLMENT_NETWORKS_PLUGIN_ID }
  subscribePluginDomainEvent(
    'order.paid',
    async (envelope) => {
      const { module, deps } = await intake()
      await module.onOrderPaid(deps, envelope as never)
    },
    owner,
  )
  subscribePluginDomainEvent(
    'order.cancelled',
    async (envelope) => {
      const { module, deps } = await intake()
      await module.onOrderCancelled(deps, envelope as never)
    },
    owner,
  )
  subscribePluginDomainEvent(
    'order.refunded',
    async (envelope) => {
      const { module, deps } = await intake()
      await module.onOrderRefunded(deps, envelope as never)
    },
    owner,
  )
  for (const provider of NETWORK_PROVIDER_IDS) {
    registerPluginFulfillmentProvider(
      {
        id: provider,
        label: NETWORK_PROVIDERS[provider].label,
        holds: async (hostId, recordId) => {
          const { module, deps } = await intake()
          return module.holdsFor(deps.store, provider, hostId, recordId)
        },
      },
      owner,
    )
  }
}
