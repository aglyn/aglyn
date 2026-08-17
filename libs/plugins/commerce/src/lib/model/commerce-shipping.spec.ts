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
  CHECKOUT_SHIPPING_COUNTRIES,
  MAX_CHECKOUT_SHIPPING_OPTIONS,
  normalizeCheckoutShippingCountry,
  planCheckoutShipping,
  resolveCheckoutShippingOptions,
  resolveShippingRates,
  type ShippingSettings,
} from './commerce-shipping'

const settings: ShippingSettings = {
  zones: [
    { id: 'us', name: 'United States', countries: ['US'] },
    { id: 'world', name: 'Everywhere else', countries: ['*'] },
  ],
  rates: [
    { id: 'std', zoneId: 'us', name: 'Standard', kind: 'flat', amountCents: 799 },
    {
      id: 'free50',
      zoneId: 'us',
      name: 'Free over $50',
      kind: 'free_over',
      amountCents: 799,
      freeOverCents: 5000,
    },
    {
      id: 'wt',
      zoneId: 'us',
      name: 'By weight',
      kind: 'weight_tiers',
      tiers: [
        { upTo: 500, amountCents: 599 },
        { upTo: 2000, amountCents: 1299 },
      ],
    },
    {
      id: 'intl',
      zoneId: 'world',
      name: 'International',
      kind: 'price_tiers',
      tiers: [{ upTo: 100000, amountCents: 2999 }],
    },
  ],
}

describe('resolveShippingRates', () => {
  it('matches specific zones and hides rest-of-world for them', () => {
    const rates = resolveShippingRates(settings, 'US', {
      subtotalCents: 2000,
      totalGrams: 400,
    })
    expect(rates.map((rate) => rate.rateId)).toEqual(['wt', 'std', 'free50'])
    expect(rates.find((rate) => rate.rateId === 'wt')?.amountCents).toBe(599)
  })

  it('falls back to the rest-of-world zone', () => {
    const rates = resolveShippingRates(settings, 'FR', {
      subtotalCents: 2000,
    })
    expect(rates.map((rate) => rate.rateId)).toEqual(['intl'])
  })

  it('zeroes free_over rates past the threshold, sorts cheapest first', () => {
    const rates = resolveShippingRates(settings, 'US', {
      subtotalCents: 6000,
      totalGrams: 400,
    })
    expect(rates[0]).toMatchObject({ rateId: 'free50', amountCents: 0 })
  })

  it('drops tiered rates beyond the last tier', () => {
    const rates = resolveShippingRates(settings, 'US', {
      subtotalCents: 2000,
      totalGrams: 99999,
    })
    expect(rates.some((rate) => rate.rateId === 'wt')).toBe(false)
  })

  it('adds free local pickup when enabled', () => {
    const rates = resolveShippingRates(
      { ...settings, localPickup: true },
      'US',
      { subtotalCents: 2000, totalGrams: 100 },
    )
    expect(rates.some((rate) => rate.rateId === 'pickup')).toBe(true)
  })

  it('returns nothing without a destination or settings', () => {
    expect(resolveShippingRates(settings, undefined, { subtotalCents: 1 }))
      .toEqual([])
    expect(resolveShippingRates(undefined, 'US', { subtotalCents: 1 }))
      .toEqual([])
  })
})

/**
 * The Stripe Checkout adapter (AGL-1707): the rates for a GIVEN set of
 * destinations, unioned. Honest only over destinations the session is also
 * restricted to, which is `planCheckoutShipping`'s job below.
 */
