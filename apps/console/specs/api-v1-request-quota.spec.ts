/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header
 * it is silently ignored and this runs on jsdom, where the route's
 * Response helpers are unavailable.
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
 * `checkApiRequestQuota(...).allowed` now REFUSES (AGL-2163).
 *
 * The defect: the field existed, its docblock promised "plans without API
 * access have `included: 0` and always block", and
 * `free-tier-never-billed.spec.ts` listed it as one of the free tier's
 * runtime braces — but its only call site anywhere was
 * `/api/billing/report-usage`, which reads `overageMonthlyUsd` and ignores
 * `allowed`. Nothing refused. A test asserting the function returns `false`
 * would have been green throughout, which is why every assertion here drives
 * the REAL `/api/v1` route and looks at the STATUS ON THE WIRE.
 *
 * The blast radius was small only by accident: on every shipping plan,
 * "has `apiAccess`" and "has a non-zero `apiRequestsPerMonth`" are the same
 * fact, so the entitlement gate fired first. A per-org `features.apiAccess`
 * override separates them — and that is the org modelled below.
 *
 * ⚠️ THE NEGATIVE CONTROL IS THE POINT. Business/Advanced/Agency carry an
 * overage rate and Enterprise an unlimited band, so a paying integration must
 * stay `allowed: true` at ANY volume and must never meet this check — cutting
 * one off mid-month is a worse bug than the one being fixed. It is asserted
 * both ways: the status stays 200, and the quota path costs that org zero
 * extra Firestore reads.
 */

const mockVerifyApiKey = jest.fn()
const mockGetOrgDoc = jest.fn()
const mockLockdownRefusal = jest.fn()

/** `orgs/{id}/apiUsage/{month}` — the doc the route already WRITES per call. */
let mockApiUsageCount = 0
/** Reads of that doc, so "costs a paying customer nothing" is measured. */
let mockApiUsageReads = 0

jest.mock('@aglyn/tenant-data-admin', () => {
  // Real error envelope + header builder: this spec is about the wire.
  const apiHttp = jest.requireActual(
    '../../../libs/tenant/data/admin/src/lib/server/api-http',
  )
  const apiUsageDoc = {
    set: async () => undefined,
    get: async () => {
      mockApiUsageReads += 1
      return { get: (field: string) => (field === 'count' ? mockApiUsageCount : undefined) }
    },
  }
  return {
    __esModule: true,
    ...apiHttp,
    // The per-minute limiter is not under test here; always allow, with the
    // real header shape so a refusal below cannot be it in disguise.
    consumeRateLimit: async () => ({
      allowed: true,
      remaining: 119,
      limit: 120,
      resetMs: Date.now() + 60_000,
      degraded: false,
    }),
    firebaseAdmin: {
      app: () => ({
        firestore: () => ({
          collection: () => ({
            doc: () => ({ collection: () => ({ doc: () => apiUsageDoc }) }),
          }),
        }),
      }),
      firestore: {
        FieldValue: {
          increment: (n: number) => n,
          serverTimestamp: () => 'NOW',
        },
      },
    },
    getOrgDoc: (...args: unknown[]) => mockGetOrgDoc(...args),
    verifyApiKey: (...args: unknown[]) => mockVerifyApiKey(...args),
    lockdownRefusal: (...args: unknown[]) => mockLockdownRefusal(...args),
  }
})

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldPath: { documentId: () => '__name__' },
  Timestamp: { fromMillis: (ms: number) => ({ toMillis: () => ms }) },
}))

import { GET } from '../app/api/v1/[[...route]]/route'
import {
  apiRequestEnforcementShape,
  checkApiRequestQuota,
} from '@aglyn/aglyn/server'

const call = () =>
  GET(
    new Request('https://app.aglyn.com/api/v1', {
      headers: { authorization: 'Bearer k' },
    }),
    { params: Promise.resolve({ route: [] as string[] }) },
  )

