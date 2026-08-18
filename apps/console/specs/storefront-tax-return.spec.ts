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
 * Storefront tax reaches the quarterly return, and the two store modes never
 * meet (AGL-1904).
 *
 * The defect: a `mode: 'stripe'` storefront sale charges the shopper tax that
 * Stripe computes against AGLYN's registrations — measured, not inferred (the
 * same session shape answered `not_collecting` with the platform unregistered
 * and 8.25% `standard_rated` with it registered, both reporting
 * `automatic_tax.liability: { type: "self" }`) — and nothing summed it into
 * any return. Three things have to be true, and each has been forced red:
 *
 *   1. Such a sale APPEARS, with Stripe's own taxable base.
 *   2. A `manual`-mode sale does NOT count as Aglyn-collected.
 *   3. A row whose base cannot be read is COUNTED in `attention`, never
 *      dropped and never silently zeroed.
 *
 * The fixture amounts are the real test-mode measurement: $100.00 at 8.25% on
 * a $100.00 base = $8.25.
 */

export {}

import {
  storefrontTaxSummary,
  type StorefrontTaxReturnRowInput,
} from '../utils/server/tx-return'
import {
  storefrontTexasAglynLiableCents,
  taxReturnAttention,
  taxReturnWebfileLines,
  type TaxReturnPayload,
} from '../utils/tx-return-webfile'

const Q3_2026 = {
  start: new Date(Date.UTC(2026, 6, 1)),
  end: new Date(Date.UTC(2026, 9, 1)),
}

/** The measured Stripe-Tax cart sale: $100 base, 8.25%, $8.25 collected. */
const AGLYN_LIABLE_ROW: StorefrontTaxReturnRowInput = {
  id: 'cs_tax_1',
  hostId: 'host-1',
  orgId: 'org-1',
  taxMode: 'stripe-automatic',
  taxLiability: 'platform',
  grossCents: 10825,
  taxCents: 825,
  currency: 'usd',
  customerAddress: { country: 'US', state: 'TX' },
  taxLines: [{ amountCents: 825, taxableAmountCents: 10000 }],
  paidAt: new Date('2026-09-15T12:00:00Z'),
}

/**
 * The same store in `manual` mode. Note the tax lines: a manual-mode
 * SUBSCRIPTION renewal carries genuine Stripe Tax Rates (AGL-1751), so the
 * row can look exactly like the one above except for `taxMode`. That is the
 * whole reason the classification is stored rather than re-derived.
 */
const MANUAL_ROW: StorefrontTaxReturnRowInput = {
  id: 'in_manual_1',
  hostId: 'host-2',
  orgId: 'org-2',
  taxMode: 'manual',
  taxLiability: null,
  grossCents: 10800,
  taxCents: 800,
  currency: 'usd',
  customerAddress: { country: 'US', state: 'TX' },
  taxLines: [],
  paidAt: new Date('2026-09-16T12:00:00Z'),
}

