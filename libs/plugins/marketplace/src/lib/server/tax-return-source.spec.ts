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
 *
 * @jest-environment node
 */

/**
 * THE RETURN ATTRIBUTES A FACILITATED SALE TO A STATE (AGL-2137).
 *
 * Aglyn is a marketplace facilitator: the tax on a marketplace purchase is
 * Aglyn's to collect and to remit, and a return reports it BY STATE.
 * `marketplaceTaxSummary` could report no state for any of it —
 * `rowsMissingJurisdiction` incremented once per row unconditionally, so it
 * equalled `transactionCount` BY CONSTRUCTION on a report whose whole job is
 * to say which authority is owed what.
 *
 * THE READ HALF. The writer is `billing-webhook.ts` beside this file,
 * covered by `purchase-records-its-jurisdiction.spec.ts`. The FIELD NAME is
 * pinned here against the writer's source as well: a webhook storing under
 * one name and a return reading another are each internally consistent and
 * would each pass their own suite while the report went on printing zero
 * attributable sales.
 *
 * ASSERTED ON THE SUMMARY'S OWN FIGURES, never on rendered output: what is
 * filed comes off these, and a screen agreeing with them is a separate
 * question with its own coverage.
 */

const mockDocs = new Map<string, Record<string, unknown>>()

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({
        collection: (name: string) => mockQuery(name, []),
      }),
    }),
  },
}))

/**
 * The two queries the source runs: a `createdAt` range and a
 * `createdAt == null` count. Null never matches a range, as in Firestore.
 */
function mockQuery(
  name: string,
  filters: Array<(data: Record<string, unknown>) => boolean>,
): any {
  const matched = () =>
    [...mockDocs.entries()]
      .filter(([path]) => path.startsWith(`${name}/`))
      .filter(([, data]) => filters.every((filter) => filter(data)))
  return {
    where: (field: string, op: string, value: unknown) =>
      mockQuery(name, [
        ...filters,
        (data) => {
          const held = data[field]
          if (op === '==') return held === value
          if (!(held instanceof Date)) return false
          if (op === '>=') return held >= (value as Date)
          if (op === '<') return held < (value as Date)
          return false
        },
      ]),
    count: () => ({
      get: async () => ({ data: () => ({ count: matched().length }) }),
    }),
    limit: (count: number) => ({
      get: async () => {
        const rows = matched().slice(0, count)
        return {
          size: rows.length,
          docs: rows.map(([path, data]) => ({
            id: path.split('/').pop(),
            data: () => data,
          })),
        }
      },
    }),
  }
}

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { TaxReturnSourceRequest } from '@aglyn/aglyn/plugin-manager/plugin-tax-return-sources'
import {
  marketplaceTaxFigures,
  marketplaceTaxReturnAnswer,
  marketplaceTaxReturnSource,
  marketplaceTaxSummary,
  type MarketplaceTaxReturnRowInput,
} from './tax-return-source'

const PERIOD = {
  start: new Date('2026-07-01T00:00:00Z'),
  end: new Date('2026-10-01T00:00:00Z'),
}

/** A row as the webhook now writes it — country and state, nothing finer. */
const attributedRow = (
  over: Partial<MarketplaceTaxReturnRowInput> = {},
): MarketplaceTaxReturnRowInput => ({
  id: 'cs_attributed',
  sellerOrgId: 'seller-org',
  amountCents: 10825,
  taxCents: 825,
  transferCents: 8000,
  createdAt: new Date('2026-07-15T00:00:00Z'),
  customerAddress: { country: 'US', state: 'TX' },
  ...over,
})

/** A row as every purchase recorded before this existed still reads. */
const unattributedRow = (
  over: Partial<MarketplaceTaxReturnRowInput> = {},
): MarketplaceTaxReturnRowInput => ({
  id: 'cs_legacy',
  sellerOrgId: 'seller-org',
  amountCents: 10825,
  taxCents: 825,
  transferCents: 8000,
  createdAt: new Date('2026-07-15T00:00:00Z'),
  ...over,
})