/** Free plan, API access granted by a per-org override — the reachable shape. */
const overriddenOrg = (apiRequestsPerMonth?: number) => ({
  plan: 'free',
  entitlements: {
    features: { apiAccess: true },
    ...(apiRequestsPerMonth === undefined ? {} : { apiRequestsPerMonth }),
  },
})

beforeEach(() => {
  jest.clearAllMocks()
  mockApiUsageCount = 0
  mockApiUsageReads = 0
  mockVerifyApiKey.mockResolvedValue({
    orgId: 'org-1',
    keyId: 'key-1',
    scopes: ['read'],
  })
  mockGetOrgDoc.mockResolvedValue({ plan: 'business' })
  mockLockdownRefusal.mockResolvedValue(null)
})

describe('the /api/v1 chokepoint enforces the monthly request quota (AGL-2163)', () => {
  it('THE NEGATIVE CONTROL: a metered plan stays allowed and is NOT refused', async () => {
    // Business carries `extraApiRequestsUsdPer1k: 0.5`, so the overage BILLS.
    // Ten million requests against a 100,000 band — a hundredfold overage —
    // and the answer is still 200. This is the assertion that would have
    // caught the naive version of this fix.
    mockApiUsageCount = 10_000_000
    expect(checkApiRequestQuota({ plan: 'business' } as never, 10_000_000).allowed).toBe(true)
    const response = await call()
    expect(response.status).toBe(200)
    // …and it did not even look: a paying customer pays no read for a check
    // whose answer their plan already determines.
    expect(mockApiUsageReads).toBe(0)
    expect(apiRequestEnforcementShape({ plan: 'business' } as never)).toBe(
      'never-blocks',
    )
  })

  it('every plan that ships with API access is never-blocks', async () => {
    for (const plan of ['business', 'advanced', 'agency', 'enterprise']) {
      expect(apiRequestEnforcementShape({ plan } as never)).toBe('never-blocks')
    }
  })

  it('THE BRANCH: apiAccess granted with a ZERO band is refused', async () => {
    // The exact shape the filing named: a per-org `features.apiAccess`
    // override on a plan whose `apiRequestsPerMonth` is 0. The entitlement
    // gate passes — that is what the override does — and before this fix
    // NOTHING else looked, so the key ran unbounded and unbilled.
    mockGetOrgDoc.mockResolvedValue(overriddenOrg())
    const response = await call()
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({
      error: { type: 'plan_required' },
    })
    // No measurement needed: a band of zero cannot be satisfied by any count.
    expect(mockApiUsageReads).toBe(0)
  })

  it('a granted FINITE band is measured, and refuses only past it', async () => {
    mockGetOrgDoc.mockResolvedValue(overriddenOrg(5_000))
    expect(apiRequestEnforcementShape(overriddenOrg(5_000) as never)).toBe(
      'measure',
    )

    mockApiUsageCount = 4_999
    expect((await call()).status).toBe(200)
    expect(mockApiUsageReads).toBe(1)

    mockApiUsageCount = 5_000
    const refused = await call()
    // 429, not 403: the MONTH's budget is spent, not the plan's capability,
    // and an integration needs a `Retry-After` it can back off on.
    expect(refused.status).toBe(429)
    expect(Number(refused.headers.get('Retry-After'))).toBeGreaterThan(0)
  })

  it('the refusal is the QUOTA, not the per-minute limiter in disguise', async () => {
    // Both answer 429. Without this the previous assertion could be green
    // because the rate limiter fired — the harness allows it explicitly, and
    // the honest way to say so is to assert the allowed case is 200 with the
    // very same limiter response.
    mockGetOrgDoc.mockResolvedValue(overriddenOrg(5_000))
    mockApiUsageCount = 0
    expect((await call()).status).toBe(200)
    mockApiUsageCount = 5_000
    expect((await call()).status).toBe(429)
  })
})
