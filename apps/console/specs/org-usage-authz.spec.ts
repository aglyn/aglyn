/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored.
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
 * AGL-939 surfaces /api/admin/org-usage on the org detail page, so its
 * authorization contract gets pinned: no token → 401, a verified NON-staff
 * token → 403, and a staff token → the monthly rollups. The 403 is the
 * load-bearing case — the detail page hands this endpoint to a browser
 * session, and the staff claim on the decoded token is the only gate.
 */

const mockVerifyIdToken = jest.fn()
const mockUsageGet = jest.fn()

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => ({
        collection: () => ({
          doc: () => ({
            collection: () => ({
              orderBy: () => ({
                limit: () => ({ get: () => mockUsageGet() }),
              }),
            }),
          }),
        }),
      }),
    }),
  },
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () =>
    Response.json(
      { error: 'Verify your email to continue', reason: 'email-unverified' },
      { status: 403 },
    ),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  // The cost model is the REAL one (AGL-1134), deliberately. Stubbing it
  // would let this file assert a number the guardrail does not actually
  // compute, which is the whole thing being guarded against — the preview
  // and the apply route reaching different answers.
  orgCogsInputFrom: jest.requireActual('@aglyn/aglyn/server').orgCogsInputFrom,
  orgMonthlyCogsUsd: jest.requireActual('@aglyn/aglyn/server')
    .orgMonthlyCogsUsd,
  pluginRequestFromWeb: async (request: Request) => {
    const url = new URL(request.url)
    return {
      method: request.method,
      query: Object.fromEntries(url.searchParams.entries()),
      headers: {
        authorization: request.headers.get('authorization') ?? undefined,
      },
    }
  },
}))

import { GET } from '../app/api/admin/org-usage/route'

const get = (opts: { token?: string; orgId?: string } = {}) =>
  GET(
    new Request(
      `https://app.aglyn.com/api/admin/org-usage?orgId=${opts.orgId ?? 'org-1'}`,
      {
        headers: opts.token ? { authorization: `Bearer ${opts.token}` } : {},
      },
    ),
  )

describe('/api/admin/org-usage authorization (AGL-939)', () => {
  beforeEach(() => jest.clearAllMocks())

  it('401s an unauthenticated caller', async () => {
    const response = await get()
    expect(response.status).toBe(401)
  })

  it('403s a verified NON-staff token — the claim is the gate', async () => {
    mockVerifyIdToken.mockResolvedValueOnce({
      uid: 'user-1',
      email_verified: true,
      // no `staff` claim
    })
    const response = await get({ token: 'tok' })
    expect(response.status).toBe(403)
    expect(mockUsageGet).not.toHaveBeenCalled()
  })

  it('serves the monthly rollups to a staff token', async () => {
    mockVerifyIdToken.mockResolvedValueOnce({
      uid: 'staff-1',
      email_verified: true,
      staff: true,
    })
    // Shaped like a real `QueryDocumentSnapshot`: both `get(field)` and
    // `data()`. The double carried only `get` until AGL-1134, which reads the
    // whole document through `orgCogsInputFrom` rather than naming fields at
    // the call site — a double thinner than the thing it stands in for hides
    // exactly that kind of change.
    const fields = {
      month: '2026-08',
      storageGb: 1.5,
      pageViews: 100,
      formSubmissions: 3,
      costUsd: 2.5,
      dataStorageMb: 2048,
      apiRequests: 50_000,
      contactsCount: 400,
    }
    mockUsageGet.mockResolvedValueOnce({
      docs: [
        {
          id: '2026-08',
          get: (key: string) => fields[key as keyof typeof fields],
          data: () => fields,
        },
      ],
    })
    const response = await get({ token: 'tok' })
    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.months).toEqual([
      {
        month: '2026-08',
        storageGb: 1.5,
        pageViews: 100,
        formSubmissions: 3,
        costUsd: 2.5,
        // The three meters the projection used to drop (AGL-1134). The rollup
        // records them and the cost model prices them, so serving rows
        // without them made a client price this org lower than the server did.
        dataStorageMb: 2048,
        apiRequests: 50_000,
        contactsCount: 400,
      deltas: null,
      },
    ])
  })

  it('serves the newest rollup priced by the shared cost model (AGL-1134)', async () => {
    // The number the staff org page rates a coupon against. It has to be the
    // same one `/api/admin/org-discount` computes before it refuses, or the
    // badge and the button disagree — so this pins the value, not just its
    // presence.
    mockVerifyIdToken.mockResolvedValueOnce({
      uid: 'staff-1',
      email_verified: true,
      staff: true,
    })
    const fields = {
      month: '2026-07',
      storageGb: 10,
      pageViews: 200_000,
      formSubmissions: 1_000,
      dataStorageMb: 10_240,
      apiRequests: 1_000_000,
      contactsCount: 5_000,
      costUsd: 0.9,
    }
    mockUsageGet.mockResolvedValueOnce({
      docs: [
        {
          id: '2026-07',
          get: (key: string) => fields[key as keyof typeof fields],
          data: () => fields,
        },
      ],
    })
    const payload = await (await get({ token: 'tok' })).json()
    // Hand-computed, NOT snapshotted — a snapshot would happily record a
    // wrong number. All USD/month:
    //   storage           10 GB      × $0.026    = $0.26
    //   page views        200,000    × $0.0001   = $20.00
    //   form submissions  1,000      × $0.00005  = $0.05
    //   dataset storage   10,240 MB  = 10 GB × $0.18 = $1.80   ← MB, per-GB rate
    //   API requests      1,000,000  × $0.000002 = $2.00
    //   contacts          5,000      × $0.0002   = $1.00
    //                                              -------
    //                                              $25.11
    expect(payload.latest.month).toBe('2026-07')
    expect(payload.latest.measuredCogsUsd).toBeCloseTo(25.11, 6)
    // The MEASURED half only — the per-site floor belongs to the caller, and
    // `checkDiscountMargin` applies it itself. Returning a floored figure
    // here would charge the floor twice.
    expect(payload.latest.measuredCogsUsd).not.toBeCloseTo(25.11 + 2, 6)
  })

  it('reports no rollup as null rather than a zero cost', async () => {
    // A brand-new org. `measuredCogsUsd: 0` would read as "this org is free
    // to serve", which is the direction that approves a discount; `null` is
    // "not measured", which the guardrail answers with its floor.
    mockVerifyIdToken.mockResolvedValueOnce({
      uid: 'staff-1',
      email_verified: true,
      staff: true,
    })
    mockUsageGet.mockResolvedValueOnce({ docs: [] })
    const payload = await (await get({ token: 'tok' })).json()
    expect(payload.latest).toBeNull()
    expect(payload.months).toEqual([])
  })
})
