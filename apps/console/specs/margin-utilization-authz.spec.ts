/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored, the suite runs on jsdom, and `Request` is not a constructor.
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
 * `/api/admin/margin-utilization` SERVES OUR COST MODEL.
 *
 * Every row it returns carries `infraCogsUsd`-class figures: what an
 * organization costs us per meter, what it pays, and the margin between them.
 * The `staff` custom claim is the only thing between that and a browser, so
 * this suite pins the gate before it pins anything else — and pins that a
 * refusal reads nothing, because a refusal that has already swept the fleet
 * has spent the money the paging exists to save even if it published nothing.
 *
 * It also pins the PAGING, for the reason the walk is ordered on the document
 * id at all: an `orderBy` on a field would drop organizations that lack it,
 * and a margin surface silently missing rows is worse than one that is absent.
 */

const mockVerifyIdToken = jest.fn()
/** Every `orgs` query the handler actually ran, in order. */
let mockQueries: Array<{ orderBy?: string; limit?: number; startAfter?: string }>
/** `orgs` documents, by id, in id order. */
let mockOrgDocs: Array<{ id: string; data: Record<string, unknown> }>
let mockUsageByOrg: Record<string, Record<string, unknown>>
let mockAssistByOrg: Record<string, Record<string, unknown>>
/** Every document path read through `getAll`, so a refusal can be shown to read nothing. */
let mockFetched: string[]

const mockSnapshotOf = (path: string, fields: Record<string, unknown> | undefined) => ({
  id: path.split('/').pop() as string,
  exists: fields !== undefined,
  ref: { path },
  data: () => fields,
  get: (field: string) => fields?.[field],
})

function mockOrgRefFor(id: string) {
  const path = `orgs/${id}`
  return {
    id,
    path,
    collection: (name: string) => ({
      doc: (docId: string) => ({
        path: `${path}/${name}/${docId}`,
        get: async () => {
          mockFetched.push(`${path}/${name}/${docId}`)
          return mockSnapshotOf(`${path}/${name}/${docId}`, undefined)
        },
      }),
      orderBy: () => ({
        limit: () => ({
          get: async () => {
            mockFetched.push(`${path}/${name}:query`)
            const rollup = name === 'usage' ? mockUsageByOrg[id] : undefined
            return {
              docs: rollup
                ? [mockSnapshotOf(`${path}/usage/${rollup['month']}`, rollup)]
                : [],
            }
          },
        }),
      }),
    }),
  }
}

const mockOrgsCollection = {
  doc: (id: string) => ({
    ...mockOrgRefFor(id),
    get: async () => {
      mockFetched.push(`orgs/${id}`)
      const found = mockOrgDocs.find((doc) => doc.id === id)
      return mockSnapshotOf(`orgs/${id}`, found?.data)
    },
  }),
  orderBy: (field: unknown) => {
    const state: { orderBy?: string; limit?: number; startAfter?: string } = {
      orderBy: String(field),
    }
    mockQueries.push(state)
    const build = () => ({
      startAfter: (snapshot: { id: string }) => {
        state.startAfter = snapshot.id
        return build()
      },
      limit: (count: number) => {
        state.limit = count
        return {
          get: async () => {
            const from = state.startAfter
              ? mockOrgDocs.findIndex((doc) => doc.id === state.startAfter) + 1
              : 0
            const page = mockOrgDocs.slice(from, from + count)
            return {
              docs: page.map((doc) => ({
                ...mockSnapshotOf(`orgs/${doc.id}`, doc.data),
                ref: mockOrgRefFor(doc.id),
              })),
            }
          },
        }
      },
    })
    return build()
  },
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => ({
        collection: (name: string) =>
          name === 'orgs' ? mockOrgsCollection : { doc: () => ({}) },
        getAll: async (...refs: Array<{ path: string }>) =>
          refs.map((ref) => {
            mockFetched.push(ref.path)
            const [, orgId, sub, docId] = ref.path.split('/')
            const fields =
              sub === 'assistUsage' ? mockAssistByOrg[`${orgId}:${docId}`] : undefined
            return mockSnapshotOf(ref.path, fields)
          }),
      }),
    }),
    firestore: { FieldPath: { documentId: () => '__name__' } },
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
  ORG_BILLING_DOC_ID: 'stripe',
  ORG_BILLING_SUBCOLLECTION: 'billing',
  // THE REAL PROJECTION. A stub returning `{}` would starve the cost model and
  // every margin below would read 100% on no data — which is exactly the shape
  // of defect this surface exists to find in other people's code.
  orgCogsInputFrom: jest.requireActual('@aglyn/aglyn/app-utils/plan-entitlements')
    .orgCogsInputFrom,
  pluginRequestFromWeb: async (request: Request) => {
    const url = new URL(request.url)
    return {
      method: request.method,
      query: Object.fromEntries(url.searchParams.entries()),
      headers: { authorization: request.headers.get('authorization') ?? undefined },
    }
  },
}))

import { GET } from '../app/api/admin/margin-utilization/route'

