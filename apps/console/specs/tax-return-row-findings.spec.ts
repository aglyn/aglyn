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
 * A COUNT AND ITS ROWS COME FROM ONE PREDICATE — and three rules decide which
 * rows are on the return at all.
 *
 * Four failures are asserted here, each of which reached a filed document:
 *
 *   1. **A count nobody can resolve to rows.** The banner said "1 row needs
 *      attention" and no surface could say which. The two halves now come from
 *      `taxReturnRowFindings`, and a spec that let them drift apart would let
 *      the whole fix rot.
 *   2. **A finding that cannot be true.** An untaxed row paid before the
 *      filer's obligation began could not have under-collected — there was
 *      nothing to collect — and flagging it forever trains a reader to skim
 *      the one list that must not be skimmed.
 *   3. **Aglyn's own purchases filed as sales to a state.** The flag existed
 *      and the return never read it.
 *   4. **Silent removal.** Both exclusions must leave the rows countable and
 *      nameable. A return that drops rows without saying which cannot be
 *      checked by the person signing it.
 *
 * Every identifier here is SYNTHETIC, and deliberately not a plausible digit
 * run: `tools/scripts/check-no-tax-identifiers.mjs` refuses real registration
 * numbers in tracked source, and a spec that pins a literal is how one came
 * back the first time.
 */

import {
  taxReturnRowFindings,
  taxReturnSummary,
  type TaxReturnRowInput,
} from '../utils/server/tx-return'

const PERIOD = {
  start: new Date(Date.UTC(2026, 6, 1)),
  end: new Date(Date.UTC(2026, 9, 1)),
}

/** September 1st — the start of a configured `2026-09` obligation. */
const OBLIGATION = { obligationStart: new Date(Date.UTC(2026, 8, 1)) }

/** A clean Texas sale. Synthetic id throughout. */
const SALE: TaxReturnRowInput = {
  invoiceId: 'in_synthetic_clean',
  orgId: 'org-synthetic',
  grossCents: 2500,
  taxCents: 0,
  currency: 'usd',
  automaticTax: true,
  customerAddress: { country: 'US', state: 'TX' },
  taxLines: [],
  paidAt: new Date(Date.UTC(2026, 8, 15)),
}

describe('a count and the rows behind it cannot disagree', () => {
  it('every attention count equals the rows stamped with that finding', () => {
    const rows: TaxReturnRowInput[] = [
      SALE,
      { ...SALE, invoiceId: 'in_synthetic_untaxed', automaticTax: false },
      {
        ...SALE,
        invoiceId: 'in_synthetic_noaddress',
        customerAddress: null,
      },
      {
        ...SALE,
        invoiceId: 'in_synthetic_nobase',
        taxCents: 206,
        taxLines: [{ amountCents: 206 }],
      },
      { ...SALE, invoiceId: 'in_synthetic_eur', currency: 'eur' },
      { ...SALE, invoiceId: 'in_synthetic_undated', paidAt: null },
      { ...SALE, invoiceId: 'in_synthetic_netdrift', netCents: 9999 },
    ]
    const summary = taxReturnSummary(rows, PERIOD, OBLIGATION)

    // Re-derive the counts from the per-row stamps, which is exactly what a
    // surface naming the rows does. A count computed from a second copy of
    // these conditions is the defect this asserts against.
    const stamped: Record<string, number> = {}
    for (const row of rows) {
      for (const finding of taxReturnRowFindings(row, OBLIGATION)) {
        stamped[finding] = (stamped[finding] ?? 0) + 1
      }
    }
    for (const [key, count] of Object.entries(summary.attention)) {
      expect([key, count]).toEqual([key, stamped[key] ?? 0])
    }
    // Anti-vacuity: the fixture really does raise findings, so the agreement
    // above is between populated numbers rather than a row of zeroes.
    expect(summary.attention.untaxedRows).toBe(1)
    expect(summary.attention.rowsMissingAddress).toBe(1)
    expect(summary.attention.rowsMissingTaxableBase).toBe(1)
    expect(summary.attention.nonUsdRows).toBe(1)
    expect(summary.attention.rowsMissingPaidAt).toBe(1)
    expect(summary.attention.rowsWithNetMismatch).toBe(1)
  })

  it('THE CONTROL: a stated base of zero is not a missing base', () => {
    // The reason the rows cannot be re-derived downstream. `taxableSalesCents`
    // is a SUM on the wire, so a line stating `0` is indistinguishable there
    // from a row stating no base at all — and only one of the two is a
    // finding.
    const statesZero: TaxReturnRowInput = {
      ...SALE,
      taxCents: 100,
      taxLines: [{ amountCents: 100, taxableAmountCents: 0 }],
    }
    const statesNothing: TaxReturnRowInput = {
      ...SALE,
      taxCents: 100,
      taxLines: [{ amountCents: 100 }],
    }
    expect(taxReturnRowFindings(statesZero)).not.toContain(
      'rowsMissingTaxableBase',
    )
    expect(taxReturnRowFindings(statesNothing)).toContain(
      'rowsMissingTaxableBase',
    )
  })

  it('THE CONTROL: a never-written automaticTax is not an explicit false', () => {
    // The other half of the same trap. The route used to project
    // `row.automaticTax === true`, which reports an absent field as `false` —
    // so anything filtering the wire would have named rows the count never
    // included.
    const unwritten: TaxReturnRowInput = { ...SALE, automaticTax: undefined }
    expect(taxReturnRowFindings(unwritten)).not.toContain('untaxedRows')
    expect(taxReturnRowFindings({ ...SALE, automaticTax: false })).toContain(
      'untaxedRows',
    )
  })
})

