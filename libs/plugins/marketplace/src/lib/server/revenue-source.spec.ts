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

const mockSwept: { docs: any[]; truncated: boolean; fail: boolean } = {
  docs: [],
  truncated: false,
  fail: false,
}
/** Every `where` the source issued, so the field it ranges on is provable. */
const mockWheres: Array<[string, string, unknown]> = []
let mockGroup = ''

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      firestore: () => {
        const query: any = {
          where: (field: string, op: string, value: unknown) => {
            mockWheres.push([field, op, value])
            return query
          },
        }
        return {
          collection: (name: string) => {
            mockGroup = `collection:${name}`
            return query
          },
          collectionGroup: (name: string) => {
            mockGroup = `group:${name}`
            return query
          },
        }
      },
    }),
  },
}))

import { saleProcessingCostCents } from '@aglyn/aglyn/server'
import type { RevenueSourceRequest } from '@aglyn/aglyn/plugin-manager/plugin-revenue-sources'
import {
  marketplaceListingAttribution,
  marketplacePublisherAttribution,
  marketplaceRevenueSource,
  marketplaceSettledSummary,
} from './revenue-source'

/**
 * The marketplace's commission on the operator's revenue report (AGL-2486,
 * AGL-3080). These moved here from the console with the fold they pin.
 */

describe('marketplace commission', () => {
  it('reads the stored fee rather than re-deriving it from today rate', () => {
    const out = marketplaceSettledSummary([
      // Transfer and fee disagree, as they would if the rate had moved since
      // the sale. The STORED fee must win.
      { id: 'm1', amountCents: 10000, taxCents: 0, feeCents: 2000, transferCents: 5000 },
    ])
    expect(out.commissionNetCents).toBe(2000)
    expect(out.commissionNetCents).not.toBe(10000 - 5000)
  })

  it('falls back to gross minus tax minus transfer on a legacy row', () => {
    const out = marketplaceSettledSummary([
      { id: 'm1', amountCents: 11000, taxCents: 1000, transferCents: 8000 },
    ])
    expect(out.commissionNetCents).toBe(11000 - 1000 - 8000)
  })

  it('sees a PARTIAL refund, which never writes refundedCents', () => {
    const partial = marketplaceSettledSummary([
      {
        id: 'm1',
        amountCents: 10000,
        taxCents: 0,
        feeCents: 2000,
        partialRefundedCents: 5000,
      },
    ])
    // Reading only `refundedCents` would report the full 2000 here.
    expect(partial.commissionNetCents).toBe(1000)
    expect(partial.commissionNetCents).not.toBe(2000)
  })

  it('does not double-reverse a sale carrying both refund fields', () => {
    const out = marketplaceSettledSummary([
      {
        id: 'm1',
        amountCents: 10000,
        taxCents: 0,
        feeCents: 2000,
        partialRefundedCents: 4000,
        refundedCents: 10000,
      },
    ])
    // Summing the two fields would reverse 14000 against a 10000 sale.
    expect(out.commissionNetCents).toBe(0)
  })

  it('reports the uncovered processing cost it cannot recover', () => {
    const out = marketplaceSettledSummary([
      { id: 'm1', amountCents: 10000, taxCents: 0, feeCents: 2000, transferCents: 8000 },
    ])
    // Marketplace charges carry no application fee, so this cost is real and
    // unrecovered. Derived from the same helper the storefront path uses.
    expect(out.estimatedProcessingCostCents).toBe(
      saleProcessingCostCents(10000),
    )
    expect(out.estimatedProcessingCostCents).toBeGreaterThan(0)
  })
})

/**
 * Attribution by listing and by publisher (AGL-2486).
 *
 * The reconciliation assertions are the point: "a plugin table that does not
 * sum to the marketplace line is worse than no plugin table".
 */
describe('attribution by source', () => {
  const sale = (
    listingId: string,
    sellerOrgId: string,
    amountCents: number,
    feeCents: number,
    refundedCents = 0,
  ) => ({
    id: `cs_${listingId}_${amountCents}`,
    listingId,
    sellerOrgId,
    amountCents,
    taxCents: 0,
    feeCents,
    transferCents: amountCents - feeCents,
    refundedCents,
  })
  it('sums listing rows to the marketplace commission line exactly', () => {
    const rows = [
      sale('office-hours', 'pub1', 10_000, 1_500),
      sale('office-hours', 'pub1', 4_000, 600),
      sale('promo-countdown', 'pub2', 8_000, 1_200, 8_000),
    ]
    const total = marketplaceSettledSummary(rows)
    const byListing = marketplaceListingAttribution(rows)
    const summed = byListing.rows.reduce((s, r) => s + r.gainCents, 0)

    expect(summed).toBe(total.commissionNetCents)
    expect(byListing.rows).toHaveLength(2)
    // Losses carry a name too — the fully refunded sale is attributable.
    const refundRow = byListing.rows.find((r) => r.key === 'promo-countdown')
    expect(refundRow?.lossCents).toBe(1_200)
    expect(refundRow?.gainCents).toBe(0)
  })

  it('sums publisher rows to the same marketplace line', () => {
    const rows = [
      sale('a', 'pub1', 10_000, 1_500),
      sale('b', 'pub2', 4_000, 600),
    ]
    const total = marketplaceSettledSummary(rows)
    const byPublisher = marketplacePublisherAttribution(rows)
    expect(byPublisher.rows.reduce((s, r) => s + r.gainCents, 0)).toBe(
      total.commissionNetCents,
    )
    // Two groupings of the SAME money must agree with each other.
    const byListing = marketplaceListingAttribution(rows)
    expect(byPublisher.rows.reduce((s, r) => s + r.gainCents, 0)).toBe(
      byListing.rows.reduce((s, r) => s + r.gainCents, 0),
    )
  })

  it('keeps a row whose entity id is missing rather than dropping the money', () => {
    // Dropping it would make the rows sum BELOW the total — the exact fault
    // these tables exist to avoid.
    const rows = [{ id: 'x', amountCents: 10_000, feeCents: 1_500 }]
    const total = marketplaceSettledSummary(rows)
    const byListing = marketplaceListingAttribution(rows)
    expect(byListing.rows).toHaveLength(1)
    expect(byListing.rows[0].key).toBe('Listing not recorded')
    expect(byListing.rows[0].gainCents).toBe(total.commissionNetCents)
  })

  it('carries the omitted remainder as figures when capped', () => {
    const rows = Array.from({ length: 4 }, (_, index) =>
      sale(`l${index}`, 'pub', (index + 1) * 10_000, (index + 1) * 1_000),
    )
    const total = marketplaceSettledSummary(rows)
    const capped = marketplaceListingAttribution(rows, 2)
    const shown = capped.rows.reduce((s, r) => s + r.gainCents, 0)
    expect(capped.omittedRows).toBe(2)
    expect(shown + capped.omittedGainCents).toBe(total.commissionNetCents)
  })
})

