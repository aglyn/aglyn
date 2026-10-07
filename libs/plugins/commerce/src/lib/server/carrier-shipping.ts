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

import {
  pluginShippingRateQuoter,
  quotePluginShippingRates,
  type PluginShippingParcel,
} from '@aglyn/aglyn/plugin-manager/plugin-shipping-rates'
import * as CommerceModel from '../model'

/**
 * LIVE CARRIER RATES AT CHECKOUT (AGL-3612): the `carrier` rate kind, priced
 * by asking core's `core.shipping-rate-quoter` — whichever plugin quotes
 * carriers — and never by importing it.
 *
 * ## Quoted before the session exists, on every door
 *
 * Stripe's hosted Checkout cannot change a session's shipping options once
 * the shopper types an address ("The hosted page integration doesn't support
 * dynamically customizing shipping options"), and the in-page form can only
 * by a server update after the fact — while this module's callers fix the
 * platform fee and the Connect transfer from the session's options at
 * creation. So the quote is taken BEFORE the session, against the
 * destination the shopper declares (country and postal code), and the
 * session is then restricted to that country exactly as a zone rate is
 * (AGL-1721). The same code serves cart checkout, buy-now and a draft
 * order's link, hosted and in-page, and the fee arithmetic downstream sees
 * ordinary options.
 *
 * ## The fallback is the merchant's own
 *
 * No quoter, a quoter not available for this site, or a quote that fails or
 * takes longer than {@link CommerceModel.CARRIER_QUOTE_TIMEOUT_MS}: the plan
 * is exactly the one {@link CommerceModel.planCheckoutShipping} makes from
 * the table, where a carrier rate offers nothing and its fallback rate is
 * offered. A store with no carrier rate never reaches the quoter at all, so
 * its sessions are byte-identical to the ones before this existed.
 */

export interface CarrierShippingCart {
  subtotalCents: number
  totalGrams: number
  /** One parcel's dimensions, when the cart is one product that has them. */
  parcel?: Omit<PluginShippingParcel, 'weightGrams'>
}

export interface CarrierShippingDestination {
  country?: unknown
  postalCode?: unknown
  state?: unknown
  city?: unknown
}

/** A postal code a shopper declared, trimmed and bounded, or `undefined`. */
export function normalizeCheckoutPostalCode(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const code = value.trim().toUpperCase().slice(0, 12)
  return /^[A-Z0-9][A-Z0-9 -]{1,11}$/.test(code) ? code : undefined
}

export type CarrierShippingPlan = CommerceModel.CheckoutShippingPlan & {
  /** Set when the plan offers live quotes: the postal code they were priced for. */
  quotedPostalCode?: string
  /**
   * The destination's zone prices by carrier and the store can quote, but the
   * shopper has not said where in the country: ask for a postal code.
   */
  needsPostalCode?: boolean
}

/** What a shopper is told when a postal code is needed. */
export const CARRIER_POSTAL_CODE_MESSAGE = 'Enter the postal code you’re shipping to.'

/**
 * The shipping half of a session for a store that may price by carrier.
 * See the module comment; `planCheckoutShipping` is the whole answer for any
 * store without a carrier rate.
 */
