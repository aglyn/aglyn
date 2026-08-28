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
 * The two client-direct document classes a free plan could mint without limit
 * are bounded (AGL-2266).
 *
 * The RULES half of this fix — `actions` joining the catch-all's create
 * exclusion, and the entries block's create becoming staff-only — is asserted
 * in `host-subcollection-write-deny-coverage.spec.ts`, which already owns the
 * parser for that file. This suite is the ROUTE half: the caps those denials
 * hand to `/api/hosts/resources`.
 *
 * `cloud/firebase-firestore.rules` excludes 23 host subcollections from the
 * catch-all's `allow create`, so every quota-governed collection is
 * server-only. Two writable classes were left, and neither had a cap on any
 * plan:
 *
 *  - **`hosts/{hostId}/actions`** — named in NO exclusion list, so the
 *    catch-all granted it by default. The import route's own table already
 *    said so: *"no `RESOURCES` entry and no quota key anywhere; all three
 *    creators write the document client-direct."*
 *  - **`hosts/{hostId}/collections/{cid}/entries/{eid}`** — a DEDICATED block
 *    re-granted create to any editor, deliberately, because the catch-all's
 *    name-based exclusions must not reach entries.
 *
 * Not a bypass of anything we sell — there is no entries or actions dimension
 * on any plan — but uncapped Firestore documents and write volume behind a $0
 * subscription, which is the shape `WEBHOOK_MAX_PER_HOST` (AGL-1360) and
 * `NON_PAGE_SCREEN_MAX_PER_HOST` (AGL-1399) were both invented for: a platform
 * cap, not a plan dimension.
 *
 * ## Why the collections cap is in the same suite
 *
 * `ENTRIES_MAX_PER_COLLECTION` is per COLLECTION, because that is the read a
 * create can afford. Behind an unbounded supply of collections that bounds
 * nothing at all, so `COLLECTIONS_MAX_PER_HOST` landed with it and the two are
 * asserted together. A test file that checked one and not the other would be
 * describing a ceiling that does not exist.
 *
 * ## Both halves
 *
 * Every cap here pins the pair — the last permitted create SUCCEEDS and the
 * next is refused — because a cap suite that only asserts the refusal also
 * passes against a route that refuses everything.
 */

const mockVerifyIdToken = jest.fn()

type Doc = Record<string, unknown>

let mockOrg: Doc
let mockMemberRoles: Record<string, string>

/** An in-memory Firestore keyed by collection PATH. */
const store = new Map<string, Map<string, Doc>>()

const seed = (collectionPath: string, id: string, data: Doc) => {
  if (!store.has(collectionPath)) store.set(collectionPath, new Map())
  store.get(collectionPath).set(id, data)
}

const docsAt = (path: string) => [...(store.get(path) ?? new Map()).entries()]

const snapshotOf = (path: string, id: string, data: Doc | undefined) => ({
  id,
  exists: data !== undefined,
  data: () => data,
  get: (field: string) => (data ?? {})[field],
})

/**
 * `where(field, '==', value)` FILTERS, and that is not a nicety.
 *
 * /api/hosts/collections claims a slug with
 * `where('slug', '==', slug).limit(10)` inside the same transaction that
 * counts. A double whose `where` returned every row would report a clash on
 * every create and answer 409 to a suite that is asking about a CAP — a false
 * red that reads exactly like the cap misfiring. An unfaithful fake fabricates
 * false greens and false reds alike.
 */
function mockCollectionRef(
  path: string,
  filters: Array<[string, unknown]> = [],
): any {
  const matching = () =>
    docsAt(path).filter(([, data]) =>
      filters.every(([field, value]) => data[field] === value),
    )
  const ref: any = {
    path,
    where: (field: string, operator: string, value: unknown) => {
      if (operator !== '==') {
        throw new Error(`Unmodelled query operator '${operator}'`)
      }
      return mockCollectionRef(path, [...filters, [field, value]])
    },
    limit: () => ref,
    select: () => ref,
    count: () => ({
      get: async () => ({ data: () => ({ count: matching().length }) }),
    }),
    get: async () => ({
      docs: matching().map(([id, data]) => snapshotOf(path, id, data)),
    }),
    doc: (id: string) => mockDocRef(path, id),
  }
  return ref
}

