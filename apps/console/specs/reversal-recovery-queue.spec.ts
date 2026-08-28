/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored, and this suite needs `Request`/`Response`.
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
 * THE REFUND-REVERSAL RECOVERY QUEUE REACHES A HUMAN (AGL-2309).
 *
 * `billing-webhook.ts` stamps `reversalFailedAt` / `reversalFailedReason` /
 * `reversalOwedCents` when Stripe DEFINITIVELY refuses to pull a publisher's
 * share back after a buyer refund, and its own comment named the query that
 * would find them again:
 *
 *   > `where('reversalFailedAt', '!=', null)` is then the recovery queue.
 *
 * There was no such query anywhere in the repo. Every refusal was money owed
 * to Aglyn, recorded so a human could chase it, and reachable by no human.
 *
 * WHAT THIS FILE HAS TO CATCH, and why each assertion is shaped as it is:
 *
 *  - The query exists but selects the wrong rows. A queue that also lists
 *    healthy refunds is a queue nobody trusts, so the double models `!=` null
 *    the way Firestore does — a document MISSING the field is excluded, not
 *    matched — and a settled refund sits in the fixture as the control.
 *  - The rows arrive but the amount does not. `AN AMOUNT PER ROW` seeds two
 *    refusals with DIFFERENT owed amounts and demands each row carry its own.
 *    A projection that hardcoded a figure, dropped the field, or reused the
 *    first row's value for every row survives any "does a row render" check
 *    and dies here.
 *  - The total disagrees with the rows. The header is what staff read first,
 *    so it is summed on the server from the same rows and asserted to be the
 *    SUM — not either row's value, which is what a copy-paste would leave.
 *
 * The other half of the chain — that the WRITER records the measured amount
 * rather than a constant — is guarded in
 * `libs/plugins/marketplace/.../billing-webhook-refund-reversal.spec.ts`
 * ("records the MEASURED owed amount, not a constant"), which drives two
 * refusals of different sizes through the real webhook. It cannot live here:
 * nx `depConstraints` forbid `scope:app` from importing an `aglyn:addons`
 * lib, so console code and marketplace code cannot meet in one module.
 */

const mockVerifyIdToken = jest.fn()

const state: {
  purchases: Record<string, Record<string, unknown>>
  /**
   * Orgs, and each one's monthly usage rollup by month key.
   *
   * Seeded because two of the route's answers are ABOUT an org rather than
   * merely keyed on one: the recovery queue names the seller, and the anomaly
   * detector names the workspace that spiked. Neither can be checked against
   * an empty orgs collection.
   */
  orgs: Record<
    string,
    { data: Record<string, unknown>; usage?: Record<string, Record<string, unknown>> }
  >
  /** Every `where(...)` the route issued, so the queue's clause is provable. */
  wheres: Array<[string, string, unknown]>
} = { purchases: {}, orgs: {}, wheres: [] }

const stamp = (millis: number) => ({ toMillis: () => millis })

/**
 * A query over `marketplacePurchases`.
 *
 * `where('reversalFailedAt', '!=', null)` is modelled the way Firestore
 * evaluates it: the field must EXIST and be non-null. Firestore's inequality
 * operators skip documents without the field entirely, and a double that
 * instead compared `undefined !== null` and matched would hand this suite
 * every purchase in the fixture — turning the control row green and making
 * the selectivity test unable to fail.
 */
const purchaseQuery = (
  filters: Array<[string, string, unknown]> = [],
): any => ({
  orderBy: () => purchaseQuery(filters),
  limit: () => purchaseQuery(filters),
  where: (field: string, op: string, value: unknown) => {
    state.wheres.push([field, op, value])
    return purchaseQuery([...filters, [field, op, value]])
  },
  get: async () => {
    const docs = Object.entries(state.purchases)
      .filter(([, data]) =>
        filters.every(([field, op, value]) => {
          const held = data[field]
          if (op === '!=') return held !== undefined && held !== value
          return held === value
        }),
      )
      .map(([id, data]) => ({ id, data: () => data }))
    return { docs, size: docs.length, empty: docs.length === 0 }
  },
})

/**
 * A listing over `state.orgs`, including each org's `usage/{month}` docs.
 *
 * The usage docs answer through `get(field)`, the way an Admin SDK snapshot
 * does, and a month that was never seeded reports `exists: false` — which is
 * what makes "no prior month, so no spike" a case the detector really sees
 * rather than one the double smooths over.
 */
