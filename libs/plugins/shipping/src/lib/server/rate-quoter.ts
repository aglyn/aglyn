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
  PluginShippingAddress,
  PluginShippingAddressCheck,
  PluginShippingParcel,
  PluginShippingQuote,
  PluginShippingRateQuoter,
} from '@aglyn/aglyn/plugin-manager/plugin-shipping-rates'
import { defaultPackage, type ShippingHostSettings } from '../model/shipping-settings'
import { serviceAllowed, serviceCatalog } from '../model/service-catalog'
import { openShippingAccount } from './account-store'
import { readShippingConfig } from './config'
import { quoteCacheKey, readCachedQuotes, writeCachedQuotes } from './quote-cache'
import { readHostSettings, resolveShipFrom } from './settings-store'
import { resolveShippingSite } from './site-context'

/**
 * THE QUOTER COMMERCE ASKS AT CHECKOUT (AGL-3612), registered against core's
 * `core.shipping-rate-quoter` from this plugin's server declarations, so it
 * is there in both apps: the storefront's cart and buy-now run in the
 * tenant, a draft order's payment link in the console.
 *
 * Available only where everything a label would need is already in place: a
 * configured deployment, a site that sells with shipping switched on, the
 * workspace's provider account already opened (a shopper never opens one),
 * and an address to ship from. Anything missing answers `false`, and the
 * seller uses its own rates — the fallback is the seller's, never ours.
 */

/** The box a parcel is rated in when the seller gave no dimensions. */
export function packParcels(
  parcels: PluginShippingParcel[],
  settings: ShippingHostSettings,
): PluginShippingParcel[] {
  const box = defaultPackage(settings)
  const list = parcels.length ? parcels : [{ weightGrams: 0 }]
  return list.map((parcel) => {
    const sized = Boolean(parcel.lengthCm && parcel.widthCm && parcel.heightCm)
    return {
      weightGrams: Math.max(1, Math.round(parcel.weightGrams + (sized ? 0 : box.emptyWeightGrams))),
      lengthCm: sized ? parcel.lengthCm : box.lengthCm,
      widthCm: sized ? parcel.widthCm : box.widthCm,
      heightCm: sized ? parcel.heightCm : box.heightCm,
    }
  })
}

export const shippingRateQuoter: PluginShippingRateQuoter = {
  async available(hostId) {
    const configured = readShippingConfig()
    if (!configured.configured) return false
    const site = await resolveShippingSite(hostId)
    if (!site) return false
    const account = await openShippingAccount(site.orgId, configured.config).catch(() => null)
    if (!account) return false
    const settings = await readHostSettings(site.orgId, hostId)
    return Boolean(await resolveShipFrom(hostId, settings))
  },

  async quote(request) {
    const configured = readShippingConfig()
    if (!configured.configured) throw new Error('shipping is not configured')
    const site = await resolveShippingSite(request.hostId)
    if (!site) throw new Error('shipping is not available for this site')
    const settings = await readHostSettings(site.orgId, request.hostId)
    const from = await resolveShipFrom(request.hostId, settings)
    if (!from) throw new Error('the site has no address to ship from')
    const account = await openShippingAccount(site.orgId, configured.config)
    if (!account) throw new Error('the workspace has no shipping account')
    const parcels = packParcels(request.parcels, settings)
    const key = quoteCacheKey({ ...request, parcels })
    const cached = await readCachedQuotes(key)
    if (cached) return cached
    const quote = await configured.config.provider.quoteRates(account, {
      from,
      to: request.to,
      parcels,
      currency: request.currency,
      valueCents: request.valueCents,
      ...(settings.signature !== 'none' ? { signature: settings.signature } : {}),
      ...(request.signal ? { signal: request.signal } : {}),
    })
    const quotes: PluginShippingQuote[] = quote.rates
      .filter((rate) => serviceAllowed(rate.serviceKey, settings.checkoutServices, request.services))
      // A rate in another currency than the sale cannot be charged as is,
      // and converting it here would be a price nobody quoted.
      .filter((rate) => rate.currency === request.currency.toLowerCase())
      .map((rate) => ({
        serviceKey: rate.serviceKey,
        carrier: rate.carrier,
        service: rate.service,
        label: rate.label,
        amountCents: rate.amountCents,
        currency: rate.currency,
        ...(rate.estimatedDays !== undefined ? { estimatedDays: rate.estimatedDays } : {}),
      }))
      .sort((a, b) => a.amountCents - b.amountCents || a.serviceKey.localeCompare(b.serviceKey))
    await writeCachedQuotes(key, { orgId: site.orgId, hostId: request.hostId }, quotes)
    return quotes
  },

  async listServices() {
    const configured = readShippingConfig()
    return configured.configured ? serviceCatalog(configured.config.providerId) : []
  },

  async validateAddress(hostId: string, address: PluginShippingAddress): Promise<PluginShippingAddressCheck> {
    const configured = readShippingConfig()
    if (!configured.configured) return { verdict: 'unknown', messages: [] }
    const site = await resolveShippingSite(hostId)
    if (!site) return { verdict: 'unknown', messages: [] }
    const account = await openShippingAccount(site.orgId, configured.config)
    if (!account) return { verdict: 'unknown', messages: [] }
    return configured.config.provider.validateAddress(account, address)
  },
}
