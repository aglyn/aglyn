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
 * The platform's own hardware sales on its sales tax return (AGL-4038): which
 * period a sale and a refund belong to, what counts as taxable, and what is
 * counted out loud rather than dropped. Integer cents throughout.
 */

import {
  posHardwareTaxableBase,
  posHardwareTaxSummary,
  type PosHardwareTaxRowInput,
} from './pos-hardware-tax-summary'

const Q4 = { start: new Date(Date.UTC(2026, 9, 1)), end: new Date(Date.UTC(2027, 0, 1)) }
const ms = (iso: string) => Date.parse(iso)

/** A shipped Texas order: $231.20 of items and shipping, $19.07 tax. */
const sale = (over: Partial<PosHardwareTaxRowInput> = {}): PosHardwareTaxRowInput => ({
  orderId: 'hw_1',
  totalCents: 25_027,
  taxCents: 1_907,
  currency: 'usd',
  shipTo: { country: 'US', state: 'TX', postalCode: '78701' },
  automaticTax: true,
  // One base, taxed at the state, city and transit levels: each line states it.
  taxLines: [
    { amountCents: 1_445, taxableAmountCents: 23_120, taxabilityReason: 'standard_rated', taxRateId: 'txr_state', percentage: 6.25 },
    { amountCents: 231, taxableAmountCents: 23_120, taxabilityReason: 'standard_rated', taxRateId: 'txr_city', percentage: 1 },
    { amountCents: 231, taxableAmountCents: 23_120, taxabilityReason: 'standard_rated', taxRateId: 'txr_mta', percentage: 1 },
  ],
  status: 'shipped',
  livemode: true,
  paidAtMs: ms('2026-11-03T15:00:00Z'),
  ...over,
})