const call = (options: { token?: string; after?: string } = {}) =>
  GET(
    new Request(
      `https://app.aglyn.com/api/admin/margin-utilization${
        options.after ? `?after=${options.after}` : ''
      }`,
      { headers: options.token ? { authorization: `Bearer ${options.token}` } : {} },
    ),
  )

const STAFF = { uid: 'staff-1', email_verified: true, staff: true }

/** A paying org, one site, at a known slice of its bands. */
const payingOrg = (id: string, plan = 'pro') => ({
  id,
  data: {
    name: `Org ${id}`,
    plan,
    subscription: { status: 'active', interval: 'month' },
    hosts: { 'site-1': true },
  },
})

beforeEach(() => {
  jest.clearAllMocks()
  mockQueries = []
  mockOrgDocs = []
  mockUsageByOrg = {}
  mockAssistByOrg = {}
  mockFetched = []
})

describe('the staff gate', () => {
  it('401s an unauthenticated caller', async () => {
    const response = await call()
    expect(response.status).toBe(401)
    // Not one document, and not one query. A refusal that swept first has
    // already spent what the paging exists to bound.
    expect(mockFetched).toEqual([])
    expect(mockQueries).toEqual([])
  })

  it('401s a token that cannot be verified', async () => {
    mockVerifyIdToken.mockRejectedValueOnce(new Error('bad token'))
    const response = await call({ token: 'nope' })
    expect(response.status).toBe(401)
    expect(mockFetched).toEqual([])
  })

  it('403s a verified NON-staff token — the claim is the only gate', async () => {
    mockVerifyIdToken.mockResolvedValueOnce({ uid: 'member-1', email_verified: true })
    mockOrgDocs = [payingOrg('org-1')]
    const response = await call({ token: 'tok' })
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'Staff only' })
    // Nothing was read on their behalf: no cost figure was computed, and the
    // refusal leaked no timing either.
    expect(mockFetched).toEqual([])
    expect(mockQueries).toEqual([])
  })

  it('403s a staff-claimed token whose email is unverified', async () => {
    mockVerifyIdToken.mockResolvedValueOnce({ uid: 'staff-1', staff: true })
    const response = await call({ token: 'tok' })
    expect(response.status).toBe(403)
    expect((await response.json()).reason).toBe('email-unverified')
  })

  it('POSITIVE CONTROL: a staff token IS served', async () => {
    // Without this the four refusals above are satisfied by a route that
    // refuses everyone, which would pass this whole describe having deleted
    // the surface.
    mockVerifyIdToken.mockResolvedValueOnce(STAFF)
    mockOrgDocs = [payingOrg('org-1')]
    const response = await call({ token: 'tok' })
    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.rows).toHaveLength(1)
    expect(payload.rows[0].orgId).toBe('org-1')
  })

  it('CONTROL: a falsy `staff` claim is not a staff claim', async () => {
    // `staff: false` and a missing claim must answer the same way. A gate
    // written as `'staff' in decoded` would admit the first.
    mockVerifyIdToken.mockResolvedValueOnce({
      uid: 'member-1',
      email_verified: true,
      staff: false,
    })
    expect((await call({ token: 'tok' })).status).toBe(403)
  })
})

describe('the paged walk', () => {
  beforeEach(() => {
    mockOrgDocs = Array.from({ length: 30 }, (_, index) =>
      payingOrg(`org-${String(index).padStart(2, '0')}`),
    )
  })

  it('orders on the DOCUMENT ID and probes one row past the page', () => {
    mockVerifyIdToken.mockResolvedValue(STAFF)
    return call({ token: 'tok' }).then(() => {
      // `orderBy` on a field would DROP organizations that lack it, which on a
      // surface whose job is finding one outlier is the worst failure
      // available. The extra row is the truncation probe.
      expect(mockQueries).toEqual([{ orderBy: '__name__', limit: 26 }])
    })
  })

  it('reports a cursor when more organizations exist, and null when not', async () => {
    mockVerifyIdToken.mockResolvedValue(STAFF)
    const first = await (await call({ token: 'tok' })).json()
    expect(first.rows).toHaveLength(25)
    // A FACT, not an estimate: the probe row came back, so a 26th org exists.
    expect(first.nextCursor).toBe('org-24')

    const second = await (await call({ token: 'tok', after: first.nextCursor })).json()
    expect(second.rows).toHaveLength(5)
    expect(second.nextCursor).toBeNull()
    // Together the two pages are the whole collection, with nothing repeated.
    const ids = [...first.rows, ...second.rows].map((row: any) => row.orgId)
    expect(new Set(ids).size).toBe(30)
  })

  it('CONTROL: a page that exactly fills the limit still reports no cursor', async () => {
    // The off-by-one a comparison against the cap gets wrong precisely when
    // the count is an even multiple of the page size.
    mockOrgDocs = mockOrgDocs.slice(0, 25)
    mockVerifyIdToken.mockResolvedValue(STAFF)
    const payload = await (await call({ token: 'tok' })).json()
    expect(payload.rows).toHaveLength(25)
    expect(payload.nextCursor).toBeNull()
  })

  it('answers an EMPTY collection with no rows and no cursor', async () => {
    mockOrgDocs = []
    mockVerifyIdToken.mockResolvedValue(STAFF)
    const payload = await (await call({ token: 'tok' })).json()
    expect(payload).toMatchObject({ rows: [], nextCursor: null, scanned: 0 })
  })

  it('reports the reads it billed', async () => {
    mockOrgDocs = mockOrgDocs.slice(0, 2)
    mockVerifyIdToken.mockResolvedValue(STAFF)
    mockUsageByOrg['org-00'] = { month: '2026-07', pageViews: 1000 }
    const payload = await (await call({ token: 'tok' })).json()
    // The cost of the page, on the page. Two orgs plus their billing mirrors,
    // one rollup found, one Assist lookup for it.
    expect(payload.reads).toBeGreaterThan(0)
    expect(payload.scanned).toBe(2)
  })
})

