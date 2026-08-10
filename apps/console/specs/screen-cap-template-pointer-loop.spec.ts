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
 * AGL-1390: `screensPerHost` cannot be laundered by toggling a template
 * pointer.
 *
 * `count-billable-screens.spec.ts` tests the COUNT, and could not have caught
 * this: the count was right at every instant. What was wrong was WHEN it was
 * asked. `screensPerHost` was a create-time gate, so any field that lowers the
 * count and can be raised again mints a permanent slot —
 *
 *   1. point `entryScreenId` at a live screen  → it stops counting
 *   2. create a screen                         → the freed slot admits it
 *   3. clear the pointer                       → the screen counts again
 *
 * — and the host is one over, repeatably, with every individual step
 * legitimate. A function called once per create cannot see a loop, which is
 * why this suite drives the two ROUTES against one mutable store and asserts
 * on the state they leave behind, rather than calling the counter.
 *
 * The loop runs twice here, because one turn only proves the clear was
 * refused; a second turn is what would have minted the slot.
 */

/** Screen ids the create route hands out, in order. */
let mockNextUid = 0

const mockVerifyIdToken = jest.fn()

/**
 * The store the two routes share. Everything under one host, because the loop
 * is a per-host cap and crossing hosts would be a different bug.
 */
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
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  // The REAL plan limits, the REAL page-claim rule and the REAL collection-kind
  // reader. A suite that stubbed the entitlements would pass against a route
  // enforcing nothing, which is the failure mode this issue is about.
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
import { billableScreenIds } from '../app/api/hosts/resources/count-billable-screens'

/** A live, published screen — the ordinary case. */
function livePage(id: string) {
  return { id, doc: { displayName: `Page ${id}`, kind: 'page' } }
}

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
      // Every seeded screen is published, so the routing map routes it.
      screens: Object.fromEntries(ids.map((id) => [id, `/${id}`])),
    },
    screens: Object.fromEntries(ids.map((id) => [id, livePage(id).doc])),
    collections: options.collections ?? {
      blog: { slug: 'blog', kind: 'content', displayName: 'Blog' },
    },
    org: { plan: options.plan ?? 'free' },
  }
  mockNextUid = 0
}

/** What the enforcement points would count for the host right now. */
function billableNow(): number {
  return billableScreenIds(
    Object.entries(mockStore.screens).map(([id, data]) => ({ id, ...data })),
    Object.values(mockStore.collections),
    mockStore.host.screens as Record<string, unknown>,
  ).size
}

