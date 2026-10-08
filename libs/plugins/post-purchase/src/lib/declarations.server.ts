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

import { registerPluginCheckoutExtra } from '@aglyn/aglyn/plugin-manager/plugin-checkout-extras'
import {
  subscribePluginDomainEvent,
  type PluginDomainEventEnvelope,
} from '@aglyn/aglyn/plugin-manager/plugin-domain-events'
import { registerPluginTrackingPage } from '@aglyn/aglyn/plugin-manager/plugin-tracking-pages'
import { POST_PURCHASE_PLUGIN_ID } from './constants/bundle-common'
import type { OrderEventPayload, OrderFulfilledPayload, OrderRefundedPayload } from './server/order-sync'

/**
 * Post-purchase's SERVER declarations (AGL-3635), loaded by both apps'
 * servers before any handler, cron or webhook runs:
 *
 * - the package-protection offer the cart and checkout ask through core's
 *   checkout extras;
 * - the branded tracking page the order-status page asks through core's
 *   tracking pages;
 * - the seller's order events, by name — `order.paid`, `order.fulfilled`,
 *   `order.refunded`, `order.cancelled` — one subscriber per service, so a
 *   vendor that is down is retried alone.
 *
 * Each is registered whether or not the deployment is configured, and each
 * answers as though it were absent when it is not. Every handler reaches its
 * server module through a dynamic import, so nothing here loads the data
 * layer in an app's boot.
 */

type Handler<P> = (envelope: PluginDomainEventEnvelope<P>) => Promise<void>

const sync = <P>(pick: (module: typeof import('./server/order-sync')) => Handler<P>): Handler<P> =>
  async (envelope) => pick(await import('./server/order-sync'))(envelope)

export function registerPostPurchaseServerDeclarations(): void {
  const owner = { pluginId: POST_PURCHASE_PLUGIN_ID }
  registerPluginCheckoutExtra(
    {
      async offer(request) {
        const { offerPackageProtection } = await import('./server/offers')
        return offerPackageProtection(request)
      },
    },
    owner,
  )
  registerPluginTrackingPage(async (request) => {
    const { trackingPageFor } = await import('./server/offers')
    return trackingPageFor(request)
  }, owner)
  subscribePluginDomainEvent<OrderEventPayload>('order.paid', sync((m) => m.openProtectionPolicy), {
    ...owner,
    name: 'route-policy',
  })
  subscribePluginDomainEvent<OrderEventPayload>('order.paid', sync((m) => m.syncNarvarOrder), {
    ...owner,
    name: 'narvar-paid',
  })
  subscribePluginDomainEvent<OrderFulfilledPayload>('order.fulfilled', sync((m) => m.followParcel), {
    ...owner,
    name: 'aftership-parcel',
  })
  subscribePluginDomainEvent<OrderFulfilledPayload>('order.fulfilled', sync((m) => m.tellRouteShipment), {
    ...owner,
    name: 'route-shipment',
  })
  subscribePluginDomainEvent<OrderFulfilledPayload>('order.fulfilled', sync((m) => m.syncNarvarOrder), {
    ...owner,
    name: 'narvar-fulfilled',
  })
  subscribePluginDomainEvent<OrderRefundedPayload>('order.refunded', sync((m) => m.endProtectionPolicy), {
    ...owner,
    name: 'route-refund',
  })
  subscribePluginDomainEvent<OrderEventPayload>('order.cancelled', sync((m) => m.endProtectionPolicy), {
    ...owner,
    name: 'route-cancel',
  })
  subscribePluginDomainEvent<OrderEventPayload>('order.cancelled', sync((m) => m.syncNarvarOrder), {
    ...owner,
    name: 'narvar-cancelled',
  })
}

registerPostPurchaseServerDeclarations()
