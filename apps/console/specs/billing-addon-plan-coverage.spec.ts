/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored and the suite runs on jsdom.
 *
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
 * A paying Scale/Agency org was written back with ZERO seat add-ons
 * (AGL-1340).
 *
 * `PAID_PLANS` was a hand-written literal that predated the Pricing v3 tiers:
 * `['starter', 'pro', 'business', 'advanced']`. `addonPriceId()` only
 * uppercases the plan, so BUYING a Scale/Agency add-on worked — the failure was
 * entirely on the read-back, where `addonKindFromPriceId()` recognised none of
 * those prices and `addonQuantitiesFromItems()` therefore answered all zeros.
 * The webhook merges that answer onto the org as `seatAddons`, which is an
 * ENTITLEMENT INPUT, so the highest-paying customers silently lost every host,
 * seat, collaborator and dataset they had bought.
 *
 * The second half pins the identification of the base plan item, which used to
 * be "whatever no add-on price claims" — by elimination, so any unexpected item
 * (the metered price, a grandfathered SKU, something added in the Stripe
 * dashboard) could be re-priced as if it were the plan.
 */

import { SELF_SERVE_PLANS, type OrgPlan } from '@aglyn/aglyn/server'
import {
  addonKindFromPriceId,
  addonQuantitiesFromItems,
  findPlanItem,
  PAID_PLANS,
  planFromPriceId,
} from '../utils/server/billing-addons'

/**
 * Fake, obviously-not-real price ids. Set on `process.env` here rather than
 * read from any `.env` file — `nx test` leaks the repo root env, and a spec
 * that silently depended on the developer's Stripe config would pass or fail
 * by machine.
 */
const PRICE_ENV: Record<string, string> = {}
for (const plan of ['STARTER', 'PRO', 'BUSINESS', 'SCALE', 'ADVANCED', 'AGENCY']) {
  PRICE_ENV[`STRIPE_PRICE_${plan}`] = `price_${plan.toLowerCase()}`
  PRICE_ENV[`STRIPE_PRICE_${plan}_YEARLY`] = `price_${plan.toLowerCase()}_yearly`
  for (const suffix of ['EXTRA_SEAT', 'EXTRA_MEMBER', 'EXTRA_DATASET', 'EXTRA_HOST']) {
    const base = `price_${plan.toLowerCase()}_${suffix.toLowerCase()}`
    PRICE_ENV[`STRIPE_PRICE_${plan}_${suffix}`] = base
    PRICE_ENV[`STRIPE_PRICE_${plan}_${suffix}_YEARLY`] = `${base}_yearly`
  }
}
PRICE_ENV['STRIPE_PRICE_POS_REGISTER'] = 'price_pos_register'
PRICE_ENV['STRIPE_PRICE_POS_REGISTER_YEARLY'] = 'price_pos_register_yearly'
PRICE_ENV['STRIPE_PRICE_EVENT_CALENDAR'] = 'price_event_calendar'
PRICE_ENV['STRIPE_PRICE_EVENT_CALENDAR_YEARLY'] = 'price_event_calendar_yearly'
PRICE_ENV['STRIPE_PRICE_METERED'] = 'price_metered_usage'

const ORIGINAL_ENV = process.env

beforeEach(() => {
  const clean = { ...ORIGINAL_ENV }
  for (const key of Object.keys(clean)) {
    if (key.startsWith('STRIPE_PRICE_')) delete clean[key]
  }
  process.env = { ...clean, ...PRICE_ENV }
})

afterEach(() => {
  process.env = ORIGINAL_ENV
})

/** A subscription item as Stripe sends it, trimmed to what we read. */
const item = (priceId: string, quantity?: number, interval = 'month') => ({
  id: `si_${priceId}`,
  price: { id: priceId, recurring: { interval } },
  ...(quantity === undefined ? {} : { quantity }),
})

