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

import {
  SALE_PROCESSING_FIXED_CENTS,
  resolveTransactionFeeCents,
  saleProcessingCostCents,
} from '@aglyn/aglyn/server'
import type { RevenueSourceRequest } from '@aglyn/aglyn/plugin-manager/plugin-revenue-sources'
import {
  commerceHostAttribution,
  commerceRevenueSource,
  commerceSettledSummary,
} from './revenue-source'

/**
 * The storefront's take on the operator's revenue report (AGL-2486,
 * AGL-3080).
 *
 * Every assertion is written against a figure DERIVED from the same helpers
 * production charges with, never against a hand-typed constant — a literal
 * passes as happily against a function that returns a constant as against one
 * that measures. These moved here from the console with the fold they pin.
 */

/** A billing org the fee helpers will accept as genuinely paying. */
function payingOrg(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    plan: 'starter',
    billingStatus: 'active',
    subscription: { status: 'active', interval: 'month' },
    ...overrides,
  }
}

describe('storefront commission excludes the processing pass-through', () => {
  const org = payingOrg()

  it('reports the advertised take, not the whole application fee', () => {
    const chargeCents = 20000
    const fee = resolveTransactionFeeCents(org, 'physical', chargeCents, chargeCents)
    const out = commerceSettledSummary([
      { id: 'o1', amountCents: chargeCents, feeCents: fee },
    ])
    // The take is what is left once Stripe's cost is removed — derived from
    // the same two helpers that CHARGED the fee, so a change to either rate
    // moves both sides of this assertion together.
    expect(out.commissionCents).toBe(
      fee - saleProcessingCostCents(chargeCents),
    )
    // The whole fee is still reported, and it is strictly larger. If the code
    // reported the fee as earnings this would be an equality.
    expect(out.applicationFeeCents).toBe(fee)
    expect(out.commissionCents).toBeLessThan(out.applicationFeeCents)
    // Specifically, at least Stripe's fixed 30¢ smaller — the component a
    // percentage-only model would silently keep as margin.
    expect(out.applicationFeeCents - out.commissionCents).toBeGreaterThanOrEqual(
      SALE_PROCESSING_FIXED_CENTS,
    )
  })

  it('never reports a 0%-take sale as earnings', () => {
    // A plan whose advertised storefront take is 0: the entire fee is Stripe
    // cost recovery, so the earned figure must be exactly 0 — not the 30¢+
    // the pass-through collected.
    const zeroTakeOrg = payingOrg({
      plan: 'starter',
      entitlements: { transactionFeePhysicalPct: 0 },
    })
    const chargeCents = 20000
    const fee = resolveTransactionFeeCents(
      zeroTakeOrg,
      'physical',
      chargeCents,
      chargeCents,
    )
    const out = commerceSettledSummary([
      { id: 'o1', amountCents: chargeCents, feeCents: fee },
    ])
    expect(out.commissionCents).toBe(0)
    expect(out.applicationFeeCents).toBeGreaterThan(0)
  })

  it('nets the pass-through out of a subscription cycle too (AGL-2655)', () => {
    // A storefront SUBSCRIPTION cycle carries `subscriptionId`, and since
    // AGL-2655 its fee carries the card cost folded into
    // `application_fee_percent`. Reporting that fee whole would book Stripe's
    // charge as margin on every cycle, the AGL-2152 mistake over again.
    const chargeCents = 20000
    const passThrough = saleProcessingCostCents(chargeCents)
    const out = commerceSettledSummary([
      {
        id: 'o1',
        amountCents: chargeCents,
        feeCents: 400 + passThrough,
        subscriptionId: 'sub_1',
      },
    ])
    expect(out.commissionCents).toBe(400)
    expect(out.processingPassThroughCents).toBe(passThrough)
    expect(out.subscriptionOrders).toBe(1)
    // The one cycle this understates, stated rather than hidden: a cycle
    // billed at the bare take, before the renewal re-price carried the
    // subscription onto the pass-through, clamps to no take at all. It is
    // still COUNTED, which is how the page shows how much of the book that is.
    const legacy = commerceSettledSummary([
      { id: 'o1', amountCents: chargeCents, feeCents: 400, subscriptionId: 'sub_1' },
    ])
    expect(legacy.commissionCents).toBe(0)
    expect(legacy.subscriptionOrders).toBe(1)
  })

  it('reverses a refunded order pro-rata', () => {
    const chargeCents = 20000
    const fee = resolveTransactionFeeCents(org, 'physical', chargeCents, chargeCents)
    const full = commerceSettledSummary([
      { id: 'o1', amountCents: chargeCents, feeCents: fee, refundedCents: chargeCents },
    ])
    expect(full.commissionNetCents).toBe(0)
    expect(full.commissionCents).toBeGreaterThan(0)
  })
})

describe('attribution by host', () => {
  const order = (
    hostId: string,
    amountCents: number,
    feeCents: number,
    refundedCents = 0,
  ) => ({
    id: `o_${hostId}_${amountCents}`,
    hostId,
    amountCents,
    feeCents,
    refundedCents,
  })

  it('sums host rows to the storefront commission line exactly', () => {
    const rows = [
      order('host-a', 20_000, 2_000),
      order('host-a', 5_000, 700),
      order('host-b', 9_000, 1_100, 9_000),
      // A zero-fee order: counted, but there is no take to attribute.
      order('host-c', 3_000, 0),
    ]
    const total = commerceSettledSummary(rows)
    const byHost = commerceHostAttribution(rows)
    expect(byHost.rows.reduce((s, r) => s + r.gainCents, 0)).toBe(
      total.commissionNetCents,
    )
    expect(byHost.rows.find((r) => r.key === 'host-c')?.gainCents).toBe(0)
  })

})

