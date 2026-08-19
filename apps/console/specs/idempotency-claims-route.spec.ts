/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored, the suite runs on jsdom, and jsdom has no `Request`
 * constructor, so every route call throws before it asserts anything.
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
 * THE STRANDED-CLAIM QUERY (AGL-2329, item 3). The card is guarded in
 * `idempotency-claims-card.spec.tsx`; a route that answers correctly and a
 * screen that renders it are two halves of the same fix, and neither alone
 * makes the data readable.
 *
 * `api-idempotency.ts` writes `status: 'pending'` at claim and `'done'` at
 * settlement. Its docblock names the failure the field exists for — *"A
 * process killed between the claim and the record leaves a key stuck here"* —
 * and nothing ever queried it. Only `response`, `responseStatus` and
 * `expiresAt` were read, and `expiresAt` is a TTL policy rather than code.
 *
 * WHAT THIS FILE HAS TO CATCH:
 *
 *  - **A screen that shows a count is not a screen that shows the truth.**
 *    The fixture holds three pending claims of DIFFERENT ages, only two past
 *    the stranded threshold, so a route reporting a constant, reporting
 *    `pending` twice, or applying the age cut backwards produces a visibly
 *    wrong number rather than a plausible one.
 *  - **Each row's own facts.** `kind`, `scopeId` and age are asserted per
 *    row. A card printing the first claim's operation on every line looks
 *    right and is wrong for every row but one.
 *  - **The boundary is tested from both sides.** A claim just under the
 *    threshold must read "in flight" and one just over must read "stranded";
 *    a card that called everything stranded would pass any one-sided check.
 *  - **The query cannot be one that throws.** `where('status','==','pending')`
 *    plus a range on `createdAtMs` needs a composite index that does not
 *    exist. The recorded query is asserted, so re-adding that range fails
 *    here rather than in production.
 */

/*==========================================
 * THE ROUTE HALF.
 *=========================================*/
const mockVerifyIdToken = jest.fn()
const mockGet = jest.fn()
/** Every constraint the route hands Firestore, so the query is assertable. */
const mockWhere = jest.fn()
const mockLimit = jest.fn()

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => ({
        collection: (name: string) => {
          const chain: any = {
            where: (field: string, op: string, value: unknown) => {
              mockWhere(field, op, value)
              return chain
            },
            limit: (count: number) => {
              mockLimit(count)
              return chain
            },
            get: () => mockGet(name),
          }
          return chain
        },
      }),
    }),
  },
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
  isImpersonationSession: () => false,
}))

import { GET } from '../app/api/admin/idempotency-claims/route'

const NOW = 1_770_000_000_000
const MINUTE = 60_000

/**
 * Three pending claims, DIFFERENT ages, straddling the 10-minute threshold.
 *
 * `fresh` is 2 minutes old and genuinely in flight. `edge` is 9m59s — just
 * under, so a threshold applied with the wrong comparison flips it. `dead`
 * is two hours old and is the one an operator is looking for. A fixture where
 * every row fell on the same side of the line would let a card that labelled
 * everything "stranded" pass.
 */
const DOCS = [
  {
    id: 'digest-fresh',
    fields: {
      kind: 'checkout',
      scopeId: 'org-acme',
      orgId: 'org-acme',
      createdAtMs: NOW - 2 * MINUTE,
    },
  },
  {
    id: 'digest-edge',
    fields: {
      kind: 'refund',
      scopeId: 'host-northwind',
      orgId: 'org-northwind',
      createdAtMs: NOW - 10 * MINUTE + 1000,
    },
  },
  {
    id: 'digest-dead',
    fields: {
      kind: 'addon-purchase',
      scopeId: 'org-globex',
      orgId: 'org-globex',
      createdAtMs: NOW - 120 * MINUTE,
    },
  },
]

const asSnapshot = (docs: typeof DOCS) => ({
  size: docs.length,
  docs: docs.map((doc) => ({
    id: doc.id,
    get: (field: string) => (doc.fields as Record<string, unknown>)[field],
  })),
})

const call = (token = 'staff-token') =>
  GET(
    new Request('https://console.aglyn.com/api/admin/idempotency-claims', {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    }),
  )

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(Date, 'now').mockReturnValue(NOW)
  mockVerifyIdToken.mockResolvedValue({
    uid: 'u-staff',
    email_verified: true,
    staff: true,
  })
  mockGet.mockResolvedValue(asSnapshot(DOCS))
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('the stranded-claim query (AGL-2329)', () => {
  it('asks only for pending, so it cannot need an index that does not exist', async () => {
    await call()
    expect(mockWhere).toHaveBeenCalledTimes(1)
    expect(mockWhere).toHaveBeenCalledWith('status', '==', 'pending')
    // A second `where` on `createdAtMs` would be an equality plus a range on
    // a DIFFERENT field — a composite index `apiIdempotency` does not have.
    // Asserting the call COUNT is what makes re-adding it fail here instead
    // of in production.
    expect(
      mockWhere.mock.calls.some(([field]) => field === 'createdAtMs'),
    ).toBe(false)
  })

  it('separates in-flight from stranded on the age of each claim', async () => {
    const body = await (await call()).json()

    expect(body.pending).toBe(3)
    // Only ONE of the three is past ten minutes. A constant, a copy of
    // `pending`, or an inverted comparison each gives a different number.
    expect(body.stranded).toBe(1)

    const byId = Object.fromEntries(
      body.claims.map((claim: any) => [claim.id, claim]),
    )
    expect(byId['digest-dead'].stranded).toBe(true)
    // 9m59s. The boundary from the near side — the case an off-by-one in the
    // comparison flips and nothing else catches.
    expect(byId['digest-edge'].stranded).toBe(false)
    expect(byId['digest-fresh'].stranded).toBe(false)

    // Each claim's OWN age and operation, not the first one's everywhere.
    expect(byId['digest-fresh'].ageMs).toBe(2 * MINUTE)
    expect(byId['digest-dead'].ageMs).toBe(120 * MINUTE)
    expect(byId['digest-dead'].kind).toBe('addon-purchase')
    expect(byId['digest-fresh'].kind).toBe('checkout')
  })

  it('puts the longest-stuck claim first', async () => {
    const body = await (await call()).json()
    // Seeded youngest-first, so insertion order and the required order
    // disagree and an unsorted response is visibly wrong.
    expect(body.claims.map((claim: any) => claim.id)).toEqual([
      'digest-dead',
      'digest-edge',
      'digest-fresh',
    ])
  })

  it('refuses a non-staff caller without reading the collection', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'u-x', email_verified: true })
    const response = await call()
    expect(response.status).toBe(403)
    expect(mockGet).not.toHaveBeenCalled()
  })
})

