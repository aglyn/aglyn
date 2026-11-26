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
 * `planCheckoutShipping` decides which destinations one session may serve,
 * `appendCheckoutShippingParams` emits it onto a session, and
 * `summarizeShippingCoverage` answers the same question for the console, so a
 * merchant can see which destinations their zones refuse. AGL-288 shipped this
 * model with no production call site at all — the doc comment here claimed the
 * cart estimator, checkout and POS pickup used it, and none of them did, so
 * nothing ever read the settings a merchant saved and no shipping was ever
 * charged. Cart checkout calls it (AGL-1707), buy-now calls it for physical
 * one-time products (AGL-1720), and a draft order's payment link calls it for
 * physical products (AGL-1792).
 *
 * POS DOES NOT, AND SHOULD NOT (AGL-1792). A register has no destination
 * anywhere in it — no address field, no delivery choice — and all three
 * tenders settle at the counter: cash, a card QR the customer scans while
 * standing there, and a room folio collected at check-out. There is nothing to
 * price a parcel against, so the only rate POS could resolve is the free
 * `Local pickup` one this module appends, which is 0¢ and would add a step to
 * a register flow in exchange for nothing. A POS sale that must be shipped is
 * a draft order.
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

/**
 * A live carrier rate (AGL-3612): the zone's price is what a carrier quotes
 * for the parcel to the shopper's address, asked through core's
 * `core.shipping-rate-quoter` seam of whichever plugin quotes carriers. With
 * no quoter, a quoter that is not available for the site, no postal code to
 * quote against, or a quote slower than {@link CARRIER_QUOTE_TIMEOUT_MS}, it
 * offers nothing and its fallback rate is offered instead.
 */
export interface CarrierRateSettings {
  /** Service keys (`carrier:service`) to offer; empty offers every quoted service. */
  services?: string[]
  /** Added to each quote, in percent. */
  markupPct?: number
  /** Added to each quote after the markup, in cents. */
  handlingCents?: number
  /**
   * A rate of this zone offered when no live quote is: it is HIDDEN while
   * quotes are offered, so the shopper picks between carriers, not between a
   * carrier and the merchant's guess.
   */
  fallbackRateId?: string
}

/** How long checkout waits for live carrier quotes before it falls back. */
export const CARRIER_QUOTE_TIMEOUT_MS = 3_000

export interface ShippingRate {
  id: string
  zoneId: string
  name: string
  kind: 'flat' | 'free_over' | 'price_tiers' | 'weight_tiers' | 'carrier'
  /** flat + free_over base amount. */
  amountCents?: number
  /** free_over: order subtotal (cents) at/above which shipping is free. */
  freeOverCents?: number
  /** price_tiers (upTo = subtotal cents) / weight_tiers (upTo = grams). */
  tiers?: ShippingTier[]
  /** carrier: the live rate's options (AGL-3612). */
  carrier?: CarrierRateSettings
  /**
   * flat + free_over: the price in another currency the store sells in
   * (AGL-4248), minor units keyed by ISO code. A currency not listed converts.
   */
  amountsByCurrency?: Record<string, number>
  /** free_over: the threshold in another currency (AGL-4248), minor units by ISO code. */
  freeOverByCurrency?: Record<string, number>
}

export interface ShippingSettings {
  zones?: ShippingZone[]
  rates?: ShippingRate[]
  /**
   * Offer free local pickup as a delivery choice. Does NOT widen where the
   * store ships: a destination no rate reaches is still refused (AGL-2325).
   */
  localPickup?: boolean
}

export interface ResolvedShippingRate {
  rateId: string
  name: string
  amountCents: number
}

/**
 * The rate id appended for local pickup (AGL-2325).
 *
 * Exported because pickup is the one entry in a resolved list that is NOT a
 * shipping promise: it is appended AFTER and INDEPENDENT of zone matching, so
 * it resolves for every destination on earth. Anything asking "does this store
 * ship there" — the checkout refusal, the console coverage card — has to be
 * able to tell it apart from a rate, or it reads a merchant who offers
 * collection as a merchant who delivers worldwide.
 */
export const LOCAL_PICKUP_RATE_ID = 'pickup'