function mockDocRef(collectionPath: string, id: string): any {
  return {
    id,
    path: `${collectionPath}/${id}`,
    get: async () =>
      snapshotOf(collectionPath, id, (store.get(collectionPath) ?? new Map()).get(id)),
    collection: (name: string) =>
      mockCollectionRef(`${collectionPath}/${id}/${name}`),
  }
}

/**
 * Reads before writes, and writes deferred to a successful commit — the two
 * semantics a cap depends on. A body that returns a refusal after buffering a
 * create must persist nothing, or a "refused" test would pass while the
 * document landed.
 */
const mockRunTransaction = async (body: (tx: any) => Promise<any>) => {
  const buffered: Array<() => void> = []
  const result = await body({
    get: (query: any) => {
      if (buffered.length) {
        throw new Error('Firestore transactions cannot read after a write')
      }
      return query.get()
    },
    create: (ref: any, data: Doc) => {
      const lastSlash = ref.path.lastIndexOf('/')
      buffered.push(() => seed(ref.path.slice(0, lastSlash), ref.id, data))
    },
    set: (ref: any, data: Doc) => {
      const lastSlash = ref.path.lastIndexOf('/')
      buffered.push(() => seed(ref.path.slice(0, lastSlash), ref.id, data))
    },
  })
  for (const write of buffered) write()
  return result
}

jest.mock('next/server', () => ({
  after: (work: () => unknown) => work(),
}))

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  Timestamp: { now: () => ({ seconds: 0 }) },
  FieldValue: { delete: () => '__field_deleted__' },
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => ({
        runTransaction: (body: (tx: any) => Promise<any>) =>
          mockRunTransaction(body),
        collection: (name: string) => mockCollectionRef(name),
      }),
    }),
    firestore: { FieldValue: { delete: () => '__deleted__' } },
  },
  getOrgForHost: async () => ({ orgId: 'org-1', org: mockOrg }),
  // The route writes the site's own audit entry for a create (AGL-118). The
  // real one swallows its own failures and resolves with nothing, and the
  // route does not branch on it, so a no-op IS the contract rather than a
  // convenience. Named explicitly because this factory is a closed world: an
  // absent export is `undefined`, the route throws on the success path, and
  // the resulting 500 reads exactly like the cap under test regressing.
  logHostActivity: async () => undefined,
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
  getLockdownVerdict: async () => null,
  lockdownJsonResponse: (verdict: Doc) =>
    Response.json({ error: 'locked', ...verdict }, { status: 423 }),
}))

let uidCounter = 0

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  // The REAL plan table, the REAL cap constants, the REAL role gate. Stubbing
  // any of them would let this suite pass against a route enforcing nothing,
  // which IS the defect. A closed-world factory here is also how a route
  // throws and every assertion reads a 500 as a regression, so the actuals are
  // spread rather than enumerated.
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/plan-entitlements'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/actions'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/collection-entries'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/collection-kind'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/screen-route'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/organizations'),
  createResourceUid: () => `generated-${(uidCounter += 1)}`,
  nameSearchKey: (value: string) => value.toLowerCase(),
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    query: {},
    body: await request.json().catch(() => ({})),
    headers: {
      authorization: request.headers.get('authorization') ?? undefined,
    },
  }),
}))

import {
  ACTIONS_MAX_PER_HOST,
  COLLECTIONS_MAX_PER_HOST,
  ENTRIES_MAX_PER_COLLECTION,
} from '@aglyn/aglyn/server'
import { POST as RESOURCES_POST } from '../app/api/hosts/resources/route'
import { POST as COLLECTIONS_POST } from '../app/api/hosts/collections/route'

const post = async (body: Doc) => {
  const response = await RESOURCES_POST(
    new Request('https://app.aglyn.com/api/hosts/resources', {
      method: 'POST',
      headers: { authorization: 'Bearer tok' },
      body: JSON.stringify(body),
    }),
  )
  return { status: response.status, body: await response.json() }
}

const createAction = (data: Doc = { name: 'Hover panel' }) =>
  post({ hostId: 'host-1', resource: 'action', data })

const createEntry = (data: Doc = { title: 'Post' }, parentId = 'blog') =>
  post({ hostId: 'host-1', resource: 'entry', parentId, data })

