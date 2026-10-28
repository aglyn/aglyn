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
 * The operator's own stores on its return (AGL-4038): everything sold from
 * them is its own sale, whatever the product, in the period it was paid, with
 * refunds in the period they were made, once each, and a merchant's store is
 * never one of them.
 */

import {
  ownStoreOrderPaidAt,
  ownStoreTaxSummary,
  platformOwnStoreOrgId,
  statedTaxableBase,
  type OwnStore,
  type OwnStoreOrderInput,
} from './own-store-tax-summary'

const Q4 = { start: new Date(Date.UTC(2026, 9, 1)), end: new Date(Date.UTC(2027, 0, 1)) }
const ms = (iso: string) => Date.parse(iso)

const STORE: OwnStore = { hostId: 'host-own', name: 'Platform Shop', origin: { country: 'US', state: 'TX' } }

/** A register sale at the booth: a card reader and a T-shirt, taxed at the store's rate. */
const registerSale: OwnStoreOrderInput = {
  hostId: 'host-own',
  orderId: 'pos_1',
  status: 'paid',
  channel: 'pos',
  totals: { totalCents: 35_181, taxCents: 2_681 },
  paidAtMs: ms('2026-11-07T18:00:00Z'),
  createdAtMs: ms('2026-11-07T17:59:00Z'),
  payments: [{ status: 'succeeded', livemode: true }],
}

/** Apparel sold online, shipped to Oklahoma, taxed by Stripe Tax. */
const apparelOnline: OwnStoreOrderInput = {
  hostId: 'host-own',
  orderId: 'cs_live_hoodie',
  status: 'fulfilled',
  channel: 'online',
  totals: { totalCents: 5_850, taxCents: 450 },
  livemode: true,
  createdAtMs: ms('2026-12-01T10:00:00Z'),
  timeline: [{ atMs: ms('2026-12-01T10:00:00Z'), event: 'paid' }],
  shippingAddress: { country: 'US', state: 'OK' },
}

const summarize = (orders: OwnStoreOrderInput[], statedBases?: Map<string, number>) =>
  ownStoreTaxSummary({ stores: [STORE], orders, period: Q4, statedBases })

describe('platformOwnStoreOrgId', () => {
  it('is the workspace named as owning the platform’s own store, whether or not readers sell in person', () => {
    expect(platformOwnStoreOrgId({ POS_HARDWARE_SELLER_ORG_ID: ' org-own ' })).toBe('org-own')
    expect(platformOwnStoreOrgId({ POS_HARDWARE_SELLER_ORG_ID: 'org-own', POS_HARDWARE_IN_PERSON_ENABLED: 'false' })).toBe(
      'org-own',
    )
    expect(platformOwnStoreOrgId({})).toBeNull()
    expect(platformOwnStoreOrgId({ POS_HARDWARE_SELLER_ORG_ID: 'not/an id' })).toBeNull()
  })
})

