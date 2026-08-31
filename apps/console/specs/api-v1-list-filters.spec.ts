/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and this runs on jsdom, where the route's Response
 * helpers are unavailable.
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
 * The `/v1` list filters a sync loop needs (AGL-2460).
 *
 * Three lists could be READ and not SEARCHED, which made the first operation
 * of every real integration — "do I already have this?" — a full sweep of the
 * collection. Every page of that sweep is a billed request against a 120/min
 * key ceiling, so the cost fell on the customer twice.
 *
 * The assertions that carry weight here are the ones about HOW the query is
 * issued, not merely what comes back:
 *
 *  - `?email=` must go through the WRITER's normalizer, or `GET` and `POST`
 *    disagree about whether a person exists;
 *  - `?form=` combined with `?read=` must issue ONE Firestore clause, because
 *    two equalities plus this API's `orderBy(__name__)` is a composite index
 *    nobody has shipped — a green that ignores the clause count would pass
 *    here and 500 in production the first time a customer combined them.
 *
 * So the double records the filters it was handed, and the tests read them.
 */

interface IssuedFilter {
  field: string
  op: string
  value: unknown
}

const mockDocs = new Map<string, Record<string, unknown>>()
/** Every `where()` the code under test issued, most recent query last. */
let issued: IssuedFilter[][] = []

let mockScopes: string[] = [
  'contacts:read',
  'forms:read',
  'orders:read',
]

const tick = () => Promise.resolve()

/**
 * Firestore operator semantics, modelled rather than assumed.
 *
 * The sibling suites' double ignores the operator and compares with `===`,
 * which is fine while every filter is an equality and actively harmful now:
 * `tags array-contains 'vip'` against `['vip','beta']` is `false` under
 * `===`, so a faithful implementation of the tag filter would have failed and
 * a broken one that compared whole arrays would have passed. `matches` is the
 * only place operator behaviour is defined, and the first test below is the
 * test that it is defined correctly.
 */
function matches(stored: unknown, op: string, value: unknown): boolean {
  if (op === 'array-contains') {
    return Array.isArray(stored) && stored.includes(value)
  }
  if (op === '==') return stored === value
  throw new Error(`unmodelled Firestore operator: ${op}`)
}

function childPaths(collectionPath: string): string[] {
  const prefix = `${collectionPath}/`
  return [...mockDocs.keys()].filter(
    (key) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'),
  )
}

function snapshotOf(docPath: string) {
  return {
    id: docPath.slice(docPath.lastIndexOf('/') + 1),
    exists: true,
    data: () => mockDocs.get(docPath),
    get: (field: string) => mockDocs.get(docPath)?.[field],
  }
}

function mockCollectionRef(path: string) {
  const run = async (filters: IssuedFilter[], n: number) => {
    await tick()
    issued.push(filters)
    const docs = childPaths(path)
      .sort()
      .filter((docPath) =>
        filters.every(({ field, op, value }) =>
          matches(mockDocs.get(docPath)?.[field], op, value),
        ),
      )
      .slice(0, n)
      .map(snapshotOf)
    return { docs }
  }
  const query = (filters: IssuedFilter[]) => ({
    where: (field: string, op: string, value: unknown) =>
      query([...filters, { field, op, value }]),
    orderBy: () => query(filters),
    limit: (n: number) => ({
      startAfter: () => ({ get: async () => run(filters, n) }),
      get: async () => run(filters, n),
    }),
  })
  return {
    path,
    doc: (id: string) => ({
      path: `${path}/${id}`,
      id,
      collection: (name: string) => mockCollectionRef(`${path}/${id}/${name}`),
      get: async () => {
        await tick()
        const docPath = `${path}/${id}`
        return {
          id,
          exists: mockDocs.has(docPath),
          data: () => mockDocs.get(docPath),
          get: (field: string) => mockDocs.get(docPath)?.[field],
        }
      },
      set: async () => {
        await tick()
      },
    }),
    ...query([]),
  }
}

const mockFirestore = { collection: (name: string) => mockCollectionRef(name) }

