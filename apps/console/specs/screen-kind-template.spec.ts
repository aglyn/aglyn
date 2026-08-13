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
 * AGL-1400: "is a template" is a property of the SCREEN.
 *
 * Four issues were the same sentence at different depths (AGL-1173, AGL-1383,
 * AGL-1387, AGL-1390) because whether a screen was billable was derived from a
 * mutable field on a DIFFERENT document. The answer to "is this screen a page?"
 * was a join, the join's other side was editable, and every new way to edit it
 * was a new issue.
 *
 * `kind: 'template'` moves the fact onto the screen, where AGL-1383 already
 * froze `kind` and where `screenClaimsToBeAPage` already answers for both the
 * count and the serve path. What this suite pins is the ASYMMETRY that replaces
 * AGL-1390's post-state machinery:
 *
 *   - **demotion (page → template) always succeeds**, because it lowers the
 *     count. Nobody is ever told they may not stop using a screen as a page.
 *   - **promotion (template → page) is checked exactly like a create**, because
 *     it raises it.
 *
 * The loop AGL-1390 closed by refusing the CLEAR is closed here by the clear
 * doing nothing to the count: the screen stays a template until somebody
 * deliberately promotes it, and that promotion meets the same gate a create
 * does. Driven through the ROUTES against one mutable store, because a function
 * called once per create cannot see a loop.
 */

/** Screen ids the create route hands out, in order. */
let mockNextUid = 0

const mockVerifyIdToken = jest.fn()

interface Store {
  host: Record<string, unknown>
  screens: Record<string, Record<string, unknown>>
  collections: Record<string, Record<string, unknown>>
  org: Record<string, unknown>
}
let mockStore: Store

/** The sentinel our `FieldValue.delete()` mock returns, made observable. */
const DELETED = '__field_deleted__'

const snapshotOf = (id: string, data: Record<string, unknown> | null) => ({
  id,
  exists: data !== null,
  data: () => data ?? undefined,
  get: (field: string) => (data ?? {})[field],
  ref: { id },
})

function fakeCollection(bucket: Record<string, Record<string, unknown>>) {
  const api: any = {
    select: () => api,
    where: () => api,
    limit: () => api,
    orderBy: () => api,
    count: () => ({
      get: async () => ({ data: () => ({ count: Object.keys(bucket).length }) }),
    }),
    get: async () => ({
      docs: Object.entries(bucket).map(([id, data]) => snapshotOf(id, data)),
      get empty() {
        return !Object.keys(bucket).length
      },
      get size() {
        return Object.keys(bucket).length
      },
    }),
    doc: (id: string) => ({
      id,
      get: async () => snapshotOf(id, bucket[id] ?? null),
      create: async (payload: Record<string, unknown>) => {
        if (bucket[id]) throw Object.assign(new Error('exists'), { code: 6 })
        bucket[id] = { ...payload }
      },
      set: async (payload: Record<string, unknown>) => {
        bucket[id] = { ...(bucket[id] ?? {}), ...payload }
      },
      update: async (payload: Record<string, unknown>) => {
        const next = { ...(bucket[id] ?? {}) }
        for (const [key, value] of Object.entries(payload)) {
          if (value === DELETED) delete next[key]
          else next[key] = value
        }
        bucket[id] = next
      },
      collection: () => fakeCollection({}),
    }),
  }
  return api
}

const fakeHostRef = {
  id: 'host-1',
  get: async () => snapshotOf('host-1', mockStore.host),
  collection: (name: string) =>
    name === 'screens'
      ? fakeCollection(mockStore.screens)
      : name === 'collections'
        ? fakeCollection(mockStore.collections)
        : fakeCollection({}),
}