export async function planCheckoutShippingWithCarriers(input: {
  hostId: string
  settings: CommerceModel.ShippingSettings | undefined
  cart: CarrierShippingCart
  destination: CarrierShippingDestination
  currency?: string
  timeoutMs?: number
}): Promise<CarrierShippingPlan> {
  const { settings, cart } = input
  const tablePlan = () =>
    CommerceModel.planCheckoutShipping(
      settings,
      { subtotalCents: cart.subtotalCents, totalGrams: cart.totalGrams },
      input.destination.country,
    )
  if (!CommerceModel.hasCarrierRates(settings)) return tablePlan()
  const quoter = pluginShippingRateQuoter()
  if (!quoter) return tablePlan()
  const available = await quoter.available(input.hostId).catch(() => false)
  if (!available) return tablePlan()

  const country = CommerceModel.normalizeCheckoutShippingCountry(input.destination.country)
  if (!country) {
    // Carrier prices differ by address by construction, so a session that
    // does not know the destination cannot be honest about any of them.
    return { countries: CommerceModel.CHECKOUT_SHIPPING_COUNTRIES, options: [], refusal: 'destination-required' }
  }
  const carrierRates = CommerceModel.carrierRatesFor(settings, country)
  if (!carrierRates.length) return tablePlan()
  const postalCode = normalizeCheckoutPostalCode(input.destination.postalCode)
  if (!postalCode) {
    return {
      countries: [country],
      options: [],
      refusal: 'destination-required',
      needsPostalCode: true,
    }
  }

  const currency = String(input.currency ?? 'usd').toLowerCase()
  const quotes = await quotePluginShippingRates(
    {
      hostId: input.hostId,
      to: {
        country,
        postalCode,
        ...(typeof input.destination.state === 'string' && input.destination.state.trim()
          ? { state: input.destination.state.trim().slice(0, 40) }
          : {}),
        ...(typeof input.destination.city === 'string' && input.destination.city.trim()
          ? { city: input.destination.city.trim().slice(0, 80) }
          : {}),
      },
      parcels: [{ weightGrams: Math.max(0, Math.round(cart.totalGrams)), ...(cart.parcel ?? {}) }],
      currency,
      valueCents: Math.max(0, Math.round(cart.subtotalCents)),
    },
    { timeoutMs: input.timeoutMs ?? CommerceModel.CARRIER_QUOTE_TIMEOUT_MS },
  )
  if (!quotes || !quotes.length) return tablePlan()

  const quoted: CommerceModel.ResolvedShippingRate[] = []
  const hidden = new Set<string>()
  for (const rate of carrierRates) {
    const services = (rate.carrier?.services ?? []).map((key) => key.toLowerCase())
    const offered = quotes.filter(
      (quote) => quote.currency === currency && (!services.length || services.includes(quote.serviceKey.toLowerCase())),
    )
    if (!offered.length) continue
    if (rate.carrier?.fallbackRateId) hidden.add(rate.carrier.fallbackRateId)
    for (const quote of offered) {
      quoted.push({
        rateId: CommerceModel.carrierOptionRateId(rate.id, quote.serviceKey),
        name: (quote.estimatedDays
          ? `${quote.label} (${quote.estimatedDays} business day${quote.estimatedDays === 1 ? '' : 's'})`
          : quote.label
        ).slice(0, 100),
        amountCents: CommerceModel.carrierOptionAmountCents(quote.amountCents, rate.carrier),
      })
    }
  }
  if (!quoted.length) return tablePlan()

  // The table's own options for this destination stay — a flat rate the
  // merchant offers beside carriers, local pickup — less any fallback a
  // carrier rate replaced now that it has quotes.
  const table = CommerceModel.resolveCheckoutShippingOptions(
    settings,
    [country],
    { subtotalCents: cart.subtotalCents, totalGrams: cart.totalGrams },
  ).filter((option) => !hidden.has(option.rateId))
  // One option per name: two carrier rates quoting the same service keep the
  // cheaper, so a shopper never sees the same service twice.
  const byName = new Map<string, CommerceModel.ResolvedShippingRate>()
  for (const option of [...table, ...quoted]) {
    const existing = byName.get(option.name)
    if (!existing || option.amountCents < existing.amountCents) byName.set(option.name, option)
  }
  const options = [...byName.values()]
    .sort((a, b) => a.amountCents - b.amountCents || a.rateId.localeCompare(b.rateId))
    .slice(0, CommerceModel.MAX_CHECKOUT_SHIPPING_OPTIONS)
  return { countries: [country], options, quotedPostalCode: postalCode }
}
