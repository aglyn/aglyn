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

import { allocateCents, dateInZone, decimalToCents, isIsoDate } from './accounting-money'
import type { AccountingOrderSnapshot, AccountingRefundSnapshot } from './accounting-sources'
import {
  AccountingTransformError,
  buildFeeDoc,
  buildFeeRefundDoc,
  buildPayoutDoc,
  buildRefundDoc,
  buildSaleDoc,
  buildSummaryDoc,
  hostCode,
  orderExternalId,
  refundExternalId,
  refundPostings,
  salePostings,
} from './accounting-transforms'
import type { AccountingMapping } from './accounting.types'

const mapping: AccountingMapping = {
  accounts: {
    income: 'inc',
    clearing: 'clr',
    feeExpense: 'fee',
    payoutBank: 'bank',
    taxLiability: 'tax',
  },
  taxCodes: { taxed: 'TAX', untaxed: 'NON', 'rate-ca': 'CA' },
  syncMode: 'per-order',
  startDate: null,
  timeZone: 'America/Chicago',
}

function order(overrides: Partial<AccountingOrderSnapshot> = {}): AccountingOrderSnapshot {
  return {
    orgId: 'org-1',
    hostId: 'host-1',
    orderId: 'order-1',
    number: 1042,
    currency: 'usd',
    paidAtMs: Date.UTC(2026, 9, 6, 15, 0),
    channel: 'online',
    customerName: 'Ada Lovelace',
    customerEmail: 'ADA@example.com',
    lines: [
      { name: 'Mug', quantity: 2, unitAmountCents: 1250 },
      { name: 'Shirt', variantLabel: 'Large', quantity: 1, unitAmountCents: 2000, sku: 'SH-L' },
    ],
    totals: { itemsCents: 4500, shippingCents: 500, taxCents: 330, discountCents: 400, totalCents: 4930, feeCents: 148 },
    taxInclusive: false,
    taxKey: null,
    ...overrides,
  }
}

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)

describe('money helpers', () => {
  it('allocates cents exactly, the remainder to the largest fractions', () => {
    expect(allocateCents(100, [1, 1, 1])).toEqual([34, 33, 33])
    expect(sum(allocateCents(331, [2500, 2000, 500]))).toBe(331)
    expect(allocateCents(10, [0, 0])).toEqual([10, 0])
    expect(allocateCents(-7, [1, 1])).toEqual([-4, -3])
  })

  it('converts decimals to cents without float drift', () => {
    expect(decimalToCents(19.99)).toBe(1999)
    expect(decimalToCents('0.1')).toBe(10)
    expect(decimalToCents(-2.345)).toBe(-235)
  })

  it('dates an instant in the mapping zone, not UTC', () => {
    // 03:00 UTC on the 7th is still the 6th in Chicago.
    expect(dateInZone(Date.UTC(2026, 9, 7, 3, 0), 'America/Chicago')).toBe('2026-10-06')
    expect(dateInZone(Date.UTC(2026, 9, 7, 3, 0), 'Not/AZone')).toBe('2026-10-07')
    expect(isIsoDate('2026-02-30')).toBe(false)
  })
})

describe('external ids', () => {
  it('is stable, per site, and fits QuickBooks DocNumber', () => {
    expect(hostCode('host-1')).toBe(hostCode('host-1'))
    expect(hostCode('host-1')).not.toBe(hostCode('host-2'))
    const id = orderExternalId(order())
    expect(id).toMatch(/^[0-9A-Z]{4}-1042$/)
    const refund: AccountingRefundSnapshot = {
      order: order(),
      refundId: 're_123',
      amountCents: 100,
      refundedAtMs: 0,
      feeRefundedCents: 0,
    }
    expect(refundExternalId(refund).length).toBeLessThanOrEqual(21)
    expect(orderExternalId(order({ number: null, orderId: 'abc/def-ghijkl' }))).toMatch(/-abcdefgh$/)
  })
})