describe('resolveCheckoutShippingOptions', () => {
  const countries = ['US', 'CA', 'GB', 'AU', 'DE', 'FR']

  it('offers nothing for a merchant who configured nothing', () => {
    // The load-bearing case: this is what keeps a session for an
    // unconfigured merchant identical to the pre-AGL-1707 one.
    expect(
      resolveCheckoutShippingOptions(undefined, countries, {
        subtotalCents: 2000,
      }),
    ).toEqual([])
    expect(
      resolveCheckoutShippingOptions({}, countries, { subtotalCents: 2000 }),
    ).toEqual([])
    expect(
      resolveCheckoutShippingOptions({ zones: [], rates: [] }, countries, {
        subtotalCents: 2000,
      }),
    ).toEqual([])
  })

  it('unions every zone the collectable destinations reach', () => {
    const options = resolveCheckoutShippingOptions(settings, countries, {
      subtotalCents: 2000,
      totalGrams: 400,
    })
    // `intl` belongs to the '*' zone, which only CA/GB/AU/DE/FR reach, and
    // the three `us` rates only US reaches. All four have to be present or a
    // shopper in one of those groups is charged nothing.
    // Cheapest first; `free50` and `std` tie at 799 and break by rate id.
    expect(options.map((option) => option.rateId)).toEqual([
      'wt',
      'free50',
      'std',
      'intl',
    ])
    expect(options.map((option) => option.amountCents)).toEqual([
      599, 799, 799, 2999,
    ])
  })

  it('prices free_over and weight tiers off the cart it is given', () => {
    const free = resolveCheckoutShippingOptions(settings, ['US'], {
      subtotalCents: 6000,
      totalGrams: 400,
    })
    expect(free.find((option) => option.rateId === 'free50')?.amountCents).toBe(
      0,
    )
    // The heavier tier, which only applies because totalGrams is real. A cart
    // weight of 0 would quote 599 here.
    const heavy = resolveCheckoutShippingOptions(settings, ['US'], {
      subtotalCents: 2000,
      totalGrams: 1500,
    })
    expect(heavy.find((option) => option.rateId === 'wt')?.amountCents).toBe(
      1299,
    )
  })

  it('dedupes one rate reached from several destinations', () => {
    const worldOnly: ShippingSettings = {
      zones: [{ id: 'world', name: 'Everywhere', countries: ['*'] }],
      rates: [
        {
          id: 'flat',
          zoneId: 'world',
          name: 'Standard',
          kind: 'flat',
          amountCents: 500,
        },
      ],
    }
    const options = resolveCheckoutShippingOptions(worldOnly, countries, {
      subtotalCents: 2000,
    })
    expect(options).toEqual([
      { rateId: 'flat', name: 'Standard', amountCents: 500 },
    ])
  })

  it('offers local pickup exactly once', () => {
    const options = resolveCheckoutShippingOptions(
      { ...settings, localPickup: true },
      countries,
      { subtotalCents: 2000, totalGrams: 400 },
    )
    expect(
      options.filter((option) => option.rateId === 'pickup'),
    ).toHaveLength(1)
    expect(options[0]).toMatchObject({ rateId: 'pickup', amountCents: 0 })
  })

  it('skips rows the console allows but Stripe would reject', () => {
    const ragged: ShippingSettings = {
      zones: [{ id: 'us', name: 'US', countries: ['US'] }],
      rates: [
        { id: '', zoneId: 'us', name: 'No id', kind: 'flat', amountCents: 100 },
        { id: 'noname', zoneId: 'us', name: '', kind: 'flat', amountCents: 200 },
        { id: 'ok', zoneId: 'us', name: 'Fine', kind: 'flat', amountCents: 300 },
      ],
    }
    expect(
      resolveCheckoutShippingOptions(ragged, ['US'], { subtotalCents: 1 }).map(
        (option) => option.rateId,
      ),
    ).toEqual(['ok'])
  })

  it('caps at Stripe’s limit, keeping the cheapest', () => {
    const many: ShippingSettings = {
      zones: [{ id: 'us', name: 'US', countries: ['US'] }],
      rates: Array.from({ length: 8 }, (_unused, index) => ({
        id: `r${index}`,
        zoneId: 'us',
        name: `Rate ${index}`,
        kind: 'flat' as const,
        amountCents: (index + 1) * 100,
      })),
    }
    const options = resolveCheckoutShippingOptions(many, ['US'], {
      subtotalCents: 1,
    })
    expect(options).toHaveLength(MAX_CHECKOUT_SHIPPING_OPTIONS)
    expect(options.map((option) => option.amountCents)).toEqual([
      100, 200, 300, 400, 500,
    ])
  })
})

/**
 * Which destinations one session may serve, and at which rates (AGL-1721).
 *
 * THE PROPERTY UNDER TEST IS A PAIRING, not a filter: every option returned
 * has to be valid for every country returned. Stripe charges whichever
 * `shipping_options` entry the shopper picks and never compares it to the
 * address — a `shipping_rate_data` has no country — so a plan that narrowed
 * only the rates would still let a French address take a US rate.
 */