describe('PAID_PLANS covers every plan that is actually sold (AGL-1340)', () => {
  it('is derived, so a new tier cannot be added to the ladder and forgotten here', () => {
    // Asserted at the DECLARATION, not through one sampled behaviour: the
    // literal this replaced looked complete for two tiers' worth of releases.
    const sellable = SELF_SERVE_PLANS.filter((plan) => plan !== 'free')
    expect([...PAID_PLANS]).toEqual(sellable)
    // The exact regression: both Pricing v3 tiers, by name.
    expect(PAID_PLANS).toContain('scale')
    expect(PAID_PLANS).toContain('agency')
    // …and nothing that has no Stripe price to sell.
    expect(PAID_PLANS).not.toContain('free')
    expect(PAID_PLANS).not.toContain('enterprise')
  })

  it.each(['scale', 'agency'] as OrgPlan[])(
    'round-trips a %s subscription\'s seat add-ons instead of zeroing them',
    (plan) => {
      const prefix = `price_${plan}`
      const items = [
        item(`${prefix}`),
        item(`${prefix}_extra_seat`, 4),
        item(`${prefix}_extra_member`, 12),
        item(`${prefix}_extra_dataset`, 3),
        item(`${prefix}_extra_host`, 2),
        item('price_pos_register', 5),
        item('price_event_calendar', 1),
      ]
      // The bug, precisely: every one of these was 0 before the fix, and the
      // webhook merged that onto the org doc as the truth.
      expect(addonQuantitiesFromItems(items)).toEqual({
        managers: 4,
        members: 12,
        datasets: 3,
        hosts: 2,
        posRegisters: 5,
        eventCalendar: 1,
      })
    },
  )

  it('recognises the yearly add-on variants too', () => {
    expect(addonKindFromPriceId('price_agency_extra_host_yearly')).toBe('hosts')
    expect(addonKindFromPriceId('price_scale_extra_seat_yearly')).toBe('managers')
  })

  it.each(['starter', 'pro', 'business', 'advanced'] as OrgPlan[])(
    'keeps working for %s — the plans the old literal did cover',
    (plan) => {
      expect(addonQuantitiesFromItems([
        item(`price_${plan}`),
        item(`price_${plan}_extra_host`, 7),
      ])).toMatchObject({ hosts: 7, managers: 0 })
    },
  )
})

describe('the base plan item is identified explicitly (AGL-1340)', () => {
  it('matches the plan price rather than eliminating the add-ons', () => {
    // Plan item LAST, so position cannot be what makes this pass.
    const plan = item('price_scale_yearly', undefined, 'year')
    const found = findPlanItem([
      item('price_scale_extra_host_yearly', 2, 'year'),
      item('price_pos_register_yearly', 1, 'year'),
      plan,
    ])
    expect(found).toBe(plan)
    expect(planFromPriceId(found?.price?.id)).toBe('scale')
  })

  it('never mistakes the metered item for the plan', () => {
    // The old predicate picked this: no add-on price claims the metered
    // price, so `items.find(i => !addonKindFromPriceId(...))` returned it —
    // and the caller then read the subscription's billing INTERVAL off a
    // monthly metered item, and re-priced it as if it were the plan.
    const plan = item('price_agency_yearly', undefined, 'year')
    const items = [item('price_metered_usage', undefined, 'month'), plan]
    expect(findPlanItem(items)).toBe(plan)
    expect(findPlanItem(items)?.price?.recurring?.interval).toBe('year')
  })

  it('is not derailed by an item nothing recognises', () => {
    // A grandfathered v1 SKU, a dashboard-added line, a plugin's own price.
    const plan = item('price_business')
    const found = findPlanItem([
      item('price_unrecognised_by_anything', 1),
      plan,
      item('price_business_extra_dataset', 2),
    ])
    expect(found).toBe(plan)
    // And it must not be counted as an add-on either — an unknown price
    // contributing to a kind would inflate an entitlement.
    expect(addonQuantitiesFromItems([
      item('price_unrecognised_by_anything', 9),
      item('price_business_extra_dataset', 2),
    ])).toEqual({
      managers: 0,
      members: 0,
      datasets: 2,
      hosts: 0,
      posRegisters: 0,
      eventCalendar: 0,
    })
  })

  it('still falls back for a subscription on a price we do not sell', () => {
    // An enterprise deal bills on an ad-hoc price (AGL-1110) and old
    // subscriptions predate the current SKUs. Those must keep resolving to a
    // real plan item — just never to an add-on or the metered item.
    const custom = item('price_bespoke_enterprise_deal')
    expect(findPlanItem([
      item('price_starter_extra_host', 1),
      item('price_metered_usage'),
      custom,
    ])).toBe(custom)
    expect(findPlanItem([])).toBeNull()
  })

  it('answers null for prices that sell no plan', () => {
    expect(planFromPriceId('price_metered_usage')).toBeNull()
    expect(planFromPriceId('price_scale_extra_host')).toBeNull()
    expect(planFromPriceId(undefined)).toBeNull()
  })
})
