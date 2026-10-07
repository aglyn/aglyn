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
import { registerPluginShipmentListener } from '@aglyn/aglyn/plugin-manager/plugin-shipment-records'
import {
  registerPluginShippingRateQuoter,
  type PluginShippingRateQuoter,
} from '@aglyn/aglyn/plugin-manager/plugin-shipping-rates'
import { registerPluginUsageMeter } from '@aglyn/aglyn/plugin-manager/plugin-usage-meters'
import { SHIPPING_PLUGIN_ID, SHIPPING_USAGE_METER_ID } from './constants/bundle-common'
import type { PaidOrderEnvelope } from './server/address-checks'

/**
 * Shipping's SERVER declarations (AGL-3612), loaded by both apps' servers
 * before any plugin handler, cron or webhook runs:
 *
 * - the carrier-rate quoter commerce asks at checkout — the storefront's
 *   cart and buy-now in the tenant, a draft order's link in the console;
 * - the listener that starts following a parcel a merchant shipped by hand;
 * - the usage meter the monthly sweep bills deferred label charges through;
 * - the `order.paid` subscriber that checks a paid order's address, by the
 *   event's name — the seller that raises it is never imported.
 *
 * Each is registered whether or not the deployment is configured, and each
 * answers as though it were absent when it is not: the quoter is not
 * available, the listener does nothing, the meter measures zero.
 *
 * Every handler reaches its server module through a dynamic import. Those
 * modules read Firestore through the tenant data layer, whose barrel pulls
 * in the render cache and with it `next/cache`; imported here at the top,
 * that chain would load in every app's boot (and every spec that boots the
 * declarations) before a single quote is asked for.
 */
const lazyRateQuoter: PluginShippingRateQuoter = {
  async available(hostId) {
    const { shippingRateQuoter } = await import('./server/rate-quoter')
    return shippingRateQuoter.available(hostId)
  },
  async quote(request) {
    const { shippingRateQuoter } = await import('./server/rate-quoter')
    return shippingRateQuoter.quote(request)
  },
  async listServices(hostId) {
    const { shippingRateQuoter } = await import('./server/rate-quoter')
    return shippingRateQuoter.listServices(hostId)
  },
  async validateAddress(hostId, address) {
    const { shippingRateQuoter } = await import('./server/rate-quoter')
    if (!shippingRateQuoter.validateAddress) return { verdict: 'unknown', messages: [] }
    return shippingRateQuoter.validateAddress(hostId, address)
  },
}

export function registerShippingServerDeclarations(): void {
  registerPluginShippingRateQuoter(lazyRateQuoter, { pluginId: SHIPPING_PLUGIN_ID })
  registerPluginShipmentListener(
    async (announcement) => {
      const { onShipmentAnnounced } = await import('./server/trackers')
      await onShipmentAnnounced(announcement)
    },
    { pluginId: SHIPPING_PLUGIN_ID },
  )
  subscribePluginDomainEvent<PaidOrderEnvelope['payload']>(
    'order.paid',
    async (envelope) => {
      const { checkPaidOrderAddress } = await import('./server/address-checks')
      await checkPaidOrderAddress(envelope)
    },
    { pluginId: SHIPPING_PLUGIN_ID, name: 'address-check' },
  )
  registerPluginUsageMeter({
    pluginId: SHIPPING_PLUGIN_ID,
    id: SHIPPING_USAGE_METER_ID,
    measure: async (context) => {
      const { measureShippingMonth } = await import('./server/usage-meter')
      return measureShippingMonth(context)
    },
  })
}

registerShippingServerDeclarations()