describe('planCheckoutShipping', () => {
  const cart = { subtotalCents: 2000, totalGrams: 400 }

  /** The invariant, checked directly rather than assumed. */
  function everyOptionServesEveryCountry(
    settings: ShippingSettings | undefined,
    plan: ReturnType<typeof planCheckoutShipping>,
  ) {
    return plan.countries.every((country) => {
      const reachable = new Set(
        resolveCheckoutShippingOptions(settings, [country], cart).map(
          (option) => `${option.rateId}:${option.amountCents}`,
        ),
      )
      return plan.options.every((option) =>
        reachable.has(`${option.rateId}:${option.amountCents}`),
      )
    })
  }

  it('refuses rather than union when the rates differ by destination', () => {
    // The AGL-1721 configuration: US at 799, rest-of-world at 2999. The old
    // adapter returned both for a session that accepted either address.
    const plan = planCheckoutShipping(settings, cart)
    expect(plan.refusal).toBe('destination-required')
    expect(plan.options).toEqual([])
    expect(everyOptionServesEveryCountry(settings, plan)).toBe(true)
  })

  it('pairs a declared destination with a session restricted to it', () => {
    const us = planCheckoutShipping(settings, cart, 'US')
    expect(us.refusal).toBeUndefined()
    expect(us.countries).toEqual(['US'])
    expect(us.options.map((option) => option.rateId)).toEqual([
      'wt',
      'free50',
      'std',
    ])
    expect(everyOptionServesEveryCountry(settings, us)).toBe(true)

    const fr = planCheckoutShipping(settings, cart, 'fr')
    expect(fr.countries).toEqual(['FR'])
    expect(fr.options.map((option) => option.rateId)).toEqual(['intl'])
    expect(everyOptionServesEveryCountry(settings, fr)).toBe(true)
  })

  it('keeps every collectable country when one rate set serves them all', () => {
    // The configuration AGL-1721 calls invisible — a single '*' zone — plus
    // the merchant who configured nothing. Neither may be asked anything, and
    // the second must keep producing a session with no shipping on it at all.
    const worldOnly: ShippingSettings = {
      zones: [{ id: 'world', name: 'Everywhere', countries: ['*'] }],
      rates: [
        {
          id: 'flat',
          zoneId: 'world',
          name: 'Standard',
          kind: 'flat',
          amountCents: 500,
        },
      ],
    }
    const wide = planCheckoutShipping(worldOnly, cart)
    expect(wide.refusal).toBeUndefined()
    expect(wide.countries).toEqual([...CHECKOUT_SHIPPING_COUNTRIES])
    expect(wide.options.map((option) => option.rateId)).toEqual(['flat'])
    expect(everyOptionServesEveryCountry(worldOnly, wide)).toBe(true)

    for (const empty of [undefined, {}, { zones: [], rates: [] }]) {
      const plan = planCheckoutShipping(empty, cart)
      expect(plan.refusal).toBeUndefined()
      expect(plan.options).toEqual([])
      expect(plan.countries).toEqual([...CHECKOUT_SHIPPING_COUNTRIES])
    }
  })

  it('refuses a destination the merchant prices no rate for', () => {
    const usOnly: ShippingSettings = {
      zones: [{ id: 'us', name: 'US', countries: ['US'] }],
      rates: [
        {
          id: 'std',
          zoneId: 'us',
          name: 'Standard',
          kind: 'flat',
          amountCents: 799,
        },
      ],
    }
    expect(planCheckoutShipping(usOnly, cart, 'FR').refusal).toBe(
      'destination-unserved',
    )
    // …but a merchant who prices NOTHING anywhere is refusing nobody: that
    // store charges no shipping and has to keep completing.
    expect(planCheckoutShipping({}, cart, 'FR')).toEqual({
      countries: [...CHECKOUT_SHIPPING_COUNTRIES],
      options: [],
    })
  })

  it('treats a destination it cannot collect an address for as undeclared', () => {
    // Not an error: a country outside the collectable list cannot be entered
    // at Stripe either, so it falls through to the ambiguity question rather
    // than to a session narrowed to somewhere unreachable.
    for (const value of [
      'JP',
      '',
      '  ',
      'USA',
      null,
      42,
      ['US'],
      { code: 'US' },
    ]) {
      expect(normalizeCheckoutShippingCountry(value)).toBeUndefined()
      expect(planCheckoutShipping(settings, cart, value).refusal).toBe(
        'destination-required',
      )
    }
    expect(normalizeCheckoutShippingCountry(' us ')).toBe('US')
  })

  it('does not ask over a difference past Stripe’s cap', () => {
    // Both zones offer the same cheapest five; they diverge only in rates the
    // session could never carry. Asking the shopper there would cost a sale
    // to settle a question with no visible answer.
    const deep: ShippingSettings = {
      zones: [
        { id: 'us', name: 'US', countries: ['US'] },
        { id: 'world', name: 'Everywhere else', countries: ['*'] },
      ],
      rates: [
        ...Array.from({ length: 6 }, (_unused, index) => ({
          id: `shared${index}`,
          zoneId: 'us',
          name: `Shared ${index}`,
          kind: 'flat' as const,
          amountCents: (index + 1) * 100,
        })),
        ...Array.from({ length: 6 }, (_unused, index) => ({
          id: `shared${index}`,
          zoneId: 'world',
          name: `Shared ${index}`,
          kind: 'flat' as const,
          amountCents: (index + 1) * 100,
        })),
        {
          id: 'usDeep',
          zoneId: 'us',
          name: 'Freight',
          kind: 'flat',
          amountCents: 90000,
        },
      ],
    }
    const plan = planCheckoutShipping(deep, cart)
    expect(plan.refusal).toBeUndefined()
    expect(plan.options).toHaveLength(MAX_CHECKOUT_SHIPPING_OPTIONS)
    expect(everyOptionServesEveryCountry(deep, plan)).toBe(true)
  })
})
