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
      lineItems: [LINE],
    })
    // Platform net would be 105.00 - 4.75. On the merchant's property their
    // sales revenue is what the shopper paid them for goods and shipping; our
    // fee is their cost of sale and OUR revenue is reported in OUR property.
    expect(params?.value).not.toBe(100.25)
    expect(params?.value).toBe(105.0)
    expect(FEE_CENTS).toBe(475)
  })

  it('sends no `tax` and no `shipping` param beside an ex-tax value', () => {
    const params = buildStorefrontPurchaseParams({
      transactionId: 'cs_test_params',
      totalCents: AMOUNT_TOTAL,
      taxCents: TAX_CENTS,
      lineItems: [LINE],
    })
    expect(params).not.toHaveProperty('tax')
    expect(params).not.toHaveProperty('shipping')
    expect(params).not.toHaveProperty('billing_interval')
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
      lineItems: [LINE],
    })
    const reportedCents = Math.round((params?.value ?? 0) * 100)
    // goods (items - discount) + shipping + tax === what Stripe charged.
    expect(ITEMS_CENTS - DISCOUNT_CENTS + SHIPPING_CENTS).toBe(reportedCents)
    expect(reportedCents + TAX_CENTS).toBe(AMOUNT_TOTAL)
  })

  it('holds in a second jurisdiction, with no tax and no shipping', () => {
    const params = buildStorefrontPurchaseParams({
      transactionId: 'cs_test_no_tax',
      totalCents: 4999,
      taxCents: 0,
      lineItems: [
        { productId: 'p1', name: 'Zine', quantity: 1, unitAmountCents: 4999 },
      ],
    })
    expect(params?.value).toBe(49.99)
  })

  it('carries product ids and per-unit prices so the funnel joins', () => {
    const params = buildStorefrontPurchaseParams({
      transactionId: 'cs_test_items',
      totalCents: 6000,
      taxCents: 0,
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
      lineItems: [
        { productId: 'p1', name: 'A', quantity: 1, unitAmountCents: 1999 },
      ],
    })
    expect(String(params?.value)).toBe('59.99')
  })

  it('drops the event rather than fabricating one', () => {
    // A wrong number in a merchant's revenue report is worse than a gap.
    expect(
      buildStorefrontPurchaseParams({
        transactionId: '',
        totalCents: 1000,
        taxCents: 0,
        lineItems: [],
      }),
    ).toBeNull()
    // Tax-only or zeroed order — nothing truthful to report as revenue.
    expect(
      buildStorefrontPurchaseParams({
        transactionId: 'cs_test_zero',
        totalCents: 908,
        taxCents: 908,
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
        shippingCents: 0,
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
  })
})