/**
 * One stored country code, normalised (AGL-2298).
 *
 * TRIMMED as well as upper-cased. The console trims on save, so this only
 * matters for a document written any other way — an import, the REST API, a
 * hand edit — but the failure it produces is silent and expensive: `' US'`
 * upper-cases to `' US'`, matches nothing, and the store refuses every US
 * shopper with "This store does not ship to the United States" while its
 * settings card shows `US` right there.
 */
const zoneCode = (code: unknown): string => String(code ?? '').trim().toUpperCase()

/** Whether a stored code is the rest-of-world wildcard. */
const isWildcard = (code: unknown): boolean => zoneCode(code) === '*'

function zoneMatches(zone: ShippingZone, country: string): boolean {
  return (zone.countries ?? []).some(
    (code) => isWildcard(code) || zoneCode(code) === country,
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
 * The zones a destination falls in (AGL-1707, factored out for AGL-3612).
 * Specific country zones beat '*' zones: when any zone names the country
 * outright, rest-of-world zones are ignored.
 */
export function matchedZoneIds(
  settings: ShippingSettings | undefined,
  destinationCountry: string,
): Set<string> {
  const country = destinationCountry.toUpperCase()
  const zones = settings?.zones ?? []
  // A zone is SPECIFIC when it names this country outright — not merely when
  // it is "not wildcard-only" (AGL-2298). The old test was `!every(code ===
  // '*')`, so a zone spelled `['*','US']` counted as specific for all six
  // destinations (it matches every country through the `*`) and suppressed
  // every genuine rest-of-world zone globally. Asking the narrower question
  // makes such a zone specific for `US` and wildcard for the rest, which is
  // what its two entries actually say.
  const specific = zones.filter((zone) =>
    (zone.countries ?? []).some((code) => zoneCode(code) === country),
  )
  const matched = specific.length
    ? specific
    : zones.filter((zone) => zoneMatches(zone, country))
  return new Set(matched.map((zone) => zone.id))
}

/** The live carrier rates a destination's zones carry (AGL-3612). */
export function carrierRatesFor(
  settings: ShippingSettings | undefined,
  destinationCountry: string,
): ShippingRate[] {
  if (!settings) return []
  const zoneIds = matchedZoneIds(settings, destinationCountry)
  return (settings.rates ?? []).filter(
    (rate) => rate.kind === 'carrier' && zoneIds.has(rate.zoneId),
  )
}

/** Whether any zone carries a live carrier rate (AGL-3612). */
export function hasCarrierRates(settings: ShippingSettings | undefined): boolean {
  return (settings?.rates ?? []).some((rate) => rate.kind === 'carrier')
}

/** The rate id a quoted service is offered under: stable per rate and service. */
export function carrierOptionRateId(rateId: string, serviceKey: string): string {
  return `carrier:${rateId}:${serviceKey}`
}

/**
 * What a shopper pays for a carrier's quote under one carrier rate: the
 * quote, plus the markup, plus the handling fee, in whole cents.
 */
export function carrierOptionAmountCents(
  quotedCents: number,
  settings: CarrierRateSettings | undefined,
): number {
  const quote = Math.max(0, Math.round(Number(quotedCents) || 0))
  const pct = Number(settings?.markupPct)
  const handling = Number(settings?.handlingCents)
  return (
    quote +
    (Number.isFinite(pct) && pct > 0 ? Math.round((quote * Math.min(pct, 500)) / 100) : 0) +
    (Number.isFinite(handling) && handling > 0 ? Math.round(handling) : 0)
  )
}

/**
 * Rates available for a destination + cart, cheapest first. Specific
 * country zones beat '*' zones: when any specific zone matches, '*'
 * zones are ignored (rest-of-world semantics).
 *
 * Local pickup is appended AFTER and INDEPENDENT of zone matching, so this
 * list is never empty for a merchant who offers it, at any destination. That
 * is correct for a resolver — a shopper anywhere may choose to come and
 * collect — but it means A NON-EMPTY RESULT IS NOT A PROMISE TO SHIP THERE.
 * Callers deciding whether a destination is served must filter pickup out
 * first; `planCheckoutShipping` and `summarizeShippingCoverage` do (AGL-2325).
 */
export function resolveShippingRates(
  settings: ShippingSettings | undefined,
  destinationCountry: string | undefined,
  cart: { subtotalCents: number; totalGrams?: number },
): ResolvedShippingRate[] {
  if (!settings || !destinationCountry) return []
  const zoneIds = matchedZoneIds(settings, destinationCountry)
  // A zone is SPECIFIC when it names this country outright — not merely when
  // it is "not wildcard-only" (AGL-2298). The old test was `!every(code ===
  // '*')`, so a zone spelled `['*','US']` counted as specific for all six
  // destinations (it matches every country through the `*`) and suppressed
  // every genuine rest-of-world zone globally. Asking the narrower question
  // makes such a zone specific for `US` and wildcard for the rest, which is
  // what its two entries actually say.
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
      // A carrier's price exists only once a carrier quoted it for an
      // address (AGL-3612), so a table read offers nothing for it and its
      // fallback rate is what resolves here. `carrier-shipping.ts` adds the
      // quotes where one can be had.
      case 'carrier':
        break
    }
    if (amountCents == null) continue
    resolved.push({ rateId: rate.id, name: rate.name, amountCents })
  }
  if (settings.localPickup) {
    resolved.push({
      rateId: LOCAL_PICKUP_RATE_ID,
      name: 'Local pickup',
      amountCents: 0,
    })
  }
  return resolved.sort((a, b) => a.amountCents - b.amountCents)
}

