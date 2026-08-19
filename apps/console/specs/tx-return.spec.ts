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
      // THE WORKING PAPERS (AGL-2329). `taxabilityReason` and `taxRateId`
      // have been on every line since the writer added them and no reader
      // projected either. `taxable_basis_reduced` is precisely the fact the
      // §151.351 20% exemption turns on — the reason the taxable base is
      // $80 against $100 of receipts — and a return stating the base with no
      // reason beside it cannot be checked against the exemption it claims.
      taxabilityReasons: {
        taxable_basis_reduced: {
          lines: 1,
          taxableAmountCents: 8000,
          taxCollectedCents: 660,
        },
      },
      rates: [
        {
          taxRateId: 'txr_tx_state',
          percentage: null,
          rateState: null,
          jurisdiction: null,
          lines: 1,
          taxableAmountCents: 8000,
          taxCollectedCents: 660,
        },
      ],
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
      // No lines at all, so no papers — an EMPTY working paper, not an
      // inherited copy of the Texas one beside it.
      taxabilityReasons: {},
      rates: [],
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
      /*
       * ONE, and it is real (AGL-2329).
       *
       * `in_untaxed` spreads `TX_ROW` and zeroes `taxCents` while leaving
       * the gross and the stored `netCents` alone, so the stored net no
       * longer equals `gross − tax`. That is exactly the drift the check
       * exists for: before it, the summary silently recomputed and the
       * contradiction went unmentioned on a filing record. The fixture
       * having it by accident is the point — a hand-edited row looks like
       * this.
       */
      rowsWithNetMismatch: 1,
    })
    // Counted AND summed — attention is a flag, not an exclusion.
    expect(summary.transactionCount).toBe(3)
    expect(summary.byJurisdiction['unknown'].transactionCount).toBe(1)
  })

  /*==========================================
   * THE WORKING PAPERS (AGL-2329).
   *
   * `taxabilityReason` and `taxRateId` are written on every tax line and no
   * reader projected either, so the return could state a jurisdiction's
   * total and not say WHY. That is the difference between a figure and a
   * working paper: $0 of tax in a state reads identically whether we are
   * unregistered there, the product is exempt, or the rate is genuinely
   * zero, and those are three different answers to an examiner.
   *
   * The fixtures below give every reason and every rate DIFFERENT money, so
   * an accumulator that attributed the first line's figures to every bucket
   * — the plausible bug — produces a visibly wrong answer.
   *=========================================*/
  it('files each taxability reason separately, with its own money', () => {
    const mixed: TaxReturnRowInput = {
      ...TX_ROW,
      invoiceId: 'in_mixed',
      grossCents: 20000,
      taxCents: 900,
      netCents: 19100,
      taxLines: [
        {
          amountCents: 660,
          taxabilityReason: 'taxable_basis_reduced',
          taxRateId: 'txr_tx_state',
          taxableAmountCents: 8000,
        },
        {
          amountCents: 240,
          taxabilityReason: 'standard_rated',
          taxRateId: 'txr_tx_local',
          taxableAmountCents: 3000,
        },
        {
          amountCents: 0,
          taxabilityReason: 'product_exempt',
          taxRateId: 'txr_tx_state',
          taxableAmountCents: 5000,
        },
      ],
    }
    const reasons =
      taxReturnSummary([mixed], Q3_2026).byJurisdiction['US-TX']
        .taxabilityReasons

    // Three reasons, three different figures. Each is asserted on its own,
    // so a bucket carrying another's total cannot pass.
    expect(reasons['taxable_basis_reduced']).toEqual({
      lines: 1,
      taxableAmountCents: 8000,
      taxCollectedCents: 660,
    })
    expect(reasons['standard_rated']).toEqual({
      lines: 1,
      taxableAmountCents: 3000,
      taxCollectedCents: 240,
    })
    // THE ZERO-TAX ROW IS THE POINT. $50 of base collected nothing, and the
    // paper says the product was exempt rather than leaving a reader to
    // guess between exemption and non-registration.
    expect(reasons['product_exempt']).toEqual({
      lines: 1,
      taxableAmountCents: 5000,
      taxCollectedCents: 0,
    })

    // And they RECONCILE with the jurisdiction total. A working paper whose
    // parts do not sum to the figure above it is worse than no paper.
    const summed = Object.values(reasons).reduce(
      (total, reason) => total + reason.taxCollectedCents,
      0,
    )
    expect(summed).toBe(
      taxReturnSummary([mixed], Q3_2026).byJurisdiction['US-TX']
        .taxCollectedCents,
    )
  })

  it('files a line stating no reason under `unstated` rather than dropping it', () => {
    const bare: TaxReturnRowInput = {
      ...TX_ROW,
      invoiceId: 'in_bare_reason',
      taxLines: [
        { amountCents: 660, taxRateId: null, taxableAmountCents: 8000 },
      ],
    }
    const reasons =
      taxReturnSummary([bare], Q3_2026).byJurisdiction['US-TX']
        .taxabilityReasons
    // NOT folded into `standard_rated`, which would assert a fact nobody
    // recorded, and not dropped, which would break the reconciliation above.
    expect(reasons['unstated']).toEqual({
      lines: 1,
      taxableAmountCents: 8000,
      taxCollectedCents: 660,
    })
    expect(reasons['standard_rated']).toBeUndefined()
  })

  it('keeps one rate id at two percentages apart, dearest first', () => {
    // A rate whose percentage changed mid-period is TWO rates on a return,
    // and merging them by id alone hides exactly the change being checked
    // for. The cheaper one is listed FIRST in the fixture, so insertion
    // order and the required order disagree.
    const changed: TaxReturnRowInput = {
      ...TX_ROW,
      invoiceId: 'in_rate_change',
      taxCents: 900,
      netCents: undefined,
      taxLines: [
        {
          amountCents: 240,
          taxabilityReason: 'standard_rated',
          taxRateId: 'txr_tx_state',
          taxableAmountCents: 3000,
          percentage: 6.25,
        },
        {
          amountCents: 660,
          taxabilityReason: 'standard_rated',
          taxRateId: 'txr_tx_state',
          taxableAmountCents: 8000,
          percentage: 8.25,
        },
      ],
    }
    const rates =
      taxReturnSummary([changed], Q3_2026).byJurisdiction['US-TX'].rates
    expect(rates).toHaveLength(2)
    expect(rates.map((rate) => rate.percentage)).toEqual([8.25, 6.25])
    expect(rates.map((rate) => rate.taxCollectedCents)).toEqual([660, 240])
    // The reason bucket still sees both, as one reason with two lines —
    // the two views answer different questions off the same lines.
    expect(
      taxReturnSummary([changed], Q3_2026).byJurisdiction['US-TX']
        .taxabilityReasons['standard_rated'].lines,
    ).toBe(2)
  })

  it('states the bank\'s share of a reversal separately from ours', () => {
    // A refund we chose to give and a payment a bank clawed back are the
    // same money and different facts. `chargedBackCents` was maintained for
    // exactly this distinction and read only by the webhook that wrote it.
    const disputed: TaxReturnRowInput = {
      ...TX_ROW,
      invoiceId: 'in_disputed',
      refundedCents: 4000,
      chargedBackCents: 2500,
      refundRecordedAt: new Date('2026-08-01T00:00:00Z'),
    }
    const goodwill: TaxReturnRowInput = {
      ...TX_ROW,
      invoiceId: 'in_goodwill',
      refundedCents: 1000,
      refundRecordedAt: new Date('2026-08-02T00:00:00Z'),
    }
    const refunds = taxReturnSummary([disputed, goodwill], Q3_2026).refunds

    expect(refunds.rowsRefundedInPeriod).toBe(2)
    expect(refunds.refundedGrossCents).toBe(5000)
    // A SUBSET of the gross above, never an addition to it — the two rows
    // differ, so a figure copying `refundedGrossCents` or counting every row
    // is visibly wrong.
    expect(refunds.chargedBackCents).toBe(2500)
    expect(refunds.rowsChargedBack).toBe(1)
    expect(refunds.chargedBackCents).toBeLessThan(refunds.refundedGrossCents)
  })

  it('counts a stored net that contradicts the arithmetic, and only then', () => {
    // The summary recomputes `gross − tax` and says so, which left the
    // stored `netCents` a value its only consumer refused — a second source
    // of truth nobody was watching. Counting the disagreement turns it into
    // a checksum.
    const agrees: TaxReturnRowInput = {
      ...TX_ROW,
      invoiceId: 'in_agrees',
      grossCents: 10660,
      taxCents: 660,
      netCents: 10000,
    }
    const drifted: TaxReturnRowInput = {
      ...agrees,
      invoiceId: 'in_drifted',
      netCents: 9999,
    }
    const absent: TaxReturnRowInput = {
      ...agrees,
      invoiceId: 'in_absent',
      netCents: undefined,
    }

    expect(
      taxReturnSummary([agrees], Q3_2026).attention.rowsWithNetMismatch,
    ).toBe(0)
    // One cent out is still out. A filing record is the wrong place to round
    // a contradiction away.
    expect(
      taxReturnSummary([drifted], Q3_2026).attention.rowsWithNetMismatch,
    ).toBe(1)
    // An ABSENT field is not a contradiction — flagging it would put a
    // permanent alarm on every row written before the field existed, and an
    // alarm that is always on is one nobody reads.
    expect(
      taxReturnSummary([absent], Q3_2026).attention.rowsWithNetMismatch,
    ).toBe(0)
    // And the headline figures are unmoved: this reports, it does not
    // re-derive from the stored value.
    expect(taxReturnSummary([drifted], Q3_2026).totalSalesCents).toBe(10000)
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