jest.mock('@aglyn/tenant-data-admin', () => {
  // Spread the REAL http helpers: `apiJson`, `ApiErrors`, `listResponse`,
  // `parseLimit`, `encodeCursor`/`decodeCursor`. A factory is a CLOSED
  // WORLD, and stubbing these would test a fake envelope rather than the
  // documented one.
  const apiHttp = jest.requireActual(
    '../../../libs/tenant/data/admin/src/lib/server/api-http',
  )
  return {
    __esModule: true,
    ...apiHttp,
    verifyApiKey: async () => ({
      orgId: 'org-1',
      keyId: 'key-1',
      scopes: mockScopes,
    }),
    getOrgDoc: async () => ({ plan: 'business', hosts: { 'host-1': true } }),
    lockdownRefusal: async () => null,
    consumeRateLimit: async () => ({
      allowed: true,
      limit: 120,
      remaining: 119,
      resetMs: Date.now() + 60_000,
      degraded: false,
    }),
    firebaseAdmin: {
      app: () => ({ firestore: () => mockFirestore }),
      firestore: {
        FieldValue: {
          increment: (n: number) => n,
          serverTimestamp: () => 'NOW',
        },
      },
    },
  }
})

jest.mock('@aglyn/aglyn/server', () => {
  const entitlements = jest.requireActual(
    '../../../libs/aglyn/src/lib/app-utils/plan-entitlements',
  )
  return {
    __esModule: true,
    ...jest.requireActual(
      '../../../libs/aglyn/src/lib/app-utils/marketing-consent',
    ),
    ...jest.requireActual(
      '../../../libs/aglyn/src/lib/app-utils/consent-groups',
    ),
    ...jest.requireActual(
      '../../../libs/aglyn/src/lib/app-utils/api-idempotency',
    ),
    // The REAL normalizer. This is the whole point of the `?email=` test —
    // stubbing it would assert that the handler calls SOMETHING, which is the
    // one thing never in doubt, while the property under test is that it
    // calls the same function `createContact` writes through.
    normalizeContactEmail: jest.requireActual(
      '../../../libs/aglyn/src/lib/app-utils/contacts',
    ).normalizeContactEmail,
    // Real, for the reason api-v1-form-submissions.spec.ts records: the
    // authenticator enforces `checkApiRequestQuota(...).allowed` at the
    // chokepoint, and omitting these from the factory turns every request in
    // the suite into a 500 that looks like a route bug.
    apiRequestEnforcementShape: entitlements.apiRequestEnforcementShape,
    checkApiRequestQuota: entitlements.checkApiRequestQuota,
    checkEntitlement: () => true,
    effectiveDatasetModel: () => ({ fields: [] }),
    coerceDocumentValues: (_m: unknown, v: Record<string, unknown>) => v,
    validateDocument: () => ({}),
    createResourceUid: () => 'unused',
    checkContactQuota: () => ({ allowed: true, included: 1000 }),
    checkDatasetQuota: () => ({ allowed: true, limit: 100 }),
    defaultScopeForNewResource: () => ['org'],
    newResourceScopeFields: (tokens: string[]) => ({ visibleTo: tokens }),
    ORG_SCOPE_TOKEN: 'org',
  }
})

jest.mock('firebase-admin/firestore', () => {
  class MockTimestamp {
    ms: number
    constructor(ms: number) {
      this.ms = ms
    }
    static now() {
      return new MockTimestamp(1_760_000_000_000)
    }
    toDate() {
      return new Date(this.ms)
    }
  }
  return {
    __esModule: true,
    FieldPath: { documentId: () => '__name__' },
    Timestamp: MockTimestamp,
  }
})

import { GET } from '../app/api/v1/[[...route]]/route'

const CONTACTS = 'orgs/org-1/contacts'
const SUBMISSIONS = 'hosts/host-1/formSubmissions'
const ORDERS = 'hosts/host-1/orders'

const AUTH = {
  authorization: 'Bearer aglyn_sk_test',
  'content-type': 'application/json',
}

function get(path: string, route: string[]) {
  return GET(new Request(`https://app.aglyn.com/api/v1${path}`, { headers: AUTH }), {
    params: Promise.resolve({ route }),
  })
}

