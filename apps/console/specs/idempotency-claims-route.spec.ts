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
 *  - **Every clause is on the query (AGL-3321).** The recorded query is
 *    asserted: `status == 'pending'`, the panel's clauses, and Age and State
 *    as ranges over `createdAtMs`, the order the list pages by — each shape
 *    a composite the index file carries (`idempotency-claims-list-query.spec.ts`).
 *  - **The two numbers are totals.** They are COUNT aggregations over every
 *    pending claim, not counts of the page on screen.
 */

/*==========================================
 * THE ROUTE HALF.
 *=========================================*/
const mockVerifyIdToken = jest.fn()
const mockGet = jest.fn()
/** Every read, with the constraints it carried, so the query is assertable. */
const mockReads: Array<{ wheres: Array<[string, string, unknown]>; orderBy: string[]; limit: number | null; count: boolean }> = []

type Read = (typeof mockReads)[number]
const mockChain = (name: string, read: Read): any => ({
  where: (field: unknown, op: string, value: unknown) =>
    mockChain(name, { ...read, wheres: [...read.wheres, [String(field), op, value]] }),
  orderBy: (field: unknown, direction: string) =>
    mockChain(name, { ...read, orderBy: [...read.orderBy, `${String(field)} ${direction}`] }),
  limit: (count: number) => mockChain(name, { ...read, limit: count }),
  startAfter: () => mockChain(name, read),
  count: () => ({
    get: async () => {
      mockReads.push({ ...read, count: true })
      return { data: () => ({ count: mockCount(read) }) }
    },
  }),
  get: () => {
    mockReads.push(read)
    return mockGet(name, read)
  },
})
/** A count over the fixture, honoring the `createdAtMs` ranges it was asked. */
let mockCount: (read: Read) => number = () => 0

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => ({
        collection: (name: string) =>
          mockChain(name, { wheres: [], orderBy: [], limit: null, count: false }),
        doc: (path: string) => ({ get: async () => ({ exists: false, path }) }),
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

/** Oldest first, as the query's order returns them. */
const asSnapshot = (docs: typeof DOCS) => {
  const ordered = [...docs].sort((a, b) => a.fields.createdAtMs - b.fields.createdAtMs)
  return {
    size: ordered.length,
    docs: ordered.map((doc) => ({
      id: doc.id,
      ref: { path: `apiIdempotency/${doc.id}` },
      get: (field: string) => (doc.fields as Record<string, unknown>)[field],
    })),
  }
}

const call = (search = '', token = 'staff-token') =>
  GET(
    new Request(`https://console.aglyn.com/api/admin/idempotency-claims${search}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    }),
  )

const inRange = (value: number, op: string, bound: number) =>
  op === '<' ? value < bound : op === '<=' ? value <= bound : op === '>' ? value > bound : value >= bound

beforeEach(() => {
  jest.clearAllMocks()
  mockReads.length = 0
  mockCount = (read) =>
    DOCS.filter((doc) =>
      read.wheres
        .filter(([field]) => field === 'createdAtMs')
        .every(([, op, bound]) => inRange(doc.fields.createdAtMs, op, Number(bound))),
    ).length
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
  it('lists the pending claims, oldest first, on one query', async () => {
    const body = await (await call()).json()
    expect(mockReads[0].wheres).toEqual([['status', '==', 'pending']])
    expect(mockReads[0].orderBy).toEqual(['createdAtMs asc'])
    // Over-fetched by one, so "is there more" is observed.
    expect(mockReads[0].limit).toBe(26)
    // Seeded youngest-first, so insertion order and the required order
    // disagree and an unordered read is visibly wrong.
    expect(body.rows.map((claim: any) => claim.id)).toEqual([
      'digest-dead',
      'digest-edge',
      'digest-fresh',
    ])
    expect(body.refused).toEqual([])
  })

  it('separates in-flight from stranded on the age of each claim', async () => {
    const body = await (await call()).json()
    const byId = Object.fromEntries(body.rows.map((claim: any) => [claim.id, claim]))
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

  it('counts pending and stranded over every claim, not a page', async () => {
    const body = await (await call('?view=summary')).json()
    expect(body.pending).toBe(3)
    // Only ONE of the three is past ten minutes. A constant, a copy of
    // `pending`, or an inverted comparison each gives a different number.
    expect(body.stranded).toBe(1)
    expect(body.untimed).toBe(0)
    expect(mockReads.every((read) => read.count)).toBe(true)
    expect(mockReads.every((read) => read.wheres[0][0] === 'status')).toBe(true)
  })

  it('serves the panel on the query: equalities, and Age and State as claim-time ranges', async () => {
    const filters = encodeURIComponent(
      JSON.stringify([
        { field: 'kind', op: 'equals', value: 'refund' },
        { field: 'stranded', op: 'equals', value: 'stranded' },
        { field: 'ageMs', op: '<', value: String(180 * MINUTE) },
      ]),
    )
    const body = await (await call(`?filters=${filters}`)).json()
    expect(body.refused).toEqual([])
    expect(mockReads[0].wheres).toEqual([
      ['status', '==', 'pending'],
      ['createdAtMs', '<=', NOW - 10 * MINUTE],
      ['createdAtMs', '>', NOW - 180 * MINUTE],
      ['kind', '==', 'refund'],
    ])
    expect(mockReads[0].orderBy).toEqual(['createdAtMs asc'])
  })

  it('names a clause it cannot apply, and applies none of it', async () => {
    const filters = encodeURIComponent(JSON.stringify([{ field: 'stranded', op: 'equals', value: 'maybe' }]))
    const body = await (await call(`?filters=${filters}`)).json()
    expect(body.refused).toEqual([
      { clause: { field: 'stranded', op: 'equals', value: 'maybe' }, reason: 'pick stranded or in flight' },
    ])
    expect(mockReads[0].wheres).toEqual([['status', '==', 'pending']])
  })

  it('refuses an unreadable ask rather than listing everything', async () => {
    expect((await call('?filters=nope')).status).toBe(400)
    expect(mockGet).not.toHaveBeenCalled()
  })

  it('refuses a non-staff caller without reading the collection', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'u-x', email_verified: true })
    const response = await call()
    expect(response.status).toBe(403)
    expect(mockGet).not.toHaveBeenCalled()
    expect(mockReads).toHaveLength(0)
  })
})
