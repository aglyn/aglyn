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
 * A plan change must not leave an org paying for capacity it cannot receive.
 *
 * `buildTargetItems` dropped add-on KINDS the target plan does not sell and
 * said so. It never looked at QUANTITIES. `checkSeatQuota` and
 * `checkDatasetQuota` then apply `Math.min(…, max)` at the point of USE, so an
 * org moving down kept a ten-seat line item and received five — the excess
 * discarded by a `Math.min` and invoiced in full, with nothing said anywhere.
 *
 * Of everything an entitlement gap can do, this is the one where the money
 * moves in our favour, which is why it is clamped rather than reported.
 *
 * Asserted on the ITEM the subscription will carry — the thing Stripe bills —
 * never on rendered output.
 */

export {}

import { buildTargetItems } from './billing-schedule'
import { addonMaxForPlan } from './billing-addons'

const ORIGINAL_ENV = process.env

/**
 * Real price ids for the kinds under test, so `addonKindFromPriceId` resolves
 * them. Without these the items fall through to `unrecognizedPriceIds` and
 * every assertion below would pass for the wrong reason.
 */
const ENV = {
  STRIPE_PRICE_STARTER: 'price_starter_monthly',
  STRIPE_PRICE_BUSINESS: 'price_business_monthly',
  // `managers` is priced PER PLAN as `STRIPE_PRICE_{PLAN}_EXTRA_SEAT`.
  STRIPE_PRICE_STARTER_EXTRA_SEAT: 'price_mgr_starter',
  STRIPE_PRICE_BUSINESS_EXTRA_SEAT: 'price_mgr_business',
}

function load() {
  jest.resetModules()
  process.env = { ...ORIGINAL_ENV, ...ENV } as NodeJS.ProcessEnv
  return {
    build: require('./billing-schedule').buildTargetItems as typeof buildTargetItems,
    maxFor: require('./billing-addons').addonMaxForPlan as typeof addonMaxForPlan,
  }
}

afterEach(() => {
  process.env = ORIGINAL_ENV
})

describe('a plan change clamps what it cannot deliver', () => {
  it('CONTROL — the fixture really is a recognised add-on', () => {
    // If the price id did not resolve to a kind it would be carried through
    // verbatim as unrecognised, and the clamp cases below would be vacuous.
    const { build } = load()
    const plan = build(
      [
        { price: { id: 'price_starter_monthly' }, quantity: 1 },
        { price: { id: 'price_mgr_starter' }, quantity: 2 },
      ],
      {
        targetPlan: 'business',
        targetInterval: 'month',
        targetPlanPrice: 'price_business_monthly',
        meteredPrice: null,
      },
    )
    expect(plan.unrecognizedPriceIds).toEqual([])
    expect(plan.items.some((i) => i.price === 'price_mgr_business')).toBe(true)
  })

  it('reduces the ITEM, so the invoice follows the delivery', () => {
    const { build, maxFor } = load()
    const ceiling = maxFor('managers', 'starter')
    // A quantity the smaller plan provably cannot deliver.
    const wanted = ceiling + 5
    const plan = build(
      [
        { price: { id: 'price_business_monthly' }, quantity: 1 },
        { price: { id: 'price_mgr_business' }, quantity: wanted },
      ],
      {
        targetPlan: 'starter',
        targetInterval: 'month',
        targetPlanPrice: 'price_starter_monthly',
        meteredPrice: null,
      },
    )
    const item = plan.items.find((i) => i.price === 'price_mgr_starter')
    if (ceiling === 0) {
      // A plan that cannot deliver the kind at all reports it as dropped
      // rather than as a line of quantity zero nobody can read.
      expect(item).toBeUndefined()
      expect(plan.droppedAddons).toContain('managers')
    } else {
      expect(item?.quantity).toBe(ceiling)
      // THE REGRESSION: the old behaviour carried `wanted` through untouched.
      expect(item?.quantity).not.toBe(wanted)
    }
    expect(plan.clampedAddons).toEqual([
      { kind: 'managers', from: wanted, to: ceiling },
    ])
  })

  it('says it, rather than reducing silently', () => {
    // The reduction has to reach the confirm dialog before the customer
    // agrees. Silence is what made this billing for nothing.
    const { build, maxFor } = load()
    const ceiling = maxFor('managers', 'starter')
    const plan = build(
      [
        { price: { id: 'price_business_monthly' }, quantity: 1 },
        { price: { id: 'price_mgr_business' }, quantity: ceiling + 3 },
      ],
      {
        targetPlan: 'starter',
        targetInterval: 'month',
        targetPlanPrice: 'price_starter_monthly',
        meteredPrice: null,
      },
    )
    expect(plan.clampedAddons).toHaveLength(1)
    expect(plan.clampedAddons[0].to).toBeLessThan(plan.clampedAddons[0].from)
  })

  it('a quantity the target CAN deliver is left alone', () => {
    // Clamping is a reduction to a ceiling, never a rewrite. An upgrade must
    // not quietly shrink an add-on the bigger plan supports.
    const { build, maxFor } = load()
    const ceiling = maxFor('managers', 'business')
    const wanted = Math.max(1, Math.min(2, ceiling))
    const plan = build(
      [
        { price: { id: 'price_starter_monthly' }, quantity: 1 },
        { price: { id: 'price_mgr_starter' }, quantity: wanted },
      ],
      {
        targetPlan: 'business',
        targetInterval: 'month',
        targetPlanPrice: 'price_business_monthly',
        meteredPrice: null,
      },
    )
    expect(
      plan.items.find((i) => i.price === 'price_mgr_business')?.quantity,
    ).toBe(wanted)
    expect(plan.clampedAddons).toEqual([])
  })

  it('CONTROL — dropping and clamping stay different answers', () => {
    // "Your POS registers are gone" and "you now have two instead of four"
    // are different sentences to a customer, so they are different fields. A
    // fix that reported a clamp as a drop would read as data loss.
    const { build } = load()
    const plan = build(
      [
        { price: { id: 'price_business_monthly' }, quantity: 1 },
        { price: { id: 'price_mgr_business' }, quantity: 1 },
      ],
      {
        targetPlan: 'business',
        targetInterval: 'month',
        targetPlanPrice: 'price_business_monthly',
        meteredPrice: null,
      },
    )
    expect(plan.droppedAddons).toEqual([])
    expect(plan.clampedAddons).toEqual([])
  })
})