const listContacts = (query = '') =>
  get(`/contacts${query}`, ['contacts'])
const listSubmissions = (query = '') =>
  get(`/sites/host-1/form-submissions${query}`, [
    'sites',
    'host-1',
    'form-submissions',
  ])
const listOrders = (query = '') =>
  get(`/sites/host-1/orders${query}`, ['sites', 'host-1', 'orders'])

/** The filters the LAST issued query carried. */
const lastFilters = (): IssuedFilter[] => issued[issued.length - 1] ?? []

beforeEach(() => {
  mockDocs.clear()
  issued = []
  mockScopes = ['contacts:read', 'forms:read', 'orders:read']

  mockDocs.set(`${CONTACTS}/c1`, {
    email: 'avery@example.com',
    name: 'Avery',
    tags: ['vip', 'beta'],
  })
  mockDocs.set(`${CONTACTS}/c2`, {
    email: 'blake@example.com',
    name: 'Blake',
    tags: ['beta'],
  })
  mockDocs.set(`${CONTACTS}/c3`, {
    email: 'casey@example.com',
    name: 'Casey',
    tags: [],
  })

  // s1 and s2 are the same FORM under two captions — the rename this entity
  // exists to survive. Under `?form=` they are two different lists.
  mockDocs.set(`${SUBMISSIONS}/s1`, {
    formId: 'form-contact',
    formName: 'contact',
    fields: { email: 'a@example.com' },
    read: false,
  })
  mockDocs.set(`${SUBMISSIONS}/s2`, {
    formId: 'form-contact',
    formName: 'Talk to us',
    fields: { email: 'b@example.com' },
    read: true,
  })
  mockDocs.set(`${SUBMISSIONS}/s3`, {
    formName: 'newsletter',
    fields: { email: 'c@example.com' },
    read: false,
  })
})

async function body(response: Response) {
  return (await response.json()) as {
    data?: Array<Record<string, unknown>>
    has_more?: boolean
    error?: { type: string; code?: string; fields?: Record<string, string> }
  }
}

// ── The double itself ───────────────────────────────────────────────────────

describe('the Firestore double models the operators it is asked about', () => {
  // Anti-vacuity. Every filter assertion below is only as good as `matches`,
  // and the failure this guards is silent: a double that compared with `===`
  // throughout would report the tag filter broken when it works, and would
  // report a whole-array comparison working when it is broken.
  it('models Firestore operator semantics', () => {
    expect(matches(['vip', 'beta'], 'array-contains', 'vip')).toBe(true)
    expect(matches(['vip', 'beta'], 'array-contains', 'gold')).toBe(false)
    // The distinction the sibling suites' `===`-only double cannot make.
    expect(matches(['vip'], '==', 'vip')).toBe(false)
    expect(matches('vip', '==', 'vip')).toBe(true)
    expect(matches(false, '==', false)).toBe(true)
    expect(matches(undefined, '==', false)).toBe(false)
    expect(() => matches('x', 'in', ['x'])).toThrow(/unmodelled/)
  })
})

// ── Contacts ────────────────────────────────────────────────────────────────

