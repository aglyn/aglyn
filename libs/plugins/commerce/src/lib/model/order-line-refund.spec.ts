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
 * The arithmetic a line refund moves money on.
 *
 * Specced before the route was touched, and specced on the AMOUNT rather than
 * anything rendered, because the defect is arithmetic: the route handed back
 * `unitAmountCents x quantity` — the LIST value — on orders whose buyer paid
 * less than that because an order-level discount came off. Refunding line one
 * over-paid, and the order then had less left than line two was worth, so line
 * two was refused and the merchant could not finish.
 *
 * The property that matters most here is that the split CLOSES. A cent that
 * vanishes in apportionment is not a rounding curiosity — it is a
 * reconciliation defect that surfaces against Stripe months later, so the
 * remainder cases below are the point of this file rather than an edge-case
 * afterthought.
 */

import {
  apportionCents,
  orderLineRefundCents,
  type OrderLineItem,
} from './commerce-orders'

/**
 * A whole line, annotated so the compiler holds this double to the shape the
 * order documents actually carry. The identity fields are immaterial to the
 * arithmetic under test — it reads only `unitAmountCents` and `quantity` — but
 * a double that cannot typecheck as a line is asserting against a shape no
 * order ever has.
 */
const line = (unitAmountCents: number, quantity = 1): OrderLineItem => ({
  productId: 'prod-item',
  name: 'item',
  quantity,
  unitAmountCents,
})

describe('apportionCents', () => {
  it('splits an even pot evenly', () => {
    expect(apportionCents([5000, 5000], 1000)).toEqual([500, 500])
  })

  it('gives every cent of an indivisible pot to somebody', () => {
    // 10c across three equal lines is 3.33 each. Rounding each would produce
    // 9c or 12c; the split must produce exactly 10.
    const shares = apportionCents([1000, 1000, 1000], 10)
    expect(shares.reduce((sum, share) => sum + share, 0)).toBe(10)
    expect(shares).toEqual([4, 3, 3])
  })

  it('weights an uneven split by value, and still closes', () => {
    // 7c across 1:2:4. Exact shares 1.0, 2.0, 4.0 — no remainder to hand out.
    expect(apportionCents([1000, 2000, 4000], 7)).toEqual([1, 2, 4])
    // 8c across the same weights: 1.142, 2.285, 4.571 -> floors 1,2,4 = 7,
    // one cent left, and it goes to the largest fraction (the 4000 line).
    const uneven = apportionCents([1000, 2000, 4000], 8)
    expect(uneven).toEqual([1, 2, 5])
    expect(uneven.reduce((sum, share) => sum + share, 0)).toBe(8)
  })

  it('closes for every pot across an awkward basis', () => {
    // The general property, asserted rather than sampled: three coprime-ish
    // weights and every discount from 0 to their sum must apportion exactly.
    const weights = [333, 667, 1000]
    const basis = 2000
    for (let pot = 0; pot <= basis; pot += 1) {
      const shares = apportionCents(weights, pot)
      expect(shares.reduce((sum, share) => sum + share, 0)).toBe(pot)
      shares.forEach((share) => expect(share).toBeGreaterThanOrEqual(0))
    }
  })

  it('never apportions more than the basis holds', () => {
    // A discount larger than the items is a data fault; crediting lines with
    // money the order never carried would turn it into a refund.
    expect(apportionCents([1000, 1000], 5000)).toEqual([1000, 1000])
  })

  it('answers zeros rather than NaN for a basis of nothing', () => {
    expect(apportionCents([0, 0], 500)).toEqual([0, 0])
    expect(apportionCents([], 500)).toEqual([])
    expect(apportionCents([100], 0)).toEqual([0])
  })
})

describe('orderLineRefundCents', () => {
  /** Two $50 lines, $10 off the order. The buyer paid $90. */
  const discounted = {
    lineItems: [line(5000), line(5000)],
    totals: {
      itemsCents: 10000,
      shippingCents: 0,
      taxCents: 0,
      discountCents: 1000,
      totalCents: 9000,
      feeCents: 0,
    },
  }

  it('refunds a discounted line at what the buyer paid for it', () => {
    // THE DEFECT. The route used to answer 5000 here — $5 more than the buyer
    // ever spent on this line.
    expect(orderLineRefundCents(discounted, [0])).toBe(4500)
  })

  it('lets BOTH lines be refunded, together summing to the order total', () => {
    // The second half of the defect: over-refunding line one left $40 against
    // a $50 line, so line two was refused and the merchant was stuck. The two
    // line refunds must now sum to exactly what the buyer paid.
    const first = orderLineRefundCents(discounted, [0])
    const second = orderLineRefundCents(discounted, [1])
    expect(first + second).toBe(9000)
    expect(orderLineRefundCents(discounted, [0, 1])).toBe(9000)
  })

  it('CONTROL: an undiscounted order still refunds the line at list', () => {
    // Without this the change would look correct while quietly shrinking every
    // ordinary refund.
    const plain = {
      lineItems: [line(5000), line(5000)],
      totals: {
        itemsCents: 10000,
        shippingCents: 0,
        taxCents: 0,
        discountCents: 0,
        totalCents: 10000,
        feeCents: 0,
      },
    }
    expect(orderLineRefundCents(plain, [0])).toBe(5000)
    expect(orderLineRefundCents(plain, [0, 1])).toBe(10000)
  })

  it('prices quantity, and splits an odd discount without losing a cent', () => {
    // 2x$19.99 and 1x$5.00, $7 off. Line grosses 3998 and 500.
    const order = {
      lineItems: [line(1999, 2), line(500)],
      totals: {
        itemsCents: 4498,
        shippingCents: 0,
        taxCents: 0,
        discountCents: 700,
        totalCents: 3798,
        feeCents: 0,
      },
    }
    const first = orderLineRefundCents(order, [0])
    const second = orderLineRefundCents(order, [1])
    expect(first + second).toBe(3798)
    expect(orderLineRefundCents(order, [0, 1])).toBe(3798)
  })

  it('ignores shipping and tax, which are not a line’s to return', () => {
    const withExtras = {
      lineItems: [line(5000)],
      totals: {
        itemsCents: 5000,
        shippingCents: 799,
        taxCents: 412,
        discountCents: 0,
        totalCents: 6211,
        feeCents: 0,
      },
    }
    expect(orderLineRefundCents(withExtras, [0])).toBe(5000)
  })

  it('contributes nothing for an index the order does not have', () => {
    expect(orderLineRefundCents(discounted, [9])).toBe(0)
    expect(orderLineRefundCents(discounted, [0, 9])).toBe(4500)
  })

  it('counts a repeated index once', () => {
    // The route builds this list from a request body; a duplicated index must
    // not refund the same goods twice.
    expect(orderLineRefundCents(discounted, [0, 0])).toBe(4500)
  })
})