const orgListing = (): any => ({
  orderBy: () => orgListing(),
  limit: () => orgListing(),
  where: () => orgListing(),
  select: () => orgListing(),
  count: () => ({
    get: async () => ({ data: () => ({ count: Object.keys(state.orgs).length }) }),
  }),
  get: async () => {
    const docs = Object.entries(state.orgs).map(([id, org]) => ({
      id,
      data: () => org.data,
      get: (field: string) => org.data[field],
      ref: {
        collection: () => ({
          doc: (month: string) => ({
            get: async () => {
              const held = org.usage?.[month]
              return {
                exists: Boolean(held),
                data: () => held ?? {},
                get: (field: string) => held?.[field],
              }
            },
          }),
        }),
      },
    }))
    return { docs, size: docs.length, empty: docs.length === 0 }
  },
  doc: () => ({
    get: async () => ({ exists: false, data: () => ({}), get: () => undefined }),
    collection: () => emptyListing(),
  }),
})

/** A listing over nothing, for the collections this file does not seed. */
const emptyListing = (): any => ({
  orderBy: () => emptyListing(),
  limit: () => emptyListing(),
  where: () => emptyListing(),
  select: () => emptyListing(),
  count: () => ({ get: async () => ({ data: () => ({ count: 0 }) }) }),
  get: async () => ({ docs: [], size: 0, empty: true }),
  doc: () => ({
    get: async () => ({ exists: false, data: () => ({}), get: () => undefined }),
    collection: () => emptyListing(),
  }),
})

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => ({
        collection: (name: string) => {
          if (name === 'marketplacePurchases') return purchaseQuery()
          if (name === 'orgs') return orgListing()
          return emptyListing()
        },
        collectionGroup: () => emptyListing(),
      }),
    }),
  },
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
}))

// The REAL revenue and cost helpers are spread in — stubbing them would make
// this file assert that a mock agreed with itself about MRR.
jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  ...jest.requireActual(
    '../../../libs/aglyn/src/lib/app-utils/plan-entitlements',
  ),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/org-billing-doc'),
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    query: Object.fromEntries(new URL(request.url).searchParams.entries()),
    headers: {
      authorization: request.headers.get('authorization') ?? undefined,
    },
  }),
}))

import { GET } from '../app/api/admin/overview/route'

const REFUSED_SMALL = 'cs_refused_small'
const REFUSED_LARGE = 'cs_refused_large'
const SETTLED = 'cs_settled'

const overview = (token = 'staff-token') =>
  GET(
    new Request('https://console.aglyn.com/api/admin/overview', {
      headers: { authorization: `Bearer ${token}` },
    }),
  )

beforeEach(() => {
  state.wheres = []
  state.orgs = {}
  state.purchases = {
    // The amounts are the real ones the webhook computes for a $50 and an $80
    // refund of the AGL-1639 worked example ($100 listing, 20% platform rate,
    // $8.25 tax, 8000 transfer): floor(5000 × 8000 ÷ 10825) = 3695 and
    // floor(8000 × 8000 ÷ 10825) = 5912. They differ so that no single
    // constant can satisfy both rows.
    [REFUSED_SMALL]: {
      listingId: 'listing-small',
      sellerOrgId: 'seller-small',
      buyerUid: 'buyer-1',
      amountCents: 10825,
      feeCents: 2000,
      reversalFailedAt: stamp(1000),
      reversalFailedReason: 'reversal-refused',
      reversalFailedCause: 'partial-refund',
      reversalOwedCents: 3695,
    },
    [REFUSED_LARGE]: {
      listingId: 'listing-large',
      sellerOrgId: 'seller-large',
      buyerUid: 'buyer-2',
      amountCents: 10825,
      feeCents: 2000,
      reversalFailedAt: stamp(9000),
      reversalFailedReason: 'no-transfer-on-charge',
      reversalFailedCause: 'refund',
      reversalOwedCents: 5912,
    },
    // The CONTROL. A refund whose reversal succeeded owes nothing and must
    // never appear — without it, a queue that listed every purchase would
    // pass every assertion below about the two rows it does contain.
    [SETTLED]: {
      listingId: 'listing-settled',
      sellerOrgId: 'seller-settled',
      buyerUid: 'buyer-3',
      amountCents: 10825,
      feeCents: 2000,
      refundedAt: stamp(5000),
      reversedTransferCents: 8000,
      transferReversalId: 'trr_ok',
    },
  }
  mockVerifyIdToken.mockReset()
  mockVerifyIdToken.mockResolvedValue({
    uid: 'staff-1',
    email: 'staff@aglyn.com',
    email_verified: true,
    staff: true,
    staffRole: 'super',
  })
})

