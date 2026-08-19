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
  ORDERS_CSV_HEADER,
  appendOrderEvent,
  buildOrdersCsv,
  canTransitionOrder,
  computeBuyNowOrder,
  computeCheckoutSessionTotals,
  computeOrderTotals,
  formatOrderNumber,
  liftLegacyOrder,
  orderContainsProduct,
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

  /**
   * AGL-2149. `cancel-order.ts` accepts a PAID order and moves no money, so
   * with `cancelled: []` an admin who cancelled instead of refunding locked the
   * shopper's money out of `refund.ts` — which gates on exactly this call —
   * permanently. This edge is the money's way back out.
   */
  it('lets a cancelled order still be refunded', () => {
    expect(canTransitionOrder('cancelled', 'refunded')).toBe(true)
  })

  /** …and `refunded` really is terminal, which is what makes the flip once-only. */
  it('keeps refunded terminal', () => {
    expect(canTransitionOrder('refunded', 'cancelled')).toBe(false)
    expect(canTransitionOrder('refunded', 'refunded')).toBe(false)
    expect(canTransitionOrder('refunded', 'fulfilled')).toBe(false)
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

  it('adds the components Stripe was never told about (AGL-1711)', () => {
    // The buy-now path charges manual tax as an ordinary line item and prices
    // its coupon into the unit amount, so neither reaches `total_details`.
    // They are ADDED to Stripe's figures, not substituted for them.
    const totals = computeCheckoutSessionTotals([LINE], SESSION, {
      feeCents: FEE_CENTS,
      lineItemTaxCents: 200,
      pricedInDiscountCents: 300,
    })
    expect(totals.taxCents).toBe(908 + 200)
    expect(totals.discountCents).toBe(500 + 300)
    // The cart path passes neither, and is unchanged.
    const cart = computeCheckoutSessionTotals([LINE], SESSION, {
      feeCents: FEE_CENTS,
    })
    expect(cart.taxCents).toBe(908)
    expect(cart.discountCents).toBe(500)
  })
})

/**
 * AGL-1711. The buy-now branch built the whole order from `amount_total`: one
 * unit, priced at the entire charge, with tax and discount recorded as 0.
 *
 * The fixture is a purchase that exercises all three defects at once — three
 * $100 units, a 10% host coupon, and manual destination tax at 8.25%:
 *
 *   listUnit 10000 × 3 = itemsCents 30000
 *   coupon             → the unit price SENT to Stripe is 9000, so the 3000
 *                        discount never appears in `amount_discount`
 *   manual tax         → 2228, sent as an ordinary `line_items[1]`, so it never
 *                        appears in `amount_tax` either
 *   amount_total       = 27000 + 2228 = 29228
 *
 * Every assertion below checks a COMPONENT, not the sum. The sum is exactly
 * what the bug preserved.
 */