describe('an untaxed row is scoped by when the obligation began', () => {
  const untaxed = (paidAt: Date): TaxReturnRowInput => ({
    ...SALE,
    invoiceId: 'in_synthetic_untaxed',
    automaticTax: false,
    paidAt,
  })

  it('is NOT flagged when it was paid before the obligation started', () => {
    const row = untaxed(new Date(Date.UTC(2026, 6, 18)))
    expect(taxReturnRowFindings(row, OBLIGATION)).toEqual([
      'untaxedRowsBeforeObligation',
    ])
    const summary = taxReturnSummary([row], PERIOD, OBLIGATION)
    expect(summary.attention.untaxedRows).toBe(0)
    // …and NOT dropped. The rows keep their own bucket so a count that used
    // to include them is accounted for rather than silently smaller.
    expect(summary.attention.untaxedRowsBeforeObligation).toBe(1)
  })

  it('IS flagged on the first day of the first filable period', () => {
    // The boundary, and it is inclusive at the start: a sale on the first day
    // of the first filable period is in scope. An exclusive comparison here
    // would silently un-flag a real liability on exactly one day a quarter.
    const row = untaxed(new Date(Date.UTC(2026, 8, 1)))
    expect(taxReturnRowFindings(row, OBLIGATION)).toEqual(['untaxedRows'])
    expect(
      taxReturnSummary([row], PERIOD, OBLIGATION).attention.untaxedRows,
    ).toBe(1)
  })

  it('THE CONTROL: with no obligation start, BOTH are flagged', () => {
    // The control that proves the scoping cannot swallow everything. An
    // unconfigured deployment scopes nothing — under-reporting a liability
    // because a config read failed is far worse than an extra review line.
    const before = untaxed(new Date(Date.UTC(2026, 6, 18)))
    const after = untaxed(new Date(Date.UTC(2026, 8, 1)))
    const summary = taxReturnSummary([before, after], PERIOD, undefined)
    expect(summary.attention.untaxedRows).toBe(2)
    expect(summary.attention.untaxedRowsBeforeObligation).toBe(0)
  })

  it('flags an untaxed row whose paid date cannot be read', () => {
    // It cannot be proven out of scope, so it is not scoped out. Failing
    // toward flagging in the one case where the evidence is missing.
    const row: TaxReturnRowInput = {
      ...SALE,
      invoiceId: 'in_synthetic_undated_untaxed',
      automaticTax: false,
      paidAt: null,
    }
    expect(taxReturnRowFindings(row, OBLIGATION)).toContain('untaxedRows')
  })
})