/**
 * The resolved options that actually carry a parcel (AGL-2325).
 *
 * Safe to apply AFTER `MAX_CHECKOUT_SHIPPING_OPTIONS` truncation: pickup is
 * 0¢ and sorts first, so it occupies at most one of the five slots and a
 * merchant with any shippable rate at all keeps at least one of them.
 */
function shippableOnly(
  options: readonly ResolvedShippingRate[],
): ResolvedShippingRate[] {
  return options.filter((option) => option.rateId !== LOCAL_PICKUP_RATE_ID)
}

/** Stripe Checkout accepts at most 5 `shipping_options` on one session. */
export const MAX_CHECKOUT_SHIPPING_OPTIONS = 5

/**
 * The destinations a Checkout Session collects an address for when the
 * merchant prices NO shipping (AGL-1707), and so the session such a store has
 * always had. A merchant with zones gets `checkoutShippingCountries` instead:
 * the countries their zones name, or every country for rest of world.
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

/**
 * {@link CHECKOUT_SHIPPING_COUNTRIES} as plain codes: the apps' draft order
 * falls back to it only when the server names no list (AGL-3841).
 */
export const CHECKOUT_SHIPPING_COUNTRY_CODES: readonly string[] = CHECKOUT_SHIPPING_COUNTRIES

/**
 * Every country Stripe Checkout can collect a shipping address for
 * (`shipping_address_collection[allowed_countries]`), with the name a shopper
 * reads. A rest-of-world `*` zone opens checkout to all of them.
 */