/**
 * A REHEARSAL IS NOT REVENUE, ON THE STAFF PAGE TOO.
 *
 * The only order in production is a `cs_test_…` smoke-test checkout Stripe
 * never moved money for, and this summary counted it as a settled storefront
 * sale Aglyn had taken commission on. Every case carries a LIVE order beside
 * the test one: with only a test row in the fixture, a filter that dropped
 * everything would be indistinguishable from one that worked.
 */
describe('test-mode orders are not settled revenue', () => {
  const live = { id: 'cs_live_real', amountCents: 10000, feeCents: 300 }
  const test = { id: 'cs_test_smoke', amountCents: 1800, feeCents: 36 }

  it('leaves the rehearsal out and keeps the real sale', () => {
    const out = commerceSettledSummary([live, test])

    expect(out.grossCents).toBe(10000)
    // Skipped entirely, not counted at zero: `transactionCount` is read as
    // "how many sales", and a rehearsal is not one.
    expect(out.transactionCount).toBe(1)
    expect(out.applicationFeeCents).toBe(300)
  })

  it('CONTROL: the same order counts once its id is a live session', () => {
    const out = commerceSettledSummary([live, { ...test, id: 'cs_live_two' }])

    expect(out.grossCents).toBe(11800)
    expect(out.transactionCount).toBe(2)
  })

  it('CONTROL: a recorded livemode beats a test-shaped id', () => {
    const out = commerceSettledSummary([live, { ...test, livemode: true }])

    expect(out.grossCents).toBe(11800)
    expect(out.transactionCount).toBe(2)
  })

  it('CONTROL: an order with no Stripe id at all is real money', () => {
    // A POS cash sale. Answering "test" for anything unidentifiable would
    // erase genuine revenue from the staff figures.
    const out = commerceSettledSummary([
      { id: 'aBcD1234auto', amountCents: 5000, feeCents: 150 },
    ])

    expect(out.grossCents).toBe(5000)
    expect(out.transactionCount).toBe(1)
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

describe('the storefront’s revenue source', () => {
  it('ranges orders on createdAtMs across the collection GROUP, never createdAt', async () => {
    await commerceRevenueSource.read(request())
    expect(mockGroup).toBe('group:orders')
    const fields = mockWheres.map(([field]) => field)
    expect(new Set(fields)).toEqual(new Set(['createdAtMs']))
    expect(mockWheres).toEqual([
      ['createdAtMs', '>=', Date.UTC(2026, 7, 1)],
      ['createdAtMs', '<', Date.UTC(2026, 8, 1)],
    ])
  })

  it('reports a failed sweep as a FAILURE, never as a cap', async () => {
    mockSwept.fail = true
    const answer = await commerceRevenueSource.read(request())
    expect(answer.failure?.title).toBe('Storefront orders could not be read')
    // The whole point: a query that could not run must not masquerade as one
    // that stopped at the ceiling — they have different remedies.
    expect(answer.truncated).toBe(false)
    expect(answer.earned.cents).toBe(0)
  })

  it('reports a sweep the ceiling stopped as truncated, under its own name', async () => {
    mockSwept.truncated = true
    const answer = await commerceRevenueSource.read(request())
    expect(answer).toMatchObject({ truncated: true, failure: null, name: 'storefront orders' })
  })

  it('counts an order, attributes it to the host in its PATH, and names only shown rows', async () => {
    mockSwept.docs = [
      docOf('order-1', { createdAtMs: Date.UTC(2026, 7, 2), amountCents: 20_000, feeCents: 2_000 }, 'host-a'),
    ]
    const nameRows = jest.fn(async (rows: any[]) => {
      rows[0].name = 'Northwind Coffee'
    })
    const answer = await commerceRevenueSource.read(request({ nameRows }))
    const settled = answer.summary as ReturnType<typeof commerceSettledSummary>
    expect(settled.transactionCount).toBe(1)
    expect(answer.earned.cents).toBeGreaterThan(0)
    const [byHost] = answer.attribution
    expect(byHost.rows).toHaveLength(1)
    expect(byHost.rows[0]).toMatchObject({ key: 'host-a', name: 'Northwind Coffee' })
    // It reconciles to the storefront line above it.
    expect(byHost.rows[0].gainCents).toBe(answer.earned.cents)
    expect(nameRows).toHaveBeenCalledWith(byHost.rows, {
      collection: 'hosts',
      nameField: 'displayName',
      detailField: 'subdomain',
    })
  })

  it('states the take, the fee and the pass-through apart, and counts subscription cycles', async () => {
    const chargeCents = 20_000
    const passThrough = saleProcessingCostCents(chargeCents)
    mockSwept.docs = [
      docOf('o1', { amountCents: chargeCents, feeCents: 400 + passThrough, subscriptionId: 'sub_1' }, 'host-a'),
    ]
    const answer = await commerceRevenueSource.read(request())
    expect(answer.earned).toMatchObject({ label: 'Storefront commission', cents: 400 })
    expect(answer.grossToNet.map((line) => [line.label, line.cents, line.deduction])).toEqual([
      ['Storefront sales (shopper gross)', chargeCents, false],
      ['Storefront platform fee collected', 400 + passThrough, false],
      ['— less card processing passed through at cost', passThrough, true],
    ])
    expect(answer.notes).toEqual([
      {
        label: '1 storefront subscription cycles — one billed before its re-price reports no take',
        tone: 'warning',
      },
    ])
  })
})