describe('what it serves', () => {
  it('prices the rollup and measures it against the org’s own bands', async () => {
    mockVerifyIdToken.mockResolvedValue(STAFF)
    mockOrgDocs = [payingOrg('org-1')]
    // Half of Pro's 10,000 contact band.
    mockUsageByOrg['org-1'] = { month: '2026-07', contactsCount: 5000 }
    const payload = await (await call({ token: 'tok' })).json()
    const row = payload.rows[0]
    expect(row.month).toBe('2026-07')
    expect(row.plan).toBe('pro')
    expect(row.bands.contactsCount.fraction).toBeCloseTo(0.5, 9)
    expect(row.marginPct).not.toBeNull()
  })

  it('forwards the meters that are recorded but NOT priced', async () => {
    /*
     * `orgCogsInputFrom` is the PRICED field list and correctly omits
     * `workflowRuns` and `actionRuns` — neither has a unit cost. A projection
     * built only from it would therefore drop two bands that ARE recorded and
     * ARE sold, and the surface would report every organization as consuming
     * none of them. That is this repo's most-repeated defect: a projection
     * that starves a model does not error, it just answers smaller.
     */
    mockVerifyIdToken.mockResolvedValue(STAFF)
    mockOrgDocs = [payingOrg('org-1', 'business')]
    mockUsageByOrg['org-1'] = {
      month: '2026-07',
      workflowRuns: 25_000,
      actionRuns: 5_000,
    }
    const payload = await (await call({ token: 'tok' })).json()
    const bands = payload.rows[0].bands
    // Business sells 50,000 of each.
    expect(bands.workflowRuns.used).toBe(25_000)
    expect(bands.workflowRuns.fraction).toBeCloseTo(0.5, 9)
    expect(bands.actionRuns.used).toBe(5_000)
    expect(bands.actionRuns.fraction).toBeCloseTo(0.1, 9)
  })

  it('CONTROL: an absent meter reads as zero used, not as a missing band', async () => {
    // The other arm, so the assertion above is about forwarding rather than
    // about the fixture. A rollup written before these meters existed has no
    // such field, and the band still has to render.
    mockVerifyIdToken.mockResolvedValue(STAFF)
    mockOrgDocs = [payingOrg('org-1', 'business')]
    mockUsageByOrg['org-1'] = { month: '2026-07' }
    const payload = await (await call({ token: 'tok' })).json()
    expect(payload.rows[0].bands.workflowRuns.state).toBe('measured')
    expect(payload.rows[0].bands.workflowRuns.used).toBe(0)
  })

  it('reports an org with NO rollup as unmeasured, not as idle', async () => {
    mockVerifyIdToken.mockResolvedValue(STAFF)
    mockOrgDocs = [payingOrg('org-1')]
    const payload = await (await call({ token: 'tok' })).json()
    // `month: null` is what says the cron has never covered this org. Its
    // bands carry zeros because nothing was recorded, and the fleet fold reads
    // that field rather than the zeros.
    expect(payload.rows[0].month).toBeNull()
  })

  it('serializes an UNCAPPED band without turning it into a number', async () => {
    // `JSON.stringify(Infinity)` is `null`, so an uncapped band's `included`
    // crosses the wire as null and `Number(null)` is 0 — which is how an
    // unbounded band becomes a band of zero. The STATE is what the client
    // reads, and it survives the round trip intact.
    mockVerifyIdToken.mockResolvedValue(STAFF)
    mockOrgDocs = [
      {
        id: 'ent-1',
        data: {
          name: 'Enterprise',
          plan: 'enterprise',
          subscription: { status: 'active', interval: 'month' },
          hosts: { 'site-1': true },
        },
      },
    ]
    mockUsageByOrg['ent-1'] = { month: '2026-07', contactsCount: 900000 }
    const payload = await (await call({ token: 'tok' })).json()
    const contacts = payload.rows[0].bands.contactsCount
    expect(contacts.state).toBe('uncapped')
    expect(contacts.fraction).toBeNull()
    expect(contacts.used).toBe(900000)
    // The trap, demonstrated rather than asserted away.
    expect(JSON.parse(JSON.stringify({ x: Number.POSITIVE_INFINITY })).x).toBeNull()
  })
})