export const CHECKOUT_SHIPPING_COUNTRY_NAMES: Readonly<Record<string, string>> =
  {
    AC: "Ascension Island",
    AD: "Andorra",
    AE: "United Arab Emirates",
    AF: "Afghanistan",
    AG: "Antigua & Barbuda",
    AI: "Anguilla",
    AL: "Albania",
    AM: "Armenia",
    AO: "Angola",
    AQ: "Antarctica",
    AR: "Argentina",
    AT: "Austria",
    AU: "Australia",
    AW: "Aruba",
    AX: "Åland Islands",
    AZ: "Azerbaijan",
    BA: "Bosnia & Herzegovina",
    BB: "Barbados",
    BD: "Bangladesh",
    BE: "Belgium",
    BF: "Burkina Faso",
    BG: "Bulgaria",
    BH: "Bahrain",
    BI: "Burundi",
    BJ: "Benin",
    BL: "St. Barthélemy",
    BM: "Bermuda",
    BN: "Brunei",
    BO: "Bolivia",
    BQ: "Caribbean Netherlands",
    BR: "Brazil",
    BS: "Bahamas",
    BT: "Bhutan",
    BV: "Bouvet Island",
    BW: "Botswana",
    BY: "Belarus",
    BZ: "Belize",
    CA: "Canada",
    CD: "Congo - Kinshasa",
    CF: "Central African Republic",
    CG: "Congo - Brazzaville",
    CH: "Switzerland",
    CI: "Côte d’Ivoire",
    CK: "Cook Islands",
    CL: "Chile",
    CM: "Cameroon",
    CN: "China",
    CO: "Colombia",
    CR: "Costa Rica",
    CV: "Cape Verde",
    CW: "Curaçao",
    CY: "Cyprus",
    CZ: "Czechia",
    DE: "Germany",
    DJ: "Djibouti",
    DK: "Denmark",
    DM: "Dominica",
    DO: "Dominican Republic",
    DZ: "Algeria",
    EC: "Ecuador",
    EE: "Estonia",
    EG: "Egypt",
    EH: "Western Sahara",
    ER: "Eritrea",
    ES: "Spain",
    ET: "Ethiopia",
    FI: "Finland",
    FJ: "Fiji",
    FK: "Falkland Islands",
    FO: "Faroe Islands",
    FR: "France",
    GA: "Gabon",
    GB: "United Kingdom",
    GD: "Grenada",
    GE: "Georgia",
    GF: "French Guiana",
    GG: "Guernsey",
    GH: "Ghana",
    GI: "Gibraltar",
    GL: "Greenland",
    GM: "Gambia",
    GN: "Guinea",
    GP: "Guadeloupe",
    GQ: "Equatorial Guinea",
    GR: "Greece",
    GS: "South Georgia & South Sandwich Islands",
    GT: "Guatemala",
    GU: "Guam",
    GW: "Guinea-Bissau",
    GY: "Guyana",
    HK: "Hong Kong SAR China",
    HN: "Honduras",
    HR: "Croatia",
    HT: "Haiti",
    HU: "Hungary",
    ID: "Indonesia",
    IE: "Ireland",
    IL: "Israel",
    IM: "Isle of Man",
    IN: "India",
    IO: "British Indian Ocean Territory",
    IQ: "Iraq",
    IS: "Iceland",
    IT: "Italy",
    JE: "Jersey",
    JM: "Jamaica",
    JO: "Jordan",
    JP: "Japan",
    KE: "Kenya",
    KG: "Kyrgyzstan",
    KH: "Cambodia",
    KI: "Kiribati",
    KM: "Comoros",
    KN: "St. Kitts & Nevis",
    KR: "South Korea",
    KW: "Kuwait",
    KY: "Cayman Islands",
    KZ: "Kazakhstan",
    LA: "Laos",
    LB: "Lebanon",
    LC: "St. Lucia",
    LI: "Liechtenstein",
    LK: "Sri Lanka",
    LR: "Liberia",
    LS: "Lesotho",
    LT: "Lithuania",
    LU: "Luxembourg",
    LV: "Latvia",
    LY: "Libya",
    MA: "Morocco",
    MC: "Monaco",
    MD: "Moldova",
    ME: "Montenegro",
    MF: "St. Martin",
    MG: "Madagascar",
    MK: "North Macedonia",
    ML: "Mali",
    MM: "Myanmar (Burma)",
    MN: "Mongolia",
    MO: "Macao SAR China",
    MQ: "Martinique",
    MR: "Mauritania",
    MS: "Montserrat",
    MT: "Malta",
    MU: "Mauritius",
    MV: "Maldives",
    MW: "Malawi",
    MX: "Mexico",
    MY: "Malaysia",
    MZ: "Mozambique",
    NA: "Namibia",
    NC: "New Caledonia",
    NE: "Niger",
    NG: "Nigeria",
    NI: "Nicaragua",
    NL: "Netherlands",
    NO: "Norway",
    NP: "Nepal",
    NR: "Nauru",
    NU: "Niue",
    NZ: "New Zealand",
    OM: "Oman",
    PA: "Panama",
    PE: "Peru",
    PF: "French Polynesia",
    PG: "Papua New Guinea",
    PH: "Philippines",
    PK: "Pakistan",
    PL: "Poland",
    PM: "St. Pierre & Miquelon",
    PN: "Pitcairn Islands",
    PR: "Puerto Rico",
    PS: "Palestinian Territories",
    PT: "Portugal",
    PY: "Paraguay",
    QA: "Qatar",
    RE: "Réunion",
    RO: "Romania",
    RS: "Serbia",
    RU: "Russia",
    RW: "Rwanda",
    SA: "Saudi Arabia",
    SB: "Solomon Islands",
    SC: "Seychelles",
    SE: "Sweden",
    SG: "Singapore",
    SH: "St. Helena",
    SI: "Slovenia",
    SJ: "Svalbard & Jan Mayen",
    SK: "Slovakia",
    SL: "Sierra Leone",
    SM: "San Marino",
    SN: "Senegal",
    SO: "Somalia",
    SR: "Suriname",
    SS: "South Sudan",
    ST: "São Tomé & Príncipe",
    SV: "El Salvador",
    SX: "Sint Maarten",
    SZ: "Eswatini",
    TA: "Tristan da Cunha",
    TC: "Turks & Caicos Islands",
    TD: "Chad",
    TF: "French Southern Territories",
    TG: "Togo",
    TH: "Thailand",
    TJ: "Tajikistan",
    TK: "Tokelau",
    TL: "Timor-Leste",
    TM: "Turkmenistan",
    TN: "Tunisia",
    TO: "Tonga",
    TR: "Türkiye",
    TT: "Trinidad & Tobago",
    TV: "Tuvalu",
    TW: "Taiwan",
    TZ: "Tanzania",
    UA: "Ukraine",
    UG: "Uganda",
    US: "United States",
    UY: "Uruguay",
    UZ: "Uzbekistan",
    VA: "Vatican City",
    VC: "St. Vincent & Grenadines",
    VE: "Venezuela",
    VG: "British Virgin Islands",
    VN: "Vietnam",
    VU: "Vanuatu",
    WF: "Wallis & Futuna",
    WS: "Samoa",
    XK: "Kosovo",
    YE: "Yemen",
    YT: "Mayotte",
    ZA: "South Africa",
    ZM: "Zambia",
    ZW: "Zimbabwe",
  }

