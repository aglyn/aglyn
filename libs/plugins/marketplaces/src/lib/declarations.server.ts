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

import { type PluginDomainEvent, subscribePluginDomainEvent } from '@aglyn/aglyn/plugin-manager/plugin-domain-events'
import type { OrderEventPayload } from '@aglyn/plugins-commerce/contracts'
import {
  ORDER_CANCELLED_EVENT,
  ORDER_FULFILLED_EVENT,
  ORDER_PAID_EVENT,
  ORDER_REFUNDED_EVENT,
  RETURN_RECEIVED_EVENT,
} from '@aglyn/plugins-commerce/contracts'
import { MARKETPLACES_PLUGIN_ID } from './constants'

/**
 * The plugin's SERVER declarations (AGL-3638), loaded by both apps' servers:
 * commerce's order events, by the tokens in commerce's contracts
 * (AGL-3980). The outbox drains in the tenant, so the subscribers live here,
 * and they only QUEUE (`server/intake.ts`): no grant, no marketplace call.
 *
 * Light at boot: every body is imported when it is first called.
 */

/** Events after which the shelf has moved: every marketplace listing of the site is brought in line. */
const STOCK_EVENTS: ReadonlyArray<PluginDomainEvent<OrderEventPayload>> = [
  ORDER_PAID_EVENT,
  ORDER_CANCELLED_EVENT,
  ORDER_REFUNDED_EVENT,
  RETURN_RECEIVED_EVENT,
]

export const MARKETPLACES_STOCK_EVENTS: readonly string[] = STOCK_EVENTS.map((event) => event.id)

async function intake() {
  const [module, { defaultIntakeDeps }] = await Promise.all([import('./server/intake'), import('./server/intake-deps')])
  return { module, deps: defaultIntakeDeps() }
}

export function registerMarketplacesServerDeclarations(): void {
  const owner = { pluginId: MARKETPLACES_PLUGIN_ID }
  for (const event of STOCK_EVENTS) {
    subscribePluginDomainEvent(
      event,
      async (envelope) => {
        const { module, deps } = await intake()
        await module.onStockMoved(deps, envelope)
      },
      owner,
    )
  }
  subscribePluginDomainEvent(
    ORDER_FULFILLED_EVENT,
    async (envelope) => {
      const { module, deps } = await intake()
      await module.onOrderFulfilled(deps, envelope)
    },
    owner,
  )
}