const fakeFirestore = {
  collection: (name: string) => ({
    doc: (id: string) =>
      name === 'orgs'
        ? { id, get: async () => snapshotOf(id, mockStore.org) }
        : fakeHostRef,
  }),
  runTransaction: async (body: (transaction: any) => Promise<unknown>) =>
    body({
      get: async (ref: any) =>
        typeof ref?.get === 'function' ? ref.get() : { docs: [], empty: true },
      create: () => undefined,
      set: () => undefined,
    }),
  // The pointer write and the conversion it implies land together or not at
  // all, so the route batches them; the fake applies them in order on commit.
  batch: () => {
    const queued: Array<() => Promise<unknown>> = []
    return {
      update: (ref: any, payload: Record<string, unknown>) => {
        queued.push(() => ref.update(payload))
      },
      commit: async () => {
        for (const write of queued) await write()
      },
    }
  },
}

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
      firestore: () => fakeFirestore,
    }),
  },
  getOrgForHost: async () => ({ orgId: 'org-1', org: mockStore.org }),
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
  // Lockdown (AGL-1501): the verdict's own logic is unit-tested in
  // libs/tenant/data/admin lockdown.spec.ts; this mirror keeps its contract
  // observable here — staff bypass, suspended org/host => locked (423).
  getLockdownVerdict: async (options: Record<string, any>) =>
    options?.staff === true
      ? null
      : options?.org?.suspendedAt != null
        ? { scope: 'org', reason: 'manual' }
        : options?.host?.suspendedAt != null
          ? { scope: 'host', reason: 'manual' }
          : null,
  lockdownJsonResponse: (state: Record<string, unknown>) =>
    Response.json({ error: 'locked', ...state }, { status: 423 }),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  // The REAL plan limits and the REAL page-claim rule. A suite that stubbed the
  // entitlements would pass against a route enforcing nothing.
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/plan-entitlements'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/screen-route'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/collection-kind'),
  createResourceUid: () => `made-${++mockNextUid}`,
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

import { POST as COLLECTIONS_POST } from '../app/api/hosts/collections/route'
import { POST as RESOURCES_POST } from '../app/api/hosts/resources/route'
import { POST as SCREENS_POST } from '../app/api/hosts/screens/route'
import { billableScreenIds } from '../app/api/hosts/resources/count-billable-screens'

function seed(options: {
  plan?: string
  screens?: string[]
  collections?: Record<string, Record<string, unknown>>
} = {}) {
  const ids = options.screens ?? ['s1', 's2', 's3', 's4', 's5']
  mockStore = {
    host: {
      memberRoles: { 'user-1': 'admin' },
      orgId: 'org-1',
      screens: Object.fromEntries(ids.map((id) => [id, `/${id}`])),
    },
    screens: Object.fromEntries(
      ids.map((id) => [id, { displayName: `Page ${id}`, kind: 'page' }]),
    ),
    collections: options.collections ?? {
      blog: { slug: 'blog', kind: 'content', displayName: 'Blog' },
    },
    org: { plan: options.plan ?? 'free' },
  }
  mockNextUid = 0
}

/** What the enforcement points count for the host right now. */
function billableNow(): number {
  return billableScreenIds(
    Object.entries(mockStore.screens).map(([id, data]) => ({ id, ...data })),
    mockStore.host.screens as Record<string, unknown>,
  ).size
}

const kindOf = (id: string) => mockStore.screens[id]?.kind