describe('Aglyn’s own purchases are not sales on a state return', () => {
  const internal: TaxReturnRowInput = {
    ...SALE,
    invoiceId: 'in_synthetic_internal',
    internalTraffic: true,
  }

  it('is excluded from Item 1, Item 2 and the tax reconciliation', () => {
    const summary = taxReturnSummary([internal], PERIOD, OBLIGATION)
    expect(summary.transactionCount).toBe(0)
    expect(summary.totalSalesCents).toBe(0)
    expect(summary.taxableSalesCents).toBe(0)
    expect(summary.taxCollectedCents).toBe(0)
    // …and out of the jurisdiction bucket the form's items read from, which
    // is where Items 1 and 2 actually come from.
    expect(summary.byJurisdiction['US-TX']).toBeUndefined()
  })

  it('is listed as excluded rather than vanishing', () => {
    const summary = taxReturnSummary([internal], PERIOD, OBLIGATION)
    expect(summary.attention.internalRows).toBe(1)
    expect(summary.internal.transactionCount).toBe(1)
    expect(summary.internal.totalSalesCents).toBe(2500)
    expect(summary.internal.byJurisdiction['US-TX']?.totalSalesCents).toBe(2500)
    expect(taxReturnRowFindings(internal)).toEqual(['internalRows'])
  })

  it('fails toward INCLUDING when the flag is absent or not exactly true', () => {
    // The revenue report's own test, `=== true`. An absent flag is a real
    // sale: under-reporting a liability because a field was missing is the
    // worse error, and an over-reported figure is at least visible on the
    // form.
    for (const flag of [undefined, null, false, 'true', 1]) {
      const summary = taxReturnSummary(
        [{ ...SALE, internalTraffic: flag } as TaxReturnRowInput],
        PERIOD,
        OBLIGATION,
      )
      expect([flag, summary.transactionCount]).toEqual([flag, 1])
      expect([flag, summary.internal.transactionCount]).toEqual([flag, 0])
    }
  })

  it('THE CONTROL: a period with no internal rows is byte-identical', () => {
    // The assertion that stops this change from silently moving a real
    // filing. With nothing marked internal, every figure must be exactly what
    // it was before the exclusion existed.
    const rows: TaxReturnRowInput[] = [
      SALE,
      { ...SALE, invoiceId: 'in_synthetic_second', grossCents: 9900, taxCents: 817 },
    ]
    const summary = taxReturnSummary(rows, PERIOD, OBLIGATION)
    expect(summary.transactionCount).toBe(2)
    expect(summary.totalSalesCents).toBe(2500 + 9900 - 817)
    expect(summary.taxCollectedCents).toBe(817)
    expect(summary.internal.transactionCount).toBe(0)
    expect(summary.internal.totalSalesCents).toBe(0)
    expect(summary.internal.byJurisdiction).toEqual({})
    expect(summary.attention.internalRows).toBe(0)
  })

  it('raises no finding ABOUT THE RETURN on a row that is not on it', () => {
    // An internal row's address, currency and tax behavior are questions
    // about a sale that was never made. Stated precedence, not an accident:
    // the excluded rows keep their own bucket and their own list.
    const messy: TaxReturnRowInput = {
      ...SALE,
      invoiceId: 'in_synthetic_internal_messy',
      internalTraffic: true,
      automaticTax: false,
      currency: 'eur',
      customerAddress: null,
      paidAt: null,
    }
    expect(taxReturnRowFindings(messy, OBLIGATION)).toEqual(['internalRows'])
    const summary = taxReturnSummary([messy], PERIOD, OBLIGATION)
    expect(summary.attention.untaxedRows).toBe(0)
    expect(summary.attention.rowsMissingAddress).toBe(0)
    expect(summary.attention.nonUsdRows).toBe(0)
  })
})