/** {@link CHECKOUT_SHIPPING_COUNTRY_NAMES}' codes, in order. */
export const STRIPE_SHIPPING_COUNTRY_CODES: readonly string[] = Object.keys(
  CHECKOUT_SHIPPING_COUNTRY_NAMES,
)

/**
 * The countries ONE merchant's checkout collects an address for: the
 * destinations their own zones name (international selling).
 *
 * `CHECKOUT_SHIPPING_COUNTRIES` used to be the only list, so a shopper in New
 * Zealand, Ireland or any EU country but Germany and France could not enter an
 * address at all, whatever zones the merchant saved. Now:
 *
 * - every country a zone names, in the order the merchant wrote them;
 * - every Stripe-collectable country when a zone claims rest of world (`*`);
 * - today's six for a merchant who prices no shipping (no zones and rates, or
 *   pickup only), so a store that never set shipping up keeps the session it
 *   has today, byte for byte.
 *
 * The AGL-1721 rule is unchanged, because `planCheckoutShipping` still pairs
 * this list with the options it unions over it.
 */
export function checkoutShippingCountries(
  settings: ShippingSettings | undefined,
): readonly string[] {
  if (!merchantPricesShipping(settings) || !settings?.zones?.length) {
    return CHECKOUT_SHIPPING_COUNTRIES
  }
  const named: string[] = []
  for (const zone of settings.zones) {
    for (const raw of zone.countries ?? []) {
      const code = String(raw).trim().toUpperCase()
      if (code === '*') return STRIPE_SHIPPING_COUNTRY_CODES
      if (code in CHECKOUT_SHIPPING_COUNTRY_NAMES && !named.includes(code)) {
        named.push(code)
      }
    }
  }
  return named.length ? named : CHECKOUT_SHIPPING_COUNTRIES
}

/**
 * A destination a shopper declared, or `undefined` for anything this session
 * could not collect an address for anyway. Never throws: an unknown code is
 * an undeclared destination, not an error, so a stale storefront that posts
 * one is answered by the plan below rather than by a 400 nobody can act on.
 */
export function normalizeCheckoutShippingCountry(
  value: unknown,
  countries: readonly string[] = STRIPE_SHIPPING_COUNTRY_CODES,
): string | undefined {
  // `typeof` rather than `String(value)`: a JSON body is caller-shaped, and
  // `String(['US'])` is 'US'. Coercing would let an array declare a
  // destination, which is not a spelling any storefront sends.
  if (typeof value !== 'string') return undefined
  const code = value.trim().toUpperCase()
  return countries.includes(code) ? code : undefined
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
   * - `cart-unpriceable` — the merchant priced shipping, but no rate of theirs
   *   resolves for THIS cart at ANY destination (AGL-2232). A tier table that
   *   stops at 2 kg says nothing about a 3 kg parcel, and the honest answer is
   *   to refuse rather than to ship it for nothing.
   */
  refusal?: 'destination-required' | 'destination-unserved' | 'cart-unpriceable'
}

