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

/**
 * Shipping v1 (AGL-288): zones own countries; rates belong to a zone and
 * price as flat, free-over-threshold, or subtotal/weight tiers. Settings
 * live on `hosts/{hostId}/settings/store` under `shipping`. Pure.
 *
 * `resolveShippingRates` is the per-destination resolver;
 * `resolveCheckoutShippingOptions` is the Stripe Checkout adapter,
 * `planCheckoutShipping` decides which destinations one session may serve, and
 * `appendCheckoutShippingParams` emits it onto a session. AGL-288 shipped this
 * model with no production call site at all — the doc comment here claimed the
 * cart estimator, checkout and POS pickup used it, and none of them did, so
 * nothing ever read the settings a merchant saved and no shipping was ever
 * charged. Cart checkout calls it (AGL-1707) and buy-now calls it for physical
 * one-time products (AGL-1720). Draft orders and POS still do not.
 */

export interface ShippingZone {
  id: string
  name: string
  /** ISO-3166 alpha-2 codes; '*' = rest of world. */
  countries: string[]
}

export interface ShippingTier {
  /** Tier applies while subtotal (cents) or weight (grams) ≤ this. */
  upTo: number
  amountCents: number
}

export interface ShippingRate {
  id: string
  zoneId: string
  name: string
  kind: 'flat' | 'free_over' | 'price_tiers' | 'weight_tiers'
  /** flat + free_over base amount. */
  amountCents?: number
  /** free_over: order subtotal (cents) at/above which shipping is free. */
  freeOverCents?: number
  /** price_tiers (upTo = subtotal cents) / weight_tiers (upTo = grams). */
  tiers?: ShippingTier[]
}

export interface ShippingSettings {
  zones?: ShippingZone[]
  rates?: ShippingRate[]
  /** Offer free local pickup as a delivery choice. */
  localPickup?: boolean
}

export interface ResolvedShippingRate {
  rateId: string
  name: string
  amountCents: number
}

function zoneMatches(zone: ShippingZone, country: string): boolean {
  return zone.countries.some(
    (code) => code === '*' || code.toUpperCase() === country,
  )
}

function tierAmount(
  tiers: ShippingTier[] | undefined,
  value: number,
): number | null {
  const sorted = [...(tiers ?? [])].sort((a, b) => a.upTo - b.upTo)
  for (const tier of sorted) {
    if (value <= tier.upTo) return tier.amountCents
  }
  // Beyond the last tier the rate does not apply (merchant should add a
  // catch-all tier with a large upTo).
  return null
}

/**
 * Rates available for a destination + cart, cheapest first. Specific
 * country zones beat '*' zones: when any specific zone matches, '*'
 * zones are ignored (rest-of-world semantics).
 */
export function resolveShippingRates(
  settings: ShippingSettings | undefined,
  destinationCountry: string | undefined,
  cart: { subtotalCents: number; totalGrams?: number },
): ResolvedShippingRate[] {
  if (!settings || !destinationCountry) return []
  const country = destinationCountry.toUpperCase()
  const zones = settings.zones ?? []
  const specific = zones.filter(
    (zone) =>
      zoneMatches(zone, country) &&
      !zone.countries.every((code) => code === '*'),
  )
  const matched = specific.length
    ? specific
    : zones.filter((zone) => zoneMatches(zone, country))
  const zoneIds = new Set(matched.map((zone) => zone.id))
  const resolved: ResolvedShippingRate[] = []
  for (const rate of settings.rates ?? []) {
    if (!zoneIds.has(rate.zoneId)) continue
    let amountCents: number | null = null
    switch (rate.kind) {
      case 'flat':
        amountCents = Math.max(0, Math.round(rate.amountCents ?? 0))
        break
      case 'free_over':
        amountCents =
          rate.freeOverCents != null &&
          cart.subtotalCents >= rate.freeOverCents
            ? 0
            : Math.max(0, Math.round(rate.amountCents ?? 0))
        break
      case 'price_tiers':
        amountCents = tierAmount(rate.tiers, cart.subtotalCents)
        break
      case 'weight_tiers':
        amountCents = tierAmount(rate.tiers, cart.totalGrams ?? 0)
        break
    }
    if (amountCents == null) continue
    resolved.push({ rateId: rate.id, name: rate.name, amountCents })
  }
  if (settings.localPickup) {
    resolved.push({ rateId: 'pickup', name: 'Local pickup', amountCents: 0 })
  }
  return resolved.sort((a, b) => a.amountCents - b.amountCents)
}

/** Stripe Checkout accepts at most 5 `shipping_options` on one session. */
export const MAX_CHECKOUT_SHIPPING_OPTIONS = 5

/**
 * Destinations a storefront Checkout Session collects an address for, and
 * therefore the destinations shipping rates are resolved against (AGL-1707).
 *
 * NOT narrowed to the zones the merchant configured: narrowing would block
 * checkouts that complete today, turning a money fix into lost sales. The
 * wider list only means a shopper outside the merchant's zones is offered some
 * rate rather than none. Shared by cart checkout and buy-now (AGL-1720) so the
 * two paths cannot drift into offering different destinations.
 */
