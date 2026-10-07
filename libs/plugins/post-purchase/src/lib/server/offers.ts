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

import type {
  PluginCheckoutExtraOffer,
  PluginCheckoutExtraRequest,
} from '@aglyn/aglyn/plugin-manager/plugin-checkout-extras'
import type { PluginTrackingPageRequest } from '@aglyn/aglyn/plugin-manager/plugin-tracking-pages'
import { PACKAGE_PROTECTION_KEY } from '../constants/bundle-common'
import { aftershipTrackingPage } from '../providers/aftership'
import { narvarTrackingPage } from '../providers/narvar'
import { quoteRoute } from '../providers/route'
import { readPostPurchaseConfig } from './config'
import { openVendor, readStoredSettings } from './settings-store'
import { resolvePostPurchaseSite } from './site-context'

/**
 * What this plugin offers the seller through core's seams (AGL-3635):
 *
 * - **Package protection** at the cart, through checkout extras: Route's
 *   premium for the basket's shipped goods, at exactly what Route quotes —
 *   Aglyn adds nothing ({@link PROTECTION_MARKUP_CENTS} is 0). Only where
 *   the merchant connected Route and switched it on, only for goods that
 *   ship, only in a currency Route answered in.
 * - **A branded tracking page** for each parcel, through tracking pages:
 *   the retailer's Narvar page when Narvar is on and knows the carrier,
 *   otherwise the store's AfterShip page when it set one.
 */

/**
 * What Aglyn adds to Route's premium, in cents. Zero: the buyer pays Route's
 * price and the merchant remits it. Changing it is a pricing decision.
 */
export const PROTECTION_MARKUP_CENTS = 0

export async function offerPackageProtection(request: PluginCheckoutExtraRequest): Promise<PluginCheckoutExtraOffer | null> {
  const configured = readPostPurchaseConfig()
  if (!configured.configured || !configured.config.vendors.has('route')) return null
  const shipped = request.lines.filter((line) => line.ships && line.quantity > 0 && line.unitCents > 0)
  if (!shipped.length) return null
  const site = await resolvePostPurchaseSite(request.hostId)
  if (!site) return null
  const route = openVendor(await readStoredSettings(site.orgId, request.hostId), configured.config, 'route')
  if (!route) return null
  const subtotalCents = shipped.reduce((sum, line) => sum + line.unitCents * line.quantity, 0)
  const quote = await quoteRoute(
    {
      token: route.token,
      apiBase: configured.config.routeApiBase,
      fetchImpl: configured.config.fetchImpl,
      signal: request.signal,
    },
    {
      subtotalCents,
      currency: request.currency,
      items: shipped.map((line) => ({
        name: line.name,
        ...(line.sku ? { sku: line.sku } : {}),
        quantity: line.quantity,
        unitCents: line.unitCents,
      })),
    },
  )
  return {
    key: PACKAGE_PROTECTION_KEY,
    label: 'Package protection',
    description: 'Covers loss, damage and theft in transit, through Route.',
    amountCents: quote.premiumCents + PROTECTION_MARKUP_CENTS,
    currency: quote.currency,
    defaultSelected: route.defaultSelected,
    ...(quote.quoteId ? { quoteRef: quote.quoteId.slice(0, 64) } : {}),
  }
}

export async function trackingPageFor(request: PluginTrackingPageRequest): Promise<string | null> {
  const configured = readPostPurchaseConfig()
  if (!configured.configured) return null
  const site = await resolvePostPurchaseSite(request.hostId)
  if (!site) return null
  const stored = await readStoredSettings(site.orgId, request.hostId)
  const narvar = openVendor(stored, configured.config, 'narvar')
  if (narvar?.retailerMoniker) {
    const page = narvarTrackingPage(narvar.retailerMoniker, request.carrier, request.trackingNumber)
    if (page) return page
  }
  const aftership = openVendor(stored, configured.config, 'aftership')
  if (aftership?.trackingPageUrl) return aftershipTrackingPage(aftership.trackingPageUrl, request.trackingNumber)
  return null
}
