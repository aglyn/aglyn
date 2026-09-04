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
 * THE READ HALF. The writer is
 * `libs/plugins/marketplace/src/lib/server/billing-webhook.ts`, covered by
 * `purchase-records-its-jurisdiction.spec.ts` beside it. Two suites because a
 * `scope:app` project may not import that lib — so the FIELD NAME is pinned
 * here against the writer's source instead. That guard is not ceremony: a
 * webhook storing under one name and a return reading another are each
 * internally consistent and would each pass their own suite while the report
 * went on printing zero attributable sales.
 *
 * ASSERTED ON THE SUMMARY'S OWN FIGURES, never on rendered output: what is
 * filed comes off these, and a screen agreeing with them is a separate
 * question with its own coverage.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  marketplaceTaxSummary,
  type MarketplaceTaxReturnRowInput,
} from '../utils/server/tx-return'

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
    const writer = readFileSync(
      join(
        __dirname,
        '../../../libs/plugins/marketplace/src/lib/server/billing-webhook.ts',
      ),
      'utf8',
    )

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