async function post(path: string, body: unknown) {
  const handler =
    path === 'collections'
      ? COLLECTIONS_POST
      : path === 'screens'
        ? SCREENS_POST
        : RESOURCES_POST
  const response = await handler(
    new Request(`https://app.aglyn.com/api/hosts/${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token',
      },
      body: JSON.stringify(body),
    }),
  )
  return { status: response.status, body: await response.json() }
}

/** Assign/move/clear a collection's template pointer through the route. */
const setTemplate = (data: Record<string, unknown>, id = 'blog') =>
  post('collections', { hostId: 'host-1', action: 'templates', id, data })

/** Convert one screen between page and template. */
const convert = (id: string, kind: 'page' | 'template') =>
  post('screens', { hostId: 'host-1', id, action: 'convert', kind })

const createScreen = (data: Record<string, unknown> = {}) =>
  post('resources', {
    hostId: 'host-1',
    resource: 'screen',
    data: { displayName: 'New page', ...data },
  })

beforeEach(() => {
  mockVerifyIdToken.mockResolvedValue({ uid: 'user-1', email_verified: true })
  seed()
})

describe('the fact lives on the screen (AGL-1400)', () => {
  it('stamps the screen when a collection designates it as an entry template', async () => {
    expect(billableNow()).toBe(5)
    expect((await setTemplate({ entryScreenId: 's1' })).status).toBe(200)
    // The pointer is still a pointer; what changed is the SCREEN.
    expect(mockStore.collections.blog.entryScreenId).toBe('s1')
    expect(kindOf('s1')).toBe('template')
    expect(billableNow()).toBe(4)
  })

  it('stamps through the legacy pointer too', async () => {
    expect((await setTemplate({ templateScreenId: 's1' })).status).toBe(200)
    expect(kindOf('s1')).toBe('template')
  })

  // AGL-1387: a LIST template on a slugged content collection IS a page —
  // `/{collectionSlug}` renders that exact screen. Designating it must not
  // convert it, or the site loses the page and the plan loses the charge.
  it('does NOT convert a list template', async () => {
    expect((await setTemplate({ listScreenId: 's1' })).status).toBe(200)
    expect(kindOf('s1')).toBe('page')
    expect(billableNow()).toBe(5)
  })

  // Where AGL-1387's condition stops, AGL-1390 had to patch a hole. Under this
  // model there is nothing to patch: the screen was never converted, so it
  // still counts and the pointer buys nothing.
  it('does not convert a list template on a catalog collection either', async () => {
    seed({ collections: { shop: { slug: 'shop', kind: 'catalog', name: 'Shop' } } })
    expect((await setTemplate({ listScreenId: 's1' }, 'shop')).status).toBe(200)
    expect(kindOf('s1')).toBe('page')
    expect(billableNow()).toBe(5)
  })

  it('leaves an email document alone rather than overwriting its kind', async () => {
    mockStore.screens.s1 = { displayName: 'Welcome', kind: 'email' }
    expect((await setTemplate({ entryScreenId: 's1' })).status).toBe(200)
    expect(kindOf('s1')).toBe('email')
  })
})

describe('the asymmetry (AGL-1400)', () => {
  it('demotes at the cap — lowering the count is always allowed', async () => {
    expect(billableNow()).toBe(5)
    expect((await createScreen()).status).toBe(403)
    expect((await convert('s1', 'template')).status).toBe(200)
    expect(billableNow()).toBe(4)
  })

  it('demotes on an OVER-cap site, which AGL-1390 could refuse', async () => {
    seed({ screens: ['s1', 's2', 's3', 's4', 's5', 's6', 's7'] })
    expect(billableNow()).toBe(7)
    expect((await convert('s1', 'template')).status).toBe(200)
    expect(billableNow()).toBe(6)
  })

  it('checks a promotion exactly like a create, and refuses it at the cap', async () => {
    await convert('s1', 'template')
    expect(billableNow()).toBe(4)
    // The freed slot admits a screen — this is supposed to work.
    expect((await createScreen()).status).toBe(200)
    expect(billableNow()).toBe(5)
    // …and the promotion that would mint the sixth is refused, with the
    // arithmetic the person clicking needs.
    const promoted = await convert('s1', 'page')
    expect(promoted.status).toBe(403)
    expect(promoted.body.error).toContain('6 of 5')
    expect(kindOf('s1')).toBe('template')
    expect(billableNow()).toBe(5)
  })

  it('allows the promotion once there is room', async () => {
    seed({ screens: ['s1', 's2'] })
    await convert('s1', 'template')
    expect(billableNow()).toBe(1)
    expect((await convert('s1', 'page')).status).toBe(200)
    expect(kindOf('s1')).toBe('page')
    expect(billableNow()).toBe(2)
  })

  it('promotes freely on an unlimited plan', async () => {
    seed({ plan: 'business', screens: ['s1', 's2', 's3', 's4', 's5', 's6'] })
    await convert('s1', 'template')
    expect((await convert('s1', 'page')).status).toBe(200)
  })
})

describe('the laundering loop, closed by the model (AGL-1390)', () => {
  it('lets the clear succeed and still mints nothing', async () => {
    expect(billableNow()).toBe(5)
    expect((await createScreen()).status).toBe(403)

    // 1. Designate a live screen. It converts, so the count drops.
    expect((await setTemplate({ entryScreenId: 's1' })).status).toBe(200)
    expect(billableNow()).toBe(4)

    // 2. The freed slot admits a screen.
    expect((await createScreen()).status).toBe(200)
    expect(billableNow()).toBe(5)

    // 3. The clear that used to mint the slot — and that AGL-1390 had to
    //    REFUSE. It succeeds now, because a pointer is only a pointer: s1 is
    //    still a template, so the count does not move.
    const cleared = await setTemplate({ entryScreenId: null })
    expect(cleared.status).toBe(200)
    expect('entryScreenId' in mockStore.collections.blog).toBe(false)
    expect(kindOf('s1')).toBe('template')
    expect(billableNow()).toBe(5)

    // The loop's second turn buys nothing either: re-pointing converts s2 (one
    // fewer page) and the create that follows spends exactly that slot.
    expect((await setTemplate({ entryScreenId: 's2' })).status).toBe(200)
    expect(billableNow()).toBe(4)
    expect((await createScreen()).status).toBe(200)
    expect((await createScreen()).status).toBe(403)

    // Seven screen documents, five of them pages: the two the plan genuinely
    // had room for once two screens stopped being pages, and no more.
    expect(Object.keys(mockStore.screens)).toHaveLength(7)
    expect(billableNow()).toBe(5)
  })

  it('refuses to mint a slot through the create path either', async () => {
    // `kind` is on the screen allow-list because the email composer sends it.
    // A create claiming to be a template would be an uncounted screen the
    // promotion gate never saw. Seeded with room, so the refusal can only be
    // about the kind and not about the quota.
    seed({ screens: ['s1', 's2'] })
    expect((await createScreen()).status).toBe(200)
    const created = await createScreen({ kind: 'template' })
    expect(created.status).toBe(403)
    expect(created.body.error).toContain('template')
    expect(Object.keys(mockStore.screens)).toHaveLength(3)
  })
})

/**
 * Carried over from `screen-cap-template-pointer-loop.spec.ts`, which this
 * suite replaces: that suite's subject was AGL-1390's refuse-the-raise, and
 * there is no raise to refuse any more. These are the assertions about the
 * pointer route that outlived it.
 */
describe('the pointer route itself', () => {
  it('refuses a pointer at a screen this site does not have', async () => {
    const response = await setTemplate({ entryScreenId: 'not-a-screen' })
    expect(response.status).toBe(400)
    expect(mockStore.collections.blog.entryScreenId).toBeUndefined()
  })

  it('refuses an unknown collection', async () => {
    expect((await setTemplate({ entryScreenId: 's1' }, 'no-such')).status).toBe(404)
  })

  it('stores nothing but the three pointers', async () => {
    const response = await setTemplate({
      entryScreenId: 's1',
      slug: 'stolen',
      kind: 'catalog',
      displayName: 'renamed',
    })
    expect(response.status).toBe(200)
    expect(mockStore.collections.blog.slug).toBe('blog')
    expect(mockStore.collections.blog.kind).toBe('content')
    expect(mockStore.collections.blog.displayName).toBe('Blog')
  })

  it('refuses a request carrying no pointer at all', async () => {
    expect((await setTemplate({ displayName: 'x' })).status).toBe(400)
  })

  it('clears the superseded legacy pointer alongside the entry pointer', async () => {
    await setTemplate({ templateScreenId: 's1' })
    const assigned = await setTemplate({
      entryScreenId: 's2',
      templateScreenId: null,
    })
    expect(assigned.status).toBe(200)
    expect(mockStore.collections.blog.entryScreenId).toBe('s2')
    expect('templateScreenId' in mockStore.collections.blog).toBe(false)
    // Both screens are templates now: the one let go of is not promoted back.
    expect(kindOf('s1')).toBe('template')
    expect(kindOf('s2')).toBe('template')
  })

  it('requires the editor role', async () => {
    mockStore.host.memberRoles = { 'user-1': 'viewer' }
    expect((await setTemplate({ entryScreenId: 's1' })).status).toBe(403)
  })

  it('refuses while the owning workspace is suspended — 423 (AGL-1501)', async () => {
    mockStore.org = { plan: 'free', suspendedAt: { seconds: 1 } }
    expect((await setTemplate({ entryScreenId: 's1' })).status).toBe(423)
  })

  // The AGL-1390 refusal, gone on purpose: a pointer edit is never refused for
  // quota now, on any plan, at any distance over the cap.
  it('clears a template on an over-cap site without being refused', async () => {
    seed({ screens: ['s1', 's2', 's3', 's4', 's5', 's6', 's7'] })
    await setTemplate({ entryScreenId: 's1' })
    expect((await setTemplate({ entryScreenId: null })).status).toBe(200)
    expect(billableNow()).toBe(6)
  })
})

describe('the convert route itself', () => {
  it('404s an unknown screen', async () => {
    expect((await convert('nope', 'template')).status).toBe(404)
  })

  it('refuses an unknown kind', async () => {
    const response = await post('screens', {
      hostId: 'host-1',
      id: 's1',
      action: 'convert',
      kind: 'email',
    })
    expect(response.status).toBe(400)
    expect(kindOf('s1')).toBe('page')
  })

  it('refuses to convert an email document', async () => {
    mockStore.screens.s1 = { displayName: 'Welcome', kind: 'email' }
    expect((await convert('s1', 'template')).status).toBe(400)
    expect(kindOf('s1')).toBe('email')
  })

  it('requires the editor role', async () => {
    mockStore.host.memberRoles = { 'user-1': 'viewer' }
    expect((await convert('s1', 'template')).status).toBe(403)
  })

  it('refuses while the owning workspace is suspended — 423 (AGL-1501)', async () => {
    mockStore.org = { plan: 'free', suspendedAt: { seconds: 1 } }
    expect((await convert('s1', 'template')).status).toBe(423)
  })

  it('is idempotent', async () => {
    expect((await convert('s1', 'template')).status).toBe(200)
    expect((await convert('s1', 'template')).status).toBe(200)
    expect(billableNow()).toBe(4)
  })
})
