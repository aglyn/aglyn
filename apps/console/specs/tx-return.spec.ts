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
 * A quarterly Texas return is computable from `platformRevenue` rows
 * (AGL-1811 — "record it per transaction so a return can be filed").
 *
 * The three figures the return asks for — total sales, taxable sales, tax
 * collected — must come out of stored rows alone, with no Stripe read; the
 * TX bucket must be separable from out-of-state revenue; and every row the
 * summary cannot fully read must be COUNTED, not skipped. The fixture
 * amounts are the measured live computation: $100.00 at 8.25% on an $80.00
 * base = $6.60 (`taxable_basis_reduced`, Jarrell TX).
 */

export {}

import {
  asRowDate,
  taxPeriodRange,
  taxReturnSummary,
  type TaxReturnRowInput,
} from '../utils/server/tx-return'

/** The measured TX row: $100 charge, 80% base, 8.25%, $6.60 collected. */
const TX_ROW: TaxReturnRowInput = {
  invoiceId: 'in_tx_1',
  orgId: 'org-1',
  grossCents: 10660,
  taxCents: 660,
  netCents: 10000,
  currency: 'usd',
  automaticTax: true,
  customerAddress: { country: 'US', state: 'TX' },
  taxLines: [
    {
      amountCents: 660,
      taxabilityReason: 'taxable_basis_reduced',
      taxRateId: 'txr_tx_state',
      taxableAmountCents: 8000,
    },
  ],
  paidAt: new Date('2026-09-15T12:00:00Z'),
}

const Q3_2026 = taxPeriodRange('2026-Q3')!

describe('taxPeriodRange', () => {
  it('a calendar quarter is half-open UTC month bounds', () => {
    expect(taxPeriodRange('2026-Q3')).toEqual({
      start: new Date(Date.UTC(2026, 6, 1)),
      end: new Date(Date.UTC(2026, 9, 1)),
    })
    // Q4 crosses the year boundary.
    expect(taxPeriodRange('2026-Q4')!.end).toEqual(new Date(Date.UTC(2027, 0, 1)))
  })

  it('a month works for a monthly filer; garbage refuses', () => {
    expect(taxPeriodRange('2026-09')).toEqual({
      start: new Date(Date.UTC(2026, 8, 1)),
      end: new Date(Date.UTC(2026, 9, 1)),
    })
    for (const bad of ['2026', '2026-Q5', '2026-13', 'yes', '', 'Q3-2026']) {
      expect([bad, taxPeriodRange(bad)]).toEqual([bad, null])
    }
  })
})