describe('buildSaleDoc', () => {
  it('posts a tax-exclusive order whose lines and tax add up to the total', () => {
    const doc = buildSaleDoc(order(), mapping)
    expect(doc.taxTreatment).toBe('exclusive')
    expect(doc.date).toBe('2026-10-06')
    expect(doc.currency).toBe('USD')
    expect(doc.customer).toEqual({ name: 'Ada Lovelace', email: 'ada@example.com' })
    expect(doc.lines.map((line) => [line.kind, line.amountCents, line.accountId])).toEqual([
      ['item', 2500, 'inc'],
      ['item', 2000, 'inc'],
      ['shipping', 500, 'inc'],
      ['discount', -400, 'inc'],
    ])
    expect(doc.lines[1].description).toBe('Shirt — Large')
    expect(sum(doc.lines.map((line) => line.amountCents)) + doc.taxCents).toBe(doc.totalCents)
    expect(sum(doc.lines.map((line) => line.taxCents))).toBe(330)
    expect(doc.lines[3].taxCents).toBe(0)
    expect(doc.taxCodeId).toBe('TAX')
    expect(doc.depositAccountId).toBe('clr')
  })

  it('posts shipping to its own account when one is mapped', () => {
    const doc = buildSaleDoc(order(), { ...mapping, accounts: { ...mapping.accounts, shippingIncome: 'ship' } })
    expect(doc.lines.find((line) => line.kind === 'shipping')?.accountId).toBe('ship')
  })

  it('posts a tax-inclusive order whose lines alone are the total', () => {
    const doc = buildSaleDoc(
      order({
        taxInclusive: true,
        totals: { itemsCents: 4500, shippingCents: 500, taxCents: 833, discountCents: 0, totalCents: 5000, feeCents: 0 },
      }),
      mapping,
    )
    expect(doc.taxTreatment).toBe('inclusive')
    expect(sum(doc.lines.map((line) => line.amountCents))).toBe(5000)
    expect(sum(doc.lines.map((line) => line.taxCents))).toBe(833)
  })

  it('posts an untaxed order with the untaxed code and no tax', () => {
    const doc = buildSaleDoc(
      order({ totals: { itemsCents: 4500, shippingCents: 0, taxCents: 0, discountCents: 0, totalCents: 4500, feeCents: 0 } }),
      mapping,
    )
    expect(doc.taxTreatment).toBe('none')
    expect(doc.taxCodeId).toBe('NON')
    expect(doc.taxCents).toBe(0)
  })

  it('uses a finer tax key when the order names one, the base key when it is unmapped', () => {
    expect(buildSaleDoc(order({ taxKey: 'rate-ca' }), mapping).taxCodeId).toBe('CA')
    expect(buildSaleDoc(order({ taxKey: 'rate-ny' }), mapping).taxCodeId).toBe('TAX')
  })

  it('posts a rounding difference as its own line rather than moving a price', () => {
    const doc = buildSaleDoc(
      order({ totals: { itemsCents: 4500, shippingCents: 500, taxCents: 330, discountCents: 400, totalCents: 4931, feeCents: 0 } }),
      mapping,
    )
    const rounding = doc.lines.find((line) => line.kind === 'adjustment')
    expect(rounding).toMatchObject({ description: 'Rounding', amountCents: 1 })
    expect(sum(doc.lines.map((line) => line.amountCents)) + doc.taxCents).toBe(4931)
  })

  it('refuses totals that are off by more than rounding', () => {
    expect(() =>
      buildSaleDoc(
        order({ totals: { itemsCents: 4500, shippingCents: 500, taxCents: 330, discountCents: 400, totalCents: 6000, feeCents: 0 } }),
        mapping,
      ),
    ).toThrow(expect.objectContaining({ code: 'totals-mismatch' }))
  })

  it('refuses an unmapped account by name', () => {
    expect(() => buildSaleDoc(order(), { ...mapping, accounts: { ...mapping.accounts, clearing: undefined } })).toThrow(
      /Stripe clearing account/,
    )
  })

  it('keeps the order currency for a multi-currency store', () => {
    expect(buildSaleDoc(order({ currency: 'eur' }), mapping).currency).toBe('EUR')
  })

  it('files a sale with no name or address under the walk-in customer', () => {
    expect(buildSaleDoc(order({ customerName: null, customerEmail: null }), mapping).customer).toEqual({
      name: 'Online customer',
      email: null,
    })
  })
})