describe('computeBuyNowOrder', () => {
  const SNAPSHOT = {
    name: 'Trail Jersey',
    variantLabel: 'Large',
    sku: 'TJ-L',
    productType: 'physical' as const,
  }
  const SESSION = {
    amount_total: 29228,
    total_details: {
      amount_tax: 0,
      amount_shipping: 0,
      amount_discount: 0,
    },
    metadata: {
      type: 'commerce-order',
      hostId: 'h1',
      productId: 'p1',
      variantId: 'v-large',
      quantity: '3',
      feeCents: '1350',
      unitAmountCents: '10000',
      taxCents: '2228',
      discountCents: '3000',
    },
  }

  it('records the quantity the buyer actually bought', () => {
    // The headline: 3 × $100 used to be stored as 1 × $300.
    expect(computeBuyNowOrder(SESSION, SNAPSHOT).lineItems[0].quantity).toBe(3)
  })

  it('prices the line at the product, not at the whole charge', () => {
    expect(
      computeBuyNowOrder(SESSION, SNAPSHOT).lineItems[0].unitAmountCents,
    ).toBe(10000)
  })

  it('unfolds the tax our own line item hid from Stripe', () => {
    // `total_details.amount_tax` is 0 here and always will be in manual mode:
    // the tax went over as `line_items[1]`, a product line as far as Stripe
    // is concerned. Reading only Stripe's field stores taxCents: 0.
    expect(SESSION.total_details.amount_tax).toBe(0)
    expect(computeBuyNowOrder(SESSION, SNAPSHOT).totals.taxCents).toBe(2228)
  })

  it('unfolds the coupon priced into the unit amount', () => {
    expect(SESSION.total_details.amount_discount).toBe(0)
    expect(computeBuyNowOrder(SESSION, SNAPSHOT).totals.discountCents).toBe(
      3000,
    )
  })

  it('decomposes every component of the worked example', () => {
    expect(computeBuyNowOrder(SESSION, SNAPSHOT).totals).toEqual({
      itemsCents: 30000,
      shippingCents: 0,
      taxCents: 2228,
      discountCents: 3000,
      feeCents: 1350,
      totalCents: 29228,
    })
  })

  it('reconciles the parts against the charge Stripe made', () => {
    const { totals } = computeBuyNowOrder(SESSION, SNAPSHOT)
    expect(
      totals.itemsCents +
        totals.shippingCents +
        totals.taxCents -
        totals.discountCents,
    ).toBe(SESSION.amount_total)
    // And the stored total is Stripe's own number, verbatim.
    expect(totals.totalCents).toBe(29228)
  })

  it('shows why a total-only test would have passed against the bug', () => {
    // What the pre-fix webhook stored for this same purchase. Unlike AGL-1698
    // it is SELF-CONSISTENT: the parts sum to the total and an arithmetic
    // check passes, while quantity, unit price, tax and discount are all wrong.
    const preFix = computeOrderTotals(
      [
        {
          productId: 'p1',
          name: 'Trail Jersey',
          quantity: 1,
          unitAmountCents: SESSION.amount_total,
        },
      ],
      { feeCents: 1350 },
    )
    expect(preFix.totalCents).toBe(SESSION.amount_total)
    expect(
      preFix.itemsCents +
        preFix.shippingCents +
        preFix.taxCents -
        preFix.discountCents,
    ).toBe(SESSION.amount_total)
    // Every component it agreed on was nonetheless fabricated.
    expect(preFix.itemsCents).toBe(29228)
    expect(preFix.taxCents).toBe(0)
    expect(preFix.discountCents).toBe(0)
  })

  it('reads Stripe Tax from total_details, not from the metadata', () => {
    // `automatic_tax` mode: the tax IS real on the session, and the pre-fix
    // webhook did not read it there either.
    const { totals } = computeBuyNowOrder(
      {
        amount_total: 32228,
        total_details: {
          amount_tax: 2228,
          amount_shipping: 0,
          amount_discount: 0,
        },
        metadata: { ...SESSION.metadata, taxCents: '0', discountCents: '0' },
      },
      SNAPSHOT,
    )
    expect(totals.taxCents).toBe(2228)
    expect(totals.itemsCents).toBe(30000)
    expect(
      totals.itemsCents + totals.taxCents - totals.discountCents,
    ).toBe(32228)
  })

  it('carries shipping the moment buy-now starts charging it', () => {
    // `checkout.ts` declares no `shipping_options` today (AGL-1720), so
    // `amount_shipping` is 0 — but nothing here assumes that.
    const { totals } = computeBuyNowOrder(
      {
        ...SESSION,
        amount_total: 30228,
        total_details: { ...SESSION.total_details, amount_shipping: 1000 },
      },
      SNAPSHOT,
    )
    expect(totals.shippingCents).toBe(1000)
    expect(
      totals.itemsCents +
        totals.shippingCents +
        totals.taxCents -
        totals.discountCents,
    ).toBe(30228)
  })

  it('snapshots the variant so the line is self-contained history', () => {
    expect(computeBuyNowOrder(SESSION, SNAPSHOT).lineItems[0]).toEqual({
      productId: 'p1',
      variantId: 'v-large',
      name: 'Trail Jersey',
      variantLabel: 'Large',
      sku: 'TJ-L',
      productType: 'physical',
      quantity: 3,
      unitAmountCents: 10000,
    })
  })

  it('omits the optional snapshot fields rather than writing undefined', () => {
    // Firestore rejects `undefined`, so absent means absent.
    const { lineItems } = computeBuyNowOrder(
      { ...SESSION, metadata: { productId: 'p1', quantity: '1' } },
      { name: 'Trail Jersey' },
    )
    expect(Object.keys(lineItems[0]).sort()).toEqual([
      'name',
      'productId',
      'quantity',
      'unitAmountCents',
    ])
  })

  describe('a session created before the metadata existed', () => {
    // In-flight at deploy: `quantity` was always sent, the other three keys
    // were not. Quantity and the reconciliation are recovered; a priced-in
    // coupon cannot be, and stays folded into the unit price as it is today.
    const LEGACY = {
      amount_total: 29228,
      total_details: {
        amount_tax: 0,
        amount_shipping: 0,
        amount_discount: 0,
      },
      metadata: { productId: 'p1', quantity: '3', feeCents: '1350' },
    }

    it('still gets the quantity right', () => {
      expect(computeBuyNowOrder(LEGACY, SNAPSHOT).lineItems[0].quantity).toBe(3)
    })

    it('falls back to what Stripe charged per unit', () => {
      const { totals } = computeBuyNowOrder(LEGACY, SNAPSHOT)
      // 29228 / 3, rounded — tax-inclusive, because a legacy session cannot
      // say how much of it was tax. Still far closer than 29228.
      expect(totals.itemsCents).toBe(29229)
      expect(totals.totalCents).toBe(29228)
    })

    it('excludes tax from the unit price when Stripe knew about it', () => {
      const { lineItems } = computeBuyNowOrder(
        {
          amount_total: 32228,
          total_details: {
            amount_tax: 2228,
            amount_shipping: 1000,
            amount_discount: 0,
          },
          metadata: { productId: 'p1', quantity: '3' },
        },
        SNAPSHOT,
      )
      // (32228 - 2228 - 1000) / 3, rounded
      expect(lineItems[0].unitAmountCents).toBe(9667)
    })
  })

  it('defaults a missing or nonsense quantity to one, never to zero', () => {
    const fromNothing = computeBuyNowOrder(
      { amount_total: 5000, metadata: { productId: 'p1' } },
      { name: 'X' },
    )
    expect(fromNothing.lineItems[0].quantity).toBe(1)
    expect(fromNothing.lineItems[0].unitAmountCents).toBe(5000)
    const fromGarbage = computeBuyNowOrder(
      { amount_total: 5000, metadata: { productId: 'p1', quantity: 'many' } },
      { name: 'X' },
    )
    expect(fromGarbage.lineItems[0].quantity).toBe(1)
  })

  it('survives a session with no metadata at all', () => {
    const { lineItems, totals } = computeBuyNowOrder({}, { name: 'X' })
    expect(lineItems[0]).toEqual({
      productId: '',
      name: 'X',
      quantity: 1,
      unitAmountCents: 0,
    })
    expect(totals.totalCents).toBe(0)
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

describe('orderContainsProduct', () => {
  it('matches a line item, and still matches the legacy flat field', () => {
    const cartOrder = {
      lineItems: [
        { productId: 'mug', name: 'Blue Mug', quantity: 1, unitAmountCents: 1 },
        { productId: 'lid', name: 'Lid', quantity: 1, unitAmountCents: 1 },
      ],
    }
    // The line the flat-field-only filter could never reach.
    expect(orderContainsProduct(cartOrder, 'lid')).toBe(true)
    expect(orderContainsProduct(cartOrder, 'mug')).toBe(true)
    expect(orderContainsProduct(cartOrder, 'other')).toBe(false)
    expect(orderContainsProduct({ productId: 'legacy' }, 'legacy')).toBe(true)
    expect(orderContainsProduct({}, 'anything')).toBe(false)
  })
})

/**
 * AGL-1747. Each case is one real writer's stored shape, and every cell is
 * asserted individually — per AGL-1711, a total-only assertion passes against
 * a row whose every component is wrong.
 */
describe('buildOrdersCsv', () => {
  const at = (iso: string) => ({ toDate: () => new Date(iso) })
  const cells = (csv: string, row: number) => csv.split('\n')[row].split(',')

  /** `pos-order.ts`: lineItems + totals, and no flat field anywhere. */
  const posCashOrder = {
    $id: 'pos1',
    number: 12,
    status: 'paid' as const,
    channel: 'pos' as const,
    lineItems: [
      { productId: 'pad', name: 'Brake Pads', quantity: 2, unitAmountCents: 1250 },
      { productId: 'lev', name: 'Levers', quantity: 1, unitAmountCents: 4000 },
    ],
    totals: {
      itemsCents: 6500,
      shippingCents: 0,
      taxCents: 536,
      discountCents: 0,
      feeCents: 195,
      totalCents: 7036,
    },
    customerEmail: 'walkin@example.com',
    createdAt: at('2026-08-14T15:04:05.000Z'),
  }

  it('exports a POS order at what it actually charged, not $0.00', () => {
    const row = cells(buildOrdersCsv([posCashOrder]), 1)
    expect(row[0]).toBe('2026-08-14T15:04:05.000Z')
    // Two lines, so the first is named and the rest counted.
    expect(row[1]).toBe('Brake Pads +1 more')
    expect(row[2]).toBe('70.36') // was 0.00 — `amountCents` is never written
    expect(row[3]).toBe('1.95') // was 0.00 — nor is `feeCents`
    expect(row[4]).toBe('walkin@example.com')
    expect(row[5]).toBe('')
    expect(row[6]).toBe('pos1')
    expect(row[7]).toBe('paid')
    expect(row[8]).toBe('pos')
    expect(row[9]).toBe('0.00')
    expect(row[10]).toBe('70.36')
  })

  it('exports a draft order at its totals, and keeps it pending', () => {
    const row = cells(
      buildOrdersCsv([
        {
          $id: 'draft1',
          status: 'pending' as const,
          channel: 'draft' as const,
          lineItems: [
            { productId: 'kit', name: 'Tune-up Kit', quantity: 1, unitAmountCents: 8900 },
          ],
          totals: {
            itemsCents: 8900,
            shippingCents: 0,
            taxCents: 0,
            discountCents: 0,
            feeCents: 267,
            totalCents: 8900,
          },
          customerEmail: 'buyer@example.com',
          // `serverTimestamp` reads back null on the local snapshot.
          createdAtMs: Date.parse('2026-08-13T09:00:00.000Z'),
        },
      ]),
      1,
    )
    expect(row[0]).toBe('2026-08-13T09:00:00.000Z')
    expect(row[1]).toBe('Tune-up Kit')
    expect(row[2]).toBe('89.00') // was 0.00
    expect(row[3]).toBe('2.67') // was 0.00
    expect(row[7]).toBe('pending')
    expect(row[8]).toBe('draft')
  })

  it('names the products on a cart order, which carries no flat productId', () => {
    const row = cells(
      buildOrdersCsv([
        {
          $id: 'cart1',
          status: 'paid' as const,
          channel: 'online' as const,
          lineItems: [
            { productId: 'mug', name: 'Blue Mug', quantity: 2, unitAmountCents: 1600 },
            { productId: 'lid', name: 'Lid', quantity: 1, unitAmountCents: 400 },
            { productId: 'box', name: 'Gift Box', quantity: 1, unitAmountCents: 800 },
          ],
          totals: {
            itemsCents: 4400,
            shippingCents: 599,
            taxCents: 201,
            discountCents: 0,
            feeCents: 150,
            totalCents: 5200,
          },
          couponCode: 'SPRING',
          // The webhook writes these two but never `productId`.
          amountCents: 5200,
          feeCents: 150,
          createdAt: at('2026-08-12T12:00:00.000Z'),
        },
      ]),
      1,
    )
    expect(row[1]).toBe('Blue Mug +2 more') // was blank
    expect(row[2]).toBe('52.00')
    expect(row[3]).toBe('1.50')
    expect(row[5]).toBe('SPRING')
  })

  it('splits a refunded order into gross, refunded and net', () => {
    const row = cells(
      buildOrdersCsv([
        {
          $id: 'ref1',
          status: 'refunded' as const,
          channel: 'online' as const,
          lineItems: [
            { productId: 'p', name: 'Jersey', quantity: 1, unitAmountCents: 9000 },
          ],
          totals: {
            itemsCents: 9000,
            shippingCents: 0,
            taxCents: 0,
            discountCents: 0,
            feeCents: 270,
            totalCents: 9000,
          },
          refundedCents: 3000,
          createdAt: at('2026-08-11T00:00:00.000Z'),
        },
      ]),
      1,
    )
    expect(row[2]).toBe('90.00')
    expect(row[7]).toBe('refunded')
    expect(row[9]).toBe('30.00')
    expect(row[10]).toBe('60.00')
  })

  it('still exports a legacy flat row, with its real product name', () => {
    const row = cells(
      buildOrdersCsv(
        [
          {
            $id: 'legacy1',
            productId: 'p9',
            amountCents: 2500,
            feeCents: 75,
            createdAt: at('2026-01-02T03:04:05.000Z'),
          },
        ],
        // liftLegacyOrder would name the synthesised line "Product"; the map
        // still has to win for these rows.
        { p9: 'Vintage Bell' },
      ),
      1,
    )
    expect(row[1]).toBe('Vintage Bell')
    expect(row[2]).toBe('25.00')
    expect(row[3]).toBe('0.75')
    expect(row[7]).toBe('paid')
    expect(row[8]).toBe('online')
  })

  it('quotes cells containing the delimiter, and emits the header', () => {
    const csv = buildOrdersCsv([
      {
        $id: 'q1',
        status: 'paid' as const,
        lineItems: [
          {
            productId: 'x',
            name: 'Bolts, 10mm ("hex")',
            quantity: 1,
            unitAmountCents: 500,
          },
        ],
        totals: {
          itemsCents: 500,
          shippingCents: 0,
          taxCents: 0,
          discountCents: 0,
          feeCents: 0,
          totalCents: 500,
        },
      },
    ])
    expect(csv.split('\n')[0]).toBe(ORDERS_CSV_HEADER)
    expect(ORDERS_CSV_HEADER.split(',')).toHaveLength(11)
    expect(csv).toContain('"Bolts, 10mm (""hex"")"')
    // No timestamp of any kind — an empty date cell, not a crash.
    expect(csv.split('\n')[1].split(',')[0]).toBe('')
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