beforeEach(() => {
  jest.clearAllMocks()
  uidCounter = 0
  store.clear()
  mockOrg = { plan: 'free' }
  mockMemberRoles = { 'user-1': 'editor' }
  mockVerifyIdToken.mockResolvedValue({ uid: 'user-1', email_verified: true })
  seed('hosts', 'host-1', { memberRoles: mockMemberRoles, orgId: 'org-1' })
  seed('hosts/host-1/collections', 'blog', { slug: 'blog', kind: 'content' })
})

describe('actions are bounded per host (AGL-2266)', () => {
  const fill = (count: number, extra: Doc = {}) => {
    for (let index = 0; index < count; index += 1) {
      seed('hosts/host-1/actions', `held-${index}`, {
        name: `held ${index}`,
        ...extra,
      })
    }
  }

  /**
   * FORCED RED: drop `maxPerHost` from the `action` entry in `RESOURCES` and
   * this passes with a 200, which is the state the issue describes.
   */
  it('refuses the create that would exceed the cap', async () => {
    fill(ACTIONS_MAX_PER_HOST)
    const result = await createAction()
    expect(result.status).toBe(403)
    expect(String(result.body.error)).toContain(String(ACTIONS_MAX_PER_HOST))
    expect(docsAt('hosts/host-1/actions')).toHaveLength(ACTIONS_MAX_PER_HOST)
  })

  /** The other half: the LAST permitted create still lands. */
  it('lands the last create that fits', async () => {
    fill(ACTIONS_MAX_PER_HOST - 1)
    const result = await createAction()
    expect(result.status).toBe(200)
    expect(docsAt('hosts/host-1/actions')).toHaveLength(ACTIONS_MAX_PER_HOST)
  })

  /**
   * A soft delete FREES a slot, which is what makes leaving client `update`
   * open safe rather than merely convenient — both console surfaces retire an
   * action by stamping `deletedAt`.
   *
   * FORCED RED: drop `softDeletes: true` from the `action` entry and a host
   * that has retired every one of its actions can never author another.
   */
  it('counts live rows only, so retiring one frees its slot', async () => {
    fill(ACTIONS_MAX_PER_HOST, { deletedAt: { seconds: 1 } })
    const result = await createAction()
    expect(result.status).toBe(200)
  })

  /**
   * The cap is a PLATFORM bound, so it does not vary by plan and it is not the
   * paid `actions` entitlement. A free org authors element interactions —
   * `interactions` is true on every plan — and gating the create on the Pro
   * flag would have been a pricing change wearing a cap's clothes.
   *
   * FORCED RED: add `entitlement: 'actions'` to the `action` entry and this
   * fails with a 403 naming the plan.
   */
  it('lets a free plan create one, and holds the same number on Pro', async () => {
    expect((await createAction()).status).toBe(200)
    mockOrg = { plan: 'pro' }
    fill(ACTIONS_MAX_PER_HOST)
    expect((await createAction()).status).toBe(403)
  })
})