describe('GET /v1/contacts filters', () => {
  it('still returns the whole audience when nothing is filtered', async () => {
    const response = await listContacts()
    expect(response.status).toBe(200)
    expect((await body(response)).data?.map((c) => c.id)).toEqual([
      'c1',
      'c2',
      'c3',
    ])
    expect(lastFilters()).toEqual([])
  })

  it('finds a contact by email with an indexed equality, not a sweep', async () => {
    const response = await listContacts('?email=blake@example.com')
    expect(response.status).toBe(200)
    expect((await body(response)).data?.map((c) => c.id)).toEqual(['c2'])
    // The point of the feature: ONE clause, handed to Firestore, so the
    // customer pays for one page instead of the whole band.
    expect(lastFilters()).toEqual([
      { field: 'email', op: '==', value: 'blake@example.com' },
    ])
  })

  it('normalizes the query exactly as the writer normalizes the stored value', async () => {
    // The red direction: drop `normalizeContactEmail` from `listContacts` and
    // this returns nothing, while `POST /v1/contacts` with the same string
    // answers `409 contact_exists`. Two endpoints, one address, opposite
    // answers.
    const response = await listContacts('?email=%20Avery%40Example.COM%20')
    expect((await body(response)).data?.map((c) => c.id)).toEqual(['c1'])
    expect(lastFilters()).toEqual([
      { field: 'email', op: '==', value: 'avery@example.com' },
    ])
  })

  it('refuses an unusable email rather than answering an empty page', async () => {
    const response = await listContacts('?email=not-an-email')
    expect(response.status).toBe(400)
    const payload = await body(response)
    expect(payload.error?.type).toBe('bad_request')
    expect(payload.error?.code).toBe('validation_failed')
    expect(payload.error?.fields).toEqual({
      email: 'Must be a valid email address',
    })
    // No query was issued at all — a 400 must not cost a Firestore read.
    expect(issued).toEqual([])
  })

  it('treats an empty email param as no filter, not as an invalid one', async () => {
    const response = await listContacts('?email=')
    expect(response.status).toBe(200)
    expect((await body(response)).data).toHaveLength(3)
    expect(lastFilters()).toEqual([])
  })

  it('segments by tag with array-contains', async () => {
    const response = await listContacts('?tag=vip')
    expect((await body(response)).data?.map((c) => c.id)).toEqual(['c1'])
    expect(lastFilters()).toEqual([
      { field: 'tags', op: 'array-contains', value: 'vip' },
    ])

    const beta = await listContacts('?tag=beta')
    expect((await body(beta)).data?.map((c) => c.id)).toEqual(['c1', 'c2'])
  })

  it('combines email and tag without asking Firestore for a composite index', async () => {
    const hit = await listContacts('?email=avery@example.com&tag=vip')
    expect((await body(hit)).data?.map((c) => c.id)).toEqual(['c1'])
    // ONE clause. Two would need an index that does not exist, and the
    // symptom in production is a 500, not a wrong answer.
    expect(lastFilters()).toEqual([
      { field: 'email', op: '==', value: 'avery@example.com' },
    ])

    const miss = await listContacts('?email=avery@example.com&tag=gold')
    const payload = await body(miss)
    expect(payload.data).toEqual([])
    expect(lastFilters()).toEqual([
      { field: 'email', op: '==', value: 'avery@example.com' },
    ])
  })

  it('does not let a filter walk past the scope check', async () => {
    mockScopes = ['forms:read']
    const response = await listContacts('?email=avery@example.com')
    expect(response.status).toBe(403)
    expect((await body(response)).error?.type).toBe('insufficient_scope')
    expect(issued).toEqual([])
  })
})

// ── Form submissions ────────────────────────────────────────────────────────