describe('the summary attributes the tax instead of counting it missing', () => {
  it('buckets the stated jurisdiction and counts nothing missing', () => {
    const summary = marketplaceTaxSummary([attributedRow()], PERIOD)

    expect(summary.attention.rowsMissingJurisdiction).toBe(0)
    expect(summary.byJurisdiction['US-TX']).toMatchObject({
      transactionCount: 1,
      taxCollectedCents: 825,
      // Tax is added `exclusive` on the platform's own charge, so the
      // receipts excluding tax ARE the base the rate was applied to.
      totalSalesCents: 10000,
      taxableSalesCents: 10000,
    })
    // Nothing lands in `unknown` — the bucket that means "cannot be placed".
    expect(summary.byJurisdiction['unknown']).toBeUndefined()
  })

  it('keys a country with no state by the country alone', () => {
    const summary = marketplaceTaxSummary(
      [attributedRow({ customerAddress: { country: 'FR', state: null } })],
      PERIOD,
    )

    // `FR`, not `FR-` and not `unknown`: a country that states no subdivision
    // has a jurisdiction, and it is the country.
    expect(Object.keys(summary.byJurisdiction)).toEqual(['FR'])
    expect(summary.attention.rowsMissingJurisdiction).toBe(0)
  })

  it('keeps two states apart', () => {
    const summary = marketplaceTaxSummary(
      [
        attributedRow(),
        attributedRow({
          id: 'cs_ca',
          amountCents: 10900,
          taxCents: 900,
          customerAddress: { country: 'US', state: 'CA' },
        }),
      ],
      PERIOD,
    )

    expect(summary.byJurisdiction['US-TX'].taxCollectedCents).toBe(825)
    expect(summary.byJurisdiction['US-CA'].taxCollectedCents).toBe(900)
    expect(summary.taxCollectedCents).toBe(1725)
  })

  it('nets a refund out of the state’s figure, not just out of the total', () => {
    // Stripe's cumulative refund on the charge: half the gross handed back.
    const summary = marketplaceTaxSummary(
      [attributedRow({ refundedCents: 5413 })],
      PERIOD,
    )

    // A state is owed what was KEPT, so the bucket carries the net, and it
    // agrees with the summary total it is a decomposition of.
    expect(summary.byJurisdiction['US-TX'].taxCollectedCents).toBe(
      summary.taxCollectedCents,
    )
    expect(summary.taxChargedCents).toBe(825)
    expect(summary.taxRefundedCents).toBeGreaterThan(0)
  })

  it('reads the jurisdiction under the field the WEBHOOK writes', () => {
    // The cross-boundary half of the contract, checked against source text
    // because the module boundary forbids importing the writer. A rename on
    // either side lands here rather than in a report that quietly attributes
    // nothing. Proven to bite by the control below: with `customerAddress`
    // renamed in either file this assertion is the one that fails first.
    const writer = readFileSync(join(__dirname, 'billing-webhook.ts'), 'utf8')

    expect(writer).toContain('customerAddress: jurisdiction')
    // And it is written inside the first-record branch, beside `createdAt` —
    // the placement that makes a redelivery incapable of backfilling. The
    // behaviour itself is asserted in the writer's own suite; this is the
    // reader's stake in it.
    const firstRecordBranch = writer.slice(
      writer.indexOf('const alreadyRecorded'),
      writer.indexOf('// MERGED, like every other write on this path'),
    )
    expect(firstRecordBranch).toContain('customerAddress: jurisdiction')
  })
})