describe('posHardwareTaxSummary', () => {
  it('sums a period’s sales by where they shipped: receipts less tax, the base once, the tax', () => {
    const summary = posHardwareTaxSummary(
      [sale(), sale({ orderId: 'hw_2', shipTo: { country: 'US', state: 'IL' }, totalCents: 14_000, taxCents: 0, taxLines: [{ amountCents: 0, taxableAmountCents: 0, taxabilityReason: 'not_collecting' }] })],
      Q4,
    )
    expect(summary).toMatchObject({
      orders: 2,
      totalSalesCents: 23_120 + 14_000,
      taxableSalesCents: 23_120,
      taxCollectedCents: 1_907,
      excluded: { testModeOrders: 0 },
    })
    expect(summary.byJurisdiction['US-TX']).toMatchObject({
      transactionCount: 1,
      totalSalesCents: 23_120,
      // Three lines each stating $231.20 are ONE base of $231.20, not $693.60.
      taxableSalesCents: 23_120,
      taxCollectedCents: 1_907,
      untaxedOrders: 0,
    })
    expect(summary.byJurisdiction['US-TX'].rates.map((rate) => rate.taxRateId)).toEqual([
      'txr_state',
      'txr_city',
      'txr_mta',
    ])
    // Stripe Tax ran in Illinois and collected nothing: not "sold untaxed".
    expect(summary.byJurisdiction['US-IL']).toMatchObject({ totalSalesCents: 14_000, untaxedOrders: 0 })
  })

  it('puts a sale in the period it was paid, half-open at both edges', () => {
    const rows = [
      sale({ orderId: 'first-instant', paidAtMs: Q4.start.getTime() }),
      sale({ orderId: 'last-instant', paidAtMs: Q4.end.getTime() - 1 }),
      sale({ orderId: 'next-period', paidAtMs: Q4.end.getTime() }),
      sale({ orderId: 'last-period', paidAtMs: Q4.start.getTime() - 1 }),
    ]
    expect(posHardwareTaxSummary(rows, Q4).orders).toBe(2)
  })

  it('keeps a sale in its own period whatever became of it later', () => {
    // Paid in Q4, canceled and refunded in Q1: a Q4 sale, and a Q1 refund.
    const canceled = sale({
      status: 'canceled',
      refundedCents: 25_027,
      canceledAtMs: ms('2027-01-04T10:00:00Z'),
    })
    const q4 = posHardwareTaxSummary([canceled], Q4)
    expect(q4).toMatchObject({ orders: 1, totalSalesCents: 23_120, refunds: { orders: 0 } })
    const q1 = posHardwareTaxSummary([canceled], { start: Q4.end, end: new Date(Date.UTC(2027, 3, 1)) })
    expect(q1).toMatchObject({
      orders: 0,
      totalSalesCents: 0,
      refunds: { orders: 1, refundedCents: 25_027, refundedSalesCents: 23_120, refundedTaxCents: 1_907 },
    })
    expect(q1.byJurisdiction['US-TX']).toMatchObject({ transactionCount: 0, refundedOrders: 1, refundedTaxCents: 1_907 })
  })

  it('states a sale and its refund in the same period side by side, never netted', () => {
    const summary = posHardwareTaxSummary(
      [sale({ status: 'refunded', refundedCents: 25_027, refundedAtMs: ms('2026-11-10T00:00:00Z') })],
      Q4,
    )
    expect(summary).toMatchObject({
      orders: 1,
      totalSalesCents: 23_120,
      taxCollectedCents: 1_907,
      refunds: { orders: 1, refundedSalesCents: 23_120, refundedTaxCents: 1_907 },
    })
  })

  it('dates a refund by the status that made it, so a canceled order’s cancel is the date', () => {
    const summary = posHardwareTaxSummary(
      [
        sale({
          status: 'canceled',
          refundedCents: 25_027,
          canceledAtMs: ms('2026-12-31T23:59:59Z'),
          // A stamp from an earlier staff refund attempt does not move it.
          refundedAtMs: ms('2027-02-01T00:00:00Z'),
        }),
      ],
      Q4,
    )
    expect(summary.refunds.orders).toBe(1)
  })

  it('splits a partial refund in the order’s own ratio, in whole cents', () => {
    const summary = posHardwareTaxSummary(
      [sale({ status: 'refunded', refundedCents: 10_000, refundedAtMs: ms('2026-11-10T00:00:00Z') })],
      Q4,
    )
    // 10 000 × 1 907 / 25 027 = 761.98… → 762.
    expect(summary.refunds).toEqual({ orders: 1, refundedCents: 10_000, refundedSalesCents: 9_238, refundedTaxCents: 762 })
  })

  it('counts a canceled order with no refund recorded as a sale, out loud', () => {
    const summary = posHardwareTaxSummary([sale({ status: 'canceled', canceledAtMs: ms('2026-11-04T00:00:00Z') })], Q4)
    expect(summary).toMatchObject({ orders: 1, refunds: { orders: 0 }, attention: { canceledWithoutRefund: 1 } })
  })

  it('leaves test-mode orders out of every figure, and says how many', () => {
    const summary = posHardwareTaxSummary(
      [sale({ livemode: false }), sale({ orderId: 'hw_live' }), sale({ orderId: 'hw_flag', livemode: 'true' as never })],
      Q4,
    )
    expect(summary).toMatchObject({ orders: 1, totalSalesCents: 23_120, excluded: { testModeOrders: 2 } })
  })

  it('counts an order sold without Stripe Tax, one taxed with no stated base, and one with no ship-to', () => {
    const summary = posHardwareTaxSummary(
      [
        sale({ orderId: 'untaxed', automaticTax: false, taxCents: 0, totalCents: 23_120, taxLines: [] }),
        sale({ orderId: 'no-base', taxLines: [{ amountCents: 1_907 }] }),
        sale({ orderId: 'nowhere', shipTo: null }),
      ],
      Q4,
    )
    expect(summary.attention).toEqual({
      untaxedOrders: 1,
      ordersMissingTaxableBase: 1,
      ordersMissingShipTo: 1,
      canceledWithoutRefund: 0,
    })
    expect(summary.byJurisdiction['US-TX'].untaxedOrders).toBe(1)
    expect(summary.byJurisdiction.unknown.transactionCount).toBe(1)
    // The base adds only what was stated: the untaxed and the unstated add 0.
    expect(summary.byJurisdiction['US-TX'].taxableSalesCents).toBe(0)
  })

  it('reads an order the reader found twice only once', () => {
    const refunded = sale({ status: 'refunded', refundedCents: 25_027, refundedAtMs: ms('2026-11-10T00:00:00Z') })
    expect(posHardwareTaxSummary([refunded, refunded], Q4)).toMatchObject({ orders: 1, refunds: { orders: 1 } })
  })
})

describe('posHardwareTaxableBase', () => {
  it('is the largest base stated, a stated zero is a zero, and nothing stated is null', () => {
    expect(posHardwareTaxableBase([{ taxableAmountCents: 100 }, { taxableAmountCents: 90 }])).toBe(100)
    expect(posHardwareTaxableBase([{ taxableAmountCents: 0 }])).toBe(0)
    expect(posHardwareTaxableBase([{ amountCents: 5 }, { taxableAmountCents: null }])).toBeNull()
    expect(posHardwareTaxableBase(null)).toBeNull()
  })
})