describe('GET /v1/sites/{siteId}/form-submissions?read=', () => {
  it('returns only the unread queue, filtered in Firestore', async () => {
    const response = await listSubmissions('?read=false')
    expect((await body(response)).data?.map((s) => s.id)).toEqual(['s1', 's3'])
    expect(lastFilters()).toEqual([
      { field: 'read', op: '==', value: false },
    ])
  })

  it('returns only what has been actioned', async () => {
    const response = await listSubmissions('?read=true')
    expect((await body(response)).data?.map((s) => s.id)).toEqual(['s2'])
    expect(lastFilters()).toEqual([{ field: 'read', op: '==', value: true }])
  })

  it('refuses a read value that is neither true nor false', async () => {
    const response = await listSubmissions('?read=1')
    expect(response.status).toBe(400)
    const payload = await body(response)
    expect(payload.error?.code).toBe('validation_failed')
    expect(payload.error?.fields).toEqual({ read: 'Must be true or false' })
    expect(issued).toEqual([])
  })

  it('treats an empty read param as no filter, exactly as contacts do', async () => {
    // One rule across every filter (`conventions.md` → Filters). A client
    // serializing an unset field sends `?read=`, and refusing that here while
    // `?email=` accepts it is an inconsistency found one filter at a time.
    const response = await listSubmissions('?read=')
    expect(response.status).toBe(200)
    expect((await body(response)).data?.map((s) => s.id)).toEqual([
      's1',
      's2',
      's3',
    ])
    expect(lastFilters()).toEqual([])
  })

  it('leaves the pre-existing form filter exactly as it was', async () => {
    const response = await listSubmissions('?form=newsletter')
    expect((await body(response)).data?.map((s) => s.id)).toEqual(['s3'])
    expect(lastFilters()).toEqual([
      { field: 'formName', op: '==', value: 'newsletter' },
    ])
  })

  it('filters by form id, across a rename', async () => {
    // The point of the id. `s1` and `s2` were sent to ONE form whose caption
    // changed between them; `?form=` returns one row, `?formId=` returns both.
    const response = await listSubmissions('?formId=form-contact')
    expect((await body(response)).data?.map((s) => s.id)).toEqual(['s1', 's2'])
    expect(lastFilters()).toEqual([
      { field: 'formId', op: '==', value: 'form-contact' },
    ])
    const legacy = await listSubmissions('?form=contact')
    expect((await body(legacy)).data?.map((s) => s.id)).toEqual(['s1'])
  })

  it('publishes the form id and the routing on every row', async () => {
    const response = await listSubmissions('?formId=form-contact')
    expect((await body(response)).data?.[0]).toMatchObject({
      form_id: 'form-contact',
      routing: null,
    })
  })

  it('narrows on one clause when the id filter joins read', async () => {
    // Same composite-index property as `?form=` below: one Firestore clause,
    // `read` applied to the page. `formId` + `read` + `orderBy(__name__)` is
    // a three-clause query nobody has shipped an index for.
    const response = await listSubmissions('?formId=form-contact&read=false')
    expect((await body(response)).data?.map((s) => s.id)).toEqual(['s1'])
    expect(lastFilters()).toEqual([
      { field: 'formId', op: '==', value: 'form-contact' },
    ])
  })

  it('narrows on one clause when both filters are given', async () => {
    const response = await listSubmissions('?form=contact&read=false')
    expect((await body(response)).data?.map((s) => s.id)).toEqual(['s1'])
    // The property that keeps this off a composite index: `formName` is the
    // only clause Firestore sees, and `read` is applied to the page. A
    // regression that pushed both into the query would answer correctly here
    // and 500 against real Firestore.
    expect(lastFilters()).toEqual([
      { field: 'formName', op: '==', value: 'contact' },
    ])
  })
})

// ── Orders ──────────────────────────────────────────────────────────────────

describe('the order object publishes its shipments', () => {
  it('publishes carrier, tracking and an ISO timestamp', async () => {
    mockDocs.set(`${ORDERS}/o1`, {
      status: 'fulfilled',
      totals: { totalCents: 2500 },
      fulfillments: [
        {
          id: 'f1',
          lineItemIds: [0, 1],
          carrier: 'USPS',
          trackingNumber: '9400111899',
          atMs: 1_760_000_000_000,
        },
      ],
    })
    const response = await listOrders()
    const [order] = (await body(response)).data ?? []
    expect(order.fulfillments).toEqual([
      {
        id: 'f1',
        lineItemIds: [0, 1],
        carrier: 'USPS',
        trackingNumber: '9400111899',
        trackingUrl: null,
        // ISO, like `created` — never the raw millisecond number.
        at: new Date(1_760_000_000_000).toISOString(),
      },
    ])
  })

  it('publishes an empty array, never undefined, for an unshipped order', async () => {
    mockDocs.set(`${ORDERS}/o2`, { status: 'paid', totals: { totalCents: 100 } })
    const response = await listOrders()
    const [order] = (await body(response)).data ?? []
    // `undefined` would vanish from the JSON entirely, and a client written
    // against `order.fulfillments.length` would throw on every paid order.
    expect(order.fulfillments).toEqual([])
  })

  it('answers null rather than "Invalid Date" for an unusable timestamp', async () => {
    mockDocs.set(`${ORDERS}/o3`, {
      status: 'fulfilled',
      totals: { totalCents: 100 },
      fulfillments: [{ id: 'f9', atMs: 'whenever' }],
    })
    const response = await listOrders()
    const [order] = (await body(response)).data ?? []
    expect((order.fulfillments as Array<Record<string, unknown>>)[0].at).toBeNull()
  })
})