/**
 * Whether this merchant prices shipping AT ALL (AGL-2232).
 *
 * A pure question about the SETTINGS, deliberately taking no cart, and that is
 * the whole point of it existing. `planCheckoutShipping` used to ask "does any
 * rate resolve for any destination?" and pass the live cart into the probe, so
 * a cart that exhausted every tier made the probe empty too — and an empty
 * probe reads as "this merchant never set shipping up", the one case that must
 * complete with no `shipping_options` and nothing charged. A 3 kg order at a
 * store whose weight tiers stop at 2 kg therefore shipped free, silently, on
 * every one of the three doors.
 *
 * Answered from the stored zones and rates instead: a rate bound to a zone
 * that exists, or local pickup, means the merchant made a shipping decision
 * and a cart their table cannot price is a REFUSAL. A merchant with no zones,
 * no rates and no pickup has made no such decision, and their session stays
 * byte-identical to the one AGL-1707 shipped.
 */
export function merchantPricesShipping(
  settings: ShippingSettings | undefined,
): boolean {
  if (!settings) return false
  if (settings.localPickup) return true
  const zoneIds = new Set((settings.zones ?? []).map((zone) => zone.id))
  // A rate whose `zoneId` names no zone is unreachable by every resolver here,
  // so it is not evidence of a decision — counting it would refuse carts at a
  // store with nothing but orphaned rows.
  return (settings.rates ?? []).some((rate) => zoneIds.has(rate.zoneId))
}

/**
 * What a shopper is told when `cart-unpriceable` refuses (AGL-2232).
 *
 * One string, shared by all three doors, because the three used to phrase the
 * two existing refusals identically and drifting here would make the same
 * store say different things depending on which button was pressed. It names
 * the cart rather than the destination on purpose — a `Ship to` select cannot
 * fix a parcel no tier covers, so the refusal deliberately does NOT set
 * `needsShippingCountry`.
 */
export const CART_UNPRICEABLE_SHIPPING_MESSAGE =
  'This store cannot price shipping for this order — it falls outside every ' +
  'shipping rate the store has set up. Try removing an item, or contact the ' +
  'store.'

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
  const countries = checkoutShippingCountries(settings)
  // Any Stripe-collectable code counts as DECLARED, so a shopper naming a
  // country this store's zones do not reach is told it is not served rather
  // than asked again. Only a store whose list comes from its zones refuses
  // that way: one on the fallback list ships nowhere in particular, and an
  // outside code stays undeclared there exactly as it always was.
  const declared = normalizeCheckoutShippingCountry(destinationCountry)
  const fromZones = countries !== CHECKOUT_SHIPPING_COUNTRIES
  if (declared && !countries.includes(declared) && fromZones) {
    return { countries, options: [], refusal: 'destination-unserved' }
  }
  const destination =
    declared && countries.includes(declared) ? declared : undefined
  if (destination) {
    const options = resolveCheckoutShippingOptions(
      settings,
      [destination],
      cart,
    )
    // REFUSAL IS DECIDED ON SHIPPABLE RATES, PICKUP IS OFFERED AFTERWARDS
    // (AGL-2325). `resolveShippingRates` appends pickup independent of zone
    // matching, so a merchant who turned it on had a non-empty list for every
    // destination on earth and this branch returned before it could refuse
    // anyone: a shopper in France picked `Local pickup — Free` on a physical
    // order from a US-only store, Stripe collected their French address
    // because the session still allowed it, and the merchant was paid nothing
    // to carry the parcel there. Pickup is collection, not delivery, so it
    // cannot answer "do you ship to France".
    //
    // `shipsElsewhere` is the same question the old probe asked, narrowed to
    // shippable rates, and it keeps the same two-way fork: a merchant who
    // configured NO shipping is not refusing anyone, so that store keeps
    // completing exactly as it does today, while a merchant who ships
    // elsewhere but not here is refusing and saying so is the honest answer.
    // A merchant who ships NOWHERE is untouched by this: pickup-only is a
    // real configuration — they deliver to no one and refuse no one — and it
    // falls through to the offer below exactly as it did.
    const shipsElsewhere = countries.some(
      (country) =>
        shippableOnly(resolveCheckoutShippingOptions(settings, [country], cart))
          .length > 0,
    )
    if (shippableOnly(options).length === 0 && shipsElsewhere) {
      return { countries, options: [], refusal: 'destination-unserved' }
    }
    if (options.length > 0) return { countries: [destination], options }
    // NOTHING resolves anywhere for this cart, and the two reasons that can be
    // true of are opposite (AGL-2232). Asked of the SETTINGS rather than of
    // this cart, because the probe above cannot tell them apart: a merchant
    // who priced shipping and whose table simply does not reach this order is
    // refusing, and used to be handed the "never set shipping up" branch.
    return merchantPricesShipping(settings)
      ? { countries, options: [], refusal: 'cart-unpriceable' }
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
  const union = resolveCheckoutShippingOptions(settings, countries, cart)
  // Every destination agrees, and what they agree on is NOTHING. The same
  // fork as the declared-destination branch above (AGL-2232): a store with no
  // shipping settings completes untouched, a store whose rates cannot reach
  // this cart refuses instead of carrying the parcel for free.
  if (union.length === 0 && merchantPricesShipping(settings)) {
    return { countries, options: [], refusal: 'cart-unpriceable' }
  }
  return { countries, options: union }
}