export const CHECKOUT_SHIPPING_COUNTRIES = [
  'US',
  'CA',
  'GB',
  'AU',
  'DE',
  'FR',
] as const

/**
 * The rates to declare as `shipping_options` on a Stripe Checkout Session
 * (AGL-1707), unioned over `destinationCountries`. Stripe charges shipping
 * ONLY when the session declares them.
 *
 * A UNION IS ONLY HONEST OVER DESTINATIONS THE SESSION IS ALSO RESTRICTED TO.
 * Called with every collectable country while the session accepted an address
 * in any of them — which is what AGL-1707 shipped — it offers a shopper in one
 * zone a rate belonging to another, and Stripe applies whichever the shopper
 * picks (a `shipping_rate_data` carries no country of its own, so nothing
 * downstream re-checks it against the address). That is AGL-1721. Callers now
 * reach this through `planCheckoutShipping`, which pairs the country list it
 * unions over with the country list the session allows, so the two cannot
 * disagree. Do not call it directly from a handler.
 *
 * Returns `[]` for a merchant who has configured nothing, and the caller must
 * then declare no `shipping_options` at all rather than an empty array — a
 * merchant who never set shipping up keeps a session identical to today's.
 */
export function resolveCheckoutShippingOptions(
  settings: ShippingSettings | undefined,
  destinationCountries: readonly string[],
  cart: { subtotalCents: number; totalGrams?: number },
): ResolvedShippingRate[] {
  if (!settings) return []
  const byRateId = new Map<string, ResolvedShippingRate>()
  for (const country of destinationCountries) {
    for (const rate of resolveShippingRates(settings, country, cart)) {
      // Stripe requires a display name, and a rate id is the dedupe key —
      // the console lets a merchant add a blank row, so neither is assured.
      if (!rate.rateId || !rate.name) continue
      const amountCents = Math.max(0, Math.round(Number(rate.amountCents) || 0))
      const existing = byRateId.get(rate.rateId)
      // One rate resolving differently for two countries should not be
      // possible (a zone selects a rate, it does not reprice one), but if it
      // ever is, keep the dearer. Under-charging is the defect being fixed.
      if (!existing || amountCents > existing.amountCents) {
        byRateId.set(rate.rateId, { ...rate, amountCents })
      }
    }
  }
  return (
    [...byRateId.values()]
      // Cheapest first, id as a tie-break so the emitted params are stable.
      .sort(
        (a, b) =>
          a.amountCents - b.amountCents || a.rateId.localeCompare(b.rateId),
      )
      // Past Stripe's cap the dearest are dropped, which is the harmless end
      // to lose: a shopper offered the cheap options would have taken one.
      .slice(0, MAX_CHECKOUT_SHIPPING_OPTIONS)
  )
}

/** Shopper-facing names for the collectable destinations (AGL-1721). */
export const CHECKOUT_SHIPPING_COUNTRY_NAMES: Readonly<Record<string, string>> =
  {
    US: 'United States',
    CA: 'Canada',
    GB: 'United Kingdom',
    AU: 'Australia',
    DE: 'Germany',
    FR: 'France',
  }

/**
 * A destination a shopper declared, or `undefined` for anything this session
 * could not collect an address for anyway. Never throws: an unknown code is
 * an undeclared destination, not an error, so a stale storefront that posts
 * one is answered by the plan below rather than by a 400 nobody can act on.
 */
export function normalizeCheckoutShippingCountry(
  value: unknown,
): string | undefined {
  // `typeof` rather than `String(value)`: a JSON body is caller-shaped, and
  // `String(['US'])` is 'US'. Coercing would let an array declare a
  // destination, which is not a spelling any storefront sends.
  if (typeof value !== 'string') return undefined
  const code = value.trim().toUpperCase()
  return (CHECKOUT_SHIPPING_COUNTRIES as readonly string[]).includes(code)
    ? code
    : undefined
}

export interface CheckoutShippingPlan {
  /** `shipping_address_collection[allowed_countries]` for this session. */
  countries: readonly string[]
  /** `shipping_options` for this session — valid for EVERY `countries` entry. */
  options: ResolvedShippingRate[]
  /**
   * Set when no session may be created at all:
   *
   * - `destination-required` — the merchant's rates differ by destination, so
   *   there is no set of options honest for every address Stripe would accept.
   *   Ask the shopper where they are shipping and plan again.
   * - `destination-unserved` — the merchant ships somewhere, but not there.
   */
  refusal?: 'destination-required' | 'destination-unserved'
}

/** Identity of a resolved list, for comparing two destinations' offers. */
function optionsKey(options: readonly ResolvedShippingRate[]): string {
  return options
    .map((option) => `${option.rateId}:${option.amountCents}`)
    .join('|')
}