describe('entries are bounded per collection (AGL-2266)', () => {
  const fill = (count: number) => {
    for (let index = 0; index < count; index += 1) {
      seed('hosts/host-1/collections/blog/entries', `held-${index}`, {
        title: `held ${index}`,
      })
    }
  }

  /**
   * FORCED RED: drop `maxPerHost` from the `entry` entry in `RESOURCES` and
   * the create lands — an unbounded store behind a bounded route.
   */
  it('refuses the create that would exceed the cap', async () => {
    fill(ENTRIES_MAX_PER_COLLECTION)
    const result = await createEntry()
    expect(result.status).toBe(403)
    expect(docsAt('hosts/host-1/collections/blog/entries')).toHaveLength(
      ENTRIES_MAX_PER_COLLECTION,
    )
  })

  it('lands the last create that fits', async () => {
    fill(ENTRIES_MAX_PER_COLLECTION - 1)
    expect((await createEntry()).status).toBe(200)
    expect(docsAt('hosts/host-1/collections/blog/entries')).toHaveLength(
      ENTRIES_MAX_PER_COLLECTION,
    )
  })

  /**
   * The cap counts the collection the create is ADDRESSED to. A nested
   * resource whose count read the wrong reference is a cap that never says no,
   * which is why `parentCollection` is declared rather than special-cased.
   *
   * FORCED RED: make the count read `hostRef.collection('entries')` and this
   * passes — the sibling's 10,000 rows would be invisible.
   */
  it('counts the addressed collection, not a sibling', async () => {
    seed('hosts/host-1/collections', 'news', { slug: 'news', kind: 'content' })
    fill(ENTRIES_MAX_PER_COLLECTION)
    const result = await createEntry({ title: 'First' }, 'news')
    expect(result.status).toBe(200)
    expect(docsAt('hosts/host-1/collections/news/entries')).toHaveLength(1)
  })

  /** A create under a parent that does not exist is an orphan, not a draft. */
  it('refuses a missing or unknown parent', async () => {
    expect(
      (
        await post({ hostId: 'host-1', resource: 'entry', data: { title: 'x' } })
      ).status,
    ).toBe(400)
    expect((await createEntry({ title: 'x' }, 'nope')).status).toBe(404)
  })

  /**
   * The draft condition the rules used to carry has MOVED, not been dropped:
   * `status` is off the field allow-list and `'draft'` is stamped, so a create
   * arriving as `published` is not refused — it is inexpressible.
   *
   * FORCED RED: add `'status'` to the `entry` field list and the client's
   * `published` survives, which is the publish-wearing-a-create's-clothes case
   * the entries rule block exists to prevent.
   */
  it('stamps a draft and ignores a client-sent status', async () => {
    const result = await createEntry({
      title: 'Sneaky',
      status: 'published',
      publishedAt: 'now',
    })
    expect(result.status).toBe(200)
    const [, stored] = docsAt('hosts/host-1/collections/blog/entries')[0]
    expect(stored.status).toBe('draft')
    expect(stored.publishedAt).toBeUndefined()
    expect(stored.title).toBe('Sneaky')
  })
})

describe('collections are bounded per host (AGL-2266)', () => {
  const createCollection = async (slug: string) => {
    const response = await COLLECTIONS_POST(
      new Request('https://app.aglyn.com/api/hosts/collections', {
        method: 'POST',
        headers: { authorization: 'Bearer tok' },
        body: JSON.stringify({
          hostId: 'host-1',
          action: 'create',
          kind: 'content',
          data: { slug, displayName: slug },
        }),
      }),
    )
    return { status: response.status, body: await response.json() }
  }

  const fill = (count: number) => {
    for (let index = 0; index < count; index += 1) {
      seed('hosts/host-1/collections', `held-${index}`, {
        slug: `held-${index}`,
        kind: 'content',
      })
    }
  }

  /**
   * The pairing assertion, and the reason the entries cap means anything:
   * `ENTRIES_MAX_PER_COLLECTION` behind an unbounded supply of collections is
   * the same unbounded store spelled differently. The host is bounded by the
   * PRODUCT, so both numbers have to be finite AND both have to be enforced.
   */
  it('bounds the host as the product of the two caps', () => {
    expect(Number.isFinite(COLLECTIONS_MAX_PER_HOST)).toBe(true)
    expect(Number.isFinite(ENTRIES_MAX_PER_COLLECTION)).toBe(true)
  })

  /**
   * FORCED RED: delete the `held >= COLLECTIONS_MAX_PER_HOST` branch from
   * /api/hosts/collections and this returns 200 — an unbounded supply, which
   * makes the per-collection entry ceiling decorative.
   */
  it('refuses the create that would exceed the cap', async () => {
    // `blog` is seeded by the outer `beforeEach`, so fill one short of it.
    fill(COLLECTIONS_MAX_PER_HOST - 1)
    const result = await createCollection('one-too-many')
    expect(result.status).toBe(403)
    expect(String(result.body.error)).toContain(String(COLLECTIONS_MAX_PER_HOST))
    expect(docsAt('hosts/host-1/collections')).toHaveLength(
      COLLECTIONS_MAX_PER_HOST,
    )
  })

  /** The other half: the last permitted create still lands. */
  it('lands the last create that fits', async () => {
    fill(COLLECTIONS_MAX_PER_HOST - 2)
    const result = await createCollection('last-one')
    expect(result.status).toBe(200)
    expect(docsAt('hosts/host-1/collections')).toHaveLength(
      COLLECTIONS_MAX_PER_HOST,
    )
  })
})
