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
  taxReturnFacilitatedJurisdictionRows,
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
/*==========================================
 * THE STOREFRONT WORKING PAPERS (AGL-2329).
 *
 * `storefront-tax.ts` writes `jurisdiction`, `rateState` and `percentage` on
 * every line and annotates all three "for the working papers". Those working
 * papers had no reader — in the console or in the Webfile mapper — so the
 * storefront half of the return could state a jurisdiction's tax and not say
 * which rate produced it, which is the first thing checked against a rate
 * table.
 *
 * The fixture uses a state rate and a local rate with DIFFERENT percentages
 * and different money, so an accumulator attributing one line's figures to
 * both dies here.
 *=========================================*/
describe('storefront working papers (AGL-2329)', () => {
  const SPLIT_RATE_ROW: StorefrontTaxReturnRowInput = {
    ...AGLYN_LIABLE_ROW,
    id: 'cs_split_rate',
    taxCents: 825,
    taxLines: [
      {
        amountCents: 625,
        taxableAmountCents: 10000,
        taxabilityReason: 'standard_rated',
        taxRateId: 'txr_tx_state',
        percentage: 6.25,
        rateState: 'TX',
        jurisdiction: 'Texas',
      },
      {
        amountCents: 200,
        taxableAmountCents: 10000,
        taxabilityReason: 'standard_rated',
        taxRateId: 'txr_austin_local',
        percentage: 2,
        rateState: 'TX',
        jurisdiction: 'Austin',
      },
    ],
  }

  it('names the rate behind each part of a jurisdiction total', () => {
    const rates = storefrontTaxSummary([SPLIT_RATE_ROW], Q3_2026).aglynLiable
      .byJurisdiction['US-TX'].rates

    expect(rates).toHaveLength(2)
    // Dearest first, and the fixture lists them that way already — so the
    // discriminating assertion is that each carries its OWN percentage and
    // its OWN money, not that the order happens to match.
    expect(rates[0]).toEqual({
      taxRateId: 'txr_tx_state',
      percentage: 6.25,
      rateState: 'TX',
      jurisdiction: 'Texas',
      lines: 1,
      taxableAmountCents: 10000,
      taxCollectedCents: 625,
    })
    expect(rates[1]).toEqual({
      taxRateId: 'txr_austin_local',
      percentage: 2,
      rateState: 'TX',
      jurisdiction: 'Austin',
      lines: 1,
      taxableAmountCents: 10000,
      taxCollectedCents: 200,
    })
    // 6.25 + 2.00 = 8.25%, the measured rate. The papers reconcile with the
    // figure above them.
    expect(rates[0].taxCollectedCents + rates[1].taxCollectedCents).toBe(
      storefrontTaxSummary([SPLIT_RATE_ROW], Q3_2026).aglynLiable
        .byJurisdiction['US-TX'].taxCollectedCents,
    )
  })

  it('keeps the merchant bucket\'s papers out of Aglyn\'s', () => {
    // The three buckets must never be summed, and neither must their
    // papers: a merchant's own configured rate appearing under Aglyn's
    // registrations would have Aglyn filing another company's tax, which is
    // the failure the bucket split exists to prevent.
    const merchantRow: StorefrontTaxReturnRowInput = {
      ...SPLIT_RATE_ROW,
      id: 'cs_merchant',
      taxMode: 'manual',
      taxLiability: 'merchant',
      taxLines: [
        {
          amountCents: 500,
          taxableAmountCents: 10000,
          taxabilityReason: 'standard_rated',
          taxRateId: 'merchant_rate',
          percentage: 5,
          rateState: 'TX',
          jurisdiction: 'Merchant configured',
        },
      ],
    }
    const summary = storefrontTaxSummary(
      [SPLIT_RATE_ROW, merchantRow],
      Q3_2026,
    )
    expect(
      summary.aglynLiable.byJurisdiction['US-TX'].rates.map(
        (rate) => rate.taxRateId,
      ),
    ).toEqual(['txr_tx_state', 'txr_austin_local'])
    expect(
      summary.merchantManual.byJurisdiction['US-TX'].rates.map(
        (rate) => rate.taxRateId,
      ),
    ).toEqual(['merchant_rate'])
  })

  it('records a line that states no rate as `unknown` rather than inventing one', () => {
    // The pre-AGL-2329 row shape: an amount and a base, nothing else. It
    // must still appear, or the papers stop reconciling with the total.
    const rates = storefrontTaxSummary([AGLYN_LIABLE_ROW], Q3_2026).aglynLiable
      .byJurisdiction['US-TX'].rates
    expect(rates).toEqual([
      {
        taxRateId: 'unknown',
        percentage: null,
        rateState: null,
        jurisdiction: null,
        lines: 1,
        taxableAmountCents: 10000,
        taxCollectedCents: 825,
      },
    ])
  })
})

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
        // Working-paper fields (AGL-2329) empty: this fixture stands in for
        // the AGLYN half of the payload while the storefront half is under
        // test, and their arithmetic is proved in `tx-return.spec.ts`.
        'US-TX': {
          transactionCount: 1,
          totalSalesCents: 10000,
          taxableSalesCents: 8000,
          taxCollectedCents: 660,
          taxabilityReasons: {},
          rates: [],
        },
      },
      refunds: {
        rowsRefundedInPeriod: 0,
        refundedGrossCents: 0,
        estimatedRefundedTaxCents: 0,
        chargedBackCents: 0,
        rowsChargedBack: 0,
      },
      attention: {
        untaxedRows: 0,
        rowsMissingTaxableBase: 0,
        rowsMissingAddress: 0,
        nonUsdRows: 0,
        rowsMissingPaidAt: 0,
        rowsWithNetMismatch: 0,
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

/**
 * FACILITATED SALES BY BUYER STATE — the nexus question (AGL-1956).
 *
 * Aglyn accepted marketplace-facilitator status, so every state asks the same
 * thing: how much did you facilitate into me, in how many transactions. The
 * figures were already computed by `storefrontTaxSummary` and already carried
 * in the staff payload; NOTHING RENDERED THEM, and the one by-state table on
 * the page was sourced from `platformRevenue` — Aglyn's own SaaS invoices —
 * while labelled the nexus early-warning list.
 *
 * These guards were each forced red before being written the right way round.
 */
describe('taxReturnFacilitatedJurisdictionRows (AGL-1956)', () => {
  const payloadFor = (
    rows: StorefrontTaxReturnRowInput[],
  ): TaxReturnPayload =>
    ({
      storefront: {
        summary: storefrontTaxSummary(rows, Q3_2026),
        truncated: false,
        undatedRows: 0,
        rows: [],
      },
    }) as unknown as TaxReturnPayload

  /** A California sale on a manual-rate store — a merchant remits it. */
  const CA_MANUAL_ROW: StorefrontTaxReturnRowInput = {
    ...MANUAL_ROW,
    id: 'in_manual_ca',
    customerAddress: { country: 'US', state: 'CA' },
  }
  /** A Florida sale that collected NOTHING — Aglyn is unregistered there. */
  const FL_UNTAXED_ROW: StorefrontTaxReturnRowInput = {
    ...AGLYN_LIABLE_ROW,
    id: 'cs_tax_fl',
    grossCents: 25000,
    taxCents: 0,
    customerAddress: { country: 'US', state: 'FL' },
    taxLines: [{ amountCents: 0, taxableAmountCents: 0 }],
  }

  it('counts the sale whoever remits the tax — the threshold does not care', () => {
    // THE GUARD THAT MATTERS. Nexus is measured on facilitated sales, so a
    // merchant-remitted sale counts exactly as much as an Aglyn-remitted one.
    // Reading only the `aglynLiable` bucket would under-report every state
    // where Aglyn collects nothing — which is every state a threshold is
    // actually about.
    const rows = taxReturnFacilitatedJurisdictionRows(
      payloadFor([AGLYN_LIABLE_ROW, MANUAL_ROW, CA_MANUAL_ROW]),
    )
    const texas = rows.find((row) => row.jurisdiction === 'US-TX')
    expect(texas?.transactionCount).toBe(2)
    // $100.00 Stripe-Tax + $100.00 manual, both net of their own tax.
    expect(texas?.totalSalesDollars).toBe('200.00')
    expect(texas?.taxCollectedDollars).toBe('16.25')
    // ...but only Aglyn's $8.25 of it is Aglyn's to remit. The two questions
    // are answered off one row and must not blur.
    expect(texas?.aglynLiableTaxDollars).toBe('8.25')

    const california = rows.find((row) => row.jurisdiction === 'US-CA')
    expect(california?.transactionCount).toBe(1)
    expect(california?.aglynLiableTaxDollars).toBe('0.00')
  })

  it('flags a state with sales and no tax — the one worth watching', () => {
    const rows = taxReturnFacilitatedJurisdictionRows(
      payloadFor([AGLYN_LIABLE_ROW, FL_UNTAXED_ROW]),
    )
    const florida = rows.find((row) => row.jurisdiction === 'US-FL')
    expect(florida?.untaxed).toBe(true)
    expect(florida?.totalSalesDollars).toBe('250.00')
    expect(rows.find((row) => row.jurisdiction === 'US-TX')?.untaxed).toBe(false)
  })

  it('puts Texas first, then the largest state — never alphabetical', () => {
    // Texas is the unconditional obligation (a Texas LLC has no in-state
    // threshold), so it leads however small it is. Florida outsells it here.
    const rows = taxReturnFacilitatedJurisdictionRows(
      payloadFor([AGLYN_LIABLE_ROW, FL_UNTAXED_ROW, CA_MANUAL_ROW]),
    )
    expect(rows.map((row) => row.jurisdiction)).toEqual([
      'US-TX',
      'US-FL',
      'US-CA',
    ])
  })

  it('never sums Aglyn’s own revenue into it', () => {
    // The bug this replaces read `payload.summary` — platformRevenue. A
    // payload carrying ONLY Aglyn's own sales must produce no facilitated
    // rows at all, or the nexus table is answering with the wrong taxpayer.
    const aglynOwnSalesOnly = {
      summary: {
        byJurisdiction: {
          'US-TX': {
            transactionCount: 9,
            totalSalesCents: 900000,
            taxableSalesCents: 720000,
            taxCollectedCents: 59400,
          },
        },
      },
    } as unknown as TaxReturnPayload
    expect(taxReturnFacilitatedJurisdictionRows(aglynOwnSalesOnly)).toEqual([])
    expect(taxReturnFacilitatedJurisdictionRows(null)).toEqual([])
  })
})