/**
 * The whole shipping half of a Checkout Session: which destinations it may
 * accept an address for, and which rates it may charge (AGL-1721).
 *
 * THE INVARIANT IS THAT EVERY RETURNED OPTION IS VALID FOR EVERY RETURNED
 * COUNTRY. Stripe offers a session's `shipping_options` to whoever reaches the
 * page and charges whichever the shopper picks — it does not filter them by
 * the address entered, and there is no field on a `shipping_rate_data` that
 * would let it. So the ONLY place a zone can be enforced is here, by choosing
 * the two lists together: narrowing the allowed countries to the declared
 * destination is what makes the rates offered for it unpickable by anyone
 * else. Filtering the rate list alone would leave a session that still accepts
 * a French address against a US rate.
 *
 * Three shapes come out of it:
 *
 *   1. A merchant whose rates resolve the SAME for every collectable country —
 *      one zone, a single '*' zone, or none at all — needs no destination and
 *      keeps the session AGL-1707 shipped, byte for byte. The issue notes this
 *      is the common configuration, and it is the one that must not regress.
 *   2. A declared destination resolves exactly, and the session is restricted
 *      to it. A caller may not skip the restriction: the country arrives in a
 *      request body a shopper can craft, so a session that took the country's
 *      cheap rate while still accepting any address would hand that shopper
 *      the defect on purpose.
 *   3. Otherwise the caller must refuse — see `refusal`. Refusing is not lost
 *      revenue in either case: with rates that differ by zone there is no
 *      correct amount to charge without knowing where the parcel is going, and
 *      the union AGL-1707 shipped chose the wrong one silently.
 *
 * `cart.subtotalCents` is the PRE-discount items total, matching what the cart
 * displays, so a free-over threshold means what the shopper saw it mean.
 */
export function planCheckoutShipping(
  settings: ShippingSettings | undefined,
  cart: { subtotalCents: number; totalGrams?: number },
  destinationCountry?: unknown,
): CheckoutShippingPlan {
  const countries = CHECKOUT_SHIPPING_COUNTRIES as readonly string[]
  const destination = normalizeCheckoutShippingCountry(destinationCountry)
  if (destination) {
    const options = resolveCheckoutShippingOptions(
      settings,
      [destination],
      cart,
    )
    if (options.length > 0) return { countries: [destination], options }
    // No rate reaches there. A merchant who configured NO shipping at all is
    // not refusing anyone — that store charges no shipping and always has, so
    // it keeps completing exactly as it does today. A merchant who ships
    // elsewhere but not here is refusing, and saying so is the honest answer:
    // the alternative is shipping a parcel to a destination they priced no
    // rate for, for free.
    return resolveCheckoutShippingOptions(settings, countries, cart).length > 0
      ? { countries, options: [], refusal: 'destination-unserved' }
      : { countries, options: [] }
  }
  const offers = new Set(
    countries.map((country) =>
      optionsKey(resolveCheckoutShippingOptions(settings, [country], cart)),
    ),
  )
  // Compared as EMITTED — capped and sanitized — because that is the list a
  // shopper can pick from. Two destinations whose rates differ only past
  // Stripe's cap still offer the same five, and offering them is honest.
  if (offers.size > 1) {
    return { countries, options: [], refusal: 'destination-required' }
  }
  return {
    countries,
    options: resolveCheckoutShippingOptions(settings, countries, cart),
  }
}

/**
 * Emit `shipping_address_collection[allowed_countries][n]` onto a session's
 * form body. Stripe will not apply a `shipping_options` rate without an
 * address to ship to, so the two always travel together — and the countries
 * are the OTHER half of what makes a rate honest (AGL-1721), so pass the list
 * `planCheckoutShipping` returned rather than defaulting it beside a rate list
 * resolved for something narrower.
 */
export function appendShippingAddressCollectionParams(
  params: URLSearchParams,
  countries: readonly string[] = CHECKOUT_SHIPPING_COUNTRIES,
): void {
  countries.forEach((code, index) => {
    params.set(`shipping_address_collection[allowed_countries][${index}]`, code)
  })
}

/**
 * Emit resolved rates as `shipping_options` on a Checkout Session's form body.
 *
 * THIS IS THE ONLY THING THAT MAKES STRIPE CHARGE SHIPPING. Without these keys
 * Stripe presents no shipping choice and `total_details.amount_shipping` is 0
 * however many zones and rates the merchant saved (AGL-1707).
 *
 * An empty list emits NOTHING — not an empty array — so a merchant who
 * configured no shipping keeps a session byte-identical to the one built
 * before shipping was wired at all. That guarantee lives here rather than in
 * each caller, so neither checkout path can lose it independently (AGL-1720).
 */
export function appendCheckoutShippingParams(
  params: URLSearchParams,
  options: readonly ResolvedShippingRate[],
): void {
  options.forEach((option, index) => {
    const field = `shipping_options[${index}][shipping_rate_data]`
    params.set(`${field}[type]`, 'fixed_amount')
    params.set(`${field}[display_name]`, option.name.slice(0, 100))
    params.set(`${field}[fixed_amount][amount]`, String(option.amountCents))
    params.set(`${field}[fixed_amount][currency]`, 'usd')
  })
}