async function post(path: string, body: unknown) {
  const handler = path === 'collections' ? COLLECTIONS_POST : RESOURCES_POST
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

/** Create one screen through the quota-enforcing route. */
const createScreen = () =>
  post('resources', {
    hostId: 'host-1',
    resource: 'screen',
    data: { displayName: 'New page' },
  })

beforeEach(() => {
  mockVerifyIdToken.mockResolvedValue({
    uid: 'user-1',
    email_verified: true,
  })
  seed()
})

describe('the laundering loop', () => {
  it('refuses the clear that mints the slot, and the next turn buys nothing', async () => {
    // The gate itself works: five of five, no room.
    expect(billableNow()).toBe(5)
    expect((await createScreen()).status).toBe(403)

    // 1. Point at a live screen. The count drops, and this is allowed on every
    //    plan at every moment, because it never raises anything.
    expect((await setTemplate({ entryScreenId: 's1' })).status).toBe(200)
    expect(billableNow()).toBe(4)

    // 2. The freed slot admits a screen. This step is SUPPOSED to work — the
    //    site really is at four, and s1 really is serving entries rather than
    //    a page of its own.
    expect((await createScreen()).status).toBe(200)
    expect(billableNow()).toBe(5)

    // 3. …and this is the step that used to hand the screen back for free.
    const cleared = await setTemplate({ entryScreenId: null })
    expect(cleared.status).toBe(403)
    expect(cleared.body.error).toContain('6 of 5')
    expect(cleared.body.error).toContain('Page s1')

    // Nothing moved: the pointer is still set and the site is still at five.
    expect(mockStore.collections.blog.entryScreenId).toBe('s1')
    expect(billableNow()).toBe(5)

    // The loop's second turn. Re-pointing at a different screen is allowed —
    // it raises nothing — but it frees nothing either, because s1 goes back to
    // counting as s2 stops. So the create that would have been the second
    // minted slot is refused, and every further turn is this same turn.
    expect((await setTemplate({ entryScreenId: 's2' })).status).toBe(200)
    expect(billableNow()).toBe(5)
    expect((await createScreen()).status).toBe(403)

    // Six screen documents exist and exactly five of them are pages: the one
    // screen the plan genuinely had room for, and no more. Before this the
    // site would have been at six and climbing.
    expect(Object.keys(mockStore.screens)).toHaveLength(6)
    expect(billableNow()).toBe(5)
  })

  it('closes the legacy pointer too, not only the one it was found on', async () => {
    expect((await setTemplate({ templateScreenId: 's1' })).status).toBe(200)
    expect((await createScreen()).status).toBe(200)
    const cleared = await setTemplate({ templateScreenId: null })
    expect(cleared.status).toBe(403)
    expect(mockStore.collections.blog.templateScreenId).toBe('s1')
  })

  it('closes a list pointer on a catalog collection, where AGL-1387 stops', async () => {
    // A catalog collection's slug names /collections/{slug} and its listing is
    // composed by commerce, so `collectionListTemplateScreenIds` does not
    // reach it — the screen is excluded, and the pointer is a door.
    seed({
      collections: { shop: { slug: 'shop', kind: 'catalog', name: 'Shop' } },
    })
    expect((await setTemplate({ listScreenId: 's1' }, 'shop')).status).toBe(200)
    expect(billableNow()).toBe(4)
    expect((await createScreen()).status).toBe(200)
    expect((await setTemplate({ listScreenId: null }, 'shop')).status).toBe(403)
  })
})

describe('ordinary authoring is unaffected', () => {
  it('assigns a template at the cap', async () => {
    expect(billableNow()).toBe(5)
    expect((await setTemplate({ entryScreenId: 's1' })).status).toBe(200)
    expect(mockStore.collections.blog.entryScreenId).toBe('s1')
  })

  it('moves a template between screens at the cap — a move raises nothing', async () => {
    await setTemplate({ entryScreenId: 's1' })
    // s1 starts counting again and s2 stops: the same number, a different page.
    const moved = await setTemplate({ entryScreenId: 's2' })
    expect(moved.status).toBe(200)
    expect(mockStore.collections.blog.entryScreenId).toBe('s2')
    expect(billableNow()).toBe(4)
  })

  it('clears a template when the site has room, and really clears it', async () => {
    seed({ screens: ['s1', 's2'] })
    await setTemplate({ entryScreenId: 's1' })
    const cleared = await setTemplate({ entryScreenId: null })
    expect(cleared.status).toBe(200)
    expect('entryScreenId' in mockStore.collections.blog).toBe(false)
    expect(billableNow()).toBe(2)
  })

  it('clears the superseded legacy pointer alongside the entry pointer', async () => {
    seed({ screens: ['s1', 's2'] })
    await setTemplate({ templateScreenId: 's1' })
    // What the console's entry select sends: the new pointer plus a clear of
    // the AGL-105 one, so the select stays the single source of truth.
    const assigned = await setTemplate({
      entryScreenId: 's2',
      templateScreenId: null,
    })
    expect(assigned.status).toBe(200)
    expect(mockStore.collections.blog.entryScreenId).toBe('s2')
    expect('templateScreenId' in mockStore.collections.blog).toBe(false)
  })

  it('clears freely on an unlimited plan', async () => {
    seed({ plan: 'business' })
    await setTemplate({ entryScreenId: 's1' })
    expect((await setTemplate({ entryScreenId: null })).status).toBe(200)
  })

  it('leaves a list template on a slugged content collection alone', async () => {
    // AGL-1387 already made this one count either way, so neither setting nor
    // clearing it changes anything — including at the cap.
    expect((await setTemplate({ listScreenId: 's1' })).status).toBe(200)
    expect(billableNow()).toBe(5)
    expect((await setTemplate({ listScreenId: null })).status).toBe(200)
    expect(billableNow()).toBe(5)
  })

  it('allows a write that does not raise the count on an over-cap site', async () => {
    // Over the cap by legitimate means — a downgrade, or a site import. The
    // gate is against minting slots, not against editing while over one.
    seed({ plan: 'free', screens: ['s1', 's2', 's3', 's4', 's5', 's6', 's7'] })
    expect(billableNow()).toBe(7)
    expect((await setTemplate({ entryScreenId: 's1' })).status).toBe(200)
    // And the move that follows, which is still not a raise.
    expect((await setTemplate({ entryScreenId: 's2' })).status).toBe(200)
    expect(billableNow()).toBe(6)
  })
})

describe('the route itself', () => {
  it('refuses a pointer at a screen this site does not have', async () => {
    const response = await setTemplate({ entryScreenId: 'not-a-screen' })
    expect(response.status).toBe(400)
    expect(mockStore.collections.blog.entryScreenId).toBeUndefined()
  })

  it('refuses an unknown collection', async () => {
    const response = await setTemplate({ entryScreenId: 's1' }, 'no-such')
    expect(response.status).toBe(404)
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

  it('requires the editor role', async () => {
    mockStore.host.memberRoles = { 'user-1': 'viewer' }
    expect((await setTemplate({ entryScreenId: 's1' })).status).toBe(403)
  })

  it('refuses while the owning workspace is suspended', async () => {
    mockStore.org = { plan: 'free', suspendedAt: { seconds: 1 } }
    expect((await setTemplate({ entryScreenId: 's1' })).status).toBe(403)
  })
})