describe('only staff reach the queue', () => {
  it('401s without a bearer token', async () => {
    const response = await GET(
      new Request('https://console.aglyn.com/api/admin/overview'),
    )
    expect(response.status).toBe(401)
  })

  it('403s a signed-in customer — owed money is not a customer fact', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'user-1', email_verified: true })
    expect((await overview()).status).toBe(403)
  })
})

describe('the queue selects the rows the writer meant', () => {
  it("issues the writer's own documented clause", async () => {
    await overview()
    // Not a style assertion: `reversalFailedAt` is the only field every
    // refusal branch stamps (`reversalOwedCents` is omitted when the amount
    // was never learned), so a queue keyed on the amount would silently drop
    // the rows with no amount — the ones hardest to reconstruct by hand.
    expect(state.wheres).toContainEqual(['reversalFailedAt', '!=', null])
  })

  it('lists the refusals and NOT a refund that reversed cleanly', async () => {
    const body = await (await overview()).json()
    expect(body.reversalRecovery.map((row: any) => row.$id).sort()).toEqual(
      [REFUSED_LARGE, REFUSED_SMALL].sort(),
    )
  })

  it('puts the newest refusal first, so the freshest chase is at the top', async () => {
    const body = await (await overview()).json()
    expect(body.reversalRecovery[0].$id).toBe(REFUSED_LARGE)
  })
})

describe('AN AMOUNT PER ROW, not a figure on the card', () => {
  it('carries each row’s OWN owed amount, reason and cause', async () => {
    const body = await (await overview()).json()
    const byId = Object.fromEntries(
      body.reversalRecovery.map((row: any) => [row.$id, row]),
    )
    // Two different amounts, asserted separately. A projection that reused
    // the first row's value for every row, or emitted a constant, satisfies
    // exactly one of these two lines.
    expect(byId[REFUSED_SMALL]).toMatchObject({
      owedCents: 3695,
      reason: 'reversal-refused',
      cause: 'partial-refund',
      sellerOrgId: 'seller-small',
      listingId: 'listing-small',
    })
    expect(byId[REFUSED_LARGE]).toMatchObject({
      owedCents: 5912,
      reason: 'no-transfer-on-charge',
      cause: 'refund',
      sellerOrgId: 'seller-large',
      listingId: 'listing-large',
    })
  })

  it('totals what is outstanding — the SUM, not either row', async () => {
    const body = await (await overview()).json()
    expect(body.metrics.reversalOwedCents).toBe(3695 + 5912)
  })

  it('keeps a refusal whose amount was never learned, at zero', async () => {
    // `no-charge-on-cause` and `no-transfer` settle without an amount. Such a
    // row is the one a human most needs to see, because nothing else in the
    // system can reconstruct what it owes — so it must not be filtered out by
    // a well-meaning `owedCents > 0`.
    state.purchases['cs_unknown_amount'] = {
      listingId: 'listing-unknown',
      sellerOrgId: 'seller-unknown',
      reversalFailedAt: stamp(2000),
      reversalFailedReason: 'no-charge-on-cause',
      reversalFailedCause: 'refund',
    }
    const body = await (await overview()).json()
    const row = body.reversalRecovery.find(
      (candidate: any) => candidate.$id === 'cs_unknown_amount',
    )
    expect(row).toMatchObject({ owedCents: 0, reason: 'no-charge-on-cause' })
    // And it does not disturb the total.
    expect(body.metrics.reversalOwedCents).toBe(3695 + 5912)
  })
})

describe('an empty queue is a real answer', () => {
  it('reports nothing outstanding when every reversal landed', async () => {
    delete state.purchases[REFUSED_SMALL]
    delete state.purchases[REFUSED_LARGE]
    const body = await (await overview()).json()
    expect(body.reversalRecovery).toEqual([])
    expect(body.metrics.reversalOwedCents).toBe(0)
  })
})
