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
  appendOrderEvent,
  canTransitionOrder,
  computeCheckoutSessionTotals,
  computeOrderTotals,
  formatOrderNumber,
  liftLegacyOrder,
} from './commerce-orders'

describe('canTransitionOrder', () => {
  it('allows the documented lifecycle and blocks the rest', () => {
    expect(canTransitionOrder('pending', 'paid')).toBe(true)
    expect(canTransitionOrder('paid', 'fulfilled')).toBe(true)
    expect(canTransitionOrder('paid', 'partially_fulfilled')).toBe(true)
    expect(canTransitionOrder('fulfilled', 'delivered')).toBe(true)
    expect(canTransitionOrder('fulfilled', 'refunded')).toBe(true)
    // Shipped orders refund, they don't cancel.
    expect(canTransitionOrder('fulfilled', 'cancelled')).toBe(false)
    expect(canTransitionOrder('refunded', 'paid')).toBe(false)
    expect(canTransitionOrder('cancelled', 'paid')).toBe(false)
  })
})

describe('computeOrderTotals', () => {
  const lines = [
    { productId: 'a', name: 'Pads', quantity: 2, unitAmountCents: 2500 },
    { productId: 'b', name: 'Levers', quantity: 1, unitAmountCents: 4000 },
  ]
  it('sums items and folds in the parts', () => {
    const totals = computeOrderTotals(lines, {
      shippingCents: 799,
      taxCents: 450,
      discountCents: 1000,
      feeCents: 180,
    })
    expect(totals.itemsCents).toBe(9000)
    expect(totals.totalCents).toBe(9000 + 799 + 450 - 1000)
    expect(totals.feeCents).toBe(180)
  })
  it('clamps discounts to items + shipping', () => {
    const totals = computeOrderTotals(lines, { discountCents: 99999 })
    expect(totals.discountCents).toBe(9000)
    expect(totals.totalCents).toBe(0)
  })
})

/**
 * AGL-1698. The webhook read two of `total_details`' three siblings and
 * skipped `amount_shipping`, so every `online` order persisted
 * `shippingCents: 0` while the shipping the shopper paid sat inside
 * `amount_total`. Merchants reconcile their own books against these records.
 *
 * The fixture is AGL-1641's worked example, now reconciled rather than routed
 * around: $100 item, $5 coupon, $10 shipping, $9.08 tax, 5% Aglyn fee.
 */