describe('THE CONTROL — an unattributed sale is never given a jurisdiction', () => {
  /**
   * Every purchase recorded before the webhook stored a jurisdiction has
   * none, and the address it was taxed from is still in Stripe — which is
   * exactly why the rule has to be written down as a test rather than left as
   * an intention. Reaching back for it would attribute a period that was
   * already reported without it, and a jurisdiction reconstructed after the
   * fact is a guess presented to a tax authority as a fact.
   *
   * Forced red on purpose by defaulting the jurisdiction — bucketing a row
   * with no `customerAddress` under the filing state instead of `unknown`
   * makes `rowsMissingJurisdiction` read 0 and this suite fail on its first
   * assertion.
   */
  it('counts a pre-existing row as missing and buckets it under `unknown`', () => {
    const summary = marketplaceTaxSummary([unattributedRow()], PERIOD)

    expect(summary.attention.rowsMissingJurisdiction).toBe(1)
    expect(summary.byJurisdiction['unknown'].taxCollectedCents).toBe(825)
    // The money is still fully stated: an unattributable row is reported,
    // never dropped, so the platform total stays whole.
    expect(summary.taxCollectedCents).toBe(825)
    expect(summary.transactionCount).toBe(1)
  })

  it('an EMPTY address is missing, not a jurisdiction', () => {
    const summary = marketplaceTaxSummary(
      [
        unattributedRow({ customerAddress: null }),
        unattributedRow({ id: 'cs_blank', customerAddress: { country: '' } }),
      ],
      PERIOD,
    )

    // Neither shell is a place. A blank country keyed as its own bucket would
    // be an attribution to nowhere, printed on a report as though it were one.
    expect(summary.attention.rowsMissingJurisdiction).toBe(2)
    expect(Object.keys(summary.byJurisdiction)).toEqual(['unknown'])
  })

  it('a mixed period states what it can place and what it cannot', () => {
    const summary = marketplaceTaxSummary(
      [
        attributedRow(),
        unattributedRow({ id: 'cs_legacy', amountCents: 5300, taxCents: 300 }),
      ],
      PERIOD,
    )

    expect(summary.attention.rowsMissingJurisdiction).toBe(1)
    expect(summary.byJurisdiction['US-TX'].taxCollectedCents).toBe(825)
    expect(summary.byJurisdiction['unknown'].taxCollectedCents).toBe(300)
    // The split is a decomposition of the total, never a replacement for it:
    // the buckets sum to the figure the report states as the platform total.
    expect(
      Object.values(summary.byJurisdiction).reduce(
        (sum, bucket) => sum + bucket.taxCollectedCents,
        0,
      ),
    ).toBe(summary.taxCollectedCents)
  })

  it('does not change the figures a period already reported', () => {
    // The totals are the numbers a past period was reported with. Adding an
    // attribution must not move any of them: a return that silently restates
    // a filed period is the one outcome worse than an unattributed one.
    const rows = [
      unattributedRow(),
      unattributedRow({ id: 'cs_legacy_2', amountCents: 5300, taxCents: 300 }),
    ]
    const summary = marketplaceTaxSummary(rows, PERIOD)

    expect(summary.transactionCount).toBe(2)
    expect(summary.grossCents).toBe(16125)
    expect(summary.taxableSalesCents).toBe(15000)
    expect(summary.taxChargedCents).toBe(1125)
    expect(summary.taxRefundedCents).toBe(0)
    expect(summary.taxCollectedCents).toBe(1125)
    expect(summary.attention.rowsMissingJurisdiction).toBe(2)
  })
})

const REQUEST: TaxReturnSourceRequest = {
  period: '2026-Q3',
  start: PERIOD.start,
  end: PERIOD.end,
  filing: { code: 'US-TX', label: 'Texas', form: 'tx-webfile', figuresName: 'Items 1–3' },
  rowCap: 2000,
}

/**
 * THE SOURCE THE OPERATOR'S RETURN READS (AGL-2137, AGL-3080).
 *
 * Marketplace checkout enables `automatic_tax` on the PLATFORM's own charge,
 * adds the tax `exclusive` on top, and transfers the publisher a FIXED
 * amount computed from the pre-tax price — so the tax stays platform-side
 * and is the operator's to remit in full. These are the figures the staff
 * return's route used to assert on its own response, now asserted on the
 * source that answers them.
 */