/** The report's side of the request: a sweep, names, and a budget. */
function request(over: Partial<RevenueSourceRequest> = {}): RevenueSourceRequest {
  return {
    period: '2026-08',
    start: new Date(Date.UTC(2026, 7, 1)),
    end: new Date(Date.UTC(2026, 8, 1)),
    attributionLimit: 100,
    sweep: (async () => {
      if (mockSwept.fail) throw Object.assign(new Error('9 FAILED_PRECONDITION'), { code: 9 })
      return { docs: mockSwept.docs, truncated: mockSwept.truncated }
    }) as never,
    orgNames: async () => new Map(),
    nameRows: async () => undefined,
    ...over,
  }
}

const docOf = (id: string, data: Record<string, unknown>, parentId = '') => ({
  id,
  ref: { parent: { parent: parentId ? { id: parentId } : null } },
  data: () => data,
})

beforeEach(() => {
  mockSwept.docs = []
  mockSwept.truncated = false
  mockSwept.fail = false
  mockWheres.length = 0
  mockGroup = ''
})

describe('the marketplace’s revenue source', () => {
  it('ranges purchases on createdAt — a top-level collection, not a group', async () => {
    await marketplaceRevenueSource.read(request())
    expect(mockGroup).toBe('collection:marketplacePurchases')
    expect(new Set(mockWheres.map(([field]) => field))).toEqual(new Set(['createdAt']))
  })

  it('names only the rows it will SHOW, and carries the rest as figures', async () => {
    // The read-budget guard: 260 sales folded, the listing names asked for
    // 100 of them — the budget follows the table, not the data.
    mockSwept.docs = Array.from({ length: 260 }, (_, index) =>
      docOf(`cs_${index}`, {
        listingId: `listing-${index}`,
        sellerOrgId: 'pub-1',
        amountCents: 10_000,
        feeCents: 1_500,
      }),
    )
    const nameRows = jest.fn(async () => undefined)
    const answer = await marketplaceRevenueSource.read(request({ nameRows }))
    const [byListing] = answer.attribution
    expect(byListing.rows).toHaveLength(100)
    expect(nameRows).toHaveBeenCalledTimes(1)
    expect((nameRows.mock.calls[0] as any)[0]).toHaveLength(100)
    expect((answer.summary as any).transactionCount).toBe(260)
    const shown = byListing.rows.reduce((sum, row) => sum + row.gainCents, 0)
    expect(shown + byListing.omittedGainCents).toBe(answer.earned.cents)
  })

  it('names a publisher from the organizations the report already read', async () => {
    mockSwept.docs = [
      docOf('cs_1', { listingId: 'listing-1', sellerOrgId: 'pub-1', amountCents: 10_000, feeCents: 1_500 }),
    ]
    const answer = await marketplaceRevenueSource.read(
      request({ orgNames: async () => new Map([['pub-1', 'Acme Plugins']]) }),
    )
    const [byListing, byPublisher] = answer.attribution
    expect(byPublisher.rows[0]).toMatchObject({ key: 'pub-1', name: 'Acme Plugins' })
    // A listing whose document names no plugin keeps its publisher as the detail.
    expect(byListing.rows[0].detail).toBe('Acme Plugins')
  })

  it('states the buyer gross and the payout apart, and the cost it cannot recover', async () => {
    mockSwept.docs = [
      docOf('cs_1', { amountCents: 10_000, taxCents: 0, feeCents: 2_000, transferCents: 8_000 }),
    ]
    const answer = await marketplaceRevenueSource.read(request())
    expect(answer.earned).toMatchObject({ label: 'Marketplace commission', cents: 2_000 })
    expect(answer.grossToNet.map((line) => [line.label, line.cents, line.deduction])).toEqual([
      ['Marketplace sales (buyer gross)', 10_000, false],
      ['— less publisher payouts', 8_000, true],
    ])
    const cost = saleProcessingCostCents(10_000)
    expect(answer.notes[0].label).toBe(
      `~$${(cost / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} of card processing on marketplace sales is NOT recovered — the commission above is gross of it`,
    )
  })
})