describe('storefrontTaxSummary (AGL-1904)', () => {
  it('GUARD 1: a storefront sale taxed under Aglyn’s registration is in the return', () => {
    const summary = storefrontTaxSummary([AGLYN_LIABLE_ROW], Q3_2026)
    expect(summary.aglynLiable).toMatchObject({
      transactionCount: 1,
      grossCents: 10825,
      taxCollectedCents: 825,
      // Stripe's own `taxable_amount`, not `amount ÷ rate`.
      taxableSalesCents: 10000,
    })
    expect(summary.aglynLiable.byJurisdiction['US-TX']).toMatchObject({
      transactionCount: 1,
      totalSalesCents: 10000,
      taxableSalesCents: 10000,
      taxCollectedCents: 825,
    })
    expect(summary.attention.rowsMissingTaxableBase).toBe(0)
  })

  it('GUARD 2: a manual-mode sale is not Aglyn-collected tax', () => {
    const summary = storefrontTaxSummary([MANUAL_ROW], Q3_2026)
    expect(summary.aglynLiable.transactionCount).toBe(0)
    expect(summary.aglynLiable.taxCollectedCents).toBe(0)
    expect(summary.merchantManual).toMatchObject({
      transactionCount: 1,
      taxCollectedCents: 800,
    })
  })

  it('GUARD 2 under mixture: the two modes are still separate in one period', () => {
    const summary = storefrontTaxSummary([AGLYN_LIABLE_ROW, MANUAL_ROW], Q3_2026)
    expect(summary.aglynLiable.taxCollectedCents).toBe(825)
    expect(summary.merchantManual.taxCollectedCents).toBe(800)
    // Both sales counted, and NO field anywhere holds 1625: there is no grand
    // total to mistake for "tax Aglyn owes".
    expect(summary.transactionCount).toBe(2)
    expect(JSON.stringify(summary)).not.toContain('1625')
  })

  it('GUARD 3: a row whose base cannot be read is counted, not dropped or zeroed', () => {
    const noBase: StorefrontTaxReturnRowInput = {
      ...AGLYN_LIABLE_ROW,
      id: 'cs_no_base',
      // The expand failed: the tax is known, the base it applied to is not.
      taxLines: [],
    }
    const summary = storefrontTaxSummary([noBase], Q3_2026)
    expect(summary.attention.rowsMissingTaxableBase).toBe(1)
    // Still on the return — an unreadable base must not make a taxable sale
    // disappear from the tax Aglyn is holding.
    expect(summary.aglynLiable.transactionCount).toBe(1)
    expect(summary.aglynLiable.taxCollectedCents).toBe(825)
    // And the base is reported as zero-KNOWN rather than as a zero base that
    // was actually computed — which is what `attention` exists to say.
    expect(summary.aglynLiable.taxableSalesCents).toBe(0)
  })

  it('a base stated as a genuine zero is not confused with a missing one', () => {
    const notCollecting: StorefrontTaxReturnRowInput = {
      ...AGLYN_LIABLE_ROW,
      id: 'cs_not_collecting',
      grossCents: 10000,
      taxCents: 0,
      taxLines: [{ amountCents: 0, taxableAmountCents: 0 }],
    }
    const summary = storefrontTaxSummary([notCollecting], Q3_2026)
    expect(summary.attention.rowsMissingTaxableBase).toBe(0)
    expect(summary.aglynLiable.transactionCount).toBe(1)
  })

  it('a connected-account liability leaves Aglyn’s bucket visibly, not silently', () => {
    const onBehalf: StorefrontTaxReturnRowInput = {
      ...AGLYN_LIABLE_ROW,
      id: 'cs_on_behalf',
      taxLiability: 'connected-account',
    }
    const summary = storefrontTaxSummary([onBehalf], Q3_2026)
    expect(summary.aglynLiable.taxCollectedCents).toBe(0)
    expect(summary.connectedAccountLiable).toMatchObject({
      transactionCount: 1,
      taxCollectedCents: 825,
    })
  })

  it('an unrecognised tax mode is counted, never defaulted into a bucket', () => {
    const summary = storefrontTaxSummary(
      [{ ...AGLYN_LIABLE_ROW, id: 'cs_weird', taxMode: 'future-mode' }],
      Q3_2026,
    )
    expect(summary.attention.rowsUnclassified).toBe(1)
    expect(summary.aglynLiable.transactionCount).toBe(0)
    expect(summary.merchantManual.transactionCount).toBe(0)
    expect(summary.connectedAccountLiable.transactionCount).toBe(0)
    expect(summary.transactionCount).toBe(0)
  })

  it('counts an unreadable address and a non-USD row out loud', () => {
    const summary = storefrontTaxSummary(
      [
        { ...AGLYN_LIABLE_ROW, id: 'cs_no_addr', customerAddress: null },
        { ...AGLYN_LIABLE_ROW, id: 'cs_eur', currency: 'eur' },
        { ...AGLYN_LIABLE_ROW, id: 'cs_no_date', paidAt: undefined },
      ],
      Q3_2026,
    )
    expect(summary.attention).toMatchObject({
      rowsMissingAddress: 1,
      nonUsdRows: 1,
      rowsMissingPaidAt: 1,
    })
    expect(summary.aglynLiable.byJurisdiction['unknown']?.transactionCount).toBe(1)
  })

  it('reads Firestore-Timestamp-shaped dates, the form the route hands it', () => {
    const summary = storefrontTaxSummary(
      [
        {
          ...AGLYN_LIABLE_ROW,
          paidAt: { toDate: () => new Date('2026-09-15T12:00:00Z') },
        },
      ],
      Q3_2026,
    )
    expect(summary.attention.rowsMissingPaidAt).toBe(0)
  })

  it('total: garbage rows cannot throw', () => {
    expect(() =>
      storefrontTaxSummary(
        [
          {
            id: 'cs_garbage',
            grossCents: 'x',
            taxCents: {},
            taxLines: 'no' as never,
            taxMode: 'stripe-automatic',
            taxLiability: 'platform',
          },
        ],
        Q3_2026,
      ),
    ).not.toThrow()
  })
})