describe('refunds, fees and payouts', () => {
  const refund = (amountCents: number, extra: Partial<AccountingRefundSnapshot> = {}): AccountingRefundSnapshot => ({
    order: order(),
    refundId: 're_1',
    amountCents,
    refundedAtMs: Date.UTC(2026, 9, 8, 12),
    feeRefundedCents: 0,
    ...extra,
  })

  it('gives back the tax in proportion on a partial refund', () => {
    const doc = buildRefundDoc(refund(2465), mapping)
    // Half the total gives back half the tax.
    expect(doc.taxCents).toBe(165)
    expect(doc.lines[0].amountCents + doc.taxCents).toBe(2465)
    expect(doc.saleExternalId).toBe(orderExternalId(order()))
  })

  it('gives back all the tax on a full refund, and refuses a refund larger than the sale', () => {
    expect(buildRefundDoc(refund(4930), mapping).taxCents).toBe(330)
    expect(() => buildRefundDoc(refund(5000), mapping)).toThrow(AccountingTransformError)
  })

  it('expenses the platform fee out of clearing, and returns a fee given back', () => {
    expect(buildFeeDoc(order(), mapping)).toMatchObject({
      amountCents: 148,
      expenseAccountId: 'fee',
      bankAccountId: 'clr',
      credit: false,
    })
    expect(buildFeeDoc(order({ totals: { ...order().totals, feeCents: 0 } }), mapping)).toBeNull()
    expect(buildFeeRefundDoc(refund(100, { feeRefundedCents: 30 }), mapping)).toMatchObject({ amountCents: 30, credit: true })
    expect(buildFeeRefundDoc(refund(100), mapping)).toBeNull()
  })

  it('moves a payout from clearing to the bank', () => {
    expect(
      buildPayoutDoc(
        { orgId: 'org-1', payoutId: 'po_123', amountCents: 9900, currency: 'usd', arrivedAtMs: 0, statementDescriptor: null },
        mapping,
      ),
    ).toMatchObject({ externalId: 'PO-123', fromAccountId: 'clr', toAccountId: 'bank', amountCents: 9900 })
  })
})

describe('the daily summary', () => {
  it('nets a day of sales, refunds and fees into one balanced journal', () => {
    const postings = [
      ...salePostings(order()),
      ...salePostings(order({ orderId: 'order-2', taxInclusive: true })),
      ...refundPostings({ order: order(), refundId: 're_1', amountCents: 1000, refundedAtMs: 0, feeRefundedCents: 10 }),
    ]
    expect(sum(postings.map((posting) => posting.cents))).toBe(0)
    const doc = buildSummaryDoc({ date: '2026-10-06', currency: 'usd', postings, orderCount: 2 }, mapping)
    expect(doc).not.toBeNull()
    const debits = sum(doc!.lines.map((line) => line.debitCents))
    const credits = sum(doc!.lines.map((line) => line.creditCents))
    expect(debits).toBe(credits)
    expect(doc!.externalId).toBe('AGD-20261006-USD')
    expect(doc!.lines.find((line) => line.accountId === 'tax')?.creditCents).toBeGreaterThan(0)
  })

  it('answers nothing for a day that nets to zero', () => {
    expect(buildSummaryDoc({ date: '2026-10-06', currency: 'usd', postings: [], orderCount: 0 }, mapping)).toBeNull()
  })
})