describe('ownStoreTaxSummary', () => {
  it('folds a register sale in where the store is, and an online sale where it shipped, as two parts', () => {
    const { summary } = summarize([registerSale, apparelOnline])
    expect(summary.parts).toEqual([
      {
        id: 'ownStore:host-own:in-person',
        label: 'Platform Shop — sold in person',
        byJurisdiction: {
          'US-TX': {
            transactionCount: 1,
            totalSalesCents: 32_500,
            taxableSalesCents: 32_500,
            taxCollectedCents: 2_681,
            refundCount: 0,
            refundedSalesCents: 0,
            refundedTaxCents: 0,
          },
        },
      },
      {
        id: 'ownStore:host-own:online',
        label: 'Platform Shop — sold online',
        byJurisdiction: {
          'US-OK': {
            transactionCount: 1,
            totalSalesCents: 5_400,
            taxableSalesCents: 5_400,
            taxCollectedCents: 450,
            refundCount: 0,
            refundedSalesCents: 0,
            refundedTaxCents: 0,
          },
        },
      },
    ])
    expect(summary.orders).toBe(2)
  })

  it('counts a product that is not hardware (apparel) like any other sale of the store', () => {
    const { rows } = summarize([apparelOnline])
    expect(rows).toEqual([
      expect.objectContaining({ orderId: 'cs_live_hoodie', channel: 'online', jurisdiction: 'US-OK', totalSalesCents: 5_400 }),
    ])
  })

  it('never reads a merchant’s store, even handed its order', () => {
    const { summary, rows } = summarize([{ ...apparelOnline, hostId: 'host-merchant', orderId: 'cs_live_other' }])
    expect(summary.parts).toEqual([])
    expect(rows).toEqual([])
  })

  it('puts a sale in the period it was paid, half-open at both edges', () => {
    const atStart = { ...registerSale, orderId: 'start', paidAtMs: Q4.start.getTime() }
    const atEnd = { ...registerSale, orderId: 'end', paidAtMs: Q4.end.getTime() }
    const lastInstant = { ...registerSale, orderId: 'last', paidAtMs: Q4.end.getTime() - 1 }
    const before = { ...registerSale, orderId: 'before', paidAtMs: Q4.start.getTime() - 1 }
    expect(summarize([atStart, atEnd, lastInstant, before]).rows.map((row) => row.orderId)).toEqual(['start', 'last'])
  })

  it('places a draft placed last quarter and paid this quarter in this quarter', () => {
    const draft: OwnStoreOrderInput = {
      ...apparelOnline,
      orderId: 'draft_1',
      channel: 'draft',
      createdAtMs: ms('2026-09-20T00:00:00Z'),
      timeline: [{ atMs: ms('2026-10-04T00:00:00Z'), event: 'paid' }],
    }
    expect(ownStoreOrderPaidAt(draft)).toBe(ms('2026-10-04T00:00:00Z'))
    expect(summarize([draft]).summary.orders).toBe(1)
  })

  it('states a refund in the period it was made, never netted from the sale', () => {
    const refundedLater: OwnStoreOrderInput = {
      ...registerSale,
      orderId: 'pos_q3',
      status: 'refunded',
      paidAtMs: ms('2026-09-15T00:00:00Z'),
      refundedCents: 35_181,
      timeline: [{ atMs: ms('2026-10-10T00:00:00Z'), event: 'refund' }],
    }
    const { summary, rows } = summarize([refundedLater])
    expect(summary.orders).toBe(0)
    expect(summary.parts[0].byJurisdiction['US-TX']).toEqual({
      transactionCount: 0,
      totalSalesCents: 0,
      taxableSalesCents: 0,
      taxCollectedCents: 0,
      refundCount: 1,
      refundedSalesCents: 32_500,
      refundedTaxCents: 2_681,
    })
    expect(rows[0].inPeriodAs).toBe('refund')
    // The quarter it was paid in keeps it as a sale, whatever became of it.
    const q3 = ownStoreTaxSummary({
      stores: [STORE],
      orders: [refundedLater],
      period: { start: new Date(Date.UTC(2026, 6, 1)), end: Q4.start },
    })
    expect(q3.summary.parts[0].byJurisdiction['US-TX']).toMatchObject({ transactionCount: 1, refundCount: 0 })
  })

  it('splits a partial refund’s tax in the order’s own ratio, by its latest refund', () => {
    const partial: OwnStoreOrderInput = {
      ...registerSale,
      refundedCents: 10_825,
      timeline: [
        { atMs: ms('2026-11-08T00:00:00Z'), event: 'refund' },
        { atMs: ms('2026-11-09T00:00:00Z'), event: 'refunded' },
      ],
    }
    const figures = summarize([partial]).summary.parts[0].byJurisdiction['US-TX']
    expect(figures).toMatchObject({ transactionCount: 1, refundCount: 1, refundedTaxCents: 825, refundedSalesCents: 10_000 })
    expect(summarize([partial]).rows[0]).toMatchObject({ inPeriodAs: 'sale and refund', refundedAt: '2026-11-09T00:00:00.000Z' })
  })

  it('treats a voided register sale and a lapsed draft as no sale, and a paid order canceled without a refund as one, out loud', () => {
    const voided: OwnStoreOrderInput = {
      hostId: 'host-own',
      orderId: 'void',
      status: 'cancelled',
      channel: 'pos',
      totals: { totalCents: 2_000, taxCents: 0 },
      createdAtMs: ms('2026-11-01T00:00:00Z'),
    }
    const lapsed: OwnStoreOrderInput = { ...voided, orderId: 'lapsed', status: 'pending', channel: 'draft' }
    const canceledPaid: OwnStoreOrderInput = { ...registerSale, orderId: 'canceled', status: 'cancelled' }
    const { summary } = summarize([voided, lapsed, canceledPaid])
    expect(summary.orders).toBe(1)
    expect(summary.attention.canceledWithoutRefund).toBe(1)
  })

  it('leaves test-mode sales out of every figure, and says how many', () => {
    const cardTest = { ...registerSale, orderId: 'test_card', payments: [{ status: 'succeeded', livemode: false }] }
    const sessionTest = { ...apparelOnline, orderId: 'cs_test_hoodie', livemode: undefined }
    const { summary } = summarize([cardTest, sessionTest, registerSale])
    expect(summary.excluded.testModeOrders).toBe(2)
    expect(summary.orders).toBe(1)
  })

  it('leaves out a sale on an outside marketplace that remits the tax itself', () => {
    const etsy: OwnStoreOrderInput = {
      ...apparelOnline,
      orderId: 'mkt_1',
      channel: 'marketplace',
      channelSource: { taxRemittedByChannel: true },
    }
    const { summary } = summarize([etsy])
    expect(summary.excluded.marketplaceRemitted).toBe(1)
    expect(summary.parts).toEqual([])
  })

  it('takes the base Stripe stated, else the whole sale when taxed, and counts an untaxed sale', () => {
    const untaxed: OwnStoreOrderInput = { ...registerSale, orderId: 'free_tax', totals: { totalCents: 1_000, taxCents: 0 } }
    const { rows, summary } = summarize([apparelOnline, registerSale, untaxed], new Map([['cs_live_hoodie', 5_000]]))
    expect(rows.map((row) => [row.orderId, row.taxableBase, row.taxableSalesCents])).toEqual([
      ['cs_live_hoodie', 'stated', 5_000],
      ['pos_1', 'whole sale', 32_500],
      ['free_tax', 'untaxed', 0],
    ])
    expect(summary.attention.untaxedOrders).toBe(1)
  })

  it('counts a sale with no region out loud, under `unknown`', () => {
    const nowhere: OwnStoreOrderInput = { ...apparelOnline, shippingAddress: null, billingAddress: null }
    const noOrigin = ownStoreTaxSummary({ stores: [{ ...STORE, origin: null }], orders: [registerSale], period: Q4 })
    expect(summarize([nowhere]).summary.attention.ordersMissingRegion).toBe(1)
    expect(Object.keys(noOrigin.summary.parts[0].byJurisdiction)).toEqual(['unknown'])
  })

  it('reads an order handed twice only once', () => {
    expect(summarize([registerSale, registerSale]).summary.orders).toBe(1)
  })
})

describe('statedTaxableBase', () => {
  it('is the largest stated base, since each level restates it, and null when nothing is stated', () => {
    expect(statedTaxableBase([{ taxableAmountCents: 5_000 }, { taxableAmountCents: 5_000 }, { taxableAmountCents: 4_000 }])).toBe(
      5_000,
    )
    expect(statedTaxableBase([{ taxableAmountCents: 0 }])).toBe(0)
    expect(statedTaxableBase([{}, null])).toBeNull()
    expect(statedTaxableBase(undefined)).toBeNull()
  })
})