describe('taxReturnSummary computes the figures the return asks for', () => {
  it('THE RETURN: total sales ex-tax, taxable sales at the 80% base, tax collected', () => {
    const summary = taxReturnSummary([TX_ROW], Q3_2026)
    // Total sales = receipts excluding the tax itself ($106.60 − $6.60).
    expect(summary.totalSalesCents).toBe(10000)
    // Taxable sales = the stated base, NOT the receipts — the §151.351
    // 20% exemption is the difference, and conflating them overfiles.
    expect(summary.taxableSalesCents).toBe(8000)
    expect(summary.taxCollectedCents).toBe(660)
    expect(summary.transactionCount).toBe(1)
    expect(summary.byJurisdiction['US-TX']).toEqual({
      transactionCount: 1,
      totalSalesCents: 10000,
      taxableSalesCents: 8000,
      taxCollectedCents: 660,
    })
  })

  it('separates out-of-state revenue — the TX bucket IS the return', () => {
    const caRow: TaxReturnRowInput = {
      ...TX_ROW,
      invoiceId: 'in_ca_1',
      grossCents: 5000,
      taxCents: 0,
      taxLines: [],
      automaticTax: true,
      customerAddress: { country: 'US', state: 'CA' },
    }
    const summary = taxReturnSummary([TX_ROW, caRow], Q3_2026)
    expect(summary.byJurisdiction['US-TX'].taxCollectedCents).toBe(660)
    expect(summary.byJurisdiction['US-CA']).toEqual({
      transactionCount: 1,
      totalSalesCents: 5000,
      taxableSalesCents: 0,
      taxCollectedCents: 0,
    })
    // The headline still carries everything — the split is the audit trail.
    expect(summary.totalSalesCents).toBe(15000)
  })

  it('counts what it cannot read instead of skipping it', () => {
    const rows: TaxReturnRowInput[] = [
      // Billed before its subscription gained tax (the live Feb invoice).
      { ...TX_ROW, invoiceId: 'in_untaxed', taxCents: 0, taxLines: [], automaticTax: false },
      // Tax collected but no line states its base (pre-taxableAmount rows).
      {
        ...TX_ROW,
        invoiceId: 'in_no_base',
        taxLines: [{ amountCents: 660, taxabilityReason: null, taxRateId: null, taxableAmountCents: null }],
      },
      // No address, no paidAt, foreign currency.
      {
        ...TX_ROW,
        invoiceId: 'in_bare',
        currency: 'eur',
        customerAddress: null,
        paidAt: null,
      },
    ]
    const summary = taxReturnSummary(rows, Q3_2026)
    expect(summary.attention).toEqual({
      untaxedRows: 1,
      rowsMissingTaxableBase: 1,
      rowsMissingAddress: 1,
      nonUsdRows: 1,
      rowsMissingPaidAt: 1,
    })
    // Counted AND summed — attention is a flag, not an exclusion.
    expect(summary.transactionCount).toBe(3)
    expect(summary.byJurisdiction['unknown'].transactionCount).toBe(1)
  })

  it('reports refunds stamped in the period, tax share proportioned per row', () => {
    const refunded: TaxReturnRowInput = {
      ...TX_ROW,
      invoiceId: 'in_refunded',
      refundedCents: 5330, // half the gross
      refundRecordedAt: new Date('2026-09-20T00:00:00Z'),
    }
    const summary = taxReturnSummary([refunded], Q3_2026)
    expect(summary.refunds.rowsRefundedInPeriod).toBe(1)
    expect(summary.refunds.refundedGrossCents).toBe(5330)
    // 5330 × 660 / 10660 = 330 — half the tax came back with half the gross.
    expect(summary.refunds.estimatedRefundedTaxCents).toBe(330)
  })

  it('a refund stamped OUTSIDE the period stays off this period', () => {
    const refunded: TaxReturnRowInput = {
      ...TX_ROW,
      refundedCents: 5330,
      refundRecordedAt: new Date('2026-11-20T00:00:00Z'),
    }
    const summary = taxReturnSummary([refunded], Q3_2026)
    expect(summary.refunds.rowsRefundedInPeriod).toBe(0)
    expect(summary.refunds.refundedGrossCents).toBe(0)
  })

  it('reads Firestore-Timestamp-shaped dates (`toDate()`), the form the route hands it', () => {
    const timestamp = { toDate: () => new Date('2026-09-15T12:00:00Z') }
    expect(asRowDate(timestamp)).toEqual(new Date('2026-09-15T12:00:00Z'))
    const summary = taxReturnSummary(
      [{ ...TX_ROW, paidAt: timestamp, refundedCents: 100, refundRecordedAt: timestamp }],
      Q3_2026,
    )
    expect(summary.attention.rowsMissingPaidAt).toBe(0)
    expect(summary.refunds.rowsRefundedInPeriod).toBe(1)
  })

  it('total: garbage rows cannot throw — they count and sum as zeros', () => {
    const summary = taxReturnSummary(
      [{ invoiceId: 'in_garbage', grossCents: 'x', taxCents: {}, taxLines: 'no' as never }],
      Q3_2026,
    )
    expect(summary.transactionCount).toBe(1)
    expect(summary.totalSalesCents).toBe(0)
  })
})