/**
 * A cart chosen so that every rate a merchant could have written resolves if
 * it can resolve at all (AGL-1791). The settings page has no cart, and two of
 * the four rate kinds price against one: `tierAmount` takes the first tier
 * whose `upTo` is at least the value, so a zero subtotal and zero weight clear
 * every tier a merchant would write, and a `free_over` rate resolves at any
 * subtotal.
 *
 * That makes a coverage answer a LOWER BOUND on the gaps. A destination
 * reported unserved is unserved for every cart; a destination reported served
 * may still be refused for a cart dearer or heavier than the merchant's last
 * tier. Erring in this direction is the deliberate half: the console must not
 * warn a merchant whose settings are fine.
 */
const COVERAGE_PROBE_CART = { subtotalCents: 0, totalGrams: 0 }

/** What a merchant's saved zones and rates cost their shoppers (AGL-1791). */
export interface ShippingCoverage {
  /** How many destinations checkout collects an address for. */
  collectable: number
  /** Collectable destinations at least one rate reaches. */
  served: string[]
  /**
   * Collectable destinations CHECKOUT REFUSES — `destination-unserved`.
   *
   * EMPTY FOR A MERCHANT WHOSE RATES REACH NOWHERE, who is not misconfigured:
   * `planCheckoutShipping` refuses nobody when no rate resolves anywhere, so
   * that store charges no shipping and completes exactly as it always has.
   * The rule lives here rather than in the caller because reading `served`
   * against a bare partition is how a surface comes to warn every store that
   * does not ship.
   */
  unserved: string[]
  /** No rate reaches anywhere: no shipping is charged, and nobody refused. */
  shipsNowhere: boolean
  /**
   * Rates differ by destination, so the storefront asks the shopper where the
   * parcel is going before it can price one — a checkout step the merchant
   * added by saving these zones, and never chose.
   */
  asksDestination: boolean
  /** Some zone already claims rest of world, so `*` is not the missing piece. */
  hasRestOfWorldZone: boolean
  /**
   * The merchant offers local pickup, so checkout presents a free collection
   * choice at every destination it does not refuse (AGL-2325).
   *
   * Deliberately NOT folded into `served`: pickup resolves for every country
   * because it is appended independent of zone matching, so counting it as
   * coverage told a US-only merchant who had switched it on that checkout
   * "can price shipping to every destination", which is the sentence that
   * hid the defect. It is reported alongside instead, so the card can say
   * both true things: these destinations are refused, and pickup is offered
   * to the ones that are not.
   */
  offersLocalPickup: boolean
}

/**
 * Which of the collectable destinations a merchant's settings actually cover
 * (AGL-1791), for a console surface to show them.
 *
 * Measured against `checkoutShippingCountries(settings)` and nothing wider:
 * those are the only destinations this store's session collects an address
 * for, so they are the only ones a merchant can lose an order to.
 *
 * Answered through `resolveCheckoutShippingOptions` — the same function the
 * session is built from — so a row the console allows but Stripe would reject
 * (blank id, blank name) counts as the nothing it resolves to, and a specific
 * zone with no rates still hides a `*` zone here exactly as it does at
 * checkout.
 */