describe('the marketplace’s tax return source', () => {
  beforeEach(() => mockDocs.clear())

  const read = () => marketplaceTaxReturnSource.read(REQUEST)
  const summaryOf = (answer: Awaited<ReturnType<typeof read>>) =>
    answer.summary as ReturnType<typeof marketplaceTaxSummary>

  it('serves marketplace tax as its own section, net of refunds', async () => {
    mockDocs.set('marketplacePurchases/cs_mkt_1', {
      listingId: 'listing-1',
      buyerUid: 'buyer-1',
      sellerOrgId: 'seller-org',
      amountCents: 10825,
      taxCents: 825,
      feeCents: 2000,
      transferCents: 8000,
      createdAt: new Date('2026-09-18T12:00:00Z'),
    })
    // Half refunded: half the tax goes back and is not remittable.
    mockDocs.set('marketplacePurchases/cs_mkt_2', {
      listingId: 'listing-2',
      buyerUid: 'buyer-2',
      sellerOrgId: 'seller-org',
      amountCents: 2165,
      taxCents: 165,
      transferCents: 1600,
      refundedCents: 1083,
      createdAt: new Date('2026-09-19T12:00:00Z'),
    })
    const answer = await read()
    const summary = summaryOf(answer)
    expect(summary.transactionCount).toBe(2)
    // Charged 825 + 165 = 990.
    expect(summary.taxChargedCents).toBe(990)
    // Refunded: 165 × 1083/2165 = 82.5 → 83 (Math.round).
    expect(summary.taxRefundedCents).toBe(83)
    // Remittable is charged − refunded, and it is the headline figure.
    expect(summary.taxCollectedCents).toBe(907)
    expect(answer.rows).toHaveLength(2)
    expect(answer.findings.find((finding) => finding.id === 'marketplaceTaxCollected')).toMatchObject({
      severity: 'blocking',
      count: 907,
      label: 'Marketplace tax collected under Aglyn’s registration',
    })
  })

  /**
   * A FULLY refunded marketplace sale nets to exactly zero tax — the case a
   * pro-rata calculation gets wrong by a cent if it is written carelessly.
   */
  it('a fully refunded marketplace sale remits no tax at all', async () => {
    mockDocs.set('marketplacePurchases/cs_mkt_full', {
      sellerOrgId: 'seller-org',
      amountCents: 10825,
      taxCents: 825,
      refundedCents: 10825,
      createdAt: new Date('2026-09-18T12:00:00Z'),
    })
    const answer = await read()
    const summary = summaryOf(answer)
    expect(summary.taxChargedCents).toBe(825)
    expect(summary.taxRefundedCents).toBe(825)
    expect(summary.taxCollectedCents).toBe(0)
    // And the row is still REPORTED — a refunded sale that vanished from the
    // return would be indistinguishable from one that never happened.
    expect(answer.rows).toHaveLength(1)
  })

  /**
   * A refund LARGER than the charge is a data fault. It must not net the
   * remittable figure below zero, because understating what is owed is the
   * one direction with a filing consequence — it is clamped and counted.
   */
  it('never nets marketplace tax below zero on an over-refunded row', async () => {
    mockDocs.set('marketplacePurchases/cs_mkt_bad', {
      sellerOrgId: 'seller-org',
      amountCents: 1000,
      taxCents: 80,
      refundedCents: 5000,
      createdAt: new Date('2026-09-18T12:00:00Z'),
    })
    const summary = summaryOf(await read())
    expect(summary.taxCollectedCents).toBe(0)
    expect(summary.attention.rowsOverRefunded).toBe(1)
  })

  it('reads only the period, and reports a read past the cap and undated purchases', async () => {
    mockDocs.set('marketplacePurchases/in', { ...attributedRow(), createdAt: new Date('2026-08-01T00:00:00Z') })
    mockDocs.set('marketplacePurchases/in2', { ...attributedRow(), createdAt: new Date('2026-08-02T00:00:00Z') })
    mockDocs.set('marketplacePurchases/later', { ...attributedRow(), createdAt: new Date('2026-11-01T00:00:00Z') })
    mockDocs.set('marketplacePurchases/undated', { ...attributedRow(), createdAt: null })
    const whole = await read()
    expect(summaryOf(whole).transactionCount).toBe(2)
    expect(whole.truncated).toBe(false)
    expect(whole.undatedRows).toBe(1)
    const capped = await marketplaceTaxReturnSource.read({ ...REQUEST, rowCap: 1 })
    expect(capped.truncated).toBe(true)
    expect(capped.rows).toHaveLength(1)
  })

  it('states charged and refunded beside the net, and the net’s jurisdictions', () => {
    const summary = marketplaceTaxSummary(
      [attributedRow(), unattributedRow({ id: 'cs_legacy', amountCents: 5300, taxCents: 300 })],
      PERIOD,
    )
    const figures = marketplaceTaxFigures(summary, REQUEST.filing)
    expect(figures.map((line) => [line.label, line.value])).toEqual([
      ['Purchases in period', '2'],
      ['Gross paid by buyers', '$161.25'],
      ['Taxable base', '$150.00'],
      ['Tax charged', '$11.25'],
      ['Tax refunded', '$0.00'],
      ['Tax collected, net', '$11.25'],
      ['Tax collected — US-TX', '$8.25'],
      ['Tax collected — no stated jurisdiction', '$3.00'],
    ])
    expect(figures[5].note).toBe('The remittable figure — and it is in NO Webfile line above.')
  })

  it('answers as the marketplace, its figures exported after the working papers', () => {
    const answer = marketplaceTaxReturnAnswer(
      { rows: [attributedRow()], truncated: false, undatedRows: 0 },
      REQUEST,
    )
    expect(answer).toMatchObject({ id: 'marketplace', name: 'Marketplace', filingLines: [] })
    expect(answer.findings.map((finding) => finding.id)).toEqual([
      'marketplaceTaxCollected',
      'marketplaceOverRefunded',
      'marketplaceMissingJurisdiction',
      'marketplaceMissingCreatedAt',
    ])
    expect(answer.exports).toHaveLength(1)
    expect(answer.exports[0].placement).toBe('sections')
    expect(answer.exports[0].rows.slice(0, 2)).toEqual([
      ['Marketplace tax (AGL-2137) — NOT in the Webfile figures'],
      ['Figure', 'Amount', 'Note'],
    ])
  })
})
