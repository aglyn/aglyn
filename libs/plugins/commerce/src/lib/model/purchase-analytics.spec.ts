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

import { computeOrderTotals } from './commerce-orders'
import {
  buildStorefrontPurchaseParams,
  toStorefrontPurchaseSource,
} from './purchase-analytics'

/**
 * AGL-1641 — what a tenant storefront reports as revenue to the MERCHANT's
 * GA4 property, and why it is not the number AGL-1639 chose for ours.
 */
describe('buildStorefrontPurchaseParams', () => {
  /**
   * The worked example pinned in the module doc. Every figure here is one
   * Stripe itself produces, so the assertion is a reconciliation, not a
   * restatement of our own arithmetic.
   */
  const LINE = {
    productId: 'prod_desk_lamp',
    name: 'Desk Lamp',
    quantity: 1,
    unitAmountCents: 10000,
  }
  const ITEMS_CENTS = 10000
  const DISCOUNT_CENTS = 500 // Stripe total_details.amount_discount
  const SHIPPING_CENTS = 1000 // chosen at Stripe Checkout
  const TAX_CENTS = 908 // Stripe total_details.amount_tax
  const AMOUNT_TOTAL = 11408 // Stripe amount_total
  const FEE_CENTS = 475 // Aglyn's Connect application fee

  it('reports the merchant gross ex-tax, which is amount_total minus tax', () => {
    const params = buildStorefrontPurchaseParams({
      transactionId: 'cs_test_worked_example',
      totalCents: AMOUNT_TOTAL,
      taxCents: TAX_CENTS,
      shippingCents: SHIPPING_CENTS,
      lineItems: [LINE],
    })

    // 114.08 paid, 9.08 of it tax held for the state.
    expect(params?.value).toBe(105.0)
    expect(params?.currency).toBe('USD')
    expect(params?.transaction_id).toBe('cs_test_worked_example')
  })

  it('does NOT subtract the Aglyn platform fee — the inverse of AGL-1639', () => {
    const params = buildStorefrontPurchaseParams({
      transactionId: 'cs_test_fee',
      totalCents: AMOUNT_TOTAL,
      taxCents: TAX_CENTS,
      shippingCents: SHIPPING_CENTS,
      lineItems: [LINE],
    })
    // Platform net would be 105.00 - 4.75. On the merchant's property their
    // sales revenue is what the shopper paid them for goods and shipping; our
    // fee is their cost of sale and OUR revenue is reported in OUR property.
    expect(params?.value).not.toBe(100.25)
    expect(params?.value).toBe(105.0)
    expect(FEE_CENTS).toBe(475)
  })

  /**
   * The asymmetry, pinned so nobody makes the two params consistent with each
   * other (AGL-1722). `shipping` is a component of `value`; `tax` is not.
   */
  it('sends `shipping` but still no `tax` beside an ex-tax value', () => {
    const params = buildStorefrontPurchaseParams({
      transactionId: 'cs_test_params',
      totalCents: AMOUNT_TOTAL,
      taxCents: TAX_CENTS,
      shippingCents: SHIPPING_CENTS,
      lineItems: [LINE],
    })
    expect(params?.shipping).toBe(10.0)
    expect(params).not.toHaveProperty('tax')
    expect(params).not.toHaveProperty('billing_interval')
  })

  it('reports `shipping` as a part of `value`, never as an addition to it', () => {
    const params = buildStorefrontPurchaseParams({
      transactionId: 'cs_test_shipping_inside_value',
      totalCents: AMOUNT_TOTAL,
      taxCents: TAX_CENTS,
      shippingCents: SHIPPING_CENTS,
      lineItems: [LINE],
    })
    // 105.00 total, of which 10.00 is shipping and 95.00 is goods. The
    // failure this guards is a `value` that grew to 115.00, or one that
    // shrank to 95.00 because shipping was "moved" into its own param.
    expect(params?.value).toBe(105.0)
    expect(params?.shipping).toBe(10.0)
    expect((params?.value ?? 0) - (params?.shipping ?? 0)).toBe(95.0)
  })

  it('sends a truthful `shipping: 0` rather than omitting the param', () => {
    // A download, a merchant with no rates configured, POS, a draft. The old
    // structural zero is gone (AGL-1707/AGL-1720), so 0 now says "no shipping
    // was charged" — which is worth saying. Omitting it would be
    // indistinguishable in GA from "not tracked".
    const params = buildStorefrontPurchaseParams({
      transactionId: 'cs_test_no_shipping',
      totalCents: 4999,
      taxCents: 0,
      shippingCents: 0,
      lineItems: [
        { productId: 'p1', name: 'Zine (PDF)', quantity: 1, unitAmountCents: 4999 },
      ],
    })
    expect(params).toHaveProperty('shipping')
    expect(params?.shipping).toBe(0)
    expect(params?.value).toBe(49.99)
  })

  it('carries shipping off the STORED order, not off a recomputed sum', () => {
    // The reducer is the only place the figure is read, so this is the whole
    // plumbing path: `totals.shippingCents` (Stripe's
    // `total_details.amount_shipping`, per AGL-1698) out to the wire shape.
    const params = buildStorefrontPurchaseParams(
      toStorefrontPurchaseSource('cs_test_stored_shipping', {
        totals: {
          itemsCents: ITEMS_CENTS,
          shippingCents: SHIPPING_CENTS,
          taxCents: TAX_CENTS,
          discountCents: DISCOUNT_CENTS,
          totalCents: AMOUNT_TOTAL,
          feeCents: FEE_CENTS,
        },
        lineItems: [LINE],
      }),
    )
    expect(params?.shipping).toBe(10.0)
    expect(params?.value).toBe(105.0)
  })

  /**
   * The reason `value` derives from `totalCents` rather than the parts. This
   * is the test that would have caught the bug had it been written the other
   * way, and it fails on any parts-based implementation.
   */
  it('keeps shipping that the stored parts do not record', () => {
    // The PRE-AGL-1698 webhook call: shippingCents was not passed. Kept as the
    // shape this derivation must never be rebuilt on, and as the shape every
    // order written before that fix still carries.
    const stored = computeOrderTotals([LINE], {
      feeCents: FEE_CENTS,
      taxCents: TAX_CENTS,
      discountCents: DISCOUNT_CENTS,
    })
    expect(stored.shippingCents).toBe(0)
    // ...so the parts sum 1000c short of what the shopper actually paid.
    expect(stored.totalCents).toBe(
      ITEMS_CENTS + 0 + TAX_CENTS - DISCOUNT_CENTS,
    )
    expect(AMOUNT_TOTAL - stored.totalCents).toBe(SHIPPING_CENTS)

    // The webhook then overwrites totalCents with Stripe's amount_total.
    const params = buildStorefrontPurchaseParams(
      toStorefrontPurchaseSource('cs_test_shipping', {
        totals: { ...stored, totalCents: AMOUNT_TOTAL },
        lineItems: [LINE],
      }),
    )
    // 105.00, not 95.00 — the shipping survives.
    expect(params?.value).toBe(105.0)
    expect(params?.value).not.toBe(
      (ITEMS_CENTS + stored.shippingCents - DISCOUNT_CENTS) / 100,
    )
  })

  it('accounts for every cent the shopper paid exactly once', () => {
    const params = buildStorefrontPurchaseParams({
      transactionId: 'cs_test_decomposition',
      totalCents: AMOUNT_TOTAL,
      taxCents: TAX_CENTS,
      shippingCents: SHIPPING_CENTS,
      lineItems: [LINE],
    })
    const reportedCents = Math.round((params?.value ?? 0) * 100)
    // goods (items - discount) + shipping + tax === what Stripe charged.
    expect(ITEMS_CENTS - DISCOUNT_CENTS + SHIPPING_CENTS).toBe(reportedCents)
    expect(reportedCents + TAX_CENTS).toBe(AMOUNT_TOTAL)
    // And the reported `shipping` is the same SHIPPING_CENTS this sum used —
    // the param cannot drift away from the decomposition it describes.
    expect(Math.round((params?.shipping ?? 0) * 100)).toBe(SHIPPING_CENTS)
  })

  it('holds in a second jurisdiction, with no tax and no shipping', () => {
    const params = buildStorefrontPurchaseParams({
      transactionId: 'cs_test_no_tax',
      totalCents: 4999,
      taxCents: 0,
      shippingCents: 0,
      lineItems: [
        { productId: 'p1', name: 'Zine', quantity: 1, unitAmountCents: 4999 },
      ],
    })
    expect(params?.value).toBe(49.99)
    expect(params?.shipping).toBe(0)
  })

  it('carries product ids and per-unit prices so the funnel joins', () => {
    const params = buildStorefrontPurchaseParams({
      transactionId: 'cs_test_items',
      totalCents: 6000,
      taxCents: 0,
      shippingCents: 0,
      lineItems: [
        { productId: 'p1', name: 'Mug', quantity: 3, unitAmountCents: 1000 },
        { productId: 'p2', name: 'Tea', quantity: 1, unitAmountCents: 3000 },
      ],
    })
    expect(params?.items).toEqual([
      { item_id: 'p1', item_name: 'Mug', price: 10, quantity: 3 },
      { item_id: 'p2', item_name: 'Tea', price: 30, quantity: 1 },
    ])
  })

  it('rounds money to two decimals rather than emitting a float tail', () => {
    const params = buildStorefrontPurchaseParams({
      transactionId: 'cs_test_float',
      totalCents: 5999,
      taxCents: 0,
      shippingCents: 1999,
      lineItems: [
        { productId: 'p1', name: 'A', quantity: 1, unitAmountCents: 1999 },
      ],
    })
    expect(String(params?.value)).toBe('59.99')
    // `shipping` goes through the same `toAmount`, so it cannot grow a float
    // tail the `value` beside it does not have.
    expect(String(params?.shipping)).toBe('19.99')
  })

  it('drops the event rather than fabricating one', () => {
    // A wrong number in a merchant's revenue report is worse than a gap.
    expect(
      buildStorefrontPurchaseParams({
        transactionId: '',
        totalCents: 1000,
        taxCents: 0,
        shippingCents: 0,
        lineItems: [],
      }),
    ).toBeNull()
    // Tax-only or zeroed order — nothing truthful to report as revenue.
    expect(
      buildStorefrontPurchaseParams({
        transactionId: 'cs_test_zero',
        totalCents: 908,
        taxCents: 908,
        shippingCents: 0,
        lineItems: [],
      }),
    ).toBeNull()
  })
})