describe('computeCheckoutSessionTotals', () => {
  const LINE = {
    productId: 'p1',
    name: 'Wheelset',
    quantity: 1,
    unitAmountCents: 10000,
  }
  const FEE_CENTS = 475
  const SESSION = {
    amount_total: 11408,
    total_details: {
      amount_tax: 908,
      amount_shipping: 1000,
      amount_discount: 500,
    },
  }

  it('stores the shipping the shopper actually paid', () => {
    const totals = computeCheckoutSessionTotals([LINE], SESSION, {
      feeCents: FEE_CENTS,
    })
    expect(totals.shippingCents).toBe(1000)
  })

  it('makes the stored parts sum to the stored total', () => {
    const totals = computeCheckoutSessionTotals([LINE], SESSION, {
      feeCents: FEE_CENTS,
    })
    expect(
      totals.itemsCents +
        totals.shippingCents +
        totals.taxCents -
        totals.discountCents,
    ).toBe(totals.totalCents)
    // And that total is still Stripe's own number, verbatim — our arithmetic
    // agreeing with it is the invariant, not the source.
    expect(totals.totalCents).toBe(11408)
  })

  it('closes the exact 1000c gap AGL-1641 had to route around', () => {
    // What the pre-fix webhook stored: `shippingCents` left to default.
    const preFix = computeOrderTotals([LINE], {
      feeCents: FEE_CENTS,
      taxCents: 908,
      discountCents: 500,
    })
    expect(preFix.shippingCents).toBe(0)
    expect(preFix.totalCents).toBe(10408)
    expect(SESSION.amount_total - preFix.totalCents).toBe(1000)

    const fixed = computeCheckoutSessionTotals([LINE], SESSION, {
      feeCents: FEE_CENTS,
    })
    expect(fixed.totalCents - preFix.totalCents).toBe(1000)
    expect(fixed.shippingCents).toBe(
      SESSION.amount_total - preFix.totalCents,
    )
  })

  it('takes every part from Stripe and the fee from the caller', () => {
    expect(
      computeCheckoutSessionTotals([LINE], SESSION, { feeCents: FEE_CENTS }),
    ).toEqual({
      itemsCents: 10000,
      shippingCents: 1000,
      taxCents: 908,
      discountCents: 500,
      feeCents: 475,
      totalCents: 11408,
    })
  })

  it('no longer clamps a discount that reaches into shipping', () => {
    // `computeOrderTotals` caps the discount at items + shipping. With
    // shipping stuck at 0, a discount covering it was silently cut down too.
    const line = { productId: 'p', name: 'Tube', quantity: 1, unitAmountCents: 1000 }
    const session = {
      amount_total: 300,
      total_details: {
        amount_tax: 0,
        amount_shipping: 500,
        amount_discount: 1200,
      },
    }
    expect(computeCheckoutSessionTotals([line], session).discountCents).toBe(
      1200,
    )
    // Pre-fix, the same Stripe session stored 1000 — the clamp bit.
    expect(
      computeOrderTotals([line], { taxCents: 0, discountCents: 1200 })
        .discountCents,
    ).toBe(1000)
  })

  it('records a genuinely unshipped order as zero, not as missing', () => {
    const totals = computeCheckoutSessionTotals([LINE], {
      amount_total: 10000,
      total_details: {
        amount_tax: 0,
        amount_shipping: 0,
        amount_discount: 0,
      },
    })
    expect(totals.shippingCents).toBe(0)
    expect(totals.totalCents).toBe(10000)
  })

  it('falls back to our sum when Stripe sends no amount_total', () => {
    const totals = computeCheckoutSessionTotals([LINE], {
      total_details: { amount_shipping: 1000 },
    })
    expect(totals.totalCents).toBe(11000)
  })

  it('survives a session carrying no total_details at all', () => {
    expect(computeCheckoutSessionTotals([LINE], {})).toEqual({
      itemsCents: 10000,
      shippingCents: 0,
      taxCents: 0,
      discountCents: 0,
      feeCents: 0,
      totalCents: 10000,
    })
  })
})

describe('formatOrderNumber', () => {
  it('prefers the sequence, falls back to the doc id', () => {
    expect(formatOrderNumber({ number: 1042 })).toBe('#1042')
    expect(formatOrderNumber({}, 'cs_test_abcdef')).toBe('#ABCDEF')
    expect(formatOrderNumber({})).toBe('#—')
  })
})

describe('liftLegacyOrder', () => {
  it('lifts flat Commerce Starter rows', () => {
    const lifted = liftLegacyOrder({
      productId: 'p1',
      amountCents: 2500,
      feeCents: 50,
    })
    expect(lifted.status).toBe('paid')
    expect(lifted.lineItems).toHaveLength(1)
    expect(lifted.totals?.totalCents).toBe(2500)
    expect(lifted.totals?.feeCents).toBe(50)
  })
  it('passes shaped orders through', () => {
    const shaped = {
      status: 'fulfilled' as const,
      lineItems: [
        { productId: 'x', name: 'X', quantity: 1, unitAmountCents: 100 },
      ],
    }
    expect(liftLegacyOrder(shaped).status).toBe('fulfilled')
  })
})

describe('appendOrderEvent', () => {
  it('appends immutably with a timestamp', () => {
    const order = { timeline: [{ atMs: 1, event: 'paid' }] }
    const next = appendOrderEvent(order, 'fulfilled', 'Sent via UPS', 2)
    expect(next).toHaveLength(2)
    expect(next[1]).toEqual({
      atMs: 2,
      event: 'fulfilled',
      detail: 'Sent via UPS',
    })
    expect(order.timeline).toHaveLength(1)
  })
})
