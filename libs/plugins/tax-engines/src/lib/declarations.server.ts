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
import { registerPluginTaxEngine } from '@aglyn/aglyn/plugin-manager/plugin-tax-profile'
import { TAX_ENGINES_PLUGIN_ID } from './constants/bundle-common'

/**
 * The tax engines' SERVER declarations (AGL-3631), loaded by both apps'
 * servers before any plugin handler, cron or webhook runs:
 *
 * - the `core.tax-engine` answer commerce asks at checkout (the tenant's cart
 *   and buy-now) and in the console (the POS, a draft order's link);
 * - the subscriptions that record a paid order with the engine and reverse
 *   it on a refund or a cancellation, delivered by the event outbox wherever
 *   it drains.
 *
 * Light on purpose: the engine and the handlers load with the first call, so
 * a process that never prices a sale never loads a vendor adapter.
 */
export function registerTaxEnginesServerDeclarations(): void {
  const engine = () => import('./server/engine').then((module) => module.taxEngine)
  registerPluginTaxEngine(
    {
      status: async (hostId) => (await engine()).status(hostId),
      quote: async (request) => (await engine()).quote(request),
      validateAddress: async (hostId, address) => (await engine()).validateAddress(hostId, address),
    },
    { pluginId: TAX_ENGINES_PLUGIN_ID },
  )
  const handlers = () => import('./server/transactions')
  subscribePluginDomainEvent<any>(
    'order.paid',
    async (envelope) => (await handlers()).onOrderPaid(envelope),
    { pluginId: TAX_ENGINES_PLUGIN_ID },
  )
  subscribePluginDomainEvent<any>(
    'order.refunded',
    async (envelope) => (await handlers()).onOrderRefunded(envelope),
    { pluginId: TAX_ENGINES_PLUGIN_ID },
  )
  subscribePluginDomainEvent<any>(
    'order.cancelled',
    async (envelope) => (await handlers()).onOrderCancelled(envelope),
    { pluginId: TAX_ENGINES_PLUGIN_ID },
  )
}