/**
 * The filing surface, which is where the fix has to actually land: a period
 * can read "clean" and be filed while Aglyn holds Texas storefront tax that
 * appears on no line of the return. That is the shortfall an auditor finds,
 * so the figure is BLOCKING rather than informational.
 */
describe('the Webfile report cannot be filed past storefront tax (AGL-1904)', () => {
  const basePayload: TaxReturnPayload = {
    period: '2026-Q3',
    truncated: false,
    undatedRows: 0,
    rows: [],
    summary: {
      periodStart: Q3_2026.start.toISOString(),
      periodEnd: Q3_2026.end.toISOString(),
      transactionCount: 1,
      totalSalesCents: 10000,
      taxableSalesCents: 8000,
      taxCollectedCents: 660,
      byJurisdiction: {
        'US-TX': {
          transactionCount: 1,
          totalSalesCents: 10000,
          taxableSalesCents: 8000,
          taxCollectedCents: 660,
        },
      },
      refunds: {
        rowsRefundedInPeriod: 0,
        refundedGrossCents: 0,
        estimatedRefundedTaxCents: 0,
      },
      attention: {
        untaxedRows: 0,
        rowsMissingTaxableBase: 0,
        rowsMissingAddress: 0,
        nonUsdRows: 0,
        rowsMissingPaidAt: 0,
      },
    },
  }

  const withStorefront = (rows: StorefrontTaxReturnRowInput[]): TaxReturnPayload => ({
    ...basePayload,
    storefront: {
      summary: storefrontTaxSummary(rows, Q3_2026),
      truncated: false,
      undatedRows: 0,
      rows: [],
    },
  })

  it('a period with no storefront section reads exactly as it did before', () => {
    const verdict = taxReturnAttention(basePayload)
    expect(verdict.clean).toBe(true)
    expect(storefrontTexasAglynLiableCents(basePayload)).toBe(0)
  })

  it('Aglyn-liable storefront tax BLOCKS the period and names the amount', () => {
    const payload = withStorefront([AGLYN_LIABLE_ROW])
    expect(storefrontTexasAglynLiableCents(payload)).toBe(825)
    const verdict = taxReturnAttention(payload)
    expect(verdict.clean).toBe(false)
    const item = verdict.items.find(
      (entry) => entry.id === 'storefrontAglynLiableTax',
    )
    expect(item).toMatchObject({ severity: 'blocking', count: 825 })
  })

  it('a manual-mode storefront sale does NOT block, and is not Aglyn-liable', () => {
    const payload = withStorefront([MANUAL_ROW])
    expect(storefrontTexasAglynLiableCents(payload)).toBe(0)
    expect(taxReturnAttention(payload).clean).toBe(true)
  })

  it('the Webfile lines state both figures, separately, outside Items 1–3', () => {
    const lines = taxReturnWebfileLines(withStorefront([AGLYN_LIABLE_ROW, MANUAL_ROW]))
    const aglynLine = lines.find((line) => line.label.includes('under Aglyn'))
    const merchantLine = lines.find((line) => line.label.includes('MERCHANT'))
    expect(aglynLine?.dollars).toBe('8.25')
    expect(merchantLine?.dollars).toBe('8.00')
    // Items 1–3 are untouched: the storefront money is stated beside the
    // return, never folded into a form item this report has no authority to
    // decide the treatment of.
    expect(lines.find((line) => line.item === 'Item 1')?.dollars).toBe('100.00')
    expect(lines.find((line) => line.item === 'Item 2')?.dollars).toBe('80.00')
  })
})