export function summarizeShippingCoverage(
  settings: ShippingSettings | undefined,
): ShippingCoverage {
  const served: string[] = []
  const unserved: string[] = []
  const offers = new Set<string>()
  const collectable = checkoutShippingCountries(settings)
  for (const country of collectable) {
    const options = resolveCheckoutShippingOptions(
      settings,
      [country],
      COVERAGE_PROBE_CART,
    )
    // `asksDestination` is asked of the FULL list — pickup is a real option a
    // shopper picks, so a merchant whose US destination offers a rate plus
    // pickup while France offers only pickup genuinely does make checkout ask.
    offers.add(optionsKey(options))
    // `served` is asked of the SHIPPABLE list, so that it answers the same
    // question `planCheckoutShipping` refuses on (AGL-2325).
    ;(shippableOnly(options).length > 0 ? served : unserved).push(country)
  }
  return {
    collectable: collectable.length,
    served,
    unserved: served.length > 0 ? unserved : [],
    shipsNowhere: served.length === 0,
    asksDestination: offers.size > 1,
    offersLocalPickup: Boolean(settings?.localPickup),
    hasRestOfWorldZone: (settings?.zones ?? []).some((zone) =>
      zone.countries.some((code) => code === '*'),
    ),
  }
}

/**
 * What the Shipping card says about a store's coverage, in words (AGL-1791): the warning's headline and body when checkout
 * turns destinations away, otherwise the one line that says what it covers, and the line that says checkout asks where the
 * parcel is going. The console card and the native apps both read these, so the same store reads the same everywhere.
 */
export interface ShippingCoverageWords {
  /** Set when destinations are turned away: the warning's title. */
  headline: string
  /** The warning's body; empty when nothing is turned away. */
  detail: string
  /** The caption shown when nothing is turned away; empty when something is. */
  note: string
  /** Shown when rates differ by destination; empty otherwise. */
  asks: string
}

/** Names, the first eight in full: a rest-of-world gap can be 200 countries. */
const coverageCountryNames = (codes: readonly string[]) => {
  const names = codes.map((code) => CHECKOUT_SHIPPING_COUNTRY_NAMES[code] ?? code)
  return names.length > 8
    ? `${names.slice(0, 8).join(', ')} and ${names.length - 8} more`
    : names.join(', ')
}

export function describeShippingCoverage(
  coverage: ShippingCoverage,
): ShippingCoverageWords {
  const asks = coverage.asksDestination
    ? 'Rates differ by destination, so checkout asks the shopper where the parcel is going before it can price one.'
    : ''
  if (coverage.unserved.length > 0) {
    return {
      headline: `Checkout turns away ${coverage.unserved.length} of the ${coverage.collectable} destinations it collects addresses for`,
      detail:
        `No rate reaches ${coverageCountryNames(coverage.unserved)}, so an order shipping there is refused rather than posted for free. ` +
        (coverage.offersLocalPickup
          ? 'Local pickup does not cover them: it is a collection choice, not a rate, so it is offered where checkout completes and closes no gap here. '
          : '') +
        (coverage.hasRestOfWorldZone
          ? 'A rest-of-world zone is already saved, so what those destinations are missing is a rate on the zone that covers them.'
          : 'Give them a zone with a rate, or add a rest-of-world zone and price one on it.'),
      note: '',
      asks,
    }
  }
  return {
    headline: '',
    detail: '',
    note: coverage.shipsNowhere
      ? coverage.offersLocalPickup
        ? 'No rate reaches any destination, so local pickup is the only delivery choice checkout offers. Nobody is turned away and no shipping is charged.'
        : 'No rate reaches any destination, so checkout charges no shipping and turns nobody away.'
      : coverage.hasRestOfWorldZone &&
          coverage.served.length === STRIPE_SHIPPING_COUNTRY_CODES.length
        ? 'Checkout can price shipping to every country it can collect an address for.'
        : `Checkout can price shipping to every destination it collects an address for: ${coverageCountryNames(coverage.served)}.`,
    asks,
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
