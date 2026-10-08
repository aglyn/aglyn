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

import { registerPluginCheckoutCredit } from '@aglyn/aglyn/plugin-manager/plugin-checkout-credits'
import {
  subscribePluginDomainEvent,
  type PluginDomainEventEnvelope,
} from '@aglyn/aglyn/plugin-manager/plugin-domain-events'
import { registerPluginPersonEraser } from '@aglyn/aglyn/plugin-manager/plugin-person-erasure'
import { LOYALTY_CREDIT_KEY, LOYALTY_PLUGIN_ID } from './constants/bundle-common'
import { canonicalLoyaltyCode } from './model/loyalty-math'
import type { LoyaltyOrderPayload, LoyaltyRefundPayload } from './server/order-events'

/**
 * Loyalty's SERVER declarations (AGL-3640), loaded by both apps' servers
 * before any handler, cron or webhook runs:
 *
 * - the rewards credit commerce's cart and register ask through core's
 *   `core.checkout-credits` — rewards codes, referral codes, and staff
 *   lookup at the register;
 * - the seller's order events by name: `order.paid` earns, and
 *   `order.refunded` / `order.cancelled` take earned points back and give
 *   spent rewards back;
 * - the person eraser, so erasing a customer erases their membership.
 *
 * Every body reaches its server module through a dynamic import, so nothing
 * here loads the data layer in an app's boot. Recognizing a code is pure.
 */

type Credit = typeof import('./server/credit-provider')
const credit = async (): Promise<Credit> => import('./server/credit-provider')

type Events = typeof import('./server/order-events')
const events = async (): Promise<Events> => import('./server/order-events')

export function registerLoyaltyServerDeclarations(): void {
  const owner = { pluginId: LOYALTY_PLUGIN_ID }
  registerPluginCheckoutCredit(
    {
      key: LOYALTY_CREDIT_KEY,
      label: 'Rewards',
      recognizes: (code) => canonicalLoyaltyCode(code) !== null,
      offered: async (input) => (await credit()).loyaltyCreditOffered(input),
      resolve: async (input) => (await credit()).resolveLoyaltyCredit(input),
      hold: async (input) => (await credit()).holdLoyaltyCredit(input),
      release: async (input) => (await credit()).releaseLoyaltyCredit(input),
      stage: async (input) => (await credit()).stageLoyaltyCredit(input),
      restore: async (input) => (await credit()).restoreLoyaltyCredit(input),
      lookup: async (input) => (await credit()).lookupLoyaltyCredit(input),
    },
    owner,
  )
  subscribePluginDomainEvent<LoyaltyOrderPayload>(
    'order.paid',
    async (envelope) => (await events()).earnForOrder(envelope),
    { ...owner, name: 'earn' },
  )
  subscribePluginDomainEvent<LoyaltyRefundPayload>(
    'order.refunded',
    async (envelope: PluginDomainEventEnvelope<LoyaltyRefundPayload>) => (await events()).reverseForOrder(envelope, 'refunded'),
    { ...owner, name: 'refund' },
  )
  subscribePluginDomainEvent<LoyaltyOrderPayload>(
    'order.cancelled',
    async (envelope) => (await events()).reverseForOrder(envelope, 'cancelled'),
    { ...owner, name: 'cancel' },
  )
  registerPluginPersonEraser(async (request) => {
    const { eraseLoyaltyPerson } = await import('./server/person-eraser')
    return eraseLoyaltyPerson(request)
  }, owner)
}

registerLoyaltyServerDeclarations()