describe('toStorefrontPurchaseSource', () => {
  it('withholds every identity-bearing field on the order', () => {
    const source = toStorefrontPurchaseSource('cs_test_pii', {
      totals: {
        itemsCents: 10000,
        shippingCents: 1000,
        taxCents: 908,
        discountCents: 500,
        totalCents: 11408,
        feeCents: 475,
      },
      lineItems: [
        {
          productId: 'p1',
          name: 'Desk Lamp',
          quantity: 1,
          unitAmountCents: 10000,
          sku: 'DL-1',
        },
      ],
      // Fields a shopper's browser must never be handed back.
      customerEmail: 'buyer@example.com',
      customerName: 'A Buyer',
      shippingAddress: { line1: '1 Test St' },
    } as never)

    expect(JSON.stringify(source)).not.toContain('buyer@example.com')
    expect(JSON.stringify(source)).not.toContain('A Buyer')
    expect(JSON.stringify(source)).not.toContain('1 Test St')
    // The platform fee is not on the wire either — it is our number, and the
    // storefront event has no use for it.
    expect(source).not.toHaveProperty('feeCents')
    expect(source.totalCents).toBe(11408)
    expect(source.taxCents).toBe(908)
    // The shipping AMOUNT crosses the wire (AGL-1722); the shipping ADDRESS
    // never does. The two live next to each other on the stored order and the
    // projection has to keep telling them apart.
    expect(source.shippingCents).toBe(1000)
    expect(source).not.toHaveProperty('shippingAddress')
  })

  it('reads shipping off the stored totals, defaulting a legacy order to 0', () => {
    // Orders written before AGL-1698 carry `shippingCents: 0` even where the
    // shopper paid shipping, and orders written before AGL-1641 may carry no
    // `totals` at all. Neither can be recovered here, and `value` is unharmed
    // because it comes off `totalCents` — which is exactly why it does.
    expect(
      toStorefrontPurchaseSource('cs_legacy', {
        totals: { totalCents: 11408, taxCents: 908 },
        lineItems: [],
      } as never).shippingCents,
    ).toBe(0)
    expect(
      toStorefrontPurchaseSource('cs_none', { lineItems: [] } as never)
        .shippingCents,
    ).toBe(0)
  })
})
